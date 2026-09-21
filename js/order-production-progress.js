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
  const TOTAL_QUERY_SIZE=30;
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

  async function loadItemSets(orderIds){
    const result=Object.fromEntries(orderIds.map(orderId=>[orderId,[]]));
    for(const group of chunks(orderIds,VERSION_QUERY_SIZE)){
      const snapshot=await window._getDocs(window._query(window._collection(ITEM_COLLECTION),window._where('orderId','in',group)));
      documentRows(snapshot).filter(item=>item.active!==false).forEach(item=>{
        const orderId=text(item.orderId);
        const normalized={orderItemId:text(item.orderItemId||item.id),productId:text(item.productId),quantity:positive(item.quantity)};
        if(result[orderId]&&normalized.orderItemId&&normalized.productId&&normalized.quantity>0) result[orderId].push(normalized);
      });
    }
    return result;
  }

  async function loadProducts(productIds){
    const result=Object.fromEntries(productIds.map(productId=>[productId,null]));
    for(const group of chunks(productIds,TOTAL_QUERY_SIZE)){
      const snapshot=await window._getDocs(window._query(window._collection(PRODUCT_COLLECTION),
        window._where(window._documentId(),'in',group)));
      documentRows(snapshot).forEach(data=>{
        if(!Object.prototype.hasOwnProperty.call(result,data.id)||data?.active===false) return;
        result[data.id]={...data,productId:data.id,ops:Array.isArray(data?.ops)?data.ops:[]};
      });
    }
    return result;
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
    const totalIds=[...new Set(processes.map(process=>text(process.totalId)).filter(Boolean))];
    const result=Object.fromEntries(totalIds.map(totalId=>[totalId,0]));
    for(const group of chunks(totalIds,TOTAL_QUERY_SIZE)){
      const snapshot=await window._getDocs(window._query(window._collection(TOTAL_COLLECTION),
        window._where(window._documentId(),'in',group)));
      documentRows(snapshot).forEach(row=>{
        if(Object.prototype.hasOwnProperty.call(result,row.id)) result[row.id]=positive(row.registeredQty);
      });
    }
    return result;
  }

  function quantitiesFor(processes,source){
    return Object.fromEntries(processes.map(process=>[process.totalId,positive(source?.[process.totalId])]));
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
    const ordersNeedingItems=[];
    for(const order of orders){
      const orderId=text(order.id);
      const cached=cache.orders[orderId];
      const currentOrderToken=orderToken(order);
      if(cached&&cached.orderToken===currentOrderToken&&Array.isArray(cached.items)) itemSets[orderId]=cached.items;
      else ordersNeedingItems.push(orderId);
    }
    Object.assign(itemSets,await loadItemSets(ordersNeedingItems));
    const productIds=[...new Set(Object.values(itemSets).flat().map(item=>item.productId).filter(Boolean))];
    const productsNeedingLoad=productIds.filter(productId=>productsChanged||!Object.prototype.hasOwnProperty.call(next.products,productId));
    Object.assign(next.products,await loadProducts(productsNeedingLoad));

    const contexts=orders.map(order=>{
      const orderId=text(order.id);
      const currentOrderToken=orderToken(order);
      const currentRevision=versionState.values.get(orderId)||0;
      const cached=cache.orders[orderId];
      const processes=productionProcesses(itemSets[orderId],next.products);
      const structureChanged=!cached||cached.orderToken!==currentOrderToken||productsChanged;
      const productionChanged=!versionState.available||!cached||number(cached.progressRevision)!==currentRevision;
      const registeredQuantities=!productionChanged&&cached?.registeredQuantities?{...cached.registeredQuantities}:null;
      const reloadAll=!registeredQuantities||structureChanged&&productionChanged;
      const missing=!reloadAll&&structureChanged
        ?processes.filter(process=>!(process.totalId in registeredQuantities)):[];
      return {orderId,currentOrderToken,currentRevision,processes,registeredQuantities,reloadAll,missing};
    });

    // 所有訂單共用批次讀取，避免每道工序各自建立請求而耗盡瀏覽器連線。
    const requestedProcesses=contexts.flatMap(context=>context.reloadAll?context.processes:context.missing);
    const loadedQuantities=await loadRegisteredQuantities(requestedProcesses);
    const result=new Map();
    for(const context of contexts){
      let registeredQuantities=context.registeredQuantities;
      if(context.reloadAll) registeredQuantities=quantitiesFor(context.processes,loadedQuantities);
      else if(context.missing.length) Object.assign(registeredQuantities,quantitiesFor(context.missing,loadedQuantities));
      const calculation=calculate(context.processes,registeredQuantities);
      next.orders[context.orderId]={orderToken:context.currentOrderToken,
        progressRevision:versionState.available?context.currentRevision:null,items:itemSets[context.orderId],
        registeredQuantities,calculation};
      result.set(context.orderId,calculation);
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
