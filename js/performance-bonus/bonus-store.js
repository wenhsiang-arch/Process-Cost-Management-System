// bonus-store（績效獎金資料）：未鎖月份由員工月摘要即時計算；只有鎖定時保存凍結結果。
(function(){
  'use strict';

  const SETTINGS_PATH=['system','performanceBonusSettings'];
  const TABLE_COLLECTION='performanceBonusTables';
  const SETTINGS_VERSION_COLLECTION='performanceBonusSettingVersions';
  const MONTH_COLLECTION='performanceBonusMonths';
  const PRIVATE_MONTH_COLLECTION='performanceBonusPrivateMonths';
  const ADJUSTMENT_COLLECTION='performanceBonusAdjustments';
  const PRODUCTION_MONTH_COLLECTION='productionMonths';
  const LOG_COLLECTION='operationLogs';
  const LOCKED_STATUSES=new Set(['locked','exported','paid']);
  const SCHEMA_VERSION=2;
  const DEFAULT_SETTINGS=Object.freeze({unitPrice:400,companyShare:50,employeeShare:50,efficiencyCap:120,baseEfficiency:80,minAttendanceHours:8});
  const directMemory=new Map(); // directMemory（設定頁工作階段記憶）：不寫入持久快取。
  const directPromises=new Map(); // directPromises（同一份設定的進行中讀取）。
  let directMemoryUid='';

  function calculations(){
    if(!window.PCMSPerformanceBonusCalculations) throw new Error('Bộ tính thưởng chưa sẵn sàng. / 獎金計算程式尚未載入。');
    return window.PCMSPerformanceBonusCalculations;
  }
  function normalizeSettings(input={}){ return calculations().normalizeSettings(input); }
  function uid(){ return String(window.firebaseAuthUser?.uid||window.cu?.authUid||window.cu?.uid||'').trim(); }
  function username(){ return String(window.cu?.user||window.cu?.username||window.cu?.displayName||window.cu?.email||uid()||'unknown').slice(0,200); }
  function now(){ return Date.now(); }
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
  function settingsVersionRef(revision){ return window._docRef(SETTINGS_VERSION_COLLECTION,String(Math.max(1,Math.round(Number(revision)||1)))); }
  function monthRef(month){ return window._docRef(MONTH_COLLECTION,requireMonth(month)); }
  function privateMonthRef(month){ return window._docRef(PRIVATE_MONTH_COLLECTION,requireMonth(month)); }
  function productionMonthRef(month){ return window._docRef(PRODUCTION_MONTH_COLLECTION,requireMonth(month)); }
  function adjustmentId(month,employeeId){ return `${requireMonth(month)}__${String(employeeId||'').trim()}`; }
  function adjustmentRef(month,employeeId){ return window._docRef(ADJUSTMENT_COLLECTION,adjustmentId(month,employeeId)); }
  function legacyEmployeeCollection(month){ return `${MONTH_COLLECTION}/${requireMonth(month)}/employees`; }
  function snapshotData(snapshot){ return snapshot?.exists?.()?{id:snapshot.id,...snapshot.data()}:null; }
  function logData(action,itemCount=0,detailCount=0,note='',changes=[],extra={}){
    const settingsAction=action==='performanceBonusSettingsUpdate'||extra.privateCalculation===true;
    return {
      permissionKey:settingsAction?'performanceBonusSettings':'performanceBonus',
      feature:settingsAction?'performanceBonusSettings':'performanceBonus',action,status:'success',createdAt:now(),
      createdByUid:uid(),createdBy:username(),itemCount:Math.max(0,Math.round(Number(itemCount)||0)),
      detailCount:Math.max(0,Math.round(Number(detailCount)||0)),note:String(note||'').slice(0,500),
      changes:(Array.isArray(changes)?changes:[]).slice(0,50),...(extra.fileName?{fileName:String(extra.fileName).slice(0,300)}:{})
    };
  }
  function cloneValue(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function ensureDirectMemoryIdentity(){
    const currentUid=uid();
    if(currentUid===directMemoryUid) return;
    directMemoryUid=currentUid;
    directMemory.clear();
    directPromises.clear();
  }
  async function directRead(key,loader,options={}){
    ensureDirectMemoryIdentity();
    if(options.force!==true&&directMemory.has(key)) return cloneValue(directMemory.get(key));
    if(directPromises.has(key)) return cloneValue(await directPromises.get(key));
    const promise=Promise.resolve().then(loader).then(value=>{
      directMemory.set(key,cloneValue(value));
      return value;
    }).finally(()=>directPromises.delete(key));
    directPromises.set(key,promise);
    return cloneValue(await promise);
  }
  function publicTableData(settings,updatedAt=now()){
    const normalized=normalizeSettings(settings);
    return {
      version:Math.max(1,Math.round(Number(settings.revision)||1)),baseEfficiency:80,minAttendanceHours:8,
      efficiencyCap:normalized.efficiencyCap,employeePointHourAmount:Number((normalized.unitPrice*(normalized.employeeShare/100)).toFixed(6)),
      rows:calculations().referenceRows(normalized),updatedAt,updatedByUid:uid(),updatedBy:username(),schemaVersion:1
    };
  }
  async function loadSettings(options={}){
    return directRead('performanceBonusSettings',async()=>{
      const saved=snapshotData(await window._getDoc(settingsRef()));
      const normalized=normalizeSettings(saved||DEFAULT_SETTINGS);
      return {...normalized,revision:Number(saved?.revision)||0,updatedAt:Number(saved?.updatedAt)||0};
    },options);
  }
  async function loadSettingsVersion(revision){
    const saved=snapshotData(await window._getDoc(settingsVersionRef(revision)));
    if(saved) return {...normalizeSettings(saved),revision:Number(saved.revision)||Number(revision)};
    const current=await loadSettings({force:true});
    if(Number(current.revision)!==Number(revision)) throw new Error('Không tìm thấy tham số của tháng đã khóa. / 找不到已鎖定月份當時的獎金參數。');
    return current;
  }
  async function loadReferenceTable(options={}){
    return directRead('performanceBonusTable',async()=>snapshotData(await window._getDoc(tableRef())),options);
  }
  async function readControl(month){ return snapshotData(await window._getDoc(productionMonthRef(month))); }
  function normalizedObject(data){
    return data&&typeof data==='object'?data:{};
  }
  function sourceState(data){
    const value=normalizedObject(data);
    return {entries:String(value.entriesVersion||'0'),attendance:String(value.attendanceVersion||'0'),summary:String(value.summaryVersion||'0')};
  }
  function stableStateToken(data){
    const value=normalizedObject(data);
    const source=sourceState(value);
    return `${source.entries}|${source.attendance}|${source.summary}|${Number(value.revision)||0}|${String(value.status||'')}|${value.summaryReady===true}`;
  }
  async function readAdjustments(month){
    const snapshot=await window._getDocs(window._query(window._collection(ADJUSTMENT_COLLECTION),window._where('month','==',requireMonth(month))));
    return snapshot.docs.map(item=>({id:item.id,...item.data()}));
  }
  async function readMonthSummaries(month,summaryVersion){
    const summaryStore=window.PCMSProductionSummaries;
    if(!summaryStore?.loadEmployeeMonths){
      throw new Error('Bộ nhớ tóm tắt tháng chưa sẵn sàng. / 月摘要快取程式尚未載入。');
    }
    const rows=await summaryStore.loadEmployeeMonths(requireMonth(month),{version:String(summaryVersion||'0')});
    return rows.filter(item=>item.summaryComplete===true&&Number(item.schemaVersion)===Number(summaryStore.SCHEMA_VERSION));
  }
  function rowsFromSummaries(summaries){
    const rows=[];
    (summaries||[]).forEach(employee=>Object.values(employee.days||{}).forEach(day=>{
      if(Number(day.attendanceHours)<=0&&Number(day.activeEntryCount)<=0) return;
      rows.push({
        productionDate:String(day.productionDate||''),employeeId:String(employee.employeeId||''),
        employeeName:String(employee.employeeName||'—'),department:String(employee.department||'—'),
        workedHours:Number(day.attendanceHours)||0,standardHours:Number(day.standardHours)||0,
        supplementHours:Number(day.supplementHours)||0,percentage:day.efficiencyPercentage,
        status:String(day.calculationStatus||'ready'),attendanceStatus:''
      });
    }));
    return rows;
  }
  async function loadStablePerformance(month,maxAttempts=3){
    const normalized=requireMonth(month);
    for(let attempt=0;attempt<maxAttempts;attempt+=1){
      const control=await readControl(normalized);
      const beforeToken=stableStateToken(control);
      let rows;
      let summaryReady=control?.summaryReady===true;
      if(summaryReady) rows=rowsFromSummaries(await readMonthSummaries(normalized,control?.summaryVersion));
      else rows=[];
      const after=await readControl(normalized);
      if(beforeToken===stableStateToken(after)) return {rows,source:sourceState(after),control:after,summaryReady};
    }
    throw new Error('Dữ liệu sản lượng hoặc chấm công đang thay đổi. / 產能或考勤資料持續變動，請稍後再試。');
  }
  function anomalyRows(rows){
    return (rows||[]).filter(row=>String(row.status||'')!=='ready'||Number(row.supplementHours)>Number(row.workedHours)).map(row=>({
      date:String(row.productionDate||''),employeeId:String(row.employeeId||''),employeeName:String(row.employeeName||'—'),
      reason:String(row.status||'summary-error')
    }));
  }
  function adjustmentMaps(rows){
    return {
      amounts:new Map((rows||[]).map(item=>[String(item.employeeId||''),Number(item.adjustmentAmount)||0])),
      notes:new Map((rows||[]).map(item=>[String(item.employeeId||''),String(item.adjustmentNote||'')]))
    };
  }
  function publicEmployees(result,notes){
    return result.employees.map(item=>({
      employeeId:item.employeeId,employeeName:item.employeeName,department:item.department,
      days:item.days.map(day=>({date:day.date,attendanceHours:day.attendanceHours,actualEfficiency:day.actualEfficiency,rewardEfficiency:day.rewardEfficiency,bonus:day.bonus})),
      qualifyingDays:item.qualifyingDays,calculatedHours:item.calculatedHours,baseBonus:item.baseBonus,
      adjustmentAmount:item.adjustmentAmount,adjustmentNote:notes.get(item.employeeId)||'',finalBonus:item.finalBonus
    }));
  }
  function virtualMetadata(month,stable,table,result,anomalies){
    const calculatedAt=now();
    return {
      month,status:'draft',settingsVersion:Number(table.version)||0,sourceEntriesVersion:stable.source.entries,
      sourceAttendanceVersion:stable.source.attendance,sourceSummaryVersion:stable.source.summary,
      sourceControlAvailable:stable.control!==null,employeeCount:result.employees.length,
      eligibleEmployeeCount:result.employees.filter(item=>item.finalBonus>0).length,
      baseBonusTotal:result.totals.baseBonus,adjustmentTotal:result.totals.adjustment,finalBonusTotal:result.totals.finalBonus,
      anomalyCount:anomalies.length,anomalies:anomalies.slice(0,100),requiresRecalculation:false,
      calculatedAt,calculatedByUid:uid(),calculatedBy:username(),updatedAt:calculatedAt,
      updatedByUid:uid(),updatedBy:username(),summaryReady:stable.summaryReady===true,schemaVersion:SCHEMA_VERSION
    };
  }
  async function readStoredMonth(month){
    const metadata=snapshotData(await window._getDoc(monthRef(month)));
    if(!metadata||!LOCKED_STATUSES.has(metadata.status)) return {metadata:null,employees:[]};
    if(metadata.snapshotId){
      const service=window.PCMSPerformanceBonusLockService;
      if(!service?.readSnapshot) throw new Error('Bộ đọc ảnh chụp tháng chưa sẵn sàng. / 月份快照讀取程式尚未載入。');
      const payload=await service.readSnapshot(metadata.snapshotId);
      if(payload?.month!==month) throw new Error('Ảnh chụp tháng không khớp. / 月份快照不相符。');
      return {metadata,employees:Array.isArray(payload?.bonus?.employees)?payload.bonus.employees:[]};
    }
    if(Array.isArray(metadata.frozenEmployees)) return {metadata,employees:metadata.frozenEmployees};
    const snapshot=await window._getDocs(window._collection(legacyEmployeeCollection(month)));
    const calculationId=String(metadata.calculationId||'');
    return {metadata,employees:snapshot.docs.map(item=>({id:item.id,...item.data()})).filter(item=>!calculationId||item.calculationId===calculationId)};
  }
  function rowsFromFrozen(employees){
    return (employees||[]).flatMap(employee=>(employee.days||[]).map(day=>({
      productionDate:day.date,employeeId:employee.employeeId,employeeName:employee.employeeName,department:employee.department,
      workedHours:day.attendanceHours,percentage:day.actualEfficiency,status:'ready'
    })));
  }
  async function privateForLocked(metadata,employees){
    const legacy=snapshotData(await window._getDoc(privateMonthRef(metadata.month)));
    if(legacy&&Number(legacy.settingsVersion)===Number(metadata.settingsVersion)) return legacy;
    const settings=await loadSettingsVersion(metadata.settingsVersion);
    const result=calculations().calculateMonth(rowsFromFrozen(employees),settings,new Map());
    return {month:metadata.month,settingsVersion:Number(metadata.settingsVersion),grossExtra:result.totals.grossExtra,
      efficiencyLoss:result.totals.efficiencyLoss,employeeDays:result.totals.employeeDays,calculatedAt:now(),schemaVersion:SCHEMA_VERSION};
  }
  async function loadMonth(month,options={}){
    const normalized=requireMonth(month);
    const stored=await readStoredMonth(normalized);
    if(stored.metadata){
      const privateMonth=options.includePrivate===true?await privateForLocked(stored.metadata,stored.employees):null;
      return {...stored,allEmployees:stored.employees,privateMonth};
    }
    const [table,stable,adjustmentsRows]=await Promise.all([
      options.table||loadReferenceTable(),loadStablePerformance(normalized),readAdjustments(normalized)
    ]);
    if(!table||Number(table.version)<=0) throw new Error('Chưa có bảng đối chiếu thưởng. / 尚無獎金對照表，請先儲存參數。');
    const maps=adjustmentMaps(adjustmentsRows);
    const result=calculations().calculatePublicMonth(stable.rows,table,maps.amounts);
    const anomalies=anomalyRows(stable.rows);
    const employees=publicEmployees(result,maps.notes);
    const metadata=virtualMetadata(normalized,stable,table,result,anomalies);
    let privateMonth=null;
    if(options.includePrivate===true){
      const settings=options.settings||await loadSettings({force:true});
      const privateResult=calculations().calculateMonth(stable.rows,settings,maps.amounts);
      privateMonth={month:normalized,settingsVersion:Number(settings.revision)||0,grossExtra:privateResult.totals.grossExtra,
        efficiencyLoss:privateResult.totals.efficiencyLoss,employeeDays:privateResult.totals.employeeDays,calculatedAt:metadata.calculatedAt,schemaVersion:SCHEMA_VERSION};
    }
    return {metadata,employees,allEmployees:employees,privateMonth};
  }
  async function loadDailyBonuses(month,rows,options={}){
    const normalized=requireMonth(month);
    const stored=await readStoredMonth(normalized);
    if(stored.metadata){
      return new Map(stored.employees.flatMap(employee=>(employee.days||[]).map(day=>[
        `${employee.employeeId}|${day.date}`,Number(day.bonus)||0
      ])));
    }
    const table=options.table||await loadReferenceTable({force:options.force===true});
    if(!table) return new Map();
    return new Map((rows||[]).filter(row=>String(row.productionDate||'').startsWith(`${normalized}-`)).map(row=>[
      `${row.employeeId}|${row.productionDate}`,
      calculations().calculatePublicDay({workedHours:row.workedHours,percentage:row.percentage},table).bonus
    ]));
  }
  async function saveSettings(input){
    const normalized=normalizeSettings(input);
    const logReference=window._newDocRef(LOG_COLLECTION);
    let saved;
    let table;
    await window._runTransaction(async transaction=>{
      const previousSnapshot=await transaction.get(settingsRef());
      const previous=previousSnapshot.exists()?previousSnapshot.data():null;
      const revision=(Number(previous?.revision)||0)+1;
      const previousVersionReference=previous?settingsVersionRef(previous.revision):null;
      const previousVersionSnapshot=previousVersionReference?await transaction.get(previousVersionReference):null;
      const updatedAt=now();
      saved={...normalized,revision,updatedAt,updatedByUid:uid(),updatedBy:username(),schemaVersion:1};
      table=publicTableData(saved,updatedAt);
      if(previousVersionReference&&!previousVersionSnapshot.exists()) transaction.set(previousVersionReference,previous);
      transaction.set(settingsRef(),saved);
      transaction.set(tableRef(),table);
      transaction.set(settingsVersionRef(revision),saved);
      transaction.set(logReference,logData('performanceBonusSettingsUpdate',1,3,`revision ${revision}`,
        ['unitPrice','companyShare','efficiencyCap'].map(field=>({field,before:previous?.[field]??null,after:saved[field]}))));
    },{skipDataVersions:true});
    ensureDirectMemoryIdentity();
    directMemory.set('performanceBonusSettings',cloneValue(saved));
    directMemory.set('performanceBonusTable',cloneValue(table));
    window.PCMSFeatures?.invalidateDataScopes?.(['performanceBonusSettings','performanceBonusTables']);
    return saved;
  }
  async function adjustEmployee(month,employeeId,amount,note=''){
    const normalized=requireMonth(month);
    const [control,stored]=await Promise.all([readControl(normalized),readStoredMonth(normalized)]);
    if((control&&control.status!=='open')||stored.metadata) throw new Error('Tháng đã khóa, không thể điều chỉnh. / 月份已鎖定，不能調整。');
    const current=await loadMonth(normalized,{force:true});
    const employee=current.employees.find(item=>String(item.employeeId)===String(employeeId));
    if(!employee) throw new Error('Không tìm thấy dữ liệu thưởng. / 找不到獎金資料。');
    const requested=Math.round(Number(amount)||0);
    const adjustment=Math.max(-Number(employee.baseBonus||0),requested);
    const updatedAt=now();
    const batch=window._writeBatch({skipDataVersions:true});
    batch.set(adjustmentRef(normalized,employeeId),{
      adjustmentId:adjustmentId(normalized,employeeId),month:normalized,employeeId:String(employeeId),
      adjustmentAmount:adjustment,adjustmentNote:String(note||'').slice(0,200),updatedAt,updatedByUid:uid(),updatedBy:username(),schemaVersion:1
    });
    batch.set(window._newDocRef(LOG_COLLECTION),logData('performanceBonusAdjustment',1,1,`${normalized} · ${employeeId}`,
      [{field:'adjustmentAmount',before:Number(employee.adjustmentAmount)||0,after:adjustment}]));
    await batch.commit();
    return loadMonth(normalized,{force:true});
  }
  function anomalyMessage(metadata){
    const details=(metadata?.anomalies||[]).slice(0,20).map(item=>`${item.date} · ${item.employeeId} · ${item.employeeName}`).join('\n');
    return `Có ${Number(metadata?.anomalyCount)||0} trường hợp dữ liệu không hợp lệ.\n${details} / 有 ${Number(metadata?.anomalyCount)||0} 筆資料異常。\n${details}`;
  }
  async function assertMonthReadyForLock(month){
    const current=await loadMonth(month,{force:true});
    if(Number(current.metadata?.anomalyCount)>0) throw new Error(anomalyMessage(current.metadata));
    if(current.metadata?.summaryReady!==true) throw new Error('Cần hoàn tất tóm tắt tháng trước khi khóa. / 鎖定前必須先完成該月摘要轉換。');
    return current;
  }
  async function lockMonth(month){
    const normalized=requireMonth(month);
    const current=await assertMonthReadyForLock(normalized);
    const service=window.PCMSPerformanceBonusLockService;
    if(!service?.lockMonth) throw new Error('Bộ khóa tháng chưa sẵn sàng. / 月份鎖定程式尚未載入。');
    return service.lockMonth(normalized,current);
  }
  async function updateLockedStatus(month,allowed,nextStatus,extra={},action='performanceBonusExport',logExtra={}){
    const normalized=requireMonth(month);
    let saved;
    await window._runTransaction(async transaction=>{
      const snapshot=await transaction.get(monthRef(normalized));
      if(!snapshot.exists()||!allowed.includes(snapshot.data().status)) throw new Error('Trạng thái tháng không cho phép thao tác. / 月份狀態不允許此操作。');
      saved={...snapshot.data(),status:nextStatus,...extra,updatedAt:now(),updatedByUid:uid(),updatedBy:username()};
      transaction.set(monthRef(normalized),saved);
      transaction.set(window._newDocRef(LOG_COLLECTION),logData(action,saved.employeeCount,saved.eligibleEmployeeCount,normalized,
        [{field:'status',before:snapshot.data().status,after:nextStatus}],logExtra));
    },{skipDataVersions:true});
    return saved;
  }
  async function markExported(month,fileName){
    const current=await readStoredMonth(month);
    const status=current.metadata?.status==='paid'?'paid':'exported';
    const timestamp=now();
    return updateLockedStatus(month,['locked','exported','paid'],status,{
      lastExportedAt:timestamp,lastExportedByUid:uid(),lastExportedBy:username(),
      exportCount:(Number(current.metadata?.exportCount)||0)+1,lastExportFileName:String(fileName||'').slice(0,300)
    },'performanceBonusExport',{fileName});
  }
  async function markPaid(month){
    const timestamp=now();
    return updateLockedStatus(month,['exported'],'paid',{paidAt:timestamp,paidByUid:uid(),paidBy:username()},'performanceBonusPaid');
  }
  async function unlockMonth(month){
    requireMonth(month);
    throw new Error('Chức năng chưa được kết nối. / 功能尚未接入。');
  }
  function canUnlock(){
    if(window.isAdm?.()) return true;
    const role=window.cu?.role;
    return window.permissionSettings?.[role]?.performanceBonusUnlock===true;
  }

  window.PCMSPerformanceBonusStore=Object.freeze({
    currentMonth,validMonth,monthRange,loadSettings,saveSettings,loadReferenceTable,loadMonth,
    loadDailyBonuses,adjustEmployee,assertMonthReadyForLock,lockMonth,markExported,markPaid,unlockMonth,canUnlock
  });
})();
