// order-service（訂單服務）：訂單只保存自己的資料；款號與工序正式內容一律由 Product Master 解析。
(function(){
  'use strict';

  const COLLECTIONS=Object.freeze({orders:'orders',items:'orderItems',locks:'orderImportLocks',totals:'productionProcessTotals',logs:'operationLogs'});
  // BATCH_SIZE（每批明細上限）：本機安全規則實測全部角色可處理 8 款，第 9 款已超過一般角色核對預算。
  const BATCH_SIZE=8;
  const importingOrders=new Set(); // importingOrders（本頁正在匯入的訂單）：防止重複啟動。

  function text(value){ return String(value??'').trim().replace(/\s+/g,' '); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }
  function itemStore(){
    if(!window.PCMSOrderItemStore) throw new Error('Thiếu mô hình dòng đơn hàng. / 缺少訂單項目資料模型。');
    return window.PCMSOrderItemStore;
  }
  function actor(input={}){
    const uid=text(input.uid||input.userId||window.firebaseAuthUser?.uid);
    const name=text(input.name||input.userName||window.cu?.user||window.cu?.username||uid).slice(0,200);
    if(!uid) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    return {uid,name};
  }
  function timestamp(value){
    if(value===undefined||value===null||value==='') return null;
    if(Number.isFinite(Number(value))&&Number(value)>100000000000) return Number(value);
    const parsed=value instanceof Date?value.getTime():new Date(value).getTime();
    if(!Number.isFinite(parsed)) throw new Error('Ngày của đơn hàng không hợp lệ. / 訂單日期不正確。');
    return parsed;
  }
  function orderNumberKey(value){
    const normalized=text(value).normalize('NFKC').toUpperCase();
    if(!normalized||normalized.length>200) throw new Error('Số đơn hàng không hợp lệ. / 訂單號碼不正確。');
    return model().safeProductCodeKey(normalized).replace(/^pcode_/,'order_');
  }
  function normalizeHeader(input={}){
    const orderId=text(input.orderId||input.orderNo);
    const client=text(input.client);
    if(!orderId) throw new Error('Vui lòng nhập số đơn hàng. / 請輸入訂單號碼。');
    if(!client||client.length>200) throw new Error('Khách hàng của đơn hàng không hợp lệ. / 訂單客戶不正確。');
    const dueDate=timestamp(input.dueDate);
    if(!dueDate) throw new Error('Vui lòng nhập ngày giao hàng. / 請輸入交期。');
    return {
      orderId,client,dueDate,
      completionDate:timestamp(input.completionDate),shipDate:timestamp(input.shipDate),actualShipDate:timestamp(input.actualShipDate),
      remark:text(input.remark).slice(0,500),notes:text(input.notes).slice(0,500)
    };
  }

  function prepareImport(headerInput,rows,options={}){
    const header=normalizeHeader(headerInput);
    const orderDocumentId=text(options.orderDocumentId||headerInput.orderDocumentId);
    if(!orderDocumentId) throw new Error('Thiếu mã định danh nội bộ của đơn hàng. / 缺少訂單內部識別碼。');
    const sourceKey=options.sourceKey||`order-import\u001f${header.orderId}\u001f${orderDocumentId}`;
    const items=itemStore().prepareOrderItems(orderDocumentId,rows,{sourceKey,
      sourceKeys:(Array.isArray(rows)?rows:[]).map((row,index)=>`${sourceKey}\u001frow\u001f${text(row?.sourceRowId||row?.legacySourceKey||row?.lineNumber||index+1)}`)});
    const totalQty=items.reduce((sum,item)=>sum+item.quantity,0);
    return {
      orderDocumentId,lockId:orderNumberKey(header.orderId),header,items,
      order:{...header,importLockId:orderNumberKey(header.orderId),itemCount:items.length,totalQty,
        importStatus:'importing',lifecycleStatus:'active',schemaVersion:2}
    };
  }

  function importLog(plan,currentActor,now,fileName='',operationLogId=''){
    return {
      permissionKey:'progress',feature:'orders',action:'orderImport',status:'success',targetType:'order',
      targetId:plan.orderDocumentId,itemCount:plan.items.length,detailCount:plan.items.length,fileName:text(fileName).slice(0,300),
      note:plan.header.orderId,createdAt:now,createdByUid:currentActor.uid,createdBy:currentActor.name,
      operationLogId:text(operationLogId),schemaVersion:2
    };
  }
  function requireCloud(){
    for(const name of ['_runTransaction','_docRef','_newDocRef','_writeBatch']){
      if(typeof window[name]!=='function') throw new Error('Dịch vụ cơ sở dữ liệu chưa sẵn sàng. / 雲端資料庫服務尚未載入。');
    }
  }

  function importFailure(code,vi,zh){
    return Object.assign(new Error(`${vi} / ${zh}`),{code,orderImportMessage:{vi,zh}});
  }
  function changedImport(){
    return importFailure('order-import-mismatch','Tệp hoặc dữ liệu đơn hàng không khớp. Không ghi đè; hãy dùng lại tệp và thông tin ban đầu.',
      '檔案或訂單資料不一致，已停止覆寫；請使用原始檔案與原訂單資料。');
  }
  // canonical（穩定內容序列）：只用於比對訂單內容，不建立另一套資料版本或快取。
  function canonical(value){
    if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  async function importFingerprint(plan){
    if(!window.crypto?.subtle) throw importFailure('order-import-unavailable',
      'Không thể kiểm tra nội dung tệp trong trình duyệt này.','此瀏覽器無法完成檔案內容核對。');
    const content=canonical({header:plan.header,items:plan.items});
    const digest=await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
    return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
  }
  function checkImportOwner(lock,currentActor){
    if(lock.createdByUid!==currentActor.uid) throw importFailure('order-import-owner',
      'Đơn này đang được nhập bằng tài khoản khác. Hãy dùng tài khoản bắt đầu nhập.',
      '此訂單由其他帳號開始匯入，請由原匯入帳號接續。');
    if(!['importing','ready'].includes(lock.status)) throw changedImport();
  }
  function checkImportOrder(order,plan,currentActor){
    if(!order||order.createdByUid!==currentActor.uid||order.schemaVersion!==2) throw changedImport();
    for(const [field,value] of Object.entries(plan.order)){
      if(field!=='importStatus'&&canonical(order[field])!==canonical(value)) throw changedImport();
    }
  }
  function checkedCheckpoint(lock,plan,fingerprint,currentActor){
    checkImportOwner(lock,currentActor);
    if(lock.importFingerprint!==fingerprint||lock.orderDocumentId!==plan.orderDocumentId
      ||!Number.isSafeInteger(lock.completedItems)||lock.completedItems<0||lock.completedItems>plan.items.length) throw changedImport();
    return lock.completedItems;
  }

  // importOrder（匯入訂單）：每批明細與檢查點一起提交，最後才發布訂單、操作紀錄與既有訂單快取版本。
  async function importOrder(headerInput,rows,options={}){
    requireCloud();
    const currentActor=actor(options.actor);
    const lockId=orderNumberKey(headerInput.orderId||headerInput.orderNo);
    if(importingOrders.has(lockId)) throw importFailure('order-import-busy',
      'Đơn này đang được nhập. Vui lòng chờ.','此訂單正在匯入，請等候目前工作完成。');
    importingOrders.add(lockId);
    const progress={completedItems:0,totalItems:Array.isArray(rows)?rows.length:0,phase:'checking'};
    let plan,fingerprint,initialLock,orderReference;
    const lockReference=window._docRef(COLLECTIONS.locks,lockId);
    try{
      const candidateId=window._newDocRef(COLLECTIONS.orders).id;
      const startedAt=Number(options.now)||Date.now();
      await window._runTransaction(async transaction=>{
        const snapshot=await transaction.get(lockReference);
        initialLock=snapshot.exists()?snapshot.data():null;
        let repairedLock=null;
        // 先核對訂單狀態，再判斷接續帳號；不可把已完成訂單誤報為匯入中。
        if(initialLock){
          const existing=await transaction.get(window._docRef(COLLECTIONS.orders,text(initialLock.orderDocumentId)));
          if(existing.exists()){
            const state=existing.data();
            if(state.lifecycleStatus==='deleting') throw importFailure('order-import-deleting',
              'Đơn đang được xóa vĩnh viễn. Hãy hoàn tất xóa trước khi nhập lại.',
              '此訂單正在永久刪除，請完成刪除後再重新匯入。');
            if(state.lifecycleStatus==='archived') throw importFailure('order-import-archived',
              'Đơn đã được lưu trữ. Hãy khôi phục hoặc hoàn tất xóa vĩnh viễn trước.',
              '此訂單已封存，請先還原或完成永久刪除。');
            if(state.importStatus==='ready'||initialLock.status==='ready') throw importFailure('order-import-exists',
              'Đơn này đã tồn tại và đã nhập hoàn tất.', '此訂單已存在，且已完成匯入。');
          }else{
            const deleted=await transaction.get(window._docRef(COLLECTIONS.logs,`${initialLock.orderDocumentId}__purge_complete`));
            const proof=deleted.exists()?deleted.data():null;
            if(proof&&proof.schemaVersion===2&&proof.feature==='orders'&&proof.permissionKey==='progress'
              &&proof.action==='orderPurgeCompleted'&&proof.status==='success'&&proof.targetType==='order'
              &&proof.targetId===initialLock.orderDocumentId&&proof.operationLogId===deleted.id
              &&proof.note===initialLock.orderNo&&proof.createdAt>=initialLock.createdAt){
              repairedLock=initialLock;initialLock=null;
            }
            // 保留舊版先建立鎖定、尚未建立訂單的原帳號接續方式。
            if(initialLock&&(proof||initialLock.importFingerprint||initialLock.status!=='importing')) throw importFailure('order-import-orphan',
              'Không tìm thấy đơn tương ứng hoặc xác nhận xóa. Đã dừng nhập để kiểm tra.',
              '找不到鎖定對應的訂單或刪除完成證明，已停止匯入，需核對資料。');
          }
          if(initialLock) checkImportOwner(initialLock,currentActor);
        }
        const orderDocumentId=initialLock?text(initialLock.orderDocumentId):candidateId;
        plan=prepareImport(headerInput,rows,{...options,orderDocumentId});
        fingerprint=await importFingerprint(plan);
        orderReference=window._docRef(COLLECTIONS.orders,orderDocumentId);
        if(initialLock){
          if(initialLock.importFingerprint&&initialLock.importFingerprint!==fingerprint) throw changedImport();
          if(initialLock.status==='ready') throw importFailure('order-import-exists',
            'Đơn này đã được nhập hoàn tất. Hãy kiểm tra danh sách đơn hàng.',
            '此訂單已完成匯入，請查看訂單清單，無需再次匯入。');
          return;
        }
        // 驗證與內容指紋成功後才建立正式匯入狀態；尚未發布訂單快取版本。
        transaction.set(orderReference,{...plan.order,createdAt:startedAt,createdByUid:currentActor.uid,createdBy:currentActor.name,
          updatedAt:startedAt,updatedByUid:currentActor.uid});
        const repairLogId=repairedLock?`${candidateId}__lockRepair`:null;
        transaction.set(lockReference,{...(repairLogId?{repairLogId}:{}),lockId,orderNo:plan.header.orderId,orderDocumentId,status:'importing',
          completedItems:0,completedBatches:0,totalBatches:Math.ceil(plan.items.length/BATCH_SIZE),
          importFingerprint:fingerprint,createdAt:startedAt,createdByUid:currentActor.uid,createdBy:currentActor.name});
        if(repairedLock) transaction.set(window._docRef(COLLECTIONS.logs,repairLogId),{
          schemaVersion:2,permissionKey:'progress',feature:'orders',action:'orderImportLockRepair',status:'success',
          targetType:'order',targetId:candidateId,oldOrderId:repairedLock.orderDocumentId,lockId,
          operationLogId:repairLogId,itemCount:1,detailCount:1,createdAt:startedAt,
          createdByUid:currentActor.uid,createdBy:currentActor.name
        });
      },{skipDataVersions:true});
      if(initialLock){
        progress.phase='resuming';
        // 續跑只讀本張訂單，最多原檔筆數加一；逐筆核對，舊版 400 筆檢查點不直接換算成新版批次。
        const existing=await window._getDocs(window._query(window._collection(COLLECTIONS.items),
          window._where('orderId','==',plan.orderDocumentId),window._limit(plan.items.length+1)));
        const saved=new Map((existing.docs||[]).map(item=>[item.id,item.data()]));
        if(saved.size>plan.items.length) throw changedImport();
        for(let index=0;index<saved.size;index++){
          const expected=plan.items[index];
          const actual=saved.get(expected.orderItemId);
          if(!actual||actual.revision!==1||actual.createdByUid!==currentActor.uid) throw changedImport();
          const fields=['orderItemId','orderId','productId','quantity','lineNumber','active',...itemStore().ORDER_OWNED_FIELDS];
          if(fields.some(field=>canonical(actual[field])!==canonical(expected[field]))) throw changedImport();
        }
        await window._runTransaction(async transaction=>{
          const [lockSnapshot,orderSnapshot]=await Promise.all([lockReference,orderReference].map(ref=>transaction.get(ref)));
          const lock=lockSnapshot.exists()?lockSnapshot.data():null;
          if(!lock||canonical(lock)!==canonical(initialLock)) throw importFailure('order-import-changed',
            'Tiến độ đã thay đổi ở cửa sổ khác. Hãy thử lại để kiểm tra.',
            '其他視窗已更新匯入進度，請重試以重新核對。');
          checkImportOwner(lock,currentActor);
          if(orderSnapshot.exists()){
            checkImportOrder(orderSnapshot.data(),plan,currentActor);
            if(orderSnapshot.data().importStatus!=='importing') throw changedImport();
          }else{
            if(saved.size) throw changedImport();
            transaction.set(orderReference,{...plan.order,createdAt:lock.createdAt,createdByUid:lock.createdByUid,
              createdBy:lock.createdBy,updatedAt:Date.now(),updatedByUid:currentActor.uid});
          }
          if(lock.importFingerprint){
            if(checkedCheckpoint(lock,plan,fingerprint,currentActor)!==saved.size) throw changedImport();
          }else{
            transaction.set(lockReference,{importFingerprint:fingerprint,completedItems:saved.size,
              completedBatches:Math.ceil(saved.size/BATCH_SIZE),totalBatches:Math.ceil(plan.items.length/BATCH_SIZE),
              updatedAt:Date.now(),updatedByUid:currentActor.uid},{merge:true});
          }
        },{skipDataVersions:true});
        progress.completedItems=saved.size;
      }
      const report=()=>options.onProgress?.({...progress,itemCount:progress.completedItems,
        completedBatches:Math.ceil(progress.completedItems/BATCH_SIZE),totalBatches:Math.ceil(plan.items.length/BATCH_SIZE)});
      progress.phase='writing';report();
      while(progress.completedItems<plan.items.length){
        progress.completedItems=await window._runTransaction(async transaction=>{
          const [lockSnapshot,orderSnapshot]=await Promise.all([lockReference,orderReference].map(ref=>transaction.get(ref)));
          if(!lockSnapshot.exists()||!orderSnapshot.exists()) throw changedImport();
          const lock=lockSnapshot.data();const order=orderSnapshot.data();
          const offset=checkedCheckpoint(lock,plan,fingerprint,currentActor);
          checkImportOrder(order,plan,currentActor);
          if(lock.status==='ready'&&order.importStatus==='ready'&&offset===plan.items.length) return offset;
          if(lock.status!=='importing'||order.importStatus!=='importing') throw changedImport();
          const end=Math.min(offset+BATCH_SIZE,plan.items.length);
          const now=Date.now();
          plan.items.slice(offset,end).forEach(item=>transaction.set(window._docRef(COLLECTIONS.items,item.orderItemId),{
            ...item,revision:1,createdAt:now,createdByUid:currentActor.uid,updatedAt:now,updatedByUid:currentActor.uid
          }));
          transaction.set(lockReference,{completedItems:end,completedBatches:Math.ceil(end/BATCH_SIZE),
            totalBatches:Math.ceil(plan.items.length/BATCH_SIZE),updatedAt:now,updatedByUid:currentActor.uid},{merge:true});
          return end;
        },{skipDataVersions:true});
        report();
      }
      progress.phase='finalizing';report();
      const logId=`${plan.orderDocumentId}__orderImport`;
      const logReference=window._docRef(COLLECTIONS.logs,logId);
      const completedAt=await window._runTransaction(async transaction=>{
        const [lockSnapshot,orderSnapshot]=await Promise.all([lockReference,orderReference].map(ref=>transaction.get(ref)));
        if(!lockSnapshot.exists()||!orderSnapshot.exists()) throw changedImport();
        const lock=lockSnapshot.data();const order=orderSnapshot.data();
        if(checkedCheckpoint(lock,plan,fingerprint,currentActor)!==plan.items.length) throw changedImport();
        checkImportOrder(order,plan,currentActor);
        if(lock.status==='ready'&&order.importStatus==='ready') return order.importCompletedAt;
        if(lock.status!=='importing'||order.importStatus!=='importing') throw changedImport();
        const now=Date.now();
        transaction.set(orderReference,{importStatus:'ready',importCompletedAt:now,updatedAt:now,
          updatedByUid:currentActor.uid,operationLogId:logId},{merge:true});
        transaction.set(logReference,importLog(plan,currentActor,now,options.fileName,logId));
        transaction.set(lockReference,{status:'ready',completedAt:now,updatedAt:now,
          updatedByUid:currentActor.uid,operationLogId:logId},{merge:true});
        return now;
      });
      return clone({id:plan.orderDocumentId,...plan.order,importStatus:'ready',importCompletedAt:completedAt,
        operationLogId:logId,items:plan.items});
    }catch(error){
      if(progress.phase!=='checking') error.orderImportProgress={...progress};
      throw error;
    }finally{importingOrders.delete(lockId);}
  }

  function documentRows(snapshot){ return (snapshot?.docs||[]).map(item=>({id:item.id,...item.data()})); }
  async function loadOrderItems(orderId){
    const target=text(orderId);
    const snapshot=await window._getDocs(window._query(window._collection(COLLECTIONS.items),window._where('orderId','==',target)));
    return documentRows(snapshot).map((row,index)=>({
      ...itemStore().normalizeOrderItem(target,{orderItemId:row.id,...row},index),revision:Number(row.revision)||1
    }));
  }
  async function loadProductsByIds(productIds){
    const snapshots=await Promise.all(productIds.map(id=>window._getDoc(window._docRef('products',id))));
    return snapshots.map((snapshot,index)=>snapshot.exists()?{productId:productIds[index],...snapshot.data()}:null).filter(Boolean);
  }
  function efficiency(){
    if(!window.PCMSProductionEfficiencyCore) throw new Error('Thiếu công thức hiệu suất dùng chung. / 缺少共用績效公式。');
    return window.PCMSProductionEfficiencyCore;
  }
  async function loadProcessViews(orderId,options={}){
    const target=text(orderId);
    const [items,orderSnapshot]=await Promise.all([
      loadOrderItems(target),options.order?Promise.resolve(null):window._getDoc(window._docRef(COLLECTIONS.orders,target))
    ]);
    const order=options.order||(orderSnapshot?.exists?.()?{id:target,...orderSnapshot.data()}:null);
    if(!order) throw new Error('Không tìm thấy đơn hàng. / 找不到訂單。');
    const resolver=window.PCMSProductResolver.create({loadProductsByIds,efficiencyCore:efficiency(),workSeconds:Number(window.S?.ws)||3000});
    const resolved=await resolver.resolve(items);
    if(resolved.exceptions.length){
      const error=new Error('Có dòng đơn hàng không thể liên kết với mã hàng hiện tại. / 有訂單項目無法連結目前款號。');
      error.code='order-item-product-exception';error.exceptions=clone(resolved.exceptions);throw error;
    }
    const rows=[];
    resolved.rows.forEach(result=>{
      const item=result.source;const product=result.resolved.product;
      (product.ops||[]).filter(operation=>operation.active!==false).forEach(operation=>{
        const processId=model().fixedId(operation.processId,'process');
        rows.push({
          id:itemStore().processTotalId(item.orderItemId,processId),processTotalId:itemStore().processTotalId(item.orderItemId,processId),
          orderId:target,orderNo:text(order.orderId||target),orderItemId:item.orderItemId,orderItemRevision:Number(item.revision)||1,
          productId:item.productId,processId,code:product.code,desc:item.description,color:item.color,po:item.po,
          lineNumber:item.lineNumber,orderQty:item.quantity,processNo:operation.no,processSortOrder:operation.sortOrder,
          processCategory:operation.category,processZh:operation.zh,processVi:operation.vi,processSec:operation.sec,
          workStdSec:operation.sec,slPerHour:efficiency().hourlyCapacity(operation.sec,Number(window.S?.ws)||3000)
        });
      });
    });
    return rows.sort((left,right)=>Number(left.lineNumber)-Number(right.lineNumber)
      ||Number(left.processSortOrder)-Number(right.processSortOrder));
  }

  async function updateItemQuantity(currentInput,nextQuantity,options={}){
    requireCloud();
    const currentActor=actor(options.actor);
    const logReference=window._newDocRef(COLLECTIONS.logs);
    const operationLogId=text(logReference.id);
    const itemId=model().fixedId(currentInput?.orderItemId,'orderItem');
    if(!itemId) throw new Error('Dòng đơn hàng không hợp lệ. / 訂單項目不正確。');
    let saved;
    await window._runTransaction(async transaction=>{
      const itemReference=window._docRef(COLLECTIONS.items,itemId);
      const itemSnapshot=await transaction.get(itemReference);
      if(!itemSnapshot.exists()) throw new Error('Không tìm thấy dòng đơn hàng. / 找不到訂單項目。');
      const remote={orderItemId:itemId,...itemSnapshot.data()};
      if(Number(remote.revision||1)!==Number(currentInput.revision||1)) throw new Error('Dòng đơn hàng đã được người khác sửa. / 訂單項目已由其他人修改。');
      const productReference=window._docRef('products',model().fixedId(remote.productId,'product'));
      const productSnapshot=await transaction.get(productReference);
      if(!productSnapshot.exists()||productSnapshot.data()?.active===false){
        throw new Error('Không tìm thấy dữ liệu mã hàng hiện tại. / 找不到目前款號主檔。');
      }
      const processIds=[...new Set((productSnapshot.data()?.ops||[])
        .filter(operation=>operation?.active!==false)
        .map(operation=>model().fixedId(operation?.processId,'process'))
        .filter(Boolean))];
      const totalReferences=processIds.map(processId=>window._docRef(COLLECTIONS.totals,itemStore().processTotalId(itemId,processId)));
      const orderReference=window._docRef(COLLECTIONS.orders,remote.orderId);
      const [orderSnapshot,...totalSnapshots]=await Promise.all([orderReference,...totalReferences].map(reference=>transaction.get(reference)));
      if(!orderSnapshot.exists()) throw new Error('Không tìm thấy đơn hàng. / 找不到訂單。');
      const totals=totalSnapshots.map((snapshot,index)=>snapshot.exists()
        ?{id:totalReferences[index].id,...snapshot.data()}:null).filter(Boolean);
      saved={...itemStore().validateQuantityChange(remote,nextQuantity,totals),revision:Number(remote.revision||1)+1,
        operationLogId};
      const now=Date.now();
      transaction.set(itemReference,{quantity:saved.quantity,revision:saved.revision,updatedAt:now,
        updatedByUid:currentActor.uid,operationLogId},{merge:true});
      transaction.set(orderReference,{totalQty:(Number(orderSnapshot.data()?.totalQty)||0)-Number(remote.quantity)+saved.quantity,
        updatedAt:now,updatedByUid:currentActor.uid,operationLogId},{merge:true});
      transaction.set(logReference,{permissionKey:'progress',feature:'orders',action:'orderItemQuantityUpdate',
        status:'success',targetType:'orderItem',targetId:itemId,itemCount:1,detailCount:1,createdAt:now,
        createdByUid:currentActor.uid,createdBy:currentActor.name,changes:[{field:'quantity',before:remote.quantity,after:saved.quantity}],
        note:text(options.reason).slice(0,500),operationLogId,schemaVersion:2});
    },{skipDataVersions:true});
    return clone(saved);
  }

  const ORDER_EDIT_FIELDS=Object.freeze(new Set([
    'dueDate','completionDate','shipDate','actualShipDate','remark','notes'
  ]));
  async function updateOrder(orderId,changes={},options={}){
    requireCloud();
    const target=text(orderId);
    if(!target) throw new Error('Đơn hàng không hợp lệ. / 訂單識別碼不正確。');
    const allowed={};
    Object.entries(changes||{}).forEach(([field,value])=>{
      if(!ORDER_EDIT_FIELDS.has(field)) throw new Error('Trường đơn hàng không được phép sửa. / 不允許修改此訂單欄位。');
      allowed[field]=field==='remark'||field==='notes'?text(value).slice(0,500):timestamp(value);
    });
    if(!Object.keys(allowed).length) return null;
    const currentActor=actor(options.actor);
    const now=Number(options.now)||Date.now();
    const logReference=window._newDocRef(COLLECTIONS.logs);
    const operationLogId=text(logReference.id);
    let saved;
    await window._runTransaction(async transaction=>{
      const orderReference=window._docRef(COLLECTIONS.orders,target);
      const snapshot=await transaction.get(orderReference);
      if(!snapshot.exists()||snapshot.data()?.schemaVersion!==2) throw new Error('Không tìm thấy đơn hàng hiện tại. / 找不到目前訂單。');
      saved={id:target,...snapshot.data(),...allowed,updatedAt:now,updatedByUid:currentActor.uid,operationLogId};
      transaction.set(orderReference,{...allowed,updatedAt:now,updatedByUid:currentActor.uid,operationLogId},{merge:true});
      transaction.set(logReference,{
        permissionKey:'progress',feature:'orders',action:'orderUpdate',status:'success',targetType:'order',targetId:target,
        itemCount:1,detailCount:Object.keys(allowed).length,changes:Object.entries(allowed).slice(0,50).map(([field,after])=>({field,after})),
        note:text(options.note).slice(0,500),createdAt:now,createdByUid:currentActor.uid,createdBy:currentActor.name,
        operationLogId,schemaVersion:2
      });
    },{skipDataVersions:true});
    return clone(saved);
  }

  async function setLifecycle(orderId,status,options={}){
    requireCloud();
    const target=text(orderId);
    if(!['active','archived'].includes(status)) throw new Error('Trạng thái đơn hàng không hợp lệ. / 訂單狀態不正確。');
    const currentActor=actor(options.actor);
    const now=Number(options.now)||Date.now();
    const logReference=window._newDocRef(COLLECTIONS.logs);
    const operationLogId=text(logReference.id);
    let saved;
    await window._runTransaction(async transaction=>{
      const orderReference=window._docRef(COLLECTIONS.orders,target);
      const snapshot=await transaction.get(orderReference);
      if(!snapshot.exists()||snapshot.data()?.schemaVersion!==2) throw new Error('Không tìm thấy đơn hàng hiện tại. / 找不到目前訂單。');
      const before=snapshot.data();
      if(before.lifecycleStatus===status){ saved={id:target,...before};return; }
      if(!['active','archived'].includes(before.lifecycleStatus)) throw new Error('Trạng thái đơn hàng đã thay đổi. / 訂單狀態已變更。');
      const action=status==='archived'?'orderArchive':'orderRestore';
      saved={id:target,...before,lifecycleStatus:status,updatedAt:now,updatedByUid:currentActor.uid,operationLogId};
      transaction.set(orderReference,{lifecycleStatus:status,updatedAt:now,updatedByUid:currentActor.uid,operationLogId},{merge:true});
      transaction.set(logReference,{
        permissionKey:'progress',feature:'orders',action,status:'success',targetType:'order',targetId:target,
        itemCount:1,detailCount:1,changes:[{field:'lifecycleStatus',before:before.lifecycleStatus,after:status}],
        note:text(options.note).slice(0,500),createdAt:now,createdByUid:currentActor.uid,createdBy:currentActor.name,
        operationLogId,schemaVersion:2
      });
    });
    return clone(saved);
  }

  const PURGE_BATCH_SIZE=100; // 每次最多刪除 100 筆，只處理訂單明細，不推論業務關聯。
  const purgingOrders=new Set();
  async function purgeOrder(orderId,options={}){
    requireCloud();
    if(window.cu?.role!=='admin') throw new Error('Chỉ quản trị viên được xóa vĩnh viễn. / 只有管理員可永久刪除。');
    const id=text(orderId), user=actor();
    if(!id||purgingOrders.has(id)) throw new Error('Đang xử lý đơn hàng. / 訂單正在處理中。');
    purgingOrders.add(id);
    const ref=window._docRef(COLLECTIONS.orders,id);
    const finalRef=window._docRef(COLLECTIONS.logs,`${id}__purge_complete`);
    const log=(logRef,order,action,itemIds=[])=>({
      schemaVersion:2,permissionKey:'progress',feature:'orders',action,status:'success',targetType:'order',targetId:id,
      operationLogId:logRef.id,createdAt:Date.now(),createdByUid:user.uid,createdBy:user.name,
      itemCount:action==='orderPurgeCompleted'?order.itemCount:itemIds.length,detailCount:itemIds.length,itemIds,
      note:text(order.orderId).slice(0,200)
    });
    const changed=()=>new Error('Trạng thái đơn hàng đã thay đổi. / 訂單狀態已變更。');
    try{
      await window._runTransaction(async tx=>{
        const snapshot=await tx.get(ref);
        if(!snapshot.exists()){
          if((await tx.get(finalRef)).exists()) return;
          throw changed();
        }
        const order=snapshot.data();
        if(order.lifecycleStatus==='deleting') return;
        if(order.lifecycleStatus!=='archived'||order.importStatus!=='ready'||order.schemaVersion!==2) throw changed();
        const startRef=window._docRef(COLLECTIONS.logs,`${id}__purge_start`);
        tx.set(ref,{lifecycleStatus:'deleting',operationLogId:startRef.id,updatedAt:Date.now(),updatedByUid:user.uid},{merge:true});
        tx.set(startRef,log(startRef,order,'orderPurgeStarted'));
      });
      let deletedThisRun=0;
      for(;;){
        const before=await window._getDoc(ref);
        if(!before.exists()){
          if((await window._getDoc(finalRef)).exists()) return {id,deleted:true};
          throw changed();
        }
        const order=before.data();
        if(order.lifecycleStatus!=='deleting') throw changed();
        const rows=await window._getDocs(window._query(window._collection(COLLECTIONS.items),
          window._where('orderId','==',id),window._limit(PURGE_BATCH_SIZE)));
        const ids=rows.docs.map(row=>row.id);
        const committed=await window._runTransaction(async tx=>{
          const snapshot=await tx.get(ref);
          if(!snapshot.exists()) return false;
          const current=snapshot.data();
          if(current.lifecycleStatus!=='deleting') throw changed();
          // 另一視窗已完成這批時重新查詢，避免以舊清單重複刪除。
          if(current.operationLogId!==order.operationLogId) return false;
          if(ids.length){
            const batchRef=window._newDocRef(COLLECTIONS.logs);
            tx.set(ref,{operationLogId:batchRef.id,updatedAt:Date.now(),updatedByUid:user.uid},{merge:true});
            ids.forEach(itemId=>tx.delete(window._docRef(COLLECTIONS.items,itemId)));
            tx.set(batchRef,log(batchRef,current,'orderPurgeBatch',ids));
          }else{
            const lockRef=window._docRef(COLLECTIONS.locks,current.importLockId);
            const lock=await tx.get(lockRef);
            if(!lock.exists()||lock.data().orderDocumentId!==id) throw changed();
            tx.set(finalRef,log(finalRef,current,'orderPurgeCompleted'));
            tx.delete(lockRef);tx.delete(ref);
          }
          return true;
        },{skipDataVersions:ids.length>0});
        if(!committed) continue;
        deletedThisRun+=ids.length;
        options.onProgress?.({deletedThisRun,totalItems:order.itemCount});
        if(!ids.length) return {id,deleted:true};
      }
    }finally{purgingOrders.delete(id);}
  }

  window.PCMSOrderService=Object.freeze({COLLECTIONS,BATCH_SIZE,PURGE_BATCH_SIZE,normalizeHeader,prepareImport,importOrder,loadOrderItems,loadProcessViews,
    updateItemQuantity,updateOrder,setLifecycle,purgeOrder});
})();
