// linked-summary-store（固定身分摘要）：未鎖定摘要不保存款號／工序文字或秒數，顯示時使用目前 Product Master。
(function(){
  'use strict';

  const DAY_COLLECTION='productionDaySummaries';
  const MONTH_COLLECTION='productionEmployeeMonths';
  const PRODUCTION_MONTH_COLLECTION='productionMonths';
  const PRODUCT_COLLECTION='products';
  const PRODUCT_META_PATH=['system','productsMeta'];
  const SCHEMA_VERSION=3;
  let resolverInstance=null;
  let productFreshnessToken='';
  let productFreshnessPromise=null;

  function text(value){ return String(value??'').trim(); }
  function number(value){ const parsed=Number(value);return Number.isFinite(parsed)?parsed:0; }
  function nonNegative(value){ return Math.max(0,number(value)); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function efficiency(){
    if(!window.PCMSProductionEfficiencyCore) throw new Error('Thiếu công thức hiệu suất dùng chung. / 缺少共用績效公式。');
    return window.PCMSProductionEfficiencyCore;
  }
  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }
  function workSeconds(){ return Number(window.S?.ws)||3000; }
  function monthFromDate(value){
    const date=text(value);
    if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) throw new Error('Ngày sản xuất không hợp lệ. / 生產日期不正確。');
    return date.slice(0,7);
  }
  function dayKey(date){ return `d${text(date).slice(8,10)}`; }
  function dayId(date,employeeId){ return `${text(date)}__${text(employeeId)}`; }
  function employeeMonthId(month,employeeId){ return `${text(month)}__${text(employeeId)}`; }
  function actorFields(actor={}){
    const fields={updatedAt:Math.max(1,Math.round(number(actor.updatedAt)||Date.now())),updatedByUid:text(actor.updatedByUid),updatedBy:text(actor.updatedBy).slice(0,200)};
    const operationLogId=text(actor.operationLogId);
    return operationLogId?{...fields,operationLogId}:fields;
  }
  function rawProcessKey(entry){ return `${text(entry.orderItemId)}__${text(entry.processId)}`; }
  function normalizeProcesses(rows){
    return (Array.isArray(rows)?rows:[]).map(item=>({
      key:text(item.key||`${item.orderItemId}__${item.processId}`),orderId:text(item.orderId),orderItemId:model().fixedId(item.orderItemId,'orderItem'),
      productId:model().fixedId(item.productId,'product'),processId:model().fixedId(item.processId,'process'),quantity:Math.max(0,Math.round(number(item.quantity)))
    })).filter(item=>item.key&&item.orderItemId&&item.productId&&item.processId&&item.quantity>0);
  }
  function isSupplement(entry){ return entry?.recordType==='supplement'||text(entry?.processNo)==='0'; }
  function attendanceValues(attendance={}){
    const normalHours=nonNegative(attendance.normalHours);
    const overtimeHours=nonNegative(attendance.overtimeHours);
    return {normalHours,overtimeHours,attendanceHours:efficiency().round(normalHours+overtimeHours,2)};
  }

  function emptyDay({productionDate,employeeId,employeeName='',department='',attendance=null,actor={},complete=true}){
    return {
      summaryId:dayId(productionDate,employeeId),month:monthFromDate(productionDate),productionDate:text(productionDate),employeeId:text(employeeId),
      employeeName:text(employeeName).slice(0,100),department:text(department).slice(0,100),...attendanceValues(attendance||{}),
      activeEntryCount:0,activeStandardEntryCount:0,activeSupplementHours:0,processes:[],metricComplete:complete===true,
      revision:0,lastEntryId:'',lastMutation:'migration',...actorFields(actor),schemaVersion:SCHEMA_VERSION
    };
  }
  function normalizeDay(value,identity={}){
    if(!value||Number(value.schemaVersion)!==SCHEMA_VERSION||value.metricComplete!==true) return null;
    return {...clone(value),productionDate:text(value.productionDate||identity.productionDate),employeeId:text(value.employeeId||identity.employeeId),
      employeeName:text(value.employeeName||identity.employeeName).slice(0,100),department:text(value.department||identity.department).slice(0,100),
      ...attendanceValues(value),activeEntryCount:Math.max(0,Math.round(number(value.activeEntryCount))),
      activeStandardEntryCount:Math.max(0,Math.round(number(value.activeStandardEntryCount))),
      activeSupplementHours:efficiency().round(nonNegative(value.activeSupplementHours)),processes:normalizeProcesses(value.processes)};
  }
  function assertCounters(day){
    if(day.activeEntryCount<0||day.activeStandardEntryCount<0||day.activeStandardEntryCount>day.activeEntryCount||day.activeSupplementHours<0){
      throw new Error('Dữ liệu tổng hợp sản xuất không hợp lệ. / 產能摘要資料不正確。');
    }
  }
  function applyEntry(current,entry,direction,actor={}){
    const step=Number(direction);
    if(![1,-1].includes(step)) throw new Error('Hướng thay đổi không hợp lệ. / 摘要異動方向不正確。');
    const base=normalizeDay(current,entry)||emptyDay({productionDate:entry.productionDate,employeeId:entry.employeeId,
      employeeName:entry.employeeName,department:entry.department,attendance:entry.attendance,actor,complete:true});
    if(step<0&&!current) throw new Error('Thiếu tóm tắt ngày; cần hoàn tất chuyển đổi dữ liệu trước. / 缺少每日摘要，請先完成資料轉換。');
    const next={...base,processes:normalizeProcesses(base.processes)};
    next.activeEntryCount+=step;
    if(isSupplement(entry)) next.activeSupplementHours=efficiency().round(next.activeSupplementHours+step*nonNegative(entry.supplementHours));
    else{
      next.activeStandardEntryCount+=step;
      const key=rawProcessKey(entry);
      const index=next.processes.findIndex(item=>item.key===key);
      const currentProcess=index>=0?next.processes[index]:{key,orderId:text(entry.orderId),orderItemId:entry.orderItemId,
        productId:entry.productId,processId:entry.processId,quantity:0};
      const changed={...currentProcess,quantity:Math.max(0,Math.round(currentProcess.quantity+step*nonNegative(entry.quantity)))};
      if(index>=0) next.processes[index]=changed;else next.processes.push(changed);
      next.processes=normalizeProcesses(next.processes);
    }
    Object.assign(next,{revision:Math.max(0,Math.round(number(base.revision)))+1,lastEntryId:text(entry.id||entry.entryId),
      lastMutation:step>0?'create':text(entry.mutation||'void'),metricComplete:true,schemaVersion:SCHEMA_VERSION},actorFields(actor));
    assertCounters(next);return next;
  }
  function applyAttendance(current,attendance,actor={}){
    const identity=attendance||current||{};
    const base=normalizeDay(current,{productionDate:identity.attendanceDate||identity.productionDate,employeeId:identity.employeeId,
      employeeName:identity.employeeName,department:identity.department});
    if(!base) return null;
    return {...base,employeeName:text(identity.employeeName||base.employeeName).slice(0,100),department:text(identity.department||base.department).slice(0,100),
      ...attendanceValues(attendance||{}),revision:Number(base.revision||0)+1,lastEntryId:'',lastMutation:attendance?'attendance':'attendance-delete',
      ...actorFields(actor),schemaVersion:SCHEMA_VERSION,metricComplete:true};
  }
  function compactDay(dayInput){
    const day=normalizeDay(dayInput);
    if(!day) throw new Error('Tóm tắt ngày chưa hoàn chỉnh. / 每日摘要尚未完整。');
    return {productionDate:day.productionDate,normalHours:day.normalHours,overtimeHours:day.overtimeHours,attendanceHours:day.attendanceHours,
      supplementHours:day.activeSupplementHours,activeEntryCount:day.activeEntryCount,activeStandardEntryCount:day.activeStandardEntryCount,
      processes:normalizeProcesses(day.processes),dayRevision:day.revision};
  }
  function rawMonthTotals(days){
    return Object.values(days||{}).reduce((totals,day)=>({attendanceHours:efficiency().round(totals.attendanceHours+nonNegative(day.attendanceHours),2),
      supplementHours:efficiency().round(totals.supplementHours+nonNegative(day.supplementHours)),
      activeEntryCount:totals.activeEntryCount+Math.max(0,Math.round(number(day.activeEntryCount))),
      workedDayCount:totals.workedDayCount+(number(day.attendanceHours)>0?1:0)}),
    {attendanceHours:0,supplementHours:0,activeEntryCount:0,workedDayCount:0});
  }
  function applyDayToMonth(current,beforeDay,afterDay,actor={},options={}){
    const day=normalizeDay(afterDay);
    if(!day) throw new Error('Tóm tắt ngày chưa hoàn chỉnh. / 每日摘要尚未完整。');
    const month=monthFromDate(day.productionDate);const days={...(current?.days||{})};days[dayKey(day.productionDate)]=compactDay(day);
    return {monthSummaryId:employeeMonthId(month,day.employeeId),month,employeeId:day.employeeId,employeeName:day.employeeName,
      department:day.department,days,...rawMonthTotals(days),summaryComplete:options.complete===true||current?.summaryComplete===true,
      revision:Math.max(0,Math.round(number(current?.revision)))+1,lastDayId:day.summaryId,lastDayRevision:day.revision,
      lastMutation:text(day.lastMutation),...actorFields(actor),schemaVersion:SCHEMA_VERSION};
  }
  function buildEmployeeMonth({month,employeeId,employeeName='',department='',entries=[],attendanceRows=[],actor={}}){
    const attendanceByDate=new Map((attendanceRows||[]).map(row=>[text(row.attendanceDate),row]));
    const dates=new Set(attendanceByDate.keys());(entries||[]).filter(entry=>entry?.status==='active').forEach(entry=>dates.add(text(entry.productionDate)));
    const dayDocuments=[];let monthDocument=null;
    [...dates].filter(date=>date.startsWith(`${month}-`)).sort().forEach(productionDate=>{
      let day=emptyDay({productionDate,employeeId,employeeName,department,attendance:attendanceByDate.get(productionDate),actor,complete:true});
      (entries||[]).filter(entry=>entry?.status==='active'&&text(entry.productionDate)===productionDate)
        .sort((a,b)=>number(a.createdAt)-number(b.createdAt)).forEach(entry=>{day=applyEntry(day,entry,1,actor);});
      day.lastMutation='migration';dayDocuments.push(day);monthDocument=applyDayToMonth(monthDocument,null,day,actor,{complete:true});
    });
    if(monthDocument) monthDocument.summaryComplete=true;
    return {dayDocuments,monthDocument};
  }

  async function loadProductsByIds(ids){
    const snapshots=await Promise.all(ids.map(id=>window._getDoc(window._docRef(PRODUCT_COLLECTION,id))));
    return snapshots.map((snapshot,index)=>snapshot.exists()?{productId:ids[index],...snapshot.data()}:null).filter(Boolean);
  }
  function resolver(){
    if(!resolverInstance){
      if(!window.PCMSProductResolver) throw new Error('Thiếu bộ phân giải mã hàng. / 缺少款號解析器。');
      resolverInstance=window.PCMSProductResolver.create({loadProductsByIds,efficiencyCore:efficiency(),workSeconds:workSeconds()});
    }
    return resolverInstance;
  }
  function invalidateProductResolution(){ resolverInstance?.clear?.();resolverInstance=null;productFreshnessToken=''; }
  async function ensureProductFreshness(){
    if(productFreshnessPromise) return productFreshnessPromise;
    productFreshnessPromise=(async()=>{
      const snapshot=await window._getDoc(window._docRef(...PRODUCT_META_PATH));
      const data=snapshot.exists()?snapshot.data():{};
      const token=`${Number(data.updatedAt)||0}|${text(data.lastProductId)}|${Number(data.lastRevision)||0}`;
      if(productFreshnessToken&&productFreshnessToken!==token){resolverInstance?.clear?.();resolverInstance=null;}
      productFreshnessToken=token;return token;
    })().finally(()=>{productFreshnessPromise=null;});
    return productFreshnessPromise;
  }
  async function resolveEmployeeMonths(monthRows){
    await ensureProductFreshness();
    const references=[];
    (monthRows||[]).forEach(employee=>Object.values(employee.days||{}).forEach(day=>normalizeProcesses(day.processes).forEach(process=>references.push(process))));
    const resolution=references.length?await resolver().resolve(references):{rows:[],exceptions:[]};
    const resolvedMap=new Map(resolution.rows.map(row=>[`${row.source.productId}__${row.source.processId}`,row]));
    const result=(monthRows||[]).map(employee=>{
      const days={};
      Object.entries(employee.days||{}).forEach(([key,rawDay])=>{
        const processes=normalizeProcesses(rawDay.processes).map(process=>{
          const resolved=resolvedMap.get(`${process.productId}__${process.processId}`);
          if(!resolved) return {...process,valid:false,standardHours:0};
          const display=resolved.display;
          return {...process,valid:true,productCode:display.productCode,processNo:display.processNo,processSortOrder:display.processSortOrder,
            processCategory:display.processCategory,processNameVi:display.processNameVi,processNameZh:display.processNameZh,
            processSeconds:display.processSeconds,hourlyCapacity:display.hourlyCapacity,
            standardHours:efficiency().standardHours(process.quantity,display.processSeconds,workSeconds())};
        });
        const contributions=processes.map(process=>({standardHours:process.standardHours,quantity:process.quantity,valid:process.valid}))
          .concat([{supplementHours:nonNegative(rawDay.supplementHours),standardHours:0,quantity:0,valid:true}]);
        const calculated=efficiency().day({normalHours:rawDay.normalHours,overtimeHours:rawDay.overtimeHours,contributions});
        const availableHours=Math.max(0,calculated.attendanceHours-calculated.supplementHours);
        days[key]={...clone(rawDay),...calculated,activeSupplementHours:calculated.supplementHours,processes:processes.map(process=>{
          const inferredHours=calculated.calculationStatus==='ready'&&calculated.standardHours>0&&process.standardHours>0
            ?efficiency().round(availableHours*process.standardHours/calculated.standardHours):null;
          return {...process,inferredHours,suggestedSeconds:inferredHours>0&&process.quantity>0
            ?efficiency().round(inferredHours*3000/process.quantity,4):null};
        })};
      });
      const monthCalculation=efficiency().month(Object.values(days));
      return {...clone(employee),days,...monthCalculation,summaryComplete:employee.summaryComplete===true,schemaVersion:SCHEMA_VERSION,
        resolutionExceptionCount:Object.values(days).reduce((sum,day)=>sum+Number(day.invalidContributionCount||0),0)};
    });
    return {rows:result,exceptions:clone(resolution.exceptions)};
  }

  function dayReference(date,employeeId){ return window._docRef(DAY_COLLECTION,dayId(date,employeeId)); }
  function employeeMonthReference(month,employeeId){ return window._docRef(MONTH_COLLECTION,employeeMonthId(month,employeeId)); }
  function monthReference(month){ return window._docRef(PRODUCTION_MONTH_COLLECTION,text(month)); }
  async function monthVersion(month){
    const snapshot=await window._getDoc(monthReference(month));return snapshot.exists()?text(snapshot.data()?.summaryVersion)||'0':'0';
  }
  async function loadRawEmployeeMonths(month,options={}){
    const normalized=text(month);if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(normalized)) throw new Error('Tháng không hợp lệ. / 月份不正確。');
    const supplied=Object.hasOwn(options,'version');const version=supplied?text(options.version)||'0':await monthVersion(normalized);
    const scope=`productionEmployeeMonths:${normalized}`;
    if(options.force!==true){
      const cached=await window.pcmsDataCache?.read(scope,version);
      if(Array.isArray(cached)){
        options.onMetrics?.(Object.freeze({source:'indexeddb',versionReadCount:supplied?0:1,documentReadCount:0}));
        return clone(cached);
      }
    }
    const snapshot=await window._getDocs(window._query(window._collection(MONTH_COLLECTION),window._where('month','==',normalized)));
    const rows=snapshot.docs.map(item=>({id:item.id,...item.data()})).filter(item=>Number(item.schemaVersion)===SCHEMA_VERSION);
    await window.pcmsDataCache?.write(scope,version,rows);
    options.onMetrics?.(Object.freeze({source:'cloud',versionReadCount:supplied?0:1,documentReadCount:snapshot.docs.length}));
    return clone(rows);
  }
  async function loadEmployeeMonths(month,options={}){
    const raw=await loadRawEmployeeMonths(month,options);if(options.raw===true) return raw;
    return (await resolveEmployeeMonths(raw)).rows;
  }
  function monthsBetween(from,to){
    const result=[];let [year,month]=text(from).slice(0,7).split('-').map(Number);const end=text(to).slice(0,7);
    while(result.length<24){const value=`${year}-${String(month).padStart(2,'0')}`;result.push(value);if(value===end) break;month+=1;if(month===13){year+=1;month=1;}}
    return result;
  }
  function performanceRows(monthRows,from,to){
    return (monthRows||[]).flatMap(employee=>Object.values(employee.days||{}).filter(day=>day.productionDate>=from&&day.productionDate<=to
      &&(number(day.attendanceHours)>0||number(day.activeEntryCount)>0)).map(day=>({productionDate:day.productionDate,employeeId:employee.employeeId,
      employeeName:employee.employeeName||'—',department:employee.department||'—',workedHours:number(day.attendanceHours),
      standardHours:number(day.standardHours),supplementHours:number(day.supplementHours),percentage:day.efficiencyPercentage,
      status:day.calculationStatus||'ready',attendanceStatus:'',invalidContexts:[],context:null})));
  }
  async function loadPerformanceRange(from,to,options={}){
    const groups=await Promise.all(monthsBetween(from,to).map(month=>loadEmployeeMonths(month,options)));
    return performanceRows(groups.flat(),text(from),text(to));
  }
  async function rangeReady(from,to){
    const snapshots=await Promise.all(monthsBetween(from,to).map(month=>window._getDoc(monthReference(month))));
    return snapshots.every(snapshot=>snapshot.exists()&&snapshot.data()?.summaryReady===true&&Number(snapshot.data()?.schemaVersion)===SCHEMA_VERSION);
  }
  function monthSourceVersionData(month,entryId,actor={},current={}){
    const token=`${Math.max(1,Math.round(number(actor.updatedAt)||Date.now()))}-${text(entryId).slice(0,80)}`;
    const data={month:text(month),status:text(current.status)||'open',summaryReady:true,
      entriesVersion:token,attendanceVersion:text(current.attendanceVersion)||'0',summaryVersion:token,
      revision:Math.max(0,Math.round(number(current.revision)))+1,updatedAt:Number(actor.updatedAt)||Date.now(),
      updatedByUid:text(actor.updatedByUid),updatedBy:text(actor.updatedBy).slice(0,200),schemaVersion:SCHEMA_VERSION};
    const operationLogId=text(actor.operationLogId);
    return operationLogId?{...data,operationLogId}:data;
  }

  window.document?.addEventListener?.('pcms:productmasterchange',invalidateProductResolution);
  window.PCMSProductionSummaries=Object.freeze({SCHEMA_VERSION,DAY_COLLECTION,MONTH_COLLECTION,PRODUCTION_MONTH_COLLECTION,
    monthFromDate,dayKey,dayId,employeeMonthId,dayReference,employeeMonthReference,monthReference,emptyDay,normalizeDay,applyEntry,
    applyAttendance,compactDay,applyDayToMonth,buildEmployeeMonth,resolveEmployeeMonths,invalidateProductResolution,
    loadRawEmployeeMonths,loadEmployeeMonths,performanceRows,loadPerformanceRange,rangeReady,monthSourceVersionData});
})();
