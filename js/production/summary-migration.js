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
  function writeIdentity(item={}){
    return {
      collection:text(item.collection||item.reference?.parent?.id||'unknown'),
      documentId:text(item.documentId||item.reference?.id||'unknown'),
      employeeId:text(item.employeeId||item.data?.employeeId),
      date:text(item.date||item.data?.productionDate||item.data?.month)
    };
  }
  function migrationWriteValidationError(item={}){
    const data=item.data||{};
    const identity=writeIdentity(item);
    const requiredText=(value,maximum)=>typeof value==='string'&&value.trim().length>0&&value.length<=maximum;
    const actorUid=text(window.firebaseAuthUser?.uid);
    if(!identity.collection||identity.collection==='unknown') return 'collection 無法辨識';
    if(!identity.documentId||identity.documentId==='unknown') return 'document id 無法辨識';
    if(!/^[A-Z0-9_-]{1,30}$/.test(text(data.employeeId))) return 'employeeId 格式不符合安全規則';
    if(!requiredText(data.employeeName,100)) return 'employeeName 為空白或超過 100 字';
    if(!requiredText(data.department,100)) return 'department 為空白或超過 100 字';
    if(!Number.isInteger(data.revision)||data.revision<1) return 'revision 必須為大於 0 的整數';
    if(!Number.isInteger(data.updatedAt)||data.updatedAt<=0) return 'updatedAt 必須為正整數';
    if(!actorUid||text(data.updatedByUid)!==actorUid) return 'updatedByUid 與目前登入 UID 不一致';
    if(typeof data.updatedBy!=='string'||data.updatedBy.length>200) return 'updatedBy 類型錯誤或超過 200 字';
    if(data.lastMutation!=='migration') return 'lastMutation 必須為 migration';
    if(data.schemaVersion!==2) return 'schemaVersion 必須為 2';
    if(identity.collection===DAY_SUMMARY_COLLECTION){
      if(data.summaryId!==identity.documentId||data.summaryId!==`${data.productionDate}__${data.employeeId}`) return 'summaryId 與文件 ID／日期／員工不一致';
      if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(text(data.productionDate))) return 'productionDate 格式不正確';
      if(data.month!==text(data.productionDate).slice(0,7)) return 'month 與 productionDate 不一致';
      if(!Number.isInteger(data.activeEntryCount)||data.activeEntryCount<0) return 'activeEntryCount 必須為非負整數';
      if(typeof data.activeSupplementHours!=='number'||data.activeSupplementHours<0) return 'activeSupplementHours 必須為非負數';
      if(typeof data.standardHours!=='number'||data.standardHours<0) return 'standardHours 必須為非負數';
      if(typeof data.attendanceHours!=='number'||data.attendanceHours<0||data.attendanceHours>24) return 'attendanceHours 必須介於 0～24';
      if(data.metricComplete!==true) return 'metricComplete 必須為 true';
      if(typeof data.lastEntryId!=='string'||data.lastEntryId.length>200) return 'lastEntryId 類型錯誤或超過 200 字';
      return '';
    }
    if(identity.collection===EMPLOYEE_MONTH_COLLECTION){
      if(data.monthSummaryId!==identity.documentId||data.monthSummaryId!==`${data.month}__${data.employeeId}`) return 'monthSummaryId 與文件 ID／月份／員工不一致';
      if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(text(data.month))) return 'month 格式不正確';
      if(!data.days||typeof data.days!=='object'||Array.isArray(data.days)) return 'days 必須為月份日期資料物件';
      if(!Number.isInteger(data.activeEntryCount)||data.activeEntryCount<0) return 'activeEntryCount 必須為非負整數';
      if(typeof data.summaryComplete!=='boolean') return 'summaryComplete 必須為布林值';
      if(!requiredText(data.lastDayId,200)) return 'lastDayId 不可空白且不得超過 200 字';
      if(!Number.isInteger(data.lastDayRevision)||data.lastDayRevision<0) return 'lastDayRevision 必須為非負整數';
      return '';
    }
    return `不支援的摘要 collection：${identity.collection}`;
  }
  function rawFirebaseError(error){
    return `${text(error?.code||error?.cause?.code||'unknown')}: ${text(error?.message||error?.cause?.message||error||'unknown')}`.slice(0,500);
  }
  function migrationDiagnosticError({batchNumber,phase,item,validationError='',firebaseError=null,originalError=null,completed=0}){
    const identity=writeIdentity(item);
    const details=[
      `batch=${batchNumber}`,`collection=${identity.collection}`,`documentId=${identity.documentId}`,
      `employeeId=${identity.employeeId||'-'}`,`date=${identity.date||'-'}`,`completedBeforeFailure=${completed}`
    ].join(', ');
    const firebaseDetail=rawFirebaseError(firebaseError||originalError);
    const originalDetail=originalError&&firebaseError&&originalError!==firebaseError
      ?`；originalBatchError=${rawFirebaseError(originalError)}`:'';
    const reason=validationError||'Firebase Security Rules 拒絕此文件';
    const vi=`Định vị ghi tóm tắt thất bại: giai đoạn=${phase}; ${details}; nguyên nhân=${reason}; Firebase=${firebaseDetail}${originalDetail}`;
    const zh=`摘要寫入定位失敗：階段=${phase}；${details}；原因=${reason}；Firebase=${firebaseDetail}${originalDetail}`;
    const diagnostic=new Error(`${vi} / ${zh}`);
    diagnostic.code=text(firebaseError?.code||originalError?.code||'permission-denied');
    diagnostic.batchNumber=batchNumber;
    diagnostic.collection=identity.collection;
    diagnostic.documentId=identity.documentId;
    diagnostic.employeeId=identity.employeeId;
    diagnostic.date=identity.date;
    diagnostic.migrationDiagnostic=true;
    return diagnostic;
  }
  async function locateFirstRejectedWrite(chunk,batchNumber,originalError,completed){
    for(let index=0;index<chunk.length;index+=1){
      const item=chunk[index];
      const batch=window._writeBatch({skipDataVersions:true});
      batch.set(item.reference,item.data);
      try{
        await batch.commit();
      }catch(error){
        throw migrationDiagnosticError({
          batchNumber,phase:`single-document-${index+1}`,item,firebaseError:error,originalError,
          completed:completed+index
        });
      }
    }
    throw migrationDiagnosticError({
      batchNumber,phase:'batch-only',
      item:{collection:'multiple-summary-documents',documentId:`batch-${batchNumber}`},
      validationError:'批次內每份文件單獨寫入均成功，拒絕原因屬批次整體限制',
      originalError,completed:completed+chunk.length
    });
  }
  async function writeChunks(items,onProgress){
    let completed=0;
    for(let index=0;index<items.length;index+=WRITE_LIMIT){
      const chunk=items.slice(index,index+WRITE_LIMIT);
      const batchNumber=Math.floor(index/WRITE_LIMIT)+1;
      for(const item of chunk){
        const validationError=migrationWriteValidationError(item);
        if(validationError){
          throw migrationDiagnosticError({
            batchNumber,phase:'preflight-validation',item,validationError,completed
          });
        }
      }
      const batch=window._writeBatch({skipDataVersions:true});
      chunk.forEach(item=>batch.set(item.reference,item.data));
      try{
        await batch.commit();
      }catch(error){
        const searchable=`${text(error?.code)} ${text(error?.message)}`.toLowerCase();
        if(searchable.includes('permission-denied')||searchable.includes('insufficient permissions')){
          await locateFirstRejectedWrite(chunk,batchNumber,error,completed);
        }
        throw migrationDiagnosticError({
          batchNumber,phase:'summary-batch',
          item:{collection:'multiple-summary-documents',documentId:`batch-${batchNumber}`},
          firebaseError:error,completed
        });
      }
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
        ...plan.dayDocuments.map(data=>({
          reference:summaries.dayReference(data.productionDate,data.employeeId),data,
          collection:DAY_SUMMARY_COLLECTION,documentId:data.summaryId,
          employeeId:data.employeeId,date:data.productionDate
        })),
        ...plan.monthDocuments.map(data=>({
          reference:summaries.employeeMonthReference(data.month,data.employeeId),data,
          collection:EMPLOYEE_MONTH_COLLECTION,documentId:data.monthSummaryId,
          employeeId:data.employeeId,date:data.month
        }))
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
