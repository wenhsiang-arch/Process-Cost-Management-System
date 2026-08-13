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
    supplementMode:false,
    processTotal:null,
    processTotalLoading:false,
    processTotalRequest:0,
    attendanceRequest:0,
    processRowsRequest:0,
    processRowsMode:false,
    processRowsProcessId:'',
    dailyRows:[],
    pendingContext:null
  }; // state（登記頁目前狀態）

  const PRODUCTION_TABLE_COLUMNS = Object.freeze([
    {key:'date',label:{vi:'Ngày',zh:'日期'},minimum:90,preferred:96,maximum:112,available:()=>state.processRowsMode},
    {key:'employeeId',label:{vi:'Mã nhân viên',zh:'員工工號'},minimum:92,preferred:100,maximum:124,available:()=>state.processRowsMode},
    {key:'employeeName',label:{vi:'Tên nhân viên',zh:'員工姓名'},minimum:110,preferred:128,maximum:180,available:()=>state.processRowsMode},
    {key:'order',label:{vi:'Đơn hàng',zh:'訂單'},minimum:116,preferred:128,maximum:190},
    {key:'product',label:{vi:'Mã hàng',zh:'款號'},minimum:96,preferred:108,maximum:160},
    {key:'orderQuantity',label:{vi:'Số lượng đơn hàng',zh:'訂單數量'},headerLabel:{vi:'SL đơn hàng',zh:'訂單數量'},minimum:98,preferred:104,maximum:128},
    {key:'processNo',label:{vi:'Số công đoạn',zh:'工序號'},headerLabel:{vi:'Số CĐ',zh:'工序號'},minimum:68,preferred:72,maximum:84},
    {key:'processName',label:{vi:'Tên công đoạn',zh:'工序名稱'},minimum:190,preferred:240,maximum:420},
    {key:'quantity',label:{vi:'Số lượng sản xuất',zh:'生產數量'},headerLabel:{vi:'SL sản xuất',zh:'生產數量'},minimum:100,preferred:106,maximum:132},
    {key:'supplementHours',label:{vi:'Giờ bổ sung',zh:'補充工時'},minimum:100,preferred:106,maximum:132},
    {key:'processSeconds',label:{vi:'Giây công đoạn',zh:'工序秒數'},headerLabel:{vi:'Giây',zh:'工序秒數'},minimum:76,preferred:82,maximum:100},
    {key:'hourlyCapacity',label:{vi:'Số lượng mỗi giờ',zh:'每小時數量'},headerLabel:{vi:'SL/giờ',zh:'每小時數量'},minimum:86,preferred:92,maximum:112},
    {key:'status',label:{vi:'Trạng thái',zh:'狀態'},minimum:90,preferred:96,maximum:116},
    {key:'action',label:{vi:'Thao tác',zh:'操作'},minimum:106,preferred:112,maximum:128,available:()=>canManageRecords()}
  ]); // PRODUCTION_TABLE_COLUMNS（當日表格欄位）：權限結果與可拖曳寬度限制仍由產能功能提供。

  const ENTRY_INPUT_IDS = Object.freeze([
    'production-employee-input','production-entry-employee-name-input','production-date-input','production-order-input',
    'production-product-input','production-process-input','production-process-name','production-quantity-input'
  ]); // ENTRY_INPUT_IDS（生產登記鍵盤輸入順序）

  const ENTRY_TABLE_COLUMN_MINIMUMS = Object.freeze(Object.fromEntries(
    PRODUCTION_TABLE_COLUMNS.map(column=>[column.key,column.minimum])
  )); // ENTRY_TABLE_COLUMN_MINIMUMS（由正式欄位定義建立的各可見欄位最低可讀寬度）

  const dropdownControllers = new Map(); // dropdownControllers（產能登記使用的共用搜尋下拉控制器）
  let productionTableControl = null; // productionTableControl（當日表格共用操作控制）

  function element(id){ return document.getElementById(id); }
  function isAdmin(){ return window.cu?.role === 'admin'; }
  function canManageRecords(){
    return isAdmin() || typeof window.canOpenPage !== 'function' || window.canOpenPage('production-records');
  }
  function today(){ return typeof formatLocalDate === 'function' ? formatLocalDate(new Date()) : new Date().toISOString().slice(0,10); }
  function dateText(value){
    const parts = String(value || '').split('-');
    return parts.length === 3 ? `${parts[0]}/${parts[1]}/${parts[2]}` : String(value || '—');
  }
  function numberText(value){ return Number(value || 0).toLocaleString(); }
  function hoursText(value){
    const hours = Number(value);
    return Number.isFinite(hours) ? hours.toLocaleString(undefined,{minimumFractionDigits:hours % 1 === 0 ? 0 : 1,maximumFractionDigits:1}) : '—';
  }
  function hourlyCapacityText(value){
    const capacity = Number(value);
    return Number.isInteger(capacity) && capacity > 0 ? capacity.toLocaleString() : '—';
  }

  function setEntryLocalizedAttribute(target,attribute,vi,zh){
    if(!target) return false;
    return window.PCMSUIText.setLocalizedAttribute(target,attribute,{vi:String(vi || ''),zh:String(zh || '')});
  }

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

  function syncEntryTableMode(){
    const processMode = state.processRowsMode === true;
    const titleVi = element('production-entry-table-title-vi');
    const titleZh = element('production-entry-table-title-zh');
    const empty = element('production-entry-empty');
    if(titleVi) titleVi.textContent = processMode ? 'Đăng ký của công đoạn' : 'Sản lượng của nhân viên trong ngày';
    if(titleZh) titleZh.textContent = processMode ? '工序登記明細' : '員工當日生產紀錄';
    if(empty){
      window.PCMSUIText?.set?.(empty,processMode
        ? {vi:'Không có đăng ký hiệu lực cho công đoạn này',zh:'這個工序尚無有效登記'}
        : {vi:'Chọn nhân viên để xem dữ liệu trong ngày',zh:'選擇員工後顯示當日紀錄'});
    }
    productionTableControl?.refresh?.();
    renderQuantityProgress();
  }

  function setProcessRowsMode(active,processId=''){
    state.processRowsMode = active === true;
    state.processRowsProcessId = state.processRowsMode ? String(processId || '') : '';
    if(!state.processRowsMode) state.processRowsRequest += 1;
    syncEntryTableMode();
  }

  function restoreDailyRowsIfNeeded(){
    if(state.processRowsMode) void loadDailyRows();
  }

  function updateEntryTableMinimumWidth(table,visibleColumns=productionTableControl?.getVisibleKeys?.() || []){
    const minimumWidth = visibleColumns.reduce((total,key)=>total+(ENTRY_TABLE_COLUMN_MINIMUMS[key] || 0),0);
    table.style.setProperty('--ui-table-visible-min-width',`${minimumWidth}px`);
    window.PCMSUITable?.refresh?.();
    return visibleColumns.length;
  }

  function syncProductionEmptyState(visibleColumnCount){
    const empty = element('production-entry-empty');
    const body = element('production-entry-table-body');
    if(empty) empty.hidden = visibleColumnCount === 0 || Boolean(body?.children.length);
  }

  function ensureProductionTableControl(){
    if(productionTableControl){
      productionTableControl.refresh();
      return productionTableControl;
    }
    productionTableControl = window.PCMSUITableControls.create({
      root:'#pg-production-entry',
      table:'#production-entry-table',
      settings:'#production-column-settings',
      settingsButton:'#production-column-settings-button',
      settingsMenu:'#production-column-settings-menu',
      frame:'#production-entry-table-frame',
      empty:'#production-columns-empty',
      columns:PRODUCTION_TABLE_COLUMNS,
      onColumnsChanged:({visibleKeys,visibleCount})=>{
        updateEntryTableMinimumWidth(element('production-entry-table'),visibleKeys);
        syncProductionEmptyState(visibleCount);
      },
      onSortChanged:()=>renderDailyRows(state.dailyRows,{store:false})
    });
    return productionTableControl;
  }

  function closeDropdown(id){
    dropdownControllers.get(id)?.close();
  }

  function closeAllDropdowns(){
    dropdownControllers.forEach(controller=>controller.close());
  }

  function syncDropdownAvailability(){
    const productToggle = element('production-product-toggle');
    const processToggle = element('production-process-toggle');
    if(productToggle) productToggle.disabled = !state.order || !state.orderReady;
    if(processToggle) processToggle.disabled = state.supplementMode || !state.orderReady || !state.product;
  }

  function resetQuantityProgress(){
    state.processTotal = null;
    state.processTotalLoading = false;
    state.processTotalRequest += 1;
    const progress = element('production-quantity-progress');
    if(progress){
      progress.hidden = true;
      progress.classList.remove('is-complete','is-over');
      progress.disabled = true;
    }
    const overCopy = element('production-quantity-progress-over');
    if(overCopy) overCopy.hidden = true;
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
    const overCopy = element('production-quantity-progress-over');
    const overVi = element('production-quantity-progress-over-vi');
    const overZh = element('production-quantity-progress-over-zh');
    const summary = quantityProgress();
    if(!progress || !value || !summary || summary.orderQuantity <= 0){
      if(progress) progress.hidden = true;
      if(overCopy) overCopy.hidden = true;
      return;
    }
    progress.hidden = false;
    progress.disabled = !state.employee;
    if(state.processTotalLoading){
      progress.classList.remove('is-complete','is-over');
      if(overCopy) overCopy.hidden = true;
      value.textContent = `… / ${numberText(summary.orderQuantity)}`;
      setEntryLocalizedAttribute(progress,'title','Đang đọc số lượng đã ghi nhận','正在讀取已登記數量');
      return;
    }
    const over = summary.exceededQuantity > 0;
    const complete = !over && summary.registeredQuantity >= summary.orderQuantity;
    progress.classList.toggle('is-complete',complete);
    progress.classList.toggle('is-over',over);
    value.textContent = `${numberText(summary.registeredQuantity)} / ${numberText(summary.orderQuantity)}`;
    if(overCopy) overCopy.hidden = !over;
    if(overVi) overVi.textContent = `Vượt +${numberText(summary.exceededQuantity)}`;
    if(overZh) overZh.textContent = `超量 +${numberText(summary.exceededQuantity)}`;
    const detailHint = state.processRowsMode
      ? {vi:'Nhấn để trở về dữ liệu trong ngày',zh:'點擊返回員工當日紀錄'}
      : {vi:'Nhấn để chỉ xem đăng ký của công đoạn',zh:'點擊只顯示此工序登記'};
    const quantityTitle = over
      ? {
        vi:`Đã đăng ký ${numberText(summary.registeredQuantity)}, dự kiến vượt ${numberText(summary.exceededQuantity)}`,
        zh:`已登記 ${numberText(summary.registeredQuantity)}，預計超量 ${numberText(summary.exceededQuantity)}`
      }
      : {
        vi:`Đã đăng ký ${numberText(summary.registeredQuantity)} / ${numberText(summary.orderQuantity)}`,
        zh:`已登記 ${numberText(summary.registeredQuantity)} / ${numberText(summary.orderQuantity)}`
      };
    setEntryLocalizedAttribute(progress,'title',`${quantityTitle.vi} · ${detailHint.vi}`,`${quantityTitle.zh} · ${detailHint.zh}`);
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

  function employeeIdOptionCopy(item){
    return {primary:item.employeeId,secondary:[item.name,item.department].filter(Boolean).join(' · ')};
  }

  function employeeNameOptionCopy(item){
    return {primary:item.name||item.employeeId,secondary:[item.employeeId,item.department].filter(Boolean).join(' · ')};
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
    return {primary:String(item.processNo || ''),secondary:''};
  }

  function setProcessName(process){
    const host = element('production-process-name');
    if(!host) return;
    const processVi = String(process?.processVi || '').trim();
    const processZh = String(process?.processZh || '').trim();
    host.value = processVi || processZh || '';
    setEntryLocalizedAttribute(host,'title',processVi,processZh);
  }

  function setSupplementMode(enabled,options={}){
    const active = enabled === true;
    const reasonInput = element('production-process-name');
    const valueInput = element('production-quantity-input');
    state.supplementMode = active;
    state.process = null;
    if(options.clearValues !== false){
      if(reasonInput) reasonInput.value = '';
      if(valueInput) valueInput.value = '';
    }
    if(reasonInput){
      reasonInput.readOnly = !active;
      reasonInput.tabIndex = active ? 0 : -1;
      setEntryLocalizedAttribute(reasonInput,'placeholder',active ? 'Nhập lý do' : '—',active ? '輸入原因' : '—');
      setEntryLocalizedAttribute(reasonInput,'title',active ? 'Lý do bổ sung giờ' : '',active ? '補充工時原因' : '');
    }
    if(valueInput){
      valueInput.min = active ? '0.5' : '1';
      valueInput.max = active ? '24' : '';
      valueInput.step = active ? '0.5' : '1';
      valueInput.inputMode = active ? 'decimal' : 'numeric';
      setEntryLocalizedAttribute(valueInput,'placeholder',active ? '0.5–24 · Enter để lưu' : 'Enter để lưu','Enter 儲存');
    }
    const labelCopy = active
      ? {processVi:'Lý do',processZh:'原因',valueVi:'Giờ',valueZh:'小時'}
      : {processVi:'Công đoạn',processZh:'工序',valueVi:'Số lượng',valueZh:'數量'};
    element('production-process-name-label-vi').textContent = labelCopy.processVi;
    element('production-process-name-label-zh').textContent = labelCopy.processZh;
    element('production-quantity-label-vi').textContent = labelCopy.valueVi;
    element('production-quantity-label-zh').textContent = labelCopy.valueZh;
    element('production-process-name')?.closest('.production-entry-context-panel')?.classList.toggle('is-supplement-mode',active);
    resetQuantityProgress();
    closeDropdown('production-process-options');
    syncDropdownAvailability();
  }

  function clearEmployee(options={}){
    state.employee = null;
    const employeeIdInput=element('production-employee-input');
    const employeeNameInput=element('production-entry-employee-name-input');
    const department = element('production-employee-department');
    if(employeeIdInput&&options.keepId!==true) employeeIdInput.value='';
    if(employeeNameInput&&options.keepName!==true) employeeNameInput.value='';
    if(department) department.textContent = '—';
    setAttendanceSummary('Chưa chọn','尚未選擇');
    state.attendanceRequest += 1;
    setProcessRowsMode(false);
    renderDailyRows([]);
  }

  function setAttendanceSummary(vi,zh){
    const viNode = element('production-entry-attendance-summary-vi');
    const zhNode = element('production-entry-attendance-summary-zh');
    if(viNode) viNode.textContent = String(vi || '—');
    if(zhNode){
      zhNode.textContent = String(zh || '');
      zhNode.hidden = !zh;
    }
  }

  async function refreshAttendanceSummary(){
    const requestId = ++state.attendanceRequest;
    const employeeId = state.employee?.employeeId;
    const productionDate = element('production-date-input')?.value;
    if(!employeeId || !productionDate){
      setAttendanceSummary('Chưa chọn','尚未選擇');
      return;
    }
    setAttendanceSummary('Đang tải...','正在載入…');
    try{
      const attendance = await window.PCMSProductionAttendance.loadOne(employeeId,productionDate,{force:true});
      if(requestId !== state.attendanceRequest) return;
      if(!attendance){
        setAttendanceSummary('Chưa chấm công','考勤未登記');
        return;
      }
      const total = Number(attendance.normalHours || 0)+Number(attendance.overtimeHours || 0);
      setAttendanceSummary(hoursText(total),'');
    }catch(error){
      if(requestId !== state.attendanceRequest) return;
      setAttendanceSummary('Không thể tải','無法載入');
      console.warn('Không thể tải giờ chấm công / 無法載入考勤時數：',error);
    }
  }

  function selectEmployee(employee){
    state.employee = employee;
    element('production-employee-input').value = employee.employeeId;
    element('production-entry-employee-name-input').value = employee.name || '';
    element('production-employee-department').textContent = employee.department || '—';
    closeDropdown('production-employee-options');
    closeDropdown('production-employee-name-options');
    setStatus('','','info');
    void loadDailyRows();
    void refreshAttendanceSummary();
  }

  function employeeDropdownConfig(optionsId){
    return optionsId==='production-employee-name-options'
      ? {inputId:'production-entry-employee-name-input',keepName:true}
      : {inputId:'production-employee-input',keepId:true};
  }

  function employeeValueMatches(employee,optionsId){
    const config=employeeDropdownConfig(optionsId);
    const value=element(config.inputId)?.value;
    const expected=optionsId==='production-employee-name-options'?employee?.name:employee?.employeeId;
    return window.PCMSUISearchDropdown.isExact(value,expected);
  }

  function handleEmployeeInput(optionsId){
    const config=employeeDropdownConfig(optionsId);
    const input = element(config.inputId);
    const value = input.value.trim();
    if(state.employee&&!employeeValueMatches(state.employee,optionsId)) clearEmployee(config);
    return Boolean(value);
  }

  // confirmEmployeeInput（確認員工輸入）：目前智慧篩選只剩一筆時可由 Tab 或 Enter 選取。
  function confirmEmployeeInput(optionsId){
    const config=employeeDropdownConfig(optionsId);
    const input=element(config.inputId);
    const value=String(input?.value||'').trim();
    if(!value){ closeDropdown(optionsId);return true; }
    if(state.employee&&employeeValueMatches(state.employee,optionsId)){
      selectEmployee(state.employee);
      return true;
    }
    const controller=dropdownControllers.get(optionsId);
    const matches=controller?.matches(value,100)||[];
    if(matches.length===1){ selectEmployee(matches[0]);return true; }
    if(matches.length===0){
      closeDropdown(optionsId);
      setStatus('Không tìm thấy nhân viên phù hợp.','找不到符合的員工。','danger');
    }else{
      controller?.open();
      setStatus('Có nhiều nhân viên phù hợp. Vui lòng chọn một người.','找到多位符合的員工，請選擇一位。','warning');
    }
    input?.focus({preventScroll:true});
    return false;
  }

  function clearOrder(){
    restoreDailyRowsIfNeeded();
    state.order = null;
    state.orderReady = false;
    state.product = null;
    setSupplementMode(false);
    element('production-product-input').value = '';
    element('production-process-input').value = '';
    setProcessName(null);
    closeDropdown('production-product-options');
    closeDropdown('production-process-options');
    syncDropdownAvailability();
  }

  async function selectOrder(order,options={}){
    state.order = order;
    state.orderReady = false;
    state.product = null;
    setSupplementMode(false);
    element('production-order-input').value = order.orderId || order.id;
    element('production-product-input').value = '';
    element('production-process-input').value = '';
    setProcessName(null);
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
      if(options.focusProduct === true) element('production-product-input')?.focus({preventScroll:true});
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
    if(value) input.title=value;
    else input.removeAttribute('title');
    return Boolean(value);
  }

  function clearProduct(){
    restoreDailyRowsIfNeeded();
    state.product = null;
    setSupplementMode(false);
    element('production-process-input').value = '';
    setProcessName(null);
    closeDropdown('production-process-options');
    syncDropdownAvailability();
  }

  function selectProduct(product,options={}){
    state.product = product;
    setSupplementMode(false);
    element('production-product-input').value = product.code;
    element('production-process-input').value = '';
    setProcessName(null);
    closeDropdown('production-product-options');
    syncDropdownAvailability();
    if(options.focusProcess === true) element('production-process-input')?.focus({preventScroll:true});
  }

  function handleProductInput(){
    if(!state.order || !state.orderReady){ closeDropdown('production-product-options'); return false; }
    const input = element('production-product-input');
    const value = input.value.trim();
    if(state.product && value !== state.product.code) clearProduct();
    if(value) input.title=value;
    else input.removeAttribute('title');
    return Boolean(value);
  }

  function selectProcess(process,options={}){
    restoreDailyRowsIfNeeded();
    setSupplementMode(false);
    state.process = process;
    element('production-process-input').value = String(process.processNo || '');
    setProcessName(process);
    closeDropdown('production-process-options');
    setStatus('','','info');
    void loadQuantityProgress(process);
    if(options.focusQuantity === true) element('production-quantity-input')?.focus({preventScroll:true});
  }

  function handleProcessInput(){
    restoreDailyRowsIfNeeded();
    state.process = null;
    setProcessName(null);
    resetQuantityProgress();
    const value = element('production-process-input').value.trim();
    if(value === '0'){
      setSupplementMode(true);
      setStatus('Đã bật chế độ bổ sung giờ.','已啟動補充工時模式。','info');
      return false;
    }
    if(state.supplementMode) setSupplementMode(false);
    if(!state.orderReady || !state.product){ closeDropdown('production-process-options'); return false; }
    return Boolean(value);
  }

  function processForExactInput(){
    if(!state.orderReady || !state.product) return null;
    return window.PCMSProductionEntryStore.findProcess(
      state.order?.id,
      state.product.code,
      element('production-process-input').value
    );
  }

  function orderForExactInput(){
    const value=element('production-order-input')?.value;
    return window.PCMSProductionEntryStore.listOrders().find(item=>
      window.PCMSUISearchDropdown.isExact(value,item.orderId||item.id)
      || window.PCMSUISearchDropdown.isExact(value,item.id)
    )||null;
  }

  function productForExactInput(){
    if(!state.orderReady||!state.order) return null;
    const value=element('production-product-input')?.value;
    return window.PCMSProductionEntryStore.productsForOrder(state.order.id)
      .find(item=>window.PCMSUISearchDropdown.isExact(value,item.code))||null;
  }

  function confirmOrderInput(options={}){
    const exact=orderForExactInput();
    if(!exact){
      dropdownControllers.get('production-order-options')?.open();
      setStatus('Vui lòng chọn đúng số đơn hàng trong danh sách.','請從清單選擇正確的訂單號碼。','warning');
      return false;
    }
    if(state.order?.id === exact.id && state.orderReady) return true;
    void selectOrder(exact,{focusProduct:options.focusNext===true});
    return options.focusNext===true?'handled':true;
  }

  function confirmProductInput(options={}){
    const exact=productForExactInput();
    if(!exact){
      dropdownControllers.get('production-product-options')?.open();
      setStatus('Vui lòng chọn đúng mã hàng trong danh sách.','請從清單選擇正確的款號。','warning');
      return false;
    }
    if(state.product?.code !== exact.code) selectProduct(exact,{focusProcess:options.focusNext===true});
    else if(options.focusNext===true) element('production-process-input')?.focus({preventScroll:true});
    return options.focusNext===true?'handled':true;
  }

  function confirmProcessInput(options={}){
    const value=element('production-process-input')?.value.trim()||'';
    if(value==='0'){
      setSupplementMode(true,{clearValues:false});
      if(options.focusNext===true) element('production-process-name')?.focus({preventScroll:true});
      return options.focusNext===true?'handled':true;
    }
    const exact=processForExactInput();
    if(!exact){
      dropdownControllers.get('production-process-options')?.open();
      setStatus('Không tìm thấy số công đoạn chính xác.','找不到完全相符的工序號。','danger');
      return false;
    }
    selectProcess(exact,{focusQuantity:options.focusNext===true});
    return options.focusNext===true?'handled':true;
  }

  function registerDropdown(optionsId,options){
    const controller=window.PCMSUISearchDropdown.create({
      root:element(options.inputId)?.closest('.ui-search-dropdown-control'),
      input:element(options.inputId),
      toggle:element(options.toggleId),
      list:element(optionsId),
      limit:20,
      ...options
    });
    dropdownControllers.set(optionsId,controller);
    return controller;
  }

  function initializeSearchDropdowns(){
    if(dropdownControllers.size) return;
    const employeeItems=()=>window.PCMSProductionEmployees.list({activeOnly:true});
    const employeeFields=[
      {value:item=>item.employeeId,mode:'code',weight:0},
      {value:item=>item.name,mode:'text',weight:10},
      {value:item=>item.department,mode:'text',weight:20}
    ];
    registerDropdown('production-employee-options',{
      inputId:'production-employee-input',toggleId:'production-employee-toggle',
      getItems:employeeItems,fields:employeeFields,renderItem:employeeIdOptionCopy,onSelect:selectEmployee,
      onInput:()=>handleEmployeeInput('production-employee-options'),
      onConfirm:()=>confirmEmployeeInput('production-employee-options')
    });
    registerDropdown('production-employee-name-options',{
      inputId:'production-entry-employee-name-input',toggleId:'production-employee-name-toggle',
      getItems:employeeItems,
      fields:[employeeFields[1],employeeFields[0],employeeFields[2]],
      renderItem:employeeNameOptionCopy,onSelect:selectEmployee,
      onInput:()=>handleEmployeeInput('production-employee-name-options'),
      onConfirm:()=>confirmEmployeeInput('production-employee-name-options')
    });
    registerDropdown('production-order-options',{
      inputId:'production-order-input',toggleId:'production-order-toggle',
      getItems:()=>window.PCMSProductionEntryStore.listOrders(),
      fields:[
        {value:item=>item.orderId||item.id,mode:'code',weight:0},
        {value:item=>item.client,mode:'text',weight:10}
      ],
      renderItem:orderOptionCopy,onSelect:item=>void selectOrder(item),onInput:handleOrderInput,
      onConfirm:()=>confirmOrderInput({focusNext:true})
    });
    registerDropdown('production-product-options',{
      inputId:'production-product-input',toggleId:'production-product-toggle',
      isEnabled:()=>Boolean(state.orderReady&&state.order),
      getItems:()=>state.order?window.PCMSProductionEntryStore.productsForOrder(state.order.id):[],
      fields:[
        {value:item=>item.code,mode:'code',weight:0},
        {value:item=>item.desc,mode:'text',weight:10},
        {value:item=>item.color,mode:'text',weight:20},
        {value:item=>item.size,mode:'text',weight:20},
        {value:item=>item.nameZh,mode:'text',weight:20}
      ],
      renderItem:productOptionCopy,onSelect:selectProduct,onInput:handleProductInput,
      onConfirm:()=>confirmProductInput({focusNext:true})
    });
    registerDropdown('production-process-options',{
      inputId:'production-process-input',toggleId:'production-process-toggle',mode:'numeric',
      isEnabled:()=>Boolean(!state.supplementMode&&state.orderReady&&state.product),
      getItems:()=>state.order?window.PCMSProductionEntryStore.getLoadedProcesses(state.order.id)
        .filter(item=>String(item.code||'')===String(state.product?.code||'')):[],
      fields:[{value:item=>item.processNo,mode:'numeric'}],
      renderItem:processOptionCopy,onSelect:selectProcess,onInput:handleProcessInput,
      onConfirm:()=>confirmProcessInput({focusNext:true})
    });
  }

  function entryInputIds(){
    return ENTRY_INPUT_IDS.filter(id=>id !== 'production-process-name' || state.supplementMode);
  }

  function handleEntryTab(event,currentId){
    const reverseShortcut=event.code === 'Backquote'
      && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !event.repeat;
    if(event.key !== 'Tab' && !reverseShortcut) return;
    const movingBackward=event.shiftKey || reverseShortcut;
    const employeeOptionsId=currentId === 'production-employee-input'
      ? 'production-employee-options'
      : (currentId === 'production-entry-employee-name-input' ? 'production-employee-name-options' : '');
    if(!movingBackward && employeeOptionsId && String(element(currentId)?.value || '').trim() && !confirmEmployeeInput(employeeOptionsId)){
      event.preventDefault();
      return;
    }
    if(!movingBackward && currentId === 'production-order-input'){
      const result=confirmOrderInput({focusNext:true});
      if(result!==true){ event.preventDefault(); return; }
    }
    if(!movingBackward && currentId === 'production-product-input'){
      const result=confirmProductInput({focusNext:true});
      if(result!==true){ event.preventDefault(); return; }
    }
    if(!movingBackward && currentId === 'production-process-input'){
      const result=confirmProcessInput({focusNext:true});
      if(result!==true){ event.preventDefault(); return; }
    }
    event.preventDefault();
    closeAllDropdowns();
    const inputIds = entryInputIds();
    const currentIndex = Math.max(0,inputIds.indexOf(currentId));
    const offset = movingBackward ? -1 : 1;
    const skipLinkedEmployeeName=!movingBackward && currentId === 'production-employee-input' && Boolean(state.employee);
    const targetIndex = (currentIndex + offset + (skipLinkedEmployeeName ? 1 : 0) + inputIds.length) % inputIds.length;
    element(inputIds[targetIndex])?.focus({preventScroll:true});
  }

  async function loadSelectedProcessRows(){
    if(!state.process || !state.employee) return;
    const processId = String(state.process.id || '');
    if(!processId) return;
    const request = ++state.processRowsRequest;
    setProcessRowsMode(true,processId);
    setStatus('Đang tải các đăng ký của công đoạn...','正在載入此工序的登記…','info');
    try{
      const rows = await window.PCMSProductionReports.loadProcess(processId,{activeOnly:true});
      if(request !== state.processRowsRequest || state.process?.id !== processId) return;
      renderDailyRows(rows);
      setStatus(
        `Chỉ hiển thị ${rows.length} đăng ký hiệu lực của công đoạn này. Nhấn lại khung số lượng để trở về dữ liệu trong ngày.`,
        `目前只顯示此工序的 ${rows.length} 筆有效登記；再次點擊數量框可返回員工當日紀錄。`,
        'info'
      );
    }catch(error){
      if(request !== state.processRowsRequest) return;
      setProcessRowsMode(false);
      await loadDailyRows();
      await showError(error);
    }
  }

  async function toggleSelectedProcessRows(){
    const processId = String(state.process?.id || '');
    if(state.processRowsMode && processId && state.processRowsProcessId === processId){
      await loadDailyRows();
      setStatus('Đã trở về dữ liệu trong ngày của nhân viên.','已返回員工當日生產紀錄。','info');
      return;
    }
    await loadSelectedProcessRows();
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
    await window.PCMSUIComponents.alertDialog({kind:'danger',message:window.PCMSUIText.errorPair(error)});
  }

  async function openSupplementHelp(){
    const dialogPromise = window.PCMSUIComponents.alertDialog({
      title:{vi:'Hướng dẫn công đoạn 0',zh:'工序0使用說明'},
      message:{
        vi:'Nhập số công đoạn 0 để ghi nhận giờ bổ sung. Ô Công đoạn sẽ đổi thành Lý do, ô Số lượng sẽ đổi thành Giờ. Giờ bổ sung cho một bản ghi phải từ 0,5 đến 24 giờ và tăng theo mỗi 0,5 giờ. Có thể không chọn đơn hàng và mã hàng; nếu chọn đơn hàng thì phải chọn mã hàng thuộc đơn hàng đó. Giờ bổ sung được tính là hiệu suất 100% và không cộng thêm giờ chấm công.',
        zh:'輸入工序號 0，即可登記補充工時。「工序」欄會改為「原因」，「數量」欄會改為「小時」。單筆補充工時必須為 0.5～24 小時，並以 0.5 小時為單位。訂單與款號可以不選；若選擇訂單，必須同時選擇該訂單內的款號。補充工時以 100% 效率計算，不會增加考勤時數。'
      },
      kind:'info',
      size:'large'
    });
    const backdrops = document.querySelectorAll('.ui-dialog-backdrop');
    const backdrop = backdrops[backdrops.length-1];
    const main = document.querySelector('#ma > .mn') || document.querySelector('.mn');
    if(!backdrop || !main){
      await dialogPromise;
      return;
    }
    const updatePosition = ()=>{
      const rect = main.getBoundingClientRect();
      const left = Math.max(0,rect.left);
      const right = Math.min(window.innerWidth,rect.right);
      const top = Math.max(0,rect.top);
      const bottom = Math.min(window.innerHeight,rect.bottom);
      const width = Math.max(0,right-left);
      const height = Math.max(0,bottom-top);
      backdrop.style.setProperty('--production-dialog-center-x',`${left+(width/2)}px`);
      backdrop.style.setProperty('--production-dialog-center-y',`${top+(height/2)}px`);
      backdrop.style.setProperty('--production-dialog-visible-width',`${width}px`);
      backdrop.style.setProperty('--production-dialog-visible-height',`${height}px`);
    };
    backdrop.classList.add('production-supplement-dialog-backdrop');
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updatePosition) : null;
    observer?.observe(main);
    window.addEventListener('resize',updatePosition);
    window.visualViewport?.addEventListener('resize',updatePosition);
    updatePosition();
    try{
      await dialogPromise;
    }finally{
      observer?.disconnect();
      window.removeEventListener('resize',updatePosition);
      window.visualViewport?.removeEventListener('resize',updatePosition);
      backdrop.classList.remove('production-supplement-dialog-backdrop');
    }
  }

  function ensureActionColumn(){
    const table = element('production-entry-table-body')?.closest('table');
    const headerRow = table?.querySelector('thead tr');
    if(!headerRow) return;
    let header = headerRow.querySelector('[data-production-action-column]');
    if(!canManageRecords()){
      header?.remove();
      return;
    }
    if(header) return;
    header = document.createElement('th');
    header.className = 'production-center-cell';
    header.dataset.productionActionColumn = 'true';
    header.dataset.productionColumn = 'action';
    header.dataset.uiTableColumn = 'action';
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

  function actionButton(iconClass,vi,zh,handler,kind=''){
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.className = `production-row-button${kind ? ` is-${kind}` : ''}`;
    setEntryLocalizedAttribute(button,'title',vi,zh);
    setEntryLocalizedAttribute(button,'aria-label',vi,zh);
    const icon = document.createElement('i');
    icon.className = `ti ${iconClass}`;
    button.appendChild(icon);
    button.addEventListener('click',handler);
    return button;
  }

  function deleteButton(item){
    return actionButton('ti-trash','Xóa vĩnh viễn','永久刪除',()=>void deleteDailyRecord(item),'danger');
  }

  async function voidDailyRecord(item){
    const supplement = window.PCMSProductionEntryStore.isSupplementEntry(item);
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
            vi:`Hủy ${hoursText(item.supplementHours)} giờ bổ sung, lý do “${item.supplementReason || '—'}”?`,
            zh:`將作廢「${item.supplementReason || '—'}」的 ${hoursText(item.supplementHours)} 小時補充工時。`
          }
        : {
            vi:`Hủy ${numberText(item.quantity)} sản phẩm của công đoạn ${item.processNo}? Số lượng này sẽ được trả lại cho đơn hàng.`,
            zh:`將作廢工序 ${item.processNo} 的 ${numberText(item.quantity)} 件；數量會退回訂單工序剩餘量。`
          }
    });
    if(!confirmed) return;
    try{
      await window.PCMSProductionEntryStore.voidEntry(item.id,reason);
      await loadDailyRows();
      if(state.process && !supplement) void loadQuantityProgress(state.process);
      setStatus('Đã hủy bản ghi.','紀錄已作廢。','success');
    }catch(error){ await showError(error); }
  }

  async function deleteDailyRecord(item){
    const supplement = window.PCMSProductionEntryStore.isSupplementEntry(item);
    const confirmed = await window.PCMSUIComponents.confirmDialog({
      title:supplement
        ? {vi:'Xóa vĩnh viễn giờ bổ sung',zh:'永久刪除補充工時'}
        : {vi:'Xóa vĩnh viễn bản ghi sản xuất',zh:'永久刪除生產紀錄'},
      message:supplement
        ? {
            vi:`Xóa ${hoursText(item.supplementHours)} giờ bổ sung với lý do “${item.supplementReason || '—'}”? Dữ liệu không thể khôi phục.`,
            zh:`確定永久刪除「${item.supplementReason || '—'}」的 ${hoursText(item.supplementHours)} 小時補充工時？刪除後不能復原。`
          }
        : {
            vi:`Xóa ${numberText(item.quantity)} sản phẩm của công đoạn ${item.processNo}? Dữ liệu không thể khôi phục.`,
            zh:`確定永久刪除工序 ${item.processNo} 的 ${numberText(item.quantity)} 件生產紀錄？刪除後不能復原。`
          }
    });
    if(!confirmed) return;
    try{
      await window.PCMSProductionEntryStore.deleteEntry(item.id);
      await loadDailyRows();
      if(state.process && !supplement) void loadQuantityProgress(state.process);
      setStatus(
        supplement ? 'Đã xóa vĩnh viễn giờ bổ sung.' : 'Đã xóa vĩnh viễn bản ghi sản xuất.',
        supplement ? '補充工時已永久刪除。' : '生產紀錄已永久刪除。',
        'success'
      );
    }catch(error){ await showError(error); }
  }

  async function saveEntry(){
    const supplement = state.supplementMode;
    if(!supplement && state.processTotalLoading){
      setStatus('Đang kiểm tra số lượng đã ghi nhận.','正在確認目前已登記數量。','info');
      return null;
    }
    const preview = supplement ? null : quantityProgress();
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
    const reasonInput = element('production-process-name');
    return window.PCMSUIComponents.runActionOnce('production.entry.save',async()=>{
      try{
        const saved = await window.PCMSProductionEntryStore.createEntry({
          productionDate:element('production-date-input').value,
          employeeId:state.employee?.employeeId,
          orderId:state.order?.id,
          productCode:state.product?.code,
          processNo:supplement ? '0' : state.process?.processNo,
          quantity:supplement ? undefined : quantityInput.value,
          supplementReason:supplement ? reasonInput.value : undefined,
          supplementHours:supplement ? quantityInput.value : undefined
        });
        element('production-process-input').value = '';
        setSupplementMode(false);
        setStatus(
          supplement
            ? `Đã lưu ${hoursText(saved.supplementHours)} giờ bổ sung: ${saved.supplementReason}.`
            : `Đã lưu ${numberText(saved.quantity)} sản phẩm cho công đoạn ${saved.processNo}.`,
          supplement
            ? `已儲存 ${hoursText(saved.supplementHours)} 小時補充工時：${saved.supplementReason}。`
            : `已儲存工序 ${saved.processNo} 的 ${numberText(saved.quantity)} 件生產數量。`,
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
      controls:supplement ? [reasonInput,quantityInput] : [quantityInput],
      cooldownMs:1000,
      onDuplicate:()=>setStatus('Đang lưu, vui lòng chờ.','正在儲存，請稍候。','info')
    }).catch(()=>null);
  }

  function appendCell(row,value,className='',columnKey='',valueClass=''){
    const cell = document.createElement('td');
    if(className) cell.className = className;
    if(columnKey){
      cell.dataset.productionColumn = columnKey;
      cell.dataset.uiTableColumn = columnKey;
    }
    const text = String(value ?? '—');
    if(text !== '—' && ['employeeName','order','product','processName'].includes(columnKey)) cell.title = text;
    if(valueClass && text !== '—'){
      const content = document.createElement('span');
      content.className = valueClass;
      content.textContent = text;
      cell.appendChild(content);
    }else{
      cell.textContent = text;
    }
    row.appendChild(cell);
    return cell;
  }

  function dailySortValue(item,key){
    const supplement = window.PCMSProductionEntryStore.isSupplementEntry(item);
    const currentEmployee = window.PCMSProductionEmployees?.find?.(item.employeeId);
    const values = {
      date:item.productionDate || '',
      employeeId:item.employeeId || '',
      employeeName:currentEmployee?.name || item.employeeName || '',
      order:item.orderNo || '',
      product:item.productCode || '',
      processNo:Number(item.processNo || 0),
      processName:supplement ? item.supplementReason : (item.processNameVi || item.processNameZh || ''),
      quantity:supplement ? null : Number(item.quantity || 0),
      supplementHours:supplement ? Number(item.supplementHours || 0) : null,
      orderQuantity:supplement ? null : Number(item.orderQtySnapshot || 0),
      processSeconds:supplement ? null : Number(item.processSecSnapshot || 0),
      hourlyCapacity:supplement ? null : Number(item.hourlyCapacitySnapshot || 0),
      status:item.status || ''
    };
    return values[key];
  }

  function sortedDailyRows(rows){
    const sort = productionTableControl?.getSort?.() || {key:'',direction:'none'};
    if(sort.direction === 'none' || !sort.key) return [...rows];
    const direction = sort.direction === 'ascending' ? 1 : -1;
    return [...rows].sort((left,right)=>{
      const leftValue = dailySortValue(left,sort.key);
      const rightValue = dailySortValue(right,sort.key);
      if(leftValue == null && rightValue == null) return 0;
      if(leftValue == null) return 1;
      if(rightValue == null) return -1;
      if(typeof leftValue === 'number' && typeof rightValue === 'number') return (leftValue-rightValue)*direction;
      return String(leftValue).localeCompare(String(rightValue),undefined,{numeric:true,sensitivity:'base'})*direction;
    });
  }

  function renderDailyRows(rows,{store=true}={}){
    const body = element('production-entry-table-body');
    const empty = element('production-entry-empty');
    if(!body) return;
    if(store) state.dailyRows = [...rows];
    ensureActionColumn();
    body.replaceChildren();
    sortedDailyRows(state.dailyRows).forEach(item=>{
      const supplement = window.PCMSProductionEntryStore.isSupplementEntry(item);
      const currentEmployee = window.PCMSProductionEmployees?.find?.(item.employeeId);
      const row = document.createElement('tr');
      row.dataset.orderProcessId = String(item.orderProcessId || '');
      appendCell(row,dateText(item.productionDate),'production-record-text-cell','date');
      appendCell(row,item.employeeId || '—','production-record-text-cell','employeeId');
      appendCell(row,currentEmployee?.name || item.employeeName || '—','production-record-text-cell','employeeName');
      appendCell(row,item.orderNo || '—','', 'order');
      appendCell(row,item.productCode || '—','production-product-code-cell','product');
      appendCell(row,supplement ? '—' : numberText(item.orderQtySnapshot),'production-number-cell','orderQuantity');
      appendCell(row,item.processNo || '—','production-number-cell','processNo','production-value-badge');
      appendCell(row,supplement ? item.supplementReason : (item.processNameVi || item.processNameZh || '—'),'', 'processName');
      appendCell(row,supplement ? '—' : numberText(item.quantity),'production-number-cell','quantity','production-value-badge');
      appendCell(row,supplement ? hoursText(item.supplementHours) : '—','production-number-cell','supplementHours');
      const secondsCell=appendCell(row,supplement ? '—' : numberText(item.processSecSnapshot),'production-number-cell','processSeconds');
      if(!supplement&&window.PCMSQuickProcessSeconds){
        secondsCell.replaceChildren(window.PCMSQuickProcessSeconds.createButton({
          value:numberText(item.processSecSnapshot),code:item.productCode,processNo:item.processNo,
          processNameVi:item.processNameVi,displayedSeconds:Number(item.processSecSnapshot)||0,source:'productionEntry'
        }));
      }
      appendCell(row,supplement ? '—' : hourlyCapacityText(item.hourlyCapacitySnapshot),'production-number-cell','hourlyCapacity');
      const statusCell = document.createElement('td');
      statusCell.className = 'production-center-cell';
      statusCell.dataset.productionColumn = 'status';
      statusCell.dataset.uiTableColumn = 'status';
      const status = document.createElement('span');
      status.className = `production-status ui-dual-copy ${item.status === 'voided' ? 'is-voided' : 'is-active'}`;
      const statusVi = document.createElement('strong');
      const statusZh = document.createElement('span');
      statusVi.textContent = item.status === 'voided' ? 'Đã hủy' : 'Hiệu lực';
      statusZh.textContent = item.status === 'voided' ? '已作廢' : '有效';
      status.append(statusVi,statusZh);
      statusCell.appendChild(status);
      row.appendChild(statusCell);
      if(canManageRecords()){
        const actionCell = document.createElement('td');
        actionCell.className = 'production-row-actions';
        actionCell.dataset.productionColumn = 'action';
        actionCell.dataset.uiTableColumn = 'action';
        if(item.status !== 'voided'){
          actionCell.appendChild(
            actionButton('ti-ban','Hủy bản ghi','作廢紀錄',()=>void voidDailyRecord(item),'danger')
          );
        }
        if(isAdmin()) actionCell.appendChild(deleteButton(item));
        if(!actionCell.childElementCount) actionCell.textContent = '—';
        row.appendChild(actionCell);
      }
      body.appendChild(row);
    });
    const control = ensureProductionTableControl();
    control.refresh();
    if(empty) empty.hidden = control.getVisibleKeys().length === 0 || state.dailyRows.length > 0;
    window.PCMSUITable?.refresh?.();
  }

  async function loadDailyRows(){
    setProcessRowsMode(false);
    if(!state.employee){ renderDailyRows([]); return; }
    try{
      const rows = await window.PCMSProductionReports.loadDaily(
        state.employee.employeeId,
        element('production-date-input').value,
        {activeOnly:false}
      );
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
    void refreshAttendanceSummary();
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
        void refreshAttendanceSummary();
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
    initializeSearchDropdowns();
    element('production-quantity-input').addEventListener('input',renderQuantityProgress);
    element('production-process-name').addEventListener('keydown',event=>{
      if(event.key !== 'Enter' || !state.supplementMode) return;
      event.preventDefault();
      element('production-quantity-input')?.focus({preventScroll:true});
    });
    element('production-quantity-input').addEventListener('keydown',event=>{
      if(event.key !== 'Enter') return;
      event.preventDefault();
      void saveEntry();
    });
    element('production-supplement-help-button').addEventListener('click',()=>void openSupplementHelp());
    element('production-quantity-progress').addEventListener('click',()=>void toggleSelectedProcessRows());
    ENTRY_INPUT_IDS.forEach(id=>{
      element(id)?.addEventListener('keydown',event=>handleEntryTab(event,id));
    });
    syncDropdownAvailability();
    ensureActionColumn();
    ensureProductionTableControl();
  }

  async function loadProductionEntryData(options={}){
    await Promise.all([
      window.PCMSProductionEmployees.load({revalidate:options.background === true}),
      window.PCMSProductionEntryStore.loadOrders()
    ]);
    return true;
  }

  function setPendingContext(context={}){
    state.pendingContext = {
      employeeId:String(context.employeeId || '').trim().toUpperCase(),
      productionDate:String(context.productionDate || '').trim(),
      orderId:String(context.orderId || '').trim(),
      orderNo:String(context.orderNo || '').trim(),
      code:String(context.code || '').trim(),
      processNo:String(context.processNo || '').trim()
    };
  }

  async function applyPendingContext(){
    const pending = state.pendingContext;
    state.pendingContext = null;
    if(!pending?.employeeId && !/^\d{4}-\d{2}-\d{2}$/.test(pending?.productionDate || '')) return false;
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(pending.productionDate)
      ? pending.productionDate
      : today();
    const productionDate = requestedDate > today() ? today() : requestedDate;
    element('production-date-input').value = productionDate;
    state.dateAuto = productionDate === today();
    syncDateControls();
    clearOrder();
    element('production-order-input').value = '';
    element('production-quantity-input').value = '';
    if(!pending.employeeId){
      clearEmployee();
      element('production-employee-input')?.focus({preventScroll:true});
      return true;
    }
    const employee = window.PCMSProductionEmployees.find(pending.employeeId);
    if(!employee){
      clearEmployee();
      element('production-employee-input').value = pending.employeeId;
      setStatus('Không tìm thấy nhân viên đã chọn.','找不到指定的員工。','danger');
      return true;
    }
    state.employee = employee;
    element('production-employee-input').value = employee.employeeId;
    element('production-entry-employee-name-input').value = employee.name || '';
    element('production-employee-department').textContent = employee.department || '—';
    closeDropdown('production-employee-options');
    closeDropdown('production-employee-name-options');
    await Promise.all([loadDailyRows(),refreshAttendanceSummary()]);
    if(pending.orderId||pending.orderNo){
      const order=window.PCMSProductionEntryStore.listOrders().find(item=>String(item.id)===pending.orderId
        ||String(item.orderId||'')===pending.orderNo);
      if(order){
        await selectOrder(order);
        if(pending.code){
          const product=window.PCMSProductionEntryStore.productsForOrder(order.id)
            .find(item=>String(item.code||'')===pending.code);
          if(product){
            selectProduct(product);
            if(pending.processNo){
              const process=window.PCMSProductionEntryStore.getLoadedProcesses(order.id)
                .find(item=>String(item.code||'')===pending.code&&String(item.processNo||'')===pending.processNo);
              if(process) selectProcess(process);
            }
          }
        }
      }
    }
    element('production-process-input')?.focus({preventScroll:true});
    return true;
  }

  async function productionEntryInit(){
    init();
    if(await applyPendingContext()){
      startDateTimer();
      return;
    }
    if(state.dateAuto) element('production-date-input').value = today();
    syncDateControls();
    startDateTimer();
    if(state.employee) await Promise.all([loadDailyRows(),refreshAttendanceSummary()]);
  }

  function productionEntryLeave(){
    stopDateTimer();
    productionTableControl?.deactivate?.({resetSort:true});
    closeAllDropdowns();
  }

  window.loadProductionEntryData = loadProductionEntryData;
  window.productionEntryInit = productionEntryInit;
  window.productionEntryLeave = productionEntryLeave;
  window.PCMSProductionEntry = Object.freeze({setPendingContext});
})();
