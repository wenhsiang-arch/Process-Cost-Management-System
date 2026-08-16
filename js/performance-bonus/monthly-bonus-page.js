// monthly-bonus-page（月績效獎金頁）：開頁核對並試算公開員工結果，不讀取保密參數。
(function(){
  'use strict';

  const state={initialized:false,request:0,month:'',metadata:null,employees:[],reference:null};

  function el(id){ return document.getElementById(id); }
  function ui(){ return window.PCMSUIComponents; }
  function store(){ return window.PCMSPerformanceBonusStore; }
  function money(value){ return Math.round(Number(value)||0).toLocaleString('vi-VN'); }
  function statusPair(status){
    return ({
      draft:{vi:'Đang thử tính',zh:'試算中'},
      locked:{vi:'Đã khóa',zh:'已鎖定'},
      exported:{vi:'Đã xuất',zh:'已匯出'},
      paid:{vi:'Đã phát',zh:'已發放'}
    })[status]||{vi:'Chưa có dữ liệu',zh:'尚無資料'};
  }
  function errorDetails(error){
    const code=String(error?.code||error?.cause?.code||'unknown').trim()||'unknown';
    const message=String(error?.message||error?.cause?.message||error||'Không có chi tiết / 無詳細訊息').trim().slice(0,1000);
    return {code,message};
  }
  function errorReason(details){
    const parsed=window.PCMSUIText.parseLegacyPair(details.message);
    if(parsed) return parsed;
    const searchable=`${details.code} ${details.message}`.toLowerCase();
    if(searchable.includes('permission-denied')||searchable.includes('insufficient permissions')){
      return {vi:'Quyền tài khoản hoặc quy tắc bảo mật đã từ chối thao tác.',zh:'帳號權限或安全規則拒絕了這次操作。'};
    }
    if(searchable.includes('1000 expressions')||searchable.includes('resource-exhausted')){
      return {vi:'Quy tắc bảo mật đã vượt giới hạn xử lý.',zh:'安全規則超過運算限制。'};
    }
    if(searchable.includes('requires an index')){
      return {vi:'Truy vấn đang thiếu chỉ mục Firestore cần thiết.',zh:'查詢缺少必要的 Firestore 索引。'};
    }
    if(searchable.includes('aborted')||searchable.includes('transaction')){
      return {vi:'Giao dịch bị xung đột hoặc trạng thái tháng đã thay đổi.',zh:'交易發生衝突，或月份狀態已經改變。'};
    }
    if(searchable.includes('unavailable')||searchable.includes('network')||searchable.includes('offline')){
      return {vi:'Không thể kết nối ổn định với Firebase.',zh:'目前無法穩定連線至 Firebase。'};
    }
    if(searchable.includes('not-found')){
      return {vi:'Không tìm thấy dữ liệu cần thiết để hoàn tất thao tác.',zh:'找不到完成操作所需的資料。'};
    }
    return {vi:'Hệ thống đã trả về lỗi chưa được phân loại; xem chi tiết bên dưới.',zh:'系統回傳尚未分類的錯誤，請查看下方詳細訊息。'};
  }
  function showError(error,stage={vi:'Thao tác thưởng tháng',zh:'月績效操作'}){
    const details=errorDetails(error);
    const reason=errorReason(details);
    console.error(`[月績效] ${stage.zh}失敗`,error);
    const body=ui().createLanguageSections({
      vi:`Giai đoạn: ${stage.vi}\nNguyên nhân: ${reason.vi}\nMã lỗi: ${details.code}\nChi tiết: ${details.message}`,
      zh:`發生階段：${stage.zh}\n原因：${reason.zh}\n錯誤碼：${details.code}\n詳細訊息：${details.message}`
    });
    body.querySelectorAll('.ui-language-section').forEach(section=>{
      section.style.whiteSpace='pre-wrap';
      section.style.overflowWrap='anywhere';
    });
    return ui().alertDialog({
      kind:'danger',title:{vi:'Không thể hoàn tất thao tác',zh:'無法完成操作'},body,size:'wide'
    });
  }
  function renderShell(){
    const root=el('performance-bonus-monthly-root');
    if(!root||root.dataset.ready==='true') return;
    root.dataset.ready='true';
    root.innerHTML=`
      <div class="performance-bonus-page ui-work-panel">
        <section class="performance-bonus-monthly-panel ui-operation-panel">
          <div class="performance-bonus-month-command ui-command-row">
            <label class="performance-bonus-field"><span class="ui-dual-copy"><strong>Tháng thưởng</strong><span>獎金月份</span></span><input type="month" id="performance-bonus-month"></label>
            <div class="performance-bonus-month-status"><span class="ui-dual-copy"><strong>Trạng thái</strong><span>結算狀態</span></span><span id="performance-bonus-status"><span class="ui-dual-copy"><strong>—</strong><span>—</span></span></span></div>
            <button type="button" class="ui-button" id="performance-bonus-reference"><i class="ti ti-table"></i><span class="ui-dual-copy"><strong>Bảng đối chiếu</strong><span>獎金對照表</span></span></button>
            <button type="button" class="ui-button" id="performance-bonus-migrate" hidden><i class="ti ti-database-import"></i><span class="ui-dual-copy"><strong>Tạo tóm tắt tháng</strong><span>建立月份摘要</span></span></button>
            <button type="button" class="ui-button is-primary" id="performance-bonus-export"><i class="ti ti-file-spreadsheet"></i><span class="ui-dual-copy"><strong>Khóa và xuất Excel</strong><span>鎖定並匯出 Excel</span></span></button>
            <button type="button" class="ui-button" id="performance-bonus-paid" hidden><i class="ti ti-cash-banknote"></i><span class="ui-dual-copy"><strong>Đánh dấu đã phát</strong><span>標記已發放</span></span></button>
            <button type="button" class="ui-button is-danger" id="performance-bonus-unlock" hidden><i class="ti ti-lock-open"></i><span class="ui-dual-copy"><strong>Mở khóa tháng</strong><span>解除月份鎖定</span></span></button>
          </div>
          <div class="ui-notice" id="performance-bonus-month-note" hidden></div>
        </section>
        <section class="performance-bonus-list-section ui-data-section">
          <div class="ui-section-header"><i class="ti ti-award"></i><span class="ui-dual-copy"><strong>Thưởng hiệu suất nhân viên trong tháng</strong><span>員工月績效獎金</span></span><span class="performance-bonus-count"><span id="performance-bonus-count">0</span> người / 人</span></div>
          <div class="ui-table-frame"><div class="ui-table-scroll" data-ui-floating-scroll="only"><table class="ui-table performance-bonus-table" id="performance-bonus-table" data-ui-table-controls="auto" data-ui-table-sort="none" data-ui-table-resizable="true" data-ui-table-sticky="original">
            <thead><tr>
              <th data-ui-table-column="employeeId"><span class="ui-dual-copy"><strong>Mã nhân viên</strong><span>員工工號</span></span></th>
              <th data-ui-table-column="employeeName"><span class="ui-dual-copy"><strong>Tên nhân viên</strong><span>員工姓名</span></span></th>
              <th data-ui-table-column="department"><span class="ui-dual-copy"><strong>Bộ phận</strong><span>部門</span></span></th>
              <th class="ui-table-number-cell" data-ui-table-column="bonus"><span class="ui-dual-copy"><strong>Tổng thưởng</strong><span>累計獎金</span></span></th>
              <th class="ui-table-center-cell" data-ui-table-column="action"><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th>
            </tr></thead><tbody id="performance-bonus-table-body"></tbody>
          </table></div></div>
          <div class="performance-bonus-empty ui-language-sections" id="performance-bonus-empty"><div class="ui-language-section is-vi">Chưa có kết quả thưởng của tháng này.</div><div class="ui-language-section is-zh">此月份尚無獎金結果。</div></div>
        </section>
      </div>`;
  }
  function createCell(row,text,className=''){
    const cell=document.createElement('td');
    cell.textContent=String(text??'');
    if(className) cell.className=className;
    row.appendChild(cell);
    return cell;
  }
  function render(){
    const status=statusPair(state.metadata?.status);
    el('performance-bonus-status').replaceChildren(window.PCMSUIText.create(status));
    const note=el('performance-bonus-month-note');
    note.hidden=false;
    const summaryReady=state.metadata?.summaryReady===true
      ||Boolean(state.metadata&&state.metadata.status!=='draft');
    note.replaceChildren(window.PCMSUIText.create(!summaryReady
      ?{vi:'Tháng này cần tạo tóm tắt một lần trước khi tính hoặc khóa thưởng.',zh:'此月份需先建立一次摘要，才能試算或鎖定獎金。'}
      :state.metadata
      ?{vi:`Cập nhật lần cuối: ${new Date(Number(state.metadata.updatedAt||state.metadata.calculatedAt)||0).toLocaleString('vi-VN')}`,zh:`最後更新：${new Date(Number(state.metadata.updatedAt||state.metadata.calculatedAt)||0).toLocaleString('zh-TW')}`}
      :{vi:'Tháng này chưa có kết quả tính thử. Hãy kiểm tra dữ liệu chấm công và sản lượng.',zh:'此月份尚無試算結果，請檢查考勤與產能資料。'}));
    const draft=state.metadata?.status==='draft';
    const migrationButton=el('performance-bonus-migrate');
    migrationButton.hidden=summaryReady||window.cu?.role!=='admin';
    const exportButton=el('performance-bonus-export');
    exportButton.disabled=!state.metadata||!summaryReady;
    exportButton.querySelector('.ui-dual-copy strong').textContent=draft?'Khóa và xuất Excel':'Xuất lại Excel';
    exportButton.querySelector('.ui-dual-copy span').textContent=draft?'鎖定並匯出 Excel':'重新匯出 Excel';
    el('performance-bonus-paid').hidden=state.metadata?.status!=='exported';
    el('performance-bonus-unlock').hidden=!state.metadata||draft||!store().canUnlock();
    const body=el('performance-bonus-table-body');
    body.replaceChildren();
    state.employees.forEach(employee=>{
      const row=document.createElement('tr');
      createCell(row,employee.employeeId);
      createCell(row,employee.employeeName);
      createCell(row,employee.department||'—');
      const bonusCell=createCell(row,'','ui-table-number-cell');
      const amount=document.createElement('button');
      amount.type='button';
      amount.className='performance-bonus-amount';
      amount.textContent=`${money(employee.finalBonus)} VND`;
      amount.title='Xem hiệu suất hằng ngày / 查看每日績效';
      amount.addEventListener('click',()=>void openDaily(employee));
      bonusCell.appendChild(amount);
      const action=createCell(row,'','ui-table-center-cell');
      if(draft){
        const adjust=document.createElement('button');
        adjust.type='button';
        adjust.className='ui-button performance-bonus-row-button';
        adjust.appendChild(window.PCMSUIText.create({vi:'Điều chỉnh',zh:'人工調整'}));
        adjust.addEventListener('click',()=>void adjustEmployee(employee));
        action.appendChild(adjust);
      }else action.textContent='—';
      body.appendChild(row);
    });
    el('performance-bonus-count').textContent=String(state.employees.length);
    el('performance-bonus-empty').hidden=state.employees.length>0;
    window.PCMSUITableControls?.refreshPage?.();
  }
  async function loadMonth(){
    state.month=el('performance-bonus-month').value||store().currentMonth();
    const request=++state.request;
    try{
      const result=await store().loadMonth(state.month,{force:true});
      if(request!==state.request) return;
      state.metadata=result.metadata;
      state.employees=result.employees.filter(item=>Number(item.finalBonus)>0);
      render();
    }catch(error){
      if(request!==state.request) return;
      state.metadata=null;
      state.employees=[];
      render();
      await showError(error,{vi:'Tải dữ liệu thưởng tháng',zh:'載入月績效資料'});
    }
  }
  async function migrateMonthSummary(){
    if(window.cu?.role!=='admin'||!window.PCMSProductionSummaryMigration) return;
    let preview;
    try{ preview=await window.PCMSProductionSummaryMigration.migrateMonth(state.month); }
    catch(error){ await showError(error,{vi:'Đọc trước dữ liệu để tạo tóm tắt',zh:'預讀月份摘要來源'}); return; }
    const confirmed=await ui().confirmDialog({
      title:{vi:'Xác nhận tạo tóm tắt tháng',zh:'確認建立月份摘要'},kind:'warning',
      body:ui().createLanguageSections({
        vi:`Hệ thống sẽ đọc ${preview.sourceEntryCount} bản ghi sản lượng và ${preview.sourceAttendanceCount} bản ghi chấm công của tháng ${state.month}, sau đó tạo tóm tắt. Dữ liệu gốc không bị sửa hoặc xóa.`,
        zh:`系統將讀取 ${state.month} 的 ${preview.sourceEntryCount} 筆產能與 ${preview.sourceAttendanceCount} 筆考勤，再建立摘要；不會修改或刪除原始資料。`
      }),
      confirmText:{vi:'Bắt đầu tạo',zh:'開始建立'},cancelText:{vi:'Hủy',zh:'取消'}
    });
    if(!confirmed) return;
    const progress=ui().progressDialog({
      title:{vi:'Đang tạo tóm tắt tháng',zh:'正在建立月份摘要'},value:0,
      text:{vi:'Đang ghi tóm tắt...',zh:'正在寫入摘要…'},
      detail:{vi:'Vui lòng giữ trang này mở.',zh:'請保持此頁開啟。'}
    });
    try{
      const result=await window.PCMSProductionSummaryMigration.migrateMonth(state.month,{
        commit:true,entries:preview.migrationSource.entries,attendanceRows:preview.migrationSource.attendanceRows,
        employees:preview.migrationEmployees,
        onProgress:item=>progress.update({value:item.total?item.completed/item.total*100:1,
          text:{vi:`Đã ghi ${item.completed}/${item.total} mục...`,zh:`已寫入 ${item.completed}/${item.total} 項…`}})
      });
      progress.complete({vi:'Đã hoàn tất tóm tắt tháng.',zh:'月份摘要已完成。'});
      ui().showToast({kind:'success',message:{vi:`Đã tạo ${result.writtenCount} mục tóm tắt.`,zh:`已建立 ${result.writtenCount} 筆摘要資料。`}});
      await loadMonth();
    }catch(error){
      progress.fail({vi:'Không thể hoàn tất tóm tắt.',zh:'無法完成月份摘要。'});
      await showError(error,{vi:'Ghi tóm tắt tháng',zh:'寫入月份摘要'});
    }
    finally{ window.setTimeout(()=>progress.close(),1000); }
  }
  function monthDates(month){
    const [year,number]=month.split('-').map(Number);
    const from=`${month}-01`;
    const last=new Date(year,number,0).getDate();
    let to=`${month}-${String(last).padStart(2,'0')}`;
    const today=typeof window.formatLocalDate==='function'?window.formatLocalDate(new Date()):new Date().toISOString().slice(0,10);
    if(month===today.slice(0,7)&&to>today) to=today;
    return {from,to};
  }
  async function openDaily(employee){
    const range=monthDates(state.month);
    window.PCMSProductionPerformance?.setPendingContext?.({employeeId:employee.employeeId,employeeName:employee.employeeName,...range});
    await window.sp?.('production-records');
  }
  async function adjustEmployee(employee){
    const value=await ui().promptDialog({
      title:{vi:'Điều chỉnh thưởng tháng',zh:'人工調整月獎金'},
      label:{vi:'Số tiền cộng hoặc trừ (VND)',zh:'增加或扣除金額（VND）'},
      type:'number',value:String(Number(employee.adjustmentAmount)||0),
      validate:(input,field)=>{
        const valid=Number.isFinite(Number(input))&&Number.isInteger(Number(input));
        field.setCustomValidity(valid?'':'Chỉ nhập số nguyên / 僅可輸入整數');
        field.reportValidity();
        return valid;
      }
    });
    if(value===null) return;
    try{
      await store().adjustEmployee(state.month,employee.employeeId,Number(value));
      ui().showToast({kind:'success',message:{vi:'Đã lưu điều chỉnh thưởng.',zh:'人工獎金調整已儲存。'}});
      await loadMonth();
    }catch(error){ await showError(error); }
  }
  function openReference(){
    const rows=Array.isArray(state.reference?.rows)?state.reference.rows:[];
    if(!rows.length){ void ui().alertDialog({kind:'warning',message:{vi:'Chưa có bảng đối chiếu.',zh:'尚無獎金對照表。'}}); return; }
    const frame=document.createElement('div');
    frame.className='ui-table-frame performance-bonus-reference-frame';
    const scroll=document.createElement('div');
    scroll.className='ui-table-scroll';
    const table=document.createElement('table');
    table.className='ui-table performance-bonus-reference-table';
    const head=document.createElement('thead');
    const headRow=document.createElement('tr');
    [
      {vi:'Hiệu suất',zh:'效率'},
      {vi:'8 giờ',zh:'8 小時'},
      {vi:'11,5 giờ',zh:'11.5 小時'}
    ].forEach(copy=>{ const th=document.createElement('th'); th.appendChild(window.PCMSUIText.create(copy)); headRow.appendChild(th); });
    head.appendChild(headRow);
    const body=document.createElement('tbody');
    rows.forEach(item=>{
      const row=document.createElement('tr');
      createCell(row,`${item.efficiency}%`);
      createCell(row,`${money(item.hours8)} VND`,'ui-table-number-cell');
      createCell(row,`${money(item.hours115)} VND`,'ui-table-number-cell');
      body.appendChild(row);
    });
    table.append(head,body); scroll.appendChild(table); frame.appendChild(scroll);
    ui().openDialog({title:{vi:'Bảng đối chiếu thưởng hiệu suất',zh:'績效獎金對照表'},body:frame,size:'large',actions:[{text:'common.close'}]});
  }
  function safeSpreadsheetValue(value){ return typeof value==='string'&&/^[=+\-@]/.test(value)?`'${value}`:value; }
  async function exportMonth(){
    if(!state.metadata) return;
    const draft=state.metadata.status==='draft';
    const confirmed=await ui().confirmDialog({
      title:draft?{vi:'Xác nhận khóa và xuất',zh:'確認鎖定並匯出'}:{vi:'Xác nhận xuất lại',zh:'確認重新匯出'},
      body:ui().createLanguageSections(draft
        ?{vi:'Sau khi chọn vị trí lưu, hệ thống sẽ khóa toàn bộ tháng rồi xuất Excel. Muốn sửa lại phải dùng quyền mở khóa.',zh:'選擇儲存位置後，系統會鎖定整個月份再匯出 Excel；如需修改，必須使用解除鎖定權限。'}
        :{vi:'Hệ thống sẽ xuất lại kết quả đã khóa của tháng này.',zh:'系統將重新匯出此月份已鎖定的結果。'}),
      confirmText:{vi:'Tiếp tục',zh:'繼續'}
    });
    if(!confirmed) return;
    const suggestedName=`Thuong_hieu_suat_${state.month}.xlsx`;
    const handle=await window.PCMSFileIO.chooseSaveHandle({
      suggestedName,types:[window.PCMSFileIO.spreadsheetFileType],
      onUnsupported:()=>ui().alertDialog({kind:'danger',message:{vi:'Trình duyệt không hỗ trợ chọn vị trí lưu. Đã dừng xuất.',zh:'瀏覽器不支援選擇儲存位置，已停止匯出。'}})
    });
    if(!handle) return;
    return ui().runActionOnce(`performanceBonus.export.${state.month}`,async()=>{
      try{
        if(draft){
          await store().lockMonth(state.month);
          const refreshed=await store().loadMonth(state.month,{force:true});
          state.metadata=refreshed.metadata;
          state.employees=refreshed.employees;
        }
        const spreadsheet=await window.PCMSFeatures.ensureSpreadsheetTool();
        const rows=state.employees.filter(item=>Number(item.finalBonus)>0).map(item=>[
          safeSpreadsheetValue(item.employeeId),safeSpreadsheetValue(item.employeeName),Math.round(Number(item.finalBonus)||0)
        ]);
        const sheet=spreadsheet.utils.aoa_to_sheet([
          ['Mã nhân viên / 員工工號','Tên nhân viên / 員工姓名','Tổng thưởng / 獎金總額'],...rows
        ]);
        sheet['!cols']=[{wch:18},{wch:34},{wch:20}];
        const workbook=spreadsheet.utils.book_new();
        spreadsheet.utils.book_append_sheet(workbook,sheet,'Thuong_績效獎金');
        await window.PCMSFileIO.writeWorkbookToHandle(handle,workbook,spreadsheet);
        await store().markExported(state.month,handle.name||suggestedName);
        ui().showToast({kind:'success',message:{vi:'Đã khóa tháng và xuất Excel.',zh:'月份已鎖定並匯出 Excel。'}});
      }catch(error){ await showError(error); }
      finally{ await loadMonth(); }
    });
  }
  async function markPaid(){
    const confirmed=await ui().confirmDialog({
      title:{vi:'Xác nhận đã phát thưởng',zh:'確認獎金已發放'},
      body:ui().createLanguageSections({vi:'Đánh dấu toàn bộ tháng này là đã phát thưởng?',zh:'確定將整個月份標記為獎金已發放？'})
    });
    if(!confirmed) return;
    try{ await store().markPaid(state.month); await loadMonth(); }
    catch(error){ await showError(error); }
  }
  async function unlockMonth(){
    const confirmed=await ui().confirmDialog({
      title:{vi:'Cảnh báo mở khóa tháng',zh:'解除月份鎖定警告'},kind:'danger',
      body:ui().createLanguageSections({vi:'Đây là thao tác nhạy cảm. Kết quả đã xuất hoặc đã phát sẽ trở lại trạng thái thử tính và có thể thay đổi.',zh:'這是敏感操作；已匯出或已發放的結果將回到試算狀態，之後可能發生變動。'}),
      confirmText:{vi:'Mở khóa',zh:'確認解除鎖定'}
    });
    if(!confirmed) return;
    try{ await store().unlockMonth(state.month); await loadMonth(); }
    catch(error){ await showError(error); }
  }
  function bind(){
    el('performance-bonus-month').addEventListener('change',()=>void loadMonth());
    el('performance-bonus-reference').addEventListener('click',openReference);
    el('performance-bonus-migrate').addEventListener('click',()=>void migrateMonthSummary());
    el('performance-bonus-export').addEventListener('click',()=>void exportMonth());
    el('performance-bonus-paid').addEventListener('click',()=>void markPaid());
    el('performance-bonus-unlock').addEventListener('click',()=>void unlockMonth());
  }
  async function loadPerformanceBonusData(){ return true; }
  async function performanceBonusInit(){
    renderShell();
    if(!state.initialized){ state.initialized=true; bind(); }
    el('performance-bonus-month').value=state.month||store().currentMonth();
    state.metadata=null;
    state.employees=[];
    render();
    try{
      state.reference=await store().loadReferenceTable({force:true});
      await loadMonth();
    }catch(error){ await showError(error); }
  }
  function performanceBonusLeave(){ state.request+=1; }

  window.loadPerformanceBonusData=loadPerformanceBonusData;
  window.performanceBonusInit=performanceBonusInit;
  window.performanceBonusLeave=performanceBonusLeave;
})();
