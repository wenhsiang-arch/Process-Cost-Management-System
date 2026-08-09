// production-entry（生產登記頁程式）：處理搜尋下拉輸入、手動選取與當日表格。
(function(){
  'use strict';

  const state = {
    initialized:false,
    dateAuto:true,
    dateTimer:null,
    employee:null,
    order:null,
    orderReady:false,
    product:null,
    process:null,
    processTotal:null,
    processTotalLoading:false,
    processTotalRequest:0,
    columnVisibility:{
      order:true,
      product:true,
      processNo:true,
      processName:true,
      quantity:true,
      orderQuantity:true,
      processSeconds:true,
      action:true
    }
  }; // state（登記頁目前狀態）

  const ENTRY_INPUT_IDS = Object.freeze([
    'production-employee-input','production-date-input','production-order-input',
    'production-product-input','production-process-input','production-quantity-input'
  ]); // ENTRY_INPUT_IDS（生產登記鍵盤輸入順序）

  const DROPDOWN_BINDINGS = Object.freeze({
    'production-employee-options':{inputId:'production-employee-input',toggleId:'production-employee-toggle'},
    'production-order-options':{inputId:'production-order-input',toggleId:'production-order-toggle'},
    'production-product-options':{inputId:'production-product-input',toggleId:'production-product-toggle'},
    'production-process-options':{inputId:'production-process-input',toggleId:'production-process-toggle'}
  }); // DROPDOWN_BINDINGS（搜尋下拉欄位對應關係）

  const DROPDOWN_OPTION_IDS = Object.freeze(Object.keys(DROPDOWN_BINDINGS)); // DROPDOWN_OPTION_IDS（全部搜尋下拉選單識別碼）
  const dropdownInteractions = new Map(); // dropdownInteractions（搜尋下拉目前鍵盤選取狀態）

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
    host.className = `production-entry-status is-${kind}`;
    window.PCMSUIText?.set?.(host,{vi:String(vi || ''),zh:String(zh || '')});
  }

  function closeColumnSettings(){
    const menu = element('production-column-settings-menu');
    const button = element('production-column-settings-button');
    if(menu) menu.hidden = true;
    button?.setAttribute('aria-expanded','false');
  }

  function toggleColumnSettings(){
    const menu = element('production-column-settings-menu');
    const button = element('production-column-settings-button');
    if(!menu || !button) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    button.setAttribute('aria-expanded',String(willOpen));
  }

  function applyColumnVisibility(){
    const table = element('production-entry-table-body')?.closest('table');
    if(!table) return;
    table.querySelectorAll('[data-production-column]').forEach(cell=>{
      const key = cell.dataset.productionColumn;
      const visible = state.columnVisibility[key] !== false;
      cell.classList.toggle('is-column-hidden',!visible);
    });
    document.querySelectorAll('#production-column-settings-menu [data-production-column-toggle]').forEach(input=>{
      input.checked = state.columnVisibility[input.dataset.productionColumnToggle] !== false;
    });
    const operationOption = element('production-operation-column-option');
    if(operationOption) operationOption.hidden = !isAdmin();
    const visibleColumnCount = Array.from(table.querySelectorAll('thead [data-production-column]'))
      .filter(cell=>!cell.classList.contains('is-column-hidden')).length;
    const frame = element('production-entry-table-frame');
    const noColumns = element('production-columns-empty');
    if(frame) frame.hidden = visibleColumnCount === 0;
    if(noColumns) noColumns.hidden = visibleColumnCount !== 0;
    const empty = element('production-entry-empty');
    const body = element('production-entry-table-body');
    if(empty) empty.hidden = visibleColumnCount === 0 || Boolean(body?.children.length);
  }

  function setColumnVisibility(key,visible){
    if(!Object.prototype.hasOwnProperty.call(state.columnVisibility,key)) return;
    state.columnVisibility[key] = visible === true;
    applyColumnVisibility();
  }

  function resetColumnVisibility(){
    Object.keys(state.columnVisibility).forEach(key=>{ state.columnVisibility[key] = true; });
    applyColumnVisibility();
  }

  function closeDropdown(id){
    const host = element(id);
    if(host){ host.hidden = true; host.replaceChildren(); delete host.dataset.dropdownMode; }
    dropdownInteractions.delete(id);
    const binding = DROPDOWN_BINDINGS[id]; // binding（目前搜尋下拉欄位對應）
    element(binding?.inputId)?.setAttribute('aria-expanded','false');
    element(binding?.toggleId)?.setAttribute('aria-expanded','false');
  }

  function closeOtherDropdowns(activeId){
    DROPDOWN_OPTION_IDS.filter(id=>id !== activeId).forEach(closeDropdown);
  }

  function isDropdownOpen(id){
    const host = element(id);
    return Boolean(host && host.hidden === false);
  }

  function renderDropdown(id,items,render,onSelect,mode='search'){
    const host = element(id);
    if(!host) return;
    closeOtherDropdowns(id);
    host.replaceChildren();
    items.forEach((item,index)=>{
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.className = 'production-option';
      button.setAttribute('role','option');
      button.setAttribute('aria-selected','false');
      button.dataset.optionIndex = String(index);
      const copy = render(item);
      const primary = document.createElement('strong');
      const secondary = document.createElement('span');
      primary.textContent = String(copy.primary || '');
      secondary.textContent = String(copy.secondary || '');
      button.append(primary,secondary);
      button.addEventListener('mousedown',event=>event.preventDefault());
      button.addEventListener('click',()=>void Promise.resolve(onSelect(item)));
      host.appendChild(button);
    });
    const expanded = items.length > 0; // expanded（選單是否展開）
    host.hidden = !expanded;
    if(expanded) host.dataset.dropdownMode = mode; // dropdownMode（搜尋結果或完整清單模式）
    else delete host.dataset.dropdownMode;
    const binding = DROPDOWN_BINDINGS[id];
    element(binding?.inputId)?.setAttribute('aria-expanded',String(expanded));
    element(binding?.toggleId)?.setAttribute('aria-expanded',String(expanded));
    if(expanded) dropdownInteractions.set(id,{items:items.slice(),onSelect,activeIndex:-1});
    else dropdownInteractions.delete(id);
  }

  function setDropdownActive(id,index){
    const host = element(id);
    const interaction = dropdownInteractions.get(id);
    if(!host || !interaction || !interaction.items.length) return;
    const nextIndex = Math.max(0,Math.min(index,interaction.items.length-1));
    interaction.activeIndex = nextIndex;
    host.querySelectorAll('.production-option').forEach((button,buttonIndex)=>{
      const active = buttonIndex === nextIndex;
      button.classList.toggle('is-keyboard-active',active);
      button.setAttribute('aria-selected',String(active));
      if(active) button.scrollIntoView({block:'nearest'});
    });
  }

  function selectDropdownActive(id){
    const interaction = dropdownInteractions.get(id);
    if(!interaction || interaction.activeIndex < 0) return false;
    const item = interaction.items[interaction.activeIndex];
    if(!item) return false;
    void Promise.resolve(interaction.onSelect(item));
    return true;
  }

  function toggleDropdown(id,items,render,onSelect){
    const host = element(id);
    if(isDropdownOpen(id) && host?.dataset.dropdownMode === 'all'){ closeDropdown(id); return; }
    renderDropdown(id,items,render,onSelect,'all');
    const binding = DROPDOWN_BINDINGS[id];
    element(binding?.inputId)?.focus({preventScroll:true});
  }

  function syncDropdownAvailability(){
    const productToggle = element('production-product-toggle');
    const processToggle = element('production-process-toggle');
    if(productToggle) productToggle.disabled = !state.order || !state.orderReady;
    if(processToggle) processToggle.disabled = !state.orderReady || !state.product;
  }

  function resetQuantityProgress(){
    state.processTotal = null;
    state.processTotalLoading = false;
    state.processTotalRequest += 1;
    const progress = element('production-quantity-progress');
    if(progress){
      progress.hidden = true;
      progress.classList.remove('is-over');
      progress.disabled = true;
    }
  }

  function quantityProgress(){
    if(!state.process || !state.processTotal) return null;
    const inputValue = String(element('production-quantity-input')?.value || '').trim();
    const quantity = /^\d+$/.test(inputValue) ? Number(inputValue) : 0;
    const registeredQuantity = Number(state.processTotal.registeredQuantity) || 0;
    const orderQuantity = Number(state.processTotal.orderQuantity) || Number(state.process.orderQty) || 0;
    const projectedQuantity = registeredQuantity + quantity;
    return {
      registeredQuantity,orderQuantity,quantity,projectedQuantity,
      exceededQuantity:Math.max(0,projectedQuantity-orderQuantity)
    };
  }

  function renderQuantityProgress(){
    const progress = element('production-quantity-progress');
    const value = element('production-quantity-progress-value');
    const summary = quantityProgress();
    if(!progress || !value || !summary || summary.orderQuantity <= 0){
      if(progress) progress.hidden = true;
      return;
    }
    progress.hidden = false;
    const canOpenRecords = typeof window.canOpenPage !== 'function' || window.canOpenPage('production-records');
    progress.disabled = !canOpenRecords;
    if(state.processTotalLoading){
      progress.classList.remove('is-over');
      value.textContent = `… / ${numberText(summary.orderQuantity)}`;
      progress.title = 'Đang đọc số lượng đã ghi nhận / 正在讀取已登記數量';
      return;
    }
    const over = summary.exceededQuantity > 0;
    progress.classList.toggle('is-over',over);
    value.textContent = `${numberText(summary.projectedQuantity)} / ${numberText(summary.orderQuantity)}${over ? ` (+${numberText(summary.exceededQuantity)})` : ''}`;
    progress.title = over
      ? `Vượt ${numberText(summary.exceededQuantity)} / 超出 ${numberText(summary.exceededQuantity)}`
      : `Đã ghi nhận ${numberText(summary.registeredQuantity)} / 已登記 ${numberText(summary.registeredQuantity)}`;
  }

  async function loadQuantityProgress(process){
    const request = ++state.processTotalRequest;
    state.processTotalLoading = true;
    state.processTotal = {
      registeredQuantity:0,
      orderQuantity:Number(process?.orderQty) || 0
    };
    renderQuantityProgress();
    try{
      const total = await window.PCMSProductionEntryStore.loadProcessTotal(process?.id);
      if(request !== state.processTotalRequest || state.process?.id !== process?.id) return;
      state.processTotal = total;
      state.processTotalLoading = false;
      renderQuantityProgress();
    }catch(error){
      if(request !== state.processTotalRequest || state.process?.id !== process?.id) return;
      resetQuantityProgress();
      setStatus('Không thể đọc số lượng đã ghi nhận.','無法讀取目前已登記數量。','danger');
    }
  }

  function employeeOptionCopy(item){
    return {primary:`${item.employeeId} · ${item.name}`,secondary:item.department || ''};
  }

  function orderOptionCopy(item){
    return {
      primary:item.orderId || item.id,
      secondary:[item.client,item.dueDate && typeof fmtVN === 'function' ? fmtVN(item.dueDate) : ''].filter(Boolean).join(' · ')
    };
  }

  function productOptionCopy(item){
    return {primary:item.code,secondary:[item.desc,item.color,item.size].filter(Boolean).join(' · ')};
  }

  function processOptionCopy(item){
    return {
      primary:`${item.processNo} · ${item.processVi || item.processZh || ''}`,
      secondary:item.processZh && item.processVi ? item.processZh : ''
    };
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
    const input = element('production-employee-input');
    const value = input.value.trim();
    if(state.employee && value.toUpperCase() !== state.employee.employeeId) clearEmployee();
    if(!value){ closeDropdown('production-employee-options'); return; }
    const matches = window.PCMSProductionEmployees.search(value,{activeOnly:true,limit:20});
    renderDropdown('production-employee-options',matches,employeeOptionCopy,selectEmployee);
  }

  function toggleEmployeeDropdown(){
    toggleDropdown(
      'production-employee-options',
      window.PCMSProductionEmployees.list({activeOnly:true}),
      employeeOptionCopy,
      selectEmployee
    );
  }

  function clearOrder(){
    state.order = null;
    state.orderReady = false;
    state.product = null;
    state.process = null;
    element('production-product-input').value = '';
    element('production-process-input').value = '';
    element('production-quantity-input').value = '';
    resetQuantityProgress();
    closeDropdown('production-product-options');
    closeDropdown('production-process-options');
    syncDropdownAvailability();
  }

  async function selectOrder(order){
    state.order = order;
    state.orderReady = false;
    state.product = null;
    state.process = null;
    element('production-order-input').value = order.orderId || order.id;
    element('production-product-input').value = '';
    element('production-process-input').value = '';
    element('production-quantity-input').value = '';
    resetQuantityProgress();
    closeDropdown('production-order-options');
    closeDropdown('production-product-options');
    closeDropdown('production-process-options');
    syncDropdownAvailability();
    setStatus('Đang tải công đoạn của đơn hàng…','正在載入訂單工序…','info');
    try{
      await window.PCMSProductionEntryStore.loadProcesses(order.id);
      if(state.order?.id !== order.id) return;
      state.orderReady = true;
      syncDropdownAvailability();
      setStatus('Đã tải công đoạn. Có thể nhập mã hàng.','工序已載入，可以輸入款號。','success');
    }catch(error){
      if(state.order?.id !== order.id) return;
      clearOrder();
      setStatus('Không thể tải công đoạn của đơn hàng.','無法載入訂單工序。','danger');
      await showError(error);
    }
  }

  function handleOrderInput(){
    const input = element('production-order-input');
    const value = input.value.trim();
    if(state.order && value !== (state.order.orderId || state.order.id)) clearOrder();
    if(!value){ closeDropdown('production-order-options'); return; }
    const matches = window.PCMSProductionEntryStore.searchOrders(value,20);
    renderDropdown('production-order-options',matches,orderOptionCopy,item=>void selectOrder(item));
  }

  function toggleOrderDropdown(){
    toggleDropdown(
      'production-order-options',
      window.PCMSProductionEntryStore.listOrders(),
      orderOptionCopy,
      item=>void selectOrder(item)
    );
  }

  function clearProduct(){
    state.product = null;
    state.process = null;
    element('production-process-input').value = '';
    element('production-quantity-input').value = '';
    resetQuantityProgress();
    closeDropdown('production-process-options');
    syncDropdownAvailability();
  }

  function selectProduct(product){
    state.product = product;
    state.process = null;
    element('production-product-input').value = product.code;
    element('production-process-input').value = '';
    element('production-quantity-input').value = '';
    resetQuantityProgress();
    closeDropdown('production-product-options');
    syncDropdownAvailability();
  }

  function handleProductInput(){
    if(!state.order || !state.orderReady){ closeDropdown('production-product-options'); return; }
    const input = element('production-product-input');
    const value = input.value.trim();
    if(state.product && value !== state.product.code) clearProduct();
    if(!value){ closeDropdown('production-product-options'); return; }
    const matches = window.PCMSProductionEntryStore.searchProducts(state.order.id,value,20);
    renderDropdown('production-product-options',matches,productOptionCopy,selectProduct);
  }

  function toggleProductDropdown(){
    if(!state.order || !state.orderReady) return;
    toggleDropdown(
      'production-product-options',
      window.PCMSProductionEntryStore.productsForOrder(state.order.id),
      productOptionCopy,
      selectProduct
    );
  }

  function selectProcess(process,options={}){
    state.process = process;
    element('production-process-input').value = String(process.processNo || '');
    closeDropdown('production-process-options');
    setStatus('','','info');
    void loadQuantityProgress(process);
    if(options.focusQuantity === true) element('production-quantity-input')?.focus({preventScroll:true});
  }

  function handleProcessInput(){
    state.process = null;
    resetQuantityProgress();
    if(!state.orderReady || !state.product){ closeDropdown('production-process-options'); return; }
    const value = element('production-process-input').value.trim();
    if(!value){ closeDropdown('production-process-options'); return; }
    const possible = window.PCMSProductionEntryStore.getLoadedProcesses(state.order.id)
      .filter(item=>String(item.code || '') === state.product.code)
      .filter(item=>!value || String(item.processNo || '').includes(value))
      .slice(0,20);
    renderDropdown('production-process-options',possible,processOptionCopy,selectProcess);
  }

  function toggleProcessDropdown(){
    if(!state.orderReady || !state.product) return;
    const processes = window.PCMSProductionEntryStore.getLoadedProcesses(state.order.id)
      .filter(item=>String(item.code || '') === state.product.code);
    toggleDropdown('production-process-options',processes,processOptionCopy,selectProcess);
  }

  function processForExactInput(){
    if(!state.orderReady || !state.product) return null;
    return window.PCMSProductionEntryStore.findProcess(
      state.order?.id,
      state.product.code,
      element('production-process-input').value
    );
  }

  function openDropdownForInput(id){
    if(id === 'production-employee-options') toggleEmployeeDropdown();
    else if(id === 'production-order-options') toggleOrderDropdown();
    else if(id === 'production-product-options') toggleProductDropdown();
    else if(id === 'production-process-options') toggleProcessDropdown();
  }

  function handleDropdownKeyboard(event,id){
    if(event.key === 'Escape'){
      closeDropdown(id);
      return;
    }
    if(event.key === 'Enter' && selectDropdownActive(id)){
      event.preventDefault();
      return;
    }
    if(event.key === 'Enter' && id === 'production-process-options'){
      const exact = processForExactInput();
      if(exact){
        event.preventDefault();
        selectProcess(exact,{focusQuantity:true});
        return;
      }
    }
    if(event.key === 'ArrowDown' || event.key === 'ArrowUp'){
      event.preventDefault();
      if(!isDropdownOpen(id)) openDropdownForInput(id);
      const interaction = dropdownInteractions.get(id);
      if(!interaction) return;
      const nextIndex = interaction.activeIndex < 0
        ? (event.key === 'ArrowDown' ? 0 : interaction.items.length-1)
        : interaction.activeIndex + (event.key === 'ArrowDown' ? 1 : -1);
      setDropdownActive(id,nextIndex);
      return;
    }
    if(event.key !== 'Enter') return;
    if(id === 'production-process-options' && element('production-process-input').value.trim()){
      event.preventDefault();
      setStatus('Không tìm thấy số công đoạn chính xác.','找不到完全相符的工序號。','danger');
    }
  }

  function handleEntryTab(event,currentIndex){
    if(event.key !== 'Tab') return;
    event.preventDefault();
    DROPDOWN_OPTION_IDS.forEach(closeDropdown);
    const offset = event.shiftKey ? -1 : 1;
    const targetIndex = (currentIndex + offset + ENTRY_INPUT_IDS.length) % ENTRY_INPUT_IDS.length;
    element(ENTRY_INPUT_IDS[targetIndex])?.focus({preventScroll:true});
  }

  async function openSelectedProcessRecords(){
    if(!state.order || !state.product || !state.process) return;
    if(typeof window.canOpenPage === 'function' && !window.canOpenPage('production-records')) return;
    try{
      await window.PCMSFeatures?.ensurePageScripts?.('production-records');
      window.PCMSProductionRecords?.setPendingFilters?.({
        order:state.order.orderId || state.order.id,
        product:state.product.code,
        process:String(state.process.processNo || '')
      });
      if(typeof window.sp === 'function') await window.sp('production-records');
    }catch(error){ await showError(error); }
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
    header.dataset.productionColumn = 'action';
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
    button.tabIndex = -1;
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
      if(state.process) void loadQuantityProgress(state.process);
      setStatus('Đã xóa vĩnh viễn bản ghi sản xuất.','生產紀錄已永久刪除。','success');
    }catch(error){ await showError(error); }
  }

  async function saveEntry(){
    if(state.processTotalLoading){
      setStatus('Đang kiểm tra số lượng đã ghi nhận.','正在確認目前已登記數量。','info');
      return null;
    }
    const preview = quantityProgress();
    if(preview?.exceededQuantity > 0){
      setStatus(
        `Số lượng dự kiến vượt ${numberText(preview.exceededQuantity)}.`,
        `預計數量超出 ${numberText(preview.exceededQuantity)}。`,
        'danger'
      );
      element('production-quantity-input')?.focus({preventScroll:true});
      return null;
    }
    const quantityInput = element('production-quantity-input');
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
        resetQuantityProgress();
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
      controls:[quantityInput],
      cooldownMs:1000,
      onDuplicate:()=>setStatus('Đang lưu, vui lòng chờ.','正在儲存，請稍候。','info')
    }).catch(()=>null);
  }

  function appendCell(row,value,className='',columnKey=''){
    const cell = document.createElement('td');
    if(className) cell.className = className;
    if(columnKey) cell.dataset.productionColumn = columnKey;
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
      appendCell(row,item.orderNo || '—','', 'order');
      appendCell(row,item.productCode || '—','', 'product');
      appendCell(row,item.processNo || '—','production-number-cell','processNo');
      appendCell(row,item.processNameVi || item.processNameZh || '—','', 'processName');
      appendCell(row,numberText(item.quantity),'production-number-cell','quantity');
      appendCell(row,numberText(item.orderQtySnapshot),'production-number-cell','orderQuantity');
      appendCell(row,numberText(item.processSecSnapshot),'production-number-cell','processSeconds');
      if(isAdmin()){
        const actionCell = document.createElement('td');
        actionCell.className = 'production-row-actions';
        actionCell.dataset.productionColumn = 'action';
        actionCell.appendChild(deleteButton(item));
        row.appendChild(actionCell);
      }
      body.appendChild(row);
    });
    if(empty) empty.hidden = rows.length > 0;
    applyColumnVisibility();
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

  function dateObject(value){
    const [year,month,day] = String(value || '').split('-').map(Number);
    const result = new Date(year,month-1,day);
    return Number.isFinite(result.getTime()) ? result : new Date();
  }

  function syncDateControls(){
    const date = element('production-date-input');
    const next = element('production-date-next');
    if(!date) return;
    const maximum = today();
    date.max = maximum;
    if(date.value > maximum) date.value = maximum;
    if(next) next.disabled = !date.value || date.value >= maximum;
  }

  function setProductionDate(value,{auto=false}={}){
    const date = element('production-date-input');
    if(!date) return;
    const maximum = today();
    date.value = value > maximum ? maximum : value;
    state.dateAuto = auto || date.value === maximum;
    syncDateControls();
    void loadDailyRows();
  }

  function shiftProductionDate(days){
    const current = dateObject(element('production-date-input')?.value || today());
    current.setDate(current.getDate()+days);
    const value = typeof formatLocalDate === 'function' ? formatLocalDate(current) : current.toISOString().slice(0,10);
    if(days > 0 && value > today()) return;
    setProductionDate(value,{auto:value === today()});
  }

  function openProductionCalendar(){
    const date = element('production-date-input');
    if(!date) return;
    date.focus({preventScroll:true});
    if(typeof date.showPicker === 'function') date.showPicker();
    else date.click();
  }

  function startDateTimer(){
    if(state.dateTimer) return;
    state.dateTimer = setInterval(()=>{
      if(!state.dateAuto) return;
      const current = today();
      if(element('production-date-input').value !== current){
        element('production-date-input').value = current;
        syncDateControls();
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
    syncDateControls();
    date.addEventListener('change',()=>setProductionDate(date.value,{auto:date.value === today()}));
    date.addEventListener('keydown',event=>{
      if(event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      shiftProductionDate(event.key === 'ArrowUp' ? -1 : 1);
    });
    element('production-calendar-button').addEventListener('click',openProductionCalendar);
    element('production-date-previous').addEventListener('click',()=>shiftProductionDate(-1));
    element('production-date-next').addEventListener('click',()=>shiftProductionDate(1));
    element('production-employee-input').addEventListener('input',handleEmployeeInput);
    element('production-order-input').addEventListener('input',handleOrderInput);
    element('production-product-input').addEventListener('input',handleProductInput);
    element('production-process-input').addEventListener('input',handleProcessInput);
    element('production-quantity-input').addEventListener('input',renderQuantityProgress);
    element('production-quantity-input').addEventListener('keydown',event=>{
      if(event.key !== 'Enter') return;
      event.preventDefault();
      void saveEntry();
    });
    element('production-employee-toggle').addEventListener('click',toggleEmployeeDropdown);
    element('production-order-toggle').addEventListener('click',toggleOrderDropdown);
    element('production-product-toggle').addEventListener('click',toggleProductDropdown);
    element('production-process-toggle').addEventListener('click',toggleProcessDropdown);
    element('production-quantity-progress').addEventListener('click',()=>void openSelectedProcessRecords());
    element('production-column-settings-button').addEventListener('click',toggleColumnSettings);
    element('production-column-settings-reset').addEventListener('click',resetColumnVisibility);
    document.querySelectorAll('[data-production-column-toggle]').forEach(input=>{
      input.addEventListener('change',()=>setColumnVisibility(input.dataset.productionColumnToggle,input.checked));
    });
    document.querySelectorAll('#pg-production-entry .production-combobox').forEach(host=>{
      host.addEventListener('mouseleave',()=>{
        const options = host.querySelector('.production-options'); // options（目前欄位的搜尋選單）
        if(options?.id) closeDropdown(options.id);
      });
    });
    Object.entries(DROPDOWN_BINDINGS).forEach(([optionsId,binding])=>{
      element(binding.inputId)?.addEventListener('keydown',event=>handleDropdownKeyboard(event,optionsId));
    });
    ENTRY_INPUT_IDS.forEach((id,index)=>{
      element(id)?.addEventListener('keydown',event=>handleEntryTab(event,index));
    });
    document.addEventListener('click',event=>{
      if(!event.target.closest('.production-combobox')){
        DROPDOWN_OPTION_IDS.forEach(closeDropdown);
      }
      if(!event.target.closest('.production-column-settings')) closeColumnSettings();
    });
    document.addEventListener('keydown',event=>{
      if(event.key !== 'Escape') return;
      DROPDOWN_OPTION_IDS.forEach(closeDropdown);
      closeColumnSettings();
    });
    syncDropdownAvailability();
    applyColumnVisibility();
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
    syncDateControls();
    startDateTimer();
    if(state.employee) await loadDailyRows();
  }

  function productionEntryLeave(){
    stopDateTimer();
    DROPDOWN_OPTION_IDS.forEach(closeDropdown);
    closeColumnSettings();
  }

  window.loadProductionEntryData = loadProductionEntryData;
  window.productionEntryInit = productionEntryInit;
  window.productionEntryLeave = productionEntryLeave;
})();
