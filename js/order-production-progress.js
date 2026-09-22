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
  const QUERY_CONCURRENCY=3;
  const REFRESH_TIMEOUT_MS=20000;
  const LOCK_WAIT_TIMEOUT_MS=8000;
  const REFRESH_TIME_ZONE='Asia/Taipei';
  const REFRESH_HOUR=6;
  const REFRESH_SHIFT_MS=REFRESH_HOUR*60*60*1000;
  const ATTEMPT_MARKER_PREFIX='pcms-order-production-progress-attempt-v1';
  const MANUAL_ATTEMPT_MARKER_PREFIX='pcms-order-production-progress-manual-attempt-v1';
  const activePromises=new Map();
  let sessionRecord=null;
  let lastStatus=Object.freeze({periodKey:'',state:'idle',refreshedAt:0,attemptedAt:0});

  function text(value){ return String(value??'').trim(); }
  function number(value){ const result=Number(value); return Number.isFinite(result)?result:0; }
  function positive(value){ return Math.max(0,number(value)); }
  function documentRows(snapshot){ return (snapshot?.docs||[]).map(item=>({id:item.id,...item.data()})); }
  function chunks(items,size){
    const result=[];
    for(let index=0;index<items.length;index+=size) result.push(items.slice(index,index+size));
    return result;
  }
  function refreshTimeoutError(code){
    const error=new Error(code);
    error.code=code;
    return error;
  }
  function refreshContext(){ return {deadline:Date.now()+REFRESH_TIMEOUT_MS,cancelled:false}; }
  function remainingTime(context){ return Math.max(0,number(context?.deadline)-Date.now()); }
  function remoteRead(read,context){
    const wait=remainingTime(context);
    if(context?.cancelled||wait<=0){
      if(context) context.cancelled=true;
      return Promise.reject(refreshTimeoutError('order-progress-refresh-timeout'));
    }
    let promise;
    try{ promise=read(); }
    catch(error){ return Promise.reject(error); }
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        context.cancelled=true;
        reject(refreshTimeoutError('order-progress-refresh-timeout'));
      },wait);
      Promise.resolve(promise).then(value=>{ clearTimeout(timer);resolve(value); },error=>{ clearTimeout(timer);reject(error); });
    });
  }
  async function runBatches(groups,context,worker){
    let nextIndex=0;
    const runners=Array.from({length:Math.min(QUERY_CONCURRENCY,groups.length)},async()=>{
      while(!context.cancelled){
        const index=nextIndex++;
        if(index>=groups.length) return;
        await worker(groups[index],context);
      }
    });
    await Promise.all(runners);
  }
  function orderToken(order){
    return [number(order?.totalQty),number(order?.itemCount),text(order?.importStatus),text(order?.lifecycleStatus)].join('|');
  }
  function productToken(meta){
    return [number(meta?.changeSequence),number(meta?.updatedAt),text(meta?.trackingEpoch),number(meta?.productCount),number(meta?.opCount)].join('|');
  }
  function refreshPeriodKey(timestamp=Date.now()){
    const shifted=new Date(Number(timestamp)-REFRESH_SHIFT_MS);
    const parts=new Intl.DateTimeFormat('en-CA',{
      timeZone:REFRESH_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(shifted);
    const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  }
  function blankCache(){
    return {schemaVersion:CACHE_SCHEMA_VERSION,productToken:'',products:{},orders:{},
      refreshPeriod:'',refreshState:'idle',refreshedAt:0,attemptedAt:0};
  }
  function validCache(value){
    return value?.schemaVersion===CACHE_SCHEMA_VERSION&&value.products&&typeof value.products==='object'
      &&value.orders&&typeof value.orders==='object';
  }
  function processTotalId(orderItemId,processId){
    return window.PCMSOrderItemStore?.processTotalId?.(orderItemId,processId)||`${orderItemId}__${processId}`;
  }
  function progressVersion(row){ return Math.max(0,Math.round(number(row?.revision))); }
  function cacheStatus(cache,periodKey){
    return Object.freeze({periodKey,state:text(cache?.refreshState)||'idle',
      refreshedAt:number(cache?.refreshedAt),attemptedAt:number(cache?.attemptedAt)});
  }
  function currentUserId(){
    return text(window.cu?.authUid||window.firebaseAuthUser?.uid||window.currentUser?.uid);
  }
  function sessionCache(){
    const userId=currentUserId();
    return userId&&sessionRecord?.userId===userId&&validCache(sessionRecord.cache)?sessionRecord.cache:null;
  }
  function keepSessionCache(cache){
    const userId=currentUserId();
    if(userId&&validCache(cache)) sessionRecord={userId,cache};
  }
  function attemptMarkerKey(attemptType='auto'){
    const userId=currentUserId();
    const prefix=attemptType==='manual'?MANUAL_ATTEMPT_MARKER_PREFIX:ATTEMPT_MARKER_PREFIX;
    return userId?`${prefix}:${userId}`:'';
  }
  function readAttemptMarker(periodKey,attemptType='auto'){
    const key=attemptMarkerKey(attemptType);
    if(!key) return null;
    try{
      const marker=JSON.parse(window.localStorage?.getItem(key)||'null');
      return marker?.periodKey===periodKey?marker:null;
    }catch(error){ return null; }
  }
  function writeAttemptMarker(periodKey,state,values={},attemptType='auto'){
    const key=attemptMarkerKey(attemptType);
    if(!key) return false;
    try{
      window.localStorage?.setItem(key,JSON.stringify({schemaVersion:1,periodKey,state,
        attemptedAt:number(values.attemptedAt)||Date.now(),refreshedAt:number(values.refreshedAt)}));
      return true;
    }catch(error){ return false; }
  }
  function markerStatus(marker,cache,periodKey){
    return Object.freeze({periodKey,state:marker?.state==='success'?'success':'failed',
      refreshedAt:number(cache?.refreshedAt)||number(marker?.refreshedAt),attemptedAt:number(marker?.attemptedAt)});
  }
  function cachedCalculations(orders,cache){
    const result=new Map();
    orders.forEach(order=>result.set(text(order.id),cache?.orders?.[text(order.id)]?.calculation||null));
    return result;
  }
  function refreshLockName(){
    return `pcms-order-production-progress:${currentUserId()||'anonymous'}`;
  }
  function withRefreshLock(task){
    const request=window.navigator?.locks?.request;
    if(typeof request!=='function'||typeof AbortController!=='function') return task();
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),LOCK_WAIT_TIMEOUT_MS);
    return request.call(window.navigator.locks,refreshLockName(),{signal:controller.signal},task)
      .finally(()=>clearTimeout(timer));
  }

  async function cachedResult(orders,reason='cached',marker=null){
    let cache=sessionCache();
    if(!validCache(cache)){
      try{ cache=await window.pcmsDataCache?.read(CACHE_SCOPE); }
      catch(error){ cache=null; }
    }
    if(validCache(cache)){
      keepSessionCache(cache);
    }
    lastStatus=marker?markerStatus(marker,cache,refreshPeriodKey()):cacheStatus(cache,refreshPeriodKey());
    return {values:cachedCalculations(orders,cache),attempted:false,reason};
  }

  function maySkipVersionRead(error){
    const code=text(error?.code).toLowerCase();
    return code.includes('permission-denied')||code.includes('failed-precondition');
  }

  async function loadVersionMap(orderIds,context){
    const result=new Map(orderIds.map(id=>[id,0]));
    try{
      await runBatches(chunks(orderIds,VERSION_QUERY_SIZE),context,async group=>{
        const snapshot=await remoteRead(()=>window._getDocs(window._query(window._collection(VERSION_COLLECTION),
          window._where('orderId','in',group))),context);
        documentRows(snapshot).forEach(row=>{ if(result.has(text(row.orderId))) result.set(text(row.orderId),progressVersion(row)); });
      });
      return {values:result,available:true};
    }catch(error){
      if(!maySkipVersionRead(error)) throw error;
      // 版本資料無法使用時停止本日更新，不得退回大量讀取正式累計。
      console.warn('Không thể đọc phiên bản tiến độ; dừng cập nhật hôm nay / 無法讀取進度版本，停止本日更新',error);
      return {values:result,available:false};
    }
  }

  async function loadItemSets(orderIds,context){
    const result=Object.fromEntries(orderIds.map(orderId=>[orderId,[]]));
    await runBatches(chunks(orderIds,VERSION_QUERY_SIZE),context,async group=>{
      const snapshot=await remoteRead(()=>window._getDocs(window._query(window._collection(ITEM_COLLECTION),
        window._where('orderId','in',group))),context);
      documentRows(snapshot).filter(item=>item.active!==false).forEach(item=>{
        const orderId=text(item.orderId);
        const normalized={orderItemId:text(item.orderItemId||item.id),productId:text(item.productId),quantity:positive(item.quantity)};
        if(result[orderId]&&normalized.orderItemId&&normalized.productId&&normalized.quantity>0) result[orderId].push(normalized);
      });
    });
    return result;
  }

  async function loadProducts(productIds,context){
    const result=Object.fromEntries(productIds.map(productId=>[productId,null]));
    await runBatches(chunks(productIds,TOTAL_QUERY_SIZE),context,async group=>{
      const snapshot=await remoteRead(()=>window._getDocs(window._query(window._collection(PRODUCT_COLLECTION),
        window._where(window._documentId(),'in',group))),context);
      documentRows(snapshot).forEach(data=>{
        if(!Object.prototype.hasOwnProperty.call(result,data.id)||data?.active===false) return;
        result[data.id]={...data,productId:data.id,ops:Array.isArray(data?.ops)?data.ops:[]};
      });
    });
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

  async function loadRegisteredQuantities(processes,context){
    const totalIds=[...new Set(processes.map(process=>text(process.totalId)).filter(Boolean))];
    const result=Object.fromEntries(totalIds.map(totalId=>[totalId,0]));
    await runBatches(chunks(totalIds,TOTAL_QUERY_SIZE),context,async group=>{
      const snapshot=await remoteRead(()=>window._getDocs(window._query(window._collection(TOTAL_COLLECTION),
        window._where(window._documentId(),'in',group))),context);
      documentRows(snapshot).forEach(row=>{
        if(Object.prototype.hasOwnProperty.call(result,row.id)) result[row.id]=positive(row.registeredQty);
      });
    });
    return result;
  }

  // 舊訂單可能已有累計但尚無進度版本；先按訂單小批量確認，無任何累計時可直接安全顯示 0%。
  async function loadLegacyQuantities(orderIds,processes,context){
    const allowedIds=new Set(processes.map(process=>text(process.totalId)).filter(Boolean));
    const quantities=Object.fromEntries([...allowedIds].map(totalId=>[totalId,0]));
    const ordersWithTotals=new Set();
    await runBatches(chunks(orderIds,VERSION_QUERY_SIZE),context,async group=>{
      const snapshot=await remoteRead(()=>window._getDocs(window._query(window._collection(TOTAL_COLLECTION),
        window._where('orderId','in',group))),context);
      documentRows(snapshot).forEach(row=>{
        ordersWithTotals.add(text(row.orderId));
        if(allowedIds.has(row.id)) quantities[row.id]=positive(row.registeredQty);
      });
    });
    return {quantities,ordersWithTotals};
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

  async function markRefreshFailure(orders,stored,periodKey,error,attemptType='auto'){
    const cache=validCache(stored)?stored:blankCache();
    cache.refreshPeriod=periodKey;
    cache.refreshState='failed';
    cache.attemptedAt=Date.now();
    keepSessionCache(cache);
    try{ await window.pcmsDataCache?.write(CACHE_SCOPE,`${periodKey}|failed`,cache); }
    catch(writeError){ console.warn('Không thể lưu trạng thái cập nhật / 無法保存更新狀態',writeError); }
    writeAttemptMarker(periodKey,'failed',cache,attemptType);
    lastStatus=cacheStatus(cache,periodKey);
    console.warn('Không thể cập nhật tiến độ; giữ dữ liệu lần trước / 進度更新失敗，保留上次資料',error);
    return {values:cachedCalculations(orders,cache),attempted:true,reason:'failed'};
  }

  async function loadInternal(orders,{attemptType='auto'}={}){
    const orderIds=orders.map(order=>text(order.id)).filter(Boolean);
    const periodKey=refreshPeriodKey();
    const manual=attemptType==='manual';
    if(!orderIds.length) return {values:new Map(),attempted:false,reason:'no-orders'};
    let persistentCache=null;
    try{ persistentCache=await window.pcmsDataCache?.read(CACHE_SCOPE); }
    catch(error){ return markRefreshFailure(orders,sessionCache(),periodKey,error,attemptType); }
    const memoryCache=sessionCache();
    const stored=validCache(memoryCache)&&memoryCache.refreshPeriod===periodKey
      ?memoryCache:(validCache(persistentCache)?persistentCache:memoryCache);
    const marker=readAttemptMarker(periodKey,attemptType);
    if(!manual&&marker&&validCache(stored)&&stored.refreshPeriod===periodKey){
      lastStatus=cacheStatus(stored,periodKey);
      return {values:cachedCalculations(orders,stored),attempted:false,reason:'cached'};
    }
    if(marker){
      lastStatus=markerStatus(marker,stored,periodKey);
      return {values:cachedCalculations(orders,stored),attempted:false,reason:'already-attempted'};
    }
    writeAttemptMarker(periodKey,'running',{attemptedAt:Date.now(),refreshedAt:stored?.refreshedAt},attemptType);
    const context=refreshContext();
    let metaSnapshot;
    let versionState;
    try{
      [metaSnapshot,versionState]=await Promise.all([
        remoteRead(()=>window._getDoc(window._docRef('system','productsMeta')),context),
        loadVersionMap(orderIds,context)
      ]);
    }catch(error){
      return markRefreshFailure(orders,stored,periodKey,error,attemptType);
    }
    if(!versionState.available){
      return markRefreshFailure(orders,stored,periodKey,new Error('order-progress-version-unavailable'),attemptType);
    }
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
    Object.assign(itemSets,await loadItemSets(ordersNeedingItems,context));
    const productIds=[...new Set(Object.values(itemSets).flat().map(item=>item.productId).filter(Boolean))];
    const productsNeedingLoad=productIds.filter(productId=>productsChanged||!Object.prototype.hasOwnProperty.call(next.products,productId));
    Object.assign(next.products,await loadProducts(productsNeedingLoad,context));

    const contexts=orders.map(order=>{
      const orderId=text(order.id);
      const currentOrderToken=orderToken(order);
      const currentRevision=versionState.values.get(orderId)||0;
      const cached=cache.orders[orderId];
      const processes=productionProcesses(itemSets[orderId],next.products);
      const structureChanged=!cached||cached.orderToken!==currentOrderToken||productsChanged;
      const productionChanged=!cached||number(cached.progressRevision)!==currentRevision;
      const registeredQuantities=!productionChanged&&cached?.registeredQuantities?{...cached.registeredQuantities}:null;
      const legacyProbe=!cached&&currentRevision===0;
      const knownNoProduction=currentRevision===0&&cached?.hasProductionData===false;
      const reloadAll=!legacyProbe&&!registeredQuantities||structureChanged&&productionChanged&&!legacyProbe;
      const missing=!legacyProbe&&!reloadAll&&structureChanged&&!knownNoProduction
        ?processes.filter(process=>!(process.totalId in registeredQuantities)):[];
      return {orderId,currentOrderToken,currentRevision,processes,registeredQuantities,reloadAll,missing,legacyProbe,
        hasProductionData:knownNoProduction?false:cached?.hasProductionData};
    });

    // 所有訂單共用批次讀取，最多三批並行，避免逐道請求或大量同時請求。
    const requestedProcesses=contexts.flatMap(context=>context.reloadAll?context.processes:context.missing);
    const legacyContexts=contexts.filter(item=>item.legacyProbe);
    const loadedQuantities=await loadRegisteredQuantities(requestedProcesses,context);
    const legacyState=await loadLegacyQuantities(legacyContexts.map(item=>item.orderId),
      legacyContexts.flatMap(item=>item.processes),context);
    const result=new Map();
    for(const item of contexts){
      let registeredQuantities=item.registeredQuantities;
      let hasProductionData=item.hasProductionData;
      if(item.legacyProbe){
        registeredQuantities=quantitiesFor(item.processes,legacyState.quantities);
        hasProductionData=legacyState.ordersWithTotals.has(item.orderId);
      }else if(item.reloadAll) registeredQuantities=quantitiesFor(item.processes,loadedQuantities);
      else if(item.missing.length) Object.assign(registeredQuantities,quantitiesFor(item.missing,loadedQuantities));
      const calculation=calculate(item.processes,registeredQuantities);
      next.orders[item.orderId]={orderToken:item.currentOrderToken,
        progressRevision:item.currentRevision,items:itemSets[item.orderId],hasProductionData,
        registeredQuantities,calculation};
      result.set(item.orderId,calculation);
    }
    next.refreshPeriod=periodKey;
    next.refreshState='success';
    next.refreshedAt=Date.now();
    next.attemptedAt=next.refreshedAt;
    keepSessionCache(next);
    let persisted=false;
    try{ persisted=await window.pcmsDataCache?.write(CACHE_SCOPE,`${periodKey}|${latestProductToken}`,next)===true; }
    catch(error){ console.warn('Không thể lưu bộ nhớ đệm tiến độ / 無法保存進度快取',error); }
    if(!persisted){
      next.refreshState='failed';
      keepSessionCache(next);
      writeAttemptMarker(periodKey,'failed',next,attemptType);
      console.warn('Không thể lưu bộ nhớ đệm tiến độ; không thử lại trong hôm nay / 無法保存進度快取，本日不再重試');
    }else{
      writeAttemptMarker(periodKey,'success',next,attemptType);
    }
    lastStatus=cacheStatus(next,periodKey);
    return {values:result,attempted:true,reason:persisted?'success':'failed'};
  }

  function executeLoad(orders,attemptType='auto'){
    const list=(Array.isArray(orders)?orders:[]).filter(order=>text(order?.id));
    if(!list.length) return Promise.resolve({values:new Map(),attempted:false,reason:'no-orders'});
    const periodKey=refreshPeriodKey();
    const key=`${currentUserId()}|${periodKey}|${attemptType}`;
    if(activePromises.has(key)) return activePromises.get(key);
    // 當期額度已使用時先讀本機結果，不得被另一類型的更新鎖拖住。
    const marker=readAttemptMarker(periodKey,attemptType);
    if(marker) return cachedResult(list,'already-attempted',marker);
    let promise;
    promise=withRefreshLock(async()=>{
      try{return await loadInternal(list,{attemptType});}
      catch(error){
        let stored=sessionCache();
        try{ stored=await window.pcmsDataCache?.read(CACHE_SCOPE)||stored; }
        catch(readError){ console.warn('Không thể đọc bộ nhớ đệm tiến độ / 無法讀取進度快取',readError); }
        return markRefreshFailure(list,stored,refreshPeriodKey(),error,attemptType);
      }
    }).catch(error=>{
      if(error?.name==='AbortError') return cachedResult(list,'busy');
      throw error;
    }).finally(()=>{
      if(activePromises.get(key)===promise) activePromises.delete(key);
    });
    activePromises.set(key,promise);
    return promise;
  }

  function load(orders){ return executeLoad(orders,'auto').then(result=>result.values); }
  function manualRefresh(orders){ return executeLoad(orders,'manual'); }
  function manualStatus(timestamp=Date.now()){
    const periodKey=refreshPeriodKey(timestamp);
    const marker=readAttemptMarker(periodKey,'manual');
    return Object.freeze({periodKey,available:!marker,state:text(marker?.state)||'available',
      attemptedAt:number(marker?.attemptedAt),refreshedAt:number(marker?.refreshedAt)});
  }

  function status(){ return lastStatus; }
  function clearSession(){
    activePromises.clear();sessionRecord=null;
    lastStatus=Object.freeze({periodKey:'',state:'idle',refreshedAt:0,attemptedAt:0});
  }
  function reset(){
    clearSession();
    [attemptMarkerKey('auto'),attemptMarkerKey('manual')].filter(Boolean).forEach(markerKey=>{
      try{ window.localStorage?.removeItem(markerKey); }catch(error){}
    });
    return window.pcmsDataCache?.remove(CACHE_SCOPE);
  }
  window.PCMSOrderProductionProgress=Object.freeze({load,manualRefresh,manualStatus,status,clearSession,reset,calculate,productionProcesses,orderToken,productToken,refreshPeriodKey});
})();
