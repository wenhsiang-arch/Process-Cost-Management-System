// bonus-calculations（績效獎金計算）：只處理固定規則與金額，不讀寫畫面或雲端資料。
(function(){
  'use strict';

  const BASE_EFFICIENCY=80;
  const MIN_ATTENDANCE_HOURS=8;
  const DEFAULT_SETTINGS=Object.freeze({
    unitPrice:400,
    companyShare:50,
    efficiencyCap:120,
    baseEfficiency:BASE_EFFICIENCY,
    minAttendanceHours:MIN_ATTENDANCE_HOURS
  });

  function finite(value,fallback=0){
    const number=Number(value);
    return Number.isFinite(number)?number:fallback;
  }
  function integerMoney(value){ return Math.max(0,Math.round(finite(value))); }
  function normalizeSettings(input={}){
    const unitPrice=Math.round(finite(input.unitPrice,DEFAULT_SETTINGS.unitPrice));
    const companyShare=finite(input.companyShare,DEFAULT_SETTINGS.companyShare);
    const efficiencyCap=Math.floor(finite(input.efficiencyCap,DEFAULT_SETTINGS.efficiencyCap));
    if(unitPrice<=0) throw new Error('Đơn giá thưởng phải lớn hơn 0. / 獎金單價必須大於0。');
    if(companyShare<0||companyShare>100) throw new Error('Tỷ lệ công ty phải từ 0 đến 100%. / 公司分成必須介於0%至100%。');
    if(efficiencyCap<BASE_EFFICIENCY||efficiencyCap>1000){
      throw new Error('Giới hạn hiệu suất phải từ 80% đến 1000%. / 效率上限必須介於80%至1000%。');
    }
    return {
      unitPrice,
      companyShare:Number(companyShare.toFixed(2)),
      employeeShare:Number((100-companyShare).toFixed(2)),
      efficiencyCap,
      baseEfficiency:BASE_EFFICIENCY,
      minAttendanceHours:MIN_ATTENDANCE_HOURS
    };
  }
  function wholeEfficiency(value){ return Math.max(0,Math.floor(finite(value))); }
  function calculateDay(row,settingsInput={}){
    const settings=normalizeSettings(settingsInput);
    const attendanceHours=Math.max(0,finite(row?.workedHours??row?.attendanceHours));
    const actualEfficiency=finite(row?.percentage??row?.actualEfficiency,0);
    const companyEfficiency=wholeEfficiency(actualEfficiency);
    const rewardEfficiency=Math.min(companyEfficiency,settings.efficiencyCap);
    const rewardPoints=attendanceHours>=MIN_ATTENDANCE_HOURS
      ?Math.max(0,rewardEfficiency-BASE_EFFICIENCY)
      :0;
    const bonus=integerMoney(rewardPoints*settings.unitPrice*attendanceHours*(settings.employeeShare/100));
    const companyPoints=companyEfficiency-BASE_EFFICIENCY;
    const grossExtra=companyPoints>0
      ?integerMoney(companyPoints*settings.unitPrice*attendanceHours)
      :0;
    const efficiencyLoss=companyPoints<0
      ?integerMoney(Math.abs(companyPoints)*settings.unitPrice*attendanceHours)
      :0;
    return {
      date:String(row?.productionDate||row?.date||''),
      attendanceHours:Number(attendanceHours.toFixed(2)),
      actualEfficiency:Number(actualEfficiency.toFixed(2)),
      companyEfficiency,
      rewardEfficiency,
      rewardPoints,
      bonus,
      grossExtra,
      efficiencyLoss,
      qualifies:attendanceHours>=MIN_ATTENDANCE_HOURS&&rewardPoints>0
    };
  }
  function calculateEmployee(employee,settings,adjustmentInput=0){
    const days=(employee?.days||[]).map(day=>calculateDay(day,settings)).sort((a,b)=>a.date.localeCompare(b.date));
    const baseBonus=days.reduce((sum,day)=>sum+day.bonus,0);
    const requestedAdjustment=Math.round(finite(adjustmentInput));
    const adjustmentAmount=Math.max(-baseBonus,requestedAdjustment);
    return {
      employeeId:String(employee?.employeeId||''),
      employeeName:String(employee?.employeeName||'—'),
      department:String(employee?.department||'—'),
      days,
      qualifyingDays:days.filter(day=>day.qualifies).length,
      calculatedHours:Number(days.filter(day=>day.qualifies).reduce((sum,day)=>sum+day.attendanceHours,0).toFixed(2)),
      baseBonus,
      adjustmentAmount,
      finalBonus:integerMoney(baseBonus+adjustmentAmount),
      grossExtra:days.reduce((sum,day)=>sum+day.grossExtra,0),
      efficiencyLoss:days.reduce((sum,day)=>sum+day.efficiencyLoss,0)
    };
  }
  function calculateMonth(rows,settingsInput={},adjustments=new Map()){
    const settings=normalizeSettings(settingsInput);
    const groups=new Map();
    (Array.isArray(rows)?rows:[]).forEach(row=>{
      const employeeId=String(row?.employeeId||'').trim();
      const date=String(row?.productionDate||'').trim();
      if(!employeeId||!date) return;
      if(!groups.has(employeeId)) groups.set(employeeId,{
        employeeId,
        employeeName:String(row.employeeName||'—'),
        department:String(row.department||'—'),
        days:[]
      });
      groups.get(employeeId).days.push(row);
    });
    const employees=[...groups.values()].map(employee=>calculateEmployee(
      employee,settings,adjustments instanceof Map?adjustments.get(employee.employeeId):adjustments?.[employee.employeeId]
    )).sort((a,b)=>a.employeeId.localeCompare(b.employeeId,'en',{numeric:true,sensitivity:'base'}));
    const totals=employees.reduce((sum,employee)=>({
      baseBonus:sum.baseBonus+employee.baseBonus,
      adjustment:sum.adjustment+employee.adjustmentAmount,
      finalBonus:sum.finalBonus+employee.finalBonus,
      grossExtra:sum.grossExtra+employee.grossExtra,
      efficiencyLoss:sum.efficiencyLoss+employee.efficiencyLoss,
      employeeDays:sum.employeeDays+employee.days.length
    }),{baseBonus:0,adjustment:0,finalBonus:0,grossExtra:0,efficiencyLoss:0,employeeDays:0});
    return {
      settings,
      employees,
      totals:{...totals,companyNet:Math.round(totals.grossExtra-totals.finalBonus-totals.efficiencyLoss)}
    };
  }
  function referenceRows(settingsInput={}){
    const settings=normalizeSettings(settingsInput);
    const rows=[];
    for(let efficiency=BASE_EFFICIENCY;efficiency<=settings.efficiencyCap;efficiency+=1){
      rows.push({
        efficiency,
        hours8:calculateDay({workedHours:8,percentage:efficiency},settings).bonus,
        hours115:calculateDay({workedHours:11.5,percentage:efficiency},settings).bonus
      });
    }
    return rows;
  }

  window.PCMSPerformanceBonusCalculations=Object.freeze({
    BASE_EFFICIENCY,MIN_ATTENDANCE_HOURS,DEFAULT_SETTINGS,
    normalizeSettings,wholeEfficiency,calculateDay,calculateEmployee,calculateMonth,referenceRows,integerMoney
  });
})();
