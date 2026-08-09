// production-records（生產紀錄頁程式）：提供日期分頁查詢、數量修改與作廢。
(function(){
  'use strict';

  const state = {initialized:false,rows:[],filtered:[],pendingFilters:null,efficiencies:new Map()}; // state（紀錄頁狀態）
  function element(id){ return document.getElementById(id); }
  function isAdmin(){ return window.cu?.role === 'admin'; }
  function dateText(value){
    const parts = String(value || '').split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(value || '—');
  }
  function dateBadgeText(value){
    const parts = String(value || '').split('-').map(Number);
    if(parts.length !== 3 || parts.some(part=>!Number.isFinite(part))) return {date:dateText(value),vi:'',zh:''};
    const date = new Date(parts[0],parts[1]-1,parts[2]);
    const viDays = ['Chủ nhật','Thứ hai','Thứ ba','Thứ tư','Thứ năm','Thứ sáu','Thứ bảy'];
    const zhDays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
    return {
      date:`${String(parts[2]).padStart(2,'0')}/${String(parts[1]).padStart(2,'0')}`,
      vi:viDays[date.getDay()],
      zh:zhDays[date.getDay()]
    };
  }
  function numberText(value){ return Number(value || 0).toLocaleString(); }
  function hoursText(value){
    const hours = Number(value);
    return Number.isFinite(hours) ? hours.toLocaleString(undefined,{minimumFractionDigits:hours % 1 === 0 ? 0 : 1,maximumFractionDigits:1}) : '—';
  }
  function isSupplementEntry(item){ return window.PCMSProductionEntryStore.isSupplementEntry(item); }
  function employeeDisplayName(item){ // employeeDisplayName（目前顯示的員工姓名）：優先使用員工主資料，舊紀錄快照只作備援。
    const employee = window.PCMSProductionEmployees?.find?.(item?.employeeId);
    return String(employee?.name || item?.employeeName || '').trim() || '—';
  }
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

  function addCell(row,value,className='',showFullText=false){
    const cell = document.createElement('td');
    if(className) cell.className = className;
    const text = String(value ?? '—');
    cell.textContent = text;
    if(showFullText && text !== '—') cell.title = text;
    row.appendChild(cell);
  }

  function efficiencyKey(item){ return `${item.employeeId}|${item.productionDate}`; }

  function addEfficiencyCell(row,item){
    const cell = document.createElement('td');
    cell.className = 'production-center-cell production-efficiency-cell';
    const result = state.efficiencies.get(efficiencyKey(item));
    if(result?.status === 'ready'){
      cell.textContent = `${Number(result.percentage || 0).toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
    }else{
      const copy = document.createElement('span');
      copy.className = 'ui-dual-copy production-efficiency-status';
      const vi = document.createElement('strong');
      const zh = document.createElement('span');
      if(result?.status === 'invalid-attendance'){
        vi.textContent = 'Giờ bất thường';
        zh.textContent = '考勤時數異常';
      }else if(result?.status === 'invalid-capacity'){
        vi.textContent = 'Thiếu chuẩn giờ';
        zh.textContent = '缺少標準產能';
      }else{
        vi.textContent = 'Chưa chấm công';
        zh.textContent = '考勤未登記';
      }
      copy.append(vi,zh);
      cell.appendChild(copy);
    }
    row.appendChild(cell);
  }

  async function loadEfficiencies(rows){
    const pairs = new Map();
    (Array.isArray(rows) ? rows : []).forEach(item=>pairs.set(efficiencyKey(item),item));
    const results = await Promise.all(Array.from(pairs.entries()).map(async([key,item])=>{
      try{
        return [key,await window.PCMSProductionAttendance.efficiencyFor(item.employeeId,item.productionDate,{force:true})];
      }catch(error){
        console.warn('Không thể tính hiệu suất ngày / 無法計算當日效率：',error);
        return [key,{status:'missing-attendance',percentage:null}];
      }
    }));
    state.efficiencies = new Map(results);
  }

  function addDateCell(row,value,showBadge){
    const cell = document.createElement('td');
    cell.className = 'production-date-cell';
    if(showBadge){
      const copy = dateBadgeText(value);
      const badge = document.createElement('span');
      badge.className = 'production-date-badge';
      const date = document.createElement('strong');
      const weekday = document.createElement('span');
      date.textContent = copy.date;
      weekday.textContent = `${copy.vi} / ${copy.zh}`;
      badge.append(date,weekday);
      cell.appendChild(badge);
    }else{
      cell.setAttribute('aria-label',dateText(value));
    }
    row.appendChild(cell);
  }

  function render(){
    state.filtered = window.PCMSProductionReports.filterRows(state.rows,filters());
    const body = element('production-records-table-body');
    body.replaceChildren();
    state.filtered.forEach((item,index)=>{
      const supplement = isSupplementEntry(item);
      const row = document.createElement('tr');
      const groupStart = index === 0 || state.filtered[index-1]?.productionDate !== item.productionDate;
      if(groupStart) row.classList.add('production-date-group-start');
      addDateCell(row,item.productionDate,groupStart);
      addCell(row,item.employeeId,'production-record-text-cell',true);
      addCell(row,employeeDisplayName(item),'production-record-text-cell',true);
      addCell(row,item.orderNo || '—','production-record-text-cell',true);
      addCell(row,item.productCode || '—','production-record-text-cell',true);
      addCell(row,item.processNo || '—','production-number-cell');
      addCell(row,supplement ? item.supplementReason : (item.processNameVi || item.processNameZh || '—'),'production-record-text-cell',true);
      addCell(row,supplement ? '—' : numberText(item.quantity),'production-number-cell');
      addCell(row,supplement ? hoursText(item.supplementHours) : '—','production-number-cell');
      addEfficiencyCell(row,item);
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
          actionButton(
            'ti-edit',
            supplement ? 'Chỉnh sửa giờ bổ sung' : 'Chỉnh sửa số lượng',
            supplement ? '修改補充工時' : '修改數量',
            ()=>void editRecord(item)
          ),
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
      await loadEfficiencies(state.rows);
      render();
    }catch(error){ await showError(error); }
  }

  async function editRecord(item){
    const supplement = isSupplementEntry(item);
    const valueText = await window.PCMSUIComponents.promptDialog({
      title:supplement
        ? {vi:'Chỉnh sửa giờ bổ sung',zh:'修改補充工時'}
        : {vi:'Chỉnh sửa số lượng sản xuất',zh:'修改生產數量'},
      label:supplement
        ? {vi:'Giờ mới (0,5–24)',zh:'新補充工時（0.5～24）'}
        : {vi:'Số lượng mới',zh:'新生產數量'},
      type:'number',
      value:supplement ? item.supplementHours : item.quantity,
      validate:value=>supplement
        ? window.PCMSProductionEntryStore.isValidSupplementHours(value)
        : Number.isInteger(Number(value)) && Number(value) > 0
    });
    if(valueText === null) return;
    const reason = await window.PCMSUIComponents.promptDialog({
      title:{vi:'Lý do chỉnh sửa',zh:'修改原因'},
      label:{vi:'Nhập lý do',zh:'輸入原因'},
      multiline:true,
      maxLength:500,
      validate:value=>String(value || '').trim().length > 0
    });
    if(reason === null) return;
    try{
      if(supplement) await window.PCMSProductionEntryStore.updateSupplementHours(item.id,Number(valueText),reason);
      else await window.PCMSProductionEntryStore.updateQuantity(item.id,Number(valueText),reason);
      await load();
    }catch(error){ await showError(error); }
  }

  async function voidRecord(item){
    const supplement = isSupplementEntry(item);
    const reason = await window.PCMSUIComponents.promptDialog({
      title:{vi:'Lý do hủy bản ghi',zh:'作廢原因'},
      label:{vi:'Nhập lý do',zh:'輸入原因'},
      multiline:true,
      maxLength:500,
      validate:value=>String(value || '').trim().length > 0
    });
    if(reason === null) return;
    const confirmed = await window.PCMSUIComponents.confirmDialog({
      title:supplement
        ? {vi:'Xác nhận hủy giờ bổ sung',zh:'確認作廢補充工時'}
        : {vi:'Xác nhận hủy bản ghi',zh:'確認作廢紀錄'},
      message:supplement
        ? {
            vi:`Hủy ${hoursText(item.supplementHours)} giờ bổ sung của ${item.employeeId}, lý do “${item.supplementReason || '—'}”?`,
            zh:`將作廢員工 ${item.employeeId}「${item.supplementReason || '—'}」的 ${hoursText(item.supplementHours)} 小時補充工時。`
          }
        : {
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
    const supplement = isSupplementEntry(item);
    const confirmed = await window.PCMSUIComponents.confirmDialog({
      title:supplement
        ? {vi:'Xóa vĩnh viễn giờ bổ sung',zh:'永久刪除補充工時'}
        : {vi:'Xóa vĩnh viễn bản ghi sản xuất',zh:'永久刪除生產紀錄'},
      message:supplement
        ? {
            vi:`Xóa ${hoursText(item.supplementHours)} giờ bổ sung của ${item.employeeId}, lý do “${item.supplementReason || '—'}”? Dữ liệu không thể khôi phục.`,
            zh:`確定永久刪除員工 ${item.employeeId}「${item.supplementReason || '—'}」的 ${hoursText(item.supplementHours)} 小時補充工時？刪除後不能復原。`
          }
        : {
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

  function setPendingFilters(filters={}){
    state.pendingFilters = {
      order:String(filters.order || '').trim(),
      product:String(filters.product || '').trim(),
      process:String(filters.process || '').trim()
    };
  }

  function applyPendingFilters(){
    const pending = state.pendingFilters;
    state.pendingFilters = null;
    if(!pending) return;
    element('production-record-order').value = pending.order;
    element('production-record-product').value = pending.product;
    element('production-record-process').value = pending.process;
    element('production-record-status-filter').value = 'active';
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

  async function productionRecordsInit(){ init(); applyPendingFilters(); await load(); }
  function productionRecordsLeave(){ window.PCMSProductionReports.reset(); state.efficiencies.clear(); }

  window.loadProductionRecordsData = loadProductionRecordsData;
  window.productionRecordsInit = productionRecordsInit;
  window.productionRecordsLeave = productionRecordsLeave;
  window.PCMSProductionRecords = Object.freeze({setPendingFilters});
})();
