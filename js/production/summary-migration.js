// summary-migration（產能摘要維修）：原始產能與考勤為正式來源；摘要可預檢、重建及安全重試。
(function(){
  'use strict';

  const STATE_COLLECTION='productionSummaryMigrations';
  const ENTRY_COLLECTION='productionEntries';
  const ATTENDANCE_COLLECTION='productionAttendance';
  const EMPLOYEE_COLLECTION='productionEmployees';
  const DAY_SUMMARY_COLLECTION='productionDaySummaries';
  const EMPLOYEE_MONTH_COLLECTION='productionEmployeeMonths';
  const MONTH_COLLECTION='productionMonths';
  const TOTAL_COLLECTION='productionProcessTotals';
  const BONUS_MONTH_COLLECTION='performanceBonusMonths';
  const BONUS_PRIVATE_COLLECTION='performanceBonusPrivateMonths';
  const BONUS_ADJUSTMENT_COLLECTION='performanceBonusAdjustments';
  const LOG_COLLECTION='operationLogs';
  const RESET_MONTH='2026-08';
  const WRITE_LIMIT=250;
  const RESET_WRITE_LIMIT=4;
  const MAX_SOURCE_CHANGE_RETRIES=2;

  function text(value){ return String(value??'').trim(); }
  function number(value){ const parsed=Number(value); return Number.isFinite(parsed)?parsed:0; }
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
      throw new Error('Chỉ quản trị viên mới được bảo trì tóm tắt. / 只有管理員可以維修摘要。');
    }
  }
  function monthRange(month){ return {start:`${month}-01`,end:`${nextMonth(month)}-01`}; }
  function documentRows(snapshot){ return snapshot.docs.map(item=>({id:item.id,...item.data()})); }
  async function queryRange(collection,field,month){
    const {start,end}=monthRange(assertMonth(month));
    return documentRows(await window._getDocs(window._query(
      window._collection(collection),window._where(field,'>=',start),window._where(field,'<',end)
    )));
  }
  async function queryMonth(collection,month){
    return documentRows(await window._getDocs(window._query(
      window._collection(collection),window._where('month','==',assertMonth(month))
    )));
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
  async function readEmployees(){
    return documentRows(await window._getDocs(window._collection(EMPLOYEE_COLLECTION)));
  }
  async function readExistingSummaries(month){
    const [days,months]=await Promise.all([
      // 舊摘要可能沒有 month 欄位，必須以 productionDate 找到，避免漏掉實際衝突文件。
      queryRange(DAY_SUMMARY_COLLECTION,'productionDate',month),
      queryMonth(EMPLOYEE_MONTH_COLLECTION,month)
    ]);
    return {days,months};
  }
  async function readControl(month){
    const snapshot=await window._getDoc(window._docRef(MONTH_COLLECTION,assertMonth(month)));
    return snapshot.exists()?{id:snapshot.id,...snapshot.data()}:null;
  }
  async function readState(month){
    const snapshot=await window._getDoc(window._docRef(STATE_COLLECTION,assertMonth(month)));
    return snapshot.exists()?{id:snapshot.id,...snapshot.data()}:null;
  }

  function issue(type,collection,documentId,details={}){
    return {
      type,collection,textCollection:collection,documentId:text(documentId),
      employeeId:text(details.employeeId),date:text(details.date),field:text(details.field),
      vi:text(details.vi)||'Dữ liệu không hợp lệ, vui lòng kiểm tra bản ghi này.',
      zh:text(details.zh)||'資料不正確，請檢查這筆紀錄。'
    };
  }
  function validationError(issues,stage='preflight'){
    const first=issues[0]||{};
    const error=new Error(`${first.vi||'Dữ liệu chưa đạt yêu cầu.'} / ${first.zh||'資料尚未符合要求。'}`);
    error.code='summary-preflight-failed';
    error.stage=stage;
    error.userIssues=issues;
    return error;
  }
  function sourceIssues(month,source){
    const issues=[];
    const attendanceByKey=new Map();
    (source.attendanceRows||[]).forEach(row=>{
      const id=text(row.attendanceId||row.id);
      const date=text(row.attendanceDate);
      const employeeId=text(row.employeeId);
      const hours=number(row.normalHours)+number(row.overtimeHours);
      const context={employeeId,date};
      if(date.slice(0,7)!==month||id!==`${date}__${employeeId}`){
        issues.push(issue('attendance-identity',ATTENDANCE_COLLECTION,id,{...context,
          vi:'Mã bản ghi chấm công, ngày và mã nhân viên không khớp.',
          zh:'考勤文件編號、日期與員工工號不一致。'}));
      }
      if(!/^[A-Z0-9_-]{1,30}$/.test(employeeId)||!text(row.employeeName)||!text(row.department)){
        issues.push(issue('attendance-snapshot',ATTENDANCE_COLLECTION,id,{...context,
          vi:'Chấm công thiếu mã, tên hoặc bộ phận của nhân viên.',
          zh:'考勤缺少員工工號、姓名或部門。'}));
      }
      if(hours<0||hours>24||Math.round(hours*2)!==hours*2){
        issues.push(issue('attendance-hours',ATTENDANCE_COLLECTION,id,{...context,field:'normalHours/overtimeHours',
          vi:'Giờ chấm công phải nằm trong 0–24 giờ và theo đơn vị 0,5 giờ.',
          zh:'考勤工時必須介於 0～24 小時，且以 0.5 小時為單位。'}));
      }
      attendanceByKey.set(`${date}__${employeeId}`,{row,hours});
    });
    (source.entries||[]).forEach(row=>{
      const id=text(row.entryId||row.id);
      const date=text(row.productionDate);
      const employeeId=text(row.employeeId);
      const context={employeeId,date};
      if(date.slice(0,7)!==month||!id||!employeeId){
        issues.push(issue('entry-identity',ENTRY_COLLECTION,id,{...context,
          vi:'Bản ghi sản lượng thiếu mã nhân viên, ngày hoặc mã bản ghi.',
          zh:'產能紀錄缺少員工工號、日期或文件編號。'}));
      }
      if(!['active','voided'].includes(text(row.status))){
        issues.push(issue('entry-status',ENTRY_COLLECTION,id,{...context,field:'status',
          vi:'Trạng thái bản ghi sản lượng không hợp lệ.',
          zh:'產能紀錄狀態不正確。'}));
      }
      if(row.status==='active'){
        const attendance=attendanceByKey.get(`${date}__${employeeId}`);
        if(!attendance||attendance.hours<=0){
          issues.push(issue('entry-attendance',ENTRY_COLLECTION,id,{...context,
            vi:'Bản ghi sản lượng đang hoạt động nhưng ngày này không có chấm công hợp lệ lớn hơn 0 giờ.',
            zh:'有效產能紀錄在當日沒有大於 0 小時的有效考勤。'}));
        }
        if(row.recordType==='standard'){
          if(!text(row.productCode)||!text(row.processNo)||!Number.isInteger(Number(row.quantity))||Number(row.quantity)<=0
            ||number(row.processSecSnapshot)<=0||number(row.hourlyCapacitySnapshot)<=0){
            issues.push(issue('entry-standard',ENTRY_COLLECTION,id,{...context,
              vi:'Sản lượng tiêu chuẩn thiếu mã hàng, công đoạn, số lượng hoặc giây tiêu chuẩn hợp lệ.',
              zh:'正式產能缺少有效的款號、工序、數量或標準秒數。'}));
          }
        }else if(row.recordType==='supplement'){
          if(number(row.supplementHours)<=0){
            issues.push(issue('entry-supplement',ENTRY_COLLECTION,id,{...context,
              vi:'Giờ bổ sung phải lớn hơn 0.',
              zh:'補充工時必須大於 0。'}));
          }
        }else{
          issues.push(issue('entry-record-type',ENTRY_COLLECTION,id,{...context,field:'recordType',
            vi:'Loại bản ghi sản lượng không hợp lệ.',
            zh:'產能紀錄類型不正確。'}));
        }
      }
    });
    return issues;
  }
  function existingSummaryIssues(month,existing){
    const issues=[];
    (existing.days||[]).forEach(row=>{
      const id=text(row.summaryId||row.id);
      const context={employeeId:row.employeeId,date:row.productionDate};
      if(id!==`${text(row.productionDate)}__${text(row.employeeId)}`||text(row.productionDate).slice(0,7)!==month){
        issues.push(issue('day-summary-identity',DAY_SUMMARY_COLLECTION,id,{...context,
          vi:'Tóm tắt ngày cũ có mã tài liệu, ngày hoặc nhân viên không khớp.',
          zh:'舊每日摘要的文件編號、日期或員工不一致。'}));
      }
      if(!Number.isInteger(Number(row.revision))||Number(row.revision)<0){
        issues.push(issue('day-summary-revision',DAY_SUMMARY_COLLECTION,id,{...context,field:'revision',
          vi:'Số phiên bản của tóm tắt ngày cũ không hợp lệ.',
          zh:'舊每日摘要的 revision 不正確。'}));
      }
    });
    (existing.months||[]).forEach(row=>{
      const id=text(row.monthSummaryId||row.id);
      const context={employeeId:row.employeeId,date:month};
      if(id!==`${month}__${text(row.employeeId)}`){
        issues.push(issue('month-summary-identity',EMPLOYEE_MONTH_COLLECTION,id,{...context,
          vi:'Tóm tắt nhân viên theo tháng có mã tài liệu hoặc nhân viên không khớp.',
          zh:'員工月摘要的文件編號或員工不一致。'}));
      }
      if(!Number.isInteger(Number(row.revision))||Number(row.revision)<1){
        issues.push(issue('month-summary-revision',EMPLOYEE_MONTH_COLLECTION,id,{...context,field:'revision',
          vi:'Số phiên bản của tóm tắt tháng cũ không hợp lệ.',
          zh:'舊員工月摘要的 revision 不正確。'}));
      }
    });
    return issues;
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
      if(!monthMap.has(expected.monthSummaryId)) differences.push({type:'missing-month',id:expected.monthSummaryId});
    });
    return {matched:differences.length===0,differences};
  }
  function nextRevision(current){ return Math.max(0,Math.round(number(current?.revision)))+1; }
  function preparePlanForWrite(plan,existing={}){
    const existingDays=new Map((existing.days||[]).map(item=>[text(item.summaryId||item.id),item]));
    const existingMonths=new Map((existing.months||[]).map(item=>[text(item.monthSummaryId||item.id),item]));
    const dayDocuments=(plan.dayDocuments||[]).map(item=>({
      ...item,revision:nextRevision(existingDays.get(text(item.summaryId))),lastMutation:'migration'
    }));
    const dayRevisions=new Map(dayDocuments.map(item=>[text(item.summaryId),item.revision]));
    const monthDocuments=(plan.monthDocuments||[]).map(item=>{
      const days=Object.fromEntries(Object.entries(item.days||{}).map(([key,day])=>{
        const id=`${text(day.productionDate)}__${text(item.employeeId)}`;
        return [key,{...day,dayRevision:dayRevisions.get(id)||1}];
      }));
      return {...item,days,revision:nextRevision(existingMonths.get(text(item.monthSummaryId))),
        lastDayRevision:dayRevisions.get(text(item.lastDayId))||1,lastMutation:'migration'};
    });
    const expectedDayIds=new Set(dayDocuments.map(item=>text(item.summaryId)));
    const expectedMonthIds=new Set(monthDocuments.map(item=>text(item.monthSummaryId)));
    return {
      ...plan,dayDocuments,monthDocuments,
      staleDays:(existing.days||[]).filter(item=>!expectedDayIds.has(text(item.summaryId||item.id))),
      staleMonths:(existing.months||[]).filter(item=>!expectedMonthIds.has(text(item.monthSummaryId||item.id)))
    };
  }
  function plannedDocumentIssues(plan){
    const issues=[];
    (plan.dayDocuments||[]).forEach(data=>{
      const id=text(data.summaryId);
      if(!id||!text(data.employeeName)||!text(data.department)||!Number.isInteger(data.revision)||data.revision<1){
        issues.push(issue('planned-day',DAY_SUMMARY_COLLECTION,id,{employeeId:data.employeeId,date:data.productionDate,
          vi:'Không thể tạo tóm tắt ngày vì thiếu tên, bộ phận hoặc số phiên bản hợp lệ.',
          zh:'每日摘要缺少有效的姓名、部門或 revision，無法建立。'}));
      }
    });
    (plan.monthDocuments||[]).forEach(data=>{
      const id=text(data.monthSummaryId);
      if(!id||!text(data.employeeName)||!text(data.department)||!Number.isInteger(data.revision)||data.revision<1){
        issues.push(issue('planned-month',EMPLOYEE_MONTH_COLLECTION,id,{employeeId:data.employeeId,date:data.month,
          vi:'Không thể tạo tóm tắt tháng vì thiếu tên, bộ phận hoặc số phiên bản hợp lệ.',
          zh:'員工月摘要缺少有效的姓名、部門或 revision，無法建立。'}));
      }
    });
    return issues;
  }
  async function preflight(month,options={}){
    assertAdmin();
    const normalized=assertMonth(month);
    const [source,employees,existing,control]=await Promise.all([
      loadMonthSource(normalized,options),
      Array.isArray(options.employees)?Promise.resolve(options.employees):readEmployees(),
      readExistingSummaries(normalized),
      readControl(normalized)
    ]);
    const issues=[...sourceIssues(normalized,source),...existingSummaryIssues(normalized,existing)];
    let plan;
    if(!issues.length){
      plan=preparePlanForWrite(buildPlan(normalized,source,employees),existing);
      issues.push(...plannedDocumentIssues(plan));
    }
    if(issues.length) throw validationError(issues);
    return {
      ...plan,dryRun:true,migrationSource:source,migrationEmployees:employees,
      existingSummaryCount:existing.days.length+existing.months.length,
      controlRevision:Math.max(0,Math.round(number(control?.revision))),
      controlStatus:text(control?.status),controlSummaryReady:control?.summaryReady===true
    };
  }

  function summaryWriteItems(plan){
    const summaries=window.PCMSProductionSummaries;
    return [
      ...(plan.dayDocuments||[]).map(data=>({
        mode:'set',reference:summaries.dayReference(data.productionDate,data.employeeId),data,
        collection:DAY_SUMMARY_COLLECTION,documentId:data.summaryId,employeeId:data.employeeId,date:data.productionDate
      })),
      ...(plan.monthDocuments||[]).map(data=>({
        mode:'set',reference:summaries.employeeMonthReference(data.month,data.employeeId),data,
        collection:EMPLOYEE_MONTH_COLLECTION,documentId:data.monthSummaryId,employeeId:data.employeeId,date:data.month
      })),
      ...(plan.staleDays||[]).map(data=>({
        mode:'delete',reference:window._docRef(DAY_SUMMARY_COLLECTION,data.id),
        collection:DAY_SUMMARY_COLLECTION,documentId:data.id,employeeId:data.employeeId,date:data.productionDate
      })),
      ...(plan.staleMonths||[]).map(data=>({
        mode:'delete',reference:window._docRef(EMPLOYEE_MONTH_COLLECTION,data.id),
        collection:EMPLOYEE_MONTH_COLLECTION,documentId:data.id,employeeId:data.employeeId,date:data.month
      }))
    ];
  }
  function rawFirebaseError(error){
    return `${text(error?.code||error?.cause?.code||'unknown')}: ${text(error?.message||error?.cause?.message||error||'unknown')}`.slice(0,1000);
  }
  function writeError(item,error,batchNumber,completed){
    const result=new Error('Firebase Security Rules（安全規則）拒絕摘要維修文件。');
    result.code=text(error?.code||'permission-denied');
    result.stage='summary-write';
    result.userIssues=[issue('summary-write',item.collection,item.documentId,{
      employeeId:item.employeeId,date:item.date,
      vi:'Không thể ghi bản tóm tắt này. Vui lòng ghi lại mã tài liệu và liên hệ quản trị viên.',
      zh:'這筆摘要無法寫入，請記下文件編號並聯絡管理員。'
    })];
    result.technical={batchNumber,completed,raw:rawFirebaseError(error)};
    result.completedWrites=completed;
    return result;
  }
  async function locateRejectedWrite(chunk,batchNumber,originalError,completed){
    for(const item of chunk){
      const batch=window._writeBatch({skipDataVersions:true});
      if(item.mode==='delete') batch.delete(item.reference); else batch.set(item.reference,item.data);
      try{ await batch.commit(); }
      catch(error){ throw writeError(item,error,batchNumber,completed); }
      completed+=1;
    }
    const error=new Error('Không thể ghi đồng thời cả nhóm tóm tắt. / 無法同時寫入這批摘要。');
    error.code=text(originalError?.code||'permission-denied');
    error.stage='summary-batch';
    error.technical={batchNumber,completed,raw:rawFirebaseError(originalError)};
    throw error;
  }
  async function writeChunks(items,onProgress){
    let completed=0;
    for(let index=0;index<items.length;index+=WRITE_LIMIT){
      const chunk=items.slice(index,index+WRITE_LIMIT);
      const batchNumber=Math.floor(index/WRITE_LIMIT)+1;
      const batch=window._writeBatch({skipDataVersions:true});
      chunk.forEach(item=>item.mode==='delete'?batch.delete(item.reference):batch.set(item.reference,item.data));
      try{ await batch.commit(); }
      catch(error){
        if(text(error?.code).includes('permission-denied')||text(error?.message).toLowerCase().includes('insufficient permissions')){
          await locateRejectedWrite(chunk,batchNumber,error,completed);
        }
        error.completedWrites=completed;
        throw error;
      }
      completed+=chunk.length;
      onProgress?.({completed,total:items.length});
    }
    return completed;
  }
  async function beginRebuild(month,plan){
    const currentActor=actor();
    const controlReference=window._docRef(MONTH_COLLECTION,month);
    const stateReference=window._docRef(STATE_COLLECTION,month);
    let rebuildRevision=0;
    let wasReady=false;
    await window._runTransaction(async transaction=>{
      const snapshot=await transaction.get(controlReference);
      const current=snapshot.exists()?snapshot.data():{};
      if(snapshot.exists()&&!['open','migrating'].includes(text(current.status))){
        throw new Error('Tháng đã khóa nên không thể xây dựng lại tóm tắt. / 月份已鎖定，不能重建摘要。');
      }
      wasReady=current.summaryReady===true;
      rebuildRevision=Math.max(0,Math.round(number(current.revision)))+1;
      const next={
        ...current,month,status:'open',summaryReady:false,revision:Math.max(1,rebuildRevision),
        entriesVersion:text(current.entriesVersion)||'0',attendanceVersion:text(current.attendanceVersion)||'0',
        summaryVersion:text(current.summaryVersion)||'0',
        migrationStartedAt:currentActor.updatedAt,migrationStartedByUid:currentActor.updatedByUid,
        ...currentActor,schemaVersion:2
      };
      transaction.set(controlReference,next);
      transaction.set(stateReference,{
        month,status:'running',baseRevision:next.revision,sourceEntryCount:plan.sourceEntryCount,
        sourceAttendanceCount:plan.sourceAttendanceCount,employeeCount:plan.employeeCount,writtenCount:0,
        startedAt:currentActor.updatedAt,startedByUid:currentActor.updatedByUid,
        updatedAt:currentActor.updatedAt,updatedByUid:currentActor.updatedByUid,schemaVersion:1
      });
    },{skipDataVersions:true});
    return {rebuildRevision:Math.max(1,rebuildRevision),wasReady};
  }
  async function markFailed(month,error,plan,writtenCount=0){
    const currentActor=actor();
    try{
      const batch=window._writeBatch({skipDataVersions:true});
      batch.set(window._docRef(STATE_COLLECTION,month),{
        month,status:'failed',sourceEntryCount:Number(plan?.sourceEntryCount)||0,
        sourceAttendanceCount:Number(plan?.sourceAttendanceCount)||0,employeeCount:Number(plan?.employeeCount)||0,
        writtenCount:Number(writtenCount)||0,failedAt:currentActor.updatedAt,
        lastError:text(error?.message||error).slice(0,500),updatedAt:currentActor.updatedAt,
        updatedByUid:currentActor.updatedByUid,schemaVersion:1
      },{merge:true});
      await batch.commit();
    }catch(_error){ /* 保留原始錯誤；月份仍為 open，不會鎖住報工與考勤。 */ }
  }
  async function restoreReadyWhenNoWrite(month,rebuildRevision,wasReady){
    if(!wasReady) return;
    const currentActor=actor();
    try{
      await window._runTransaction(async transaction=>{
        const reference=window._docRef(MONTH_COLLECTION,month);
        const snapshot=await transaction.get(reference);
        if(snapshot.exists()&&snapshot.data().status==='open'&&snapshot.data().summaryReady===false
          &&Number(snapshot.data().revision)===rebuildRevision){
          transaction.set(reference,{...snapshot.data(),summaryReady:true,revision:rebuildRevision+1,...currentActor});
        }
      },{skipDataVersions:true});
    }catch(_error){ /* 無法恢復時維持 summaryReady=false，來源仍可操作，摘要不可被分析誤用。 */ }
  }
  async function completeRebuild(month,plan,rebuildRevision,writtenCount){
    const summaries=window.PCMSProductionSummaries;
    const currentActor=actor();
    const version=`${currentActor.updatedAt}-${currentActor.updatedByUid.slice(0,12)}-${Math.random().toString(36).slice(2,10)}`;
    await window._runTransaction(async transaction=>{
      const controlReference=window._docRef(MONTH_COLLECTION,month);
      const stateReference=window._docRef(STATE_COLLECTION,month);
      const snapshot=await transaction.get(controlReference);
      if(!snapshot.exists()||snapshot.data().status!=='open'||snapshot.data().summaryReady!==false
        ||Number(snapshot.data().revision)!==rebuildRevision){
        const error=new Error('Dữ liệu nguồn đã thay đổi trong lúc xây dựng. Hệ thống sẽ đọc lại dữ liệu mới nhất. / 重建期間來源資料已變更，系統會重新讀取最新資料。');
        error.code='summary-source-changed';
        error.stage='final-check';
        throw error;
      }
      transaction.set(controlReference,{
        ...snapshot.data(),summaryReady:true,revision:rebuildRevision+1,summaryVersion:`${version}-summary`,
        summarySchemaVersion:summaries.SCHEMA_VERSION,summaryCompletedAt:currentActor.updatedAt,...currentActor
      });
      transaction.set(stateReference,{
        month,status:'completed',baseRevision:rebuildRevision,sourceEntryCount:plan.sourceEntryCount,
        sourceAttendanceCount:plan.sourceAttendanceCount,employeeCount:plan.employeeCount,
        writtenDayCount:plan.dayDocuments.length,writtenMonthCount:plan.monthDocuments.length,
        writtenCount,completedAt:currentActor.updatedAt,updatedAt:currentActor.updatedAt,
        updatedByUid:currentActor.updatedByUid,schemaVersion:1
      },{merge:true});
      transaction.set(window._newDocRef(LOG_COLLECTION),{
        permissionKey:'productionRecords',feature:'production',action:'productionSummaryMigration',status:'success',
        createdAt:currentActor.updatedAt,createdByUid:currentActor.updatedByUid,createdBy:currentActor.updatedBy,
        itemCount:writtenCount,detailCount:plan.employeeCount,
        note:`${month} · rebuild · days ${plan.dayDocuments.length} · employees ${plan.employeeCount}`,changes:[]
      });
    },{skipDataVersions:true});
  }
  async function runRebuildAttempt(month,options={}){
    const preview=await preflight(month,options);
    const start=await beginRebuild(month,preview);
    let writtenCount=0;
    try{
      // 狀態切為 summaryReady=false 後重新讀來源，涵蓋預檢與開始之間剛完成的來源異動。
      const stableSource=await loadMonthSource(month);
      const stableExisting=await readExistingSummaries(month);
      const stableIssues=[...sourceIssues(month,stableSource),...existingSummaryIssues(month,stableExisting)];
      if(stableIssues.length) throw validationError(stableIssues,'post-start-preflight');
      let plan=preparePlanForWrite(buildPlan(month,stableSource,preview.migrationEmployees),stableExisting);
      const planIssues=plannedDocumentIssues(plan);
      if(planIssues.length) throw validationError(planIssues,'post-start-plan');
      const writes=summaryWriteItems(plan);
      writtenCount=await writeChunks(writes,options.onProgress);
      await completeRebuild(month,plan,start.rebuildRevision,writtenCount);
      await clearMonthCaches(month);
      return {...plan,dryRun:false,writtenCount};
    }catch(error){
      writtenCount=Math.max(writtenCount,Math.round(number(error?.completedWrites??error?.technical?.completed)));
      await markFailed(month,error,preview,writtenCount);
      if(writtenCount===0) await restoreReadyWhenNoWrite(month,start.rebuildRevision,start.wasReady);
      throw error;
    }
  }
  async function migrateMonth(month,options={}){
    assertAdmin();
    const normalized=assertMonth(month);
    if(options.commit!==true) return preflight(normalized,options);
    let lastError;
    for(let attempt=0;attempt<MAX_SOURCE_CHANGE_RETRIES;attempt+=1){
      try{ return await runRebuildAttempt(normalized,{...options,entries:undefined,attendanceRows:undefined}); }
      catch(error){
        lastError=error;
        if(error?.code!=='summary-source-changed'||attempt+1>=MAX_SOURCE_CHANGE_RETRIES) throw error;
        options.onRetry?.({attempt:attempt+1,maximum:MAX_SOURCE_CHANGE_RETRIES});
      }
    }
    throw lastError;
  }
  async function releaseMonth(month){
    assertAdmin();
    const normalized=assertMonth(month);
    const currentActor=actor();
    await window._runTransaction(async transaction=>{
      const controlReference=window._docRef(MONTH_COLLECTION,normalized);
      const stateReference=window._docRef(STATE_COLLECTION,normalized);
      const snapshot=await transaction.get(controlReference);
      if(!snapshot.exists()||snapshot.data().status!=='migrating') return;
      transaction.set(controlReference,{
        ...snapshot.data(),status:'open',summaryReady:false,
        revision:Math.max(0,Math.round(number(snapshot.data().revision)))+1,...currentActor
      });
      transaction.set(stateReference,{
        month:normalized,status:'canceled',canceledAt:currentActor.updatedAt,
        updatedAt:currentActor.updatedAt,updatedByUid:currentActor.updatedByUid,schemaVersion:1
      },{merge:true});
    },{skipDataVersions:true});
    return readControl(normalized);
  }

  function uniqueById(rows){ return [...new Map((rows||[]).map(item=>[text(item.id),item])).values()]; }
  async function loadTestResetPlan(){
    assertAdmin();
    const month=RESET_MONTH;
    const [entries,attendanceRows,daySummaries,employeeMonths,adjustments,state,bonusMonth,privateMonth,control,bonusEmployees]=await Promise.all([
      queryRange(ENTRY_COLLECTION,'productionDate',month),
      queryRange(ATTENDANCE_COLLECTION,'attendanceDate',month),
      queryRange(DAY_SUMMARY_COLLECTION,'productionDate',month),
      queryMonth(EMPLOYEE_MONTH_COLLECTION,month),
      queryMonth(BONUS_ADJUSTMENT_COLLECTION,month),
      readState(month),
      window._getDoc(window._docRef(BONUS_MONTH_COLLECTION,month)),
      window._getDoc(window._docRef(BONUS_PRIVATE_COLLECTION,month)),
      readControl(month),
      window._getDocs(window._collection(`${BONUS_MONTH_COLLECTION}/${month}/employees`)).then(documentRows)
    ]);
    const affectedProcessIds=new Set(
      entries.filter(item=>item.recordType==='standard').map(item=>text(item.orderProcessId)).filter(Boolean)
    );
    (state?.affectedProcessIds||[]).forEach(id=>affectedProcessIds.add(text(id)));
    const totalPlans=[];
    for(const processId of affectedProcessIds){
      const [allEntries,totalSnapshot]=await Promise.all([
        window._getDocs(window._query(window._collection(ENTRY_COLLECTION),window._where('orderProcessId','==',processId))).then(documentRows),
        window._getDoc(window._docRef(TOTAL_COLLECTION,processId))
      ]);
      const remainingRows=allEntries.filter(item=>text(item.productionDate).slice(0,7)!==month
        &&item.recordType==='standard'&&item.status==='active');
      const registeredQty=remainingRows.reduce((sum,item)=>sum+Math.max(0,Math.round(number(item.quantity))),0);
      const current=totalSnapshot.exists()?{id:totalSnapshot.id,...totalSnapshot.data()}:null;
      const sample=remainingRows[0]||entries.find(item=>text(item.orderProcessId)===processId)||current||{};
      totalPlans.push({processId,registeredQty,current,sample});
    }
    const directDocuments=[
      ...(bonusMonth.exists()?[{collection:BONUS_MONTH_COLLECTION,id:month}]:[]),
      ...(privateMonth.exists()?[{collection:BONUS_PRIVATE_COLLECTION,id:month}]:[])
    ];
    return {
      month,control,state,entries,attendanceRows,daySummaries,employeeMonths,adjustments,bonusEmployees,
      directDocuments,totalPlans,affectedProcessIds:[...affectedProcessIds].filter(Boolean),
      counts:{
        entries:entries.length,attendance:attendanceRows.length,daySummaries:daySummaries.length,
        employeeMonths:employeeMonths.length,bonusAdjustments:adjustments.length,
        bonusEmployees:bonusEmployees.length,bonusMonths:directDocuments.length,totals:totalPlans.length
      }
    };
  }
  function resetDeleteItems(plan){
    const items=[];
    const add=(collection,rows)=>rows.forEach(row=>items.push({reference:window._docRef(collection,row.id),mode:'delete'}));
    add(ENTRY_COLLECTION,plan.entries);
    add(ATTENDANCE_COLLECTION,plan.attendanceRows);
    add(DAY_SUMMARY_COLLECTION,plan.daySummaries);
    add(EMPLOYEE_MONTH_COLLECTION,plan.employeeMonths);
    add(BONUS_ADJUSTMENT_COLLECTION,plan.adjustments);
    plan.bonusEmployees.forEach(row=>items.push({
      reference:window._docRef(`${BONUS_MONTH_COLLECTION}/${RESET_MONTH}/employees`,row.id),mode:'delete'
    }));
    plan.directDocuments.forEach(item=>items.push({reference:window._docRef(item.collection,item.id),mode:'delete'}));
    return items;
  }
  function resetTotalData(item,currentActor){
    const current=item.current||{};
    const sample=item.sample||{};
    const orderQty=Math.max(Math.round(number(current.orderQty)),Math.round(number(sample.orderQtySnapshot||sample.orderQty)),item.registeredQty);
    return {
      orderProcessId:item.processId,orderId:text(current.orderId||sample.orderId),
      orderNo:text(current.orderNo||sample.orderNo),productCode:text(current.productCode||sample.productCode),
      processNo:text(current.processNo||sample.processNo),orderQty,registeredQty:item.registeredQty,
      lastEntryId:'',lastMutation:'test-reset',lastDelta:item.registeredQty-Math.round(number(current.registeredQty)),
      updatedAt:currentActor.updatedAt,updatedByUid:currentActor.updatedByUid,updatedBy:currentActor.updatedBy,schemaVersion:1
    };
  }
  async function beginTestReset(plan){
    const currentActor=actor();
    await window._runTransaction(async transaction=>{
      const controlReference=window._docRef(MONTH_COLLECTION,RESET_MONTH);
      const stateReference=window._docRef(STATE_COLLECTION,RESET_MONTH);
      const snapshot=await transaction.get(controlReference);
      const current=snapshot.exists()?snapshot.data():{};
      if(snapshot.exists()&&!['open','locked','migrating'].includes(text(current.status))){
        throw new Error('Trạng thái tháng không cho phép xóa dữ liệu thử nghiệm. / 月份狀態不允許清除測試資料。');
      }
      const revision=Math.max(1,Math.max(0,Math.round(number(current.revision)))+(current.status==='migrating'?0:1));
      transaction.set(controlReference,{
        ...current,month:RESET_MONTH,status:'migrating',summaryReady:false,revision,
        entriesVersion:text(current.entriesVersion)||'0',attendanceVersion:text(current.attendanceVersion)||'0',
        summaryVersion:text(current.summaryVersion)||'0',...currentActor,schemaVersion:2
      });
      transaction.set(stateReference,{
        month:RESET_MONTH,status:'resetting',affectedProcessIds:plan.affectedProcessIds,
        sourceEntryCount:plan.entries.length,sourceAttendanceCount:plan.attendanceRows.length,
        startedAt:currentActor.updatedAt,startedByUid:currentActor.updatedByUid,
        updatedAt:currentActor.updatedAt,updatedByUid:currentActor.updatedByUid,schemaVersion:1
      });
    },{skipDataVersions:true});
  }
  async function releaseFailedReset(error){
    const currentActor=actor();
    try{
      await window._runTransaction(async transaction=>{
        const controlReference=window._docRef(MONTH_COLLECTION,RESET_MONTH);
        const stateReference=window._docRef(STATE_COLLECTION,RESET_MONTH);
        const snapshot=await transaction.get(controlReference);
        if(snapshot.exists()&&snapshot.data().status==='migrating'){
          transaction.set(controlReference,{
            ...snapshot.data(),status:'open',summaryReady:false,
            revision:Math.max(0,Math.round(number(snapshot.data().revision)))+1,...currentActor
          });
        }
        transaction.set(stateReference,{
          month:RESET_MONTH,status:'failed',lastError:text(error?.message||error).slice(0,500),
          failedAt:currentActor.updatedAt,updatedAt:currentActor.updatedAt,
          updatedByUid:currentActor.updatedByUid,schemaVersion:1
        },{merge:true});
      },{skipDataVersions:true});
    }catch(_error){ /* 下一次人工按鈕可重新嘗試，不建立自動無限重試。 */ }
  }
  async function writeResetItems(items,onProgress){
    let completed=0;
    // 一次性安全清除會跨多個集合；小批次避免每筆刪除的 Rules 驗證累加超過上限。
    for(let index=0;index<items.length;index+=RESET_WRITE_LIMIT){
      const chunk=items.slice(index,index+RESET_WRITE_LIMIT);
      const batch=window._writeBatch({skipDataVersions:true});
      chunk.forEach(item=>item.mode==='delete'?batch.delete(item.reference):batch.set(item.reference,item.data));
      await batch.commit();
      completed+=chunk.length;
      onProgress?.({completed,total:items.length});
    }
    return completed;
  }
  async function verifyTestReset(expectedTotals){
    const plan=await loadTestResetPlan();
    const remaining=plan.entries.length+plan.attendanceRows.length+plan.daySummaries.length+plan.employeeMonths.length
      +plan.adjustments.length+plan.bonusEmployees.length+plan.directDocuments.length;
    if(remaining>0){
      throw new Error(`Vẫn còn ${remaining} tài liệu thử nghiệm tháng 2026/08. / 2026/08 仍有 ${remaining} 筆測試文件。`);
    }
    for(const expected of expectedTotals){
      const snapshot=await window._getDoc(window._docRef(TOTAL_COLLECTION,expected.processId));
      const actual=snapshot.exists()?Math.round(number(snapshot.data()?.registeredQty)):0;
      if(actual!==expected.registeredQty){
        throw new Error(`Tổng số lượng công đoạn ${expected.processId} chưa khớp. / 工序 ${expected.processId} 的累計數量尚未一致。`);
      }
    }
  }
  async function clearMonthCaches(month){
    const cacheRows=await window.pcmsDataCache?.inspect?.()||[];
    const scopes=cacheRows.map(item=>text(item.scope)).filter(scope=>
      scope===`productionEmployeeMonths:${month}`
      ||scope.startsWith(`productionEntriesQuery:`)
      ||scope.startsWith(`productionAttendanceDay:${month}-`)
      ||scope.startsWith(`productionAttendanceRecord:`)&&scope.includes(`:${month}-`)
    );
    await Promise.allSettled(scopes.map(scope=>window.pcmsDataCache?.remove(scope)));
    window.PCMSProductionAttendanceStore?.resetMemory?.();
    window.PCMSProductionReportStore?.resetMemory?.();
    window.PCMSFeatures?.invalidateDataScopes?.([
      'productionEntries','productionAttendance','productionDaySummaries','productionEmployeeMonths',
      'productionMonths','productionProcessTotals','performanceBonusMonths','performanceBonusAdjustments'
    ]);
  }
  async function resetAugustTestData(options={}){
    assertAdmin();
    const initialPlan=options.plan||await loadTestResetPlan();
    await beginTestReset(initialPlan);
    try{
      // begin 後重讀，避免確認期間新增的 8 月測試資料遺漏。
      const plan=await loadTestResetPlan();
      const currentActor=actor();
      const items=resetDeleteItems(plan);
      plan.totalPlans.forEach(item=>{
        if(!item.current&&item.registeredQty===0) return;
        items.push({
          reference:window._docRef(TOTAL_COLLECTION,item.processId),mode:'set',
          data:resetTotalData(item,currentActor)
        });
      });
      const writtenCount=await writeResetItems(items,options.onProgress);
      await verifyTestReset(plan.totalPlans);
      await window._runTransaction(async transaction=>{
        const controlReference=window._docRef(MONTH_COLLECTION,RESET_MONTH);
        const stateReference=window._docRef(STATE_COLLECTION,RESET_MONTH);
        const snapshot=await transaction.get(controlReference);
        if(!snapshot.exists()||snapshot.data().status!=='migrating'){
          throw new Error('Trạng thái xóa dữ liệu thử nghiệm đã thay đổi. / 測試資料清除狀態已改變。');
        }
        transaction.set(window._newDocRef(LOG_COLLECTION),{
          permissionKey:'productionRecords',feature:'production',action:'productionSummaryMigration',status:'success',
          createdAt:currentActor.updatedAt,createdByUid:currentActor.updatedByUid,createdBy:currentActor.updatedBy,
          itemCount:writtenCount,detailCount:plan.totalPlans.length,
          note:`${RESET_MONTH} · test reset · source ${plan.entries.length+plan.attendanceRows.length}`,changes:[]
        });
        transaction.delete(stateReference);
        transaction.delete(controlReference);
      },{skipDataVersions:true});
      await clearMonthCaches(RESET_MONTH);
      return {...plan,writtenCount,cleared:true};
    }catch(error){
      await releaseFailedReset(error);
      throw error;
    }
  }

  window.PCMSProductionSummaryMigration=Object.freeze({
    RESET_MONTH,MAX_SOURCE_CHANGE_RETRIES,loadMonthSource,buildPlan,comparePlan,preparePlanForWrite,
    preflight,migrateMonth,readControl,readState,releaseMonth,loadTestResetPlan,resetAugustTestData
  });
})();
