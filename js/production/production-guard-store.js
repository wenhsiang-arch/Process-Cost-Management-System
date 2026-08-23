// production-guard-store（產能共用防護）：統一處理月份凍結、考勤來源版本及每日產能累計檢查。
(function(){
  'use strict';

  const MONTH_COLLECTION='productionMonths';
  const DAY_SUMMARY_COLLECTION='productionDaySummaries';

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
  function sourceVersionToken(){
    const uid=String(window.firebaseAuthUser?.uid||'').slice(0,12);
    return `${Date.now()}-${uid}-${Math.random().toString(36).slice(2,10)}`;
  }
  function monthSourceUpdateData(productionDate,field,version,updatedAt,updatedByUid,updatedBy){
    if(!['entriesVersion','attendanceVersion'].includes(field)) throw new Error('Nguồn phiên bản tháng không hợp lệ. / 月份版本來源不正確。');
    return {
      month:monthFromDate(productionDate),[field]:String(version),summaryVersion:String(version),
      revision:window._increment(1),
      updatedAt:Number(updatedAt),updatedByUid:String(updatedByUid||''),updatedBy:text(updatedBy).slice(0,200),schemaVersion:3
    };
  }
  function attendanceMonthSourceVersionData(productionDate,version,updatedAt,updatedByUid,updatedBy){
    return monthSourceUpdateData(productionDate,'attendanceVersion',version,updatedAt,updatedByUid,updatedBy);
  }
  function entriesMonthSourceVersionData(productionDate,version,updatedAt,updatedByUid,updatedBy){
    return monthSourceUpdateData(productionDate,'entriesVersion',version,updatedAt,updatedByUid,updatedBy);
  }
  // initialAttendanceId（初始化考勤識別碼）：讓安全規則證明新月份由同一交易中的第一筆有效考勤建立。
  function attendanceMonthInitializationData(productionDate,initialAttendanceId,version,updatedAt,updatedByUid,updatedBy){
    const month=monthFromDate(productionDate);
    const attendanceDocumentId=text(initialAttendanceId);
    if(attendanceDocumentId.length<1||attendanceDocumentId.length>80){
      throw new Error('Mã chấm công khởi tạo tháng không hợp lệ. / 月份初始化考勤識別碼無效。');
    }
    return {
      month,status:'open',summaryReady:true,entriesVersion:'0',attendanceVersion:String(version),summaryVersion:String(version),
      revision:1,initialAttendanceId:attendanceDocumentId,updatedAt:Number(updatedAt),updatedByUid:String(updatedByUid||''),
      updatedBy:text(updatedBy).slice(0,200),schemaVersion:3
    };
  }
  function summaryValues(snapshot){
    const data=snapshot?.exists?.()?snapshot.data():null;
    return {
      activeEntryCount:Math.max(0,Math.round(Number(data?.activeEntryCount)||0)),
      activeSupplementHours:Math.max(0,Number(data?.activeSupplementHours)||0),
      revision:Math.max(0,Math.round(Number(data?.revision)||0))
    };
  }
  function assertEditableMonthSnapshot(snapshot,options={}){
    if(!snapshot?.exists?.()){
      const productionDate=text(options.productionDate);
      if(options.allowInitialize===true&&productionDate){
        return 'initialize';
      }
      throw new Error('Tháng chưa được chuyển đổi; hãy hoàn tất xây dựng tóm tắt trước. / 月份尚未轉換，請先完成摘要重建。');
    }
    const data=snapshot.data()||{};
    const status=text(data.status);
    if(status!=='open') throw new Error('Tháng đang khóa nên không thể sửa dữ liệu nguồn. / 月份已鎖定，無法修改來源資料。');
    // summaryReady=false（摘要暫停）只停止分析與獎金；正式來源仍可寫入。
    // 來源交易會原子增加 productionMonths.revision，讓重建在 final commit 前判斷結果是否過期。
    return 'existing';
  }
  window.PCMSProductionGuards=Object.freeze({
    monthFromDate,monthReference,daySummaryReference,
    sourceVersionToken,attendanceMonthSourceVersionData,entriesMonthSourceVersionData,attendanceMonthInitializationData,
    summaryValues,assertEditableMonthSnapshot
  });
})();
