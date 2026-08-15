// bonus-store（績效獎金資料）：開頁核對來源版本，並在鎖定或匯出前重新試算。
(function(){
  'use strict';

  const SETTINGS_PATH=['system','performanceBonusSettings'];
  const TABLE_COLLECTION='performanceBonusTables';
  const MONTH_COLLECTION='performanceBonusMonths';
  const PRIVATE_MONTH_COLLECTION='performanceBonusPrivateMonths';
  const MONTH_SOURCE_VERSION_COLLECTION='productionMonthVersions';
  const LOG_COLLECTION='operationLogs';
  const LOCKED_STATUSES=new Set(['locked','exported','paid']);
  const MAX_EMPLOYEES_PER_CALCULATION=440;
  const EMPLOYEE_WRITE_CHUNK_SIZE=5;
  const SCHEMA_VERSION=1;

  const DEFAULT_SETTINGS=Object.freeze({unitPrice:400,companyShare:50,employeeShare:50,efficiencyCap:120,baseEfficiency:80,minAttendanceHours:8});
  function calculations(){
    if(!window.PCMSPerformanceBonusCalculations) throw new Error('Bộ tính thưởng chưa sẵn sàng. / 獎金計算程式尚未載入。');
    return window.PCMSPerformanceBonusCalculations;
  }
  function normalizeSettings(input={}){ return calculations().normalizeSettings(input); }
  function uid(){ return String(window.firebaseAuthUser?.uid||window.cu?.authUid||window.cu?.uid||'').trim(); }
  function username(){ return String(window.cu?.user||window.cu?.username||window.cu?.displayName||window.cu?.email||uid()||'unknown').slice(0,200); }
  function now(){ return Date.now(); }
  function token(prefix){ return `${Date.now()}-${prefix}-${uid().slice(0,12)}-${Math.random().toString(36).slice(2,10)}`; }
  function currentMonth(){
    const today=typeof window.formatLocalDate==='function'?window.formatLocalDate(new Date()):new Date().toISOString().slice(0,10);
    return today.slice(0,7);
  }
  function validMonth(value){ return /^20\d{2}-(0[1-9]|1[0-2])$/.test(String(value||'')); }
  function requireMonth(value){
    const month=String(value||'');
    if(!validMonth(month)) throw new Error('Tháng không hợp lệ. / 月份不正確。');
    return month;
  }
  function monthRange(value){
    const month=requireMonth(value);
    const [year,number]=month.split('-').map(Number);
    const from=`${month}-01`;
    const end=`${month}-${String(new Date(year,number,0).getDate()).padStart(2,'0')}`;
    const today=typeof window.formatLocalDate==='function'?window.formatLocalDate(new Date()):new Date().toISOString().slice(0,10);
    return {from,to:month===today.slice(0,7)&&end>today?today:end};
  }
  function settingsRef(){ return window._docRef(...SETTINGS_PATH); }
  function tableRef(){ return window._docRef(TABLE_COLLECTION,'current'); }
  function monthRef(month){ return window._docRef(MONTH_COLLECTION,requireMonth(month)); }
  function privateMonthRef(month){ return window._docRef(PRIVATE_MONTH_COLLECTION,requireMonth(month)); }
  function monthSourceVersionRef(month){ return window._docRef(MONTH_SOURCE_VERSION_COLLECTION,requireMonth(month)); }
  function employeeCollection(month){ return `${MONTH_COLLECTION}/${requireMonth(month)}/employees`; }
  function employeeRef(month,employeeId){ return window._docRef(employeeCollection(month),String(employeeId||'').trim()); }
  async function versions(scopes,force=false){ return window.firebaseReadDataVersions?window.firebaseReadDataVersions(scopes,force):{data:{}}; }
  function snapshotData(snapshot){ return snapshot?.exists?.()?{id:snapshot.id,...snapshot.data()}:null; }
  function logData(action,itemCount=0,detailCount=0,note='',changes=[],extra={}){
    const settingsAction=action==='performanceBonusSettingsUpdate'||extra.privateCalculation===true;
    return {
      permissionKey:settingsAction?'performanceBonusSettings':'performanceBonus',
      feature:settingsAction?'performanceBonusSettings':'performanceBonus',
      action,status:'success',createdAt:now(),createdByUid:uid(),createdBy:username(),
      itemCount:Math.max(0,Math.round(Number(itemCount)||0)),detailCount:Math.max(0,Math.round(Number(detailCount)||0)),
      note:String(note||'').slice(0,500),changes:(Array.isArray(changes)?changes:[]).slice(0,50),
      ...(extra.fileName?{fileName:String(extra.fileName).slice(0,300)}:{})
    };
  }
  async function cachedRead(scope,versionKey,loader,options={}){
    const state=await versions([versionKey],options.force===true);
    const version=String(state?.data?.[versionKey]||'0');
    if(options.force!==true){
      const cached=await window.pcmsDataCache?.read(scope,version);
      if(cached!==null&&cached!==undefined) return cached;
    }
    const data=await loader();
    await window.pcmsDataCache?.write(scope,version,data);
    return data;
  }

  function publicTableData(settings,updatedAt=now()){
    const normalized=normalizeSettings(settings);
    return {
      version:Math.max(1,Math.round(Number(settings.revision)||1)),baseEfficiency:80,minAttendanceHours:8,
      efficiencyCap:normalized.efficiencyCap,
      employeePointHourAmount:Number((normalized.unitPrice*(normalized.employeeShare/100)).toFixed(6)),
      rows:calculations().referenceRows(normalized),updatedAt,updatedByUid:uid(),updatedBy:username(),schemaVersion:SCHEMA_VERSION
    };
  }

  async function loadSettings(options={}){
    return cachedRead('performanceBonusSettings','performanceBonusSettings',async()=>{
      const snapshot=await window._getDoc(settingsRef());
      const saved=snapshotData(snapshot);
      const normalized=normalizeSettings(saved||DEFAULT_SETTINGS);
      return {...normalized,revision:Number(saved?.revision)||0,updatedAt:Number(saved?.updatedAt)||0};
    },options);
  }
  async function loadReferenceTable(options={}){
    return cachedRead('performanceBonusTable','performanceBonusTables',async()=>snapshotData(await window._getDoc(tableRef())),options);
  }
  async function readEmployeeDocuments(month){
    const snapshot=await window._getDocs(window._query(window._collection(employeeCollection(month))));
    return snapshot.docs.map(item=>({id:item.id,...item.data()}));
  }
  async function readStoredMonth(month){
    const normalized=requireMonth(month);
    const [metadataSnapshot,employees]=await Promise.all([window._getDoc(monthRef(normalized)),readEmployeeDocuments(normalized)]);
    const metadata=snapshotData(metadataSnapshot);
    const calculationId=String(metadata?.calculationId||'');
    return {metadata,employees:calculationId?employees.filter(item=>item.calculationId===calculationId):[],allEmployees:employees};
  }
  async function loadPrivateMonth(month,options={}){
    const normalized=requireMonth(month);
    return cachedRead(`performanceBonusPrivateMonth:${normalized}`,'performanceBonusPrivateMonths',async()=>snapshotData(await window._getDoc(privateMonthRef(normalized))),options);
  }
  async function readSourceVersions(month){
    const snapshot=await window._getDoc(monthSourceVersionRef(month));
    const data=snapshot.exists()?snapshot.data():{};
    return {entries:String(data.entriesVersion||'0'),attendance:String(data.attendanceVersion||'0')};
  }
  function sameSourceVersions(left,right){ return left.entries===right.entries&&left.attendance===right.attendance; }
  function monthIsCurrent(metadata,source,table){
    return !!metadata&&metadata.status==='draft'&&metadata.requiresRecalculation!==true
      &&String(metadata.sourceEntriesVersion||'0')===source.entries
      &&String(metadata.sourceAttendanceVersion||'0')===source.attendance
      &&Number(metadata.settingsVersion||0)===Number(table?.version||0)
      &&String(metadata.calculationId||'')!==''
      &&Object.prototype.hasOwnProperty.call(metadata,'anomalyCount');
  }
  async function loadStablePerformance(month,maxAttempts=4){
    const range=monthRange(month);
    if(typeof window.PCMSProductionPerformance?.loadPerformanceRange!=='function'){
      throw new Error('Chức năng tổng hợp hiệu suất chưa sẵn sàng. / 員工績效彙整功能尚未載入。');
    }
    for(let attempt=0;attempt<maxAttempts;attempt+=1){
      const before=await readSourceVersions(month);
      await versions(['productionEntries','productionAttendance'],true);
      const rows=await window.PCMSProductionPerformance.loadPerformanceRange(range.from,range.to);
      const after=await readSourceVersions(month);
      if(sameSourceVersions(before,after)) return {rows,source:after};
    }
    throw new Error('Dữ liệu sản lượng hoặc chấm công đang thay đổi. Vui lòng thử lại. / 產能或考勤資料持續變動，請稍後重試。');
  }
  function anomalyRows(rows){
    const anomalies=[];
    (Array.isArray(rows)?rows:[]).forEach(row=>{
      let reason=String(row.attendanceStatus||'');
      if(!reason&&['missing-attendance','invalid-attendance','invalid-capacity'].includes(String(row.status||''))) reason=String(row.status);
      if(!reason&&Number(row.supplementHours)>Number(row.workedHours)) reason='supplement-over-attendance';
      if(!reason) return;
      anomalies.push({date:String(row.productionDate||''),employeeId:String(row.employeeId||''),employeeName:String(row.employeeName||'—'),reason});
    });
    return anomalies;
  }
  function adjustmentMaps(rows){
    return {
      amounts:new Map((rows||[]).map(item=>[String(item.employeeId||item.id),Number(item.adjustmentAmount)||0])),
      notes:new Map((rows||[]).map(item=>[String(item.employeeId||item.id),String(item.adjustmentNote||'')]))
    };
  }
  function publicEmployeeData(month,item,calculationId,calculatedAt,note=''){
    return {
      month,employeeId:item.employeeId,employeeName:item.employeeName,department:item.department,
      days:item.days.map(day=>({date:day.date,attendanceHours:day.attendanceHours,actualEfficiency:day.actualEfficiency,rewardEfficiency:day.rewardEfficiency,bonus:day.bonus})),
      qualifyingDays:item.qualifyingDays,calculatedHours:item.calculatedHours,baseBonus:item.baseBonus,
      adjustmentAmount:item.adjustmentAmount,adjustmentNote:note,finalBonus:item.finalBonus,
      calculationId,calculatedAt,updatedAt:calculatedAt,updatedByUid:uid(),updatedBy:username(),schemaVersion:SCHEMA_VERSION
    };
  }

  async function calculateAndPersistMonth(month,options={}){
    const normalized=requireMonth(month);
    const current=options.current||await readStoredMonth(normalized);
    if(current.metadata&&LOCKED_STATUSES.has(current.metadata.status)) return current;
    const includePrivate=options.includePrivate===true;
    const loadedSettings=includePrivate?(options.settings||await loadSettings({force:true})):null;
    const settings=includePrivate?normalizeSettings(loadedSettings):null;
    const table=options.table||(includePrivate?publicTableData({...settings,revision:loadedSettings?.revision||1}):await loadReferenceTable({force:true}));
    if(!table||Number(table.version)<=0) throw new Error('Chưa có bảng đối chiếu thưởng. Hãy lưu tham số trước. / 尚無獎金對照表，請先儲存參數。');
    const stable=await loadStablePerformance(normalized);
    const adjustments=adjustmentMaps(current.allEmployees);
    const result=includePrivate
      ?calculations().calculateMonth(stable.rows,settings,adjustments.amounts)
      :calculations().calculatePublicMonth(stable.rows,table,adjustments.amounts);
    if(result.employees.length>MAX_EMPLOYEES_PER_CALCULATION){
      throw new Error(`Có quá ${MAX_EMPLOYEES_PER_CALCULATION} nhân viên trong một tháng. / 單月員工超過 ${MAX_EMPLOYEES_PER_CALCULATION} 人，已停止寫入。`);
    }
    const calculationId=token('calculation');
    const calculatedAt=now();
    const anomalies=anomalyRows(stable.rows);
    const metadata={
      month:normalized,status:'draft',calculationId,settingsVersion:Number(table.version)||0,
      sourceEntriesVersion:stable.source.entries,sourceAttendanceVersion:stable.source.attendance,
      employeeCount:result.employees.length,eligibleEmployeeCount:result.employees.filter(item=>item.finalBonus>0).length,
      baseBonusTotal:result.totals.baseBonus,adjustmentTotal:result.totals.adjustment,finalBonusTotal:result.totals.finalBonus,
      anomalyCount:anomalies.length,anomalies:anomalies.slice(0,100),requiresRecalculation:false,
      calculatedAt,calculatedByUid:uid(),calculatedBy:username(),lockRevision:Number(current.metadata?.lockRevision)||0,
      updatedAt:calculatedAt,updatedByUid:uid(),updatedBy:username(),schemaVersion:SCHEMA_VERSION
    };
    const employees=result.employees.map(item=>publicEmployeeData(normalized,item,calculationId,calculatedAt,adjustments.notes.get(item.employeeId)||''));
    // 先把月份標成需要重算，再分批寫員工；最後才切成完成狀態，避免大量員工同批超過安全規則上限。
    const stagingBatch=window._writeBatch({skipDataVersions:true});
    stagingBatch.set(monthRef(normalized),{...metadata,requiresRecalculation:true});
    await stagingBatch.commit();
    for(let index=0;index<employees.length;index+=EMPLOYEE_WRITE_CHUNK_SIZE){
      const employeeBatch=window._writeBatch({skipDataVersions:true});
      employees.slice(index,index+EMPLOYEE_WRITE_CHUNK_SIZE).forEach(item=>employeeBatch.set(employeeRef(normalized,item.employeeId),item));
      await employeeBatch.commit();
    }
    let privateMonth=null;
    if(includePrivate){
      privateMonth={
        month:normalized,calculationId,settingsVersion:Number(table.version)||0,settingsSnapshot:{...settings,revision:Number(table.version)||0},
        grossExtra:result.totals.grossExtra,efficiencyLoss:result.totals.efficiencyLoss,employeeDays:result.totals.employeeDays,
        calculatedAt,calculatedByUid:uid(),calculatedBy:username(),schemaVersion:SCHEMA_VERSION
      };
      const privateBatch=window._writeBatch({skipDataVersions:true});
      privateBatch.set(privateMonthRef(normalized),privateMonth);
      await privateBatch.commit();
    }
    const finalBatch=window._writeBatch({skipDataVersions:true});
    finalBatch.set(monthRef(normalized),metadata);
    finalBatch.set(window._newDocRef(LOG_COLLECTION),logData('performanceBonusCalculate',employees.length,result.totals.employeeDays,
      `${normalized} · ${includePrivate?'settings':'month-open'}`,[],{privateCalculation:includePrivate}));
    await finalBatch.commit();
    await window.firebaseTouchDataVersions?.(['performanceBonusMonths',...(includePrivate?['performanceBonusPrivateMonths']:[])]);
    window.PCMSFeatures?.invalidateDataScopes?.(['performanceBonusMonths',...(includePrivate?['performanceBonusPrivateMonths']:[])]);
    return {metadata,employees,allEmployees:employees,privateMonth};
  }

  async function refreshLockedPrivateMonth(month,current,privateMonth,settingsInput){
    const metadata=current.metadata;
    if(!metadata||!LOCKED_STATUSES.has(metadata.status)) return privateMonth;
    if(privateMonth?.calculationId===metadata.calculationId) return privateMonth;
    let settings=null;
    if(Number(privateMonth?.settingsSnapshot?.revision)===Number(metadata.settingsVersion)) settings=normalizeSettings(privateMonth.settingsSnapshot);
    else{
      const loadedSettings=settingsInput||await loadSettings({force:true});
      const currentSettings=normalizeSettings(loadedSettings);
      const revision=Number(loadedSettings?.revision||0);
      if(revision!==Number(metadata.settingsVersion)){
        throw new Error('Không còn bản tham số riêng của tháng đã khóa nên chưa thể khôi phục lãi lỗ công ty. / 已鎖定月份缺少當時的私密參數，暫時無法重建公司損益。');
      }
      settings=currentSettings;
    }
    const stable=await loadStablePerformance(month);
    if(stable.source.entries!==String(metadata.sourceEntriesVersion||'0')||stable.source.attendance!==String(metadata.sourceAttendanceVersion||'0')){
      throw new Error('Dữ liệu nguồn của tháng khóa không khớp. / 鎖定月份的來源版本不一致。');
    }
    const adjustments=adjustmentMaps(current.allEmployees);
    const result=calculations().calculateMonth(stable.rows,settings,adjustments.amounts);
    const calculatedAt=now();
    const saved={
      month,calculationId:metadata.calculationId,settingsVersion:Number(metadata.settingsVersion),
      settingsSnapshot:{...settings,revision:Number(metadata.settingsVersion)},grossExtra:result.totals.grossExtra,
      efficiencyLoss:result.totals.efficiencyLoss,employeeDays:result.totals.employeeDays,
      calculatedAt,calculatedByUid:uid(),calculatedBy:username(),schemaVersion:SCHEMA_VERSION
    };
    const batch=window._writeBatch({skipDataVersions:true});
    batch.set(privateMonthRef(month),saved);
    batch.set(window._newDocRef(LOG_COLLECTION),logData('performanceBonusCalculate',current.employees.length,result.totals.employeeDays,
      `${month} · private-refresh`,[],{privateCalculation:true}));
    await batch.commit();
    await window.firebaseTouchDataVersions?.(['performanceBonusPrivateMonths']);
    return saved;
  }

  async function loadMonth(month,options={}){
    const normalized=requireMonth(month);
    let current=await readStoredMonth(normalized);
    let privateMonth=null;
    if(current.metadata&&LOCKED_STATUSES.has(current.metadata.status)){
      if(options.includePrivate===true){
        privateMonth=await loadPrivateMonth(normalized,{force:true});
        privateMonth=await refreshLockedPrivateMonth(normalized,current,privateMonth,options.settings);
      }
      return {...current,privateMonth};
    }
    const table=options.table||await loadReferenceTable({force:true});
    const source=await readSourceVersions(normalized);
    const privateCurrent=options.includePrivate===true?await loadPrivateMonth(normalized,{force:true}):null;
    const needsCalculation=options.forceRecalculate===true||!monthIsCurrent(current.metadata,source,table)
      ||(options.includePrivate===true&&privateCurrent?.calculationId!==current.metadata?.calculationId);
    if(needsCalculation&&options.recalculate!==false){
      current=await calculateAndPersistMonth(normalized,{...options,current,table});
      privateMonth=current.privateMonth||null;
    }else privateMonth=privateCurrent;
    return {...current,privateMonth};
  }

  async function discoverDraftMonths(){
    const [draftSnapshot,sourceSnapshot]=await Promise.all([
      window._getDocs(window._query(window._collection(MONTH_COLLECTION),window._where('status','==','draft'))),
      window._getDocs(window._collection(MONTH_SOURCE_VERSION_COLLECTION))
    ]);
    const candidates=new Set([currentMonth(),...draftSnapshot.docs.map(item=>item.id),...sourceSnapshot.docs.map(item=>item.id).filter(validMonth)]);
    const snapshots=await Promise.all([...candidates].map(month=>window._getDoc(monthRef(month))));
    return [...candidates].filter((month,index)=>!snapshots[index].exists()||snapshots[index].data().status==='draft').sort();
  }
  async function saveSettings(input){
    const normalized=normalizeSettings(input);
    const reference=settingsRef();
    const logReference=window._newDocRef(LOG_COLLECTION);
    let saved;
    let table;
    let settingsLog;
    await window._runTransaction(async transaction=>{
      const previousSnapshot=await transaction.get(reference);
      const previous=previousSnapshot.exists()?previousSnapshot.data():null;
      const revision=(Number(previous?.revision)||0)+1;
      const updatedAt=now();
      saved={...normalized,revision,updatedAt,updatedByUid:uid(),updatedBy:username(),schemaVersion:SCHEMA_VERSION};
      table=publicTableData(saved,updatedAt);
      transaction.set(reference,saved);
      transaction.set(tableRef(),table);
      settingsLog=logData('performanceBonusSettingsUpdate',1,3,`revision ${revision}`,['unitPrice','companyShare','efficiencyCap'].map(field=>({field,before:previous?.[field]??null,after:saved[field]})));
    },{skipDataVersions:true});
    await window._setDoc(logReference,settingsLog);
    await window.firebaseTouchDataVersions?.(['performanceBonusSettings','performanceBonusTables']);
    const months=await discoverDraftMonths();
    const failures=[];
    for(const month of months){
      try{ await calculateAndPersistMonth(month,{includePrivate:true,settings:saved,table}); }
      catch(error){ failures.push({month,error:String(error?.message||error)}); }
    }
    window.PCMSFeatures?.invalidateDataScopes?.(['performanceBonusSettings','performanceBonusTables','performanceBonusMonths','performanceBonusPrivateMonths']);
    if(failures.length){
      const details=failures.slice(0,10).map(item=>`${item.month}: ${item.error}`).join('\n');
      const error=new Error(`Đã lưu tham số nhưng ${failures.length} tháng chưa tính lại xong.\n${details} / 參數已儲存，但有 ${failures.length} 個月份尚未完成重算。\n${details}`);
      error.settingsSaved=true;
      throw error;
    }
    return {...saved,recalculatedMonths:months};
  }

  async function adjustEmployee(month,employeeId,amount,note=''){
    const normalized=requireMonth(month);
    const parent=monthRef(normalized);
    const employee=employeeRef(normalized,employeeId);
    const logReference=window._newDocRef(LOG_COLLECTION);
    let adjustmentLog;
    await window._runTransaction(async transaction=>{
      const [parentSnapshot,employeeSnapshot]=await Promise.all([transaction.get(parent),transaction.get(employee)]);
      if(!parentSnapshot.exists()||!employeeSnapshot.exists()) throw new Error('Không tìm thấy dữ liệu thưởng. / 找不到獎金資料。');
      const metadata=parentSnapshot.data();
      const current=employeeSnapshot.data();
      if(metadata.status!=='draft') throw new Error('Tháng đã khóa, không thể điều chỉnh. / 月份已鎖定，不能調整。');
      const requested=Math.round(Number(amount)||0);
      const adjustment=Math.max(-Number(current.baseBonus||0),requested);
      const finalBonus=Math.max(0,Math.round(Number(current.baseBonus||0)+adjustment));
      const adjustmentDelta=adjustment-Number(current.adjustmentAmount||0);
      const finalDelta=finalBonus-Number(current.finalBonus||0);
      const eligibleDelta=(finalBonus>0?1:0)-(Number(current.finalBonus||0)>0?1:0);
      const updatedAt=now();
      transaction.update(employee,{adjustmentAmount:adjustment,adjustmentNote:String(note||'').slice(0,200),finalBonus,updatedAt,updatedByUid:uid(),updatedBy:username()});
      transaction.update(parent,{adjustmentTotal:Math.round(Number(metadata.adjustmentTotal||0)+adjustmentDelta),
        finalBonusTotal:Math.round(Number(metadata.finalBonusTotal||0)+finalDelta),
        eligibleEmployeeCount:Math.max(0,Math.round(Number(metadata.eligibleEmployeeCount||0)+eligibleDelta)),
        updatedAt,updatedByUid:uid(),updatedBy:username()});
      adjustmentLog=logData('performanceBonusAdjustment',1,1,`${normalized} · ${employeeId}`,[{field:'adjustmentAmount',before:Number(current.adjustmentAmount)||0,after:adjustment}]);
    },{skipDataVersions:true});
    await window._setDoc(logReference,adjustmentLog);
    await window.firebaseTouchDataVersions?.(['performanceBonusMonths']);
    return loadMonth(normalized,{force:true});
  }
  async function changeMonthStatus(month,action,allowedStatuses,nextStatus,extra={},logExtra={}){
    const normalized=requireMonth(month);
    const reference=monthRef(normalized);
    const logReference=window._newDocRef(LOG_COLLECTION);
    let saved;
    let statusLog;
    await window._runTransaction(async transaction=>{
      const snapshot=await transaction.get(reference);
      if(!snapshot.exists()) throw new Error('Chưa có dữ liệu thưởng của tháng. / 尚無該月份獎金資料。');
      const current=snapshot.data();
      if(!allowedStatuses.includes(current.status)) throw new Error('Trạng thái tháng không cho phép thao tác. / 月份狀態不允許此操作。');
      const updatedAt=now();
      saved={...current,status:nextStatus,...extra,updatedAt,updatedByUid:uid(),updatedBy:username()};
      transaction.set(reference,saved);
      statusLog=logData(action,Number(current.employeeCount)||0,Number(current.eligibleEmployeeCount)||0,normalized,
        [{field:'status',before:current.status,after:nextStatus}],logExtra);
    },{skipDataVersions:true});
    await window._setDoc(logReference,statusLog);
    await window.firebaseTouchDataVersions?.(['performanceBonusMonths']);
    return saved;
  }
  function anomalyMessage(metadata){
    const rows=(Array.isArray(metadata?.anomalies)?metadata.anomalies:[]).slice(0,20);
    const details=rows.map(item=>`${item.date} · ${item.employeeId} · ${item.employeeName}`).join('\n');
    return `Có ${Number(metadata?.anomalyCount)||0} trường hợp chấm công hoặc giờ bổ sung không hợp lệ.\n${details} / 有 ${Number(metadata?.anomalyCount)||0} 筆考勤或補充工時異常。\n${details}`;
  }
  function assertCurrentForLock(metadata,source,table){
    if(!metadata||metadata.status!=='draft') throw new Error('Tháng không ở trạng thái đang tính thử. / 月份不是試算中狀態。');
    if(Number(metadata.anomalyCount)>0) throw new Error(anomalyMessage(metadata));
    if(!monthIsCurrent(metadata,source,table)) throw new Error('Dữ liệu vừa thay đổi, vui lòng thử khóa lại. / 資料剛有變動，請重新執行鎖定。');
  }
  async function assertMonthReadyForLock(month){
    const normalized=requireMonth(month);
    const current=await loadMonth(normalized,{forceRecalculate:true,includePrivate:false});
    const [source,table]=await Promise.all([readSourceVersions(normalized),loadReferenceTable({force:true})]);
    assertCurrentForLock(current.metadata,source,table);
    return current;
  }
  function assertMonthReadyForFinalization(metadata,source){
    if(!metadata||!Object.prototype.hasOwnProperty.call(metadata,'anomalyCount')||metadata.requiresRecalculation===true) throw new Error('Tháng khóa cũ chưa qua kiểm tra mới. Hãy mở khóa rồi tính lại. / 舊鎖定月份尚未通過新版檢查，請先解鎖並重新試算。');
    if(Number(metadata.anomalyCount)>0) throw new Error(anomalyMessage(metadata));
    if(String(metadata.sourceEntriesVersion||'0')!==source.entries||String(metadata.sourceAttendanceVersion||'0')!==source.attendance) throw new Error('Dữ liệu nguồn của tháng khóa không khớp kết quả thưởng. / 鎖定月份的來源資料與獎金結果不一致。');
  }
  async function lockMonth(month){
    const timestamp=now();
    const current=await assertMonthReadyForLock(month);
    return changeMonthStatus(month,'performanceBonusLock',['draft'],'locked',{lockedAt:timestamp,lockedByUid:uid(),lockedBy:username(),lockRevision:(Number(current.metadata?.lockRevision)||0)+1});
  }
  async function markExported(month,fileName){
    const normalized=requireMonth(month);
    const [current,source]=await Promise.all([loadMonth(normalized,{recalculate:false}),readSourceVersions(normalized)]);
    assertMonthReadyForFinalization(current.metadata,source);
    const status=current.metadata?.status==='paid'?'paid':'exported';
    const normalizedFileName=String(fileName||'').slice(0,300);
    return changeMonthStatus(normalized,'performanceBonusExport',['locked','exported','paid'],status,{lastExportedAt:now(),lastExportedByUid:uid(),lastExportedBy:username(),exportCount:(Number(current.metadata?.exportCount)||0)+1,lastExportFileName:normalizedFileName},{fileName:normalizedFileName});
  }
  async function markPaid(month){
    const normalized=requireMonth(month);
    const [current,source]=await Promise.all([loadMonth(normalized,{recalculate:false}),readSourceVersions(normalized)]);
    assertMonthReadyForFinalization(current.metadata,source);
    return changeMonthStatus(normalized,'performanceBonusPaid',['exported'],'paid',{paidAt:now(),paidByUid:uid(),paidBy:username()});
  }
  async function unlockMonth(month){
    return changeMonthStatus(month,'performanceBonusUnlock',['locked','exported','paid'],'draft',{unlockedAt:now(),unlockedByUid:uid(),unlockedBy:username(),requiresRecalculation:true});
  }
  function canUnlock(){
    if(window.isAdm?.()) return true;
    const role=window.cu?.role;
    return window.permissionSettings?.[role]?.performanceBonusUnlock===true;
  }

  window.PCMSPerformanceBonusStore=Object.freeze({
    currentMonth,validMonth,monthRange,loadSettings,saveSettings,loadReferenceTable,loadMonth,loadPrivateMonth,
    adjustEmployee,assertMonthReadyForLock,lockMonth,markExported,markPaid,unlockMonth,canUnlock
  });
})();
