// analysis-calculations（生產分析計算程式）：集中管理員工、工序與部門分析的純計算規則。
(function(){
  'use strict';

  const CALCULATION_VERSION='production-analysis-v1'; // CALCULATION_VERSION（計算規則版本）：匯出與交接時辨識本批公式。
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
    return [text(entry?.productId),text(entry?.processId)].join('||');
  }
  // ieProcessKey（工序分析身分）：款號或工序顯示內容變更後仍沿用固定識別碼。
  function ieProcessKey(entry){
    return [text(entry?.productId),text(entry?.processId)].join('||');
  }
  function dayKey(employeeId,date){ return `${text(employeeId).toUpperCase()}||${text(date)}`; }

  function standardHoursForEntry(entry){
    if(isSupplement(entry)) return 0;
    const quantity=number(entry?.quantity);
    const capacity=number(entry?.hourlyCapacity);
    return quantity>0&&capacity>0?quantity/capacity:0;
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
        productId:text(source.productId),processId:text(source.processId),
        productCode:text(source.productCode),
        processNo:text(source.processNo),
        processNameVi:text(source.processNameVi),
        processNameZh:text(source.processNameZh),
        processSeconds:number(source.processSeconds),
        hourlyCapacity:number(source.hourlyCapacity),
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
    let standardHours=0;
    let inferredHours=0;
    let quantity=0;
    samples.forEach(item=>{
      standardHours+=item.standardHours;
      inferredHours+=item.inferredHours;
      quantity+=item.quantity;
    });
    return {
      employeeId:samples[0]?.employeeId||'',standardHours,inferredHours,quantity,
      efficiency:ratio(standardHours,inferredHours),
      suggestedSeconds:inferredHours>0&&quantity>0?inferredHours*3000/quantity:null
    };
  }

  function employeeProcessAggregateFromTotals(employeeId,totals){
    if(!totals?.sampleCount) return null;
    return {
      employeeId,standardHours:totals.standardHours,inferredHours:totals.inferredHours,quantity:totals.quantity,
      efficiency:ratio(totals.standardHours,totals.inferredHours),
      suggestedSeconds:totals.inferredHours>0&&totals.quantity>0?totals.inferredHours*3000/totals.quantity:null
    };
  }

  function aggregateProcess(samples,options={}){
    const source=samples[0]||{};
    const employeeRows=[...groupBy(samples,item=>item.employeeId).values()]
      .map(employeeProcessAggregate)
      .filter(item=>item.efficiency!==null&&item.suggestedSeconds!==null);
    let totalStandardHours=0;
    let totalInferredHours=0;
    let totalQuantity=0;
    samples.forEach(item=>{
      totalStandardHours+=item.standardHours;
      totalInferredHours+=item.inferredHours;
      totalQuantity+=item.quantity;
    });
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
    const currentSeconds=options.currentSeconds===undefined
      ?number(source.processSeconds)
      :number(options.currentSeconds);
    const differencePercent=currentSeconds>0&&suggestedSeconds!==null
      ? (suggestedSeconds-currentSeconds)/currentSeconds*100
      : null;
    const differenceSeconds=suggestedSeconds===null?null:suggestedSeconds-currentSeconds;
    return {
      key:options.key||source.key,
      productId:options.productId||source.productId,processId:options.processId||source.processId,
      productCode:options.productCode||source.productCode,processNo:options.processNo||source.processNo,
      processNameVi:options.processNameVi||source.processNameVi,processNameZh:options.processNameZh||source.processNameZh,
      currentSeconds,hourlyCapacity:source.hourlyCapacity,
      rawEfficiency:ratio(totalStandardHours,totalInferredHours),
      rawSuggestedSeconds:totalInferredHours>0&&totalQuantity>0?totalInferredHours*3000/totalQuantity:null,
      typicalEfficiency,suggestedSeconds,differenceSeconds,
      absoluteDifferenceSeconds:differenceSeconds===null?0:Math.abs(differenceSeconds),differencePercent,
      participantCount:employeeRows.length,
      cumulativeStandardHours:totalStandardHours,
      method,typicalEmployeeIds:typicalRows.map(item=>item.employeeId),
      employeeRows,sampleCount:samples.length,totalQuantity,totalInferredHours
    };
  }

  function historyProcessKey(employeeId,key){ return `${text(employeeId).toUpperCase()}\u0000${text(key)}`; }
  function historyProcessDateKey(employeeId,key,date){ return `${historyProcessKey(employeeId,key)}\u0000${text(date)}`; }

  // createAnalysisIndex（建立分析索引）：把歷史累計預先算好，避免每一列再次掃描全部員工日與工序樣本。
  function createAnalysisIndex(days,processSamples){
    const dayMap=new Map(days.map(day=>[day.key,day]));
    const employeeHistoryBefore=new Map();
    const processHistoryBefore=new Map();
    const employeeGroups=groupBy(days,day=>day.employeeId);
    employeeGroups.forEach(employeeDays=>{
      const sorted=employeeDays.slice().sort((a,b)=>a.date.localeCompare(b.date));
      let numerator=0;
      let denominator=0;
      let sampleDays=0;
      sorted.forEach(day=>{
        employeeHistoryBefore.set(day.key,{numerator,denominator,percentage:ratio(numerator,denominator),sampleDays});
        if(day.attendanceHours>0&&!day.invalidCapacity){
          numerator+=day.standardHours+day.supplementHours;
          denominator+=day.attendanceHours;
          sampleDays+=1;
        }
      });
    });
    const processGroups=groupBy(processSamples,sample=>historyProcessKey(sample.employeeId,sample.key));
    processGroups.forEach(samples=>{
      const sorted=samples.slice().sort((a,b)=>a.date.localeCompare(b.date));
      const totals={standardHours:0,inferredHours:0,quantity:0,sampleCount:0};
      let index=0;
      while(index<sorted.length){
        const date=sorted[index].date;
        let end=index;
        const snapshot={...totals};
        while(end<sorted.length&&sorted[end].date===date){
          const sample=sorted[end];
          processHistoryBefore.set(historyProcessDateKey(sample.employeeId,sample.key,date),snapshot);
          end+=1;
        }
        for(let cursor=index;cursor<end;cursor+=1){
          const sample=sorted[cursor];
          totals.standardHours+=sample.standardHours;
          totals.inferredHours+=sample.inferredHours;
          totals.quantity+=sample.quantity;
          totals.sampleCount+=1;
        }
        index=end;
      }
    });
    return Object.freeze({dayMap,employeeHistoryBefore,processHistoryBefore});
  }

  function attachAnalysisIndex(dataset){
    Object.defineProperty(dataset,'analysisIndex',{
      value:createAnalysisIndex(dataset.days,dataset.processSamples),enumerable:false,writable:false
    });
    return dataset;
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
    const processStats=historicalProcessRows({processSamples},{})
      .sort((a,b)=>a.productCode.localeCompare(b.productCode,'en',{numeric:true})||a.processNo.localeCompare(b.processNo,'en',{numeric:true}));
    return attachAnalysisIndex({entries,attendance:attendanceRows,employees,employeeMap,days,processSamples,processStats});
  }

  // buildDatasetFromMonthSummaries（由員工月份摘要建立分析資料）：不再重讀原始報工與逐日考勤。
  function buildDatasetFromMonthSummaries(monthRows=[],filters={}){
    const days=[];
    (Array.isArray(monthRows)?monthRows:[]).forEach(employee=>{
      Object.values(employee?.days||{}).forEach(value=>{
        const date=text(value?.productionDate);
        if(!date) return;
        const processes=(Array.isArray(value.processes)?value.processes:[]).map(item=>({
          key:text(item.key),employeeId:text(employee.employeeId).toUpperCase(),date,
          productId:text(item.productId),processId:text(item.processId),
          productCode:text(item.productCode),processNo:text(item.processNo),
          processNameVi:text(item.processNameVi),processNameZh:text(item.processNameZh),
          processSeconds:number(item.processSeconds),hourlyCapacity:number(item.hourlyCapacity),
          quantity:number(item.quantity),standardHours:number(item.standardHours),
          inferredHours:item.inferredHours==null?null:number(item.inferredHours),
          efficiency:number(item.inferredHours)>0?number(item.standardHours)/number(item.inferredHours)*100:null,
          suggestedSeconds:item.suggestedSeconds==null?null:number(item.suggestedSeconds)
        }));
        const attendanceHours=number(value.attendanceHours);
        const standardHours=number(value.standardHours);
        const supplementHours=number(value.supplementHours);
        const invalidCapacity=number(value.invalidCapacityCount)>0;
        days.push({
          key:dayKey(employee.employeeId,date),employeeId:text(employee.employeeId).toUpperCase(),
          employeeName:text(employee.employeeName),department:text(employee.department),date,entries:[],processes,attendance:null,
          attendanceHours,standardHours,supplementHours,availableProductionHours:Math.max(0,attendanceHours-supplementHours),
          invalidCapacity,dailyEfficiency:attendanceHours>0&&!invalidCapacity?(standardHours+supplementHours)/attendanceHours*100:
            (attendanceHours===0&&standardHours+supplementHours===0?0:null)
        });
      });
    });
    days.sort((a,b)=>b.date.localeCompare(a.date)||a.employeeId.localeCompare(b.employeeId,'en',{numeric:true}));
    const samples=days.flatMap(day=>day.processes.filter(process=>process.inferredHours>0));
    const dataset=attachAnalysisIndex({entries:[],attendance:[],employees:[],employeeMap:new Map(),days,
      processSamples:samples,processStats:[]});
    dataset.processStats=historicalProcessRows(dataset,filters);
    return dataset;
  }

  function weightedDayEfficiency(days){
    let numerator=0;
    let denominator=0;
    let sampleDays=0;
    days.forEach(day=>{
      if(!(day.attendanceHours>0)||day.invalidCapacity) return;
      numerator+=day.standardHours+day.supplementHours;
      denominator+=day.attendanceHours;
      sampleDays+=1;
    });
    return {numerator,denominator,percentage:ratio(numerator,denominator),sampleDays};
  }

  function employeeAnalysisRows(dataset,filters={}){
    const processStatMap=new Map(dataset.processStats.map(item=>[item.key,item]));
    const rows=[];
    dataset.days.filter(day=>inDateRange(day.date,filters.fromDate,filters.toDate)).forEach(day=>{
      const employeeHistory=dataset.analysisIndex?.employeeHistoryBefore.get(day.key)
        ||{numerator:0,denominator:0,percentage:null,sampleDays:0};
      const visibleProcesses=day.processes.length?day.processes:[null];
      visibleProcesses.forEach(process=>{
        const processTotals=process
          ? dataset.analysisIndex?.processHistoryBefore.get(historyProcessDateKey(day.employeeId,process.key,day.date))
          : null;
        const personalProcess=process?employeeProcessAggregateFromTotals(day.employeeId,processTotals):null;
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
          currentSeconds:process?.processSeconds??null,
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

  // historicalProcessRows（歷史工序統計）：保留原快照版本分組，供員工歷史效率使用。
  function historicalProcessRows(dataset,filters={}){
    const samples=(dataset?.processSamples||[]).filter(sample=>{
      if(!inDateRange(sample.date,filters.fromDate,filters.toDate)) return false;
      if(!filters.department) return true;
      const day=dataset.analysisIndex?.dayMap.get(dayKey(sample.employeeId,sample.date));
      return day?.department===filters.department;
    });
    return [...groupBy(samples,item=>item.key).values()].map(aggregateProcess);
  }

  // ieAnalysisRows（目前工序分析）：只接受與目前正式秒數相同的樣本，且不以每小時產能快照拆分版本。
  function ieAnalysisRows(dataset,filters={},currentStandards=new Map()){
    const standards=currentStandards instanceof Map
      ?currentStandards
      :new Map(Object.entries(currentStandards||{}));
    if(!standards.size) return [];
    const grouped=new Map();
    (dataset?.processSamples||[]).forEach(sample=>{
      if(!inDateRange(sample.date,filters.fromDate,filters.toDate)) return;
      if(filters.department){
        const day=dataset.analysisIndex?.dayMap.get(dayKey(sample.employeeId,sample.date));
        if(day?.department!==filters.department) return;
      }
      const identity=ieProcessKey(sample);
      const standard=standards.get(identity);
      const currentSeconds=number(standard?.processSeconds);
      if(standard?.active===false||!(currentSeconds>0)||number(sample.processSeconds)!==currentSeconds) return;
      if(!grouped.has(identity)) grouped.set(identity,[]);
      grouped.get(identity).push(sample);
    });
    return [...grouped.entries()].map(([identity,samples])=>{
      const standard=standards.get(identity)||{};
      return aggregateProcess(samples,{
        key:identity,
        productId:text(standard.productId)||text(samples[0]?.productId),
        processId:text(standard.processId)||text(samples[0]?.processId),
        productCode:text(standard.productCode)||text(samples[0]?.productCode),
        processNo:text(standard.processNo)||text(samples[0]?.processNo),
        processNameVi:text(standard.processNameVi)||text(samples[0]?.processNameVi),
        processNameZh:text(standard.processNameZh)||text(samples[0]?.processNameZh),
        currentSeconds:number(standard.processSeconds)
      });
    });
  }

  function departmentAnalysisRows(dataset,filters={}){
    const periodDays=dataset.days.filter(day=>inDateRange(day.date,filters.fromDate,filters.toDate));
    const currentGroups=groupBy(periodDays,day=>day.department||'—');
    const historicalGroups=groupBy(
      filters.fromDate?dataset.days.filter(day=>day.date<filters.fromDate):[],day=>day.department||'—'
    );
    return [...currentGroups.entries()].map(([department,current])=>{
      const historical=historicalGroups.get(department)||[];
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
    standardHoursForEntry,relativeLevel,processKey,ieProcessKey,
    buildDataset,buildDatasetFromMonthSummaries,employeeAnalysisRows,employeeDailyAnalysisGroups,ieAnalysisRows,departmentAnalysisRows,
    aggregateProcess,weightedDayEfficiency,round,median
  });
})();
