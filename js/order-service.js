// order-service（訂單服務）：訂單只保存自己的資料；款號與工序正式內容一律由 Product Master 解析。
(function(){
  'use strict';

  const COLLECTIONS=Object.freeze({orders:'orders',items:'orderItems',locks:'orderImportLocks',totals:'productionProcessTotals',logs:'operationLogs'});
  const BATCH_SIZE=400;

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

  // importOrder（匯入訂單）：大量明細可分批續跑，最後由訂單可見狀態與操作紀錄同一交易完成。
  async function importOrder(headerInput,rows,options={}){
    requireCloud();
    const currentActor=actor(options.actor);
    const startedAt=Number(options.now)||Date.now();
    const candidateId=window._newDocRef(COLLECTIONS.orders).id;
    const lockId=orderNumberKey(headerInput.orderId||headerInput.orderNo);
    const lockReference=window._docRef(COLLECTIONS.locks,lockId);
    let orderDocumentId=candidateId;
    await window._runTransaction(async transaction=>{
      const snapshot=await transaction.get(lockReference);
      if(snapshot.exists()){
        const lock=snapshot.data();
        if(lock.status==='ready') throw new Error('Số đơn hàng đã tồn tại. / 訂單號碼已存在。');
        orderDocumentId=text(lock.orderDocumentId);
        if(!orderDocumentId) throw new Error('Khóa nhập đơn hàng bị hỏng. / 訂單匯入鎖資料不正確。');
        return;
      }
      transaction.set(lockReference,{lockId,orderNo:text(headerInput.orderId||headerInput.orderNo),orderDocumentId,
        status:'importing',completedBatches:0,createdAt:startedAt,createdByUid:currentActor.uid,createdBy:currentActor.name});
    },{skipDataVersions:true});
    const plan=prepareImport(headerInput,rows,{...options,orderDocumentId});
    const orderReference=window._docRef(COLLECTIONS.orders,orderDocumentId);
    const batches=Math.max(1,Math.ceil(plan.items.length/BATCH_SIZE));
    for(let offset=0,batchNumber=1;offset<plan.items.length;offset+=BATCH_SIZE,batchNumber+=1){
      const batch=window._writeBatch();
      if(offset===0) batch.set(orderReference,{...plan.order,createdAt:startedAt,createdByUid:currentActor.uid,createdBy:currentActor.name,
        updatedAt:startedAt,updatedByUid:currentActor.uid});
      plan.items.slice(offset,offset+BATCH_SIZE).forEach(item=>batch.set(window._docRef(COLLECTIONS.items,item.orderItemId),{
        ...item,revision:1,createdAt:startedAt,createdByUid:currentActor.uid,updatedAt:startedAt,updatedByUid:currentActor.uid
      }));
      batch.set(lockReference,{completedBatches:batchNumber,totalBatches:batches,updatedAt:Date.now(),updatedByUid:currentActor.uid},{merge:true});
      await batch.commit();
      options.onProgress?.({completedBatches:batchNumber,totalBatches:batches,itemCount:Math.min(offset+BATCH_SIZE,plan.items.length)});
    }
    const completedAt=Date.now();
    const logId=`${orderDocumentId}__orderImport`;
    const logReference=window._docRef(COLLECTIONS.logs,logId);
    await window._runTransaction(async transaction=>{
      const [lockSnapshot,orderSnapshot]=await Promise.all([lockReference,orderReference].map(reference=>transaction.get(reference)));
      if(!lockSnapshot.exists()||lockSnapshot.data()?.status!=='importing') throw new Error('Trạng thái nhập đơn hàng đã thay đổi. / 訂單匯入狀態已變更。');
      if(!orderSnapshot.exists()) throw new Error('Thiếu dữ liệu chính của đơn hàng. / 缺少訂單主資料。');
      transaction.set(orderReference,{importStatus:'ready',importCompletedAt:completedAt,updatedAt:completedAt,
        updatedByUid:currentActor.uid,operationLogId:logId},{merge:true});
      transaction.set(logReference,importLog(plan,currentActor,completedAt,options.fileName,logId));
      transaction.set(lockReference,{status:'ready',completedAt,updatedAt:completedAt,
        updatedByUid:currentActor.uid,operationLogId:logId},{merge:true});
    },{skipDataVersions:true});
    return clone({id:orderDocumentId,...plan.order,importStatus:'ready',importCompletedAt:completedAt,
      operationLogId:logId,items:plan.items});
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
    },{skipDataVersions:true});
    return clone(saved);
  }

  window.PCMSOrderService=Object.freeze({COLLECTIONS,BATCH_SIZE,normalizeHeader,prepareImport,importOrder,loadOrderItems,loadProcessViews,
    updateItemQuantity,updateOrder,setLifecycle});
})();
