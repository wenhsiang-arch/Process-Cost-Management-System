// attendance-store（產能考勤資料存取程式）：管理每日考勤並提供員工每日效率計算。
(function(){
  'use strict';

  const COLLECTION_NAME = 'productionAttendance'; // COLLECTION_NAME（產能考勤集合名稱）
  const LOG_COLLECTION_NAME = 'operationLogs'; // LOG_COLLECTION_NAME（操作紀錄集合名稱）
  const CACHE_SCOPE = 'productionAttendance'; // CACHE_SCOPE（產能考勤資料版本名稱）
  const CACHE_DAY_PREFIX = 'productionAttendanceDay:'; // CACHE_DAY_PREFIX（依日期分開保存的考勤快取）
  const CACHE_RECORD_PREFIX = 'productionAttendanceRecord:'; // CACHE_RECORD_PREFIX（單筆考勤快取）
  const PAGE_SIZE = 200; // PAGE_SIZE（單一日期分頁讀取筆數）
  const MAX_TRANSACTION_ITEMS = 10; // MAX_TRANSACTION_ITEMS（單次交易最多考勤筆數）：保留安全規則文件存取餘量。
  const dayCache = new Map(); // dayCache（目前工作階段日期快取）
  const dayCacheVersions = new Map(); // dayCacheVersions（日期快取使用的資料版本）
  const dayPromises = new Map(); // dayPromises（避免同日期重複查詢）
  const recordCache = new Map(); // recordCache（單筆考勤快取）
  const recordCacheVersions = new Map(); // recordCacheVersions（單筆快取使用的資料版本）
  const efficiencyPromises = new Map(); // efficiencyPromises（同員工同日期效率共用工作）

  function currentUserId(){ return String(window.firebaseAuthUser?.uid || ''); }
  function currentUserName(){ return String(window.cu?.user || window.cu?.username || ''); }
  function normalizeText(value){ return String(value || '').trim().replace(/\s+/g,' '); }
  function normalizeEmployeeId(value){
    return window.PCMSProductionEmployees?.normalizeEmployeeId?.(value)
      || normalizeText(value).toUpperCase();
  }
  function normalizeDate(value){ return String(value || '').trim(); }
  function isValidDate(value){
    if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
    const [year,month,day] = value.split('-').map(Number);
    const date = new Date(year,month-1,day);
    return date.getFullYear() === year && date.getMonth() === month-1 && date.getDate() === day;
  }
  function isValidHours(value){
    const hours = Number(value);
    return Number.isFinite(hours) && hours >= 0 && hours <= 24 && Number.isInteger(hours*2);
  }
  function attendanceDocumentId(productionDate,employeeId){
    return `${normalizeDate(productionDate)}__${normalizeEmployeeId(employeeId)}`;
  }
  function cacheKey(employeeId,productionDate){
    return `${normalizeEmployeeId(employeeId)}|${normalizeDate(productionDate)}`;
  }
  function dayCacheScope(productionDate){ return `${CACHE_DAY_PREFIX}${normalizeDate(productionDate)}`; }
  function recordCacheScope(employeeId,productionDate){ return `${CACHE_RECORD_PREFIX}${cacheKey(employeeId,productionDate)}`; }
  function clone(value){ return value ? {...value} : null; }
  function dataVersionToken(){
    return `${Date.now()}-${currentUserId().slice(0,12)}-${Math.random().toString(36).slice(2,8)}`;
  }
  async function readDataVersion(force=false){
    if(window.firebaseReadDataVersions){
      const versionState=await window.firebaseReadDataVersions(force);
      return String(versionState?.data?.[CACHE_SCOPE]||'0');
    }
    const snapshot = await window._getDoc(window._docRef('system','dataVersions'));
    return String(snapshot.exists() ? snapshot.data()?.[CACHE_SCOPE] || '0' : '0');
  }
  function sortRows(rows){
    return rows.slice().sort((a,b)=>String(a.employeeId || '').localeCompare(String(b.employeeId || ''),'en',{numeric:true,sensitivity:'base'}));
  }
  function validateAttendanceInput(input){
    const attendanceDate = normalizeDate(input?.attendanceDate);
    const employeeId = normalizeEmployeeId(input?.employeeId);
    const normalHours = Number(input?.normalHours);
    const overtimeHours = Number(input?.overtimeHours);
    const note = normalizeText(input?.note);
    if(!isValidDate(attendanceDate)) throw new Error('Ngày chấm công không hợp lệ. / 考勤日期不正確。');
    if(!employeeId) throw new Error('Thiếu mã nhân viên. / 缺少員工工號。');
    if(!isValidHours(normalHours) || !isValidHours(overtimeHours)){
      throw new Error('Giờ chấm công phải từ 0 đến 24 giờ và tăng theo mỗi 0,5 giờ. / 考勤時數必須為0至24小時，並以0.5小時為單位。');
    }
    if(normalHours + overtimeHours > 24){
      throw new Error('Tổng giờ bình thường và tăng ca không được vượt quá 24 giờ. / 正常工時與加班工時合計不得超過24小時。');
    }
    if(note.length > 200) throw new Error('Ghi chú không được vượt quá 200 ký tự. / 備註不得超過200字。');
    return {attendanceDate,employeeId,normalHours,overtimeHours,note};
  }

  async function readDayFromCloud(attendanceDate){
    const rows = [];
    let cursor = null;
    do{
      const conditions = [window._where('attendanceDate','==',attendanceDate)];
      if(cursor) conditions.push(window._startAfter(cursor));
      conditions.push(window._limit(PAGE_SIZE));
      const snapshot = await window._getDocs(window._query(window._collection(COLLECTION_NAME),...conditions));
      rows.push(...snapshot.docs.map(item=>({id:item.id,...item.data()})));
      cursor = snapshot.size === PAGE_SIZE ? snapshot.docs[snapshot.docs.length-1] : null;
    }while(cursor);
    return sortRows(rows);
  }

  async function loadDay(value,options={}){
    const attendanceDate = normalizeDate(value);
    if(!isValidDate(attendanceDate)) throw new Error('Ngày chấm công không hợp lệ. / 考勤日期不正確。');
    if(dayPromises.has(attendanceDate)) return dayPromises.get(attendanceDate);
    const promise = (async()=>{
      const version = await readDataVersion();
      if(options.force !== true && dayCacheVersions.get(attendanceDate)===version && dayCache.has(attendanceDate)){
        return dayCache.get(attendanceDate).map(item=>({...item}));
      }
      if(options.force !== true && window.pcmsDataCache){
        const cached = await window.pcmsDataCache.read(dayCacheScope(attendanceDate),version);
        if(Array.isArray(cached)){
          const cachedRows = sortRows(cached);
          dayCache.set(attendanceDate,cachedRows);
          dayCacheVersions.set(attendanceDate,version);
          cachedRows.forEach(row=>{
            const key=cacheKey(row.employeeId,row.attendanceDate);
            recordCache.set(key,row);
            recordCacheVersions.set(key,version);
          });
          return cachedRows.map(item=>({...item}));
        }
      }
      const rows = await readDayFromCloud(attendanceDate);
      window.PCMSUsageMetrics?.recordFullLoad?.({scope:CACHE_SCOPE});
      const latestVersion = await readDataVersion(true);
      dayCache.set(attendanceDate,rows);
      dayCacheVersions.set(attendanceDate,latestVersion);
      rows.forEach(row=>{
        const key=cacheKey(row.employeeId,row.attendanceDate);
        recordCache.set(key,row);
        recordCacheVersions.set(key,latestVersion);
      });
      await window.pcmsDataCache?.write(dayCacheScope(attendanceDate),latestVersion,rows);
      return rows.map(item=>({...item}));
    })().finally(()=>dayPromises.delete(attendanceDate));
    dayPromises.set(attendanceDate,promise);
    return promise;
  }

  async function loadOne(employeeId,productionDate,options={}){
    const key = cacheKey(employeeId,productionDate);
    const version = await readDataVersion();
    if(options.force !== true && recordCacheVersions.get(key)===version && recordCache.has(key)) return clone(recordCache.get(key));
    const date=normalizeDate(productionDate);
    if(options.force!==true&&dayCacheVersions.get(date)===version&&dayCache.has(date)){
      const row=dayCache.get(date).find(item=>normalizeEmployeeId(item.employeeId)===normalizeEmployeeId(employeeId))||null;
      recordCache.set(key,row);
      recordCacheVersions.set(key,version);
      return clone(row);
    }
    if(options.force !== true && window.pcmsDataCache){
      const cachedDay = await window.pcmsDataCache.read(dayCacheScope(productionDate),version);
      if(Array.isArray(cachedDay)){
        const row = cachedDay.find(item=>normalizeEmployeeId(item.employeeId) === normalizeEmployeeId(employeeId)) || null;
        recordCache.set(key,row);
        recordCacheVersions.set(key,version);
        return clone(row);
      }
      const cachedRecord = await window.pcmsDataCache.read(recordCacheScope(employeeId,productionDate),version);
      if(cachedRecord&&cachedRecord.cached===true){
        const row = cachedRecord.found===true ? cachedRecord.row : null;
        recordCache.set(key,row);
        recordCacheVersions.set(key,version);
        return clone(row);
      }
    }
    const reference = window._docRef(COLLECTION_NAME,attendanceDocumentId(productionDate,employeeId));
    const snapshot = await window._getDoc(reference);
    const row = snapshot.exists() ? {id:snapshot.id,...snapshot.data()} : null;
    recordCache.set(key,row);
    const latestVersion = await readDataVersion(true);
    recordCacheVersions.set(key,latestVersion);
    await window.pcmsDataCache?.write(recordCacheScope(employeeId,productionDate),latestVersion,{cached:true,found:!!row,row});
    return clone(row);
  }

  function operationLogData(action,itemCount,note,changes,now){
    return {
      permissionKey:'productionAttendance',
      feature:'production',
      action,
      status:'success',
      createdAt:now,
      createdByUid:currentUserId(),
      createdBy:currentUserName(),
      itemCount,
      detailCount:Array.isArray(changes) ? changes.length : 0,
      changes:Array.isArray(changes) ? changes.slice(0,50) : [],
      note:normalizeText(note).slice(0,500)
    };
  }

  async function invalidate(attendanceDate,employeeIds=[]){
    const date = normalizeDate(attendanceDate);
    dayCache.delete(date);
    dayCacheVersions.delete(date);
    dayPromises.delete(date);
    (employeeIds || []).forEach(employeeId=>{
      const key = cacheKey(employeeId,date);
      recordCache.delete(key);
      recordCacheVersions.delete(key);
      efficiencyPromises.delete(key);
    });
    await Promise.all([
      window.pcmsDataCache?.remove(dayCacheScope(date)),
      ...(employeeIds||[]).map(employeeId=>window.pcmsDataCache?.remove(recordCacheScope(employeeId,date)))
    ]);
    window.PCMSFeatures?.invalidateDataScopes?.(['productionAttendance']);
  }

  async function saveChunk(inputs){
    const now = Date.now();
    const logReference = window._newDocRef(LOG_COLLECTION_NAME);
    const versionReference = window._docRef('system','dataVersions');
    const references = inputs.map(input=>({
      input,
      employeeReference:window._docRef('productionEmployees',input.employeeId),
      attendanceReference:window._docRef(COLLECTION_NAME,attendanceDocumentId(input.attendanceDate,input.employeeId))
    }));
    const savedRows = [];
    await window._runTransaction(async transaction=>{
      const snapshots = await Promise.all(references.flatMap(item=>[
        transaction.get(item.employeeReference),transaction.get(item.attendanceReference)
      ]));
      references.forEach((item,index)=>{
        const employeeSnapshot = snapshots[index*2];
        const attendanceSnapshot = snapshots[index*2+1];
        if(!employeeSnapshot.exists()) throw new Error('Không tìm thấy nhân viên. / 找不到員工資料。');
        const employee = employeeSnapshot.data();
        const current = attendanceSnapshot.exists() ? attendanceSnapshot.data() : null;
        if(!current && employee.active !== true){
          throw new Error('Không thể tạo chấm công mới cho nhân viên đã ngừng sử dụng. / 不能為已停用員工新增考勤。');
        }
        const attendanceId = attendanceDocumentId(item.input.attendanceDate,item.input.employeeId);
        const saved = {
          attendanceId,
          attendanceDate:item.input.attendanceDate,
          employeeId:item.input.employeeId,
          employeeName:normalizeText(employee.name),
          department:normalizeText(employee.department),
          normalHours:item.input.normalHours,
          overtimeHours:item.input.overtimeHours,
          note:item.input.note,
          revision:current ? Number(current.revision || 1)+1 : 1,
          createdAt:current ? current.createdAt : now,
          createdByUid:current ? current.createdByUid : currentUserId(),
          createdBy:current ? current.createdBy : currentUserName(),
          updatedAt:now,
          updatedByUid:currentUserId(),
          updatedBy:currentUserName(),
          schemaVersion:1
        };
        transaction.set(item.attendanceReference,saved);
        savedRows.push({id:item.attendanceReference.id,...saved});
      });
      transaction.set(logReference,operationLogData(
        'productionAttendanceSave',
        savedRows.length,
        `${savedRows[0]?.attendanceDate || ''} · ${savedRows.length}`,
        savedRows.map(row=>({field:'attendanceId',before:null,after:row.attendanceId})),
        now
      ));
      transaction.set(versionReference,{
        updatedAt:now,
        updatedBy:currentUserId(),
        productionAttendance:dataVersionToken()
      },{merge:true});
    });
    return savedRows;
  }

  function reportSaveProgress(options,payload){
    if(typeof options?.onProgress !== 'function') return;
    try{ options.onProgress({...payload}); }
    catch(error){ console.error('考勤批次儲存進度回報失敗：',error); }
  }

  async function invalidateSafely(attendanceDate,employeeIds=[]){
    try{ await invalidate(attendanceDate,employeeIds); }
    catch(error){ console.warn('考勤正式資料已寫入，但本機快取清除失敗，下次開啟將重新檢查資料版本：',error); }
  }

  function createBatchSaveError(error,savedRows,pendingInputs,totalCount){
    const message = normalizeText(error?.message)
      || 'Không thể hoàn tất lưu chấm công hàng loạt. / 無法完成考勤批次儲存。';
    const failure = new Error(message); // failure（批次儲存錯誤）：保留已完成與待重試範圍。
    failure.name = 'ProductionAttendanceBatchError';
    failure.code = normalizeText(error?.code) || 'production-attendance-batch-failed';
    failure.cause = error;
    failure.savedRows = savedRows.map(item=>({...item}));
    failure.pendingInputs = pendingInputs.map(item=>({...item}));
    failure.savedCount = savedRows.length;
    failure.remainingCount = pendingInputs.length;
    failure.totalCount = totalCount;
    return failure;
  }

  async function saveMany(items,options={}){
    const inputs = (Array.isArray(items) ? items : []).map(validateAttendanceInput);
    if(!inputs.length) return [];
    if(!currentUserId()) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    const dates = new Set(inputs.map(item=>item.attendanceDate));
    if(dates.size !== 1) throw new Error('Chỉ được lưu một ngày chấm công mỗi lần. / 每次只能儲存一個考勤日期。');
    const saved = [];
    for(let index=0;index<inputs.length;index+=MAX_TRANSACTION_ITEMS){
      const chunk = inputs.slice(index,index+MAX_TRANSACTION_ITEMS); // chunk（安全批次）：避免單次交易超過規則文件存取上限。
      let chunkRows = [];
      try{
        chunkRows = await saveChunk(chunk);
      }catch(error){
        await invalidateSafely(inputs[0].attendanceDate,saved.map(item=>item.employeeId));
        throw createBatchSaveError(error,saved,inputs.slice(index),inputs.length);
      }
      saved.push(...chunkRows);
      await window.PCMSProductionChanges?.markSafely?.(chunkRows);
      reportSaveProgress(options,{
        completed:saved.length,
        total:inputs.length,
        chunkSize:chunkRows.length,
        remaining:Math.max(0,inputs.length-saved.length)
      });
    }
    await invalidateSafely(inputs[0].attendanceDate,inputs.map(item=>item.employeeId));
    return saved.map(item=>({...item}));
  }

  async function deleteAttendance(attendanceId){
    if(window.cu?.role !== 'admin') throw new Error('Chỉ quản trị viên mới được xóa chấm công. / 只有管理員可以刪除考勤。');
    const reference = window._docRef(COLLECTION_NAME,normalizeText(attendanceId));
    const logReference = window._newDocRef(LOG_COLLECTION_NAME);
    const versionReference = window._docRef('system','dataVersions');
    let deleted = null;
    const now = Date.now();
    await window._runTransaction(async transaction=>{
      const snapshot = await transaction.get(reference);
      if(!snapshot.exists()) throw new Error('Không tìm thấy dữ liệu chấm công. / 找不到考勤資料。');
      deleted = {id:snapshot.id,...snapshot.data()};
      transaction.delete(reference);
      transaction.set(logReference,operationLogData(
        'productionAttendanceDelete',1,deleted.attendanceId,
        [{field:'attendanceId',before:deleted.attendanceId,after:null}],now
      ));
      transaction.set(versionReference,{
        updatedAt:now,
        updatedBy:currentUserId(),
        productionAttendance:dataVersionToken()
      },{merge:true});
    });
    await invalidate(deleted.attendanceDate,[deleted.employeeId]);
    await window.PCMSProductionChanges?.markSafely?.([deleted]);
    return deleted;
  }

  function calculateEfficiency(entries,attendance){
    let standardHours = 0;
    let invalidCapacity = false;
    (Array.isArray(entries) ? entries : []).filter(item=>item?.status === 'active').forEach(item=>{
      if(item.recordType === 'supplement' || String(item.processNo || '') === '0'){
        const hours = Number(item.supplementHours);
        if(Number.isFinite(hours) && hours > 0) standardHours += hours;
        return;
      }
      const quantity = Number(item.quantity);
      const capacity = Number(item.hourlyCapacitySnapshot);
      if(Number.isFinite(quantity) && quantity > 0 && Number.isFinite(capacity) && capacity > 0){
        standardHours += quantity/capacity;
      }else if(Number.isFinite(quantity) && quantity > 0){
        invalidCapacity = true;
      }
    });
    if(!attendance) return {status:'missing-attendance',standardHours,workedHours:null,percentage:null};
    const workedHours = Number(attendance.normalHours || 0)+Number(attendance.overtimeHours || 0);
    if(invalidCapacity) return {status:'invalid-capacity',standardHours,workedHours,percentage:null};
    if(workedHours <= 0){
      return standardHours > 0
        ? {status:'invalid-attendance',standardHours,workedHours,percentage:null}
        : {status:'absent',standardHours:0,workedHours:0,percentage:null};
    }
    return {status:'ready',standardHours,workedHours,percentage:(standardHours/workedHours)*100};
  }

  async function efficiencyFor(employeeId,productionDate,options={}){
    const key = cacheKey(employeeId,productionDate);
    if(efficiencyPromises.has(key)) return efficiencyPromises.get(key);
    const promise = Promise.all([
      options.entries ? Promise.resolve(options.entries) : window.PCMSProductionReports.loadDaily(employeeId,productionDate),
      loadOne(employeeId,productionDate,options)
    ]).then(([entries,attendance])=>calculateEfficiency(entries,attendance))
      .finally(()=>efficiencyPromises.delete(key));
    efficiencyPromises.set(key,promise);
    return promise;
  }

  function reset(){
    dayCache.clear();
    dayCacheVersions.clear();
    dayPromises.clear();
    recordCache.clear();
    recordCacheVersions.clear();
    efficiencyPromises.clear();
  }

  window.PCMSProductionAttendance = Object.freeze({
    loadDay,loadOne,saveMany,deleteAttendance,calculateEfficiency,efficiencyFor,
    validateAttendanceInput,isValidHours,attendanceDocumentId,reset
  });
})();
