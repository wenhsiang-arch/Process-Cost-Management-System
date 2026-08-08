// production-records（生產紀錄頁程式）：提供日期分頁查詢、數量修改與作廢。
(function(){
  'use strict';

  const state = {initialized:false,rows:[],filtered:[]}; // state（紀錄頁狀態）
  function element(id){ return document.getElementById(id); }
  function isAdmin(){ return window.cu?.role === 'admin'; }
  function dateText(value){
    const parts = String(value || '').split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(value || '—');
  }
  function numberText(value){ return Number(value || 0).toLocaleString(); }
  function shiftDate(days){
    const value = new Date(); value.setDate(value.getDate()+days);
    return typeof formatLocalDate === 'function' ? formatLocalDate(value) : value.toISOString().slice(0,10);
  }

  async function showError(error){
    const message = String(error?.message || 'Không thể hoàn tất thao tác. / 無法完成操作。');
    const parts = message.split(' / ');
    await window.PCMSUIComponents.alertDialog({kind:'danger',message:{vi:parts[0] || message,zh:parts.slice(1).join(' / ') || message}});
  }

  function filters(){
    const employeeInput = String(element('production-record-employee').value || '').trim();
    const employee = window.PCMSProductionEmployees.search(employeeInput,{activeOnly:false,limit:2});
    return {
      from:element('production-record-from').value,
      to:element('production-record-to').value,
      employeeId:employee.length === 1 ? employee[0].employeeId : '',
      order:element('production-record-order').value,
      product:element('production-record-product').value,
      process:element('production-record-process').value,
      status:element('production-record-status-filter').value
    };
  }

  function actionButton(icon,vi,zh,handler,kind=''){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `production-row-button${kind ? ` is-${kind}` : ''}`;
    const iconNode = document.createElement('i'); iconNode.className = `ti ${icon}`;
    button.appendChild(iconNode);
    button.title = `${vi} / ${zh}`;
    button.setAttribute('aria-label',`${vi} / ${zh}`);
    button.addEventListener('click',handler);
    return button;
  }

  function addCell(row,value,className=''){
    const cell = document.createElement('td');
    if(className) cell.className = className;
    cell.textContent = String(value ?? '—');
    row.appendChild(cell);
  }

  function render(){
    state.filtered = window.PCMSProductionReports.filterRows(state.rows,filters());
    const body = element('production-records-table-body');
    body.replaceChildren();
    state.filtered.forEach(item=>{
      const row = document.createElement('tr');
      addCell(row,dateText(item.productionDate));
      addCell(row,`${item.employeeId} · ${item.employeeName}`);
      addCell(row,item.orderNo || '—');
      addCell(row,item.productCode || '—');
      addCell(row,item.processNo || '—','production-number-cell');
      addCell(row,item.processNameVi || item.processNameZh || '—');
      addCell(row,numberText(item.quantity),'production-number-cell');
      const statusCell = document.createElement('td');
      statusCell.className = 'production-center-cell';
      const badge = document.createElement('span');
      badge.className = `production-status ${item.status === 'active' ? 'is-active' : 'is-voided'}`;
      badge.textContent = item.status === 'active' ? 'Hiệu lực / 有效' : 'Đã hủy / 已作廢';
      statusCell.appendChild(badge);
      const actionCell = document.createElement('td');
      actionCell.className = 'production-row-actions';
      if(item.status === 'active'){
        actionCell.append(
          actionButton('ti-edit','Chỉnh sửa số lượng','修改數量',()=>void editQuantity(item)),
          actionButton('ti-ban','Hủy bản ghi','作廢紀錄',()=>void voidRecord(item),'danger')
        );
      }
      if(isAdmin()) actionCell.append(
        actionButton('ti-trash','Xóa vĩnh viễn','永久刪除',()=>void deleteRecord(item),'danger')
      );
      row.append(statusCell,actionCell);
      body.appendChild(row);
    });
    element('production-records-empty').hidden = state.filtered.length > 0;
    element('production-records-count').textContent = String(state.filtered.length);
  }

  async function load(options={}){
    const button = element('production-record-load-more');
    if(options.loadMore !== true) state.rows = [];
    try{
      const result = await window.PCMSProductionReports.loadHistory(filters(),options);
      state.rows = options.loadMore === true ? state.rows.concat(result.rows) : result.rows;
      button.hidden = !result.hasMore;
      render();
    }catch(error){ await showError(error); }
  }

  async function editQuantity(item){
    const quantityText = await window.PCMSUIComponents.promptDialog({
      title:{vi:'Chỉnh sửa số lượng sản xuất',zh:'修改生產數量'},
      label:{vi:'Số lượng mới',zh:'新生產數量'},
      type:'number',
      value:item.quantity,
      validate:value=>Number.isInteger(Number(value)) && Number(value) > 0
    });
    if(quantityText === null) return;
    const reason = await window.PCMSUIComponents.promptDialog({
      title:{vi:'Lý do chỉnh sửa',zh:'修改原因'},
      label:{vi:'Nhập lý do',zh:'輸入原因'},
      multiline:true,
      maxLength:500,
      validate:value=>String(value || '').trim().length > 0
    });
    if(reason === null) return;
    try{
      await window.PCMSProductionEntryStore.updateQuantity(item.id,Number(quantityText),reason);
      await load();
    }catch(error){ await showError(error); }
  }

  async function voidRecord(item){
    const reason = await window.PCMSUIComponents.promptDialog({
      title:{vi:'Lý do hủy bản ghi',zh:'作廢原因'},
      label:{vi:'Nhập lý do',zh:'輸入原因'},
      multiline:true,
      maxLength:500,
      validate:value=>String(value || '').trim().length > 0
    });
    if(reason === null) return;
    const confirmed = await window.PCMSUIComponents.confirmDialog({
      title:{vi:'Xác nhận hủy bản ghi',zh:'確認作廢紀錄'},
      message:{
        vi:`Hủy ${numberText(item.quantity)} sản phẩm của ${item.employeeId}, công đoạn ${item.processNo}. Số lượng này sẽ được trả lại cho đơn hàng.`,
        zh:`將作廢員工 ${item.employeeId}、工序 ${item.processNo} 的 ${numberText(item.quantity)} 件；數量會退回訂單工序剩餘量。`
      }
    });
    if(!confirmed) return;
    try{
      await window.PCMSProductionEntryStore.voidEntry(item.id,reason);
      await load();
    }catch(error){ await showError(error); }
  }

  async function deleteRecord(item){
    const confirmed = await window.PCMSUIComponents.confirmDialog({
      title:{vi:'Xóa vĩnh viễn bản ghi sản xuất',zh:'永久刪除生產紀錄'},
      message:{
        vi:`Xóa ${numberText(item.quantity)} sản phẩm của ${item.employeeId}, công đoạn ${item.processNo}? Dữ liệu không thể khôi phục.`,
        zh:`確定永久刪除員工 ${item.employeeId}、工序 ${item.processNo} 的 ${numberText(item.quantity)} 件生產紀錄？刪除後不能復原。`
      }
    });
    if(!confirmed) return;
    try{
      await window.PCMSProductionEntryStore.deleteEntry(item.id);
      await load();
      window.PCMSUIComponents.showToast({kind:'success',text:{vi:'Đã xóa vĩnh viễn bản ghi sản xuất.',zh:'生產紀錄已永久刪除。'}});
    }catch(error){ await showError(error); }
  }

  function clearFilters(){
    element('production-record-from').value = shiftDate(-7);
    element('production-record-to').value = shiftDate(0);
    element('production-record-employee').value = '';
    element('production-record-order').value = '';
    element('production-record-product').value = '';
    element('production-record-process').value = '';
    element('production-record-status-filter').value = '';
    void load();
  }

  function init(){
    if(state.initialized) return;
    state.initialized = true;
    element('production-record-from').value = shiftDate(-7);
    element('production-record-to').value = shiftDate(0);
    element('production-record-search-button').addEventListener('click',()=>void load());
    element('production-record-clear-button').addEventListener('click',clearFilters);
    element('production-record-load-more').addEventListener('click',()=>void load({loadMore:true}));
    ['production-record-order','production-record-product','production-record-process'].forEach(id=>element(id).addEventListener('input',render));
    element('production-record-status-filter').addEventListener('change',render);
  }

  async function loadProductionRecordsData(options={}){
    await window.PCMSProductionEmployees.load({revalidate:options.background === true});
    return true;
  }

  async function productionRecordsInit(){ init(); await load(); }
  function productionRecordsLeave(){ window.PCMSProductionReports.reset(); }

  window.loadProductionRecordsData = loadProductionRecordsData;
  window.productionRecordsInit = productionRecordsInit;
  window.productionRecordsLeave = productionRecordsLeave;
})();
