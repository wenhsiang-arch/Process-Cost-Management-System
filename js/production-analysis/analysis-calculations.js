// analysis-calculations（生產分析計算程式）：集中管理員工、工序與部門分析的純計算規則。
(function(){
  'use strict';

  const CALCULATION_VERSION='production-analysis-v1'; // CALCULATION_VERSION（計算規則版本）：匯出與交接時辨識本批公式。
  const CONFIDENCE_ANCHORS = Object.freeze([
    {hours:5,percent:58},
    {hours:10,percent:70},
    {hours:20,percent:80},
    {hours:30,percent:85},
    {hours:50,percent:93},
    {hours:100,percent:97},
    {hours:200,percent:99}
  ]); // CONFIDENCE_ANCHORS（可信度演算參考點）：表示回推秒數落在實際值正負 10% 內的模擬比例。

  function number(value){
    const result=Number(value);
    return Number.isFinite(result)?result:0;
  }

  function text(value){ return String(value??'').trim(); }
  function round(value,digits=2){
    if(!Number.isFinite(Number(value))) return null;
    const factor=10**digits;
    return Math.round(Number(value)*factor)/factor;
  }
  function ratio(numerator,denominator){
    return denominator>0?numerator/denominator*100:null;
  }
  function median(values){
    const rows=values.filter(value=>Number.isFinite(value)).slice().sort((a,b)=>a-b);
    if(!rows.length) return null;
    const middle=Math.floor(rows.length/2);
    return rows.length%2?rows[middle]:(rows[middle-1]+rows[middle])/2;
  }
  function average(values){
    const rows=values.filter(value=>Number.isFinite(value));
    return rows.length?rows.reduce((sum,value)=>sum+value,0)/rows.length:null;
  }
  function inDateRange(value,fromDate,toDate){
    const date=text(value);
    return (!fromDate||date>=fromDate)&&(!toDate||date<=toDate);
  }
  function isSupplement(entry){
    return entry?.recordType==='supplement'||text(entry?.processNo)==='0';
  }
  function processKey(entry){
    return [
      text(entry?.productCode),text(entry?.processNo),
      number(entry?.processSecSnapshot),number(entry?.hourlyCapacitySnapshot)
    ].join('||');
  }
  function dayKey(employeeId,date){ return `${text(employeeId).toUpperCase()}||${text(date)}`; }

  function standardHoursForEntry(entry){
    if(isSupplement(entry)) return 0;
    const quantity=number(entry?.quantity);
    const capacity=number(entry?.hourlyCapacitySnapshot);
    return quantity>0&&capacity>0?quantity/capacity:0;
  }

  function confidenceForHours(value){
    const hours=Math.max(0,number(value));
    const level=hours<20?'low':hours<50?'medium':'high';
    if(hours<CONFIDENCE_ANCHORS[0].hours){
      return {hours,level,percent:null,displayPercent:'<58%'};
    }
    const last=CONFIDENCE_ANCHORS[CONFIDENCE_ANCHORS.length-1];
    if(hours>=last.hours){
      return {hours,level,percent:last.percent,displayPercent:`${last.percent}%`};
    }
    for(let index=1;index<CONFIDENCE_ANCHORS.length;index+=1){
      const upper=CONFIDENCE_ANCHORS[index];
      if(hours>upper.hours) continue;
      const lower=CONFIDENCE_ANCHORS[index-1];
      const percent=lower.percent
        +(hours-lower.hours)/(upper.hours-lower.hours)*(upper.percent-lower.percent);
      return {hours,level,percent:round(percent,1),displayPercent:`${round(percent,1)}%`};
    }
    return {hours,level,percent:last.percent,displayPercent:`${last.percent}%`};
  }

  function relativeLevel(value,reference){
    if(!(value>=0)||!(reference>0)) return 'unknown';
    const comparison=value/reference;
    if(comparison<0.9) return 'low';
    if(comparison>1.1) return 'high';
    return 'middle';
  }

  function groupBy(items,keyFactory){
    const result=new Map();
    items.forEach(item=>{
      const key=keyFactory(item);
      if(!result.has(key)) result.set(key,[]);
      result.get(key).push(item);
    });
    return result;
  }

  function buildDay(rawEntries,attendance,employeeMap){
    const firstEntry=rawEntries[0]||{};
    const employeeId=text(firstEntry.employeeId||attendance?.employeeId).toUpperCase();
    const date=text(firstEntry.productionDate||attendance?.attendanceDate);
    const employee=employeeMap.get(employeeId)||{};
    const activeEntries=rawEntries.filter(entry=>entry?.status==='active');
    const supplements=activeEntries.filter(isSupplement);
    const standardEntries=activeEntries.filter(entry=>!isSupplement(entry));
    const supplementHours=supplements.reduce((sum,entry)=>sum+Math.max(0,number(entry.supplementHours)),0);
    const attendanceHours=attendance
      ? Math.max(0,number(attendance.normalHours))+Math.max(0,number(attendance.overtimeHours))
      : null;
    const standardHours=standardEntries.reduce((sum,entry)=>sum+standardHoursForEntry(entry),0);
    const invalidCapacity=standardEntries.some(entry=>number(entry.quantity)>0&&standardHoursForEntry(entry)<=0);
    const availableProductionHours=attendanceHours===null?null:Math.max(0,attendanceHours-supplementHours);
    const groupedProcesses=groupBy(standardEntries,processKey);
    const processes=[];

    groupedProcesses.forEach((entries,key)=>{
      const source=entries[0];
      const quantity=entries.reduce((sum,entry)=>sum+Math.max(0,number(entry.quantity)),0);
      const processStandardHours=entries.reduce((sum,entry)=>sum+standardHoursForEntry(entry),0);
      const canInfer=attendanceHours!==null&&attendanceHours>0&&availableProductionHours>=0
        &&standardHours>0&&processStandardHours>0&&quantity>0;
      const inferredHours=canInfer
        ? availableProductionHours*processStandardHours/standardHours
        : null;
      processes.push({
        key,
        employeeId,date,
        productCode:text(source.productCode),
        processNo:text(source.processNo),
        processNameVi:text(source.processNameVi),
        processNameZh:text(source.processNameZh),
        processSecSnapshot:number(source.processSecSnapshot),
        hourlyCapacitySnapshot:number(source.hourlyCapacitySnapshot),
        quantity,
        standardHours:processStandardHours,
        inferredHours,
        efficiency:inferredHours>0?processStandardHours/inferredHours*100:null,
        suggestedSeconds:inferredHours>0&&quantity>0?inferredHours*3000/quantity:null
      });
    });

    const employeeName=text(employee.name||attendance?.employeeName||firstEntry.employeeName);
    const department=text(attendance?.department||firstEntry.department||employee.department);
    return {
      key:dayKey(employeeId,date),employeeId,employeeName,department,date,
      entries:activeEntries,processes,attendance:attendance||null,
      attendanceHours,standardHours,supplementHours,availableProductionHours,invalidCapacity,
      dailyEfficiency:attendanceHours>0&&!invalidCapacity
        ? (standardHours+supplementHours)/attendanceHours*100
        : (attendanceHours===0&&standardHours+supplementHours===0?0:null)
    };
  }

  function employeeProcessAggregate(samples){
    const standardHours=samples.reduce((sum,item)=>sum+item.standardHours,0);
    const inferredHours=samples.reduce((sum,item)=>sum+item.inferredHours,0);
    const quantity=samples.reduce((sum,item)=>sum+item.quantity,0);
    return {
      employeeId:samples[0]?.employeeId||'',standardHours,inferredHours,quantity,
      efficiency:ratio(standardHours,inferredHours),
      suggestedSeconds:inferredHours>0&&quantity>0?inferredHours*3000/quantity:null
    };
  }

  function aggregateProcess(samples){
    const source=samples[0]||{};
    const employeeRows=[...groupBy(samples,item=>item.employeeId).values()]
      .map(employeeProcessAggregate)
      .filter(item=>item.efficiency!==null&&item.suggestedSeconds!==null);
    const totalStandardHours=samples.reduce((sum,item)=>sum+item.standardHours,0);
    const totalInferredHours=samples.reduce((sum,item)=>sum+item.inferredHours,0);
    const totalQuantity=samples.reduce((sum,item)=>sum+item.quantity,0);
    let typicalRows=employeeRows.slice();
    let method='single';
    let typicalEfficiency=null;
    let suggestedSeconds=null;

    if(employeeRows.length===1){
      typicalEfficiency=employeeRows[0].efficiency;
      suggestedSeconds=employeeRows[0].suggestedSeconds;
    }else if(employeeRows.length<10){
      method='median';
      typicalEfficiency=median(employeeRows.map(item=>item.efficiency));
      suggestedSeconds=median(employeeRows.map(item=>item.suggestedSeconds));
    }else{
      method='trimmed-middle-60';
      const sorted=employeeRows.slice().sort((a,b)=>a.efficiency-b.efficiency);
      const trimCount=Math.floor(sorted.length*0.2);
      typicalRows=sorted.slice(trimCount,sorted.length-trimCount);
      typicalEfficiency=average(typicalRows.map(item=>item.efficiency));
      suggestedSeconds=average(typicalRows.map(item=>item.suggestedSeconds));
    }
    const currentSeconds=number(source.processSecSnapshot);
    const differencePercent=currentSeconds>0&&suggestedSeconds!==null
      ? (suggestedSeconds-currentSeconds)/currentSeconds*100
      : null;
    return {
      key:source.key,
      productCode:source.productCode,processNo:source.processNo,
      processNameVi:source.processNameVi,processNameZh:source.processNameZh,
      currentSeconds,hourlyCapacitySnapshot:source.hourlyCapacitySnapshot,
      rawEfficiency:ratio(totalStandardHours,totalInferredHours),
      rawSuggestedSeconds:totalInferredHours>0&&totalQuantity>0?totalInferredHours*3000/totalQuantity:null,
      typicalEfficiency,suggestedSeconds,differencePercent,
      participantCount:employeeRows.length,
      cumulativeStandardHours:totalStandardHours,
      confidence:confidenceForHours(totalStandardHours),
      method,typicalEmployeeIds:typicalRows.map(item=>item.employeeId),
      employeeRows,sampleCount:samples.length,totalQuantity,totalInferredHours
    };
  }

  function buildDataset(input={}){
    const entries=(Array.isArray(input.entries)?input.entries:[]).filter(item=>item&&text(item.employeeId)&&text(item.productionDate));
    const attendanceRows=(Array.isArray(input.attendance)?input.attendance:[]).filter(item=>item&&text(item.employeeId)&&text(item.attendanceDate));
    const employees=Array.isArray(input.employees)?input.employees:[];
    const employeeMap=new Map(employees.map(item=>[text(item.employeeId).toUpperCase(),item]));
    const attendanceMap=new Map(attendanceRows.map(item=>[dayKey(item.employeeId,item.attendanceDate),item]));
    const entryGroups=groupBy(entries,item=>dayKey(item.employeeId,item.productionDate));
    const allKeys=new Set([...entryGroups.keys(),...attendanceMap.keys()]);
    const days=[...allKeys].map(key=>buildDay(entryGroups.get(key)||[],attendanceMap.get(key)||null,employeeMap))
      .sort((a,b)=>b.date.localeCompare(a.date)||a.employeeId.localeCompare(b.employeeId,'en',{numeric:true}));
    const processSamples=days.flatMap(day=>day.processes.filter(process=>process.inferredHours>0));
    const processStats=[...groupBy(processSamples,item=>item.key).values()].map(aggregateProcess)
      .sort((a,b)=>a.productCode.localeCompare(b.productCode,'en',{numeric:true})||a.processNo.localeCompare(b.processNo,'en',{numeric:true}));
    return {entries,attendance:attendanceRows,employees,employeeMap,days,processSamples,processStats};
  }

  function weightedDayEfficiency(days){
    const usable=days.filter(day=>day.attendanceHours>0&&!day.invalidCapacity);
    const numerator=usable.reduce((sum,day)=>sum+day.standardHours+day.supplementHours,0);
    const denominator=usable.reduce((sum,day)=>sum+day.attendanceHours,0);
    return {numerator,denominator,percentage:ratio(numerator,denominator),sampleDays:usable.length};
  }

  function employeeAnalysisRows(dataset,filters={}){
    const processStatMap=new Map(dataset.processStats.map(item=>[item.key,item]));
    const rows=[];
    dataset.days.filter(day=>inDateRange(day.date,filters.fromDate,filters.toDate)).forEach(day=>{
      const priorEmployeeDays=dataset.days.filter(item=>item.employeeId===day.employeeId&&item.date<day.date);
      const employeeHistory=weightedDayEfficiency(priorEmployeeDays);
      const visibleProcesses=day.processes.length?day.processes:[null];
      visibleProcesses.forEach(process=>{
        const priorProcessSamples=process
          ? dataset.processSamples.filter(item=>item.employeeId===day.employeeId&&item.key===process.key&&item.date<day.date)
          : [];
        const personalProcess=priorProcessSamples.length?employeeProcessAggregate(priorProcessSamples):null;
        const lineReference=process?processStatMap.get(process.key)||null:null;
        const comparisonValue=personalProcess?.efficiency??process?.efficiency??null;
        rows.push({
          id:`${day.key}||${process?.key||'none'}`,
          date:day.date,employeeId:day.employeeId,employeeName:day.employeeName,department:day.department,
          productCode:process?.productCode||'',processNo:process?.processNo||'',
          processNameVi:process?.processNameVi||'',processNameZh:process?.processNameZh||'',
          dailyEfficiency:day.dailyEfficiency,
          employeeHistoryEfficiency:employeeHistory.percentage,
          employeeHistoryDays:employeeHistory.sampleDays,
          employeeHistoryNumeratorHours:employeeHistory.numerator,
          employeeHistoryAttendanceHours:employeeHistory.denominator,
          employeeProcessHistoryEfficiency:personalProcess?.efficiency??null,
          employeeProcessHistoryHours:personalProcess?.standardHours??0,
          employeeProcessHistoryInferredHours:personalProcess?.inferredHours??0,
          currentProcessEfficiency:process?.efficiency??null,
          lineTypicalEfficiency:lineReference?.typicalEfficiency??null,
          lineRawEfficiency:lineReference?.rawEfficiency??null,
          level:relativeLevel(comparisonValue,lineReference?.typicalEfficiency),
          attendanceHours:day.attendanceHours,standardHours:day.standardHours,
          supplementHours:day.supplementHours,invalidCapacity:day.invalidCapacity,
          processStandardHours:process?.standardHours??0,
          inferredHours:process?.inferredHours??null,quantity:process?.quantity??0,
          currentSeconds:process?.processSecSnapshot??null,
          lineParticipantCount:lineReference?.participantCount??0,
          lineCumulativeStandardHours:lineReference?.cumulativeStandardHours??0,
          lineMethod:lineReference?.method||''
        });
      });
    });
    return rows;
  }

  function employeeDailyAnalysisGroups(rows){
    return [...groupBy(Array.isArray(rows)?rows:[],row=>`${row.employeeId}||${row.date}`).values()].map(items=>{
      const first=items[0]||{};
      const activityHours=number(first.standardHours)+number(first.supplementHours);
      if(first.attendanceHours!==null&&number(first.attendanceHours)<=0&&activityHours<=0) return null;
      let status='ready';
      if(first.attendanceHours===null) status='attendance-missing';
      else if(number(first.attendanceHours)<=0) status='attendance-invalid';
      else if(first.invalidCapacity) status='capacity-missing';
      else if(activityHours<=0) status='production-missing';
      else if(first.dailyEfficiency===null) status='capacity-missing';

      let comparison='unknown';
      let difference=null;
      if(status==='ready'&&first.dailyEfficiency!==null&&first.employeeHistoryEfficiency!==null){
        difference=first.dailyEfficiency-first.employeeHistoryEfficiency;
        comparison=difference<0?'below':difference>0?'above':'equal';
      }
      return {
        ...first,
        id:`${first.employeeId}||${first.date}`,
        status,comparison,difference,
        processes:items.filter(item=>item.productCode||item.processNo)
      };
    }).filter(Boolean);
  }

  function ieAnalysisRows(dataset,filters={}){
    const samples=dataset.processSamples.filter(sample=>{
      if(!inDateRange(sample.date,filters.fromDate,filters.toDate)) return false;
      if(!filters.department) return true;
      const day=dataset.days.find(item=>item.key===dayKey(sample.employeeId,sample.date));
      return day?.department===filters.department;
    });
    return [...groupBy(samples,item=>item.key).values()].map(aggregateProcess);
  }

  function departmentAnalysisRows(dataset,filters={}){
    const periodDays=dataset.days.filter(day=>inDateRange(day.date,filters.fromDate,filters.toDate));
    const departments=new Set(periodDays.map(day=>day.department||'—'));
    return [...departments].map(department=>{
      const current=periodDays.filter(day=>(day.department||'—')===department);
      const historical=dataset.days.filter(day=>(day.department||'—')===department&&(!filters.fromDate||day.date<filters.fromDate));
      const currentSummary=weightedDayEfficiency(current);
      const historicalSummary=weightedDayEfficiency(historical);
      const employeeCount=new Set(current.map(day=>day.employeeId)).size;
      return {
        department,
        efficiency:currentSummary.percentage,
        historicalEfficiency:historicalSummary.percentage,
        difference:currentSummary.percentage!==null&&historicalSummary.percentage!==null
          ? currentSummary.percentage-historicalSummary.percentage:null,
        employeeCount,
        attendanceHours:currentSummary.denominator,
        standardHours:current.reduce((sum,day)=>sum+day.standardHours,0),
        supplementHours:current.reduce((sum,day)=>sum+day.supplementHours,0),
        numeratorHours:currentSummary.numerator,
        dayCount:currentSummary.sampleDays,historicalDayCount:historicalSummary.sampleDays
      };
    }).sort((a,b)=>a.department.localeCompare(b.department,'vi'));
  }

  window.PCMSProductionAnalysisCalculations=Object.freeze({
    calculationVersion:CALCULATION_VERSION,
    confidenceAnchors:CONFIDENCE_ANCHORS,
    standardHoursForEntry,confidenceForHours,relativeLevel,processKey,
    buildDataset,employeeAnalysisRows,employeeDailyAnalysisGroups,ieAnalysisRows,departmentAnalysisRows,
    aggregateProcess,weightedDayEfficiency,round,median
  });
})();
