// analysis-store（生產分析資料存取程式）：按需分頁讀取歷史生產與考勤，並使用依 UID 隔離的本機快取。
(function(){
  'use strict';

  const CACHE_SCOPE='productionAnalysis'; // CACHE_SCOPE（生產分析快取範圍）
  const CACHE_SCHEMA='production-analysis-cache-v1';
  const PAGE_SIZE=200;
  let state={loaded:false,source:'',version:'',entries:[],attendance:[],employees:[],dataset:null,loadedAt:0};
  let loadPromise=null;

  function cloneRows(rows){ return rows.map(item=>({...item})); }
  function versionToken(data){
    return [CACHE_SCHEMA,data?.productionEntries||'0',data?.productionAttendance||'0',data?.productionEmployees||'0'].join('|');
  }
  async function readVersions(){
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
    const endVersions=await readVersions();
    const startToken=versionToken(startVersions);
    const endToken=versionToken(endVersions);
    if(startToken!==endToken&&retryCount<1) return loadCloudConsistently(endVersions,retryCount+1);
    return {entries,attendance,versions:endVersions,version:endToken};
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
      employeeCount:employees.length,finishedAt:state.loadedAt
    });
    return getState();
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
      if(options.force!==true&&window.pcmsDataCache){
        const cached=await window.pcmsDataCache.read(CACHE_SCOPE,expectedVersion);
        if(cached?.schema===CACHE_SCHEMA&&Array.isArray(cached.entries)&&Array.isArray(cached.attendance)){
          return buildState({source:'indexeddb',version:expectedVersion,entries:cached.entries,attendance:cached.attendance});
        }
      }
      const cloud=await loadCloudConsistently(versions);
      await window.pcmsDataCache?.write(CACHE_SCOPE,cloud.version,{
        schema:CACHE_SCHEMA,entries:cloud.entries,attendance:cloud.attendance,savedAt:Date.now()
      });
      return buildState({source:'cloud',version:cloud.version,entries:cloud.entries,attendance:cloud.attendance});
    })().finally(()=>{ loadPromise=null; });
    return loadPromise;
  }
  function getState(){
    return {
      ...state,entries:cloneRows(state.entries),attendance:cloneRows(state.attendance),employees:cloneRows(state.employees)
    };
  }
  function resetMemory(){
    state={loaded:false,source:'',version:'',entries:[],attendance:[],employees:[],dataset:null,loadedAt:0};
    loadPromise=null;
  }

  window.PCMSProductionAnalysisStore=Object.freeze({load,getState,resetMemory});
  window.loadProductionAnalysisData=options=>load(options);
})();
