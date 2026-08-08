// history（歷史紀錄共用程式）：統一操作紀錄、訂單調整紀錄、工作階段快取與游標分頁。
(function(){
  const DEFAULT_PAGE_SIZE = 50; // DEFAULT_PAGE_SIZE（預設每頁筆數）
  const MAX_PAGE_SIZE = 50; // MAX_PAGE_SIZE（單次查詢上限）
  const queryStates = new Map(); // queryStates（查詢狀態）：只保存在目前登入工作階段的記憶體。

  function normalizedPageSize(value){
    return Math.max(1,Math.min(MAX_PAGE_SIZE,Number(value)||DEFAULT_PAGE_SIZE));
  }

  function normalizedActions(actions){
    return [...new Set((Array.isArray(actions)?actions:[])
      .map(value=>String(value||'').trim())
      .filter(Boolean))].sort();
  }

  function queryStateKey(collectionName,permissionKey,actions){
    return `${collectionName}|${permissionKey||''}|${actions.join(',')}`;
  }

  function createQueryState(collectionName,permissionKey,actions,pageSize){
    return {
      collectionName,
      permissionKey,
      actions,
      pageSize,
      rows:[],
      cursor:null,
      pendingRows:[],
      loaded:false,
      done:false,
      useFallback:false,
      promise:null
    };
  }

  function getQueryState(collectionName,options={}){
    const permissionKey=String(options.permissionKey||'').trim();
    const actions=normalizedActions(options.actions);
    const key=queryStateKey(collectionName,permissionKey,actions); // key（工作階段查詢識別碼）
    if(!queryStates.has(key)){
      queryStates.set(key,createQueryState(
        collectionName,
        permissionKey,
        actions,
        normalizedPageSize(options.limit)
      ));
    }
    return queryStates.get(key);
  }

  function resetQueryState(state){
    state.rows=[];
    state.cursor=null;
    state.pendingRows=[];
    state.loaded=false;
    state.done=false;
    state.promise=null;
  }

  function operationLogCount(value){
    const count=Number(value);
    return Number.isInteger(count)&&count>=0?count:0;
  }

  function buildOperationLog(input){
    const currentUser=window.firebaseAuthUser; // currentUser（目前 Firebase 身分驗證使用者）
    if(!currentUser?.uid) throw new Error('Chưa xác nhận danh tính / 尚未完成身分驗證');
    const log={
      permissionKey:String(input?.permissionKey||''),
      feature:String(input?.feature||''),
      action:String(input?.action||''),
      status:['success','partial','failed'].includes(input?.status)?input.status:'success',
      createdAt:Date.now(),
      createdByUid:currentUser.uid,
      createdBy:String(window.cu?.user||currentUser.displayName||currentUser.email||currentUser.uid).slice(0,200),
      itemCount:operationLogCount(input?.itemCount),
      detailCount:operationLogCount(input?.detailCount)
    };
    if(input?.overwriteCount!==undefined) log.overwriteCount=operationLogCount(input.overwriteCount);
    if(input?.skippedCount!==undefined) log.skippedCount=operationLogCount(input.skippedCount);
    if(input?.fileName!==undefined) log.fileName=String(input.fileName||'').slice(0,300);
    if(input?.note!==undefined) log.note=String(input.note||'').slice(0,500);
    if(Array.isArray(input?.changes)){
      log.changes=input.changes.slice(0,50).map(change=>({
        field:String(change?.field??change?.f??'').slice(0,100),
        before:Number(change?.before??change?.b)||0,
        after:Number(change?.after??change?.a)||0,
        percent:change?.percent??change?.p??null
      }));
    }
    return log;
  }

  function stateMatchesOperationLog(state,log){
    return state.collectionName==='operationLogs'
      && state.loaded
      && state.permissionKey===String(log.permissionKey||'')
      && (!state.actions.length||state.actions.includes(String(log.action||'')));
  }

  function rememberOperationLog(log){
    queryStates.forEach(state=>{
      if(!stateMatchesOperationLog(state,log)) return;
      state.rows=[log,...state.rows.filter(item=>item?.id!==log.id)];
    });
  }

  async function saveOperationLog(input){
    if(typeof window._newDocRef!=='function'||typeof window._setDoc!=='function'){
      throw new Error('Chức năng lưu lịch sử chưa sẵn sàng / 歷史儲存功能尚未就緒');
    }
    const log=buildOperationLog(input);
    const reference=window._newDocRef('operationLogs'); // reference（新操作紀錄文件）
    await window._setDoc(reference,log,{merge:false});
    const saved={id:reference.id,...log};
    rememberOperationLog(saved);
    return saved;
  }

  function queryConstraints(state,{fallback=false}={}){
    const constraints=[];
    if(state.collectionName==='operationLogs'){
      constraints.push(window._where('permissionKey','==',state.permissionKey));
      if(!fallback&&state.actions.length===1){
        constraints.push(window._where('action','==',state.actions[0]));
      }else if(!fallback&&state.actions.length>1){
        constraints.push(window._where('action','in',state.actions.slice(0,10)));
      }
    }
    constraints.push(window._orderBy('createdAt','desc'));
    if(state.cursor) constraints.push(window._startAfter(state.cursor));
    constraints.push(window._limit(state.pageSize));
    return constraints;
  }

  async function requestSnapshot(state,{fallback=false}={}){
    const statement=window._query(
      window._collection(state.collectionName),
      ...queryConstraints(state,{fallback})
    ); // statement（歷史紀錄分頁查詢）
    return window._getDocs(statement);
  }

  function snapshotRows(snapshot){
    return snapshot.docs.map(item=>({id:item.id,...item.data()}));
  }

  async function fetchFilteredPage(state){
    try{
      const snapshot=await requestSnapshot(state);
      state.cursor=snapshot.docs.at(-1)||state.cursor;
      state.done=snapshot.size<state.pageSize;
      return snapshotRows(snapshot);
    }catch(error){
      const missingIndex=error?.code==='failed-precondition'&&state.collectionName==='operationLogs'&&state.actions.length;
      if(!missingIndex) throw error;
      console.warn('Chỉ mục lịch sử đang chờ triển khai, tạm dùng truy vấn tương thích. / 歷史索引尚待部署，暫用相容查詢。',error);
      state.useFallback=true;
      state.cursor=null;
      state.pendingRows=[];
      return fetchFallbackPage(state);
    }
  }

  async function fetchFallbackPage(state){
    const result=[];
    while(state.pendingRows.length&&result.length<state.pageSize){
      result.push(state.pendingRows.shift());
    }
    while(result.length<state.pageSize&&!state.done){
      const snapshot=await requestSnapshot(state,{fallback:true});
      if(snapshot.empty){
        state.done=true;
        break;
      }
      state.cursor=snapshot.docs.at(-1)||state.cursor;
      if(snapshot.size<state.pageSize) state.done=true;
      const matching=snapshotRows(snapshot).filter(row=>!state.actions.length||state.actions.includes(String(row.action||'')));
      const remaining=state.pageSize-result.length;
      result.push(...matching.slice(0,remaining));
      state.pendingRows.push(...matching.slice(remaining));
    }
    if(state.pendingRows.length) state.done=false;
    return result;
  }

  async function loadQueryState(state,options={}){
    if(state.promise) return state.promise;
    if(options.force===true) resetQueryState(state);
    if(state.loaded&&options.loadMore!==true) return state.rows.slice();
    if(state.loaded&&state.done&&!state.pendingRows.length) return state.rows.slice();
    state.promise=(async()=>{
      const nextRows=state.useFallback
        ? await fetchFallbackPage(state)
        : await fetchFilteredPage(state);
      const combined=state.loaded?[...state.rows,...nextRows]:nextRows;
      state.rows=[...new Map(combined.map(row=>[row.id,row])).values()];
      state.loaded=true;
      return state.rows.slice();
    })().finally(()=>{ state.promise=null; });
    return state.promise;
  }

  async function loadOperationLogs(options={}){
    const permissionKey=String(options.permissionKey||'').trim();
    if(!permissionKey) throw new Error('Thiếu phạm vi quyền lịch sử / 缺少歷史權限範圍');
    const state=getQueryState('operationLogs',{...options,permissionKey});
    return loadQueryState(state,options);
  }

  async function loadOrderAdjustments(options={}){
    const state=getQueryState('orderAdjustments',options);
    return loadQueryState(state,options);
  }

  function hasMore(collectionName,options={}){
    const state=getQueryState(collectionName,options);
    return !state.loaded||!state.done||state.pendingRows.length>0;
  }

  function invalidateCollection(collectionName){
    [...queryStates.entries()].forEach(([key,state])=>{
      if(state.collectionName===collectionName) queryStates.delete(key);
    });
  }

  function clearSession(){
    queryStates.clear();
  }

  async function ensureImportHistoryLoaded(options={}){
    window.impHist=await loadOperationLogs({
      ...options,
      force:options.force===true||options.background===true,
      permissionKey:'summary',
      actions:['productImport']
    });
    return window.impHist;
  }

  async function ensureCostLogLoaded(options={}){
    const role=window.cu?.role;
    const permissions=window.permissionSettings?.[role]; // permissions（目前角色權限）
    if(!window.isAdm?.()&&(permissions?.costMain!==true||permissions?.costlog!==true)){
      window.cLog=[];
      return window.cLog;
    }
    window.cLog=await loadOperationLogs({
      ...options,
      force:options.force===true||options.background===true,
      permissionKey:'costlog',
      actions:['costSettingsUpdate']
    });
    return window.cLog;
  }

  async function ensureCuttingHistoryLoaded(options={}){
    return loadOperationLogs({
      ...options,
      force:options.force===true||options.background===true,
      permissionKey:'cutting',
      actions:['cuttingTemplateImport','cuttingTemplateDelete','cuttingPdfExport']
    });
  }

  window.PCMSHistory=Object.freeze({
    saveOperationLog,
    loadOperationLogs,
    loadOrderAdjustments,
    hasMore,
    invalidateCollection,
    clearSession
  });
  window.saveOperationLogToFB=saveOperationLog;
  window.saveHistoryToFB=history=>saveOperationLog({
    permissionKey:'summary',
    feature:'products',
    action:'productImport',
    status:'success',
    itemCount:history?.c,
    detailCount:history?.o,
    overwriteCount:history?.ow,
    skippedCount:history?.sk,
    fileName:history?.fileName
  });
  window.saveCostLogToFB=costLog=>saveOperationLog({
    permissionKey:'costlog',
    feature:'cost',
    action:'costSettingsUpdate',
    status:'success',
    itemCount:costLog?.changeCount??(Array.isArray(costLog?.changes)?costLog.changes.length:0),
    detailCount:0,
    changes:costLog?.changes||[]
  });
  window.ensureImportHistoryLoaded=ensureImportHistoryLoaded;
  window.ensureCostLogLoaded=ensureCostLogLoaded;
  window.ensureCuttingHistoryLoaded=ensureCuttingHistoryLoaded;
})();
