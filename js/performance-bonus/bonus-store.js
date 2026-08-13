// bonus-store（績效獎金資料）：管理保密參數、發布結果、整月狀態與操作紀錄。
(function(){
  'use strict';

  const SETTINGS_PATH=['system','performanceBonusSettings'];
  const TABLE_COLLECTION='performanceBonusTables';
  const MONTH_COLLECTION='performanceBonusMonths';
  const PRIVATE_MONTH_COLLECTION='performanceBonusPrivateMonths';
  const LOG_COLLECTION='operationLogs';
  const SCHEMA_VERSION=1;

  function calc(){ return window.PCMSPerformanceBonusCalculations; }
  function uid(){ return String(window.firebaseAuthUser?.uid||window.cu?.authUid||window.cu?.uid||'').trim(); }
  function username(){ return String(window.cu?.username||window.cu?.displayName||window.cu?.email||'unknown').slice(0,200); }
  function now(){ return Date.now(); }
  function currentMonth(){
    const today=typeof window.formatLocalDate==='function'
      ?window.formatLocalDate(new Date())
      :new Date().toISOString().slice(0,10);
    return today.slice(0,7);
  }
  function validMonth(value){ return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value||'')); }
  function requireMonth(value){
    const month=String(value||'');
    if(!validMonth(month)) throw new Error('Tháng không hợp lệ. / 月份不正確。');
    return month;
  }
  function monthRange(value){
    const month=requireMonth(value);
    const [year,number]=month.split('-').map(Number);
    const from=`${month}-01`;
    const last=new Date(year,number,0);
    const end=`${year}-${String(number).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`;
    const today=typeof window.formatLocalDate==='function'
      ?window.formatLocalDate(new Date())
      :new Date().toISOString().slice(0,10);
    return {from,to:month===today.slice(0,7)&&end>today?today:end};
  }
  function settingsRef(){ return window._docRef(...SETTINGS_PATH); }
  function tableRef(){ return window._docRef(TABLE_COLLECTION,'current'); }
  function monthRef(month){ return window._docRef(MONTH_COLLECTION,requireMonth(month)); }
  function privateMonthRef(month){ return window._docRef(PRIVATE_MONTH_COLLECTION,requireMonth(month)); }
  function employeeCollection(month){ return `${MONTH_COLLECTION}/${requireMonth(month)}/employees`; }
  function employeeRef(month,employeeId){ return window._docRef(employeeCollection(month),String(employeeId||'').trim()); }
  function versionToken(){ return `${now()}-${uid().slice(0,12)}`; }
  async function versions(scopes,force=false){
    return window.firebaseReadDataVersions?window.firebaseReadDataVersions(scopes,force):{data:{}};
  }
  function snapshotData(snapshot){ return snapshot?.exists?.()?{id:snapshot.id,...snapshot.data()}:null; }
  function logData(action,itemCount=0,detailCount=0,note='',changes=[],extra={}){
    return {
      permissionKey:action==='performanceBonusSettingsUpdate'||action==='performanceBonusCalculate'
        ?'performanceBonusSettings':'performanceBonus',
      feature:action==='performanceBonusSettingsUpdate'||action==='performanceBonusCalculate'
        ?'performanceBonusSettings':'performanceBonus',
      action,status:'success',createdAt:now(),createdByUid:uid(),createdBy:username(),
      itemCount:Math.max(0,Math.round(Number(itemCount)||0)),
      detailCount:Math.max(0,Math.round(Number(detailCount)||0)),
      note:String(note||'').slice(0,500),
      changes:(Array.isArray(changes)?changes:[]).slice(0,50),
      ...extra
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

  async function loadSettings(options={}){
    return cachedRead('performanceBonusSettings','performanceBonusSettings',async()=>{
      const snapshot=await window._getDoc(settingsRef());
      const saved=snapshotData(snapshot);
      const normalized=calc().normalizeSettings(saved||calc().DEFAULT_SETTINGS);
      return {...normalized,revision:Number(saved?.revision)||0,updatedAt:Number(saved?.updatedAt)||0};
    },options);
  }
  async function saveSettings(input){
    const normalized=calc().normalizeSettings(input);
    const reference=settingsRef();
    const lookupReference=tableRef();
    const logReference=window._newDocRef(LOG_COLLECTION);
    let saved;
    await window._runTransaction(async transaction=>{
      const previousSnapshot=await transaction.get(reference);
      const previous=previousSnapshot.exists()?previousSnapshot.data():null;
      const revision=(Number(previous?.revision)||0)+1;
      const updatedAt=now();
      saved={...normalized,revision,updatedAt,updatedByUid:uid(),updatedBy:username(),schemaVersion:SCHEMA_VERSION};
      transaction.set(reference,saved);
      transaction.set(lookupReference,{
        version:revision,baseEfficiency:calc().BASE_EFFICIENCY,efficiencyCap:normalized.efficiencyCap,
        rows:calc().referenceRows(normalized),updatedAt,schemaVersion:SCHEMA_VERSION
      });
      transaction.set(logReference,logData('performanceBonusSettingsUpdate',1,3,`revision ${revision}`,['unitPrice','companyShare','efficiencyCap'].map(field=>({
        field,before:previous?.[field]??null,after:saved[field]
      }))));
    });
    window.PCMSFeatures?.invalidateDataScopes?.(['performanceBonusSettings','performanceBonusTables','performanceBonusMonths']);
    return saved;
  }
  async function loadReferenceTable(options={}){
    return cachedRead('performanceBonusTable','performanceBonusTables',async()=>{
      const snapshot=await window._getDoc(tableRef());
      return snapshotData(snapshot);
    },options);
  }
  async function readEmployeeDocuments(month){
    const snapshot=await window._getDocs(window._query(window._collection(employeeCollection(month))));
    return snapshot.docs.map(item=>({id:item.id,...item.data()}));
  }
  async function loadMonth(month,options={}){
    const normalized=requireMonth(month);
    return cachedRead(`performanceBonusMonth:${normalized}`,'performanceBonusMonths',async()=>{
      const [metadataSnapshot,employees]=await Promise.all([
        window._getDoc(monthRef(normalized)),readEmployeeDocuments(normalized)
      ]);
      const metadata=snapshotData(metadataSnapshot);
      const calculationId=String(metadata?.calculationId||'');
      return {
        metadata,
        employees:calculationId?employees.filter(item=>item.calculationId===calculationId):[]
      };
    },options);
  }
  async function loadPrivateMonth(month,options={}){
    const normalized=requireMonth(month);
    return cachedRead(`performanceBonusPrivateMonth:${normalized}`,'performanceBonusPrivateMonths',async()=>{
      const snapshot=await window._getDoc(privateMonthRef(normalized));
      return snapshotData(snapshot);
    },options);
  }
  async function calculateAndPublishMonth(month){
    const normalized=requireMonth(month);
    const [settings,current,rows]=await Promise.all([
      loadSettings({force:true}),
      loadMonth(normalized,{force:true}),
      (async()=>{ const range=monthRange(normalized); return window.PCMSProductionPerformance.loadPerformanceRange(range.from,range.to); })()
    ]);
    if(current.metadata&&current.metadata.status!=='draft'){
      throw new Error('Tháng đã khóa, cần mở khóa trước khi tính lại. / 月份已鎖定，必須先解鎖才能重新計算。');
    }
    const adjustments=new Map(current.employees.map(item=>[item.employeeId,Number(item.adjustmentAmount)||0]));
    const notes=new Map(current.employees.map(item=>[item.employeeId,String(item.adjustmentNote||'')]));
    const result=calc().calculateMonth(rows,settings,adjustments);
    const calculationId=versionToken();
    const calculatedAt=now();
    const nextIds=new Set(result.employees.map(item=>item.employeeId));
    const operations=[];
    current.employees.forEach(item=>{ if(!nextIds.has(item.employeeId)) operations.push({type:'delete',reference:employeeRef(normalized,item.employeeId)}); });
    result.employees.forEach(item=>operations.push({type:'set',reference:employeeRef(normalized,item.employeeId),data:{
      month:normalized,employeeId:item.employeeId,employeeName:item.employeeName,department:item.department,
      days:item.days.map(day=>({date:day.date,attendanceHours:day.attendanceHours,actualEfficiency:day.actualEfficiency,rewardEfficiency:day.rewardEfficiency,bonus:day.bonus})),
      qualifyingDays:item.qualifyingDays,calculatedHours:item.calculatedHours,
      baseBonus:item.baseBonus,adjustmentAmount:item.adjustmentAmount,
      adjustmentNote:notes.get(item.employeeId)||'',finalBonus:item.finalBonus,
      calculationId,calculatedAt,updatedAt:calculatedAt,updatedByUid:uid(),updatedBy:username(),schemaVersion:SCHEMA_VERSION
    }}));
    // 同一次結算全部成功或全部失敗，避免分批覆蓋後主月份尚未更新。
    if(operations.length>446){
      throw new Error('Số nhân viên thay đổi vượt quá giới hạn an toàn 446 bản ghi. Vui lòng liên hệ quản trị viên. / 員工變更超過安全上限446筆，請聯絡管理員。');
    }
    const versionState=await versions(['productionEntries','productionAttendance'],true);
    const finalBatch=window._writeBatch();
    operations.forEach(operation=>{
      if(operation.type==='delete') finalBatch.delete(operation.reference);
      else finalBatch.set(operation.reference,operation.data);
    });
    finalBatch.set(monthRef(normalized),{
      month:normalized,status:'draft',calculationId,settingsVersion:Number(settings.revision)||0,
      sourceEntriesVersion:String(versionState?.data?.productionEntries||'0'),
      sourceAttendanceVersion:String(versionState?.data?.productionAttendance||'0'),
      employeeCount:result.employees.length,
      eligibleEmployeeCount:result.employees.filter(item=>item.finalBonus>0).length,
      baseBonusTotal:result.totals.baseBonus,adjustmentTotal:result.totals.adjustment,
      finalBonusTotal:result.totals.finalBonus,calculatedAt,calculatedByUid:uid(),calculatedBy:username(),
      lockRevision:Number(current.metadata?.lockRevision)||0,schemaVersion:SCHEMA_VERSION
    });
    finalBatch.set(privateMonthRef(normalized),{
      month:normalized,calculationId,
      settingsSnapshot:{unitPrice:settings.unitPrice,companyShare:settings.companyShare,employeeShare:settings.employeeShare,efficiencyCap:settings.efficiencyCap,baseEfficiency:80,minAttendanceHours:8,revision:settings.revision},
      grossExtra:result.totals.grossExtra,efficiencyLoss:result.totals.efficiencyLoss,
      employeeDays:result.totals.employeeDays,calculatedAt,calculatedByUid:uid(),schemaVersion:SCHEMA_VERSION
    });
    finalBatch.set(window._newDocRef(LOG_COLLECTION),logData('performanceBonusCalculate',result.employees.length,result.totals.employeeDays,normalized));
    await finalBatch.commit();
    window.PCMSFeatures?.invalidateDataScopes?.(['performanceBonusMonths','performanceBonusPrivateMonths']);
    return loadMonth(normalized,{force:true});
  }
  async function adjustEmployee(month,employeeId,amount,note=''){
    const normalized=requireMonth(month);
    const parent=monthRef(normalized);
    const employee=employeeRef(normalized,employeeId);
    const logReference=window._newDocRef(LOG_COLLECTION);
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
      transaction.update(parent,{
        adjustmentTotal:Math.round(Number(metadata.adjustmentTotal||0)+adjustmentDelta),
        finalBonusTotal:Math.round(Number(metadata.finalBonusTotal||0)+finalDelta),
        eligibleEmployeeCount:Math.max(0,Math.round(Number(metadata.eligibleEmployeeCount||0)+eligibleDelta)),
        updatedAt,updatedByUid:uid(),updatedBy:username()
      });
      transaction.set(logReference,logData('performanceBonusAdjustment',1,1,`${normalized} · ${employeeId}`,[{field:'adjustmentAmount',before:Number(current.adjustmentAmount)||0,after:adjustment}]));
    });
    window.PCMSFeatures?.invalidateDataScopes?.(['performanceBonusMonths']);
    return loadMonth(normalized,{force:true});
  }
  async function changeMonthStatus(month,action,allowedStatuses,nextStatus,extra={},logExtra={}){
    const normalized=requireMonth(month);
    const reference=monthRef(normalized);
    const logReference=window._newDocRef(LOG_COLLECTION);
    let saved;
    await window._runTransaction(async transaction=>{
      const snapshot=await transaction.get(reference);
      if(!snapshot.exists()) throw new Error('Chưa có dữ liệu thưởng của tháng. / 尚無該月份獎金資料。');
      const current=snapshot.data();
      if(!allowedStatuses.includes(current.status)) throw new Error('Trạng thái tháng không cho phép thao tác. / 月份狀態不允許此操作。');
      const updatedAt=now();
      saved={...current,status:nextStatus,...extra,updatedAt,updatedByUid:uid(),updatedBy:username()};
      transaction.set(reference,saved);
      transaction.set(logReference,logData(
        action,
        Number(current.employeeCount)||0,
        Number(current.eligibleEmployeeCount)||0,
        normalized,
        [{field:'status',before:current.status,after:nextStatus}],
        logExtra
      ));
    });
    window.PCMSFeatures?.invalidateDataScopes?.(['performanceBonusMonths']);
    return saved;
  }
  async function lockMonth(month){
    const timestamp=now();
    const current=await loadMonth(month,{force:true});
    return changeMonthStatus(month,'performanceBonusLock',['draft'],'locked',{
      lockedAt:timestamp,lockedByUid:uid(),lockedBy:username(),lockRevision:(Number(current.metadata?.lockRevision)||0)+1
    });
  }
  async function markExported(month,fileName){
    const current=await loadMonth(month,{force:true});
    const status=current.metadata?.status==='paid'?'paid':'exported';
    const normalizedFileName=String(fileName||'').slice(0,300);
    return changeMonthStatus(month,'performanceBonusExport',['locked','exported','paid'],status,{
      lastExportedAt:now(),lastExportedByUid:uid(),lastExportedBy:username(),
      exportCount:(Number(current.metadata?.exportCount)||0)+1,lastExportFileName:normalizedFileName
    },{fileName:normalizedFileName});
  }
  async function markPaid(month){
    return changeMonthStatus(month,'performanceBonusPaid',['exported'],'paid',{paidAt:now(),paidByUid:uid(),paidBy:username()});
  }
  async function unlockMonth(month){
    return changeMonthStatus(month,'performanceBonusUnlock',['locked','exported','paid'],'draft',{
      unlockedAt:now(),unlockedByUid:uid(),unlockedBy:username(),requiresRecalculation:true
    });
  }
  function canUnlock(){
    if(window.isAdm?.()) return true;
    const role=window.cu?.role;
    return window.permissionSettings?.[role]?.performanceBonusUnlock===true;
  }

  window.PCMSPerformanceBonusStore=Object.freeze({
    currentMonth,validMonth,monthRange,loadSettings,saveSettings,loadReferenceTable,
    loadMonth,loadPrivateMonth,calculateAndPublishMonth,adjustEmployee,
    lockMonth,markExported,markPaid,unlockMonth,canUnlock
  });
})();
