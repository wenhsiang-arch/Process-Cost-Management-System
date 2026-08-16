// summary-store（產能摘要資料層）：只更新受影響的一天與一個員工月份，不掃描整月原始紀錄。
(function(){
  'use strict';

  const DAY_COLLECTION='productionDaySummaries';
  const MONTH_COLLECTION='productionEmployeeMonths';
  const PRODUCTION_MONTH_COLLECTION='productionMonths';
  const SCHEMA_VERSION=2;

  function text(value){ return String(value||'').trim(); }
  function number(value){ const parsed=Number(value); return Number.isFinite(parsed)?parsed:0; }
  function nonNegative(value){ return Math.max(0,number(value)); }
  function round(value,digits=6){
    const factor=10**digits;
    return Math.round((number(value)+Number.EPSILON)*factor)/factor;
  }
  function monthFromDate(value){
    const date=text(value);
    if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)){
      throw new Error('Ngày sản xuất không hợp lệ. / 生產日期不正確。');
    }
    return date.slice(0,7);
  }
  function dayKey(productionDate){ return `d${text(productionDate).slice(8,10)}`; }
  function dayId(productionDate,employeeId){ return `${text(productionDate)}__${text(employeeId)}`; }
  function employeeMonthId(month,employeeId){ return `${text(month)}__${text(employeeId)}`; }
  function isSupplement(entry){
    return entry?.recordType==='supplement'||text(entry?.processNo)==='0';
  }
  function processKey(entry){
    return [text(entry?.productCode),text(entry?.processNo),number(entry?.processSecSnapshot),number(entry?.hourlyCapacitySnapshot)].join('||');
  }
  function normalizeProcesses(rows){
    return (Array.isArray(rows)?rows:[]).map(item=>({
      key:text(item.key),productCode:text(item.productCode),processNo:text(item.processNo),
      processNameVi:text(item.processNameVi).slice(0,200),processNameZh:text(item.processNameZh).slice(0,200),
      processSecSnapshot:nonNegative(item.processSecSnapshot),hourlyCapacitySnapshot:nonNegative(item.hourlyCapacitySnapshot),
      quantity:Math.max(0,Math.round(number(item.quantity))),standardHours:round(nonNegative(item.standardHours)),
      invalidCapacityCount:Math.max(0,Math.round(number(item.invalidCapacityCount))),
      inferredHours:item.inferredHours==null?null:round(nonNegative(item.inferredHours)),
      suggestedSeconds:item.suggestedSeconds==null?null:round(nonNegative(item.suggestedSeconds),4)
    })).filter(item=>item.key&&item.quantity+item.invalidCapacityCount>0);
  }
  function actorFields(actor={}){
    return {
      updatedAt:Math.max(1,Math.round(number(actor.updatedAt)||Date.now())),
      updatedByUid:text(actor.updatedByUid),
      updatedBy:text(actor.updatedBy).slice(0,200)
    };
  }
  function calculationStatus(day){
    if(day.invalidCapacityCount>0) return 'invalid-capacity';
    if(day.attendanceHours<=0) return day.activeEntryCount>0?'missing-attendance':'empty';
    return 'ready';
  }
  function withDayCalculations(day){
    const normalized={...day};
    normalized.activeEntryCount=Math.max(0,Math.round(number(normalized.activeEntryCount)));
    normalized.activeStandardEntryCount=Math.max(0,Math.round(number(normalized.activeStandardEntryCount)));
    normalized.activeSupplementHours=round(nonNegative(normalized.activeSupplementHours));
    normalized.standardHours=round(nonNegative(normalized.standardHours));
    normalized.normalHours=round(nonNegative(normalized.normalHours),2);
    normalized.overtimeHours=round(nonNegative(normalized.overtimeHours),2);
    normalized.attendanceHours=round(normalized.normalHours+normalized.overtimeHours,2);
    normalized.effectiveHours=round(normalized.standardHours+normalized.activeSupplementHours);
    normalized.invalidCapacityCount=Math.max(0,Math.round(number(normalized.invalidCapacityCount)));
    normalized.calculationStatus=calculationStatus(normalized);
    normalized.efficiencyPercentage=normalized.calculationStatus==='ready'
      ?round((normalized.effectiveHours/normalized.attendanceHours)*100,4)
      :null;
    const availableHours=Math.max(0,normalized.attendanceHours-normalized.activeSupplementHours);
    normalized.processes=normalizeProcesses(normalized.processes).map(item=>{
      const inferredHours=normalized.calculationStatus==='ready'&&normalized.standardHours>0&&item.standardHours>0
        ?round(availableHours*item.standardHours/normalized.standardHours):null;
      return {...item,inferredHours,suggestedSeconds:inferredHours>0&&item.quantity>0
        ?round(inferredHours*3000/item.quantity,4):null};
    });
    return normalized;
  }
  function emptyDay({productionDate,employeeId,employeeName='',department='',attendance=null,actor={},complete=true}){
    const month=monthFromDate(productionDate);
    return withDayCalculations({
      summaryId:dayId(productionDate,employeeId),month,productionDate:text(productionDate),employeeId:text(employeeId),
      employeeName:text(employeeName).slice(0,100),department:text(department).slice(0,100),
      activeEntryCount:0,activeStandardEntryCount:0,activeSupplementHours:0,standardHours:0,
      normalHours:nonNegative(attendance?.normalHours),overtimeHours:nonNegative(attendance?.overtimeHours),
      invalidCapacityCount:0,processes:[],metricComplete:complete===true,revision:0,lastEntryId:'',lastMutation:'migration',
      ...actorFields(actor),schemaVersion:SCHEMA_VERSION
    });
  }
  function normalizeDay(value,identity={}){
    if(!value||Number(value.schemaVersion)!==SCHEMA_VERSION||value.metricComplete!==true) return null;
    return withDayCalculations({...value,
      productionDate:text(value.productionDate||identity.productionDate),employeeId:text(value.employeeId||identity.employeeId),
      employeeName:text(value.employeeName||identity.employeeName).slice(0,100),
      department:text(value.department||identity.department).slice(0,100)
    });
  }
  function assertDayCounters(day){
    if(day.activeEntryCount<0||day.activeStandardEntryCount<0||day.activeStandardEntryCount>day.activeEntryCount
      ||day.activeSupplementHours<0||day.standardHours<0||day.invalidCapacityCount<0){
      throw new Error('Dữ liệu tổng hợp sản xuất không hợp lệ. / 產能摘要資料不正確。');
    }
  }
  function applyEntry(current,entry,direction,actor={}){
    const step=Number(direction);
    if(step!==1&&step!==-1) throw new Error('Hướng thay đổi không hợp lệ. / 摘要異動方向不正確。');
    const base=normalizeDay(current,entry);
    if(!base){
      if(step<0) throw new Error('Thiếu tóm tắt ngày; cần hoàn tất chuyển đổi dữ liệu trước. / 缺少每日摘要，請先完成資料轉換。');
      const created=emptyDay({
        productionDate:entry.productionDate,employeeId:entry.employeeId,employeeName:entry.employeeName,
        department:entry.department,attendance:entry.attendance,actor,complete:true
      });
      return applyEntry(created,entry,step,actor);
    }
    const next={...base};
    next.activeEntryCount+=step;
    if(isSupplement(entry)){
      next.activeSupplementHours=round(next.activeSupplementHours+(step*nonNegative(entry.supplementHours)));
    }else{
      next.activeStandardEntryCount+=step;
      const quantity=nonNegative(entry.quantity);
      const capacity=number(entry.hourlyCapacitySnapshot);
      if(capacity>0) next.standardHours=round(next.standardHours+(step*(quantity/capacity)));
      else next.invalidCapacityCount+=step;
      const key=processKey(entry);
      const processes=normalizeProcesses(next.processes);
      const index=processes.findIndex(item=>item.key===key);
      const current=index>=0?processes[index]:{
        key,productCode:text(entry.productCode),processNo:text(entry.processNo),
        processNameVi:text(entry.processNameVi).slice(0,200),processNameZh:text(entry.processNameZh).slice(0,200),
        processSecSnapshot:nonNegative(entry.processSecSnapshot),hourlyCapacitySnapshot:nonNegative(entry.hourlyCapacitySnapshot),
        quantity:0,standardHours:0,invalidCapacityCount:0,inferredHours:null,suggestedSeconds:null
      };
      const changed={...current,quantity:Math.max(0,Math.round(current.quantity+(step*quantity))),
        standardHours:round(Math.max(0,current.standardHours+(capacity>0?step*(quantity/capacity):0))),
        invalidCapacityCount:Math.max(0,Math.round(current.invalidCapacityCount+(capacity>0?0:step)))};
      if(index>=0) processes[index]=changed; else processes.push(changed);
      next.processes=processes.filter(item=>item.quantity+item.invalidCapacityCount>0);
    }
    next.revision=Math.max(0,Math.round(number(base.revision)))+1;
    next.lastEntryId=text(entry.id||entry.entryId);
    next.lastMutation=step>0?'create':text(entry.mutation||'void');
    Object.assign(next,actorFields(actor),{schemaVersion:SCHEMA_VERSION,metricComplete:true});
    const calculated=withDayCalculations(next);
    assertDayCounters(calculated);
    return calculated;
  }
  function applyAttendance(current,attendance,actor={}){
    const identity=attendance||current||{};
    const base=normalizeDay(current,{
      productionDate:identity.attendanceDate||identity.productionDate,employeeId:identity.employeeId,
      employeeName:identity.employeeName,department:identity.department
    });
    if(!base) return null;
    const next={...base,
      employeeName:text(identity.employeeName||base.employeeName).slice(0,100),
      department:text(identity.department||base.department).slice(0,100),
      normalHours:attendance?nonNegative(attendance.normalHours):0,
      overtimeHours:attendance?nonNegative(attendance.overtimeHours):0,
      revision:Math.max(0,Math.round(number(base.revision)))+1,lastEntryId:'',lastMutation:attendance?'attendance':'attendance-delete',
      ...actorFields(actor),schemaVersion:SCHEMA_VERSION,metricComplete:true
    };
    return withDayCalculations(next);
  }
  function compactDay(day){
    return {
      productionDate:text(day.productionDate),attendanceHours:round(day.attendanceHours,2),
      standardHours:round(day.standardHours),supplementHours:round(day.activeSupplementHours),
      effectiveHours:round(day.effectiveHours),efficiencyPercentage:day.efficiencyPercentage,
      activeEntryCount:Math.round(number(day.activeEntryCount)),invalidCapacityCount:Math.round(number(day.invalidCapacityCount)),
      calculationStatus:text(day.calculationStatus),dayRevision:Math.round(number(day.revision)),
      processes:normalizeProcesses(day.processes)
    };
  }
  function monthTotals(days){
    const rows=Object.values(days||{});
    const totals=rows.reduce((sum,row)=>{
      sum.attendanceHours+=nonNegative(row.attendanceHours);
      sum.standardHours+=nonNegative(row.standardHours);
      sum.supplementHours+=nonNegative(row.supplementHours);
      sum.effectiveHours+=nonNegative(row.effectiveHours);
      sum.activeEntryCount+=Math.max(0,Math.round(number(row.activeEntryCount)));
      sum.invalidCapacityCount+=Math.max(0,Math.round(number(row.invalidCapacityCount)));
      if(nonNegative(row.attendanceHours)>0) sum.workedDayCount+=1;
      return sum;
    },{attendanceHours:0,standardHours:0,supplementHours:0,effectiveHours:0,activeEntryCount:0,invalidCapacityCount:0,workedDayCount:0});
    Object.keys(totals).forEach(key=>{ totals[key]=key.endsWith('Hours')?round(totals[key]):totals[key]; });
    totals.efficiencyPercentage=totals.attendanceHours>0&&totals.invalidCapacityCount===0
      ?round((totals.effectiveHours/totals.attendanceHours)*100,4):null;
    return totals;
  }
  function applyDayToMonth(current,beforeDay,afterDay,actor={},options={}){
    const day=normalizeDay(afterDay);
    if(!day) throw new Error('Tóm tắt ngày chưa hoàn chỉnh. / 每日摘要尚未完整。');
    const month=monthFromDate(day.productionDate);
    const id=employeeMonthId(month,day.employeeId);
    const days={...(current?.days||{})};
    days[dayKey(day.productionDate)]=compactDay(day);
    const totals=monthTotals(days);
    return {
      monthSummaryId:id,month,employeeId:day.employeeId,employeeName:day.employeeName,department:day.department,
      days,...totals,summaryComplete:options.complete===true||(current?.summaryComplete===true&&day.metricComplete===true),
      revision:Math.max(0,Math.round(number(current?.revision)))+1,lastDayId:day.summaryId,
      lastDayRevision:day.revision,lastMutation:text(day.lastMutation),...actorFields(actor),schemaVersion:SCHEMA_VERSION
    };
  }
  function buildEmployeeMonth({month,employeeId,employeeName='',department='',entries=[],attendanceRows=[],actor={}}){
    const attendanceByDate=new Map((attendanceRows||[]).map(row=>[text(row.attendanceDate),row]));
    const dates=new Set(attendanceByDate.keys());
    (entries||[]).forEach(entry=>{ if(entry?.status==='active') dates.add(text(entry.productionDate)); });
    const dayDocuments=[];
    [...dates].filter(date=>date.startsWith(`${month}-`)).sort().forEach(productionDate=>{
      const attendance=attendanceByDate.get(productionDate)||null;
      let day=emptyDay({productionDate,employeeId,employeeName,department,attendance,actor,complete:true});
      (entries||[]).filter(entry=>entry?.status==='active'&&text(entry.productionDate)===productionDate)
        .sort((a,b)=>number(a.createdAt)-number(b.createdAt))
        .forEach(entry=>{ day=applyEntry(day,entry,1,actor); });
      day.lastMutation='migration';
      dayDocuments.push(day);
    });
    let monthDocument=null;
    dayDocuments.forEach(day=>{
      monthDocument=applyDayToMonth(monthDocument,null,day,actor,{complete:true});
      monthDocument.lastMutation='migration';
    });
    if(monthDocument) monthDocument.summaryComplete=true;
    return {dayDocuments,monthDocument};
  }
  function dayReference(productionDate,employeeId){ return window._docRef(DAY_COLLECTION,dayId(productionDate,employeeId)); }
  function employeeMonthReference(month,employeeId){ return window._docRef(MONTH_COLLECTION,employeeMonthId(month,employeeId)); }
  function monthReference(month){ return window._docRef(PRODUCTION_MONTH_COLLECTION,text(month)); }
  async function monthVersion(month){
    const snapshot=await window._getDoc(monthReference(month));
    const data=snapshot.exists()?snapshot.data():{};
    return text(data.summaryVersion)||'0';
  }
  async function loadEmployeeMonths(month,options={}){
    const normalized=text(month);
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(normalized)) throw new Error('Tháng không hợp lệ. / 月份不正確。');
    const suppliedVersion=Object.prototype.hasOwnProperty.call(options,'version');
    const version=suppliedVersion?(text(options.version)||'0'):await monthVersion(normalized);
    const versionReadCount=suppliedVersion?0:1;
    const scope=`productionEmployeeMonths:${normalized}`;
    if(options.force!==true){
      const cached=await window.pcmsDataCache?.read(scope,version);
      if(Array.isArray(cached)){
        options.onMetrics?.({source:'indexeddb',versionReadCount,documentReadCount:0,itemCount:cached.length});
        return cached.map(item=>({...item,days:{...(item.days||{})}}));
      }
    }
    const snapshot=await window._getDocs(window._query(window._collection(MONTH_COLLECTION),window._where('month','==',normalized)));
    const rows=snapshot.docs.map(item=>({id:item.id,...item.data()}));
    await window.pcmsDataCache?.write(scope,version,rows);
    options.onMetrics?.({source:'cloud',versionReadCount,documentReadCount:snapshot.docs.length,itemCount:rows.length});
    return rows.map(item=>({...item,days:{...(item.days||{})}}));
  }
  function monthsBetween(from,to){
    const result=[];
    let [year,month]=text(from).slice(0,7).split('-').map(Number);
    const end=text(to).slice(0,7);
    while(result.length<24){
      const value=`${year}-${String(month).padStart(2,'0')}`;
      result.push(value);
      if(value===end) break;
      month+=1;
      if(month===13){ year+=1;month=1; }
    }
    return result;
  }
  function performanceRows(monthRows,from,to){
    const rows=[];
    (monthRows||[]).forEach(employee=>Object.values(employee.days||{}).forEach(day=>{
      const productionDate=text(day.productionDate);
      if(productionDate<from||productionDate>to) return;
      if(number(day.attendanceHours)<=0&&number(day.activeEntryCount)<=0) return;
      rows.push({
        productionDate,employeeId:text(employee.employeeId),employeeName:text(employee.employeeName)||'—',
        department:text(employee.department)||'—',workedHours:number(day.attendanceHours),
        standardHours:number(day.standardHours),supplementHours:number(day.supplementHours),
        percentage:day.efficiencyPercentage,status:text(day.calculationStatus)||'ready',attendanceStatus:'',invalidContexts:[],context:null
      });
    }));
    return rows;
  }
  async function loadPerformanceRange(from,to,options={}){
    const months=monthsBetween(from,to);
    const groups=await Promise.all(months.map(month=>loadEmployeeMonths(month,options)));
    return performanceRows(groups.flat(),text(from),text(to));
  }
  async function rangeReady(from,to){
    const snapshots=await Promise.all(monthsBetween(from,to).map(month=>window._getDoc(monthReference(month))));
    return snapshots.every(snapshot=>snapshot.exists()&&snapshot.data()?.summaryReady===true);
  }

  window.PCMSProductionSummaries=Object.freeze({
    SCHEMA_VERSION,DAY_COLLECTION,MONTH_COLLECTION,PRODUCTION_MONTH_COLLECTION,monthFromDate,dayKey,dayId,employeeMonthId,
    dayReference,employeeMonthReference,monthReference,
    emptyDay,normalizeDay,applyEntry,applyAttendance,compactDay,monthTotals,applyDayToMonth,buildEmployeeMonth,
    loadEmployeeMonths,performanceRows,loadPerformanceRange,rangeReady
  });
})();
