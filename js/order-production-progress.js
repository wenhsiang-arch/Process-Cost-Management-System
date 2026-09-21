// order-production-progress（訂單生產進度）：以訂單版本與款號版本控制 UID 隔離的本機快取。
(function(){
  'use strict';

  const CACHE_SCOPE='order-production-progress';
  const CACHE_SCHEMA_VERSION=1;
  const VERSION_COLLECTION='orderProductionProgressVersions';
  const ITEM_COLLECTION='orderItems';
  const PRODUCT_COLLECTION='products';
  const TOTAL_COLLECTION='productionProcessTotals';
  const VERSION_QUERY_SIZE=10;
  let activePromise=null;
  let activeKey='';

  function text(value){ return String(value??'').trim(); }
  function number(value){ const result=Number(value); return Number.isFinite(result)?result:0; }
  function positive(value){ return Math.max(0,number(value)); }
  function documentRows(snapshot){ return (snapshot?.docs||[]).map(item=>({id:item.id,...item.data()})); }
  function chunks(items,size){
    const result=[];
    for(let index=0;index<items.length;index+=size) result.push(items.slice(index,index+size));
    return result;
  }
  function orderToken(order){
    return [number(order?.updatedAt),number(order?.totalQty),number(order?.itemCount),text(order?.importStatus),text(order?.lifecycleStatus)].join('|');
  }
  function productToken(meta){
    return [number(meta?.changeSequence),number(meta?.updatedAt),text(meta?.trackingEpoch),number(meta?.productCount),number(meta?.opCount)].join('|');
  }
  function blankCache(){ return {schemaVersion:CACHE_SCHEMA_VERSION,productToken:'',products:{},orders:{}}; }
  function validCache(value){
    return value?.schemaVersion===CACHE_SCHEMA_VERSION&&value.products&&typeof value.products==='object'
      &&value.orders&&typeof value.orders==='object';
  }
  function processTotalId(orderItemId,processId){
    return window.PCMSOrderItemStore?.processTotalId?.(orderItemId,processId)||`${orderItemId}__${processId}`;
  }
  function progressVersion(row){ return Math.max(0,Math.round(number(row?.revision))); }

  function maySkipVersionRead(error){
    const code=text(error?.code).toLowerCase();
    return code.includes('permission-denied')||code.includes('failed-precondition');
  }

  async function loadVersionMap(orderIds){
    const result=new Map(orderIds.map(id=>[id,0]));
    try{
      for(const group of chunks(orderIds,VERSION_QUERY_SIZE)){
        if(!group.length) continue;
        const snapshot=await window._getDocs(window._query(window._collection(VERSION_COLLECTION),window._where('orderId','in',group)));
        documentRows(snapshot).forEach(row=>{ if(result.has(text(row.orderId))) result.set(text(row.orderId),progressVersion(row)); });
      }
      return {values:result,available:true};
    }catch(error){
      if(!maySkipVersionRead(error)) throw error;
      // 版本資料只用來減少重讀；權限尚未發布或索引尚未完成時，改讀正式來源計算。
      console.warn('Không thể đọc phiên bản tiến độ; chuyển sang tính trực tiếp / 無法讀取進度版本，改用直接計算',error);
      return {values:result,available:false};
    }
  }

  async function loadItems(orderId){
    const snapshot=await window._getDocs(window._query(window._collection(ITEM_COLLECTION),window._where('orderId','==',orderId)));
    return documentRows(snapshot).filter(item=>item.active!==false).map(item=>({
      orderItemId:text(item.orderItemId||item.id),productId:text(item.productId),quantity:positive(item.quantity)
    })).filter(item=>item.orderItemId&&item.productId&&item.quantity>0);
  }

  async function loadProduct(productId){
    const snapshot=await window._getDoc(window._docRef(PRODUCT_COLLECTION,productId));
    if(!snapshot.exists()) return null;
    const data=snapshot.data();
    return data?.active===false?null:{productId,...data,ops:Array.isArray(data?.ops)?data.ops:[]};
  }

  function productionProcesses(items,products){
    const rows=[];
    items.forEach(item=>{
      const product=products[item.productId];
      (product?.ops||[]).filter(operation=>operation?.active!==false&&text(operation?.category)==='SX').forEach(operation=>{
        const processId=text(operation.processId);
        const seconds=positive(operation.sec);
        if(!processId||seconds<=0) return;
        rows.push({
          totalId:processTotalId(item.orderItemId,processId),orderItemId:item.orderItemId,
          productId:item.productId,processId,orderQty:item.quantity,seconds
        });
      });
    });
    return rows;
  }

  async function loadRegisteredQuantities(processes){
    const pairs=await Promise.all(processes.map(async process=>{
      const snapshot=await window._getDoc(window._docRef(TOTAL_COLLECTION,process.totalId));
      return [process.totalId,snapshot.exists()?positive(snapshot.data()?.registeredQty):0];
    }));
    return Object.fromEntries(pairs);
  }

  function calculate(processes,registeredQuantities){
    let requiredSeconds=0;
    let registeredSeconds=0;
    processes.forEach(process=>{
      const registered=Math.min(process.orderQty,positive(registeredQuantities?.[process.totalId]));
      requiredSeconds+=process.orderQty*process.seconds;
      registeredSeconds+=registered*process.seconds;
    });
    const percent=requiredSeconds>0?Math.max(0,Math.min(100,registeredSeconds/requiredSeconds*100)):0;
    return {percent,requiredSeconds,registeredSeconds,remainingSeconds:Math.max(0,requiredSeconds-registeredSeconds),processCount:processes.length};
  }

  async function loadInternal(orders){
    const orderIds=orders.map(order=>text(order.id)).filter(Boolean);
    const [stored,metaSnapshot,versionState]=await Promise.all([
      window.pcmsDataCache?.read(CACHE_SCOPE),
      window._getDoc(window._docRef('system','productsMeta')),
      loadVersionMap(orderIds)
    ]);
    const cache=validCache(stored)?stored:blankCache();
    const next=blankCache();
    const latestProductToken=productToken(metaSnapshot.exists()?metaSnapshot.data():{});
    const productsChanged=cache.productToken!==latestProductToken;
    next.productToken=latestProductToken;
    next.products=productsChanged?{}:{...cache.products};

    const itemSets={};
    for(const order of orders){
      const orderId=text(order.id);
      const cached=cache.orders[orderId];
      const currentOrderToken=orderToken(order);
      itemSets[orderId]=cached&&cached.orderToken===currentOrderToken&&Array.isArray(cached.items)
        ?cached.items:await loadItems(orderId);
    }
    const productIds=[...new Set(Object.values(itemSets).flat().map(item=>item.productId).filter(Boolean))];
    for(const productId of productIds){
      if(productsChanged||!Object.prototype.hasOwnProperty.call(next.products,productId)){
        next.products[productId]=await loadProduct(productId);
      }
    }

    const result=new Map();
    for(const order of orders){
      const orderId=text(order.id);
      const currentOrderToken=orderToken(order);
      const currentRevision=versionState.values.get(orderId)||0;
      const cached=cache.orders[orderId];
      const processes=productionProcesses(itemSets[orderId],next.products);
      const structureChanged=!cached||cached.orderToken!==currentOrderToken||productsChanged;
      const productionChanged=!versionState.available||!cached||number(cached.progressRevision)!==currentRevision;
      let registeredQuantities=!productionChanged&&cached?.registeredQuantities?{...cached.registeredQuantities}:null;
      if(!registeredQuantities||structureChanged&&productionChanged) registeredQuantities=await loadRegisteredQuantities(processes);
      else if(structureChanged){
        const missing=processes.filter(process=>!(process.totalId in registeredQuantities));
        Object.assign(registeredQuantities,await loadRegisteredQuantities(missing));
      }
      const calculation=calculate(processes,registeredQuantities);
      next.orders[orderId]={orderToken:currentOrderToken,progressRevision:versionState.available?currentRevision:null,items:itemSets[orderId],
        registeredQuantities,calculation};
      result.set(orderId,calculation);
    }
    await window.pcmsDataCache?.write(CACHE_SCOPE,`${latestProductToken}|${Date.now()}`,next);
    return result;
  }

  function load(orders){
    const list=(Array.isArray(orders)?orders:[]).filter(order=>text(order?.id));
    const key=list.map(order=>`${text(order.id)}:${orderToken(order)}`).join(',');
    if(activePromise&&activeKey===key) return activePromise;
    activeKey=key;
    activePromise=loadInternal(list).finally(()=>{ activePromise=null; activeKey=''; });
    return activePromise;
  }

  function reset(){ activePromise=null;activeKey='';return window.pcmsDataCache?.remove(CACHE_SCOPE); }
  window.PCMSOrderProductionProgress=Object.freeze({load,reset,calculate,productionProcesses,orderToken,productToken});
})();
