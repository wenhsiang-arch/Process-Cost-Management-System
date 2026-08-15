// process-edit-store（工序修改資料存取）：管理產品群組、正式工序版本與版本下載資料。
(function(){
  'use strict';

  const GROUP_COLLECTION='productGroups';
  const MEMBER_COLLECTION='productGroupMembers';
  const ORDER_COLLECTION='orders';
  const ORDER_PROCESS_COLLECTION='orderProcesses';
  const EDIT_JOB_COLLECTION='processEditJobs';
  const ENTRY_COLLECTION='productionEntries';
  const LOG_COLLECTION='operationLogs';
  const ALLOWED_CATEGORIES=new Set(['BL','SX','QC','DG']);
  const EDIT_MODES=Object.freeze({
    STANDARD_CORRECTION:'standardCorrection',
    PROCESS_OPTIMIZATION:'processOptimization'
  });
  const QUERY_CODE_CHUNK=10;
  const QUERY_PAGE_SIZE=100;
  const WRITE_BATCH_SIZE=300;
  let groups=[];
  let loaded=false;
  let loadPromise=null;

  function currentUserId(){ return String(window.firebaseAuthUser?.uid||''); }
  function currentUserName(){ return String(window.cu?.user||window.cu?.username||''); }
  function normalizeCode(value){ return String(value||'').trim(); }
  function memberDocumentId(code){ return encodeURIComponent(normalizeCode(code)); }
  function normalizeMode(value){
    return value===EDIT_MODES.STANDARD_CORRECTION
      ? EDIT_MODES.STANDARD_CORRECTION
      : EDIT_MODES.PROCESS_OPTIMIZATION;
  }
  function modificationReason(mode){
    return normalizeMode(mode)===EDIT_MODES.STANDARD_CORRECTION
      ? 'Sửa lỗi tiêu chuẩn / 標準錯誤訂正'
      : 'Tối ưu công đoạn / 工序優化';
  }
  function chunks(values,size=QUERY_CODE_CHUNK){
    const result=[];
    for(let index=0;index<values.length;index+=size) result.push(values.slice(index,index+size));
    return result;
  }

  function products(){ return Array.isArray(window.D)?window.D:[]; }
  function productByCode(code){
    const target=normalizeCode(code);
    return products().find(item=>normalizeCode(item.code)===target)||null;
  }

  function cloneGroup(group){ return {...group,memberCodes:[...(group.memberCodes||[])]}; }

  function operationLogData({action,itemCount=0,detailCount=0,note=''}){
    const userId=currentUserId();
    return {
      permissionKey:'productionProcessEdit',feature:'productionProcessEdit',action,status:'success',
      createdAt:Date.now(),createdByUid:userId,createdBy:(currentUserName()||userId).slice(0,200),
      itemCount,detailCount,note:String(note||'').slice(0,500)
    };
  }

  async function loadGroups(options={}){
    if(loadPromise) return loadPromise;
    loadPromise=(async()=>{
      const loadedRows=typeof window.firebaseLoadCachedCollection==='function'
        ? await window.firebaseLoadCachedCollection(GROUP_COLLECTION,GROUP_COLLECTION,options)
        : (await window._getDocs(window._collection(GROUP_COLLECTION))).docs.map(item=>({id:item.id,...item.data()}));
      groups=loadedRows.map(item=>({...item,groupId:item.groupId||item.id}))
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

  function validateGroupMembers(memberCodes){
    const normalized=[...new Set((memberCodes||[]).map(normalizeCode).filter(Boolean))];
    if(normalized.length<2) throw new Error('Nhóm phải có ít nhất 2 mã hàng. / 群組至少需要2個款號。');
    if(normalized.length>200) throw new Error('Nhóm chỉ được có tối đa 200 mã hàng. / 群組最多只能有200個款號。');
    const memberProducts=normalized.map(productByCode);
    if(memberProducts.some(item=>!item)) throw new Error('Có mã hàng không tồn tại. / 群組內有不存在的款號。');
    const signatures=new Set(memberProducts.map(window.PCMSProductModel.groupSignature));
    if(signatures.size!==1) throw new Error('Tên và công đoạn của các mã hàng không giống nhau, không thể lập nhóm. / 款號的品名或工序結構不同，不能建立同產品群組。');
    return {memberCodes:normalized,memberProducts,signature:[...signatures][0]};
  }

  async function createGroup(input={}){
    const validated=validateGroupMembers(input.memberCodes);
    const {memberCodes,memberProducts,signature}=validated;
    const groupReference=window._newDocRef(GROUP_COLLECTION);
    const now=Date.now();
    const userId=currentUserId();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    const group={
      groupId:groupReference.id,
      name:String(input.name||memberProducts[0].vi||memberProducts[0].zh||memberProducts[0].code).trim().slice(0,200),
      signature,
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

  // updateGroupMembers（更新群組成員）：在同一交易中同步群組清單及款號唯一群組索引。
  async function updateGroupMembers(input={}){
    const groupId=normalizeCode(input.groupId);
    const current=groups.find(item=>item.groupId===groupId);
    if(!current) throw new Error('Không tìm thấy nhóm cần sửa. / 找不到要修改的群組。');
    const validated=validateGroupMembers(input.memberCodes);
    if(validated.signature!==current.signature) throw new Error('Mã hàng được chọn không thuộc cùng sản phẩm của nhóm này. / 所選款號不屬於此群組的同一產品。');
    const previousCodes=[...new Set((current.memberCodes||[]).map(normalizeCode).filter(Boolean))];
    const previousSet=new Set(previousCodes);
    const nextSet=new Set(validated.memberCodes);
    const added=validated.memberCodes.filter(code=>!previousSet.has(code));
    const removed=previousCodes.filter(code=>!nextSet.has(code));
    if(!added.length&&!removed.length) return {group:cloneGroup(current),added,removed,changed:false,logSaved:true};
    const userId=currentUserId();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    const now=Date.now();
    const groupReference=window._docRef(GROUP_COLLECTION,groupId);
    await window._runTransaction(async transaction=>{
      const groupSnapshot=await transaction.get(groupReference);
      if(!groupSnapshot.exists()||groupSnapshot.data().active===false) throw new Error('Nhóm không còn hiệu lực. / 群組已不存在或停用。');
      const remoteCodes=[...new Set((groupSnapshot.data().memberCodes||[]).map(normalizeCode).filter(Boolean))];
      if(remoteCodes.length!==previousCodes.length||remoteCodes.some((code,index)=>code!==previousCodes[index])){
        throw new Error('Nhóm đã được người khác cập nhật; vui lòng mở lại rồi thử lại. / 群組已由其他人更新，請重新開啟後再試。');
      }
      for(const code of added){
        const memberReference=window._docRef(MEMBER_COLLECTION,memberDocumentId(code));
        const memberSnapshot=await transaction.get(memberReference);
        if(memberSnapshot.exists()&&memberSnapshot.data().groupId!==groupId){
          throw new Error(`Mã hàng ${code} đã thuộc nhóm khác. / 款號 ${code} 已屬於其他群組。`);
        }
      }
      for(const code of removed){
        const memberReference=window._docRef(MEMBER_COLLECTION,memberDocumentId(code));
        const memberSnapshot=await transaction.get(memberReference);
        if(memberSnapshot.exists()&&memberSnapshot.data().groupId!==groupId){
          throw new Error(`Chỉ mục nhóm của mã ${code} không khớp. / 款號 ${code} 的群組索引不一致。`);
        }
      }
      transaction.update(groupReference,{memberCodes:validated.memberCodes,updatedAt:now,updatedByUid:userId});
      added.forEach(code=>transaction.set(window._docRef(MEMBER_COLLECTION,memberDocumentId(code)),{
        code,groupId,createdAt:now,createdByUid:userId
      }));
      removed.forEach(code=>transaction.delete(window._docRef(MEMBER_COLLECTION,memberDocumentId(code))));
    });
    current.memberCodes=validated.memberCodes.slice();
    current.updatedAt=now;
    current.updatedByUid=userId;
    let logSaved=true;
    try{
      const result=await window.saveOperationLogToFB?.({
        permissionKey:'productionProcessEdit',feature:'productionProcessEdit',action:'productGroupMembersUpdate',status:'success',
        itemCount:validated.memberCodes.length,detailCount:added.length+removed.length,
        note:`${groupId}｜Thêm / 新增: ${added.join(', ')||'—'}｜Xóa / 移除: ${removed.join(', ')||'—'}`
      });
      logSaved=result!==false;
    }catch(error){ logSaved=false; console.error('Không thể lưu lịch sử sửa thành viên nhóm / 無法保存群組成員修改紀錄',error); }
    return {group:cloneGroup(current),added,removed,changed:true,logSaved};
  }

  // renameGroup（修改群組名稱）：只修改顯示名稱，群組身分、成員及產品資料不變。
  async function renameGroup(input={}){
    const groupId=normalizeCode(input.groupId);
    const nextName=String(input.name||'').trim();
    const current=groups.find(item=>item.groupId===groupId);
    if(!current) throw new Error('Không tìm thấy nhóm cần đổi tên. / 找不到要改名的群組。');
    if(!nextName||nextName.length>200) throw new Error('Tên nhóm phải từ 1 đến 200 ký tự. / 群組名稱須為1～200字。');
    const previousName=String(current.name||current.groupId);
    if(nextName===previousName) return {group:cloneGroup(current),changed:false};
    const userId=currentUserId();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    const now=Date.now();
    const groupReference=window._docRef(GROUP_COLLECTION,groupId);
    const logReference=window._newDocRef(LOG_COLLECTION);
    await window._runTransaction(async transaction=>{
      const snapshot=await transaction.get(groupReference);
      if(!snapshot.exists()||snapshot.data().active===false) throw new Error('Nhóm không còn hiệu lực. / 群組已不存在或停用。');
      if(String(snapshot.data().name||snapshot.id)!==previousName){
        throw new Error('Tên nhóm đã được người khác cập nhật; vui lòng mở lại. / 群組名稱已由其他人修改，請重新開啟。');
      }
      transaction.update(groupReference,{name:nextName,updatedAt:now,updatedByUid:userId});
      transaction.set(logReference,operationLogData({
        action:'productGroupRename',itemCount:1,detailCount:1,
        note:`${groupId}｜${previousName} → ${nextName}`
      }));
    });
    current.name=nextName;
    current.updatedAt=now;
    current.updatedByUid=userId;
    return {group:cloneGroup(current),previousName,name:nextName,changed:true};
  }

  // deleteGroup（永久刪除群組）：同一交易刪除群組、成員索引並建立不可修改的操作紀錄。
  async function deleteGroup(groupId){
    const targetId=normalizeCode(groupId);
    const current=groups.find(item=>item.groupId===targetId);
    if(!current) throw new Error('Không tìm thấy nhóm cần xóa. / 找不到要刪除的群組。');
    const previousCodes=[...new Set((current.memberCodes||[]).map(normalizeCode).filter(Boolean))];
    const userId=currentUserId();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    const groupReference=window._docRef(GROUP_COLLECTION,targetId);
    const logReference=window._newDocRef(LOG_COLLECTION);
    await window._runTransaction(async transaction=>{
      const snapshot=await transaction.get(groupReference);
      if(!snapshot.exists()||snapshot.data().active===false) throw new Error('Nhóm không còn hiệu lực. / 群組已不存在或停用。');
      const remoteCodes=[...new Set((snapshot.data().memberCodes||[]).map(normalizeCode).filter(Boolean))];
      if(remoteCodes.length!==previousCodes.length||remoteCodes.some((code,index)=>code!==previousCodes[index])){
        throw new Error('Nhóm đã được người khác cập nhật; vui lòng tải lại rồi thử lại. / 群組已由其他人更新，請重新載入後再試。');
      }
      for(const code of previousCodes){
        const memberReference=window._docRef(MEMBER_COLLECTION,memberDocumentId(code));
        const memberSnapshot=await transaction.get(memberReference);
        if(memberSnapshot.exists()&&memberSnapshot.data().groupId!==targetId){
          throw new Error(`Chỉ mục nhóm của mã ${code} không khớp. / 款號 ${code} 的群組索引不一致。`);
        }
      }
      previousCodes.forEach(code=>transaction.delete(window._docRef(MEMBER_COLLECTION,memberDocumentId(code))));
      transaction.delete(groupReference);
      transaction.set(logReference,operationLogData({
        action:'productGroupDelete',itemCount:previousCodes.length,detailCount:previousCodes.length+1,
        note:`${targetId}｜${current.name||targetId}｜${previousCodes.join(', ')}`
      }));
    });
    groups=groups.filter(item=>item.groupId!==targetId);
    return {group:cloneGroup(current),memberCodes:previousCodes,logSaved:true};
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
      if(!(Number.isInteger(operation.sec)&&operation.sec>0&&operation.sec<=86400)) throw new Error(`Giây công đoạn ${expected} phải là số nguyên lớn hơn 0. / 工序 ${expected} 秒數必須是大於0的整數。`);
    });
    return normalized;
  }

  function sameOperationStructure(beforeValue,afterValue){
    const before=(beforeValue||[]).map(window.PCMSProductModel.normalizeOperation);
    const after=(afterValue||[]).map(window.PCMSProductModel.normalizeOperation);
    return before.length===after.length&&before.every((item,index)=>{
      const next=after[index];
      return next&&item.no===next.no&&item.category===next.category&&item.vi===next.vi&&item.zh===next.zh;
    });
  }

  function buildOperationsByCode(items){
    return Object.fromEntries(items.map(item=>[
      normalizeCode(item.code),validateOperations(item.ops).map(operation=>({...operation}))
    ]));
  }

  // buildCorrectionPlan（建立標準訂正計畫）：結構變更一律留給「從現在起」模式，避免重寫歷史工序身分。
  function buildCorrectionPlan(targetCodes,operationsByCode,mode){
    if(normalizeMode(mode)!==EDIT_MODES.STANDARD_CORRECTION) return {};
    const plan={};
    targetCodes.forEach(code=>{
      const current=productByCode(code);
      const next=operationsByCode[code]||[];
      if(!current||!sameOperationStructure(current.ops||[],next)){
        throw new Error('Chỉ thay đổi giây mới được dùng chế độ sửa lỗi tiêu chuẩn; thêm, xóa, đổi tên hoặc đổi thứ tự phải áp dụng từ bây giờ. / 只有純秒數變更可使用標準錯誤訂正；新增、刪除、改名或調整順序必須從現在起生效。');
      }
      const beforeByNo=new Map((current.ops||[]).map(item=>{
        const operation=window.PCMSProductModel.normalizeOperation(item);
        return [operation.no,operation];
      }));
      next.forEach(operation=>{
        const before=beforeByNo.get(operation.no);
        if(!before||Number(before.sec)===Number(operation.sec)) return;
        if(!plan[code]) plan[code]={};
        plan[code][operation.no]={
          seconds:Number(operation.sec),
          hourlyCapacity:Math.round((Number(window.S?.ws)||3000)/Number(operation.sec))
        };
      });
    });
    if(!Object.keys(plan).length){
      throw new Error('Không có giây nào cần sửa lỗi tiêu chuẩn. / 沒有需要進行標準錯誤訂正的秒數。');
    }
    return plan;
  }

  async function commitOfficialChange(input={}){
    const mode=normalizeMode(input.mode);
    const targetCodes=input.targetCodes;
    const operationsByCode=input.operationsByCode;
    const corrections=buildCorrectionPlan(targetCodes,operationsByCode,mode);
    const job=await createModificationJob({
      targetCodes,operationsByCode,corrections,mode,reason:input.reason,
      affectedOrders:Array.isArray(input.orders)?input.orders.length:0,
      affectedEntries:Number(input.entryCount)||0
    });
    let productSaved=false;
    try{
      const success=await window.saveProductItemsToFB(input.updatedItems,{
        allowExisting:true,action:'processEdit',reason:input.reason
      });
      if(!success) throw new Error(window.lastProductSyncError||'Không thể lưu tiêu chuẩn công đoạn. / 無法儲存工序標準。');
      productSaved=true;
      await updateModificationJob(job.jobId,{
        status:'syncing',phase:'orders',productSavedAt:Date.now(),updatedAt:Date.now(),errorCode:''
      });
      const sync=await runModificationJob(job.jobId,{orders:input.orders,onProgress:input.onProgress});
      let logSaved=true;
      try{
        const result=await window.saveOperationLogToFB?.({
          permissionKey:'productionProcessEdit',feature:'productionProcessEdit',action:'productProcessEdit',status:'success',
          itemCount:targetCodes.length,detailCount:Number(input.detailCount)||0,
          changes:(input.changes||[]).slice(0,50),
          note:`${input.reason}｜${mode}｜${targetCodes.join(', ')}`
        });
        logSaved=result!==false;
      }catch(error){ logSaved=false; console.error('Không thể lưu lịch sử sửa công đoạn / 無法保存工序修改紀錄',error); }
      return {...input.result,items:input.updatedItems,reason:input.reason,mode,jobId:job.jobId,sync,logSaved};
    }catch(error){
      error.processEditJobId=error.processEditJobId||job.jobId;
      error.productSaved=productSaved;
      if(!productSaved){
        try{ await updateModificationJob(job.jobId,{status:'failed',phase:'product',updatedAt:Date.now(),errorCode:String(error.code||'product-save-failed').slice(0,100)}); }catch(_){ }
      }
      throw error;
    }
  }

  async function saveOfficialProcesses(input={}){
    const targetCodes=[...new Set((input.targetCodes||[]).map(normalizeCode).filter(Boolean))];
    const reason=modificationReason(input.mode);
    if(!targetCodes.length) throw new Error('Chưa chọn mã hàng cần áp dụng. / 尚未選擇要套用的款號。');
    const operations=validateOperations(input.operations);
    const now=Date.now();
    const userName=currentUserName();
    const updatedItems=targetCodes.map(code=>{
      const current=productByCode(code);
      if(!current) throw new Error(`Không tìm thấy mã hàng ${code}. / 找不到款號 ${code}。`);
      return {
        ...current,ops:operations.map(item=>({...item})),
        developmentOps:Array.isArray(current.developmentOps)&&current.developmentOps.length
          ? current.developmentOps.map(item=>({...item}))
          : (current.ops||[]).map(window.PCMSProductModel.normalizeOperation),
        standardRevision:(Number(current.standardRevision)||0)+1,
        officialUpdatedAt:now,officialUpdatedBy:userName
      };
    });
    return commitOfficialChange({
      targetCodes,updatedItems,operationsByCode:buildOperationsByCode(updatedItems),
      mode:input.mode,reason,orders:input.orders,onProgress:input.onProgress,
      entryCount:input.entryCount,detailCount:operations.length,result:{operations}
    });
  }

  // saveOfficialSeconds（儲存正式秒數）：更新款號後，依選定模式同步訂單並決定是否訂正既有產能快照。
  async function saveOfficialSeconds(input={}){
    const targetCodes=[...new Set((input.targetCodes||[]).map(normalizeCode).filter(Boolean))];
    const processNo=String(input.processNo||'').trim();
    const seconds=Number(input.seconds);
    const reason=modificationReason(input.mode);
    if(!targetCodes.length) throw new Error('Chưa chọn mã hàng cần áp dụng. / 尚未選擇要套用的款號。');
    if(!processNo) throw new Error('Thiếu số công đoạn. / 缺少工序號。');
    if(!(Number.isInteger(seconds)&&seconds>0&&seconds<=86400)) throw new Error('Giây công đoạn phải là số nguyên lớn hơn 0. / 工序秒數必須是大於0的整數。');
    const now=Date.now();
    const userName=currentUserName();
    const changes=[];
    const updatedItems=targetCodes.map(code=>{
      const current=productByCode(code);
      if(!current) throw new Error(`Không tìm thấy mã hàng ${code}. / 找不到款號 ${code}。`);
      let found=false;
      const operations=(current.ops||[]).map(item=>{
        const operation=window.PCMSProductModel.normalizeOperation(item);
        if(String(operation.no)!==processNo) return operation;
        found=true;
        changes.push({code,processNo,before:Number(operation.sec)||0,after:seconds});
        return {...operation,sec:seconds};
      });
      if(!found) throw new Error(`Mã ${code} không có công đoạn ${processNo}. / 款號 ${code} 沒有工序 ${processNo}。`);
      return {
        ...current,ops:operations,
        developmentOps:Array.isArray(current.developmentOps)&&current.developmentOps.length
          ? current.developmentOps.map(item=>({...item}))
          : (current.ops||[]).map(window.PCMSProductModel.normalizeOperation),
        standardRevision:(Number(current.standardRevision)||0)+1,
        officialUpdatedAt:now,officialUpdatedBy:userName
      };
    });
    return commitOfficialChange({
      targetCodes,updatedItems,operationsByCode:buildOperationsByCode(updatedItems),
      mode:input.mode,reason,orders:input.orders,onProgress:input.onProgress,
      entryCount:input.entryCount,detailCount:changes.length,changes,result:{processNo,seconds,changes}
    });
  }

  async function loadVersions(maximum=100){
    return window.PCMSProductVersionStore.listVersions(maximum);
  }

  async function loadVersionSnapshot(versionId){
    return window.PCMSProductVersionStore.loadSnapshot(versionId);
  }

  function orderVersion(order){
    return String(order?.processVersion||`legacy-${normalizeCode(order?.id)}`);
  }

  function usableOrder(order){
    return !!order&&(!order.importStatus||order.importStatus==='ready')&&(!order.lifecycleStatus||order.lifecycleStatus==='active');
  }

  async function activeOrdersForProducts(codes,options={}){
    const targetCodes=[...new Set((codes||[]).map(normalizeCode).filter(Boolean))];
    if(!targetCodes.length) return [];
    const found=new Map();
    for(const codeChunk of chunks(targetCodes)){
      const snapshot=await window._getDocs(window._query(
        window._collection(ORDER_COLLECTION),
        window._where('productCodes','array-contains-any',codeChunk)
      ));
      snapshot.docs.forEach(item=>{
        const order={id:item.id,...item.data()};
        if(usableOrder(order)) found.set(order.id,order);
      });
    }
    const targets=new Set(targetCodes);
    return [...found.values()].sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0)).map(order=>({
      ...order,matchedCodes:(order.productCodes||[]).map(normalizeCode).filter(code=>targets.has(code))
    }));
  }

  async function queryProductionEntries(corrections,options={}){
    const matches=[];
    for(const [code,processes] of Object.entries(corrections||{})){
      for(const processNo of Object.keys(processes||{})){
        let cursor=null;
        do{
          const constraints=[
            window._where('productCode','==',code),
            window._where('processNo','==',processNo),
            window._orderBy('createdAt','asc')
          ];
          if(cursor) constraints.push(window._startAfter(cursor));
          constraints.push(window._limit(QUERY_PAGE_SIZE));
          const snapshot=await window._getDocs(window._query(window._collection(ENTRY_COLLECTION),...constraints));
          const rows=snapshot.docs.map(item=>({id:item.id,...item.data()}))
            .filter(item=>item.recordType==='standard');
          if(options.collect!==false) matches.push(...rows);
          if(typeof options.onPage==='function') await options.onPage(rows,{code,processNo});
          cursor=snapshot.size===QUERY_PAGE_SIZE?snapshot.docs[snapshot.docs.length-1]:null;
        }while(cursor);
      }
    }
    return matches;
  }

  async function partitionRowsByEditableMonth(rows){
    const guards=window.PCMSProductionGuards;
    if(!guards) throw new Error('Thiếu mô-đun bảo vệ tháng sản xuất. / 缺少產能月份防護程式。');
    const months=[...new Set((rows||[]).map(row=>guards.monthFromDate(row.productionDate)))];
    const snapshots=await Promise.all(months.map(month=>window._getDoc(window._docRef('performanceBonusMonths',month))));
    const locked=new Set();
    snapshots.forEach((snapshot,index)=>{
      if(snapshot.exists()&&['locked','exported','paid'].includes(String(snapshot.data()?.status||''))) locked.add(months[index]);
    });
    const editableRows=[];
    const lockedRows=[];
    (rows||[]).forEach(row=>(locked.has(guards.monthFromDate(row.productionDate))?lockedRows:editableRows).push(row));
    return {editableRows,lockedRows,lockedMonths:[...locked].sort()};
  }

  async function analyzeImpact(input={}){
    const targetCodes=[...new Set((input.targetCodes||[]).map(normalizeCode).filter(Boolean))];
    const mode=normalizeMode(input.mode);
    const operationsByCode=input.operationsByCode||{};
    const corrections=buildCorrectionPlan(targetCodes,operationsByCode,mode);
    const orders=await activeOrdersForProducts(targetCodes,input);
    let entryCount=0;
    let lockedEntryCount=0;
    const lockedMonths=new Set();
    if(mode===EDIT_MODES.STANDARD_CORRECTION){
      await queryProductionEntries(corrections,{collect:false,onPage:async rows=>{
        const partition=await partitionRowsByEditableMonth(rows);
        entryCount+=partition.editableRows.length;
        lockedEntryCount+=partition.lockedRows.length;
        partition.lockedMonths.forEach(month=>lockedMonths.add(month));
      }});
    }
    return {targetCodes,mode,corrections,orders,orderCount:orders.length,entryCount,lockedEntryCount,lockedMonths:[...lockedMonths].sort()};
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

  function buildOrderProcessWrites(order,rows,targetCodes,operationsByCode,jobId){
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
      const operations=validateOperations(operationsByCode[code]||[]);
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
      .filter(row=>{
        const code=normalizeCode(row.code);
        return !(operationsByCode[code]||[]).some(operation=>String(operation.no)===String(row.processNo));
      })
      .forEach(row=>desired.push({type:'update',reference:window._docRef(ORDER_PROCESS_COLLECTION,row.id),data:{
        active:false,deactivatedAt:now,deactivatedBy:currentUserName()
      }}));
    const unaffectedCount=rows.filter(row=>!targets.has(normalizeCode(row.code))&&row.active!==false).length;
    const targetCount=targetCodes.reduce((sum,code)=>sum+(operationsByCode[code]||[]).length,0);
    return {writes:desired,activeCount:unaffectedCount+targetCount};
  }

  function stableToken(value){
    let hash=2166136261;
    for(const character of String(value||'')){ hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619); }
    return (hash>>>0).toString(36);
  }

  function childJobId(masterJobId,orderId){ return `${masterJobId}-o-${stableToken(orderId)}`; }

  async function loadModificationJob(jobId){
    const snapshot=await window._getDoc(window._docRef(EDIT_JOB_COLLECTION,String(jobId||'')));
    return snapshot.exists()?{jobId:snapshot.id,...snapshot.data()}:null;
  }

  async function loadPendingModificationJobs(maximum=10){
    const snapshot=await window._getDocs(window._query(
      window._collection(EDIT_JOB_COLLECTION),
      window._where('createdByUid','==',currentUserId()),
      window._where('jobType','==','master'),
      window._where('status','in',['syncing','partial','failed']),
      window._orderBy('createdAt','desc'),
      window._limit(Math.max(1,Math.min(20,Number(maximum)||10)))
    ));
    return snapshot.docs.map(item=>({jobId:item.id,...item.data()}));
  }

  async function updateModificationJob(jobId,data){
    await window._setDoc(window._docRef(EDIT_JOB_COLLECTION,jobId),data,{merge:true});
  }

  async function createModificationJob(input={}){
    const userId=currentUserId();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    const reference=window._newDocRef(EDIT_JOB_COLLECTION);
    const now=Date.now();
    const job={
      jobId:reference.id,jobType:'master',masterJobId:'',orderId:'__MULTI__',orderNo:'__MULTI__',
      targetCodes:input.targetCodes,operationsData:JSON.stringify(input.operationsByCode||{}),
      correctionData:input.corrections||{},mode:normalizeMode(input.mode),
      reason:String(input.reason||'').slice(0,500),status:'syncing',phase:'product',
      affectedOrders:Number(input.affectedOrders)||0,completedOrders:0,failedOrders:[],
      affectedEntries:Number(input.affectedEntries)||0,correctedEntries:0,completedBatches:0,totalBatches:0,
      productSavedAt:0,completedAt:0,processVersion:'',errorCode:'',
      createdAt:now,updatedAt:now,createdByUid:userId,createdBy:(currentUserName()||userId).slice(0,200)
    };
    await window._setDoc(reference,job);
    return job;
  }

  async function syncOrderSnapshot(input={}){
    const master=await loadModificationJob(input.masterJobId);
    if(!master||master.jobType!=='master'||master.createdByUid!==currentUserId()){
      throw new Error('Không tìm thấy công việc sửa công đoạn chính. / 找不到主要工序修改工作。');
    }
    const orderId=String(input.order?.id||input.orderId||'');
    const orderReference=window._docRef(ORDER_COLLECTION,orderId);
    const orderSnapshot=await window._getDoc(orderReference);
    const order=orderSnapshot.exists()?{id:orderSnapshot.id,...orderSnapshot.data()}:null;
    if(!usableOrder(order)) throw new Error('Đơn hàng không còn hoạt động. / 訂單已不是生產中狀態。');
    const allOperations=JSON.parse(String(master.operationsData||'{}'));
    const targets=[...new Set((input.targetCodes||master.targetCodes||[]).map(normalizeCode).filter(code=>(order.productCodes||[]).map(normalizeCode).includes(code)))];
    if(!targets.length) return {orderId,status:'skipped',writeCount:0};
    const operationsByCode=Object.fromEntries(targets.map(code=>[code,validateOperations(allOperations[code]||[])]));
    const jobId=childJobId(master.jobId,orderId);
    const jobReference=window._docRef(EDIT_JOB_COLLECTION,jobId);
    let existing=await loadModificationJob(jobId);
    if(existing?.status==='ready') return {jobId,orderId,orderNo:order.orderId||order.id,writeCount:0,status:'ready',reused:true};
    const now=Date.now();
    let job;
    await window._runTransaction(async transaction=>{
      const liveOrderSnapshot=await transaction.get(orderReference);
      if(!liveOrderSnapshot.exists()||!usableOrder(liveOrderSnapshot.data())) throw new Error('Đơn hàng không còn hoạt động. / 訂單已不是生產中狀態。');
      const jobSnapshot=await transaction.get(jobReference);
      const liveOrder=liveOrderSnapshot.data();
      if(jobSnapshot.exists()){
        const saved={jobId:jobSnapshot.id,...jobSnapshot.data()};
        if(saved.masterJobId!==master.jobId||saved.createdByUid!==currentUserId()||!['failed','syncing'].includes(saved.status)){
          throw new Error('Công việc đơn hàng này không thể thử lại. / 此訂單工作無法重試。');
        }
        if(liveOrder.processEditJobId!==saved.jobId) throw new Error('Đơn hàng không còn bị khóa bởi công việc này. / 訂單已不再由此工作鎖定。');
        job={...saved,status:'syncing',phase:'orders',updatedAt:now,errorCode:''};
        transaction.set(jobReference,job,{merge:false});
        transaction.update(orderReference,{processEditStatus:'syncing'});
      }else{
        if(liveOrder.processEditJobId) throw new Error('Đơn hàng đang được chỉnh sửa. / 訂單正在修改中。');
        job={
          jobId,jobType:'order',masterJobId:master.jobId,orderId,orderNo:order.orderId||order.id,
          targetCodes:targets,operationsData:JSON.stringify(operationsByCode),correctionData:{},
          mode:master.mode,reason:master.reason,status:'syncing',phase:'orders',completedBatches:0,
          totalBatches:0,affectedOrders:1,completedOrders:0,failedOrders:[],affectedEntries:0,correctedEntries:0,
          productSavedAt:0,completedAt:0,processVersion:'',errorCode:'',
          createdAt:now,updatedAt:now,createdByUid:currentUserId(),createdBy:(currentUserName()||currentUserId()).slice(0,200)
        };
        transaction.set(jobReference,job);
        transaction.update(orderReference,{processEditJobId:jobId,processEditStatus:'syncing'});
      }
    });
    const rows=await loadOrderProcesses(order,{force:true});
    const prepared=buildOrderProcessWrites(order,rows,job.targetCodes,operationsByCode,job.jobId);
    const totalBatches=Math.max(1,Math.ceil(prepared.writes.length/WRITE_BATCH_SIZE));
    try{
      for(let offset=0,batchNumber=1;offset<prepared.writes.length;offset+=WRITE_BATCH_SIZE,batchNumber++){
        const batch=window._writeBatch();
        prepared.writes.slice(offset,offset+WRITE_BATCH_SIZE).forEach(write=>{
          if(write.type==='set') batch.set(write.reference,write.data); else batch.update(write.reference,write.data);
        });
        batch.set(jobReference,{status:'syncing',completedBatches:batchNumber,totalBatches,updatedAt:Date.now()},{merge:true});
        await batch.commit();
      }
      const processVersion=`process-edit-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const finalBatch=window._writeBatch();
      finalBatch.update(orderReference,{
        processVersion,processCount:prepared.activeCount,
        processEditJobId:window._deleteField(),processEditStatus:'ready',
        processEditCompletedAt:Date.now(),processEditCompletedBy:(currentUserName()||currentUserId()).slice(0,200)
      });
      finalBatch.set(jobReference,{status:'ready',phase:'complete',completedAt:Date.now(),processVersion,totalBatches,updatedAt:Date.now()},{merge:true});
      await finalBatch.commit();
      await window.PCMSOrderProcessCache?.remove?.(order.id);
      try{
        await window.saveOperationLogToFB?.({
          permissionKey:'productionProcessEdit',feature:'productionProcessEdit',action:'orderProcessSnapshotSync',status:'success',
          itemCount:job.targetCodes.length,detailCount:prepared.writes.length,
          note:`${order.orderId||order.id}｜${master.mode}｜${master.reason}`
        });
      }catch(error){ console.error('Không thể lưu lịch sử đồng bộ đơn hàng / 無法保存訂單同步紀錄',error); }
      return {jobId,orderId:order.id,orderNo:order.orderId||order.id,writeCount:prepared.writes.length,status:'ready'};
    }catch(error){
      try{ await updateModificationJob(jobId,{status:'failed',errorCode:String(error.code||'sync-failed').slice(0,100),updatedAt:Date.now()}); }catch(_){ }
      error.processEditJobId=jobId;
      throw error;
    }
  }

  async function correctProductionEntries(master,onProgress){
    const corrections=master.correctionData&&typeof master.correctionData==='object'?master.correctionData:{};
    const operatorName=(currentUserName()||currentUserId()).slice(0,200);
    const affectedRows=[];
    let completed=0;
    let batchesCompleted=0;
    let lockedSkipped=0;
    await queryProductionEntries(corrections,{collect:false,onPage:async rows=>{
      const partition=await partitionRowsByEditableMonth(rows);
      rows=partition.editableRows;
      lockedSkipped+=partition.lockedRows.length;
      const writes=[];
      const alreadyCorrected=rows.filter(row=>row.standardCorrectionJobId===master.jobId).length;
      completed+=alreadyCorrected;
      rows.forEach(row=>{
        const correction=corrections[row.productCode]?.[String(row.processNo)];
        if(!correction||row.standardCorrectionJobId===master.jobId) return;
        const now=Date.now();
        const data={
          originalProcessSecSnapshot:Number(row.originalProcessSecSnapshot)||Number(row.processSecSnapshot),
          originalHourlyCapacitySnapshot:Number(row.originalHourlyCapacitySnapshot)||Number(row.hourlyCapacitySnapshot),
          processSecSnapshot:Number(correction.seconds),hourlyCapacitySnapshot:Number(correction.hourlyCapacity),
          standardCorrectionJobId:master.jobId,standardCorrectionReason:master.reason,
          standardCorrectedAt:now,standardCorrectedByUid:currentUserId(),standardCorrectedBy:operatorName,
          revision:(Number(row.revision)||1)+1,updatedAt:now,updatedByUid:currentUserId(),updatedBy:operatorName,
          calculationVersion:'hourly-capacity-v2-standard-correction'
        };
        writes.push({reference:window._docRef(ENTRY_COLLECTION,row.id),data,row:{...row,...data}});
      });
      const writesByMonth=new Map();
      writes.forEach(write=>{
        const month=window.PCMSProductionGuards.monthFromDate(write.row.productionDate);
        if(!writesByMonth.has(month)) writesByMonth.set(month,[]);
        writesByMonth.get(month).push(write);
      });
      for(const monthWrites of writesByMonth.values()){
        for(let offset=0;offset<monthWrites.length;offset+=WRITE_BATCH_SIZE){
          const batch=window._writeBatch();
          const current=monthWrites.slice(offset,offset+WRITE_BATCH_SIZE);
          const versionAt=Date.now();
          const version=window.PCMSProductionGuards.sourceVersionToken();
          current.forEach(write=>batch.update(write.reference,write.data));
          batch.set(window.PCMSProductionGuards.monthSourceVersionReference(current[0].row.productionDate),
            window.PCMSProductionGuards.entriesMonthSourceVersionData(current[0].row.productionDate,version,versionAt,currentUserId()),
            {merge:true});
          batch.set(window._docRef(EDIT_JOB_COLLECTION,master.jobId),{
            status:'syncing',phase:'entries',correctedEntries:completed+current.length,
            completedBatches:batchesCompleted+1,updatedAt:versionAt
          },{merge:true});
          await batch.commit();
          completed+=current.length;
          batchesCompleted+=1;
          affectedRows.push(...current.map(write=>write.row));
          await window.PCMSProductionChanges?.markSafely?.(current.map(write=>write.row));
          if(typeof onProgress==='function') onProgress({phase:'entries',completed,total:Number(master.affectedEntries)||completed});
        }
      }
      if(!writes.length&&alreadyCorrected&&typeof onProgress==='function'){
        onProgress({phase:'entries',completed,total:Number(master.affectedEntries)||completed});
      }
    }});
    if(typeof window.saveOperationLogToFB!=='function'){
      throw new Error('Không thể ghi lịch sử thao tác; công việc chưa hoàn tất. / 無法寫入操作紀錄，工作尚未完成。');
    }
    const logResult=await window.saveOperationLogToFB({
      permissionKey:'productionProcessEdit',feature:'productionProcessEdit',action:'productionEntryStandardCorrection',status:'success',
      itemCount:completed,detailCount:Object.values(corrections).reduce((sum,item)=>sum+Object.keys(item||{}).length,0),
      note:`${master.jobId}｜${master.reason}`
    });
    if(logResult===false){
      throw new Error('Không thể ghi lịch sử thao tác; công việc chưa hoàn tất. / 無法寫入操作紀錄，工作尚未完成。');
    }
    return {correctedEntries:completed,batchesCompleted,affectedRows,lockedSkipped};
  }

  async function runModificationJob(jobId,options={}){
    let master=await loadModificationJob(jobId);
    if(!master||master.jobType!=='master') throw new Error('Không tìm thấy công việc sửa công đoạn. / 找不到工序修改工作。');
    if(master.createdByUid!==currentUserId()) throw new Error('Không thể tiếp tục công việc của người khác. / 無法繼續其他人的修改工作。');
    if(master.status==='ready') return {status:'ready',jobId,completedOrders:master.completedOrders,correctedEntries:master.correctedEntries};
    const orders=Array.isArray(options.orders)&&options.orders.length
      ? options.orders
      : await activeOrdersForProducts(master.targetCodes,{force:true});
    await updateModificationJob(jobId,{status:'syncing',phase:'orders',affectedOrders:orders.length,updatedAt:Date.now(),errorCode:''});
    const failures=[];
    let completedOrders=0;
    for(const order of orders){
      if(typeof options.onProgress==='function') options.onProgress({phase:'orders',completed:completedOrders,total:orders.length,current:order.orderId||order.id});
      try{
        await syncOrderSnapshot({masterJobId:jobId,order,targetCodes:order.matchedCodes});
        completedOrders+=1;
        await updateModificationJob(jobId,{completedOrders,updatedAt:Date.now()});
      }catch(error){ failures.push({order,error}); }
    }
    if(failures.length){
      const failedOrders=failures.slice(0,200).map(item=>String(item.order.orderId||item.order.id));
      await updateModificationJob(jobId,{status:'partial',phase:'orders',completedOrders,failedOrders,updatedAt:Date.now(),errorCode:'order-sync-partial'});
      return {status:'partial',jobId,completedOrders,totalOrders:orders.length,failures};
    }
    master=await loadModificationJob(jobId);
    let correctionResult={correctedEntries:0,batchesCompleted:0};
    try{
      if(master.mode===EDIT_MODES.STANDARD_CORRECTION){
        await updateModificationJob(jobId,{status:'syncing',phase:'entries',failedOrders:[],updatedAt:Date.now()});
        correctionResult=await correctProductionEntries(master,options.onProgress);
      }
      await updateModificationJob(jobId,{
        status:'ready',phase:'complete',completedOrders:orders.length,failedOrders:[],
        correctedEntries:correctionResult.correctedEntries,completedAt:Date.now(),updatedAt:Date.now(),errorCode:''
      });
      if(typeof options.onProgress==='function') options.onProgress({phase:'complete',completed:1,total:1});
      return {status:'ready',jobId,completedOrders:orders.length,totalOrders:orders.length,...correctionResult};
    }catch(error){
      await updateModificationJob(jobId,{status:'failed',phase:'entries',updatedAt:Date.now(),errorCode:String(error.code||'entry-correction-failed').slice(0,100)});
      error.processEditJobId=jobId;
      throw error;
    }
  }

  async function retryOrderSnapshot(jobId){
    const child=await loadModificationJob(jobId);
    if(!child?.masterJobId) throw new Error('Không tìm thấy công việc đơn hàng. / 找不到訂單同步工作。');
    return syncOrderSnapshot({masterJobId:child.masterJobId,orderId:child.orderId});
  }

  async function resumeModificationJob(jobId,options={}){ return runModificationJob(jobId,options); }

  function reset(){ groups=[]; loaded=false; loadPromise=null; }

  window.PCMSProcessEditStore=Object.freeze({
    loadGroups,listGroups,groupForProduct,findCandidates,createGroup,updateGroupMembers,renameGroup,deleteGroup,
    EDIT_MODES,normalizeMode,modificationReason,validateOperations,saveOfficialProcesses,saveOfficialSeconds,loadVersions,loadVersionSnapshot,
    activeOrdersForProducts,analyzeImpact,loadModificationJob,loadPendingModificationJobs,
    syncOrderSnapshot,retryOrderSnapshot,resumeModificationJob,reset
  });
})();
