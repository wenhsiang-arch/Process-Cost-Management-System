// production-guard-store（產能共用防護）：統一處理月份凍結、考勤來源版本及每日產能累計檢查。
(function(){
  'use strict';

  const MONTH_COLLECTION='performanceBonusMonths';
  const DAY_SUMMARY_COLLECTION='productionDaySummaries';
  const MONTH_SOURCE_VERSION_COLLECTION='productionMonthVersions';
  const LOCKED_STATUSES=new Set(['locked','exported','paid']);

  function text(value){ return String(value||'').trim(); }
  function monthFromDate(value){
    const date=text(value);
    if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)){
      throw new Error('Ngày sản xuất không hợp lệ. / 生產日期不正確。');
    }
    return date.slice(0,7);
  }
  function attendanceId(productionDate,employeeId){ return `${text(productionDate)}__${text(employeeId)}`; }
  function daySummaryId(productionDate,employeeId){ return attendanceId(productionDate,employeeId); }
  function monthReference(productionDate){ return window._docRef(MONTH_COLLECTION,monthFromDate(productionDate)); }
  function daySummaryReference(productionDate,employeeId){
    return window._docRef(DAY_SUMMARY_COLLECTION,daySummaryId(productionDate,employeeId));
  }
  function monthSourceVersionReference(productionDate){
    return window._docRef(MONTH_SOURCE_VERSION_COLLECTION,monthFromDate(productionDate));
  }
  function sourceVersionToken(){
    const uid=String(window.firebaseAuthUser?.uid||'').slice(0,12);
    return `${Date.now()}-${uid}-${Math.random().toString(36).slice(2,10)}`;
  }
  function attendanceMonthSourceVersionData(productionDate,version,updatedAt,updatedByUid){
    return {month:monthFromDate(productionDate),attendanceVersion:String(version),updatedAt:Number(updatedAt),updatedByUid:String(updatedByUid||''),schemaVersion:1};
  }
  function entriesMonthSourceVersionData(productionDate,version,updatedAt,updatedByUid){
    return {month:monthFromDate(productionDate),entriesVersion:String(version),updatedAt:Number(updatedAt),updatedByUid:String(updatedByUid||''),schemaVersion:1};
  }
  function summaryValues(snapshot){
    const data=snapshot?.exists?.()?snapshot.data():null;
    return {
      activeEntryCount:Math.max(0,Math.round(Number(data?.activeEntryCount)||0)),
      activeSupplementHours:Math.max(0,Number(data?.activeSupplementHours)||0),
      revision:Math.max(0,Math.round(Number(data?.revision)||0))
    };
  }
  function assertEditableMonthSnapshot(snapshot){
    const status=snapshot?.exists?.()?text(snapshot.data()?.status):'draft';
    if(LOCKED_STATUSES.has(status)){
      throw new Error('Tháng đã khóa, đã xuất hoặc đã phát thưởng nên không thể sửa dữ liệu nguồn. Hãy mở khóa về trạng thái đang tính thử trước. / 月份已鎖定、已匯出或已發放，不能修改來源資料；請先解鎖回試算中。');
    }
    return status;
  }
  window.PCMSProductionGuards=Object.freeze({
    monthFromDate,monthReference,daySummaryReference,monthSourceVersionReference,
    sourceVersionToken,attendanceMonthSourceVersionData,entriesMonthSourceVersionData,
    summaryValues,assertEditableMonthSnapshot
  });
})();
