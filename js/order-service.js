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
      order:{...header,actualShipDate:null,shipmentStatus:'pending',productionProgressCompleted:false,
        productionProgressSnapshotPercent:null,importLockId:orderNumberKey(header.orderId),itemCount:items.length,totalQty,
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
    return importFailure('order-import-mismatch','Trạng thái đơn hàng đã thay đổi. Hãy kiểm tra đơn rồi thử lại.',
      '訂單狀態已變更，請查看訂單後重試。');
  }
  // 正式訂單狀態優先於匯入鎖；鎖的操作者不是重匯的權限依據。
  function checkExistingOrderState(state){
    if(state.lifecycleStatus==='deleting'&&!['importing','failed'].includes(state.importStatus)) throw importFailure('order-import-deleting',
      'Đơn đang được xóa vĩnh viễn. Hãy hoàn tất xóa trước khi nhập lại.',
      '此訂單正在永久刪除，請完成刪除後再重新匯入。');
    if(state.lifecycleStatus==='archived') throw importFailure('order-import-archived',
      'Đơn đã tồn tại trong mục lưu trữ. Hãy khôi phục hoặc xóa vĩnh viễn trước.',
      '訂單已存在於封存區，請先還原或完成永久刪除。');
    if(!state.importStatus||state.importStatus==='ready') throw importFailure('order-import-exists',
      'Đơn này đã tồn tại và đã nhập hoàn tất.', '此訂單已存在，且已完成匯入。');
  }
  // importOrder（匯入訂單）：失敗的進行中資料先清理，成功後才發布正式訂單。
  async function importOrder(headerInput,rows,options={}){
    requireCloud();
    const currentActor=actor(options.actor);
    const lockId=orderNumberKey(headerInput.orderId||headerInput.orderNo);
    if(importingOrders.has(lockId)) throw importFailure('order-import-busy',
      'Đơn này đang được nhập. Vui lòng chờ.','此訂單正在匯入，請等候目前工作完成。');
    importingOrders.add(lockId);
    const progress={completedItems:0,totalItems:Array.isArray(rows)?rows.length:0,phase:'checking'};
    let plan,orderReference,attemptedCreate=false;
    const lockReference=window._docRef(COLLECTIONS.locks,lockId);
    try{
      // 正式單號與舊資料各查一次，包含封存；不能只看鎖指向的舊工作。
      const orderNo=text(headerInput.orderId||headerInput.orderNo);
      const [byKey,byNumber]=await Promise.all([
        window._getDocs(window._query(window._collection(COLLECTIONS.orders),
          window._where('importLockId','==',lockId),window._limit(2))),
        window._getDocs(window._query(window._collection(COLLECTIONS.orders),
          window._where('orderId','==',orderNo),window._limit(2)))
      ]);
      const existing=new Map([...byKey.docs,...byNumber.docs].map(candidate=>[candidate.id,candidate]));
      const candidates=[];
      for(const candidate of existing.values()){
        const current=await window._getDoc(window._docRef(COLLECTIONS.orders,candidate.id));
        if(current.exists()) candidates.push({id:candidate.id,data:current.data()});
      }
      for(const candidate of candidates) checkExistingOrderState(candidate.data);
      if(candidates.length>1) throw importFailure('order-import-duplicate',
        'Có nhiều đơn cùng số. Cần kiểm tra trước khi nhập.','已有多筆相同單號的訂單，請先核對。');
      if(candidates.length){
        const state=candidates[0].data;
        if(['importing','failed'].includes(state.importStatus)){
          try{await discardIncompleteOrder(candidates[0].id);}
          catch(error){error.orderImportCleanup='pending';throw error;}
        }
        else throw changedImport();
      }
      const candidateId=window._newDocRef(COLLECTIONS.orders).id;
      plan=prepareImport(headerInput,rows,{...options,orderDocumentId:candidateId});
      orderReference=window._docRef(COLLECTIONS.orders,candidateId);
      const startedAt=Number(options.now)||Date.now();
      attemptedCreate=true;
      await window._runTransaction(async transaction=>{
        // 查詢後重新讀取候選；已刪除者可以重新匯入。
        for(const candidate of candidates){
          const confirmed=await transaction.get(window._docRef(COLLECTIONS.orders,candidate.id));
          if(confirmed.exists()){
            checkExistingOrderState(confirmed.data());
            throw importFailure('order-import-busy','Đơn đang được nhập. Hãy thử lại sau.',
              '此訂單正在匯入，請稍後重試。');
          }
        }
        const snapshot=await transaction.get(lockReference);
        let repairedLock=null;
        if(snapshot.exists()){
          const oldLock=snapshot.data();
          const oldOrder=await transaction.get(window._docRef(COLLECTIONS.orders,text(oldLock.orderDocumentId)));
          if(oldOrder.exists()){
            const state=oldOrder.data();
            checkExistingOrderState(state);
            throw importFailure('order-import-busy','Đơn đang được nhập. Hãy thử lại sau.',
              '此訂單正在匯入，請稍後重試。');
          }else{
            const deleted=await transaction.get(window._docRef(COLLECTIONS.logs,`${oldLock.orderDocumentId}__purge_complete`));
            const proof=deleted.exists()?deleted.data():null;
            if(proof&&proof.schemaVersion===2&&proof.feature==='orders'&&proof.permissionKey==='progress'
              &&['orderPurgeCompleted','orderImportDiscardCompleted'].includes(proof.action)
              &&proof.status==='success'&&proof.targetType==='order'
              &&proof.targetId===oldLock.orderDocumentId&&proof.operationLogId===deleted.id
              &&proof.note===oldLock.orderNo&&proof.createdAt>=oldLock.createdAt){
              repairedLock=oldLock;
            }
            if(!repairedLock&&['importing','failed'].includes(oldLock.status)
              &&(oldLock.completedItems===undefined||oldLock.completedItems===0)
              &&(oldLock.completedBatches===undefined||oldLock.completedBatches===0)){
              const leftover=await window._getDocs(window._query(window._collection(COLLECTIONS.items),
                window._where('orderId','==',text(oldLock.orderDocumentId)),window._limit(1)));
              if(!leftover.docs.length) repairedLock=oldLock;
            }
            if(!repairedLock) throw importFailure('order-import-orphan',
              'Còn dữ liệu nhập dở hoặc không xác nhận được trạng thái. Hãy kiểm tra trước khi nhập lại.',
              '仍有匯入殘留或狀態不明，請先核對後再重新匯入。');
          }
        }
        // 全部明細已在本機驗證；初始化後才開始分批寫入。
        transaction.set(orderReference,{...plan.order,createdAt:startedAt,createdByUid:currentActor.uid,createdBy:currentActor.name,
          updatedAt:startedAt,updatedByUid:currentActor.uid});
        const repairLogId=repairedLock?`${candidateId}__lockRepair`:null;
        transaction.set(lockReference,{...(repairLogId?{repairLogId}:{}),lockId,orderNo:plan.header.orderId,orderDocumentId:candidateId,status:'importing',
          completedItems:0,completedBatches:0,totalBatches:Math.ceil(plan.items.length/BATCH_SIZE),
          createdAt:startedAt,createdByUid:currentActor.uid,createdBy:currentActor.name});
        if(repairedLock) transaction.set(window._docRef(COLLECTIONS.logs,repairLogId),{
          schemaVersion:2,permissionKey:'progress',feature:'orders',action:'orderImportLockRepair',status:'success',
          targetType:'order',targetId:candidateId,oldOrderId:repairedLock.orderDocumentId,lockId,
          operationLogId:repairLogId,itemCount:1,detailCount:1,createdAt:startedAt,
          createdByUid:currentActor.uid,createdBy:currentActor.name
        });
      },{skipDataVersions:true});
      const report=()=>options.onProgress?.({...progress,itemCount:progress.completedItems,
        completedBatches:Math.ceil(progress.completedItems/BATCH_SIZE),totalBatches:Math.ceil(plan.items.length/BATCH_SIZE)});
      progress.phase='writing';report();
      while(progress.completedItems<plan.items.length){
        const offset=progress.completedItems;
        await window._runTransaction(async transaction=>{
          const [lockSnapshot,orderSnapshot]=await Promise.all([lockReference,orderReference].map(ref=>transaction.get(ref)));
          if(!lockSnapshot.exists()||!orderSnapshot.exists()) throw changedImport();
          const lock=lockSnapshot.data();const order=orderSnapshot.data();
          if(lock.orderDocumentId!==plan.orderDocumentId||lock.status!=='importing'
            ||order.importStatus!=='importing'||order.lifecycleStatus!=='active') throw changedImport();
          const end=Math.min(offset+BATCH_SIZE,plan.items.length);
          const now=Date.now();
          plan.items.slice(offset,end).forEach(item=>transaction.set(window._docRef(COLLECTIONS.items,item.orderItemId),{
            ...item,revision:1,createdAt:now,createdByUid:currentActor.uid,updatedAt:now,updatedByUid:currentActor.uid
          }));
          // 與明細同交易保存已寫筆數，供無主單的舊鎖安全判斷；不作續跑依據。
          transaction.set(lockReference,{completedItems:end,completedBatches:Math.ceil(end/BATCH_SIZE),
            updatedAt:now,updatedByUid:currentActor.uid},{merge:true});
        },{skipDataVersions:true});
        progress.completedItems=Math.min(offset+BATCH_SIZE,plan.items.length);
        report();
      }
      progress.phase='finalizing';report();
      const logId=`${plan.orderDocumentId}__orderImport`;
      const logReference=window._docRef(COLLECTIONS.logs,logId);
      const completedAt=await window._runTransaction(async transaction=>{
        const [lockSnapshot,orderSnapshot]=await Promise.all([lockReference,orderReference].map(ref=>transaction.get(ref)));
        if(!lockSnapshot.exists()||!orderSnapshot.exists()) throw changedImport();
        const lock=lockSnapshot.data();const order=orderSnapshot.data();
        if(lock.orderDocumentId!==plan.orderDocumentId||lock.status!=='importing'
          ||order.importStatus!=='importing'||order.lifecycleStatus!=='active') throw changedImport();
        const now=Date.now();
        transaction.set(orderReference,{importStatus:'ready',importCompletedAt:now,updatedAt:now,
          updatedByUid:currentActor.uid,operationLogId:logId},{merge:true});
        transaction.set(logReference,importLog(plan,currentActor,now,options.fileName,logId));
        transaction.set(lockReference,{status:'ready',completedItems:plan.items.length,
          completedBatches:Math.ceil(plan.items.length/BATCH_SIZE),completedAt:now,updatedAt:now,
          updatedByUid:currentActor.uid,operationLogId:logId},{merge:true});
        return now;
      });
      return clone({id:plan.orderDocumentId,...plan.order,importStatus:'ready',importCompletedAt:completedAt,
        operationLogId:logId,items:plan.items});
    }catch(error){
      if(attemptedCreate&&plan){
        try{
          const snapshot=await window._getDoc(orderReference);
          if(snapshot.exists()&&snapshot.data().importStatus==='ready'){
            const done=snapshot.data();
            return clone({id:plan.orderDocumentId,...plan.order,importStatus:'ready',
              importCompletedAt:done.importCompletedAt,operationLogId:done.operationLogId,items:plan.items});
          }
          if(snapshot.exists()&&['importing','failed'].includes(snapshot.data().importStatus)){
            await discardIncompleteOrder(plan.orderDocumentId);
            error.orderImportCleanup='done';
          }
        }catch(cleanupError){error.orderImportCleanup='pending';}
      }
      if(progress.phase!=='checking'&&error.orderImportCleanup!=='done') error.orderImportProgress={...progress};
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
      if(options.skipUnchanged===true&&Object.entries(allowed).every(([field,value])=>Number.isFinite(Number(value))
        ? Number(snapshot.data()?.[field]||0)===Number(value||0)
        : snapshot.data()?.[field]===value)){
        saved={id:target,...snapshot.data()};return;
      }
      saved={id:target,...snapshot.data(),...allowed,updatedAt:now,updatedByUid:currentActor.uid,operationLogId};
      transaction.set(orderReference,{...allowed,updatedAt:now,updatedByUid:currentActor.uid,operationLogId},{merge:true});
      transaction.set(logReference,{
        permissionKey:'progress',feature:'orders',action:'orderUpdate',status:'success',targetType:'order',targetId:target,
        itemCount:1,detailCount:Object.keys(allowed).length,changes:Object.entries(allowed).slice(0,50).map(([field,after])=>({field,after})),
        note:text(options.note).slice(0,500),createdAt:now,createdByUid:currentActor.uid,createdBy:currentActor.name,
        operationLogId,schemaVersion:2
      });
    },{skipDataVersions:options.touchOrdersVersion!==true});
    return clone(saved);
  }

  // setActualShipDate（設定實際出貨日）：日期可在確認出貨前獨立保存，並通知其他裝置更新訂單清單。
  async function setActualShipDate(orderId,value,options={}){
    return updateOrder(orderId,{actualShipDate:value},{...options,note:options.note||'actualShipDate',touchOrdersVersion:true,skipUnchanged:true});
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

  // setShipmentStatus（設定出貨狀態）：狀態、實際日期、操作紀錄與訂單版本同一交易完成。
  async function setShipmentStatus(orderId,status,options={}){
    requireCloud();
    const target=text(orderId);
    if(!target) throw new Error('Đơn hàng không hợp lệ. / 訂單識別碼不正確。');
    if(!['pending','shipped'].includes(status)) throw new Error('Trạng thái xuất hàng không hợp lệ. / 出貨狀態不正確。');
    const requestedShipDate=status==='shipped'?timestamp(options.actualShipDate):null;
    if(status==='shipped'&&!requestedShipDate) throw new Error('Vui lòng chọn ngày xuất hàng. / 請選擇實際出貨日。');
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
      if(before.importStatus!=='ready'||(before.lifecycleStatus||'active')!=='active'){
        throw new Error('Đơn hàng hiện không thể thay đổi trạng thái xuất hàng. / 訂單目前不能變更出貨狀態。');
      }
      const previousStatus=before.shipmentStatus==='shipped'?'shipped':'pending';
      const actualShipDate=status==='shipped'?requestedShipDate:(before.actualShipDate||null);
      if(previousStatus===status&&Number(before.actualShipDate||0)===Number(actualShipDate||0)){
        saved={id:target,...before};return;
      }
      const action=status==='shipped'?'orderShipmentConfirm':'orderShipmentCancel';
      const allowed={shipmentStatus:status,actualShipDate,updatedAt:now,updatedByUid:currentActor.uid,operationLogId};
      saved={id:target,...before,...allowed};
      transaction.set(orderReference,allowed,{merge:true});
      transaction.set(logReference,{
        permissionKey:'progress',feature:'orders',action,status:'success',targetType:'order',targetId:target,
        itemCount:1,detailCount:2,changes:[
          {field:'shipmentStatus',before:previousStatus,after:status},
          {field:'actualShipDate',before:before.actualShipDate||null,after:actualShipDate}
        ],note:text(options.note).slice(0,500),createdAt:now,createdByUid:currentActor.uid,createdBy:currentActor.name,
        operationLogId,schemaVersion:2
      });
    });
    return clone(saved);
  }

  // setProductionProgressCompleted（設定訂單完成狀態）：保存當下實際進度快照，完成後停止自動與手動進度更新。
  async function setProductionProgressCompleted(orderId,completed,options={}){
    requireCloud();
    const target=text(orderId);
    if(!target) throw new Error('Đơn hàng không hợp lệ. / 訂單識別碼不正確。');
    const requestedCompleted=completed===true;
    const snapshotPercent=requestedCompleted
      ?Math.round(Math.max(0,Math.min(100,Number(options.actualPercent)||0))*10)/10:null;
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
      if(before.importStatus!=='ready'||(before.lifecycleStatus||'active')!=='active'){
        throw new Error('Đơn hàng hiện không thể thay đổi trạng thái hoàn thành. / 訂單目前不能變更完成狀態。');
      }
      const previousCompleted=before.productionProgressCompleted===true;
      const previousPercent=previousCompleted?Math.max(0,Math.min(100,Number(before.productionProgressSnapshotPercent)||0)):null;
      if(previousCompleted===requestedCompleted&&previousPercent===snapshotPercent){
        saved={id:target,...before};return;
      }
      const action=requestedCompleted?'orderProductionProgressComplete':'orderProductionProgressResume';
      const allowed={productionProgressCompleted:requestedCompleted,productionProgressSnapshotPercent:snapshotPercent,
        updatedAt:now,updatedByUid:currentActor.uid,operationLogId};
      saved={id:target,...before,...allowed};
      transaction.set(orderReference,allowed,{merge:true});
      transaction.set(logReference,{
        permissionKey:'progress',feature:'orders',action,status:'success',targetType:'order',targetId:target,
        itemCount:1,detailCount:2,changes:[
          {field:'productionProgressCompleted',before:previousCompleted,after:requestedCompleted},
          {field:'productionProgressSnapshotPercent',before:previousPercent,after:snapshotPercent}
        ],note:text(options.note).slice(0,500),createdAt:now,createdByUid:currentActor.uid,createdBy:currentActor.name,
        operationLogId,schemaVersion:2
      });
    });
    return clone(saved);
  }

  const PURGE_BATCH_SIZE=100; // 每次最多刪除 100 筆，只處理訂單明細，不推論業務關聯。
  const purgingOrders=new Set();
  async function discardIncompleteOrder(orderId){
    return purgeOrder(orderId,{incomplete:true});
  }
  async function purgeOrder(orderId,options={}){
    requireCloud();
    const incomplete=options.incomplete===true;
    if(!incomplete&&window.cu?.role!=='admin') throw new Error('Chỉ quản trị viên được xóa vĩnh viễn. / 只有管理員可永久刪除。');
    const id=text(orderId), user=actor();
    if(!id||purgingOrders.has(id)) throw new Error('Đang xử lý đơn hàng. / 訂單正在處理中。');
    purgingOrders.add(id);
    const ref=window._docRef(COLLECTIONS.orders,id);
    const finalRef=window._docRef(COLLECTIONS.logs,`${id}__purge_complete`);
    const action=stage=>`${incomplete?'orderImportDiscard':'orderPurge'}${stage}`;
    const log=(logRef,order,action,itemIds=[])=>({
      schemaVersion:2,permissionKey:'progress',feature:'orders',action,status:'success',targetType:'order',targetId:id,
      operationLogId:logRef.id,createdAt:Date.now(),createdByUid:user.uid,createdBy:user.name,
      itemCount:action.endsWith('Completed')?order.itemCount:itemIds.length,detailCount:itemIds.length,itemIds,
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
        if((incomplete?!['importing','failed'].includes(order.importStatus):order.importStatus!=='ready')
          ||order.schemaVersion!==2) throw changed();
        if(order.lifecycleStatus==='deleting') return;
        if(order.lifecycleStatus!==(incomplete?'active':'archived')) throw changed();
        const startRef=window._docRef(COLLECTIONS.logs,`${id}__purge_start`);
        tx.set(ref,{lifecycleStatus:'deleting',operationLogId:startRef.id,updatedAt:Date.now(),updatedByUid:user.uid},{merge:true});
        tx.set(startRef,log(startRef,order,action('Started')));
      },{skipDataVersions:incomplete});
      let deletedThisRun=0;
      for(;;){
        const before=await window._getDoc(ref);
        if(!before.exists()){
          if((await window._getDoc(finalRef)).exists()) return {id,deleted:true};
          throw changed();
        }
        const order=before.data();
        if(order.lifecycleStatus!=='deleting'
          ||(incomplete?!['importing','failed'].includes(order.importStatus):order.importStatus!=='ready')) throw changed();
        const rows=await window._getDocs(window._query(window._collection(COLLECTIONS.items),
          window._where('orderId','==',id),window._limit(PURGE_BATCH_SIZE)));
        const ids=rows.docs.map(row=>row.id);
        const committed=await window._runTransaction(async tx=>{
          const snapshot=await tx.get(ref);
          if(!snapshot.exists()) return false;
          const current=snapshot.data();
          if(current.lifecycleStatus!=='deleting'
            ||(incomplete?!['importing','failed'].includes(current.importStatus):current.importStatus!=='ready')) throw changed();
          // 另一視窗已完成這批時重新查詢，避免以舊清單重複刪除。
          if(current.operationLogId!==order.operationLogId) return false;
          if(ids.length){
            const batchRef=window._newDocRef(COLLECTIONS.logs);
            tx.set(ref,{operationLogId:batchRef.id,updatedAt:Date.now(),updatedByUid:user.uid},{merge:true});
            ids.forEach(itemId=>tx.delete(window._docRef(COLLECTIONS.items,itemId)));
            tx.set(batchRef,log(batchRef,current,action('Batch'),ids));
          }else{
            const lockRef=window._docRef(COLLECTIONS.locks,current.importLockId);
            const lock=await tx.get(lockRef);
            if(lock.exists()&&lock.data().orderDocumentId!==id) throw changed();
            tx.set(finalRef,log(finalRef,current,action('Completed')));
            if(lock.exists()) tx.delete(lockRef);
            tx.delete(ref);
          }
          return true;
        },{skipDataVersions:incomplete||ids.length>0});
        if(!committed) continue;
        deletedThisRun+=ids.length;
        options.onProgress?.({deletedThisRun,totalItems:order.itemCount});
        if(!ids.length) return {id,deleted:true};
      }
    }finally{purgingOrders.delete(id);}
  }

  window.PCMSOrderService=Object.freeze({COLLECTIONS,BATCH_SIZE,PURGE_BATCH_SIZE,normalizeHeader,prepareImport,importOrder,loadOrderItems,loadProcessViews,
    updateItemQuantity,updateOrder,setActualShipDate,setLifecycle,setShipmentStatus,setProductionProgressCompleted,purgeOrder});
})();
