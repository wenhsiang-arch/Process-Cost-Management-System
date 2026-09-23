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
  const REFRESH_TIME_ZONE='Asia/Taipei';
  const REFRESH_HOUR=6;
  const REFRESH_SHIFT_MS=REFRESH_HOUR*60*60*1000;
  const ATTEMPT_MARKER_PREFIX='pcms-order-production-progress-attempt-v1';
  const MANUAL_ATTEMPT_MARKER_PREFIX='pcms-order-production-progress-manual-attempt-v1';
  const activePromises=new Map();
  let sessionRecord=null;
  let lastStatus=Object.freeze({periodKey:'',state:'idle',refreshedAt:0,attemptedAt:0});

  function blankReadStats(){
    return {metaDocuments:0,versionDocuments:0,itemDocuments:0,productDocuments:0,totalDocuments:0,
      legacyTotalDocuments:0,versionQueries:0,itemQueries:0,productQueries:0,totalQueries:0,legacyTotalQueries:0,
      estimatedReads:0};
  }
  function copyReadStats(value={}){
    const result=blankReadStats();
    Object.keys(result).forEach(key=>{ result[key]=Math.max(0,Math.trunc(number(value?.[key]))); });
    return result;
  }
  function countSnapshot(stats,documentKey,queryKey,snapshot){
    stats[queryKey]+=1;
    const documents=(snapshot?.docs||[]).length;
    stats[documentKey]+=documents;
    stats.estimatedReads+=Math.max(1,documents);
    return snapshot;
  }

  function text(value){ return String(value??'').trim(); }
  function number(value){ const result=Number(value); return Number.isFinite(result)?result:0; }
  function positive(value){ return Math.max(0,number(value)); }
  function documentRows(snapshot){ return (snapshot?.docs||[]).map(item=>({id:item.id,...item.data()})); }
  function chunks(items,size){
    const result=[];
    for(let index=0;index<items.length;index+=size) result.push(items.slice(index,index+size));
    return result;
  }
  async function runBatches(groups,worker,progress=null){
    progress?.addTotal(groups.length);
    let nextIndex=0;
    let stopped=false;
    const runners=Array.from({length:Math.min(QUERY_CONCURRENCY,groups.length)},async()=>{
      while(!stopped){
        const index=nextIndex++;
        if(index>=groups.length) return;
        try{ await worker(groups[index]);progress?.advance(); }
        catch(error){ stopped=true;throw error; }
      }
    });
    await Promise.all(runners);
  }
  function createProgressReporter(callback){
    const notify=typeof callback==='function'?callback:null;
    let phase='';
    let startedAt=0;
    let completed=0;
    let total=0;
    function emit(state='running'){
      if(!notify) return;
      try{ notify(Object.freeze({state,phase,completed,total,startedAt,reportedAt:Date.now(),
        elapsedMs:startedAt?Math.max(0,Date.now()-startedAt):0})); }
      catch(error){ console.warn('Không thể hiển thị trạng thái cập nhật / 無法顯示更新狀態',error); }
    }
    return Object.freeze({
      start(nextPhase,initialTotal=0){
        phase=text(nextPhase);startedAt=Date.now();completed=0;total=Math.max(0,Math.trunc(number(initialTotal)));emit();
      },
      addTotal(value){ total+=Math.max(0,Math.trunc(number(value)));emit(); },
      advance(value=1){ completed=Math.min(total,completed+Math.max(0,Math.trunc(number(value))));emit(); },
      finish(){ if(total===0){total=1;completed=1;}else completed=total;emit(); },
      done(){ phase='complete';startedAt=Date.now();completed=1;total=1;emit('complete'); },
      fail(){ emit('failed'); }
    });
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
    return {schemaVersion:CACHE_SCHEMA_VERSION,productToken:'',productSequence:0,productTrackingEpoch:'',products:{},orders:{},
      refreshPeriod:'',refreshState:'idle',refreshedAt:0,attemptedAt:0,readStats:blankReadStats()};
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
      refreshedAt:number(cache?.refreshedAt),attemptedAt:number(cache?.attemptedAt),readStats:copyReadStats(cache?.readStats)});
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
      refreshedAt:number(cache?.refreshedAt)||number(marker?.refreshedAt),attemptedAt:number(marker?.attemptedAt),
      readStats:copyReadStats(cache?.readStats)});
  }
  function isCompletedOrder(order){ return order?.productionProgressCompleted===true; }
  function completedCalculation(order,cachedCalculation=null){
    const snapshot=Math.round(Math.max(0,Math.min(100,number(order?.productionProgressSnapshotPercent)))*10)/10;
    return {...(cachedCalculation||calculate([],{})),percent:snapshot,completed:true,completionPercent:100};
  }
  function cachedCalculations(orders,cache){
    const result=new Map();
    orders.forEach(order=>{
      const cached=cache?.orders?.[text(order.id)]?.calculation||null;
      result.set(text(order.id),isCompletedOrder(order)?completedCalculation(order,cached):cached);
    });
    return result;
  }
  function refreshLockName(){
    return `pcms-order-production-progress:${currentUserId()||'anonymous'}`;
  }
  function withRefreshLock(task){
    const request=window.navigator?.locks?.request;
    return typeof request==='function'?request.call(window.navigator.locks,refreshLockName(),task):task();
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

  async function loadVersionMap(orderIds,stats,progress=null){
    const result=new Map(orderIds.map(id=>[id,{revision:0,updatedAt:0}]));
    try{
      await runBatches(chunks(orderIds,VERSION_QUERY_SIZE),async group=>{
        const snapshot=await window._getDocs(window._query(window._collection(VERSION_COLLECTION),
          window._where('orderId','in',group)));
        countSnapshot(stats,'versionDocuments','versionQueries',snapshot);
        documentRows(snapshot).forEach(row=>{
          if(result.has(text(row.orderId))) result.set(text(row.orderId),{revision:progressVersion(row),updatedAt:positive(row.updatedAt)});
        });
      },progress);
      return {values:result,available:true};
    }catch(error){
      if(!maySkipVersionRead(error)) throw error;
      // 版本資料無法使用時停止本日更新，不得退回大量讀取正式累計。
      console.warn('Không thể đọc phiên bản tiến độ; dừng cập nhật hôm nay / 無法讀取進度版本，停止本日更新',error);
      return {values:result,available:false};
    }
  }

  async function loadItemSets(orderIds,stats,progress=null){
    const result=Object.fromEntries(orderIds.map(orderId=>[orderId,[]]));
    await runBatches(chunks(orderIds,VERSION_QUERY_SIZE),async group=>{
      const snapshot=await window._getDocs(window._query(window._collection(ITEM_COLLECTION),
        window._where('orderId','in',group)));
      countSnapshot(stats,'itemDocuments','itemQueries',snapshot);
      documentRows(snapshot).filter(item=>item.active!==false).forEach(item=>{
        const orderId=text(item.orderId);
        const normalized={orderItemId:text(item.orderItemId||item.id),productId:text(item.productId),quantity:positive(item.quantity)};
        if(result[orderId]&&normalized.orderItemId&&normalized.productId&&normalized.quantity>0) result[orderId].push(normalized);
      });
    },progress);
    return result;
  }

  async function loadProducts(productIds,stats,progress=null){
    const result=Object.fromEntries(productIds.map(productId=>[productId,null]));
    await runBatches(chunks(productIds,TOTAL_QUERY_SIZE),async group=>{
      const snapshot=await window._getDocs(window._query(window._collection(PRODUCT_COLLECTION),
        window._where(window._documentId(),'in',group)));
      countSnapshot(stats,'productDocuments','productQueries',snapshot);
      documentRows(snapshot).forEach(data=>{
        if(!Object.prototype.hasOwnProperty.call(result,data.id)||data?.active===false) return;
        result[data.id]={...data,productId:data.id,ops:Array.isArray(data?.ops)?data.ops:[]};
      });
    },progress);
    return result;
  }

  async function loadChangedProducts(afterSequence,stats){
    const snapshot=await window._getDocs(window._query(window._collection(PRODUCT_COLLECTION),
      window._where('changeSequence','>',Math.max(0,Math.trunc(number(afterSequence)))),
      window._orderBy('changeSequence','asc')));
    countSnapshot(stats,'productDocuments','productQueries',snapshot);
    return documentRows(snapshot).filter(data=>data?.active!==false)
      .map(data=>({...data,productId:data.id,ops:Array.isArray(data?.ops)?data.ops:[]}));
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

  async function loadRegisteredQuantities(processes,stats,progress=null){
    const totalIds=[...new Set(processes.map(process=>text(process.totalId)).filter(Boolean))];
    const result=Object.fromEntries(totalIds.map(totalId=>[totalId,0]));
    await runBatches(chunks(totalIds,TOTAL_QUERY_SIZE),async group=>{
      const snapshot=await window._getDocs(window._query(window._collection(TOTAL_COLLECTION),
        window._where(window._documentId(),'in',group)));
      countSnapshot(stats,'totalDocuments','totalQueries',snapshot);
      documentRows(snapshot).forEach(row=>{
        if(Object.prototype.hasOwnProperty.call(result,row.id)) result[row.id]=positive(row.registeredQty);
      });
    },progress);
    return result;
  }


  async function loadChangedQuantities(ranges,stats,progress=null){
    const result={};
    await runBatches(ranges,async range=>{
      const snapshot=await window._getDocs(window._query(window._collection(TOTAL_COLLECTION),
        window._where('orderId','==',range.orderId),window._where('updatedAt','>',range.afterUpdatedAt),
        window._orderBy('updatedAt','asc')));
      countSnapshot(stats,'totalDocuments','totalQueries',snapshot);
      documentRows(snapshot).forEach(row=>{ result[row.id]=positive(row.registeredQty); });
    },progress);
    return result;
  }

  // 舊訂單可能已有累計但尚無進度版本；先按訂單小批量確認，無任何累計時可直接安全顯示 0%。
  async function loadLegacyQuantities(orderIds,processes,stats,progress=null){
    const allowedIds=new Set(processes.map(process=>text(process.totalId)).filter(Boolean));
    const quantities=Object.fromEntries([...allowedIds].map(totalId=>[totalId,0]));
    const ordersWithTotals=new Set();
    await runBatches(chunks(orderIds,VERSION_QUERY_SIZE),async group=>{
      const snapshot=await window._getDocs(window._query(window._collection(TOTAL_COLLECTION),
        window._where('orderId','in',group)));
      countSnapshot(stats,'legacyTotalDocuments','legacyTotalQueries',snapshot);
      documentRows(snapshot).forEach(row=>{
        ordersWithTotals.add(text(row.orderId));
        if(allowedIds.has(row.id)) quantities[row.id]=positive(row.registeredQty);
      });
    },progress);
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

  async function markRefreshFailure(orders,stored,periodKey,error,attemptType='auto',readStats=null,progress=null){
    progress?.fail();
    const cache=validCache(stored)?stored:blankCache();
    cache.refreshPeriod=periodKey;
    cache.refreshState='failed';
    cache.attemptedAt=Date.now();
    if(readStats) cache.readStats=copyReadStats(readStats);
    keepSessionCache(cache);
    try{ await window.pcmsDataCache?.write(CACHE_SCOPE,`${periodKey}|failed`,cache); }
    catch(writeError){ console.warn('Không thể lưu trạng thái cập nhật / 無法保存更新狀態',writeError); }
    writeAttemptMarker(periodKey,'failed',cache,attemptType);
    lastStatus=cacheStatus(cache,periodKey);
    console.warn('Không thể cập nhật tiến độ; giữ dữ liệu lần trước / 進度更新失敗，保留上次資料',error);
    return {values:cachedCalculations(orders,cache),attempted:true,reason:'failed'};
  }

  async function loadInternal(orders,{attemptType='auto',progress=null}={}){
    const trackedOrders=orders.filter(order=>!isCompletedOrder(order));
    const orderIds=trackedOrders.map(order=>text(order.id)).filter(Boolean);
    const periodKey=refreshPeriodKey();
    const manual=attemptType==='manual';
    const readStats=blankReadStats();
    if(!orderIds.length) return {values:cachedCalculations(orders,sessionCache()),attempted:false,reason:'no-orders'};
    let persistentCache=null;
    try{ persistentCache=await window.pcmsDataCache?.read(CACHE_SCOPE); }
    catch(error){ return markRefreshFailure(orders,sessionCache(),periodKey,error,attemptType,readStats,progress); }
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
    progress?.start('checkingVersions');
    progress?.addTotal(1);
    let metaSnapshot;
    let versionState;
    try{
      [metaSnapshot,versionState]=await Promise.all([
        window._getDoc(window._docRef('system','productsMeta')).then(snapshot=>{progress?.advance();return snapshot;}),
        loadVersionMap(orderIds,readStats,progress)
      ]);
      readStats.metaDocuments=metaSnapshot.exists()?1:0;
      readStats.estimatedReads+=1;
    }catch(error){
      return markRefreshFailure(orders,stored,periodKey,error,attemptType,readStats,progress);
    }
    if(!versionState.available){
      return markRefreshFailure(orders,stored,periodKey,new Error('order-progress-version-unavailable'),attemptType,readStats,progress);
    }
    progress?.finish();
    const cache=validCache(stored)?stored:blankCache();
    const next=blankCache();
    const latestProductToken=productToken(metaSnapshot.exists()?metaSnapshot.data():{});
    const latestMeta=metaSnapshot.exists()?metaSnapshot.data():{};
    const latestProductSequence=Math.max(0,Math.trunc(number(latestMeta.changeSequence)));
    const latestTrackingEpoch=text(latestMeta.trackingEpoch);
    const productsChanged=cache.productToken!==latestProductToken;
    next.productToken=latestProductToken;
    next.productSequence=latestProductSequence;
    next.productTrackingEpoch=latestTrackingEpoch;
    next.products={...cache.products};

    const cachedProductSequence=Math.max(0,Math.trunc(number(cache.productSequence)));
    const canLoadProductDelta=productsChanged&&cachedProductSequence>0&&cachedProductSequence<=latestProductSequence
      &&text(cache.productTrackingEpoch)&&text(cache.productTrackingEpoch)===latestTrackingEpoch;
    progress?.start('checkingProducts',1);
    if(canLoadProductDelta){
      const changed=await loadChangedProducts(cachedProductSequence,readStats);
      changed.forEach(product=>{
        next.products[product.productId]=product;
      });
    }
    progress?.advance();

    progress?.start('loadingProcesses');
    const itemSets={};
    const ordersNeedingItems=[];
    for(const order of trackedOrders){
      const orderId=text(order.id);
      const cached=cache.orders[orderId];
      const currentOrderToken=orderToken(order);
      if(cached&&cached.orderToken===currentOrderToken&&Array.isArray(cached.items)) itemSets[orderId]=cached.items;
      else ordersNeedingItems.push(orderId);
    }
    Object.assign(itemSets,await loadItemSets(ordersNeedingItems,readStats,progress));
    const productIds=[...new Set(Object.values(itemSets).flat().map(item=>item.productId).filter(Boolean))];
    const productsNeedingLoad=productIds.filter(productId=>(productsChanged&&!canLoadProductDelta)
      ||!Object.prototype.hasOwnProperty.call(next.products,productId));
    const loadedProducts=await loadProducts(productsNeedingLoad,readStats,progress);
    Object.assign(next.products,loadedProducts);
    progress?.finish();

    function processToken(processes){
      return processes.map(item=>[item.totalId,item.productId,item.processId,item.orderQty,item.seconds].join('|')).sort().join('||');
    }

    const contexts=trackedOrders.map(order=>{
      const orderId=text(order.id);
      const currentOrderToken=orderToken(order);
      const currentVersion=versionState.values.get(orderId)||{revision:0,updatedAt:0};
      const currentRevision=currentVersion.revision;
      const cached=cache.orders[orderId];
      const processes=productionProcesses(itemSets[orderId],next.products);
      const previousProcesses=cached?productionProcesses(cached.items||[],cache.products||{}):[];
      const structureChanged=!cached||cached.orderToken!==currentOrderToken||processToken(previousProcesses)!==processToken(processes);
      const productionChanged=!cached||number(cached.progressRevision)!==currentRevision
        ||number(cached.progressUpdatedAt)!==number(currentVersion.updatedAt);
      const registeredQuantities=!productionChanged&&cached?.registeredQuantities?{...cached.registeredQuantities}:null;
      const legacyProbe=!cached&&currentRevision===0;
      const knownNoProduction=currentRevision===0&&cached?.hasProductionData===false;
      const canLoadTotalDelta=Boolean(cached&&productionChanged&&number(cached.progressUpdatedAt)>0
        &&number(currentVersion.updatedAt)>number(cached.progressUpdatedAt)&&cached.registeredQuantities);
      const reloadAll=!legacyProbe&&productionChanged&&!canLoadTotalDelta;
      const baseQuantities=registeredQuantities||(!reloadAll&&cached?.registeredQuantities?{...cached.registeredQuantities}:null);
      const missing=!legacyProbe&&!reloadAll&&structureChanged&&!knownNoProduction
        ?processes.filter(process=>!baseQuantities||!(process.totalId in baseQuantities)):[];
      return {orderId,currentOrderToken,currentRevision,currentUpdatedAt:number(currentVersion.updatedAt),processes,
        registeredQuantities:baseQuantities,reloadAll,missing,legacyProbe,canLoadTotalDelta,
        deltaAfterUpdatedAt:number(cached?.progressUpdatedAt),
        hasProductionData:knownNoProduction?false:cached?.hasProductionData};
    });

    // 所有訂單共用批次讀取，最多三批並行，避免逐道請求或大量同時請求。
    const requestedProcesses=contexts.flatMap(context=>context.reloadAll?context.processes:context.missing);
    const changedRanges=contexts.filter(context=>context.canLoadTotalDelta)
      .map(context=>({orderId:context.orderId,afterUpdatedAt:context.deltaAfterUpdatedAt}));
    const legacyContexts=contexts.filter(item=>item.legacyProbe);
    progress?.start('loadingTotals');
    const loadedQuantities=await loadRegisteredQuantities(requestedProcesses,readStats,progress);
    let changedQuantities={};
    let deltaIndexAvailable=true;
    try{ changedQuantities=await loadChangedQuantities(changedRanges,readStats,progress); }
    catch(error){
      if(!text(error?.code).toLowerCase().includes('failed-precondition')) throw error;
      deltaIndexAvailable=false;
      console.warn('Chỉ mục cập nhật tiến độ chưa sẵn sàng; dùng cách đọc đầy đủ / 進度增量索引尚未可用，改用完整讀取');
      const fallbackProcesses=contexts.filter(context=>context.canLoadTotalDelta).flatMap(context=>context.processes);
      Object.assign(loadedQuantities,await loadRegisteredQuantities(fallbackProcesses,readStats,progress));
    }
    progress?.finish();
    progress?.start('processingLegacy');
    const legacyState=await loadLegacyQuantities(legacyContexts.map(item=>item.orderId),
      legacyContexts.flatMap(item=>item.processes),readStats,progress);
    progress?.finish();
    progress?.start('calculating',Math.max(1,contexts.length));
    const result=new Map();
    for(const item of contexts){
      let registeredQuantities=item.registeredQuantities;
      let hasProductionData=item.hasProductionData;
      if(item.legacyProbe){
        registeredQuantities=quantitiesFor(item.processes,legacyState.quantities);
        hasProductionData=legacyState.ordersWithTotals.has(item.orderId);
      }else if(item.reloadAll||item.canLoadTotalDelta&&!deltaIndexAvailable){
        registeredQuantities=quantitiesFor(item.processes,loadedQuantities);
      }
      else{
        if(item.canLoadTotalDelta) Object.assign(registeredQuantities,changedQuantities);
        if(item.missing.length) Object.assign(registeredQuantities,quantitiesFor(item.missing,loadedQuantities));
      }
      const calculation=calculate(item.processes,registeredQuantities);
      next.orders[item.orderId]={orderToken:item.currentOrderToken,
        progressRevision:item.currentRevision,progressUpdatedAt:item.currentUpdatedAt,items:itemSets[item.orderId],hasProductionData,
        registeredQuantities,calculation};
      result.set(item.orderId,calculation);
      progress?.advance();
    }
    progress?.finish();
    orders.filter(isCompletedOrder).forEach(order=>{
      const orderId=text(order.id);
      const cachedOrder=cache.orders[orderId];
      if(cachedOrder) next.orders[orderId]=cachedOrder;
      result.set(orderId,completedCalculation(order,cachedOrder?.calculation));
    });
    next.refreshPeriod=periodKey;
    next.refreshState='success';
    next.refreshedAt=Date.now();
    next.attemptedAt=next.refreshedAt;
    next.readStats=copyReadStats(readStats);
    console.info('Thống kê đọc tiến độ đơn hàng / 訂單進度讀取統計',copyReadStats(readStats));
    keepSessionCache(next);
    progress?.start('savingCache',1);
    let persisted=false;
    try{ persisted=await window.pcmsDataCache?.write(CACHE_SCOPE,`${periodKey}|${latestProductToken}`,next)===true; }
    catch(error){ console.warn('Không thể lưu bộ nhớ đệm tiến độ / 無法保存進度快取',error); }
    progress?.advance();
    if(!persisted){
      next.refreshState='failed';
      keepSessionCache(next);
      writeAttemptMarker(periodKey,'failed',next,attemptType);
      console.warn('Không thể lưu bộ nhớ đệm tiến độ; không thử lại trong hôm nay / 無法保存進度快取，本日不再重試');
    }else{
      writeAttemptMarker(periodKey,'success',next,attemptType);
    }
    lastStatus=cacheStatus(next,periodKey);
    if(persisted) progress?.done();
    else progress?.fail();
    return {values:result,attempted:true,reason:persisted?'success':'failed'};
  }

  function executeLoad(orders,attemptType='auto',options={}){
    const list=(Array.isArray(orders)?orders:[]).filter(order=>text(order?.id));
    if(!list.length) return Promise.resolve({values:new Map(),attempted:false,reason:'no-orders'});
    const periodKey=refreshPeriodKey();
    const key=`${currentUserId()}|${periodKey}|${attemptType}`;
    const listener=typeof options?.onProgress==='function'?options.onProgress:null;
    const active=activePromises.get(key);
    if(active){
      if(listener){
        active.listeners.add(listener);
        if(active.lastEvent){
          try{ listener(active.lastEvent); }
          catch(error){ console.warn('Không thể hiển thị trạng thái cập nhật / 無法顯示更新狀態',error); }
        }
      }
      return active.promise;
    }
    // 當期額度已使用時先讀本機結果，不得被另一類型的更新鎖拖住。
    const marker=readAttemptMarker(periodKey,attemptType);
    if(marker) return cachedResult(list,'already-attempted',marker);
    const work={promise:null,listeners:new Set(listener?[listener]:[]),lastEvent:null};
    const progress=createProgressReporter(event=>{
      work.lastEvent=event;
      work.listeners.forEach(callback=>{
        try{ callback(event); }
        catch(error){ console.warn('Không thể hiển thị trạng thái cập nhật / 無法顯示更新狀態',error); }
      });
    });
    let promise;
    promise=withRefreshLock(async()=>{
      try{return await loadInternal(list,{attemptType,progress});}
      catch(error){
        let stored=sessionCache();
        try{ stored=await window.pcmsDataCache?.read(CACHE_SCOPE)||stored; }
        catch(readError){ console.warn('Không thể đọc bộ nhớ đệm tiến độ / 無法讀取進度快取',readError); }
        return markRefreshFailure(list,stored,refreshPeriodKey(),error,attemptType,null,progress);
      }
    }).finally(()=>{
      if(activePromises.get(key)===work) activePromises.delete(key);
    });
    work.promise=promise;
    activePromises.set(key,work);
    return promise;
  }

  function load(orders,options={}){ return executeLoad(orders,'auto',options).then(result=>result.values); }
  function manualRefresh(orders,options={}){ return executeLoad(orders,'manual',options); }
  function manualStatus(timestamp=Date.now()){
    const periodKey=refreshPeriodKey(timestamp);
    const marker=readAttemptMarker(periodKey,'manual');
    return Object.freeze({periodKey,available:!marker,state:text(marker?.state)||'available',
      attemptedAt:number(marker?.attemptedAt),refreshedAt:number(marker?.refreshedAt)});
  }

  function status(){ return lastStatus; }
  function readStats(){ return copyReadStats(lastStatus?.readStats); }
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
  window.PCMSOrderProductionProgress=Object.freeze({load,manualRefresh,manualStatus,status,readStats,clearSession,reset,
    calculate,productionProcesses,orderToken,productToken,refreshPeriodKey,isCompletedOrder,completedCalculation});
})();
