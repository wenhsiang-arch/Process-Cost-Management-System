// usage-metrics（使用量統計）：記錄前端估算的雲端呼叫與快取命中，不保存業務資料內容。
(function(){
  'use strict';

  const FLUSH_INTERVAL_MS=15*60*1000;
  const STORAGE_KEY='pcms-usage-session-v1';
  const EMPTY_COUNTERS=Object.freeze({
    queryCount:0,documentReads:0,documentWrites:0,
    cacheHits:0,cacheMisses:0,cacheWrites:0,fullLoads:0
  });
  let identity=null;
  let session=null;
  let activePage='home';
  let dirty=false;
  let suppress=false;
  let flushTimer=null;
  let flushPromise=null;

  function text(value){ return String(value||'').trim(); }
  function today(){
    const value=new Date();
    const year=value.getFullYear();
    const month=String(value.getMonth()+1).padStart(2,'0');
    const day=String(value.getDate()).padStart(2,'0');
    return `${year}-${month}-${day}`;
  }
  function safeKey(value,fallback='other'){
    const normalized=text(value).replace(/[^A-Za-z0-9_-]/g,'-').slice(0,60);
    return normalized||fallback;
  }
  function counters(value={}){
    return Object.fromEntries(Object.keys(EMPTY_COUNTERS).map(key=>[key,Math.max(0,Number(value?.[key])||0)]));
  }
  function add(target,field,amount=1){
    if(!(field in EMPTY_COUNTERS)) return;
    target[field]=Math.max(0,(Number(target[field])||0)+(Number(amount)||0));
  }
  function sessionId(){
    const random=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return safeKey(random,'session');
  }
  function cacheGroup(scope){
    const value=text(scope);
    if(value.startsWith('productionEntries')) return 'productionEntries';
    if(value.startsWith('productionAttendance')) return 'productionAttendance';
    if(value.startsWith('productionAnalysis')) return 'productionAnalysis';
    if(value.startsWith('orderProcesses:')) return 'orderProcesses';
    return safeKey(value,'other');
  }
  function pageCounters(page){
    const key=safeKey(page,'other');
    session.pages[key]=counters(session.pages[key]);
    return session.pages[key];
  }
  function scopeCounters(scope){
    const key=cacheGroup(scope);
    session.cacheScopes[key]=counters(session.cacheScopes[key]);
    return session.cacheScopes[key];
  }
  function loadStored(uid){
    try{
      const parsed=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'null');
      if(parsed?.uid===uid&&parsed?.usageDate===today()&&parsed?.sessionId){
        return {
          ...parsed,
          totals:counters(parsed.totals),
          pages:parsed.pages&&typeof parsed.pages==='object'?parsed.pages:{},
          cacheScopes:parsed.cacheScopes&&typeof parsed.cacheScopes==='object'?parsed.cacheScopes:{}
        };
      }
    }catch(error){}
    return null;
  }
  function saveStored(){
    if(!session) return;
    try{ sessionStorage.setItem(STORAGE_KEY,JSON.stringify(session)); }
    catch(error){}
  }
  function markDirty(){ dirty=true; saveStored(); }
  function record(field,amount=1,page=activePage){
    if(!session||suppress) return;
    add(session.totals,field,amount);
    add(pageCounters(page),field,amount);
    markDirty();
  }
  function setPage(page){ activePage=safeKey(page,'home'); }

  function recordCloudRead(input={}){
    record('queryCount',Number(input.queryCount)||1,input.page);
    record('documentReads',Math.max(0,Number(input.documentReads)||0),input.page);
  }
  function recordCloudWrite(input={}){
    record('documentWrites',Math.max(1,Number(input.documentWrites)||1),input.page);
  }
  function recordCache(input={}){
    if(!session||suppress) return;
    const event=input.event;
    const field=event==='hit'?'cacheHits':event==='miss'?'cacheMisses':event==='write'?'cacheWrites':'';
    if(!field) return;
    add(session.totals,field,1);
    add(pageCounters(input.page||activePage),field,1);
    add(scopeCounters(input.scope),field,1);
    markDirty();
  }
  function recordFullLoad(input={}){ record('fullLoads',1,input.page); }

  function documentId(){ return `${session.usageDate}__${safeKey(identity.uid)}__${session.sessionId}`; }
  function payload(ended=false){
    return {
      sessionId:session.sessionId,
      usageDate:session.usageDate,
      uid:identity.uid,
      username:identity.username.slice(0,200),
      role:identity.role.slice(0,60),
      startedAt:session.startedAt,
      updatedAt:window._serverTimestamp(),
      endedAt:ended?Date.now():0,
      totals:counters(session.totals),
      pages:Object.fromEntries(Object.entries(session.pages).slice(0,30).map(([key,value])=>[safeKey(key),counters(value)])),
      cacheScopes:Object.fromEntries(Object.entries(session.cacheScopes).slice(0,30).map(([key,value])=>[safeKey(key),counters(value)])),
      schemaVersion:1
    };
  }
  async function flush(options={}){
    if(!session||!identity||!window._setDoc||!window._docRef||!window._serverTimestamp) return false;
    if(!dirty&&options.force!==true) return false;
    if(options.force!==true&&session.lastFlushedAt&&Date.now()-session.lastFlushedAt<FLUSH_INTERVAL_MS) return false;
    if(flushPromise) return flushPromise;
    flushPromise=(async()=>{
      suppress=true;
      try{
        await window._setDoc(window._docRef('systemUsageSessions',documentId()),payload(options.ended===true));
        dirty=false;
        session.lastFlushedAt=Date.now();
        saveStored();
        return true;
      }catch(error){
        console.warn('無法同步 systemUsageSessions（系統使用量工作階段）：',error);
        return false;
      }finally{
        suppress=false;
        flushPromise=null;
      }
    })();
    return flushPromise;
  }
  async function writeSessionLog(action,note=''){
    if(!identity||!window._setDoc||!window._newDocRef) return false;
    suppress=true;
    try{
      await window._setDoc(window._newDocRef('operationLogs'),{
        permissionKey:'systemMonitor',feature:'systemMonitor',action,status:'success',
        createdAt:Date.now(),createdByUid:identity.uid,createdBy:identity.username.slice(0,200),
        itemCount:0,detailCount:0,note:text(note).slice(0,500)
      });
      return true;
    }catch(error){
      console.warn('無法寫入登入／登出操作紀錄：',error);
      return false;
    }finally{ suppress=false; }
  }
  async function startSession(input={}){
    const uid=text(input.uid);
    if(!uid) return false;
    identity={uid,username:text(input.username||uid),role:text(input.role)};
    session=loadStored(uid)||{
      sessionId:sessionId(),usageDate:today(),uid,startedAt:Date.now(),lastFlushedAt:0,
      loginLogged:false,totals:counters(),pages:{},cacheScopes:{}
    };
    activePage='home';
    dirty=true;
    saveStored();
    if(!session.loginLogged){
      const logged=await writeSessionLog('userLogin','Đăng nhập hệ thống / 登入系統');
      if(logged){ session.loginLogged=true; saveStored(); }
    }
    clearInterval(flushTimer);
    flushTimer=setInterval(()=>{ void flush(); },FLUSH_INTERVAL_MS);
    return true;
  }
  async function endSession(reason='manual'){
    if(!session) return;
    await writeSessionLog('userLogout',reason==='idle'?'Tự động đăng xuất / 自動登出':'Đăng xuất / 登出');
    await flush({force:true,ended:true});
    clearInterval(flushTimer);
    flushTimer=null;
    try{ sessionStorage.removeItem(STORAGE_KEY); }catch(error){}
    identity=null;
    session=null;
    dirty=false;
  }
  function localSnapshot(){
    return session?JSON.parse(JSON.stringify({
      sessionId:session.sessionId,usageDate:session.usageDate,startedAt:session.startedAt,
      totals:session.totals,pages:session.pages,cacheScopes:session.cacheScopes,lastFlushedAt:session.lastFlushedAt
    })):null;
  }

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden') void flush();
  });

  window.PCMSUsageMetrics=Object.freeze({
    startSession,endSession,flush,setPage,recordCloudRead,recordCloudWrite,
    recordCache,recordFullLoad,localSnapshot
  });
})();
