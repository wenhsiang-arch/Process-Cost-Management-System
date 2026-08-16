// summary-migration（產能摘要轉換）：管理員明確執行、分批可續跑；不刪除或改寫原始產能與考勤。
(function(){
  'use strict';

  const STATE_COLLECTION='productionSummaryMigrations';
  const ENTRY_COLLECTION='productionEntries';
  const ATTENDANCE_COLLECTION='productionAttendance';
  const EMPLOYEE_COLLECTION='productionEmployees';
  const DAY_SUMMARY_COLLECTION='productionDaySummaries';
  const EMPLOYEE_MONTH_COLLECTION='productionEmployeeMonths';
  const BONUS_MONTH_COLLECTION='performanceBonusMonths';
  const LOG_COLLECTION='operationLogs';
  const WRITE_LIMIT=300;

  function text(value){ return String(value||'').trim(); }
  function assertMonth(value){
    const month=text(value);
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Tháng không hợp lệ. / 月份不正確。');
    return month;
  }
  function nextMonth(month){
    const [year,value]=month.split('-').map(Number);
    return value===12?`${year+1}-01`:`${year}-${String(value+1).padStart(2,'0')}`;
  }
  function actor(){
    return {
      updatedAt:Date.now(),updatedByUid:text(window.firebaseAuthUser?.uid),
      updatedBy:text(window.cu?.user||window.cu?.username||window.firebaseAuthUser?.displayName).slice(0,200)
    };
  }
  function assertAdmin(){
    if(window.cu?.role!=='admin'||!window.firebaseAuthUser?.uid){
      throw new Error('Chỉ quản trị viên mới được chuyển đổi tóm tắt. / 只有管理員可以執行摘要轉換。');
    }
  }
  async function queryRange(collection,field,month){
    const start=`${month}-01`;
    const end=`${nextMonth(month)}-01`;
    const snapshot=await window._getDocs(window._query(
      window._collection(collection),window._where(field,'>=',start),window._where(field,'<',end)
    ));
    return snapshot.docs.map(item=>({id:item.id,...item.data()}));
  }
  async function loadMonthSource(month,options={}){
    const normalized=assertMonth(month);
    if(Array.isArray(options.entries)&&Array.isArray(options.attendanceRows)){
      return {entries:options.entries.slice(),attendanceRows:options.attendanceRows.slice(),fromCache:true};
    }
    const [entries,attendanceRows]=await Promise.all([
      queryRange(ENTRY_COLLECTION,'productionDate',normalized),
      queryRange(ATTENDANCE_COLLECTION,'attendanceDate',normalized)
    ]);
    return {entries,attendanceRows,fromCache:false};
  }
  function buildPlan(month,source,employees=[]){
    const summaries=window.PCMSProductionSummaries;
    if(!summaries) throw new Error('Bộ tóm tắt sản xuất chưa sẵn sàng. / 產能摘要程式尚未載入。');
    const normalized=assertMonth(month);
    const identity=new Map((employees||[]).map(item=>[text(item.employeeId||item.id),item]));
    const ids=new Set();
    (source.entries||[]).forEach(item=>ids.add(text(item.employeeId)));
    (source.attendanceRows||[]).forEach(item=>ids.add(text(item.employeeId)));
    const nowActor=actor();
    const dayDocuments=[];
    const monthDocuments=[];
    [...ids].filter(Boolean).sort().forEach(employeeId=>{
      const entryRows=(source.entries||[]).filter(item=>text(item.employeeId)===employeeId);
      const attendanceRows=(source.attendanceRows||[]).filter(item=>text(item.employeeId)===employeeId);
      const snapshot=identity.get(employeeId)||attendanceRows[0]||entryRows[0]||{};
      const built=summaries.buildEmployeeMonth({
        month:normalized,employeeId,employeeName:snapshot.name||snapshot.employeeName,
        department:snapshot.department,entries:entryRows,attendanceRows,actor:nowActor
      });
      dayDocuments.push(...built.dayDocuments);
      if(built.monthDocument) monthDocuments.push(built.monthDocument);
    });
    return {
      month:normalized,dayDocuments,monthDocuments,sourceEntryCount:(source.entries||[]).length,
      sourceAttendanceCount:(source.attendanceRows||[]).length,employeeCount:ids.size,
      estimatedReads:(source.entries||[]).length+(source.attendanceRows||[]).length
    };
  }
  function comparePlan(plan,existingDays=[],existingMonths=[]){
    const dayMap=new Map((existingDays||[]).map(item=>[item.summaryId||item.id,item]));
    const monthMap=new Map((existingMonths||[]).map(item=>[item.monthSummaryId||item.id,item]));
    const fields=['attendanceHours','standardHours','activeSupplementHours','effectiveHours','activeEntryCount','invalidCapacityCount','efficiencyPercentage'];
    const differences=[];
    plan.dayDocuments.forEach(expected=>{
      const actual=dayMap.get(expected.summaryId);
      if(!actual){ differences.push({type:'missing-day',id:expected.summaryId}); return; }
      fields.forEach(field=>{
        if((actual[field]??null)!==(expected[field]??null)) differences.push({type:'day-field',id:expected.summaryId,field,expected:expected[field]??null,actual:actual[field]??null});
      });
    });
    plan.monthDocuments.forEach(expected=>{
      const actual=monthMap.get(expected.monthSummaryId);
      if(!actual) differences.push({type:'missing-month',id:expected.monthSummaryId});
    });
    return {matched:differences.length===0,differences};
  }
  async function readEmployees(){
    const snapshot=await window._getDocs(window._collection(EMPLOYEE_COLLECTION));
    return snapshot.docs.map(item=>({id:item.id,...item.data()}));
  }
  async function readMonthSummaries(collection,month){
    const snapshot=await window._getDocs(window._query(
      window._collection(collection),window._where('month','==',assertMonth(month))
    ));
    return snapshot.docs.map(item=>({id:item.id,...item.data()}));
  }
  async function readExistingSummaries(month){
    const [days,months]=await Promise.all([
      readMonthSummaries(DAY_SUMMARY_COLLECTION,month),
      readMonthSummaries(EMPLOYEE_MONTH_COLLECTION,month)
    ]);
    return {days,months};
  }
  function nextRevision(current){
    return Math.max(0,Math.round(Number(current?.revision)||0))+1;
  }
  // preparePlanForWrite（準備正式重建寫入）：一次重建只增加一次 revision，不隨來源 Entry 數量增加。
  function preparePlanForWrite(plan,existing={}){
    const existingDays=new Map((existing.days||[]).map(item=>[text(item.summaryId||item.id),item]));
    const existingMonths=new Map((existing.months||[]).map(item=>[text(item.monthSummaryId||item.id),item]));
    const dayDocuments=(plan.dayDocuments||[]).map(item=>({
      ...item,revision:nextRevision(existingDays.get(text(item.summaryId))),lastMutation:'migration'
    }));
    const dayRevisions=new Map(dayDocuments.map(item=>[text(item.summaryId),item.revision]));
    const monthDocuments=(plan.monthDocuments||[]).map(item=>{
      const days=Object.fromEntries(Object.entries(item.days||{}).map(([key,day])=>{
        const summaryId=`${text(day.productionDate)}__${text(item.employeeId)}`;
        return [key,{...day,dayRevision:dayRevisions.get(summaryId)||1}];
      }));
      return {
        ...item,days,revision:nextRevision(existingMonths.get(text(item.monthSummaryId))),
        lastDayRevision:dayRevisions.get(text(item.lastDayId))||1,lastMutation:'migration'
      };
    });
    return {...plan,dayDocuments,monthDocuments};
  }
  async function writeChunks(items,onProgress){
    let completed=0;
    for(let index=0;index<items.length;index+=WRITE_LIMIT){
      const chunk=items.slice(index,index+WRITE_LIMIT);
      const batch=window._writeBatch({skipDataVersions:true});
      chunk.forEach(item=>batch.set(item.reference,item.data));
      await batch.commit();
      completed+=chunk.length;
      onProgress?.({completed,total:items.length});
    }
  }
  async function markMigrationFailed(reference,month,currentActor,error,plan){
    try{
      const failedAt=Date.now();
      const batch=window._writeBatch({skipDataVersions:true});
      batch.set(reference,{
        month,status:'failed',sourceEntryCount:Number(plan?.sourceEntryCount)||0,
        sourceAttendanceCount:Number(plan?.sourceAttendanceCount)||0,employeeCount:Number(plan?.employeeCount)||0,
        failedAt,lastError:text(error?.message||error).slice(0,500),updatedAt:failedAt,
        updatedByUid:currentActor.updatedByUid,schemaVersion:1
      },{merge:true});
      await batch.commit();
    }catch(_error){ /* 原始失敗必須優先回報；月份仍維持 migrating，允許人工再次重試。 */ }
  }
  async function migrateMonth(month,options={}){
    assertAdmin();
    const normalized=assertMonth(month);
    const source=await loadMonthSource(normalized,options);
    const employees=Array.isArray(options.employees)?options.employees:await readEmployees();
    let plan=buildPlan(normalized,source,employees);
    if(options.commit!==true) return {...plan,dryRun:true,migrationSource:source,migrationEmployees:employees};
    const summaries=window.PCMSProductionSummaries;
    const stateReference=window._docRef(STATE_COLLECTION,normalized);
    const controlReference=summaries.monthReference(normalized);
    const legacyBonusSnapshot=await window._getDoc(window._docRef(BONUS_MONTH_COLLECTION,normalized));
    const legacyStatus=legacyBonusSnapshot.exists()?String(legacyBonusSnapshot.data()?.status||'draft'):'draft';
    const legacyFinalStatus=['locked','exported','paid'].includes(legacyStatus)?'locked':'open';
    const currentActor=actor();
    let migrationRevision=0;
    let finalStatus=legacyFinalStatus;
    let alreadyMigrating=false;
    let migrationStarted=false;
    try{
      await window._runTransaction(async transaction=>{
        const currentSnapshot=await transaction.get(controlReference);
        const current=currentSnapshot.exists()?currentSnapshot.data():{};
        alreadyMigrating=currentSnapshot.exists()&&current.status==='migrating';
        finalStatus=currentSnapshot.exists()&&current.status==='locked'?'locked':legacyFinalStatus;
        const currentRevision=Math.max(0,Math.round(Number(current.revision)||0));
        migrationRevision=alreadyMigrating?currentRevision:currentRevision+1;
        if(migrationRevision<1) migrationRevision=1;
        transaction.set(controlReference,{
          ...current,month:normalized,status:'migrating',summaryReady:false,revision:migrationRevision,
          entriesVersion:String(current.entriesVersion||'0'),attendanceVersion:String(current.attendanceVersion||'0'),
          summaryVersion:String(current.summaryVersion||'0'),
          migrationStartedAt:currentActor.updatedAt,migrationStartedByUid:currentActor.updatedByUid,
          ...currentActor,schemaVersion:2
        });
        transaction.set(stateReference,{
          month:normalized,status:'running',sourceEntryCount:plan.sourceEntryCount,
          sourceAttendanceCount:plan.sourceAttendanceCount,employeeCount:plan.employeeCount,
          startedAt:currentActor.updatedAt,startedByUid:currentActor.updatedByUid,
          updatedAt:currentActor.updatedAt,updatedByUid:currentActor.updatedByUid,schemaVersion:1
        });
      },{skipDataVersions:true});
      migrationStarted=true;
      // 首次進入 migrating 後重讀來源，納入使用者確認期間剛完成的報工／考勤；人工重試時來源已被鎖定，可沿用本次預覽。
      if(!alreadyMigrating){
        const stableSource=await loadMonthSource(normalized);
        plan=buildPlan(normalized,stableSource,employees);
      }
      plan=preparePlanForWrite(plan,await readExistingSummaries(normalized));
      const writes=[
        ...plan.dayDocuments.map(data=>({reference:summaries.dayReference(data.productionDate,data.employeeId),data})),
        ...plan.monthDocuments.map(data=>({reference:summaries.employeeMonthReference(data.month,data.employeeId),data}))
      ];
      await writeChunks(writes,options.onProgress);
      const finishedAt=Date.now();
      const completedVersion=`${finishedAt}-${currentActor.updatedByUid.slice(0,12)}-${Math.random().toString(36).slice(2,10)}`;
      await window._runTransaction(async transaction=>{
        const currentSnapshot=await transaction.get(controlReference);
        if(!currentSnapshot.exists()||currentSnapshot.data()?.status!=='migrating'
          ||Number(currentSnapshot.data()?.revision)!==migrationRevision){
          throw new Error('Trạng thái tháng đã thay đổi trong lúc xây dựng tóm tắt. / 摘要重建期間月份狀態已改變。');
        }
        transaction.set(controlReference,{
          ...currentSnapshot.data(),month:normalized,status:finalStatus,summaryReady:true,revision:migrationRevision+1,
          entriesVersion:`${completedVersion}-entries`,attendanceVersion:`${completedVersion}-attendance`,
          summaryVersion:`${completedVersion}-summary`,summarySchemaVersion:summaries.SCHEMA_VERSION,
          summaryCompletedAt:finishedAt,updatedAt:finishedAt,updatedByUid:currentActor.updatedByUid,
          updatedBy:currentActor.updatedBy,schemaVersion:2
        });
        transaction.set(stateReference,{
          month:normalized,status:'completed',sourceEntryCount:plan.sourceEntryCount,
          sourceAttendanceCount:plan.sourceAttendanceCount,employeeCount:plan.employeeCount,
          writtenDayCount:plan.dayDocuments.length,writtenMonthCount:plan.monthDocuments.length,
          completedAt:finishedAt,updatedAt:finishedAt,updatedByUid:currentActor.updatedByUid,schemaVersion:1
        },{merge:true});
        transaction.set(window._newDocRef(LOG_COLLECTION),{
          permissionKey:'productionRecords',feature:'production',action:'productionSummaryMigration',status:'success',
          createdAt:finishedAt,createdByUid:currentActor.updatedByUid,createdBy:currentActor.updatedBy,
          itemCount:writes.length,detailCount:plan.employeeCount,
          note:`${normalized} · days ${plan.dayDocuments.length} · employees ${plan.employeeCount}`,
          changes:[]
        });
      },{skipDataVersions:true});
      return {...plan,dryRun:false,writtenCount:writes.length};
    }catch(error){
      if(migrationStarted) await markMigrationFailed(stateReference,normalized,currentActor,error,plan);
      throw error;
    }
  }

  window.PCMSProductionSummaryMigration=Object.freeze({
    loadMonthSource,buildPlan,comparePlan,preparePlanForWrite,migrateMonth
  });
})();
