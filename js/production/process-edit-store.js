// process-edit-store（工序修改資料存取）：管理產品群組、正式工序版本與版本下載資料。
(function(){
  'use strict';

  const GROUP_COLLECTION='productGroups';
  const MEMBER_COLLECTION='productGroupMembers';
  const ORDER_COLLECTION='orders';
  const ORDER_PROCESS_COLLECTION='orderProcesses';
  const EDIT_JOB_COLLECTION='processEditJobs';
  const ALLOWED_CATEGORIES=new Set(['BL','SX','QC','DG']);
  let groups=[];
  let loaded=false;
  let loadPromise=null;
  let orderRows=[];
  let ordersLoaded=false;
  let ordersPromise=null;

  function currentUserId(){ return String(window.firebaseAuthUser?.uid||''); }
  function currentUserName(){ return String(window.cu?.user||window.cu?.username||''); }
  function normalizeCode(value){ return String(value||'').trim(); }
  function memberDocumentId(code){ return encodeURIComponent(normalizeCode(code)); }

  function products(){ return Array.isArray(window.D)?window.D:[]; }
  function productByCode(code){
    const target=normalizeCode(code);
    return products().find(item=>normalizeCode(item.code)===target)||null;
  }

  function cloneGroup(group){ return {...group,memberCodes:[...(group.memberCodes||[])]}; }

  async function loadGroups(options={}){
    if(loaded&&options.force!==true) return groups.map(cloneGroup);
    if(loadPromise) return loadPromise;
    loadPromise=(async()=>{
      const snapshot=await window._getDocs(window._collection(GROUP_COLLECTION));
      groups=snapshot.docs.map(item=>({groupId:item.id,...item.data()}))
        .filter(item=>item.active!==false)
        .map(item=>({...item,memberCodes:[...new Set((item.memberCodes||[]).map(normalizeCode).filter(Boolean))]}));
      loaded=true;
      return groups.map(cloneGroup);
    })().finally(()=>{ loadPromise=null; });
    return loadPromise;
  }

  function listGroups(){ return groups.map(cloneGroup); }

  function groupForProduct(code){
    const target=normalizeCode(code);
    return groups.find(group=>(group.memberCodes||[]).includes(target))||null;
  }

  function findCandidates(code){
    const source=productByCode(code);
    if(!source) return [];
    const signature=window.PCMSProductModel.groupSignature(source);
    return products().filter(item=>{
      const itemCode=normalizeCode(item.code);
      return itemCode&&itemCode!==source.code&&!groupForProduct(itemCode)
        &&window.PCMSProductModel.groupSignature(item)===signature;
    }).sort((a,b)=>String(a.sz||'').localeCompare(String(b.sz||''),'zh-Hant',{numeric:true,sensitivity:'base'}));
  }

  async function createGroup(input={}){
    const memberCodes=[...new Set((input.memberCodes||[]).map(normalizeCode).filter(Boolean))];
    if(memberCodes.length<2) throw new Error('Nhóm phải có ít nhất 2 mã hàng. / 群組至少需要2個款號。');
    const memberProducts=memberCodes.map(productByCode);
    if(memberProducts.some(item=>!item)) throw new Error('Có mã hàng không tồn tại. / 群組內有不存在的款號。');
    const signatures=new Set(memberProducts.map(window.PCMSProductModel.groupSignature));
    if(signatures.size!==1) throw new Error('Tên và công đoạn của các mã hàng không giống nhau, không thể lập nhóm. / 款號的品名或工序結構不同，不能建立同產品群組。');
    const groupReference=window._newDocRef(GROUP_COLLECTION);
    const now=Date.now();
    const userId=currentUserId();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    const group={
      groupId:groupReference.id,
      name:String(input.name||memberProducts[0].vi||memberProducts[0].zh||memberProducts[0].code).trim().slice(0,200),
      signature:[...signatures][0],
      memberCodes,
      active:true,
      createdAt:now,
      createdByUid:userId,
      createdBy:currentUserName().slice(0,200),
      updatedAt:now,
      updatedByUid:userId
    };
    await window._runTransaction(async transaction=>{
      for(const code of memberCodes){
        const memberReference=window._docRef(MEMBER_COLLECTION,memberDocumentId(code));
        const snapshot=await transaction.get(memberReference);
        if(snapshot.exists()) throw new Error(`Mã hàng ${code} đã thuộc nhóm khác. / 款號 ${code} 已屬於其他群組。`);
      }
      transaction.set(groupReference,group);
      memberCodes.forEach(code=>transaction.set(window._docRef(MEMBER_COLLECTION,memberDocumentId(code)),{
        code,groupId:group.groupId,createdAt:now,createdByUid:userId
      }));
    });
    groups.push(group);
    try{
      await window.saveOperationLogToFB?.({
        permissionKey:'productionProcessEdit',feature:'productionProcessEdit',action:'productGroupCreate',status:'success',
        itemCount:memberCodes.length,detailCount:0,note:`${group.groupId}: ${memberCodes.join(', ')}`
      });
    }catch(error){ console.error('Không thể lưu lịch sử nhóm / 無法保存群組操作紀錄',error); }
    return cloneGroup(group);
  }

  function validateOperations(operations){
    const normalized=(Array.isArray(operations)?operations:[]).map(window.PCMSProductModel.normalizeOperation);
    if(!normalized.length) throw new Error('Phải giữ lại ít nhất 1 công đoạn. / 至少必須保留1道工序。');
    if(normalized.length>99) throw new Error('Một mã hàng tối đa 99 công đoạn. / 每個款號最多99道工序。');
    normalized.sort((a,b)=>Number(a.no)-Number(b.no));
    normalized.forEach((operation,index)=>{
      const expected=String(index+1);
      if(operation.no!==expected) throw new Error(`Số công đoạn phải liên tục từ 1; thiếu hoặc trùng số ${expected}. / 工序號必須從1連續排列，缺少或重複 ${expected}。`);
      if(!ALLOWED_CATEGORIES.has(operation.category)) throw new Error(`Phân loại công đoạn ${expected} không hợp lệ. / 工序 ${expected} 的加工分類錯誤。`);
      if(!operation.vi||operation.vi.length>200||operation.zh.length>200) throw new Error(`Tên công đoạn ${expected} không hợp lệ. / 工序 ${expected} 的名稱不正確。`);
      if(!(operation.sec>0&&operation.sec<=86400)) throw new Error(`Giây công đoạn ${expected} phải lớn hơn 0. / 工序 ${expected} 秒數必須大於0。`);
    });
    return normalized;
  }

  async function saveOfficialProcesses(input={}){
    const targetCodes=[...new Set((input.targetCodes||[]).map(normalizeCode).filter(Boolean))];
    const reason=String(input.reason||'').trim();
    if(!targetCodes.length) throw new Error('Chưa chọn mã hàng cần áp dụng. / 尚未選擇要套用的款號。');
    if(reason.length<2||reason.length>500) throw new Error('Vui lòng nhập lý do sửa từ 2 đến 500 ký tự. / 請輸入2～500字的修改原因。');
    const operations=validateOperations(input.operations);
    const now=Date.now();
    const userName=currentUserName();
    const updatedItems=targetCodes.map(code=>{
      const current=productByCode(code);
      if(!current) throw new Error(`Không tìm thấy mã hàng ${code}. / 找不到款號 ${code}。`);
      return {
        ...current,
        ops:operations.map(item=>({...item})),
        developmentOps:Array.isArray(current.developmentOps)&&current.developmentOps.length
          ? current.developmentOps.map(item=>({...item}))
          : (current.ops||[]).map(window.PCMSProductModel.normalizeOperation),
        standardRevision:(Number(current.standardRevision)||0)+1,
        officialUpdatedAt:now,
        officialUpdatedBy:userName
      };
    });
    const success=await window.saveProductItemsToFB(updatedItems,{
      allowExisting:true,
      action:'processEdit',
      reason
    });
    if(!success) throw new Error(window.lastProductSyncError||'Không thể lưu công đoạn. / 無法儲存工序修改。');
    let logSaved=true;
    try{
      const result=await window.saveOperationLogToFB?.({
        permissionKey:'productionProcessEdit',feature:'productionProcessEdit',action:'productProcessEdit',status:'success',
        itemCount:targetCodes.length,detailCount:operations.length,note:`${reason}｜${targetCodes.join(', ')}`
      });
      logSaved=result!==false;
    }catch(error){ logSaved=false; console.error('Không thể lưu lịch sử sửa công đoạn / 無法保存工序修改紀錄',error); }
    return {items:updatedItems,operations,reason,logSaved};
  }

  async function loadVersions(maximum=100){
    return window.PCMSProductVersionStore.listVersions(maximum);
  }

  async function loadVersionSnapshot(versionId){
    return window.PCMSProductVersionStore.loadSnapshot(versionId);
  }

  function orderVersion(order){
    return String(order?.processVersion||`legacy-${order?.importCompletedAt||order?.createdAt||0}`);
  }

  function usableOrder(order){
    return !!order&&(!order.importStatus||order.importStatus==='ready')&&(!order.lifecycleStatus||order.lifecycleStatus==='active');
  }

  async function loadOrders(options={}){
    if(ordersLoaded&&options.force!==true) return orderRows.map(item=>({...item}));
    if(ordersPromise) return ordersPromise;
    ordersPromise=(async()=>{
      const rows=typeof window.firebaseLoadCachedCollection==='function'
        ? await window.firebaseLoadCachedCollection(ORDER_COLLECTION,ORDER_COLLECTION,options)
        : (await window._getDocs(window._collection(ORDER_COLLECTION))).docs.map(item=>({id:item.id,...item.data()}));
      orderRows=rows.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      ordersLoaded=true;
      return orderRows.map(item=>({...item}));
    })().finally(()=>{ ordersPromise=null; });
    return ordersPromise;
  }

  async function activeOrdersForProducts(codes,options={}){
    const targets=new Set((codes||[]).map(normalizeCode).filter(Boolean));
    if(!targets.size) return [];
    await loadOrders(options);
    return orderRows.filter(order=>usableOrder(order)&&(order.productCodes||[]).some(code=>targets.has(normalizeCode(code))))
      .map(order=>({...order,matchedCodes:(order.productCodes||[]).map(normalizeCode).filter(code=>targets.has(code))}));
  }

  async function loadOrderProcesses(order,options={}){
    const version=orderVersion(order);
    if(options.force!==true){
      const cached=await window.PCMSOrderProcessCache?.read?.(order.id,version);
      if(Array.isArray(cached)) return cached;
    }
    const snapshot=await window._getDocs(window._query(
      window._collection(ORDER_PROCESS_COLLECTION),window._where('orderId','==',order.id)
    ));
    const rows=snapshot.docs.map(item=>({id:item.id,...item.data()}));
    await window.PCMSOrderProcessCache?.write?.(order.id,version,rows);
    return rows;
  }

  function deterministicProcessId(orderId,code,processNo){
    return `process-edit-${encodeURIComponent(String(orderId))}-${encodeURIComponent(String(code))}-${String(processNo)}`;
  }

  function buildOrderProcessWrites(order,rows,targetCodes,operations,jobId){
    const exemplars=new Map();
    targetCodes.forEach(code=>{
      const exemplar=rows.find(row=>normalizeCode(row.code)===code);
      if(exemplar) exemplars.set(code,exemplar);
    });
    const missingCodes=targetCodes.filter(code=>!exemplars.has(code));
    if(missingCodes.length){
      throw new Error(`Không tìm thấy công đoạn gốc của mã hàng: ${missingCodes.join(', ')}. / 找不到款號的原始訂單工序：${missingCodes.join('、')}。`);
    }
    const targets=new Set(exemplars.keys());
    const now=Date.now();
    const desired=[];
    const existingByKey=new Map();
    rows.forEach(row=>existingByKey.set(`${normalizeCode(row.code)}|${String(row.processNo||'')}`,row));
    targetCodes.forEach(code=>{
      const exemplar=exemplars.get(code);
      operations.forEach(operation=>{
        const key=`${code}|${operation.no}`;
        const existing=existingByKey.get(key);
        const data={
          processNo:operation.no,processCategory:operation.category,processZh:operation.zh,processVi:operation.vi,
          processSec:operation.sec,workStdSec:operation.sec,
          slPerHour:Math.round((Number(window.S?.ws)||3000)/operation.sec),
          active:true,officialSyncedAt:now,officialSyncedBy:currentUserName()
        };
        if(existing) desired.push({type:'update',reference:window._docRef(ORDER_PROCESS_COLLECTION,existing.id),data});
        else{
          const reference=window._docRef(ORDER_PROCESS_COLLECTION,deterministicProcessId(order.id,code,operation.no));
          desired.push({type:'set',reference,data:{
            orderId:order.id,orderNo:order.orderId||order.id,code,
            desc:exemplar.desc||'',color:exemplar.color||'',zh:exemplar.zh||'',sz:exemplar.sz||'',orderQty:Number(exemplar.orderQty)||0,
            quoteSnapshotSec:operation.sec,createdAt:now,createdBy:currentUserName(),...data
          }});
        }
      });
    });
    rows.filter(row=>targets.has(normalizeCode(row.code))&&row.active!==false)
      .filter(row=>!targetCodes.some(code=>code===normalizeCode(row.code)&&operations.some(operation=>operation.no===String(row.processNo))))
      .forEach(row=>desired.push({type:'update',reference:window._docRef(ORDER_PROCESS_COLLECTION,row.id),data:{
        active:false,deactivatedAt:now,deactivatedBy:currentUserName()
      }}));
    const unaffectedCount=rows.filter(row=>!targets.has(normalizeCode(row.code))&&row.active!==false).length;
    return {writes:desired,activeCount:unaffectedCount+targetCodes.length*operations.length};
  }

  async function syncOrderSnapshot(input={}){
    const resumeJobId=String(input.resumeJobId||'');
    let jobReference=resumeJobId?window._docRef(EDIT_JOB_COLLECTION,resumeJobId):window._newDocRef(EDIT_JOB_COLLECTION);
    let job;
    if(resumeJobId){
      await window._runTransaction(async transaction=>{
        const jobSnapshot=await transaction.get(jobReference);
        if(!jobSnapshot.exists()) throw new Error('Không tìm thấy công việc đồng bộ. / 找不到訂單同步工作。');
        const savedJob={jobId:jobSnapshot.id,...jobSnapshot.data()};
        if(savedJob.createdByUid!==currentUserId()||!['failed','syncing'].includes(savedJob.status)){
          throw new Error('Công việc này không thể thử lại. / 此同步工作無法重試。');
        }
        const orderReference=window._docRef(ORDER_COLLECTION,savedJob.orderId);
        const orderSnapshot=await transaction.get(orderReference);
        if(!orderSnapshot.exists()||orderSnapshot.data().processEditJobId!==savedJob.jobId){
          throw new Error('Đơn hàng không còn bị khóa bởi công việc này. / 訂單已不再由此工作鎖定。');
        }
        job={...savedJob,status:'syncing',updatedAt:Date.now()};
        transaction.set(jobReference,job,{merge:false});
        transaction.update(orderReference,{processEditStatus:'syncing'});
      });
    }else{
      const targetCodes=[...new Set((input.targetCodes||[]).map(normalizeCode).filter(Boolean))];
      const operations=validateOperations(input.operations);
      const reason=String(input.reason||'').trim();
      if(!targetCodes.length||reason.length<2) throw new Error('Thiếu mã hàng hoặc lý do đồng bộ. / 缺少同步款號或原因。');
      await loadOrders();
      const order=orderRows.find(item=>item.id===String(input.orderId));
      if(!usableOrder(order)) throw new Error('Đơn hàng không còn hoạt động. / 訂單已不是生產中狀態。');
      job={
        jobId:jobReference.id,orderId:order.id,orderNo:order.orderId||order.id,
        targetCodes,operationsData:JSON.stringify(operations),mode:String(input.mode||'official'),reason:reason.slice(0,500),
        status:'syncing',completedBatches:0,createdAt:Date.now(),createdByUid:currentUserId(),createdBy:currentUserName()
      };
      await window._runTransaction(async transaction=>{
        const orderReference=window._docRef(ORDER_COLLECTION,order.id);
        const orderSnapshot=await transaction.get(orderReference);
        if(!orderSnapshot.exists()||!usableOrder(orderSnapshot.data())||orderSnapshot.data().processEditJobId){
          throw new Error('Đơn hàng đang được chỉnh sửa hoặc không còn hoạt động. / 訂單正在修改中或已停止使用。');
        }
        transaction.set(jobReference,job);
        transaction.update(orderReference,{processEditJobId:job.jobId,processEditStatus:'syncing'});
      });
    }
    const order=orderRows.find(item=>item.id===job.orderId)||{id:job.orderId,orderId:job.orderNo,processVersion:''};
    const operations=validateOperations(JSON.parse(String(job.operationsData||'[]')));
    const rows=await loadOrderProcesses(order,{force:true});
    const prepared=buildOrderProcessWrites(order,rows,job.targetCodes,operations,job.jobId);
    const batchSize=380;
    const totalBatches=Math.max(1,Math.ceil(prepared.writes.length/batchSize));
    try{
      for(let offset=0,batchNumber=1;offset<prepared.writes.length;offset+=batchSize,batchNumber++){
        const batch=window._writeBatch();
        prepared.writes.slice(offset,offset+batchSize).forEach(write=>{
          if(write.type==='set') batch.set(write.reference,write.data); else batch.update(write.reference,write.data);
        });
        batch.set(jobReference,{status:'syncing',completedBatches:batchNumber,totalBatches,updatedAt:Date.now()},{merge:true});
        await batch.commit();
      }
      const processVersion=`process-edit-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const finalBatch=window._writeBatch();
      finalBatch.update(window._docRef(ORDER_COLLECTION,order.id),{
        processVersion,processCount:prepared.activeCount,
        processEditJobId:window._deleteField(),processEditStatus:'ready',
        processEditCompletedAt:Date.now(),processEditCompletedBy:currentUserName()
      });
      finalBatch.set(jobReference,{status:'ready',completedAt:Date.now(),processVersion,totalBatches},{merge:true});
      await finalBatch.commit();
      await window.PCMSOrderProcessCache?.remove?.(order.id);
      const local=orderRows.find(item=>item.id===order.id);
      if(local){ local.processVersion=processVersion;local.processCount=prepared.activeCount;delete local.processEditJobId;local.processEditStatus='ready'; }
      try{
        await window.saveOperationLogToFB?.({
          permissionKey:'productionProcessEdit',feature:'productionProcessEdit',
          action:job.mode==='exception'?'orderProcessException':'orderProcessSnapshotSync',status:'success',
          itemCount:job.targetCodes.length,detailCount:prepared.writes.length,
          note:`${order.orderId||order.id}｜${job.reason}｜${job.targetCodes.join(', ')}`
        });
      }catch(error){ console.error('Không thể lưu lịch sử đồng bộ đơn hàng / 無法保存訂單同步紀錄',error); }
      return {jobId:job.jobId,orderId:order.id,orderNo:order.orderId||order.id,writeCount:prepared.writes.length,status:'ready'};
    }catch(error){
      try{ await window._setDoc(jobReference,{status:'failed',errorCode:String(error.code||'sync-failed').slice(0,100),updatedAt:Date.now()},{merge:true}); }catch(_){ }
      error.processEditJobId=job.jobId;
      throw error;
    }
  }

  async function retryOrderSnapshot(jobId){ return syncOrderSnapshot({resumeJobId:jobId}); }

  function reset(){ groups=[]; loaded=false; loadPromise=null; orderRows=[];ordersLoaded=false;ordersPromise=null; }

  window.PCMSProcessEditStore=Object.freeze({
    loadGroups,listGroups,groupForProduct,findCandidates,createGroup,
    validateOperations,saveOfficialProcesses,loadVersions,loadVersionSnapshot,
    loadOrders,activeOrdersForProducts,syncOrderSnapshot,retryOrderSnapshot,reset
  });
})();
