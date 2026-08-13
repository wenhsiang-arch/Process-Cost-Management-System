// analysis-store（生產分析資料存取程式）：首次建立完整基準，之後只更新有變動的員工日期。
(function(){
  'use strict';

  const CACHE_SCOPE='productionAnalysis';
  const CACHE_SCHEMA='production-analysis-cache-v2';
  const PAGE_SIZE=200;
  const MAX_INCREMENTAL_DAYS=500;
  let state={loaded:false,source:'',version:'',entries:[],attendance:[],employees:[],dataset:null,loadedAt:0};
  let loadPromise=null;

  function cloneRows(rows){ return rows.map(item=>({...item})); }
  function rawVersions(data){
    return {
      productionEntries:String(data?.productionEntries||'0'),
      productionAttendance:String(data?.productionAttendance||'0'),
      productionEmployees:String(data?.productionEmployees||'0')
    };
  }
  function versionToken(data){
    const versions=rawVersions(data);
    return [CACHE_SCHEMA,versions.productionEntries,versions.productionAttendance,versions.productionEmployees].join('|');
  }
  function productionVersionsEqual(a,b){
    const first=rawVersions(a),second=rawVersions(b);
    return first.productionEntries===second.productionEntries
      && first.productionAttendance===second.productionAttendance;
  }
  async function readVersions(force=false){
    if(window.firebaseReadDataVersions){
      const versionState=await window.firebaseReadDataVersions([
        'productionEntries','productionAttendance','productionEmployees'
      ],force);
      return versionState?.data||{};
    }
    const snapshot=await window._getDoc(window._docRef('system','dataVersions'));
    return snapshot.exists()?snapshot.data()||{}:{};
  }
  async function readAll(collectionName,dateField){
    const rows=[];
    let cursor=null;
    do{
      const conditions=[window._orderBy(dateField,'desc')];
      if(cursor) conditions.push(window._startAfter(cursor));
      conditions.push(window._limit(PAGE_SIZE));
      const snapshot=await window._getDocs(window._query(window._collection(collectionName),...conditions));
      rows.push(...snapshot.docs.map(item=>({id:item.id,...item.data()})));
      cursor=snapshot.size===PAGE_SIZE?snapshot.docs[snapshot.docs.length-1]:null;
    }while(cursor);
    return rows;
  }
  async function loadCloudConsistently(startVersions,retryCount=0){
    const [entries,attendance]=await Promise.all([
      readAll('productionEntries','productionDate'),
      readAll('productionAttendance','attendanceDate')
    ]);
    const endVersions=await readVersions(true);
    if(!productionVersionsEqual(startVersions,endVersions)&&retryCount<1){
      return loadCloudConsistently(endVersions,retryCount+1);
    }
    let cursorMs=0;
    try{ cursorMs=await window.PCMSProductionChanges?.latestCursor?.()||0; }
    catch(error){ console.warn('無法讀取產能日期變動索引，已保留完整分析基準：',error); }
    return {entries,attendance,versions:rawVersions(endVersions),version:versionToken(endVersions),cursorMs};
  }
  function buildState(input){
    const employees=window.PCMSProductionEmployees?.list?.()||[];
    const dataset=window.PCMSProductionAnalysisCalculations.buildDataset({
      entries:input.entries,attendance:input.attendance,employees
    });
    state={
      loaded:true,source:input.source,version:input.version,
      entries:cloneRows(input.entries),attendance:cloneRows(input.attendance),
      employees:cloneRows(employees),dataset,loadedAt:Date.now()
    };
    window.lastProductionAnalysisReadMetrics=Object.freeze({
      source:input.source,entryCount:input.entries.length,attendanceCount:input.attendance.length,
      changedDayCount:Number(input.changedDayCount)||0,employeeCount:employees.length,finishedAt:state.loadedAt
    });
    return getState();
  }
  async function readEmployeeDay(employeeId,productionDate){
    const entries=[];
    let cursor=null;
    do{
      const conditions=[
        window._where('employeeId','==',employeeId),
        window._where('productionDate','==',productionDate)
      ];
      if(cursor) conditions.push(window._startAfter(cursor));
      conditions.push(window._limit(PAGE_SIZE));
      const snapshot=await window._getDocs(window._query(window._collection('productionEntries'),...conditions));
      entries.push(...snapshot.docs.map(item=>({id:item.id,...item.data()})));
      cursor=snapshot.size===PAGE_SIZE?snapshot.docs[snapshot.docs.length-1]:null;
    }while(cursor);
    const attendanceId=window.PCMSProductionAttendance?.attendanceDocumentId?.(productionDate,employeeId)
      || `${productionDate}__${employeeId}`;
    const attendanceSnapshot=await window._getDoc(window._docRef('productionAttendance',attendanceId));
    const attendance=attendanceSnapshot.exists()?{id:attendanceSnapshot.id,...attendanceSnapshot.data()}:null;
    return {employeeId,productionDate,entries,attendance};
  }
  async function readChangedDays(pairs){
    const results=[];
    for(let index=0;index<pairs.length;index+=10){
      results.push(...await Promise.all(pairs.slice(index,index+10).map(item=>readEmployeeDay(item.employeeId,item.productionDate))));
    }
    return results;
  }
  function applyChangedDays(cached,changedDays){
    const keys=new Set(changedDays.map(item=>`${item.productionDate}|${item.employeeId}`));
    const entries=(cached.entries||[]).filter(item=>!keys.has(`${item.productionDate}|${item.employeeId}`));
    const attendance=(cached.attendance||[]).filter(item=>!keys.has(`${item.attendanceDate}|${item.employeeId}`));
    changedDays.forEach(item=>{
      entries.push(...item.entries);
      if(item.attendance) attendance.push(item.attendance);
    });
    return {entries,attendance};
  }
  async function tryIncremental(cached,currentVersions){
    if(!window.PCMSProductionChanges?.loadSince||!Number.isFinite(Number(cached.cursorMs))) return null;
    const changes=await window.PCMSProductionChanges.loadSince(cached.cursorMs);
    if(!changes.hasNew) return null;
    const unique=new Map();
    changes.rows.forEach(item=>{
      const productionDate=String(item.productionDate||'');
      const employeeId=String(item.employeeId||'');
      if(productionDate&&employeeId) unique.set(`${productionDate}|${employeeId}`,{productionDate,employeeId});
    });
    const pairs=[...unique.values()];
    if(!pairs.length||pairs.length>MAX_INCREMENTAL_DAYS) return null;
    const changedDays=await readChangedDays(pairs);
    const working=applyChangedDays(cached,changedDays);
    const latest=await readVersions(true);
    // 增量讀取期間若資料版本再次改變，標記可能尚未完成，直接完整重讀以免漏掉剛發生的異動。
    if(!productionVersionsEqual(currentVersions,latest)) return null;
    return {
      ...working,versions:rawVersions(latest),version:versionToken(latest),
      cursorMs:Math.max(Number(cached.cursorMs)||0,Number(changes.cursorMs)||0),
      changedDayCount:pairs.length
    };
  }
  async function saveCache(input){
    await window.pcmsDataCache?.write(CACHE_SCOPE,input.version,{
      schema:CACHE_SCHEMA,
      versions:rawVersions(input.versions),
      entries:input.entries,
      attendance:input.attendance,
      cursorMs:Number(input.cursorMs)||0,
      savedAt:Date.now()
    });
  }
  async function load(options={}){
    if(options.force!==true&&state.loaded&&Date.now()-state.loadedAt<5000) return getState();
    if(loadPromise) return loadPromise;
    loadPromise=(async()=>{
      if(!window.PCMSProductionEmployees?.load) throw new Error('Dữ liệu nhân viên chưa sẵn sàng. / 員工資料尚未就緒。');
      await window.PCMSProductionEmployees.load({force:options.force===true});
      const versions=await readVersions();
      const expectedVersion=versionToken(versions);
      if(options.force!==true&&state.loaded&&state.version===expectedVersion) return getState();
      if(options.force===true) await window.pcmsDataCache?.remove(CACHE_SCOPE);

      const cacheEntry=options.force===true?null:await window.pcmsDataCache?.readEntry?.(CACHE_SCOPE);
      const cached=cacheEntry?.data;
      if(cached?.schema===CACHE_SCHEMA&&Array.isArray(cached.entries)&&Array.isArray(cached.attendance)){
        if(productionVersionsEqual(cached.versions,versions)){
          const refreshed={...cached,versions:rawVersions(versions),version:expectedVersion};
          await saveCache(refreshed);
          return buildState({source:'indexeddb',version:expectedVersion,entries:cached.entries,attendance:cached.attendance});
        }
        try{
          const incremental=await tryIncremental(cached,versions);
          if(incremental){
            await saveCache(incremental);
            return buildState({
              source:'incremental',version:incremental.version,entries:incremental.entries,
              attendance:incremental.attendance,changedDayCount:incremental.changedDayCount
            });
          }
        }catch(error){
          console.warn('生產分析增量更新失敗，改用完整更新：',error);
        }
      }

      const cloud=await loadCloudConsistently(versions);
      window.PCMSUsageMetrics?.recordFullLoad?.({scope:CACHE_SCOPE});
      await saveCache(cloud);
      return buildState({source:'cloud',version:cloud.version,entries:cloud.entries,attendance:cloud.attendance});
    })().finally(()=>{ loadPromise=null; });
    return loadPromise;
  }
  function getState(){
    return {...state,entries:cloneRows(state.entries),attendance:cloneRows(state.attendance),employees:cloneRows(state.employees)};
  }
  function resetMemory(){
    state={loaded:false,source:'',version:'',entries:[],attendance:[],employees:[],dataset:null,loadedAt:0};
    loadPromise=null;
  }

  window.PCMSProductionAnalysisStore=Object.freeze({load,getState,resetMemory});
  window.loadProductionAnalysisData=options=>load(options);
})();
