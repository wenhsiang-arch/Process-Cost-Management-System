// employee-store（產能員工資料存取程式）：只管理產能名冊，不處理畫面。
(function(){
  'use strict';

  const COLLECTION_NAME = 'productionEmployees'; // COLLECTION_NAME（產能員工集合名稱）
  const EMPLOYEE_ID_PATTERN = /^[A-Z0-9_-]{1,30}$/; // EMPLOYEE_ID_PATTERN（工號允許格式）
  let rows = []; // rows（目前工作階段員工資料）
  let loaded = false; // loaded（是否已載入）
  let loadPromise = null; // loadPromise（共用載入工作）

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

  async function load(options={}){
    if(loaded && options.force !== true) return rows.slice();
    if(loadPromise) return loadPromise;
    loadPromise = (async()=>{
      const snapshot = await window._getDocs(window._collection(COLLECTION_NAME));
      rows = sortRows(snapshot.docs.map(item=>({id:item.id,...item.data()})));
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

  function search(term,options={}){
    const needle = normalizeText(term).toLocaleLowerCase();
    const maximum = Math.max(1,Math.min(Number(options.limit) || 20,50));
    const activeOnly = options.activeOnly !== false;
    const source = rows.filter(item=>!activeOnly || item.active === true);
    if(!needle) return source.slice(0,maximum).map(item=>({...item}));
    return source.filter(item=>[
      item.employeeId,item.name,item.department
    ].some(value=>String(value || '').toLocaleLowerCase().includes(needle))).slice(0,maximum).map(item=>({...item}));
  }

  async function save(input){
    const data = validateEmployee(input);
    const reference = window._docRef(COLLECTION_NAME,employeeDocumentId(data.employeeId));
    const now = Date.now();
    const userId = currentUserId();
    const userName = currentUserName();
    if(!userId) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    let saved;
    await window._runTransaction(async transaction=>{
      const snapshot = await transaction.get(reference);
      if(snapshot.exists()){
        const current = snapshot.data();
        if(current.employeeId !== data.employeeId){
          throw new Error('Mã nhân viên đã tồn tại hoặc không thể thay đổi. / 工號已存在或不可變更。');
        }
        saved = {
          ...current,
          name:data.name,
          department:data.department,
          active:data.active,
          updatedAt:now,
          updatedByUid:userId,
          updatedBy:userName
        };
        transaction.set(reference,saved);
      }else{
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
      }
    });
    return remember({id:reference.id,...saved});
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

  function reset(){
    rows = [];
    loaded = false;
    loadPromise = null;
  }

  window.PCMSProductionEmployees = Object.freeze({
    load,list,find,search,save,setActive,reset,normalizeEmployeeId,validateEmployee
  });
})();
