// employee-store（產能員工資料存取程式）：只管理產能名冊，不處理畫面。
(function(){
  'use strict';

  const COLLECTION_NAME = 'productionEmployees'; // COLLECTION_NAME（產能員工集合名稱）
  const DEPARTMENT_COLLECTION_NAME = 'productionDepartments'; // DEPARTMENT_COLLECTION_NAME（產能部門集合名稱）
  const EMPLOYEE_HISTORY_COLLECTION_NAMES = Object.freeze([
    'productionEntries',
    'productionAttendance',
    'productionDaySummaries',
    'productionEmployeeMonths'
  ]); // EMPLOYEE_HISTORY_COLLECTION_NAMES（可證明工號曾被使用的業務資料集合）
  const LOG_COLLECTION_NAME = 'operationLogs'; // LOG_COLLECTION_NAME（操作紀錄集合名稱）
  const EMPLOYEE_DELETE_ACTION = 'productionEmployeeDelete'; // productionEmployeeDelete（永久刪除產能員工）
  const DEPARTMENT_CREATE_ACTION = 'productionDepartmentCreate'; // productionDepartmentCreate（新增產能部門）
  const DEPARTMENT_RENAME_ACTION = 'productionDepartmentRename'; // productionDepartmentRename（重新命名產能部門）
  const DEPARTMENT_STATUS_ACTION = 'productionDepartmentStatus'; // productionDepartmentStatus（變更產能部門狀態）
  const DEPARTMENT_DELETE_ACTION = 'productionDepartmentDelete'; // productionDepartmentDelete（刪除產能部門）
  const EMPLOYEE_ID_PATTERN = /^[A-Z0-9_-]{1,30}$/; // EMPLOYEE_ID_PATTERN（工號允許格式）
  let rows = []; // rows（目前工作階段員工資料）
  let loaded = false; // loaded（是否已載入）
  let loadPromise = null; // loadPromise（共用載入工作）
  let departmentRows = []; // departmentRows（目前工作階段部門資料）
  let departmentsLoaded = false; // departmentsLoaded（部門是否已載入）
  let departmentLoadPromise = null; // departmentLoadPromise（部門共用載入工作）

  function currentUserId(){
    return String(window.firebaseAuthUser?.uid || '');
  }

  function currentUserName(){
    return String(window.cu?.user || window.cu?.username || '');
  }

  function normalizeEmployeeId(value){
    return String(value || '').trim().toUpperCase();
  }

  function normalizeText(value){
    return String(value || '').trim().replace(/\s+/g,' ');
  }

  function employeeDocumentId(employeeId){
    return normalizeEmployeeId(employeeId);
  }

  function normalizeDepartmentName(value){
    return normalizeText(value).normalize('NFKC');
  }

  function departmentDocumentId(name){
    return encodeURIComponent(normalizeDepartmentName(name).toLocaleLowerCase());
  }

  function validateDepartmentName(value){
    const name = normalizeDepartmentName(value);
    if(!name || name.length > 100){
      throw new Error('Tên bộ phận phải có từ 1 đến 100 ký tự. / 部門名稱必須為1～100個字。');
    }
    return name;
  }

  async function requireActiveDepartment(transaction,name){
    const normalized = validateDepartmentName(name);
    const reference = window._docRef(DEPARTMENT_COLLECTION_NAME,departmentDocumentId(normalized));
    const snapshot = await transaction.get(reference);
    const department = snapshot.exists() ? snapshot.data() : null;
    if(!department || department.active !== true || normalizeDepartmentName(department.name) !== normalized){
      throw new Error('Vui lòng thêm và kích hoạt bộ phận trước khi chọn. / 請先新增並啟用部門後再選擇。');
    }
    return department;
  }

  function validateEmployee(input){
    const employeeId = normalizeEmployeeId(input?.employeeId);
    const name = normalizeText(input?.name);
    const department = normalizeText(input?.department);
    if(!EMPLOYEE_ID_PATTERN.test(employeeId)){
      throw new Error('Mã nhân viên chỉ được dùng 1–30 ký tự: chữ, số, dấu gạch ngang hoặc gạch dưới. / 工號只能使用1～30個英文字母、數字、連字號或底線。');
    }
    if(!name || name.length > 100){
      throw new Error('Tên nhân viên phải có từ 1 đến 100 ký tự. / 員工姓名必須為1～100個字。');
    }
    if(!department || department.length > 100){
      throw new Error('Bộ phận phải có từ 1 đến 100 ký tự. / 部門必須為1～100個字。');
    }
    return {employeeId,name,department,active:input?.active !== false};
  }

  function sortRows(items){
    return items.slice().sort((a,b)=>String(a.employeeId || '').localeCompare(String(b.employeeId || ''),'en',{numeric:true,sensitivity:'base'}));
  }

  function remember(row){
    const next = rows.filter(item=>item.employeeId !== row.employeeId);
    next.push(row);
    rows = sortRows(next);
    return row;
  }

  function sortDepartments(items){
    return items.slice().sort((a,b)=>String(a.name || '').localeCompare(String(b.name || ''),'vi',{numeric:true,sensitivity:'base'}));
  }

  function rememberDepartment(row){
    const next = departmentRows.filter(item=>item.departmentId !== row.departmentId);
    next.push(row);
    departmentRows = sortDepartments(next);
    return row;
  }

  function forgetDepartment(departmentId){
    departmentRows = departmentRows.filter(item=>item.departmentId !== departmentId);
  }

  async function load(options={}){
    if(loaded && options.force !== true && options.revalidate !== true) return rows.slice();
    if(loadPromise) return loadPromise;
    loadPromise = (async()=>{
      const loadedRows = typeof window.firebaseLoadCachedCollection === 'function'
        ? await window.firebaseLoadCachedCollection(COLLECTION_NAME,COLLECTION_NAME,options)
        : (await window._getDocs(window._collection(COLLECTION_NAME))).docs.map(item=>({id:item.id,...item.data()})); // loadedRows（快取或雲端員工資料）
      rows = sortRows(loadedRows);
      loaded = true;
      return rows.slice();
    })().finally(()=>{ loadPromise = null; });
    return loadPromise;
  }

  function list(options={}){
    const activeOnly = options.activeOnly === true;
    return rows.filter(item=>!activeOnly || item.active === true).map(item=>({...item}));
  }

  function find(employeeId){
    const normalized = normalizeEmployeeId(employeeId);
    return rows.find(item=>item.employeeId === normalized) || null;
  }

  async function employeeHasHistoricalBusinessData(employeeId){
    const normalized = normalizeEmployeeId(employeeId);
    const snapshots = await Promise.all(EMPLOYEE_HISTORY_COLLECTION_NAMES.map(collectionName=>window._getDocs(window._query(
      window._collection(collectionName),
      window._where('employeeId','==',normalized),
      window._limit(1)
    ))));
    return snapshots.some(snapshot=>snapshot.size > 0);
  }

  async function createEmployee(input){
    const data = validateEmployee(input);
    const reference = window._docRef(COLLECTION_NAME,employeeDocumentId(data.employeeId));
    const now = Date.now();
    const userId = currentUserId();
    const userName = currentUserName();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    if(window.cu?.role === 'admin' && await employeeHasHistoricalBusinessData(data.employeeId)){
      throw new Error('Mã nhân viên này đã từng được sử dụng và không thể cấp lại cho người khác. / 此工號已有歷史業務資料，永久不得重新分配。');
    }
    let saved;
    await window._runTransaction(async transaction=>{
      const snapshot = await transaction.get(reference);
      if(snapshot.exists()){
        throw new Error('Mã nhân viên đã tồn tại. Vui lòng dùng chức năng chỉnh sửa trong danh sách. / 工號已存在，請使用員工列表的編輯功能。');
      }
      await requireActiveDepartment(transaction,data.department);
      saved = {
        employeeId:data.employeeId,
        name:data.name,
        department:data.department,
        active:data.active,
        createdAt:now,
        createdByUid:userId,
        createdBy:userName,
        updatedAt:now,
        updatedByUid:userId,
        updatedBy:userName,
        schemaVersion:1
      };
      transaction.set(reference,saved);
    });
    return remember({id:reference.id,...saved});
  }

  async function updateEmployee(employeeId,input){
    const targetId = normalizeEmployeeId(employeeId);
    const data = validateEmployee(input);
    if(data.employeeId !== targetId){
      throw new Error('Không thể thay đổi mã nhân viên. / 工號不可變更。');
    }
    const reference = window._docRef(COLLECTION_NAME,employeeDocumentId(targetId));
    const now = Date.now();
    const userId = currentUserId();
    const userName = currentUserName();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    let saved;
    await window._runTransaction(async transaction=>{
      const snapshot = await transaction.get(reference);
      if(!snapshot.exists()) throw new Error('Không tìm thấy nhân viên. / 找不到員工資料。');
      const current = snapshot.data();
      if(current.employeeId !== targetId){
        throw new Error('Dữ liệu mã nhân viên không khớp. / 員工工號資料不一致。');
      }
      if(normalizeDepartmentName(current.department) !== data.department){
        await requireActiveDepartment(transaction,data.department);
      }
      saved = {
        ...current,
        employeeId:targetId,
        name:data.name,
        department:data.department,
        active:data.active,
        updatedAt:now,
        updatedByUid:userId,
        updatedBy:userName
      };
      transaction.set(reference,saved);
    });
    return remember({id:reference.id,...saved});
  }

  async function loadDepartments(options={}){
    if(departmentsLoaded && options.force !== true && options.revalidate !== true) return listDepartments();
    if(departmentLoadPromise) return departmentLoadPromise;
    departmentLoadPromise = (async()=>{
      const loadedRows = typeof window.firebaseLoadCachedCollection === 'function'
        ? await window.firebaseLoadCachedCollection(DEPARTMENT_COLLECTION_NAME,DEPARTMENT_COLLECTION_NAME,options)
        : (await window._getDocs(window._collection(DEPARTMENT_COLLECTION_NAME))).docs.map(item=>({id:item.id,...item.data()})); // loadedRows（快取或雲端部門資料）
      departmentRows = sortDepartments(loadedRows);
      departmentsLoaded = true;
      return listDepartments();
    })().finally(()=>{ departmentLoadPromise = null; });
    return departmentLoadPromise;
  }

  function listDepartments(options={}){
    const activeOnly = options.activeOnly === true;
    return departmentRows.filter(item=>!activeOnly || item.active === true).map(item=>({...item}));
  }

  function findDepartment(name){
    const normalized = normalizeDepartmentName(name).toLocaleLowerCase();
    return departmentRows.find(item=>normalizeDepartmentName(item.name).toLocaleLowerCase() === normalized) || null;
  }

  async function departmentInUse(name){
    const normalized = normalizeDepartmentName(name);
    const snapshot = await window._getDocs(window._query(
      window._collection(COLLECTION_NAME),
      window._where('department','==',normalized),
      window._limit(1)
    ));
    return snapshot.size > 0;
  }

  function writeDepartmentLog(transaction,action,note,changes){
    transaction.set(window._newDocRef(LOG_COLLECTION_NAME),{
      permissionKey:'productionEmployees',
      feature:'production',
      action,
      status:'success',
      createdAt:Date.now(),
      createdByUid:currentUserId(),
      createdBy:currentUserName(),
      itemCount:1,
      detailCount:Array.isArray(changes) ? changes.length : 0,
      changes:Array.isArray(changes) ? changes : [],
      note:String(note || '').slice(0,500)
    });
  }

  async function createDepartment(name){
    const normalized = validateDepartmentName(name);
    const departmentId = departmentDocumentId(normalized);
    const reference = window._docRef(DEPARTMENT_COLLECTION_NAME,departmentId);
    const now = Date.now();
    const userId = currentUserId();
    const userName = currentUserName();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    let saved;
    await window._runTransaction(async transaction=>{
      const snapshot = await transaction.get(reference);
      if(snapshot.exists()) throw new Error('Bộ phận đã tồn tại. / 部門已存在。');
      saved = {
        departmentId,
        name:normalized,
        active:true,
        createdAt:now,
        createdByUid:userId,
        createdBy:userName,
        updatedAt:now,
        updatedByUid:userId,
        updatedBy:userName,
        schemaVersion:1
      };
      transaction.set(reference,saved);
      writeDepartmentLog(transaction,DEPARTMENT_CREATE_ACTION,normalized,[{field:'name',before:null,after:normalized}]);
    });
    return rememberDepartment({id:reference.id,...saved});
  }

  async function renameDepartment(departmentId,nextName){
    const current = departmentRows.find(item=>item.departmentId === departmentId);
    if(!current) throw new Error('Không tìm thấy bộ phận. / 找不到部門資料。');
    const normalized = validateDepartmentName(nextName);
    const nextId = departmentDocumentId(normalized);
    if(normalizeDepartmentName(current.name) === normalized) return {...current};
    if(await departmentInUse(current.name)){
      throw new Error('Bộ phận đang được nhân viên sử dụng. Vui lòng chuyển nhân viên sang bộ phận khác trước. / 此部門仍有員工使用，請先將員工改到其他部門。');
    }
    const currentReference = window._docRef(DEPARTMENT_COLLECTION_NAME,departmentId);
    const nextReference = window._docRef(DEPARTMENT_COLLECTION_NAME,nextId);
    const now = Date.now();
    let saved;
    await window._runTransaction(async transaction=>{
      const currentSnapshot = await transaction.get(currentReference);
      if(!currentSnapshot.exists()) throw new Error('Không tìm thấy bộ phận. / 找不到部門資料。');
      const nextSnapshot = nextId === departmentId ? currentSnapshot : await transaction.get(nextReference);
      if(nextId !== departmentId && nextSnapshot.exists()) throw new Error('Bộ phận đã tồn tại. / 部門已存在。');
      saved = {
        ...currentSnapshot.data(),
        departmentId:nextId,
        name:normalized,
        createdAt:nextId === departmentId ? currentSnapshot.data().createdAt : now,
        createdByUid:nextId === departmentId ? currentSnapshot.data().createdByUid : currentUserId(),
        createdBy:nextId === departmentId ? currentSnapshot.data().createdBy : currentUserName(),
        updatedAt:now,
        updatedByUid:currentUserId(),
        updatedBy:currentUserName()
      };
      if(nextId !== departmentId) transaction.delete(currentReference);
      transaction.set(nextReference,saved);
      writeDepartmentLog(transaction,DEPARTMENT_RENAME_ACTION,`${current.name} → ${normalized}`,[{field:'name',before:current.name,after:normalized}]);
    });
    forgetDepartment(departmentId);
    return rememberDepartment({id:nextReference.id,...saved});
  }

  async function setDepartmentActive(departmentId,active){
    const reference = window._docRef(DEPARTMENT_COLLECTION_NAME,departmentId);
    const now = Date.now();
    let saved;
    await window._runTransaction(async transaction=>{
      const snapshot = await transaction.get(reference);
      if(!snapshot.exists()) throw new Error('Không tìm thấy bộ phận. / 找不到部門資料。');
      const current = snapshot.data();
      saved = {
        ...current,
        active:active === true,
        updatedAt:now,
        updatedByUid:currentUserId(),
        updatedBy:currentUserName()
      };
      transaction.set(reference,saved);
      writeDepartmentLog(transaction,DEPARTMENT_STATUS_ACTION,current.name,[{field:'active',before:current.active === true,after:active === true}]);
    });
    return rememberDepartment({id:reference.id,...saved});
  }

  async function deleteDepartment(departmentId){
    const current = departmentRows.find(item=>item.departmentId === departmentId);
    if(!current) throw new Error('Không tìm thấy bộ phận. / 找不到部門資料。');
    if(await departmentInUse(current.name)){
      throw new Error('Bộ phận đang được nhân viên sử dụng. Vui lòng chuyển nhân viên sang bộ phận khác trước. / 此部門仍有員工使用，請先將員工改到其他部門。');
    }
    const reference = window._docRef(DEPARTMENT_COLLECTION_NAME,departmentId);
    await window._runTransaction(async transaction=>{
      const snapshot = await transaction.get(reference);
      if(!snapshot.exists()) throw new Error('Không tìm thấy bộ phận. / 找不到部門資料。');
      transaction.delete(reference);
      writeDepartmentLog(transaction,DEPARTMENT_DELETE_ACTION,current.name,[{field:'name',before:current.name,after:null}]);
    });
    forgetDepartment(departmentId);
    return {departmentId};
  }

  async function setActive(employeeId,active){
    const normalized = normalizeEmployeeId(employeeId);
    const reference = window._docRef(COLLECTION_NAME,employeeDocumentId(normalized));
    const now = Date.now();
    const userId = currentUserId();
    const userName = currentUserName();
    let saved;
    await window._runTransaction(async transaction=>{
      const snapshot = await transaction.get(reference);
      if(!snapshot.exists()) throw new Error('Không tìm thấy nhân viên. / 找不到員工資料。');
      const current = snapshot.data();
      saved = {...current,active:active === true,updatedAt:now,updatedByUid:userId,updatedBy:userName};
      transaction.set(reference,saved);
    });
    return remember({id:reference.id,...saved});
  }

  async function deleteEmployee(employeeId){
    if(window.cu?.role !== 'admin'){
      throw new Error('Chỉ quản trị viên mới được xóa vĩnh viễn nhân viên. / 只有管理員可以永久刪除員工。');
    }
    const normalized = normalizeEmployeeId(employeeId);
    const current = find(normalized);
    if(!current) throw new Error('Không tìm thấy nhân viên. / 找不到員工資料。');

    // 先停用員工，避免檢查關聯資料期間又建立新的生產登記。
    if(current.active === true) await setActive(normalized,false);
    if(await employeeHasHistoricalBusinessData(normalized)){
      throw new Error('Nhân viên đã có dữ liệu nghiệp vụ lịch sử; chỉ được ngừng sử dụng, không được xóa vĩnh viễn. / 員工已有歷史業務資料，只能停用，不得永久刪除。');
    }

    const reference = window._docRef(COLLECTION_NAME,employeeDocumentId(normalized));
    const logReference = window._newDocRef(LOG_COLLECTION_NAME);
    const now = Date.now();
    await window._runTransaction(async transaction=>{
      const snapshot = await transaction.get(reference);
      if(!snapshot.exists()) throw new Error('Không tìm thấy nhân viên. / 找不到員工資料。');
      const employee = snapshot.data();
      if(employee.active !== false){
        throw new Error('Phải ngừng sử dụng nhân viên trước khi xóa vĩnh viễn. / 永久刪除前必須先停用員工。');
      }
      transaction.delete(reference);
      transaction.set(logReference,{
        permissionKey:'productionEmployees',
        feature:'production',
        action:EMPLOYEE_DELETE_ACTION,
        status:'success',
        createdAt:now,
        createdByUid:currentUserId(),
        createdBy:currentUserName(),
        itemCount:1,
        detailCount:1,
        changes:[{field:'employeeId',before:employee.employeeId,after:null}],
        note:`${employee.employeeId} · ${normalizeText(employee.name)}`.slice(0,500)
      });
    });
    rows = rows.filter(item=>item.employeeId !== normalized);
    return {employeeId:normalized};
  }

  function reset(){
    rows = [];
    loaded = false;
    loadPromise = null;
    departmentRows = [];
    departmentsLoaded = false;
    departmentLoadPromise = null;
  }

  window.PCMSProductionEmployees = Object.freeze({
    load,list,find,createEmployee,updateEmployee,setActive,deleteEmployee,
    loadDepartments,listDepartments,findDepartment,createDepartment,renameDepartment,setDepartmentActive,deleteDepartment,
    reset,normalizeEmployeeId,validateEmployee,validateDepartmentName
  });
})();
