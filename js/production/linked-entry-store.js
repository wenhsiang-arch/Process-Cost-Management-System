// linked-entry-store（固定身分產能資料存取）：未鎖定產能只保存關聯與數量，顯示時解析目前 Product Master。
(function(){
  'use strict';

  const COLLECTIONS=Object.freeze({
    orders:'orders',items:'orderItems',products:'products',entries:'productionEntries',totals:'productionProcessTotals',
    supplementTotals:'productionSupplementTotals',attendance:'productionAttendance',months:'productionMonths',logs:'operationLogs'
  });
  const DATE_PATTERN=/^\d{4}-\d{2}-\d{2}$/;
  const EMPLOYEE_PATTERN=/^[A-Z0-9_-]{1,30}$/;
  let orders=[];
  let ordersPromise=null;
  const processRows=new Map();
  const processPromises=new Map();
  const processTotalMemory=new Map();
  const processTotalPromises=new Map();
  const exceptionsByOrder=new Map();
  let resolverInstance=null;
  let productFreshnessToken='';
  let productFreshnessPromise=null;

  function text(value){ return String(value??'').trim(); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }
  function itemStore(){
    if(!window.PCMSOrderItemStore) throw new Error('Thiếu mô hình dòng đơn hàng. / 缺少訂單項目資料模型。');
    return window.PCMSOrderItemStore;
  }
  function efficiency(){
    if(!window.PCMSProductionEfficiencyCore) throw new Error('Thiếu công thức hiệu suất dùng chung. / 缺少共用績效公式。');
    return window.PCMSProductionEfficiencyCore;
  }
  function currentUser(){
    const uid=text(window.firebaseAuthUser?.uid);
    const name=text(window.cu?.user||window.cu?.username||window.firebaseAuthUser?.displayName||uid).slice(0,200);
    if(!uid) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    return {uid,name};
  }
  function isValidDate(value){
    if(!DATE_PATTERN.test(value)) return false;
    const [year,month,day]=value.split('-').map(Number);
    const date=new Date(year,month-1,day);
    return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day;
  }
  function positiveInteger(value){ return Number.isSafeInteger(Number(value))&&Number(value)>0; }
  function supplementHours(value){ return Number.isFinite(Number(value))&&Number(value)>=0.5&&Number(value)<=24&&Number.isInteger(Number(value)*2); }
  function usableOrder(order){ return !!order&&order.importStatus==='ready'&&(order.lifecycleStatus||'active')==='active'; }
  function assertEditableMonth(snapshot){
    if(!snapshot?.exists?.()) throw new Error('Tháng chưa được khởi tạo bằng chấm công. / 月份尚未由考勤建立。');
    const data=snapshot?.exists?.()?snapshot.data():null;
    if(data?.status==='locked'||data?.locked===true) throw new Error('Tháng đã khóa thưởng hiệu suất. / 該月份績效獎金已鎖定。');
  }
  function linkedSummaries(){
    const summaries=window.PCMSProductionSummaries;
    if(Number(summaries?.SCHEMA_VERSION)===3) return summaries;
    throw new Error('Bộ nhớ tóm tắt mới chưa sẵn sàng. / 新摘要程式尚未載入。');
  }
  function summaryActor(now,user){ return {updatedAt:now,updatedByUid:user.uid,updatedBy:user.name}; }
  function operationActor(now,user,operationLogId){ return {...summaryActor(now,user),operationLogId:text(operationLogId)}; }
  function operationLogIdFor(entryId,mutation,revision){
    return `peo_${text(entryId)}__${text(mutation)}__${Math.max(1,Math.round(Number(revision)||1))}`;
  }
  function workSeconds(){ return Number(window.S?.ws)||3000; }
  function documentRows(snapshot){ return (snapshot?.docs||[]).map(item=>({id:item.id,...item.data()})); }
  async function loadProductsByIds(productIds){
    const snapshots=await Promise.all(productIds.map(productId=>window._getDoc(window._docRef(COLLECTIONS.products,productId))));
    return snapshots.map((snapshot,index)=>snapshot.exists()?{productId:productIds[index],...snapshot.data()}:null).filter(Boolean);
  }
  function resolver(){
    if(!resolverInstance){
      if(!window.PCMSProductResolver) throw new Error('Thiếu bộ phân giải mã hàng. / 缺少款號解析器。');
      resolverInstance=window.PCMSProductResolver.create({loadProductsByIds,efficiencyCore:efficiency(),workSeconds:workSeconds()});
    }
    return resolverInstance;
  }
  async function ensureProductFreshness(){
    if(productFreshnessPromise) return productFreshnessPromise;
    productFreshnessPromise=(async()=>{
      const snapshot=await window._getDoc(window._docRef('system','productsMeta'));
      const data=snapshot.exists()?snapshot.data():{};
      const token=`${Number(data.updatedAt)||0}|${text(data.lastProductId)}|${Number(data.lastRevision)||0}`;
      if(productFreshnessToken&&productFreshnessToken!==token){
        processRows.clear();resolverInstance?.clear?.();resolverInstance=null;
      }
      productFreshnessToken=token;return token;
    })().finally(()=>{productFreshnessPromise=null;});
    return productFreshnessPromise;
  }
  function sortProcesses(rows){
    return rows.slice().sort((left,right)=>Number(left.lineNumber||0)-Number(right.lineNumber||0)
      ||Number(left.processSortOrder||0)-Number(right.processSortOrder||0)
      ||String(left.processNo).localeCompare(String(right.processNo),'en',{numeric:true,sensitivity:'base'}));
  }
  function processView(order,item,product,operation){
    const processId=model().fixedId(operation.processId,'process');
    const id=itemStore().processTotalId(item.orderItemId,processId);
    return {
      id,processTotalId:id,orderId:item.orderId,orderNo:text(order.orderId||order.id),orderItemId:item.orderItemId,
      productId:item.productId,processId,code:product.code,desc:text(item.description),color:text(item.color),sz:product.sz,
      po:text(item.po),lineNumber:item.lineNumber,orderQty:item.quantity,processNo:operation.no,
      processSortOrder:operation.sortOrder,processCategory:operation.category,processZh:operation.zh,processVi:operation.vi,
      processSec:operation.sec,workStdSec:operation.sec,slPerHour:efficiency().hourlyCapacity(operation.sec,workSeconds()),active:true
    };
  }

  async function loadOrders(options={}){
    if(ordersPromise) return ordersPromise;
    ordersPromise=(async()=>{
      const snapshot=await window._getDocs(window._collection(COLLECTIONS.orders));
      orders=documentRows(snapshot).filter(usableOrder).sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));
      return clone(orders);
    })().finally(()=>{ordersPromise=null;});
    return ordersPromise;
  }
  function listOrders(){ return clone(orders); }
  function findOrder(orderId){ return orders.find(order=>order.id===text(orderId))||null; }

  async function loadProcesses(orderId,options={}){
    const target=text(orderId);
    const order=findOrder(target);
    if(!order) throw new Error('Không tìm thấy đơn hàng đang sử dụng. / 找不到可使用的訂單。');
    await ensureProductFreshness();
    if(processRows.has(target)&&options.force!==true) return clone(processRows.get(target));
    if(processPromises.has(target)) return processPromises.get(target);
    const promise=(async()=>{
      const snapshot=await window._getDocs(window._query(window._collection(COLLECTIONS.items),window._where('orderId','==',target)));
      const items=documentRows(snapshot).map(row=>itemStore().normalizeOrderItem(target,{orderItemId:row.id,...row},Number(row.lineNumber||1)-1))
        .filter(item=>item.active!==false);
      const resolved=await resolver().resolve(items);
      if(resolved.exceptions.length){
        exceptionsByOrder.set(target,clone(resolved.exceptions));
        const error=new Error('Có dòng đơn hàng không thể liên kết với mã hàng hiện tại. / 有訂單項目無法連結目前款號。');
        error.code='order-item-product-exception';error.exceptions=clone(resolved.exceptions);throw error;
      }
      exceptionsByOrder.delete(target);
      const rows=[];
      resolved.rows.forEach(result=>{
        const item=result.source;
        const product=result.resolved.product;
        (product.ops||[]).filter(operation=>operation.active!==false).forEach(operation=>rows.push(processView(order,item,product,operation)));
      });
      const sorted=sortProcesses(rows);
      processRows.set(target,sorted);
      return clone(sorted);
    })().finally(()=>processPromises.delete(target));
    processPromises.set(target,promise);
    return promise;
  }
  function getLoadedProcesses(orderId){ return clone(processRows.get(text(orderId))||[]); }
  function refreshLoadedProcessStandards(orderId){
    processRows.delete(text(orderId));resolverInstance?.clear?.();return [];
  }
  function productsForOrder(orderId){
    const rows=getLoadedProcesses(orderId);
    const items=new Map();
    rows.forEach(process=>{
      if(items.has(process.orderItemId)) return;
      items.set(process.orderItemId,{orderItemId:process.orderItemId,productId:process.productId,code:process.code,
        desc:process.desc,color:process.color,size:process.sz,po:process.po,lineNumber:process.lineNumber,quantity:process.orderQty});
    });
    return [...items.values()];
  }
  function findProcess(orderId,itemIdentity,processIdentity){
    const identity=text(itemIdentity);
    const process=text(processIdentity);
    const matches=getLoadedProcesses(orderId).filter(row=>(row.orderItemId===identity||row.code===identity)
      &&(row.processId===process||text(row.processNo)===process));
    return matches.length===1?matches[0]:null;
  }
  function exceptionsForOrder(orderId){ return clone(exceptionsByOrder.get(text(orderId))||[]); }

  function rememberProcessTotal(processTotalId,value){
    const normalized={registeredQuantity:Math.max(0,Number(value?.registeredQuantity)||0),orderQuantity:Math.max(0,Number(value?.orderQuantity)||0)};
    processTotalMemory.set(text(processTotalId),{value:normalized,loadedAt:Date.now()});
    return clone(normalized);
  }
  function applyProcessTotalDelta(processTotalId,delta,orderQuantity){
    const current=processTotalMemory.get(text(processTotalId));
    if(!current) return null;
    return rememberProcessTotal(processTotalId,{registeredQuantity:Number(current.value.registeredQuantity)+Number(delta||0),
      orderQuantity:Number(orderQuantity)||current.value.orderQuantity});
  }
  function processTotalLoadedAt(processTotalId){ return Number(processTotalMemory.get(text(processTotalId))?.loadedAt)||0; }
  async function loadProcessTotal(processTotalId,options={}){
    const target=text(processTotalId);
    if(!target) return {registeredQuantity:0,orderQuantity:0};
    const remembered=processTotalMemory.get(target);
    if(options.force!==true&&remembered&&Date.now()-remembered.loadedAt<Math.max(0,Number(options.maxAgeMs)||0)) return clone(remembered.value);
    if(processTotalPromises.has(target)) return processTotalPromises.get(target);
    const process=[...processRows.values()].flat().find(row=>row.processTotalId===target);
    const promise=(async()=>{
      const snapshot=await window._getDoc(window._docRef(COLLECTIONS.totals,target));
      const data=snapshot.exists()?snapshot.data():null;
      return rememberProcessTotal(target,{registeredQuantity:data?.registeredQty,orderQuantity:data?.orderQty||process?.orderQty});
    })().finally(()=>processTotalPromises.delete(target));
    processTotalPromises.set(target,promise);return promise;
  }

  function validateEntryInput(input={}){
    const productionDate=text(input.productionDate);
    const employeeId=text(input.employeeId).toUpperCase();
    const processNo=text(input.processNo);
    if(!isValidDate(productionDate)) throw new Error('Ngày sản xuất không hợp lệ. / 生產日期不正確。');
    if(!EMPLOYEE_PATTERN.test(employeeId)) throw new Error('Mã nhân viên không hợp lệ. / 員工工號不正確。');
    if(processNo==='0'){
      const hours=Number(input.supplementHours);
      if(!supplementHours(hours)) throw new Error('Giờ bổ sung phải từ 0,5 đến 24 giờ và tăng theo mỗi 0,5 giờ. / 補充工時必須為0.5至24小時，並以0.5小時為單位。');
      return {recordType:'supplement',productionDate,employeeId,orderId:text(input.orderId),orderItemId:text(input.orderItemId),
        productId:text(input.productId),processNo:'0',supplementReason:text(input.supplementReason).slice(0,200),supplementHours:hours};
    }
    const normalized={recordType:'standard',productionDate,employeeId,orderId:text(input.orderId),
      orderItemId:model().fixedId(input.orderItemId,'orderItem'),productId:model().fixedId(input.productId,'product'),
      processId:model().fixedId(input.processId,'process'),processNo,quantity:Number(input.quantity)};
    if(!normalized.orderId||!normalized.orderItemId||!normalized.productId||!normalized.processId){
      throw new Error('Thiếu liên kết cố định của đơn hàng, mã hàng hoặc công đoạn. / 缺少訂單項目、款號或工序固定關聯。');
    }
    if(!positiveInteger(normalized.quantity)) throw new Error('Số lượng sản xuất phải là số nguyên dương. / 生產數量必須是正整數。');
    return normalized;
  }
  function attendanceHours(snapshot){
    if(!snapshot?.exists?.()) throw new Error('Phải đăng ký chấm công trước khi nhập sản lượng. / 必須先登記考勤，才能登記產能。');
    const data=snapshot.data();
    const hours=Math.max(0,Number(data.normalHours)||0)+Math.max(0,Number(data.overtimeHours)||0);
    if(hours<=0) throw new Error('Giờ chấm công phải lớn hơn 0. / 考勤工時必須大於0。');
    return hours;
  }
  function operation(product,processId){ return (product?.ops||[]).find(item=>item.processId===processId&&item.active!==false)||null; }
  function totalData(item,normalized,current,now,user,lastEntryId,operationLogId){
    const registeredQty=(Number(current?.registeredQty)||0)+normalized.quantity;
    if(registeredQty>item.quantity) throw new Error('Số lượng tích lũy của công đoạn vượt quá dòng đơn hàng. / 該訂單項目的工序累計數量超過訂單數量。');
    return {orderItemId:item.orderItemId,orderId:item.orderId,productId:item.productId,processId:normalized.processId,
      orderQty:item.quantity,registeredQty,updatedAt:now,updatedByUid:user.uid,lastMutation:'create',lastDelta:normalized.quantity,
      lastEntryId:text(lastEntryId),operationLogId:text(operationLogId),schemaVersion:2};
  }
  function productionOperationLog({entryId,entry,mutation,revision,aggregateId,daySummaryId,employeeMonthId,month,now,user,operationLogId}){
    const action=mutation==='create'?'productionEntryCreate':mutation==='delete'?'productionEntryDelete':'productionEntryVoid';
    return {permissionKey:'productionRecords',feature:'production',action,status:'success',targetType:'productionEntry',
      targetId:text(entryId),targetRevision:Math.max(1,Math.round(Number(revision)||1)),mutation,recordType:text(entry.recordType),
      aggregateId:text(aggregateId),daySummaryId:text(daySummaryId),employeeMonthId:text(employeeMonthId),productionMonthId:text(month),
      itemCount:1,detailCount:1,note:'',createdAt:now,createdByUid:user.uid,createdBy:user.name,
      operationLogId:text(operationLogId),schemaVersion:2};
  }

  async function createStandardEntry(normalized){
    const user=currentUser();
    const entryReference=window._newDocRef(COLLECTIONS.entries);
    const operationLogId=operationLogIdFor(entryReference.id,'create',1);
    const operationLogReference=window._docRef(COLLECTIONS.logs,operationLogId);
    const summaries=linkedSummaries();
    const references={
      attendance:window._docRef(COLLECTIONS.attendance,`${normalized.productionDate}__${normalized.employeeId}`),
      month:window._docRef(COLLECTIONS.months,normalized.productionDate.slice(0,7)),order:window._docRef(COLLECTIONS.orders,normalized.orderId),
      item:window._docRef(COLLECTIONS.items,normalized.orderItemId),product:window._docRef(COLLECTIONS.products,normalized.productId),
      total:window._docRef(COLLECTIONS.totals,itemStore().processTotalId(normalized.orderItemId,normalized.processId))
    };
    if(summaries){
      references.daySummary=summaries.dayReference(normalized.productionDate,normalized.employeeId);
      references.monthSummary=summaries.employeeMonthReference(normalized.productionDate.slice(0,7),normalized.employeeId);
    }
    let saved;
    await window._runTransaction(async transaction=>{
      const keys=Object.keys(references);
      const values=await Promise.all(keys.map(key=>transaction.get(references[key])));
      const snapshots=Object.fromEntries(keys.map((key,index)=>[key,values[index]]));
      const {attendance:attendanceSnapshot,month:monthSnapshot,order:orderSnapshot,item:itemSnapshot,
        product:productSnapshot,total:totalSnapshot}=snapshots;
      attendanceHours(attendanceSnapshot);assertEditableMonth(monthSnapshot);
      if(!orderSnapshot.exists()||!usableOrder(orderSnapshot.data())) throw new Error('Đơn hàng không còn sử dụng được. / 訂單目前不可使用。');
      if(!itemSnapshot.exists()) throw new Error('Dòng đơn hàng đã thay đổi. / 訂單項目已變更。');
      const item=itemStore().normalizeOrderItem(normalized.orderId,{orderItemId:normalized.orderItemId,...itemSnapshot.data()},0);
      if(item.productId!==normalized.productId||item.active===false) throw new Error('Dòng đơn hàng không khớp mã hàng. / 訂單項目與款號不相符。');
      if(!productSnapshot.exists()) throw new Error('Không tìm thấy mã hàng hiện tại. / 找不到目前款號主檔。');
      const product={productId:normalized.productId,...productSnapshot.data()};
      if(product.active===false||!operation(product,normalized.processId)) throw new Error('Không tìm thấy công đoạn hiện tại. / 找不到目前正式工序。');
      const now=Date.now();
      const attendance=attendanceSnapshot.data();
      saved={recordType:'standard',productionDate:normalized.productionDate,employeeId:normalized.employeeId,
        employeeName:text(attendance.employeeName).slice(0,100),department:text(attendance.department).slice(0,100),
        orderId:normalized.orderId,orderItemId:normalized.orderItemId,productId:normalized.productId,processId:normalized.processId,
        quantity:normalized.quantity,status:'active',revision:1,createdAt:now,createdByUid:user.uid,createdBy:user.name,
        updatedAt:now,updatedByUid:user.uid,updatedBy:user.name,operationLogId,schemaVersion:2,calculationVersion:'product-resolver-v2'};
      transaction.set(entryReference,saved);
      transaction.set(references.total,totalData(item,normalized,totalSnapshot.exists()?totalSnapshot.data():null,now,user,entryReference.id,operationLogId));
      if(summaries){
        const summaryEntry={id:entryReference.id,...saved,attendance};
        const actor=operationActor(now,user,operationLogId);
        const day=summaries.applyEntry(snapshots.daySummary.exists()?snapshots.daySummary.data():null,summaryEntry,1,actor);
        const month=summaries.applyDayToMonth(snapshots.monthSummary.exists()?snapshots.monthSummary.data():null,null,day,
          actor,{complete:true});
        transaction.set(references.daySummary,day);
        transaction.set(references.monthSummary,month);
        transaction.set(references.month,summaries.monthSourceVersionData(normalized.productionDate.slice(0,7),entryReference.id,
          actor,monthSnapshot.data()),{merge:true});
        transaction.set(operationLogReference,productionOperationLog({entryId:entryReference.id,entry:saved,mutation:'create',revision:1,
          aggregateId:references.total.id,daySummaryId:day.summaryId,employeeMonthId:month.monthSummaryId,
          month:normalized.productionDate.slice(0,7),now,user,operationLogId}));
      }
    },{skipDataVersions:true});
    const result={id:entryReference.id,...saved,processTotalId:references.total.id};
    applyProcessTotalDelta(result.processTotalId,result.quantity,
      getLoadedProcesses(result.orderId).find(row=>row.orderItemId===result.orderItemId)?.orderQty);
    return decorateEntries([result]).then(rows=>rows[0]);
  }

  async function createSupplementEntry(normalized){
    const user=currentUser();
    const entryReference=window._newDocRef(COLLECTIONS.entries);
    const operationLogId=operationLogIdFor(entryReference.id,'create',1);
    const operationLogReference=window._docRef(COLLECTIONS.logs,operationLogId);
    const totalId=`${normalized.productionDate}__${normalized.employeeId}`;
    const attendanceReference=window._docRef(COLLECTIONS.attendance,totalId);
    const monthReference=window._docRef(COLLECTIONS.months,normalized.productionDate.slice(0,7));
    const totalReference=window._docRef(COLLECTIONS.supplementTotals,totalId);
    const summaries=linkedSummaries();
    const daySummaryReference=summaries?.dayReference(normalized.productionDate,normalized.employeeId);
    const monthSummaryReference=summaries?.employeeMonthReference(normalized.productionDate.slice(0,7),normalized.employeeId);
    let saved;
    await window._runTransaction(async transaction=>{
      const references=[attendanceReference,monthReference,totalReference];
      if(summaries) references.push(daySummaryReference,monthSummaryReference);
      const snapshots=await Promise.all(references.map(ref=>transaction.get(ref)));
      const [attendanceSnapshot,monthSnapshot,totalSnapshot,daySummarySnapshot,monthSummarySnapshot]=snapshots;
      const workedHours=attendanceHours(attendanceSnapshot);assertEditableMonth(monthSnapshot);
      const currentHours=Number(totalSnapshot.exists()?totalSnapshot.data()?.activeHours:0)||0;
      if(currentHours+normalized.supplementHours>workedHours) throw new Error('Tổng giờ bổ sung vượt quá giờ chấm công. / 補充工時合計超過考勤工時。');
      const now=Date.now();const attendance=attendanceSnapshot.data();
      saved={...normalized,employeeName:text(attendance.employeeName).slice(0,100),department:text(attendance.department).slice(0,100),
        status:'active',revision:1,createdAt:now,createdByUid:user.uid,createdBy:user.name,updatedAt:now,updatedByUid:user.uid,
        updatedBy:user.name,operationLogId,schemaVersion:2,calculationVersion:'supplement-hours-v2'};
      transaction.set(entryReference,saved);
      transaction.set(totalReference,{productionDate:normalized.productionDate,employeeId:normalized.employeeId,
        activeHours:currentHours+normalized.supplementHours,lastEntryId:entryReference.id,lastMutation:'create',
        lastDelta:normalized.supplementHours,updatedAt:now,updatedByUid:user.uid,operationLogId,schemaVersion:2});
      if(summaries){
        const summaryEntry={id:entryReference.id,...saved,attendance};
        const actor=operationActor(now,user,operationLogId);
        const day=summaries.applyEntry(daySummarySnapshot.exists()?daySummarySnapshot.data():null,summaryEntry,1,actor);
        const month=summaries.applyDayToMonth(monthSummarySnapshot.exists()?monthSummarySnapshot.data():null,null,day,
          actor,{complete:true});
        transaction.set(daySummaryReference,day);
        transaction.set(monthSummaryReference,month);
        transaction.set(monthReference,summaries.monthSourceVersionData(normalized.productionDate.slice(0,7),entryReference.id,
          actor,monthSnapshot.data()),{merge:true});
        transaction.set(operationLogReference,productionOperationLog({entryId:entryReference.id,entry:saved,mutation:'create',revision:1,
          aggregateId:totalId,daySummaryId:day.summaryId,employeeMonthId:month.monthSummaryId,
          month:normalized.productionDate.slice(0,7),now,user,operationLogId}));
      }
    },{skipDataVersions:true});
    return {id:entryReference.id,...saved};
  }
  async function createEntry(input){
    const normalized=validateEntryInput(input);
    return normalized.recordType==='supplement'?createSupplementEntry(normalized):createStandardEntry(normalized);
  }

  async function mutateEntry(entryId,reason,mode){
    const user=currentUser();
    const id=text(entryId);const entryReference=window._docRef(COLLECTIONS.entries,id);let result;
    await window._runTransaction(async transaction=>{
      const entrySnapshot=await transaction.get(entryReference);
      if(!entrySnapshot.exists()) throw new Error('Không tìm thấy bản ghi sản xuất. / 找不到生產紀錄。');
      const stored=entrySnapshot.data();
      const current={id,...stored};
      if(current.status!=='active') throw new Error('Bản ghi đã được hủy. / 紀錄已經作廢。');
      const monthReference=window._docRef(COLLECTIONS.months,current.productionDate.slice(0,7));
      const aggregateReference=current.recordType==='supplement'
        ?window._docRef(COLLECTIONS.supplementTotals,`${current.productionDate}__${current.employeeId}`)
        :window._docRef(COLLECTIONS.totals,itemStore().processTotalId(current.orderItemId,current.processId));
      const summaries=linkedSummaries();
      const daySummaryReference=summaries?.dayReference(current.productionDate,current.employeeId);
      const monthSummaryReference=summaries?.employeeMonthReference(current.productionDate.slice(0,7),current.employeeId);
      const references=[monthReference,aggregateReference];
      if(summaries) references.push(daySummaryReference,monthSummaryReference);
      const [monthSnapshot,aggregateSnapshot,daySummarySnapshot,monthSummarySnapshot]=await Promise.all(references.map(ref=>transaction.get(ref)));
      assertEditableMonth(monthSnapshot);
      if(!aggregateSnapshot.exists()) throw new Error('Thiếu dữ liệu tổng hợp sản xuất. / 缺少產能累計資料。');
      const now=Date.now();
      const targetRevision=Number(current.revision||1)+1;
      const operationLogId=operationLogIdFor(id,mode,targetRevision);
      const operationLogReference=window._docRef(COLLECTIONS.logs,operationLogId);
      if(current.recordType==='supplement'){
        const next=Math.max(0,Number(aggregateSnapshot.data()?.activeHours)||0)-Number(current.supplementHours||0);
        transaction.set(aggregateReference,{activeHours:next,lastEntryId:id,lastMutation:mode,lastDelta:-Number(current.supplementHours||0),
          updatedAt:now,updatedByUid:user.uid,operationLogId},{merge:true});
      }else{
        const next=Math.max(0,(Number(aggregateSnapshot.data()?.registeredQty)||0)-Number(current.quantity||0));
        transaction.set(aggregateReference,{registeredQty:next,updatedAt:now,updatedByUid:user.uid,lastMutation:mode,
          lastDelta:-Number(current.quantity||0),lastEntryId:id,operationLogId},{merge:true});
      }
      if(mode==='delete'){transaction.delete(entryReference);result=current;}
      else{
        const saved={...stored,status:'voided',revision:targetRevision,voidedAt:now,voidedByUid:user.uid,
          voidedBy:user.name,voidReason:text(reason).slice(0,500),updatedAt:now,updatedByUid:user.uid,updatedBy:user.name,operationLogId};
        result={id,...saved};transaction.set(entryReference,saved);
      }
      if(summaries){
        const actor=operationActor(now,user,operationLogId);
        const day=summaries.applyEntry(daySummarySnapshot.exists()?daySummarySnapshot.data():null,{...current,mutation:mode},-1,actor);
        const month=summaries.applyDayToMonth(monthSummarySnapshot.exists()?monthSummarySnapshot.data():null,null,day,
          actor,{complete:true});
        transaction.set(daySummaryReference,day);
        transaction.set(monthSummaryReference,month);
        transaction.set(monthReference,summaries.monthSourceVersionData(current.productionDate.slice(0,7),id,
          actor,monthSnapshot.data()),{merge:true});
        const log=productionOperationLog({entryId:id,entry:current,mutation:mode,revision:targetRevision,
          aggregateId:aggregateReference.id,daySummaryId:day.summaryId,employeeMonthId:month.monthSummaryId,
          month:current.productionDate.slice(0,7),now,user,operationLogId});
        log.note=text(reason).slice(0,500);
        transaction.set(operationLogReference,log);
      }
    },{skipDataVersions:true});
    if(result.recordType!=='supplement') applyProcessTotalDelta(itemStore().processTotalId(result.orderItemId,result.processId),-Number(result.quantity),0);
    const decorated=await decorateEntries([{id,...result}]);return decorated[0];
  }
  function voidEntry(entryId,reason){ return mutateEntry(entryId,reason,'void'); }
  function deleteEntry(entryId){
    if(window.cu?.role!=='admin') throw new Error('Chỉ quản trị viên mới được xóa vĩnh viễn bản ghi sản xuất. / 只有管理員可以永久刪除生產紀錄。');
    return mutateEntry(entryId,'','delete');
  }

  async function decorateEntries(entries){
    const standard=(entries||[]).filter(entry=>entry.recordType!=='supplement');
    const resolved=standard.length?await resolver().resolve(standard):{rows:[],exceptions:[]};
    const byId=new Map(resolved.rows.map(row=>[text(row.source.id),row]));
    const orderById=new Map(orders.map(order=>[order.id,order]));
    const processes=[...processRows.values()].flat();
    return (entries||[]).map(entry=>{
      if(entry.recordType==='supplement') return clone(entry);
      const row=byId.get(text(entry.id));
      if(!row) return {...clone(entry),resolutionException:resolved.exceptions.find(item=>text(item.reference?.id)===text(entry.id))||true};
      const display=row.display;
      const process=processes.find(item=>item.orderItemId===entry.orderItemId&&item.processId===entry.processId);
      return {...clone(entry),orderNo:text(orderById.get(entry.orderId)?.orderId||entry.orderId),productCode:display.productCode,
        processNo:display.processNo,processNameVi:display.processNameVi,processNameZh:display.processNameZh,
        processSeconds:display.processSeconds,hourlyCapacity:display.hourlyCapacity,
        orderQuantity:process?.orderQty||null,processTotalId:itemStore().processTotalId(entry.orderItemId,entry.processId)};
    });
  }
  function isSupplementEntry(item){ return item?.recordType==='supplement'||text(item?.processNo)==='0'; }
  function isValidSupplementHours(value){ return supplementHours(value); }
  function reset(){
    orders=[];ordersPromise=null;processRows.clear();processPromises.clear();processTotalMemory.clear();processTotalPromises.clear();
    exceptionsByOrder.clear();resolverInstance?.clear?.();resolverInstance=null;
    productFreshnessToken='';productFreshnessPromise=null;
  }

  function invalidateProductResolution(){
    processRows.clear();processPromises.clear();exceptionsByOrder.clear();resolverInstance?.clear?.();resolverInstance=null;
    productFreshnessToken='';productFreshnessPromise=null;
  }

  window.document?.addEventListener?.('pcms:productmasterchange',invalidateProductResolution);

  window.PCMSProductionEntryStore=Object.freeze({COLLECTIONS,loadOrders,listOrders,findOrder,loadProcesses,getLoadedProcesses,
    refreshLoadedProcessStandards,productsForOrder,findProcess,exceptionsForOrder,loadProcessTotal,processTotalLoadedAt,
    createEntry,voidEntry,deleteEntry,decorateEntries,validateEntryInput,isSupplementEntry,isValidSupplementHours,
    invalidateProductResolution,reset});
})();
