// entry-store（生產登記資料存取程式）：集中處理訂單來源、工序載入與安全數量交易。
(function(){
  'use strict';

  const COLLECTIONS = Object.freeze({
    orders:'orders', // orders（訂單集合）
    processes:'orderProcesses', // orderProcesses（訂單工序集合）
    entries:'productionEntries', // productionEntries（產能登記集合）
    totals:'productionProcessTotals', // productionProcessTotals（訂單工序累計集合）
    employees:'productionEmployees', // productionEmployees（產能員工集合）
    logs:'operationLogs' // operationLogs（獨立操作紀錄集合）
  });
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/; // DATE_PATTERN（生產日期格式）
  const ENTRY_DELETE_ACTION = 'productionEntryDelete'; // productionEntryDelete（永久刪除生產紀錄）
  const SUPPLEMENT_PROCESS_NO = '0'; // SUPPLEMENT_PROCESS_NO（補充工時特殊工序號）
  let orders = []; // orders（目前可用訂單）
  let ordersPromise = null; // ordersPromise（訂單共用載入工作）
  const processRows = new Map(); // processRows（各訂單已載入工序）
  const processPromises = new Map(); // processPromises（各訂單工序共用載入工作）

  function currentUserId(){ return String(window.firebaseAuthUser?.uid || ''); }
  function currentUserName(){ return String(window.cu?.user || window.cu?.username || ''); }
  function normalizedText(value){ return String(value || '').trim(); }
  function lower(value){ return normalizedText(value).toLocaleLowerCase(); }
  function isPositiveInteger(value){ return Number.isInteger(value) && value > 0; }
  function isValidSupplementHours(value){
    const hours = Number(value);
    return Number.isFinite(hours) && hours >= 0.5 && hours <= 24 && Number.isInteger(hours*2);
  }
  function isSupplementEntry(item){
    return item?.recordType === 'supplement'
      || (normalizedText(item?.processNo) === SUPPLEMENT_PROCESS_NO && Number.isFinite(Number(item?.supplementHours)));
  }
  function isValidDate(value){
    if(!DATE_PATTERN.test(value)) return false;
    const [year,month,day] = value.split('-').map(Number);
    const date = new Date(year,month-1,day);
    return date.getFullYear() === year && date.getMonth() === month-1 && date.getDate() === day;
  }

  function orderVersion(order){
    return String(order?.processVersion || `legacy-${order?.importCompletedAt || order?.createdAt || 0}`);
  }

  function usableOrder(order){
    return !!order
      && (!order.importStatus || order.importStatus === 'ready')
      && (!order.lifecycleStatus || order.lifecycleStatus === 'active');
  }

  function sortOrders(items){
    return items.slice().sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));
  }

  function sortProcesses(items){
    return items.slice().sort((a,b)=>{
      const codeCompare = String(a.code || '').localeCompare(String(b.code || ''),'en',{numeric:true,sensitivity:'base'});
      if(codeCompare) return codeCompare;
      return String(a.processNo || '').localeCompare(String(b.processNo || ''),'en',{numeric:true,sensitivity:'base'});
    });
  }

  async function loadOrders(options={}){
    if(orders.length && options.force !== true) return orders.slice();
    if(ordersPromise) return ordersPromise;
    ordersPromise = (async()=>{
      const loaded = typeof window.firebaseLoadCachedCollection === 'function'
        ? await window.firebaseLoadCachedCollection(COLLECTIONS.orders,COLLECTIONS.orders,options)
        : (await window._getDocs(window._collection(COLLECTIONS.orders))).docs.map(item=>({id:item.id,...item.data()}));
      orders = sortOrders(loaded.filter(usableOrder));
      return orders.slice();
    })().finally(()=>{ ordersPromise = null; });
    return ordersPromise;
  }

  function listOrders(){ return orders.map(item=>({...item})); }

  function searchOrders(term,maximum=20){
    const needle = lower(term);
    const source = needle ? orders.filter(item=>[
      item.orderId,item.client,item.id
    ].some(value=>lower(value).includes(needle))) : orders;
    return source.slice(0,Math.max(1,Math.min(Number(maximum)||20,50))).map(item=>({...item}));
  }

  function findOrder(orderId){
    const normalized = normalizedText(orderId);
    return orders.find(item=>item.id === normalized) || null;
  }

  async function loadProcesses(orderId,options={}){
    const target = normalizedText(orderId);
    const order = findOrder(target);
    if(!order) throw new Error('Không tìm thấy đơn hàng đang sử dụng. / 找不到可使用的訂單。');
    const cachedState = processRows.get(target);
    const version = orderVersion(order);
    if(cachedState && cachedState.version === version && options.force !== true) return cachedState.rows.map(item=>({...item}));
    if(processPromises.has(target)) return processPromises.get(target);
    const promise = (async()=>{
      if(options.force === true) await window.PCMSOrderProcessCache?.remove?.(target);
      const cached = options.force === true ? null : await window.PCMSOrderProcessCache?.read?.(target,version);
      let rows;
      if(Array.isArray(cached)) rows = cached;
      else{
        const snapshot = await window._getDocs(window._query(
          window._collection(COLLECTIONS.processes),
          window._where('orderId','==',target)
        ));
        rows = snapshot.docs.map(item=>({id:item.id,...item.data()}));
        await window.PCMSOrderProcessCache?.write?.(target,version,rows);
      }
      const sorted = sortProcesses(rows);
      processRows.set(target,{version,rows:sorted});
      return sorted.map(item=>({...item}));
    })().finally(()=>{ processPromises.delete(target); });
    processPromises.set(target,promise);
    return promise;
  }

  function getLoadedProcesses(orderId){
    return (processRows.get(normalizedText(orderId))?.rows || []).map(item=>({...item}));
  }

  function productsForOrder(orderId){
    const unique = new Map();
    getLoadedProcesses(orderId).forEach(item=>{
      const code = normalizedText(item.code);
      if(!code || unique.has(code)) return;
      unique.set(code,{
        code,
        desc:normalizedText(item.desc),
        color:normalizedText(item.color),
        size:normalizedText(item.sz),
        nameZh:normalizedText(item.zh)
      });
    });
    return Array.from(unique.values()).sort((a,b)=>a.code.localeCompare(b.code,'en',{numeric:true,sensitivity:'base'}));
  }

  function searchProducts(orderId,term,maximum=20){
    const needle = lower(term);
    const source = productsForOrder(orderId);
    return (needle ? source.filter(item=>[
      item.code,item.desc,item.color,item.size,item.nameZh
    ].some(value=>lower(value).includes(needle))) : source).slice(0,Math.max(1,Math.min(Number(maximum)||20,50)));
  }

  function findProcess(orderId,productCode,processNo){
    const code = normalizedText(productCode);
    const number = normalizedText(processNo);
    return getLoadedProcesses(orderId).find(item=>normalizedText(item.code) === code && normalizedText(item.processNo) === number) || null;
  }

  async function loadProcessTotal(processId){
    const normalizedProcessId = normalizedText(processId);
    if(!normalizedProcessId) return {registeredQuantity:0,orderQuantity:0};
    const process = Array.from(processRows.values())
      .flatMap(group=>group.rows)
      .find(item=>item.id === normalizedProcessId);
    const snapshot = await window._getDoc(window._docRef(COLLECTIONS.totals,normalizedProcessId));
    const total = snapshot.exists() ? snapshot.data() : null;
    return {
      registeredQuantity:Math.max(0,Number(total?.registeredQty)||0),
      orderQuantity:Math.max(0,Number(total?.orderQty)||Number(process?.orderQty)||0)
    };
  }

  function validateEntryInput(input){
    const productionDate = normalizedText(input?.productionDate);
    const employeeId = window.PCMSProductionEmployees?.normalizeEmployeeId?.(input?.employeeId) || normalizedText(input?.employeeId).toUpperCase();
    const orderId = normalizedText(input?.orderId);
    const productCode = normalizedText(input?.productCode);
    const processNo = normalizedText(input?.processNo);
    const quantity = Number(input?.quantity);
    if(!isValidDate(productionDate)) throw new Error('Ngày sản xuất không hợp lệ. / 生產日期不正確。');
    if(!employeeId) throw new Error('Vui lòng chọn nhân viên. / 請選擇員工。');
    if(!processNo) throw new Error('Vui lòng nhập số công đoạn. / 請輸入工序號。');
    if(processNo === SUPPLEMENT_PROCESS_NO){
      const supplementReason = normalizedText(input?.supplementReason);
      const supplementHours = Number(input?.supplementHours);
      if(Boolean(orderId) !== Boolean(productCode)) throw new Error('Đơn hàng và mã hàng phải được chọn cùng nhau hoặc để trống cùng nhau. / 訂單與款號必須一起選擇，或一起留空。');
      if(!supplementReason) throw new Error('Vui lòng nhập lý do bổ sung giờ. / 請輸入補充工時原因。');
      if(supplementReason.length > 200) throw new Error('Lý do bổ sung giờ không được vượt quá 200 ký tự. / 補充工時原因不得超過200字。');
      if(!isValidSupplementHours(supplementHours)) throw new Error('Giờ bổ sung phải từ 0,5 đến 24 giờ và tăng theo mỗi 0,5 giờ. / 補充工時必須為0.5至24小時，並以0.5小時為單位。');
      return {recordType:'supplement',productionDate,employeeId,orderId,productCode,processNo,supplementReason,supplementHours};
    }
    if(!orderId) throw new Error('Vui lòng chọn đơn hàng. / 請選擇訂單。');
    if(!productCode) throw new Error('Vui lòng chọn mã hàng. / 請選擇款號。');
    if(!isPositiveInteger(quantity)) throw new Error('Số lượng sản xuất phải là số nguyên dương. / 生產數量必須是正整數。');
    return {recordType:'standard',productionDate,employeeId,orderId,productCode,processNo,quantity};
  }

  function hourlyCapacity(process){
    const value = Number(process?.slPerHour);
    if(!Number.isInteger(value) || value <= 0){
      throw new Error('Công đoạn chưa có sản lượng tiêu chuẩn mỗi giờ. Vui lòng đồng bộ dữ liệu công đoạn trước. / 工序尚無每小時標準產能，請先同步工序資料。');
    }
    return value;
  }

  function operationLogData(action,note,changes,now){
    return {
      permissionKey:'productionRecords',
      feature:'production',
      action,
      status:'success',
      createdAt:now,
      createdByUid:currentUserId(),
      createdBy:currentUserName(),
      itemCount:1,
      detailCount:1,
      changes:Array.isArray(changes)?changes.slice(0,50):[],
      note:normalizedText(note).slice(0,500)
    };
  }

  async function createStandardEntry(normalized){
    const employeeReference = window._docRef(COLLECTIONS.employees,normalized.employeeId);
    const orderReference = window._docRef(COLLECTIONS.orders,normalized.orderId);
    const process = findProcess(normalized.orderId,normalized.productCode,normalized.processNo);
    if(!process?.id) throw new Error('Công đoạn không thuộc mã hàng của đơn hàng đã chọn. / 工序不屬於所選訂單的款號。');
    const processReference = window._docRef(COLLECTIONS.processes,process.id);
    const totalReference = window._docRef(COLLECTIONS.totals,process.id);
    const entryReference = window._newDocRef(COLLECTIONS.entries);
    const now = Date.now();
    const userId = currentUserId();
    const userName = currentUserName();
    let saved;
    await window._runTransaction(async transaction=>{
      const employeeSnapshot = await transaction.get(employeeReference);
      const orderSnapshot = await transaction.get(orderReference);
      const processSnapshot = await transaction.get(processReference);
      const totalSnapshot = await transaction.get(totalReference);
      if(!employeeSnapshot.exists() || employeeSnapshot.data().active !== true) throw new Error('Nhân viên không tồn tại hoặc đã ngừng sử dụng. / 員工不存在或已停用。');
      if(!orderSnapshot.exists() || !usableOrder(orderSnapshot.data())) throw new Error('Đơn hàng không còn sử dụng được. / 訂單目前不可使用。');
      if(!processSnapshot.exists()) throw new Error('Dữ liệu công đoạn đã thay đổi. / 工序資料已變更。');
      const liveProcess = processSnapshot.data();
      if(liveProcess.orderId !== normalized.orderId || normalizedText(liveProcess.code) !== normalized.productCode || normalizedText(liveProcess.processNo) !== normalized.processNo){
        throw new Error('Công đoạn không khớp đơn hàng và mã hàng. / 工序與訂單、款號不相符。');
      }
      const orderQuantity = Number(liveProcess.orderQty);
      const registeredQuantity = totalSnapshot.exists() ? Number(totalSnapshot.data().registeredQty)||0 : 0;
      const remainingQuantity = orderQuantity - registeredQuantity;
      if(normalized.quantity > remainingQuantity){
        const error = new Error(`Số lượng vượt quá phần còn lại ${remainingQuantity.toLocaleString()}. / 生產數量超過剩餘可登記數量 ${remainingQuantity.toLocaleString()}。`);
        error.code = 'production-quantity-exceeded';
        error.details = {orderQuantity,registeredQuantity,remainingQuantity,inputQuantity:normalized.quantity};
        throw error;
      }
      const employee = employeeSnapshot.data();
      const capacity = hourlyCapacity(liveProcess);
      const processSeconds = Number(liveProcess.workStdSec || liveProcess.processSec);
      if(!Number.isFinite(processSeconds) || processSeconds <= 0){
        throw new Error('Công đoạn chưa có số giây tiêu chuẩn hợp lệ. / 工序尚無有效的標準秒數。');
      }
      if(!Number.isInteger(orderQuantity) || orderQuantity <= 0){
        throw new Error('Số lượng đơn hàng của công đoạn không hợp lệ. / 工序的訂單數量不正確。');
      }
      saved = {
        recordType:'standard',
        productionDate:normalized.productionDate,
        employeeId:normalized.employeeId,
        employeeName:normalizedText(employee.name),
        department:normalizedText(employee.department),
        orderProcessId:process.id,
        orderId:normalized.orderId,
        orderNo:normalizedText(liveProcess.orderNo || orderSnapshot.data().orderId),
        productCode:normalized.productCode,
        processNo:normalized.processNo,
        processNameVi:normalizedText(liveProcess.processVi),
        processNameZh:normalizedText(liveProcess.processZh),
        processSecSnapshot:processSeconds,
        hourlyCapacitySnapshot:capacity,
        orderQtySnapshot:orderQuantity,
        quantity:normalized.quantity,
        status:'active',
        revision:1,
        createdAt:now,
        createdByUid:userId,
        createdBy:userName,
        updatedAt:now,
        updatedByUid:userId,
        updatedBy:userName,
        schemaVersion:1,
        calculationVersion:'hourly-capacity-v1'
      };
      const total = {
        orderProcessId:process.id,
        orderId:normalized.orderId,
        orderNo:saved.orderNo,
        productCode:normalized.productCode,
        processNo:normalized.processNo,
        orderQty:orderQuantity,
        registeredQty:registeredQuantity + normalized.quantity,
        updatedAt:now,
        updatedByUid:userId,
        lastEntryId:entryReference.id,
        lastMutation:'create',
        lastDelta:normalized.quantity,
        schemaVersion:1
      };
      transaction.set(entryReference,saved);
      transaction.set(totalReference,total);
    });
    return {id:entryReference.id,...saved};
  }

  async function createSupplementEntry(normalized){
    const employeeReference = window._docRef(COLLECTIONS.employees,normalized.employeeId);
    const orderReference = normalized.orderId ? window._docRef(COLLECTIONS.orders,normalized.orderId) : null;
    const entryReference = window._newDocRef(COLLECTIONS.entries);
    const now = Date.now();
    const userId = currentUserId();
    const userName = currentUserName();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    let saved;
    await window._runTransaction(async transaction=>{
      const employeeSnapshot = await transaction.get(employeeReference);
      if(!employeeSnapshot.exists() || employeeSnapshot.data().active !== true) throw new Error('Nhân viên không tồn tại hoặc đã ngừng sử dụng. / 員工不存在或已停用。');
      let orderData = null;
      if(orderReference){
        const orderSnapshot = await transaction.get(orderReference);
        if(!orderSnapshot.exists() || !usableOrder(orderSnapshot.data())) throw new Error('Đơn hàng không còn sử dụng được. / 訂單目前不可使用。');
        orderData = orderSnapshot.data();
        if(!Array.isArray(orderData.productCodes) || !orderData.productCodes.map(normalizedText).includes(normalized.productCode)){
          throw new Error('Mã hàng không thuộc đơn hàng đã chọn. / 款號不屬於所選訂單。');
        }
      }
      const employee = employeeSnapshot.data();
      saved = {
        recordType:'supplement',
        productionDate:normalized.productionDate,
        employeeId:normalized.employeeId,
        employeeName:normalizedText(employee.name),
        department:normalizedText(employee.department),
        orderId:normalized.orderId,
        orderNo:normalized.orderId ? normalizedText(orderData?.orderId || normalized.orderId) : '',
        productCode:normalized.productCode,
        processNo:SUPPLEMENT_PROCESS_NO,
        supplementReason:normalized.supplementReason,
        supplementHours:normalized.supplementHours,
        status:'active',
        revision:1,
        createdAt:now,
        createdByUid:userId,
        createdBy:userName,
        updatedAt:now,
        updatedByUid:userId,
        updatedBy:userName,
        schemaVersion:1,
        calculationVersion:'supplement-hours-v1'
      };
      transaction.set(entryReference,saved);
    });
    return {id:entryReference.id,...saved};
  }

  async function createEntry(input){
    const normalized = validateEntryInput(input);
    return normalized.recordType === 'supplement'
      ? createSupplementEntry(normalized)
      : createStandardEntry(normalized);
  }

  async function updateQuantity(entryId,newQuantity,reason){
    const quantity = Number(newQuantity);
    const note = normalizedText(reason);
    if(!isPositiveInteger(quantity)) throw new Error('Số lượng sản xuất phải là số nguyên dương. / 生產數量必須是正整數。');
    if(!note) throw new Error('Vui lòng nhập lý do chỉnh sửa. / 請輸入修改原因。');
    const entryReference = window._docRef(COLLECTIONS.entries,normalizedText(entryId));
    const logReference = window._newDocRef(COLLECTIONS.logs);
    const now = Date.now();
    let saved;
    await window._runTransaction(async transaction=>{
      const entrySnapshot = await transaction.get(entryReference);
      if(!entrySnapshot.exists()) throw new Error('Không tìm thấy bản ghi sản xuất. / 找不到生產紀錄。');
      const current = entrySnapshot.data();
      if(current.status !== 'active') throw new Error('Bản ghi đã hủy không thể chỉnh sửa. / 已作廢紀錄不能修改。');
      if(isSupplementEntry(current)) throw new Error('Vui lòng dùng chức năng chỉnh sửa giờ bổ sung. / 請使用補充工時修改功能。');
      const processReference = window._docRef(COLLECTIONS.processes,current.orderProcessId);
      const totalReference = window._docRef(COLLECTIONS.totals,current.orderProcessId);
      const processSnapshot = await transaction.get(processReference);
      const totalSnapshot = await transaction.get(totalReference);
      if(!processSnapshot.exists() || !totalSnapshot.exists()) throw new Error('Thiếu dữ liệu tổng hợp công đoạn. / 缺少工序累計資料。');
      const orderQuantity = Number(processSnapshot.data().orderQty);
      const delta = quantity - Number(current.quantity);
      const nextRegistered = Number(totalSnapshot.data().registeredQty) + delta;
      if(nextRegistered < 0 || (delta > 0 && nextRegistered > orderQuantity)){
        throw new Error(`Số lượng vượt quá phần còn lại ${(orderQuantity-Number(totalSnapshot.data().registeredQty)).toLocaleString()}. / 數量超過剩餘可登記數量 ${(orderQuantity-Number(totalSnapshot.data().registeredQty)).toLocaleString()}。`);
      }
      saved = {...current,quantity,revision:Number(current.revision||1)+1,updatedAt:now,updatedByUid:currentUserId(),updatedBy:currentUserName()};
      transaction.set(entryReference,saved);
      transaction.set(totalReference,{
        ...totalSnapshot.data(),orderQty:orderQuantity,registeredQty:nextRegistered,
        updatedAt:now,updatedByUid:currentUserId(),lastEntryId:entryReference.id,lastMutation:'update',lastDelta:delta
      });
      transaction.set(logReference,operationLogData('productionEntryUpdate',note,[{field:'quantity',before:current.quantity,after:quantity}],now));
    });
    return {id:entryReference.id,...saved};
  }

  async function updateSupplementHours(entryId,newHours,reason){
    const supplementHours = Number(newHours);
    const note = normalizedText(reason);
    if(!isValidSupplementHours(supplementHours)) throw new Error('Giờ bổ sung phải từ 0,5 đến 24 giờ và tăng theo mỗi 0,5 giờ. / 補充工時必須為0.5至24小時，並以0.5小時為單位。');
    if(!note) throw new Error('Vui lòng nhập lý do chỉnh sửa. / 請輸入修改原因。');
    const entryReference = window._docRef(COLLECTIONS.entries,normalizedText(entryId));
    const logReference = window._newDocRef(COLLECTIONS.logs);
    const now = Date.now();
    let saved;
    await window._runTransaction(async transaction=>{
      const entrySnapshot = await transaction.get(entryReference);
      if(!entrySnapshot.exists()) throw new Error('Không tìm thấy bản ghi bổ sung giờ. / 找不到補充工時紀錄。');
      const current = entrySnapshot.data();
      if(!isSupplementEntry(current)) throw new Error('Bản ghi không phải là giờ bổ sung. / 此紀錄不是補充工時。');
      if(current.status !== 'active') throw new Error('Bản ghi đã hủy không thể chỉnh sửa. / 已作廢紀錄不能修改。');
      saved = {...current,supplementHours,revision:Number(current.revision||1)+1,updatedAt:now,updatedByUid:currentUserId(),updatedBy:currentUserName()};
      transaction.set(entryReference,saved);
      transaction.set(logReference,operationLogData('productionEntryUpdate',note,[{field:'supplementHours',before:current.supplementHours,after:supplementHours}],now));
    });
    return {id:entryReference.id,...saved};
  }

  async function voidEntry(entryId,reason){
    const note = normalizedText(reason);
    if(!note) throw new Error('Vui lòng nhập lý do hủy. / 請輸入作廢原因。');
    const entryReference = window._docRef(COLLECTIONS.entries,normalizedText(entryId));
    const logReference = window._newDocRef(COLLECTIONS.logs);
    const now = Date.now();
    let saved;
    await window._runTransaction(async transaction=>{
      const entrySnapshot = await transaction.get(entryReference);
      if(!entrySnapshot.exists()) throw new Error('Không tìm thấy bản ghi sản xuất. / 找不到生產紀錄。');
      const current = entrySnapshot.data();
      if(current.status !== 'active') throw new Error('Bản ghi đã được hủy. / 紀錄已經作廢。');
      if(isSupplementEntry(current)){
        saved = {
          ...current,status:'voided',revision:Number(current.revision||1)+1,
          voidedAt:now,voidedByUid:currentUserId(),voidedBy:currentUserName(),voidReason:note,
          updatedAt:now,updatedByUid:currentUserId(),updatedBy:currentUserName()
        };
        transaction.set(entryReference,saved);
        transaction.set(logReference,operationLogData('productionEntryVoid',note,[{field:'status',before:'active',after:'voided'}],now));
        return;
      }
      const totalReference = window._docRef(COLLECTIONS.totals,current.orderProcessId);
      const totalSnapshot = await transaction.get(totalReference);
      if(!totalSnapshot.exists()) throw new Error('Thiếu dữ liệu tổng hợp công đoạn. / 缺少工序累計資料。');
      const nextRegistered = Number(totalSnapshot.data().registeredQty) - Number(current.quantity);
      if(nextRegistered < 0) throw new Error('Số lượng tổng hợp không hợp lệ. / 工序累計數量不正確。');
      saved = {
        ...current,status:'voided',revision:Number(current.revision||1)+1,
        voidedAt:now,voidedByUid:currentUserId(),voidedBy:currentUserName(),voidReason:note,
        updatedAt:now,updatedByUid:currentUserId(),updatedBy:currentUserName()
      };
      transaction.set(entryReference,saved);
      transaction.set(totalReference,{
        ...totalSnapshot.data(),registeredQty:nextRegistered,updatedAt:now,updatedByUid:currentUserId(),
        lastEntryId:entryReference.id,lastMutation:'void',lastDelta:-Number(current.quantity)
      });
      transaction.set(logReference,operationLogData('productionEntryVoid',note,[{field:'status',before:'active',after:'voided'}],now));
    });
    return {id:entryReference.id,...saved};
  }

  async function deleteEntry(entryId){
    if(window.cu?.role !== 'admin'){
      throw new Error('Chỉ quản trị viên mới được xóa vĩnh viễn bản ghi sản xuất. / 只有管理員可以永久刪除生產紀錄。');
    }
    const normalizedEntryId = normalizedText(entryId);
    if(!normalizedEntryId) throw new Error('Không tìm thấy bản ghi sản xuất. / 找不到生產紀錄。');
    const entryReference = window._docRef(COLLECTIONS.entries,normalizedEntryId);
    const logReference = window._newDocRef(COLLECTIONS.logs);
    const now = Date.now();
    let deleted;
    await window._runTransaction(async transaction=>{
      const entrySnapshot = await transaction.get(entryReference);
      if(!entrySnapshot.exists()) throw new Error('Không tìm thấy bản ghi sản xuất. / 找不到生產紀錄。');
      const current = entrySnapshot.data();
      if(!['active','voided'].includes(current.status)){
        throw new Error('Trạng thái bản ghi sản xuất không hợp lệ. / 生產紀錄狀態不正確。');
      }
      if(current.status === 'active' && !isSupplementEntry(current)){
        const totalReference = window._docRef(COLLECTIONS.totals,current.orderProcessId);
        const totalSnapshot = await transaction.get(totalReference);
        if(!totalSnapshot.exists()) throw new Error('Thiếu dữ liệu tổng hợp công đoạn. / 缺少工序累計資料。');
        const quantity = Number(current.quantity);
        const nextRegistered = Number(totalSnapshot.data().registeredQty) - quantity;
        if(!Number.isInteger(nextRegistered) || nextRegistered < 0){
          throw new Error('Số lượng tổng hợp không hợp lệ. / 工序累計數量不正確。');
        }
        if(nextRegistered === 0) transaction.delete(totalReference);
        else transaction.set(totalReference,{
          ...totalSnapshot.data(),registeredQty:nextRegistered,updatedAt:now,updatedByUid:currentUserId(),
          lastEntryId:entryReference.id,lastMutation:'delete',lastDelta:-quantity
        });
      }
      transaction.delete(entryReference);
      transaction.set(logReference,operationLogData(
        ENTRY_DELETE_ACTION,
        `${normalizedText(current.employeeId)} · ${normalizedText(current.orderNo)} · ${normalizedText(current.processNo)}`,
        [{field:'status',before:current.status,after:'deleted'}],
        now
      ));
      deleted = {id:entryReference.id,...current};
    });
    return deleted;
  }

  function reset(){
    orders = [];
    ordersPromise = null;
    processRows.clear();
    processPromises.clear();
  }

  window.PCMSProductionEntryStore = Object.freeze({
    loadOrders,listOrders,searchOrders,findOrder,loadProcesses,getLoadedProcesses,
    productsForOrder,searchProducts,findProcess,loadProcessTotal,createEntry,updateQuantity,updateSupplementHours,
    voidEntry,deleteEntry,reset,validateEntryInput,isValidSupplementHours,isSupplementEntry
  });
})();
