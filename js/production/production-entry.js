// production-entry（生產登記頁程式）：處理快速輸入、唯一結果自動選取與當日表格。
(function(){
  'use strict';

  const state = {
    initialized:false,
    dateAuto:true,
    dateTimer:null,
    employee:null,
    order:null,
    product:null,
    process:null,
    employeeTimer:null,
    orderTimer:null,
    productTimer:null,
    processTimer:null
  }; // state（登記頁目前狀態）

  function element(id){ return document.getElementById(id); }
  function isAdmin(){ return window.cu?.role === 'admin'; }
  function today(){ return typeof formatLocalDate === 'function' ? formatLocalDate(new Date()) : new Date().toISOString().slice(0,10); }
  function numberText(value){ return Number(value || 0).toLocaleString(); }

  function setStatus(vi,zh,kind='info'){
    const host = element('production-entry-status');
    if(!host) return;
    if(kind === 'success'){
      host.hidden = true;
      window.PCMSUIComponents.showToast({kind,text:{vi:String(vi || ''),zh:String(zh || '')}});
      return;
    }
    host.hidden = !vi && !zh;
    host.className = `ui-notice is-${kind}`;
    window.PCMSUIText?.set?.(host,{vi:String(vi || ''),zh:String(zh || '')});
  }

  function closeDropdown(id){
    const host = element(id);
    if(host){ host.hidden = true; host.replaceChildren(); }
  }

  function renderDropdown(id,items,render,onSelect){
    const host = element(id);
    if(!host) return;
    host.replaceChildren();
    items.forEach(item=>{
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'production-option';
      const copy = render(item);
      const primary = document.createElement('strong');
      const secondary = document.createElement('span');
      primary.textContent = String(copy.primary || '');
      secondary.textContent = String(copy.secondary || '');
      button.append(primary,secondary);
      button.addEventListener('mousedown',event=>event.preventDefault());
      button.addEventListener('click',()=>onSelect(item));
      host.appendChild(button);
    });
    host.hidden = !items.length;
  }

  function clearEmployee(){
    state.employee = null;
    const name = element('production-employee-name');
    const department = element('production-employee-department');
    if(name) name.textContent = '—';
    if(department) department.textContent = '—';
    renderDailyRows([]);
  }

  function selectEmployee(employee){
    state.employee = employee;
    element('production-employee-input').value = employee.employeeId;
    element('production-employee-name').textContent = employee.name || '—';
    element('production-employee-department').textContent = employee.department || '—';
    closeDropdown('production-employee-options');
    void loadDailyRows();
  }

  function handleEmployeeInput(){
    clearTimeout(state.employeeTimer);
    const input = element('production-employee-input');
    const value = input.value.trim();
    if(state.employee && value.toUpperCase() !== state.employee.employeeId) clearEmployee();
    const matches = window.PCMSProductionEmployees.search(value,{activeOnly:true,limit:20});
    renderDropdown('production-employee-options',matches,item=>({
      primary:`${item.employeeId} · ${item.name}`,
      secondary:item.department || ''
    }),selectEmployee);
    state.employeeTimer = setTimeout(()=>{
      const latest = window.PCMSProductionEmployees.search(input.value,{activeOnly:true,limit:20});
      if(latest.length === 1) selectEmployee(latest[0]);
    },250);
  }

  function clearOrder(){
    state.order = null;
    state.product = null;
    state.process = null;
    element('production-product-input').value = '';
    element('production-process-input').value = '';
    element('production-quantity-input').value = '';
    closeDropdown('production-product-options');
    closeDropdown('production-process-options');
  }

  async function selectOrder(order){
    state.order = order;
    state.product = null;
    state.process = null;
    element('production-order-input').value = order.orderId || order.id;
    element('production-product-input').value = '';
    element('production-process-input').value = '';
    element('production-quantity-input').value = '';
    closeDropdown('production-order-options');
    setStatus('Đang tải công đoạn của đơn hàng…','正在載入訂單工序…','info');
    try{
      await window.PCMSProductionEntryStore.loadProcesses(order.id);
      setStatus('Đã tải công đoạn. Có thể nhập mã hàng.','工序已載入，可以輸入款號。','success');
      element('production-product-input').focus();
    }catch(error){
      clearOrder();
      setStatus('Không thể tải công đoạn của đơn hàng.','無法載入訂單工序。','danger');
      await showError(error);
    }
  }

  function handleOrderInput(){
    clearTimeout(state.orderTimer);
    const input = element('production-order-input');
    const value = input.value.trim();
    if(state.order && value !== (state.order.orderId || state.order.id)) clearOrder();
    const matches = window.PCMSProductionEntryStore.searchOrders(value,20);
    renderDropdown('production-order-options',matches,item=>({
      primary:item.orderId || item.id,
      secondary:[item.client,item.dueDate && typeof fmtVN === 'function' ? fmtVN(item.dueDate) : ''].filter(Boolean).join(' · ')
    }),item=>void selectOrder(item));
    state.orderTimer = setTimeout(()=>{
      const latest = window.PCMSProductionEntryStore.searchOrders(input.value,20);
      if(latest.length === 1) void selectOrder(latest[0]);
    },250);
  }

  function clearProduct(){
    state.product = null;
    state.process = null;
    element('production-process-input').value = '';
    element('production-quantity-input').value = '';
    closeDropdown('production-process-options');
  }

  function selectProduct(product){
    state.product = product;
    state.process = null;
    element('production-product-input').value = product.code;
    element('production-process-input').value = '';
    element('production-quantity-input').value = '';
    closeDropdown('production-product-options');
    element('production-process-input').focus();
  }

  function handleProductInput(){
    clearTimeout(state.productTimer);
    if(!state.order){ closeDropdown('production-product-options'); return; }
    const input = element('production-product-input');
    const value = input.value.trim();
    if(state.product && value !== state.product.code) clearProduct();
    const matches = window.PCMSProductionEntryStore.searchProducts(state.order.id,value,20);
    renderDropdown('production-product-options',matches,item=>({
      primary:item.code,
      secondary:[item.desc,item.color,item.size].filter(Boolean).join(' · ')
    }),selectProduct);
    state.productTimer = setTimeout(()=>{
      const latest = window.PCMSProductionEntryStore.searchProducts(state.order.id,input.value,20);
      if(latest.length === 1) selectProduct(latest[0]);
    },250);
  }

  function selectProcess(process){
    state.process = process;
    element('production-process-input').value = String(process.processNo || '');
    closeDropdown('production-process-options');
    element('production-quantity-input').focus();
  }

  function handleProcessInput(){
    clearTimeout(state.processTimer);
    state.process = null;
    if(!state.order || !state.product){ closeDropdown('production-process-options'); return; }
    const value = element('production-process-input').value.trim();
    const possible = window.PCMSProductionEntryStore.getLoadedProcesses(state.order.id)
      .filter(item=>String(item.code || '') === state.product.code)
      .filter(item=>!value || String(item.processNo || '').includes(value))
      .slice(0,20);
    renderDropdown('production-process-options',possible,item=>({
      primary:`${item.processNo} · ${item.processVi || item.processZh || ''}`,
      secondary:item.processZh && item.processVi ? item.processZh : ''
    }),selectProcess);
    state.processTimer = setTimeout(()=>{
      const exact = window.PCMSProductionEntryStore.findProcess(state.order.id,state.product.code,element('production-process-input').value);
      if(exact) selectProcess(exact);
    },400);
  }

  async function showError(error){
    const details = error?.details;
    if(details){
      await window.PCMSUIComponents.alertDialog({
        kind:'danger',
        message:{
          vi:`Số lượng đơn hàng: ${numberText(details.orderQuantity)}\nĐã ghi nhận: ${numberText(details.registeredQuantity)}\nCòn lại: ${numberText(details.remainingQuantity)}\nLần này nhập: ${numberText(details.inputQuantity)}`,
          zh:`訂單數量：${numberText(details.orderQuantity)}\n已登記：${numberText(details.registeredQuantity)}\n剩餘可登記：${numberText(details.remainingQuantity)}\n本次輸入：${numberText(details.inputQuantity)}`
        }
      });
      return;
    }
    const message = String(error?.message || 'Không thể hoàn tất thao tác. / 無法完成操作。');
    const parts = message.split(' / ');
    await window.PCMSUIComponents.alertDialog({kind:'danger',message:{vi:parts[0] || message,zh:parts.slice(1).join(' / ') || message}});
  }

  function ensureDeleteColumn(){
    const table = element('production-entry-table-body')?.closest('table');
    const headerRow = table?.querySelector('thead tr');
    if(!headerRow) return;
    let header = headerRow.querySelector('[data-production-delete-column]');
    if(!isAdmin()){
      header?.remove();
      return;
    }
    if(header) return;
    header = document.createElement('th');
    header.className = 'production-center-cell';
    header.dataset.productionDeleteColumn = 'true';
    const copy = document.createElement('span');
    copy.className = 'ui-dual-copy';
    const vi = document.createElement('strong');
    const zh = document.createElement('span');
    vi.textContent = 'Thao tác';
    zh.textContent = '操作';
    copy.append(vi,zh);
    header.appendChild(copy);
    headerRow.appendChild(header);
  }

  function deleteButton(item){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'production-row-button is-danger';
    button.title = 'Xóa vĩnh viễn / 永久刪除';
    button.setAttribute('aria-label','Xóa vĩnh viễn / 永久刪除');
    const icon = document.createElement('i');
    icon.className = 'ti ti-trash';
    button.appendChild(icon);
    button.addEventListener('click',()=>void deleteDailyRecord(item));
    return button;
  }

  async function deleteDailyRecord(item){
    const confirmed = await window.PCMSUIComponents.confirmDialog({
      title:{vi:'Xóa vĩnh viễn bản ghi sản xuất',zh:'永久刪除生產紀錄'},
      message:{
        vi:`Xóa ${numberText(item.quantity)} sản phẩm của công đoạn ${item.processNo}? Dữ liệu không thể khôi phục.`,
        zh:`確定永久刪除工序 ${item.processNo} 的 ${numberText(item.quantity)} 件生產紀錄？刪除後不能復原。`
      }
    });
    if(!confirmed) return;
    try{
      await window.PCMSProductionEntryStore.deleteEntry(item.id);
      await loadDailyRows();
      setStatus('Đã xóa vĩnh viễn bản ghi sản xuất.','生產紀錄已永久刪除。','success');
    }catch(error){ await showError(error); }
  }

  async function saveEntry(){
    const button = element('production-save-button');
    return window.PCMSUIComponents.runActionOnce('production.entry.save',async()=>{
      try{
        const saved = await window.PCMSProductionEntryStore.createEntry({
          productionDate:element('production-date-input').value,
          employeeId:state.employee?.employeeId,
          orderId:state.order?.id,
          productCode:state.product?.code,
          processNo:state.process?.processNo,
          quantity:element('production-quantity-input').value
        });
        element('production-process-input').value = '';
        element('production-quantity-input').value = '';
        state.process = null;
        setStatus(
          `Đã lưu ${numberText(saved.quantity)} sản phẩm cho công đoạn ${saved.processNo}.`,
          `已儲存工序 ${saved.processNo} 的 ${numberText(saved.quantity)} 件生產數量。`,
          'success'
        );
        await loadDailyRows();
        element('production-process-input').focus();
        return saved;
      }catch(error){
        setStatus('Chưa lưu dữ liệu. Vui lòng kiểm tra và thử lại.','資料尚未儲存，請檢查後重試。','danger');
        await showError(error);
        throw error;
      }
    },{
      controls:[button],
      cooldownMs:1000,
      onDuplicate:()=>setStatus('Đang lưu, vui lòng chờ.','正在儲存，請稍候。','info')
    }).catch(()=>null);
  }

  function appendCell(row,value,className=''){
    const cell = document.createElement('td');
    if(className) cell.className = className;
    cell.textContent = String(value ?? '—');
    row.appendChild(cell);
  }

  function renderDailyRows(rows){
    const body = element('production-entry-table-body');
    const empty = element('production-entry-empty');
    if(!body) return;
    ensureDeleteColumn();
    body.replaceChildren();
    rows.forEach(item=>{
      const row = document.createElement('tr');
      appendCell(row,item.orderNo || '—');
      appendCell(row,item.productCode || '—');
      appendCell(row,item.processNo || '—','production-number-cell');
      appendCell(row,item.processNameVi || item.processNameZh || '—');
      appendCell(row,numberText(item.quantity),'production-number-cell');
      appendCell(row,numberText(item.orderQtySnapshot),'production-number-cell');
      appendCell(row,numberText(item.processSecSnapshot),'production-number-cell');
      if(isAdmin()){
        const actionCell = document.createElement('td');
        actionCell.className = 'production-row-actions';
        actionCell.appendChild(deleteButton(item));
        row.appendChild(actionCell);
      }
      body.appendChild(row);
    });
    if(empty) empty.hidden = rows.length > 0;
  }

  async function loadDailyRows(){
    if(!state.employee){ renderDailyRows([]); return; }
    try{
      const rows = await window.PCMSProductionReports.loadDaily(state.employee.employeeId,element('production-date-input').value);
      renderDailyRows(rows);
    }catch(error){
      renderDailyRows([]);
      await showError(error);
    }
  }

  function setTodayMode(){
    state.dateAuto = true;
    element('production-date-input').value = today();
    void loadDailyRows();
  }

  function startDateTimer(){
    if(state.dateTimer) return;
    state.dateTimer = setInterval(()=>{
      if(!state.dateAuto) return;
      const current = today();
      if(element('production-date-input').value !== current){
        element('production-date-input').value = current;
        void loadDailyRows();
      }
    },30000);
  }

  function stopDateTimer(){
    if(state.dateTimer) clearInterval(state.dateTimer);
    state.dateTimer = null;
  }

  function init(){
    if(state.initialized) return;
    state.initialized = true;
    const date = element('production-date-input');
    date.value = today();
    date.addEventListener('change',()=>{ state.dateAuto = false; void loadDailyRows(); });
    element('production-today-button').addEventListener('click',setTodayMode);
    element('production-employee-input').addEventListener('input',handleEmployeeInput);
    element('production-order-input').addEventListener('input',handleOrderInput);
    element('production-order-input').addEventListener('focus',event=>{ event.target.select(); handleOrderInput(); });
    element('production-order-input').addEventListener('click',handleOrderInput);
    element('production-product-input').addEventListener('input',handleProductInput);
    element('production-product-input').addEventListener('focus',event=>{ event.target.select(); handleProductInput(); });
    element('production-product-input').addEventListener('click',handleProductInput);
    element('production-process-input').addEventListener('input',handleProcessInput);
    element('production-save-button').addEventListener('click',()=>void saveEntry());
    document.addEventListener('click',event=>{
      if(!event.target.closest('.production-combobox')){
        ['production-employee-options','production-order-options','production-product-options','production-process-options'].forEach(closeDropdown);
      }
    });
  }

  async function loadProductionEntryData(options={}){
    await Promise.all([
      window.PCMSProductionEmployees.load({revalidate:options.background === true}),
      window.PCMSProductionEntryStore.loadOrders()
    ]);
    return true;
  }

  async function productionEntryInit(){
    init();
    if(state.dateAuto) element('production-date-input').value = today();
    startDateTimer();
    if(state.employee) await loadDailyRows();
  }

  function productionEntryLeave(){
    stopDateTimer();
    ['production-employee-options','production-order-options','production-product-options','production-process-options'].forEach(closeDropdown);
  }

  window.loadProductionEntryData = loadProductionEntryData;
  window.productionEntryInit = productionEntryInit;
  window.productionEntryLeave = productionEntryLeave;
})();
