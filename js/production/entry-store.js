// entry-store（生產登記資料存取程式）：集中處理訂單來源，以及產能、累計與月份版本的原子交易。
(function(){
  'use strict';

  const COLLECTIONS=Object.freeze({
    orders:'orders',processes:'orderProcesses',entries:'productionEntries',totals:'productionProcessTotals',
    employees:'productionEmployees',attendance:'productionAttendance',logs:'operationLogs'
  });
  const DATE_PATTERN=/^\d{4}-\d{2}-\d{2}$/;
  const EMPLOYEE_PATTERN=/^[A-Z0-9_-]{1,30}$/;
  const SUPPLEMENT_PROCESS_NO='0';
  const ENTRY_DELETE_ACTION='productionEntryDelete';
  let orders=[];
  let ordersPromise=null;
  const processRows=new Map();
  const processPromises=new Map();
  const processTotalMemory=new Map(); // processTotalMemory（工序累計短效記憶）：只供畫面顯示，不參與正式超量判斷。
  const processTotalPromises=new Map(); // processTotalPromises（工序累計讀取工作）：避免同工序同時重複讀取。

  function currentUserId(){ return String(window.firebaseAuthUser?.uid||''); }
  function currentUserName(){ return String(window.cu?.user||window.cu?.username||window.firebaseAuthUser?.displayName||'').trim(); }
  function normalizedText(value){ return String(value||'').trim(); }
  function isPositiveInteger(value){ return Number.isInteger(value)&&value>0; }
  function isValidSupplementHours(value){
    const hours=Number(value);
    return Number.isFinite(hours)&&hours>=0.5&&hours<=24&&Number.isInteger(hours*2);
  }
  function isSupplementEntry(item){
    return item?.recordType==='supplement'
      || (normalizedText(item?.processNo)===SUPPLEMENT_PROCESS_NO&&Number.isFinite(Number(item?.supplementHours)));
  }
  function isValidDate(value){
    if(!DATE_PATTERN.test(value)) return false;
    const [year,month,day]=value.split('-').map(Number);
    const date=new Date(year,month-1,day);
    return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day;
  }
  function orderVersion(order,orderId=''){
    return normalizedText(order?.processVersion)||`legacy-${normalizedText(orderId||order?.id)}`;
  }
  function usableOrder(order){
    return !!order&&(!order.importStatus||order.importStatus==='ready')&&(!order.lifecycleStatus||order.lifecycleStatus==='active');
  }
  function sortOrders(items){
    return items.slice().sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));
  }
  function sortProcesses(items){
    return items.slice().sort((a,b)=>{
      const code=String(a.code||'').localeCompare(String(b.code||''),'en',{numeric:true,sensitivity:'base'});
      return code||String(a.processNo||'').localeCompare(String(b.processNo||''),'en',{numeric:true,sensitivity:'base'});
    });
  }

  function currentStandardDocumentId(productCode,processNo){
    return `${encodeURIComponent(normalizedText(productCode))}__${encodeURIComponent(normalizedText(processNo))}`;
  }

  // applyCurrentProductStandards（套用目前款號標準）：訂單保留數量與工序身分，畫面與新報工使用目前正式秒數。
  function applyCurrentProductStandards(items){
    const products=Array.isArray(window.D)?window.D:[];
    const productsByCode=new Map(products.map(item=>[normalizedText(item.code),item]));
    return (items||[]).map(item=>{
      const product=productsByCode.get(normalizedText(item.code));
      const operation=(product?.ops||[]).map(value=>window.PCMSProductModel?.normalizeOperation?.(value)||value)
        .find(value=>normalizedText(value.no)===normalizedText(item.processNo));
      const seconds=Number(operation?.sec);
      if(!Number.isInteger(seconds)||seconds<=0) return item;
      return {
        ...item,
        processCategory:normalizedText(operation.category)||item.processCategory,
        processZh:normalizedText(operation.zh)||item.processZh,
        processVi:normalizedText(operation.vi)||item.processVi,
        processSec:seconds,workStdSec:seconds,
        slPerHour:Math.round((Number(window.S?.ws)||3000)/seconds),
        currentStandardId:currentStandardDocumentId(item.code,item.processNo),
        currentStandardRevision:Number(product?.standardRevision)||0
      };
    });
  }

  async function loadOrders(options={}){
    if(ordersPromise) return ordersPromise;
    ordersPromise=(async()=>{
      const loaded=typeof window.firebaseLoadCachedCollection==='function'
        ?await window.firebaseLoadCachedCollection(COLLECTIONS.orders,COLLECTIONS.orders,options)
        :(await window._getDocs(window._collection(COLLECTIONS.orders))).docs.map(item=>({id:item.id,...item.data()}));
      orders=sortOrders(loaded.filter(usableOrder));
      return orders.slice();
    })().finally(()=>{ ordersPromise=null; });
    return ordersPromise;
  }
  function listOrders(){ return orders.map(item=>({...item})); }
  function findOrder(orderId){
    const target=normalizedText(orderId);
    return orders.find(item=>item.id===target)||null;
  }
  async function loadProcesses(orderId,options={}){
    const target=normalizedText(orderId);
    const order=findOrder(target);
    if(!order) throw new Error('Không tìm thấy đơn hàng đang sử dụng. / 找不到可使用的訂單。');
    const version=orderVersion(order,target);
    const cachedState=processRows.get(target);
    if(cachedState&&cachedState.version===version&&options.force!==true) return cachedState.rows.map(item=>({...item}));
    if(processPromises.has(target)) return processPromises.get(target);
    const promise=(async()=>{
      if(options.force===true) await window.PCMSOrderProcessCache?.remove?.(target);
      const cached=options.force===true?null:await window.PCMSOrderProcessCache?.read?.(target,version);
      let rows;
      if(Array.isArray(cached)) rows=cached;
      else{
        const snapshot=await window._getDocs(window._query(window._collection(COLLECTIONS.processes),window._where('orderId','==',target)));
        rows=snapshot.docs.map(item=>({id:item.id,...item.data()}));
        await window.PCMSOrderProcessCache?.write?.(target,version,rows);
      }
      const sorted=sortProcesses(applyCurrentProductStandards(rows.filter(item=>item.active!==false)));
      processRows.set(target,{version,rows:sorted});
      return sorted.map(item=>({...item}));
    })().finally(()=>{ processPromises.delete(target); });
    processPromises.set(target,promise);
    return promise;
  }
  function getLoadedProcesses(orderId){
    return (processRows.get(normalizedText(orderId))?.rows||[]).map(item=>({...item}));
  }
  function productsForOrder(orderId){
    const unique=new Map();
    getLoadedProcesses(orderId).forEach(item=>{
      const code=normalizedText(item.code);
      if(!code||unique.has(code)) return;
      unique.set(code,{code,desc:normalizedText(item.desc),color:normalizedText(item.color),size:normalizedText(item.sz),nameZh:normalizedText(item.zh)});
    });
    return [...unique.values()].sort((a,b)=>a.code.localeCompare(b.code,'en',{numeric:true,sensitivity:'base'}));
  }
  function findProcess(orderId,productCode,processNo){
    const code=normalizedText(productCode);
    const number=normalizedText(processNo);
    return getLoadedProcesses(orderId).find(item=>normalizedText(item.code)===code&&normalizedText(item.processNo)===number)||null;
  }
  function rememberProcessTotal(processId,value){
    const target=normalizedText(processId);
    const remembered={
      registeredQuantity:Math.max(0,Number(value?.registeredQuantity)||0),
      orderQuantity:Math.max(0,Number(value?.orderQuantity)||0)
    };
    processTotalMemory.set(target,{value:remembered,loadedAt:Date.now()});
    return {...remembered};
  }

  function applyProcessTotalDelta(processId,delta,orderQuantity=0){
    const target=normalizedText(processId);
    const remembered=processTotalMemory.get(target);
    if(!target||!remembered) return null;
    return rememberProcessTotal(target,{
      registeredQuantity:Math.max(0,Number(remembered.value.registeredQuantity)||0)+Number(delta||0),
      orderQuantity:Math.max(0,Number(orderQuantity)||Number(remembered.value.orderQuantity)||0)
    });
  }

  function processTotalLoadedAt(processId){
    return Number(processTotalMemory.get(normalizedText(processId))?.loadedAt)||0;
  }

  async function loadProcessTotal(processId,options={}){
    const target=normalizedText(processId);
    if(!target) return {registeredQuantity:0,orderQuantity:0};
    const maximumAge=Math.max(0,Number(options.maxAgeMs)||0);
    const remembered=processTotalMemory.get(target);
    if(options.force!==true&&maximumAge>0&&remembered&&Date.now()-remembered.loadedAt<maximumAge){
      return {...remembered.value};
    }
    if(processTotalPromises.has(target)) return processTotalPromises.get(target);
    const process=[...processRows.values()].flatMap(group=>group.rows).find(item=>item.id===target);
    const promise=(async()=>{
      const snapshot=await window._getDoc(window._docRef(COLLECTIONS.totals,target));
      const total=snapshot.exists()?snapshot.data():null;
      return rememberProcessTotal(target,{
        registeredQuantity:Math.max(0,Number(total?.registeredQty)||0),
        orderQuantity:Math.max(0,Number(total?.orderQty)||Number(process?.orderQty)||0)
      });
    })().finally(()=>processTotalPromises.delete(target));
    processTotalPromises.set(target,promise);
    return promise;
  }

  function hourlyCapacity(process){
    const value=Number(process?.slPerHour);
    if(!Number.isInteger(value)||value<=0){
      throw new Error('Công đoạn chưa có sản lượng tiêu chuẩn mỗi giờ. Vui lòng đồng bộ dữ liệu công đoạn trước. / 工序尚無每小時標準產能，請先同步工序資料。');
    }
    return value;
  }

  function attendanceHours(snapshot){
    if(!snapshot?.exists?.()) throw new Error('Phải đăng ký chấm công trước khi nhập sản lượng. / 必須先登記考勤，才能登記產能。');
    const data=snapshot.data();
    const hours=Math.max(0,Number(data.normalHours)||0)+Math.max(0,Number(data.overtimeHours)||0);
    if(hours<=0) throw new Error('Giờ chấm công phải lớn hơn 0. / 考勤工時必須大於0。');
    return hours;
  }

  function totalData(process,current,entryId,mutation,delta,now,userId){
    const registeredQty=(current?Number(current.registeredQty)||0:0)+delta;
    const orderQty=Number(process.orderQty);
    if(!Number.isInteger(registeredQty)||registeredQty<0||registeredQty>orderQty){
      throw new Error('Số lượng vượt quá phần còn lại hoặc dữ liệu tổng hợp không hợp lệ. / 生產數量超過剩餘可登記數量，或工序累計資料不正確。');
    }
    return {
      orderProcessId:process.id,orderId:normalizedText(process.orderId),orderNo:normalizedText(process.orderNo),
      productCode:normalizedText(process.code),processNo:normalizedText(process.processNo),orderQty,registeredQty,
      updatedAt:now,updatedByUid:userId,lastEntryId:entryId,lastMutation:mutation,lastDelta:delta,schemaVersion:1
    };
  }

  // totalIncrementData（一般報工累計原子增量）：不先讀累計文件，由 Firestore 與 Rules 驗證最終數量。
  function totalIncrementData(process,entryId,quantity,now,userId){
    const orderQty=Number(process.orderQty);
    if(!Number.isInteger(orderQty)||orderQty<=0||!isPositiveInteger(quantity)){
      throw new Error('Thông số số lượng công đoạn không hợp lệ. / 工序數量資料不正確。');
    }
    return {
      orderProcessId:process.id,orderId:normalizedText(process.orderId),orderNo:normalizedText(process.orderNo),
      productCode:normalizedText(process.code),processNo:normalizedText(process.processNo),orderQty,
      registeredQty:window._increment(quantity),updatedAt:now,updatedByUid:userId,
      lastEntryId:entryId,lastMutation:'create',lastDelta:quantity,schemaVersion:1
    };
  }

  function operationLogData(action,entry,note,now,userId,userName){
    return {
      permissionKey:'productionRecords',feature:'production',action,status:'success',createdAt:now,
      createdByUid:userId,createdBy:userName,itemCount:1,detailCount:1,
      changes:[{field:'status',before:entry?.status||null,after:action===ENTRY_DELETE_ACTION?'deleted':'voided'}],
      note:normalizedText(note||`${entry?.employeeId||''} · ${entry?.orderNo||''} · ${entry?.processNo||''}`).slice(0,500)
    };
  }

  function guardStore(){
    if(!window.PCMSProductionGuards) throw new Error('Bộ kiểm tra an toàn sản xuất chưa sẵn sàng. / 產能安全檢查尚未載入。');
    return window.PCMSProductionGuards;
  }

  function summaryStore(){
    if(!window.PCMSProductionSummaries) throw new Error('Bộ tóm tắt sản xuất chưa sẵn sàng. / 產能摘要程式尚未載入。');
    return window.PCMSProductionSummaries;
  }

  function summaryActor(now,userId,userName){
    return {updatedAt:now,updatedByUid:userId,updatedBy:userName};
  }

  function writeEntrySummaries(transaction,{guards,summaries,summaryReference,summarySnapshot,monthSummaryReference,
    monthSummarySnapshot,controlSnapshot,summaryComplete,attendance,employee,entry,direction,mutation,now,userId,userName}){
    const currentData=summarySnapshot?.exists?.()?summarySnapshot.data():null;
    if(currentData&&Number(currentData.schemaVersion)!==summaries.SCHEMA_VERSION){
      throw new Error('Tóm tắt ngày chưa được chuyển đổi; hãy hoàn tất xây dựng lại trước. / 每日摘要尚未轉換，請先完成重建。');
    }
    const actor=summaryActor(now,userId,userName);
    const base=currentData||summaries.emptyDay({
      productionDate:entry.productionDate,employeeId:entry.employeeId,employeeName:employee.name,
      department:employee.department,attendance,actor,complete:true
    });
    const day=summaries.applyEntry(base,{...entry,mutation},direction,actor);
    const month=summaries.applyDayToMonth(
      monthSummarySnapshot?.exists?.()?monthSummarySnapshot.data():null,base,day,actor,
      {complete:summaryComplete===true||(controlSnapshot?.exists?.()&&controlSnapshot.data()?.summaryReady===true)}
    );
    transaction.set(summaryReference,day);
    transaction.set(monthSummaryReference,month);
    return {day,month};
  }

  function requireSignedInActor(){
    const userId=currentUserId();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    return {userId,userName:currentUserName()};
  }

  function validateEntryInput(input){
    const productionDate=normalizedText(input?.productionDate);
    const employeeId=window.PCMSProductionEmployees?.normalizeEmployeeId?.(input?.employeeId)||normalizedText(input?.employeeId).toUpperCase();
    const orderId=normalizedText(input?.orderId);
    const productCode=normalizedText(input?.productCode);
    const processNo=normalizedText(input?.processNo);
    const quantity=Number(input?.quantity);
    if(!isValidDate(productionDate)) throw new Error('Ngày sản xuất không hợp lệ. / 生產日期不正確。');
    if(!employeeId) throw new Error('Vui lòng chọn nhân viên. / 請選擇員工。');
    if(!EMPLOYEE_PATTERN.test(employeeId)) throw new Error('Mã nhân viên không hợp lệ. / 員工工號不正確。');
    if(!processNo) throw new Error('Vui lòng nhập số công đoạn. / 請輸入工序號。');
    if(processNo===SUPPLEMENT_PROCESS_NO){
      const supplementReason=normalizedText(input?.supplementReason);
      const supplementHours=Number(input?.supplementHours);
      if(Boolean(orderId)!==Boolean(productCode)) throw new Error('Đơn hàng và mã hàng phải được chọn cùng nhau hoặc để trống cùng nhau. / 訂單與款號必須一起選擇，或一起留空。');
      if(supplementReason.length>200) throw new Error('Lý do bổ sung giờ không được vượt quá 200 ký tự. / 補充工時原因不得超過200字。');
      if(!isValidSupplementHours(supplementHours)) throw new Error('Giờ bổ sung phải từ 0,5 đến 24 giờ và tăng theo mỗi 0,5 giờ. / 補充工時必須為0.5至24小時，並以0.5小時為單位。');
      return {recordType:'supplement',productionDate,employeeId,orderId,productCode,processNo,supplementReason,supplementHours};
    }
    if(!orderId) throw new Error('Vui lòng chọn đơn hàng. / 請選擇訂單。');
    if(!productCode) throw new Error('Vui lòng chọn mã hàng. / 請選擇款號。');
    if(!isPositiveInteger(quantity)) throw new Error('Số lượng sản xuất phải là số nguyên dương. / 生產數量必須是正整數。');
    return {recordType:'standard',productionDate,employeeId,orderId,productCode,processNo,quantity};
  }

  async function createStandardEntry(normalized){
    const guards=guardStore();
    const {userId,userName}=requireSignedInActor();
    const process=findProcess(normalized.orderId,normalized.productCode,normalized.processNo);
    if(!process?.id) throw new Error('Công đoạn không thuộc mã hàng của đơn hàng đã chọn. / 工序不屬於所選訂單的款號。');
    const attendanceReference=window._docRef(COLLECTIONS.attendance,`${normalized.productionDate}__${normalized.employeeId}`);
    const orderReference=window._docRef(COLLECTIONS.orders,normalized.orderId);
    const processReference=window._docRef(COLLECTIONS.processes,process.id);
    const standardReferenceId=currentStandardDocumentId(normalized.productCode,normalized.processNo);
    const standardReference=window._docRef('productProcessStandards',standardReferenceId);
    const totalReference=window._docRef(COLLECTIONS.totals,process.id);
    const summaryReference=guards.daySummaryReference(normalized.productionDate,normalized.employeeId);
    const monthReference=guards.monthReference(normalized.productionDate);
    const summaries=summaryStore();
    const monthSummaryReference=summaries.employeeMonthReference(guards.monthFromDate(normalized.productionDate),normalized.employeeId);
    const entryReference=window._newDocRef(COLLECTIONS.entries);
    let saved;
    await window._runTransaction(async transaction=>{
      const [attendanceSnapshot,orderSnapshot,processSnapshot,standardSnapshot,summarySnapshot,monthSummarySnapshot]=await Promise.all([
        attendanceReference,orderReference,processReference,standardReference,summaryReference,monthSummaryReference
      ].map(reference=>transaction.get(reference)));
      attendanceHours(attendanceSnapshot);
      if(!orderSnapshot.exists()||!usableOrder(orderSnapshot.data())) throw new Error('Đơn hàng không còn sử dụng được. / 訂單目前不可使用。');
      if(!processSnapshot.exists()) throw new Error('Dữ liệu công đoạn đã thay đổi. / 工序資料已變更。');
      const liveProcess={id:processReference.id,...processSnapshot.data()};
      if(liveProcess.active===false||liveProcess.orderId!==normalized.orderId
        ||normalizedText(liveProcess.code)!==normalized.productCode||normalizedText(liveProcess.processNo)!==normalized.processNo){
        throw new Error('Công đoạn không khớp đơn hàng và mã hàng. / 工序與訂單、款號不相符。');
      }
      const currentStandard=standardSnapshot.exists()?standardSnapshot.data():null;
      const standardMatches=currentStandard?.active===true
        && normalizedText(currentStandard.productCode)===normalized.productCode
        && normalizedText(currentStandard.processNo)===normalized.processNo;
      const effectiveProcess=standardMatches?{
        ...liveProcess,
        processVi:currentStandard.processNameVi,processZh:currentStandard.processNameZh,
        processSec:currentStandard.processSec,workStdSec:currentStandard.processSec,
        slPerHour:currentStandard.hourlyCapacity
      }:liveProcess;
      const orderQuantity=Number(liveProcess.orderQty);
      const capacity=hourlyCapacity(effectiveProcess);
      const processSeconds=Number(effectiveProcess.workStdSec||effectiveProcess.processSec);
      if(!Number.isInteger(orderQuantity)||orderQuantity<=0||!Number.isFinite(processSeconds)||processSeconds<=0){
        throw new Error('Thông số công đoạn không hợp lệ. / 工序標準資料不正確。');
      }
      const now=Date.now();
      const attendance=attendanceSnapshot.data();
      const employee={employeeId:normalized.employeeId,name:attendance.employeeName,department:attendance.department};
      const total=totalIncrementData(liveProcess,entryReference.id,normalized.quantity,now,userId);
      saved={
        recordType:'standard',productionDate:normalized.productionDate,employeeId:normalized.employeeId,
        employeeName:normalizedText(employee.name).slice(0,100),department:normalizedText(employee.department).slice(0,100),
        orderProcessId:liveProcess.id,orderId:normalized.orderId,
        orderNo:normalizedText(liveProcess.orderNo||orderSnapshot.data().orderId||normalized.orderId),
        productCode:normalized.productCode,processNo:normalized.processNo,
        processNameVi:normalizedText(effectiveProcess.processVi).slice(0,200),processNameZh:normalizedText(effectiveProcess.processZh).slice(0,200),
        processVersionSnapshot:orderVersion(orderSnapshot.data(),normalized.orderId).slice(0,150),processSecSnapshot:processSeconds,
        standardReferenceId,hourlyCapacitySnapshot:capacity,orderQtySnapshot:orderQuantity,quantity:normalized.quantity,status:'active',revision:1,
        createdAt:now,createdByUid:userId,createdBy:userName,updatedAt:now,updatedByUid:userId,updatedBy:userName,
        schemaVersion:1,calculationVersion:'hourly-capacity-v1'
      };
      const version=guards.sourceVersionToken();
      transaction.set(entryReference,saved);
      transaction.set(totalReference,total,{merge:true});
      writeEntrySummaries(transaction,{guards,summaries,summaryReference,summarySnapshot,monthSummaryReference,monthSummarySnapshot,
        summaryComplete:true,attendance,employee,entry:{id:entryReference.id,...saved},direction:1,mutation:'create',now,userId,userName});
      transaction.set(monthReference,guards.entriesMonthSourceVersionData(normalized.productionDate,version,now,userId,userName),{merge:true});
    },{skipDataVersions:true});
    const result={id:entryReference.id,...saved};
    applyProcessTotalDelta(result.orderProcessId,result.quantity,result.orderQtySnapshot);
    return result;
  }

  async function createSupplementEntry(normalized){
    const guards=guardStore();
    const {userId,userName}=requireSignedInActor();
    const employeeReference=window._docRef(COLLECTIONS.employees,normalized.employeeId);
    const attendanceReference=window._docRef(COLLECTIONS.attendance,`${normalized.productionDate}__${normalized.employeeId}`);
    const orderReference=normalized.orderId?window._docRef(COLLECTIONS.orders,normalized.orderId):null;
    const summaryReference=guards.daySummaryReference(normalized.productionDate,normalized.employeeId);
    const monthReference=guards.monthReference(normalized.productionDate);
    const summaries=summaryStore();
    const monthSummaryReference=summaries.employeeMonthReference(guards.monthFromDate(normalized.productionDate),normalized.employeeId);
    const entryReference=window._newDocRef(COLLECTIONS.entries);
    let saved;
    await window._runTransaction(async transaction=>{
      const references=[employeeReference,attendanceReference,summaryReference,monthSummaryReference,monthReference];
      if(orderReference) references.push(orderReference);
      const snapshots=await Promise.all(references.map(reference=>transaction.get(reference)));
      const [employeeSnapshot,attendanceSnapshot,summarySnapshot,monthSummarySnapshot,monthSnapshot]=snapshots;
      guards.assertEditableMonthSnapshot(monthSnapshot);
      const workedHours=attendanceHours(attendanceSnapshot);
      if(!employeeSnapshot.exists()||employeeSnapshot.data().active!==true) throw new Error('Nhân viên không tồn tại hoặc đã ngừng sử dụng. / 員工不存在或已停用。');
      const currentSummary=guards.summaryValues(summarySnapshot);
      if(currentSummary.activeSupplementHours+normalized.supplementHours>workedHours){
        throw new Error(`Tổng giờ bổ sung trong ngày không được vượt quá ${workedHours} giờ chấm công. / 當日有效補充工時合計不得超過 ${workedHours} 小時考勤。`);
      }
      const orderSnapshot=orderReference?snapshots[5]:null;
      if(orderReference){
        if(!orderSnapshot.exists()||!usableOrder(orderSnapshot.data())) throw new Error('Đơn hàng hoặc mã hàng không còn sử dụng được. / 訂單或款號目前不可使用。');
        const productCodes=Array.isArray(orderSnapshot.data().productCodes)?orderSnapshot.data().productCodes.map(normalizedText):[];
        if(!productCodes.includes(normalized.productCode)) throw new Error('Mã hàng không thuộc đơn hàng đã chọn. / 款號不屬於所選訂單。');
      }
      const now=Date.now();
      const employee={employeeId:normalized.employeeId,...employeeSnapshot.data()};
      saved={
        recordType:'supplement',productionDate:normalized.productionDate,employeeId:normalized.employeeId,
        employeeName:normalizedText(employee.name).slice(0,100),department:normalizedText(employee.department).slice(0,100),
        orderId:normalized.orderId,orderNo:orderReference?normalizedText(orderSnapshot.data().orderId||normalized.orderId):'',
        productCode:normalized.productCode,processNo:SUPPLEMENT_PROCESS_NO,supplementReason:normalized.supplementReason,
        supplementHours:normalized.supplementHours,status:'active',revision:1,
        createdAt:now,createdByUid:userId,createdBy:userName,updatedAt:now,updatedByUid:userId,updatedBy:userName,
        schemaVersion:1,calculationVersion:'supplement-hours-v1'
      };
      const version=guards.sourceVersionToken();
      transaction.set(entryReference,saved);
      writeEntrySummaries(transaction,{guards,summaries,summaryReference,summarySnapshot,monthSummaryReference,monthSummarySnapshot,
        controlSnapshot:monthSnapshot,attendance:attendanceSnapshot.data(),employee,entry:{id:entryReference.id,...saved},direction:1,mutation:'create',now,userId,userName});
      transaction.set(monthReference,guards.entriesMonthSourceVersionData(normalized.productionDate,version,now,userId,userName),{merge:true});
    },{skipDataVersions:true});
    const result={id:entryReference.id,...saved};
    return result;
  }

  async function createEntry(input){
    const normalized=validateEntryInput(input);
    return normalized.recordType==='supplement'?createSupplementEntry(normalized):createStandardEntry(normalized);
  }

  async function mutateEntry(entryId,reason,mode){
    const guards=guardStore();
    const {userId,userName}=requireSignedInActor();
    const normalizedEntryId=normalizedText(entryId);
    const note=normalizedText(reason);
    if(!normalizedEntryId) throw new Error('Không tìm thấy bản ghi sản xuất. / 找不到生產紀錄。');
    if(note.length>500) throw new Error('Lý do hủy không được vượt quá 500 ký tự. / 作廢原因不得超過500字。');
    const entryReference=window._docRef(COLLECTIONS.entries,normalizedEntryId);
    const logReference=window._newDocRef(COLLECTIONS.logs);
    let result;
    await window._runTransaction(async transaction=>{
      const entrySnapshot=await transaction.get(entryReference);
      if(!entrySnapshot.exists()) throw new Error('Không tìm thấy bản ghi sản xuất. / 找不到生產紀錄。');
      const current=entrySnapshot.data();
      if(mode==='void'&&current.status!=='active') throw new Error('Bản ghi đã được hủy. / 紀錄已經作廢。');
      if(!['active','voided'].includes(current.status)) throw new Error('Trạng thái bản ghi sản xuất không hợp lệ. / 生產紀錄狀態不正確。');
      const monthReference=guards.monthReference(current.productionDate);
      const summaryReference=guards.daySummaryReference(current.productionDate,current.employeeId);
      const summaries=summaryStore();
      const monthSummaryReference=summaries.employeeMonthReference(guards.monthFromDate(current.productionDate),current.employeeId);
      const references=[monthReference];
      if(current.status==='active') references.push(summaryReference,monthSummaryReference);
      const totalReference=current.status==='active'&&!isSupplementEntry(current)
        ?window._docRef(COLLECTIONS.totals,current.orderProcessId):null;
      if(totalReference) references.push(totalReference);
      const snapshots=await Promise.all(references.map(reference=>transaction.get(reference)));
      guards.assertEditableMonthSnapshot(snapshots[0]);
      const summarySnapshot=current.status==='active'?snapshots[1]:null;
      const monthSummarySnapshot=current.status==='active'?snapshots[2]:null;
      const totalSnapshot=totalReference?snapshots[snapshots.length-1]:null;
      if(current.status==='active'&&!summarySnapshot?.exists()){
        throw new Error('Thiếu dữ liệu tổng hợp ngày; cần hoàn tất chuyển đổi dữ liệu trước. / 缺少每日累計，請先完成資料整理。');
      }
      const now=Date.now();
      if(current.status==='active'){
        const employee={employeeId:current.employeeId,name:current.employeeName,department:current.department};
        writeEntrySummaries(transaction,{guards,summaries,summaryReference,summarySnapshot,monthSummaryReference,monthSummarySnapshot,
          controlSnapshot:snapshots[0],attendance:null,employee,entry:{id:normalizedEntryId,...current},direction:-1,mutation:mode,now,userId,userName});
        if(totalReference){
          if(!totalSnapshot?.exists()) throw new Error('Thiếu dữ liệu tổng hợp công đoạn. / 缺少工序累計資料。');
          const total=totalData({id:current.orderProcessId,orderId:current.orderId,orderNo:current.orderNo,code:current.productCode,
            processNo:current.processNo,orderQty:current.orderQtySnapshot},totalSnapshot.data(),normalizedEntryId,mode,-Number(current.quantity),now,userId);
          transaction.set(totalReference,total);
        }
      }
      if(mode==='delete'){
        transaction.delete(entryReference);
        result={id:normalizedEntryId,...current};
      }else{
        result={...current,status:'voided',revision:Number(current.revision||1)+1,voidedAt:now,voidedByUid:userId,voidedBy:userName,
          voidReason:note,updatedAt:now,updatedByUid:userId,updatedBy:userName};
        transaction.set(entryReference,result);
      }
      transaction.set(logReference,operationLogData(mode==='delete'?ENTRY_DELETE_ACTION:'productionEntryVoid',current,note,now,userId,userName));
      const version=guards.sourceVersionToken();
      transaction.set(monthReference,guards.entriesMonthSourceVersionData(current.productionDate,version,now,userId,userName),{merge:true});
    },{skipDataVersions:true});
    const changed={id:normalizedEntryId,...result};
    const removesActiveTotal=!isSupplementEntry(changed)
      && ((mode==='void'&&changed.status==='voided')||(mode==='delete'&&changed.status==='active'));
    if(removesActiveTotal){
      applyProcessTotalDelta(changed.orderProcessId,-Number(changed.quantity),changed.orderQtySnapshot);
    }
    return changed;
  }

  async function voidEntry(entryId,reason){
    return mutateEntry(entryId,reason,'void');
  }
  async function deleteEntry(entryId){
    if(window.cu?.role!=='admin') throw new Error('Chỉ quản trị viên mới được xóa vĩnh viễn bản ghi sản xuất. / 只有管理員可以永久刪除生產紀錄。');
    return mutateEntry(entryId,'','delete');
  }
  function reset(){
    orders=[];
    ordersPromise=null;
    processRows.clear();
    processPromises.clear();
    processTotalMemory.clear();
    processTotalPromises.clear();
  }

  window.PCMSProductionEntryStore=Object.freeze({
    loadOrders,listOrders,findOrder,loadProcesses,getLoadedProcesses,productsForOrder,findProcess,loadProcessTotal,
    processTotalLoadedAt,createEntry,voidEntry,deleteEntry,reset,validateEntryInput,isValidSupplementHours,isSupplementEntry
  });
})();
