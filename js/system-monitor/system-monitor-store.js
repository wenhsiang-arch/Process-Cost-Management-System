// system-monitor-store（系統監控資料存取程式）：分頁讀取全站日誌及使用量工作階段。
(function(){
  'use strict';

  const PAGE_SIZE=50;
  const states={logs:null,usage:null};

  function dateText(value){ return String(value||'').trim(); }
  function dateStart(value){
    const date=new Date(`${dateText(value)}T00:00:00`);
    return Number.isFinite(date.getTime())?date.getTime():0;
  }
  function dateEnd(value){
    const start=dateStart(value);
    return start?start+24*60*60*1000-1:0;
  }
  function signature(filters){ return `${dateText(filters?.from)}|${dateText(filters?.to)}`; }
  function createState(filters){ return {signature:signature(filters),rows:[],cursor:null,done:false,promise:null}; }
  function ensureAdmin(){
    if(window.cu?.role!=='admin') throw new Error('Chỉ quản trị viên mới xem được giám sát hệ thống. / 只有管理員可以查看系統監控。');
  }
  function resetIfNeeded(type,filters,force){
    if(force===true||!states[type]||states[type].signature!==signature(filters)) states[type]=createState(filters);
    return states[type];
  }
  function mergeRows(current,next){ return [...new Map([...current,...next].map(item=>[item.id,item])).values()]; }

  async function loadLogs(filters={},options={}){
    ensureAdmin();
    const state=resetIfNeeded('logs',filters,options.force===true);
    if(state.promise) return state.promise;
    if(state.rows.length&&options.loadMore!==true) return {rows:state.rows.slice(),hasMore:!state.done};
    if(state.done) return {rows:state.rows.slice(),hasMore:false};
    state.promise=(async()=>{
      const conditions=[];
      const from=dateStart(filters.from),to=dateEnd(filters.to);
      if(from) conditions.push(window._where('createdAt','>=',from));
      if(to) conditions.push(window._where('createdAt','<=',to));
      conditions.push(window._orderBy('createdAt','desc'));
      if(state.cursor) conditions.push(window._startAfter(state.cursor));
      conditions.push(window._limit(PAGE_SIZE));
      const snapshot=await window._getDocs(window._query(window._collection('operationLogs'),...conditions));
      state.cursor=snapshot.docs.at(-1)||state.cursor;
      state.done=snapshot.size<PAGE_SIZE;
      state.rows=mergeRows(state.rows,snapshot.docs.map(item=>({id:item.id,...item.data()})));
      return {rows:state.rows.slice(),hasMore:!state.done};
    })().finally(()=>{ state.promise=null; });
    return state.promise;
  }

  async function loadUsage(filters={},options={}){
    ensureAdmin();
    const state=resetIfNeeded('usage',filters,options.force===true);
    if(state.promise) return state.promise;
    if(state.rows.length&&options.loadMore!==true) return {rows:state.rows.slice(),hasMore:!state.done};
    if(state.done) return {rows:state.rows.slice(),hasMore:false};
    state.promise=(async()=>{
      const conditions=[];
      const from=dateText(filters.from),to=dateText(filters.to);
      if(from) conditions.push(window._where('usageDate','>=',from));
      if(to) conditions.push(window._where('usageDate','<=',to));
      conditions.push(window._orderBy('usageDate','desc'));
      if(state.cursor) conditions.push(window._startAfter(state.cursor));
      conditions.push(window._limit(PAGE_SIZE));
      const snapshot=await window._getDocs(window._query(window._collection('systemUsageSessions'),...conditions));
      state.cursor=snapshot.docs.at(-1)||state.cursor;
      state.done=snapshot.size<PAGE_SIZE;
      state.rows=mergeRows(state.rows,snapshot.docs.map(item=>({id:item.id,...item.data()})));
      return {rows:state.rows.slice(),hasMore:!state.done};
    })().finally(()=>{ state.promise=null; });
    return state.promise;
  }

  async function loadLocalCache(){
    const [entries,usage]=await Promise.all([
      window.pcmsDataCache?.inspect?.()||[],
      window.pcmsDataCache?.usage?.()||{usedBytes:0,maxBytes:0}
    ]);
    return {entries,usage,session:window.PCMSUsageMetrics?.localSnapshot?.()||null};
  }
  function reset(){ states.logs=null; states.usage=null; }

  window.PCMSSystemMonitorStore=Object.freeze({loadLogs,loadUsage,loadLocalCache,reset,pageSize:PAGE_SIZE});
})();
