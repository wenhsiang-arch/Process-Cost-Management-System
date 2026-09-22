// orderHistory（歷史操作紀錄分頁）：按需讀取整個訂單主功能的既有操作紀錄。
(function(){
  const PAGE_SIZE=50;
  const ACTION_LABELS=Object.freeze({
    orderImport:['Nhập đơn hàng','匯入訂單'],
    orderItemQuantityUpdate:['Điều chỉnh số lượng','調整數量'],
    orderUpdate:['Cập nhật đơn hàng','修改訂單資料'],
    orderArchive:['Lưu trữ đơn hàng','封存訂單'],
    orderRestore:['Khôi phục đơn hàng','還原訂單'],
    orderShipmentConfirm:['Xác nhận đã xuất hàng','確認已出貨'],
    orderShipmentCancel:['Hủy xác nhận xuất hàng','取消出貨確認'],
    orderProductionProgressComplete:['Xác nhận đơn hoàn thành','確認訂單完成'],
    orderProductionProgressResume:['Hủy trạng thái hoàn thành','取消完成狀態'],
    orderImportLockRepair:['Khôi phục khóa nhập đơn','修復訂單匯入鎖定'],
    orderImportDiscardStarted:['Bắt đầu dọn dữ liệu nhập dở','開始清理未完成匯入'],
    orderImportDiscardBatch:['Dọn dữ liệu nhập dở','清理未完成匯入'],
    orderImportDiscardCompleted:['Hoàn tất dọn dữ liệu nhập dở','完成清理未完成匯入'],
    orderPurgeStarted:['Bắt đầu xóa vĩnh viễn','開始永久刪除'],
    orderPurgeBatch:['Xóa chi tiết đơn hàng','刪除訂單明細'],
    orderPurgeCompleted:['Hoàn tất xóa vĩnh viễn','完成永久刪除'],
    inspectionTemplateImport:['Nhập mẫu báo cáo kiểm tra','匯入品檢報告範本'],
    inspectionTemplateDownload:['Tải mẫu báo cáo kiểm tra','下載品檢報告範本'],
    inspectionTemplateDelete:['Xóa mẫu báo cáo kiểm tra','刪除品檢報告範本'],
    inspectionReportExcelExport:['Xuất báo cáo kiểm tra','匯出品檢報告']
  });
  const FIELD_LABELS=Object.freeze({
    quantity:['Số lượng','數量'],dueDate:['Ngày xuất theo PO','出貨日期 PO'],
    completionDate:['Ngày hoàn thành','完成日期'],shipDate:['Ngày xuất hàng','出貨日期'],
    actualShipDate:['Ngày xuất thực tế','實際出貨日'],remark:['Ghi chú','備註'],notes:['Ghi chú','備註'],
    lifecycleStatus:['Trạng thái lưu trữ','封存狀態'],shipmentStatus:['Trạng thái xuất hàng','出貨狀態'],
    productionProgressCompleted:['Trạng thái hoàn thành','完成狀態'],
    productionProgressSnapshotPercent:['Tiến độ thực tế','實際進度']
  });
  const VALUE_LABELS=Object.freeze({
    active:['Đang sử dụng','使用中'],archived:['Đã lưu trữ','已封存'],pending:['Chưa xuất','未出貨'],
    shipped:['Đã xuất','已出貨'],true:['Đã hoàn thành','已完成'],false:['Chưa hoàn thành','未完成']
  });
  const state={rows:[],loading:false,loaded:false,active:false};
  const node=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const pair=(vi,zh)=>`<span class="ui-dual-copy"><strong>${escape(vi)}</strong><span>${escape(zh)}</span></span>`;
  const INTERNAL_NOTES=new Set(['actualShipDate','remark','notes','dueDate','completionDate','shipDate']);
  const queryOptions=()=>({permissionKey:'progress',limit:PAGE_SIZE});

  function renderShell(){
    const root=node('order-history-root');
    if(!root||root.dataset.ready==='true') return;
    root.dataset.ready='true';
    root.innerHTML=`<div class="order-history-page ui-work-panel">
      <section class="order-history-operation-panel ui-operation-panel">
        <div class="order-history-command-row ui-command-row">
          <div class="order-history-context-grid ui-context-grid is-single">
            <div class="order-history-context-item ui-context-item"><i class="ti ti-history"></i><div class="ui-language-sections">
              <div class="ui-language-section is-vi" lang="vi">Xem lại thao tác của toàn bộ chức năng đơn hàng. Dữ liệu chỉ được tải khi mở trang này.</div>
              <div class="ui-language-section is-zh" lang="zh-Hant">查看整個訂單主功能各分頁的操作；只有開啟本頁時才會讀取紀錄。</div>
            </div></div>
          </div>
          <div class="order-history-command-actions ui-command-actions">
            <button type="button" id="order-history-refresh" class="ui-command-action" onclick="orderHistoryRefresh()"><i class="ti ti-refresh"></i>${pair('Làm mới','重新整理')}</button>
          </div>
        </div>
      </section>
      <section class="order-history-data-section ui-data-section">
        <div class="order-history-section-header ui-section-header"><i class="ti ti-list-details"></i>${pair('Lịch sử thao tác','歷史操作紀錄（最近 50 筆）')}<span id="order-history-count" class="order-history-count ui-helper-text"></span></div>
        <div class="order-history-table-frame ui-table-frame"><div class="ui-table-scroll">
          <table id="order-history-table" class="ui-table" data-ui-table-layout="special" data-ui-table-sticky="container">
            <thead><tr>
              <th class="order-history-time">${pair('Thời gian','操作時間')}</th>
              <th class="order-history-operator">${pair('Người thao tác','操作者')}</th>
              <th class="order-history-target">${pair('Đơn hàng / Đối tượng','訂單／對象')}</th>
              <th class="order-history-action">${pair('Thao tác','操作內容')}</th>
              <th>${pair('Nội dung thay đổi','變更摘要')}</th>
              <th class="order-history-result">${pair('Kết quả','結果')}</th>
            </tr></thead><tbody id="order-history-body"></tbody>
          </table>
        </div></div>
        <div class="order-history-footer"><button type="button" id="order-history-more" class="btn" onclick="orderHistoryLoadMore()" hidden><i class="ti ti-chevrons-down"></i>${pair('Tải thêm','載入更多')}</button></div>
      </section>
    </div>`;
  }

  function formatTime(value){
    const date=new Date(Number(value)||0);
    return Number.isNaN(date.getTime())?'—':date.toLocaleString('zh-TW',{hour12:false});
  }
  function formatNumber(value){
    const number=Number(value);
    return Number.isFinite(number)?number.toLocaleString('zh-TW'):String(value??'—');
  }
  function formatDateValue(value){
    const number=Number(value);
    if(!Number.isFinite(number)||number<=0) return '';
    const date=new Date(number);
    if(Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}`;
  }
  function formatValue(change,value){
    if(value===null||value===undefined||value==='') return '—';
    const label=VALUE_LABELS[String(value)];
    if(label) return `${label[0]}／${label[1]}`;
    if(change?.field==='productionProgressSnapshotPercent') return `${formatNumber(value)}%`;
    if(['dueDate','completionDate','shipDate','actualShipDate'].includes(change?.field)) return formatDateValue(value)||String(value);
    return formatNumber(value);
  }
  function changeSummary(log){
    const changes=Array.isArray(log?.changes)?log.changes:[];
    if(!changes.length){
      const count=Number(log?.itemCount)||0;
      const details=Number(log?.detailCount)||0;
      if(log?.action==='inspectionTemplateImport') return pair(
        `${log?.overwriteCount?'Thay mẫu':'Thêm mẫu'} · ${details} phần`,
        `${log?.overwriteCount?'替換範本':'新增範本'} · ${details} 個分段`
      );
      if(log?.action==='inspectionTemplateDownload'||log?.action==='inspectionTemplateDelete'){
        return details?pair(`${details} phần`,`共 ${details} 個分段`):pair('1 mẫu','1 份範本');
      }
      if(log?.action==='inspectionReportExcelExport') return pair(
        `${count} trang tính · ${details} chi tiết`,`${count} 個款號分頁 · ${details} 筆明細`
      );
      return count?pair(`${count} mục`,`共 ${count} 筆`):'—';
    }
    const note=String(log?.note||'');
    const separator=note.includes('｜')?'｜':(note.includes('|')?'|':'');
    const reason=separator?note.split(separator).slice(1).join(separator).trim():'';
    const changeRows=changes.map(change=>{
      const label=FIELD_LABELS[change?.field]||[String(change?.field||'Thay đổi'),String(change?.field||'變更')];
      const before=formatValue(change,change?.before),after=formatValue(change,change?.after);
      return `<div><span class="order-history-field">${pair(label[0],label[1])}</span><span class="order-history-value">${escape(before)} <i class="ti ti-arrow-right"></i> ${escape(after)}</span></div>`;
    }).join('');
    const reasonRow=reason?`<div><span class="order-history-field">${pair('Lý do','原因')}</span><span class="order-history-value">${escape(reason)}</span></div>`:'';
    return `<div class="order-history-changes">${changeRows}${reasonRow}</div>`;
  }
  function targetText(log){
    const note=String(log?.note||'').trim();
    const target=String(log?.targetId||'').trim();
    const fileName=String(log?.fileName||'').trim();
    if(log?.feature==='inspectionReport') return fileName||note||target||'—';
    const separator=note.includes('｜')?'｜':(note.includes('|')?'|':'');
    if(separator) return note.split(separator)[0].trim()||target||'—';
    // 舊紀錄只保存欄位代碼，沒有可安全還原的顯示訂單號碼；寧可留白也不顯示內部代碼或文件識別碼。
    if(INTERNAL_NOTES.has(note)) return '—';
    return note||target||'—';
  }
  function statusHtml(status){
    const values={success:['Thành công','成功','is-success'],partial:['Hoàn tất một phần','部分完成','is-partial'],failed:['Thất bại','失敗','is-failed']};
    const selected=values[status]||values.failed;
    return `<span class="order-history-status ${selected[2]}">${pair(selected[0],selected[1])}</span>`;
  }
  function renderRows(){
    const body=node('order-history-body');
    if(!body) return;
    if(!state.rows.length){
      body.innerHTML=`<tr><td colspan="6" class="order-history-message">${pair('Chưa có lịch sử thao tác.','尚無操作紀錄。')}</td></tr>`;
    }else{
      body.innerHTML=state.rows.map(log=>{
        const label=ACTION_LABELS[log?.action]||['Thao tác khác','其他操作'];
        return `<tr><td>${escape(formatTime(log?.createdAt))}</td><td>${escape(log?.createdBy||log?.createdByUid||'—')}</td><td>${escape(targetText(log))}</td><td>${pair(label[0],label[1])}</td><td>${changeSummary(log)}</td><td>${statusHtml(log?.status)}</td></tr>`;
      }).join('');
    }
    const count=node('order-history-count');
    if(count) count.textContent=state.rows.length?`${state.rows.length}`:'';
    const more=node('order-history-more');
    if(more) more.hidden=!window.PCMSHistory?.hasMore?.('operationLogs',queryOptions());
  }
  function renderMessage(vi,zh,isError=false){
    const body=node('order-history-body');
    if(body) body.innerHTML=`<tr><td colspan="6" class="order-history-message${isError?' is-error':''}">${pair(vi,zh)}</td></tr>`;
  }
  async function load(options={}){
    if(state.loading) return;
    renderShell();
    const refresh=node('order-history-refresh'),more=node('order-history-more');
    state.loading=true;
    if(refresh) refresh.disabled=true;
    if(more) more.disabled=true;
    if(!state.rows.length) renderMessage('Đang tải lịch sử...','正在載入歷史紀錄…');
    try{
      if(!window.PCMSHistory?.loadOperationLogs) throw new Error('history-unavailable');
      state.rows=await window.PCMSHistory.loadOperationLogs({...queryOptions(),...options});
      state.loaded=true;
      if(state.active) renderRows();
    }catch(error){
      console.error('Không thể tải lịch sử đơn hàng / 無法載入訂單歷史：',error);
      if(state.active) renderMessage('Không thể tải lịch sử thao tác, vui lòng thử lại.','無法載入操作紀錄，請重試。',true);
    }finally{
      state.loading=false;
      if(refresh) refresh.disabled=false;
      if(more) more.disabled=false;
    }
  }
  function init(){
    state.active=true;
    renderShell();
    if(state.loaded) renderRows();
    else void load();
  }
  function leave(){ state.active=false; }
  function refresh(){ void load({force:true}); }
  function loadMore(){ void load({loadMore:true}); }

  window.orderHistoryInit=init;
  window.orderHistoryLeave=leave;
  window.orderHistoryRefresh=refresh;
  window.orderHistoryLoadMore=loadMore;
})();
