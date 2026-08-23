// efficiency-core（效率計算核心）：未鎖定摘要、分析、績效與獎金共用的唯一純計算規則。
(function(){
  'use strict';

  const CALCULATION_VERSION='product-master-efficiency-v1';
  const DEFAULT_WORK_SECONDS=3000;

  function number(value){
    const result=Number(value);
    return Number.isFinite(result)?result:0;
  }
  function nonNegative(value){ return Math.max(0,number(value)); }
  function round(value,digits=6){
    const scale=10**digits;
    return Math.round((number(value)+Number.EPSILON)*scale)/scale;
  }
  function validWorkSeconds(value){
    const seconds=number(value);
    return seconds>0?seconds:DEFAULT_WORK_SECONDS;
  }

  // hourlyCapacity（每小時產能）：沿用正式工作秒數除以標準秒數後四捨五入。
  function hourlyCapacity(standardSeconds,workSeconds=DEFAULT_WORK_SECONDS){
    const seconds=number(standardSeconds);
    if(seconds<=0) return 0;
    const capacity=Math.round(validWorkSeconds(workSeconds)/seconds);
    return capacity>0?capacity:0;
  }

  function standardHours(quantity,standardSeconds,workSeconds=DEFAULT_WORK_SECONDS){
    const units=nonNegative(quantity);
    const capacity=hourlyCapacity(standardSeconds,workSeconds);
    return units>0&&capacity>0?round(units/capacity):0;
  }

  function contributionForEntry(entry,resolvedProcess,workSeconds=DEFAULT_WORK_SECONDS){
    if(entry?.status&&entry.status!=='active') return {standardHours:0,quantity:0,valid:true,ignored:true};
    if(entry?.recordType==='supplement') return {
      standardHours:0,supplementHours:nonNegative(entry.supplementHours),quantity:0,valid:true
    };
    const quantity=nonNegative(entry?.quantity);
    const seconds=number(resolvedProcess?.sec);
    const capacity=hourlyCapacity(seconds,workSeconds);
    return {
      productId:String(entry?.productId||''),processId:String(entry?.processId||''),quantity,
      standardSeconds:seconds,hourlyCapacity:capacity,
      standardHours:quantity>0&&capacity>0?round(quantity/capacity):0,
      supplementHours:0,valid:quantity===0||capacity>0,
      invalidReason:quantity>0&&capacity<=0?'missing-current-process-standard':''
    };
  }

  function day(values={}){
    const contributions=Array.isArray(values.contributions)?values.contributions:[];
    const attendanceHours=round(nonNegative(values.normalHours)+nonNegative(values.overtimeHours));
    const standard=round(contributions.reduce((sum,item)=>sum+nonNegative(item.standardHours),0));
    const supplement=round(contributions.reduce((sum,item)=>sum+nonNegative(item.supplementHours),0));
    const invalidContributions=contributions.filter(item=>item.valid===false);
    const effectiveHours=round(standard+supplement);
    const calculationStatus=invalidContributions.length?'invalid-standard':attendanceHours>0?'ready':effectiveHours>0?'missing-attendance':'ready';
    return {
      attendanceHours,standardHours:standard,supplementHours:supplement,effectiveHours,
      efficiencyPercentage:calculationStatus==='ready'&&attendanceHours>0?round(effectiveHours/attendanceHours*100,4):
        (calculationStatus==='ready'&&attendanceHours===0&&effectiveHours===0?0:null),
      calculationStatus,invalidContributionCount:invalidContributions.length,
      calculationVersion:CALCULATION_VERSION
    };
  }

  function month(days){
    const source=Array.isArray(days)?days:[];
    const totals=source.reduce((result,item)=>({
      attendanceHours:result.attendanceHours+nonNegative(item.attendanceHours),
      standardHours:result.standardHours+nonNegative(item.standardHours),
      supplementHours:result.supplementHours+nonNegative(item.supplementHours),
      invalidContributionCount:result.invalidContributionCount+Math.max(0,Number(item.invalidContributionCount)||0)
    }),{attendanceHours:0,standardHours:0,supplementHours:0,invalidContributionCount:0});
    totals.attendanceHours=round(totals.attendanceHours);
    totals.standardHours=round(totals.standardHours);
    totals.supplementHours=round(totals.supplementHours);
    totals.effectiveHours=round(totals.standardHours+totals.supplementHours);
    totals.calculationStatus=totals.invalidContributionCount?'invalid-standard':totals.attendanceHours>0?'ready':totals.effectiveHours>0?'missing-attendance':'ready';
    totals.efficiencyPercentage=totals.calculationStatus==='ready'&&totals.attendanceHours>0
      ?round(totals.effectiveHours/totals.attendanceHours*100,4)
      :(totals.calculationStatus==='ready'&&totals.effectiveHours===0?0:null);
    totals.calculationVersion=CALCULATION_VERSION;
    return totals;
  }

  window.PCMSProductionEfficiencyCore=Object.freeze({
    CALCULATION_VERSION,DEFAULT_WORK_SECONDS,hourlyCapacity,standardHours,contributionForEntry,day,month,round
  });
})();
