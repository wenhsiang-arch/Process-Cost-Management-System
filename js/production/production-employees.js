// production-employees（產能員工頁程式）：處理員工表單、部門管理、搜尋與停用確認。
(function(){
  'use strict';

  const state = {initialized:false,editingId:''}; // state（員工頁狀態）
  function element(id){ return document.getElementById(id); }
  function isAdmin(){ return window.cu?.role === 'admin'; }

  function setMessage(vi,zh,kind='info'){
    const host = element('production-employee-status');
    if(kind === 'success'){
      host.hidden = true;
      window.PCMSUIComponents.showToast({kind,text:{vi:String(vi || ''),zh:String(zh || '')}});
      return;
    }
    host.hidden = !vi && !zh;
    host.className = `ui-notice is-${kind}`;
    window.PCMSUIText?.set?.(host,{vi:String(vi || ''),zh:String(zh || '')});
  }

  async function showError(error){
    const message = String(error?.message || 'Không thể hoàn tất thao tác. / 無法完成操作。');
    const parts = message.split(' / ');
    await window.PCMSUIComponents.alertDialog({kind:'danger',message:{vi:parts[0] || message,zh:parts.slice(1).join(' / ') || message}});
  }

  function renderDepartmentSelect(selected=''){
    const select = element('production-employee-department-input');
    const activeRows = window.PCMSProductionEmployees.listDepartments({activeOnly:true});
    const selectedValue = String(selected || '').trim();
    const options = activeRows.slice();
    if(state.editingId && selectedValue && !options.some(item=>item.name === selectedValue)){
      const existing = window.PCMSProductionEmployees.findDepartment(selectedValue);
      options.push(existing || {departmentId:'legacy',name:selectedValue,active:false}); // legacy（既有舊部門暫時選項）
    }
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Chọn bộ phận / 選擇部門';
    select.appendChild(placeholder);
    options.forEach(department=>{
      const option = document.createElement('option');
      option.value = department.name;
      option.textContent = department.active === true
        ? department.name
        : `${department.name} · Ngừng dùng / 停用`;
      select.appendChild(option);
    });
    select.value = selectedValue;
  }

  function resetForm(){
    state.editingId = '';
    element('production-employee-id').value = '';
    element('production-employee-id').readOnly = false;
    element('production-employee-name-input').value = '';
    renderDepartmentSelect('');
    window.PCMSUIText?.set?.(element('production-employee-save-copy'),{vi:'Thêm nhân viên',zh:'新增員工'});
  }

  function startEdit(employee){
    state.editingId = employee.employeeId;
    element('production-employee-id').value = employee.employeeId;
    element('production-employee-id').readOnly = true;
    element('production-employee-name-input').value = employee.name || '';
    renderDepartmentSelect(employee.department || '');
    window.PCMSUIText?.set?.(element('production-employee-save-copy'),{vi:'Lưu thay đổi',zh:'儲存修改'});
    element('production-employee-name-input').focus();
  }

  async function save(){
    const button = element('production-employee-save-button');
    return window.PCMSUIComponents.runActionOnce('production.employee.save',async()=>{
      try{
        const existing = state.editingId ? window.PCMSProductionEmployees.find(state.editingId) : null; // existing（編輯中的既有員工）
        const input = {
          employeeId:element('production-employee-id').value,
          name:element('production-employee-name-input').value,
          department:element('production-employee-department-input').value,
          active:state.editingId ? existing?.active === true : true
        }; // input（員工表單資料）
        const saved = state.editingId
          ? await window.PCMSProductionEmployees.updateEmployee(state.editingId,input)
          : await window.PCMSProductionEmployees.createEmployee(input);
        setMessage(
          state.editingId ? `Đã cập nhật nhân viên ${saved.employeeId}.` : `Đã thêm nhân viên ${saved.employeeId}.`,
          state.editingId ? `已更新員工 ${saved.employeeId}。` : `已新增員工 ${saved.employeeId}。`,
          'success'
        );
        resetForm();
        render();
        return saved;
      }catch(error){
        setMessage('Chưa lưu dữ liệu nhân viên.','員工資料尚未儲存。','danger');
        await showError(error);
        throw error;
      }
    },{controls:[button],cooldownMs:1000}).catch(()=>null);
  }

  async function toggleActive(employee){
    const next = employee.active !== true;
    const confirmed = await window.PCMSUIComponents.confirmDialog({
      title:{vi:next ? 'Kích hoạt nhân viên' : 'Ngừng sử dụng nhân viên',zh:next ? '啟用員工' : '停用員工'},
      message:{
        vi:next ? `Kích hoạt lại ${employee.employeeId} · ${employee.name}?` : `Ngừng sử dụng ${employee.employeeId} · ${employee.name}? Nhân viên sẽ không xuất hiện trong đăng ký mới.`,
        zh:next ? `要重新啟用 ${employee.employeeId} · ${employee.name} 嗎？` : `要停用 ${employee.employeeId} · ${employee.name} 嗎？停用後不會出現在新的生產登記。`
      }
    });
    if(!confirmed) return;
    try{
      await window.PCMSProductionEmployees.setActive(employee.employeeId,next);
      render();
      setMessage(next ? 'Đã kích hoạt nhân viên.' : 'Đã ngừng sử dụng nhân viên.',next ? '員工已啟用。' : '員工已停用。','success');
    }catch(error){ await showError(error); }
  }

  async function deleteEmployee(employee){
    const confirmed = await window.PCMSUIComponents.confirmDialog({
      title:{vi:'Xóa vĩnh viễn nhân viên',zh:'永久刪除員工'},
      message:{
        vi:`Xóa vĩnh viễn ${employee.employeeId} · ${employee.name}? Nhân viên có bản ghi sản xuất sẽ không thể xóa.`,
        zh:`確定永久刪除 ${employee.employeeId} · ${employee.name}？仍有生產紀錄的員工不能刪除。`
      }
    });
    if(!confirmed) return;
    try{
      await window.PCMSProductionEmployees.deleteEmployee(employee.employeeId);
      if(state.editingId === employee.employeeId) resetForm();
      render();
      setMessage('Đã xóa vĩnh viễn nhân viên.','員工已永久刪除。','success');
    }catch(error){
      render();
      await showError(error);
    }
  }

  function actionButton(icon,vi,zh,handler,kind=''){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `production-row-button${kind ? ` is-${kind}` : ''}`;
    const iconNode = document.createElement('i');
    iconNode.className = `ti ${icon}`;
    button.appendChild(iconNode);
    button.setAttribute('aria-label',`${vi} / ${zh}`);
    button.title = `${vi} / ${zh}`;
    button.addEventListener('click',handler);
    return button;
  }

  async function addDepartment(reopenManager=false){
    const value = await window.PCMSUIComponents.promptDialog({
      title:{vi:'Thêm bộ phận',zh:'新增部門'},
      label:{vi:'Tên bộ phận',zh:'部門名稱'},
      maxLength:100
    });
    if(value === null){
      if(reopenManager) openDepartmentManager();
      return;
    }
    try{
      const saved = await window.PCMSProductionEmployees.createDepartment(value);
      renderDepartmentSelect(saved.name);
      setMessage('Đã thêm bộ phận.','已新增部門。','success');
    }catch(error){ await showError(error); }
    if(reopenManager) openDepartmentManager();
  }

  async function renameDepartment(department){
    const value = await window.PCMSUIComponents.promptDialog({
      title:{vi:'Đổi tên bộ phận',zh:'修改部門名稱'},
      label:{vi:'Tên bộ phận mới',zh:'新部門名稱'},
      value:department.name,
      maxLength:100
    });
    if(value !== null){
      try{
        const selected = element('production-employee-department-input').value;
        const saved = await window.PCMSProductionEmployees.renameDepartment(department.departmentId,value);
        renderDepartmentSelect(selected === department.name ? saved.name : selected);
        setMessage('Đã đổi tên bộ phận.','已修改部門名稱。','success');
      }catch(error){ await showError(error); }
    }
    openDepartmentManager();
  }

  async function toggleDepartment(department){
    const next = department.active !== true;
    const confirmed = await window.PCMSUIComponents.confirmDialog({
      title:{vi:next ? 'Kích hoạt bộ phận' : 'Ngừng sử dụng bộ phận',zh:next ? '啟用部門' : '停用部門'},
      message:{
        vi:next ? `Kích hoạt lại bộ phận ${department.name}?` : `Ngừng sử dụng bộ phận ${department.name}? Bộ phận sẽ không xuất hiện khi thêm nhân viên mới.`,
        zh:next ? `要重新啟用部門 ${department.name} 嗎？` : `要停用部門 ${department.name} 嗎？新增員工時將不再顯示此部門。`
      }
    });
    if(confirmed){
      try{
        const selected = element('production-employee-department-input').value;
        await window.PCMSProductionEmployees.setDepartmentActive(department.departmentId,next);
        renderDepartmentSelect(selected);
        setMessage(next ? 'Đã kích hoạt bộ phận.' : 'Đã ngừng sử dụng bộ phận.',next ? '部門已啟用。' : '部門已停用。','success');
      }catch(error){ await showError(error); }
    }
    openDepartmentManager();
  }

  async function deleteDepartment(department){
    const confirmed = await window.PCMSUIComponents.confirmDialog({
      title:{vi:'Xóa bộ phận',zh:'刪除部門'},
      message:{
        vi:`Xóa bộ phận ${department.name}? Chỉ bộ phận chưa có nhân viên sử dụng mới có thể xóa.`,
        zh:`確定刪除部門 ${department.name}？只有未被員工使用的部門才能刪除。`
      }
    });
    if(confirmed){
      try{
        const selected = element('production-employee-department-input').value;
        await window.PCMSProductionEmployees.deleteDepartment(department.departmentId);
        renderDepartmentSelect(selected === department.name ? '' : selected);
        setMessage('Đã xóa bộ phận.','已刪除部門。','success');
      }catch(error){ await showError(error); }
    }
    openDepartmentManager();
  }

  function departmentManagerBody(){
    const host = document.createElement('div');
    host.className = 'production-department-manager';
    const rows = window.PCMSProductionEmployees.listDepartments();
    if(!rows.length){
      const empty = document.createElement('div');
      empty.className = 'production-empty';
      window.PCMSUIText?.set?.(empty,{vi:'Chưa có bộ phận.',zh:'尚未建立部門。'});
      host.appendChild(empty);
      return host;
    }
    const tableWrap = document.createElement('div');
    tableWrap.className = 'production-table-scroll';
    const table = document.createElement('table');
    table.className = 'production-table production-department-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    [['Bộ phận','部門'],['Trạng thái','狀態'],['Thao tác','操作']].forEach(([vi,zh])=>{
      const cell = document.createElement('th');
      cell.appendChild(window.PCMSUIText.create({vi,zh}));
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    const body = document.createElement('tbody');
    rows.forEach(department=>{
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = department.name;
      const statusCell = document.createElement('td');
      statusCell.className = 'production-center-cell';
      const badge = document.createElement('span');
      badge.className = `production-status ${department.active === true ? 'is-active' : 'is-voided'}`;
      badge.textContent = department.active === true ? 'Đang dùng / 啟用' : 'Ngừng dùng / 停用';
      statusCell.appendChild(badge);
      const actions = document.createElement('td');
      actions.className = 'production-row-actions';
      actions.append(
        actionButton('ti-edit','Đổi tên','修改名稱',()=>void renameDepartment(department)),
        actionButton(department.active === true ? 'ti-eye-off' : 'ti-eye','Đổi trạng thái','切換狀態',()=>void toggleDepartment(department),department.active === true ? 'danger' : ''),
        actionButton('ti-trash','Xóa','刪除',()=>void deleteDepartment(department),'danger')
      );
      row.append(nameCell,statusCell,actions);
      body.appendChild(row);
    });
    table.append(head,body);
    tableWrap.appendChild(table);
    host.appendChild(tableWrap);
    return host;
  }

  function openDepartmentManager(){
    window.PCMSUIComponents.openDialog({
      title:{vi:'Quản lý bộ phận',zh:'部門管理'},
      body:departmentManagerBody(),
      size:'large',
      actions:[
        {text:{vi:'Thêm bộ phận',zh:'新增部門'},icon:'ti-plus',close:false,onClick:()=>void addDepartment(true)},
        {text:'common.close'}
      ]
    });
  }

  function render(){
    const body = element('production-employees-table-body');
    const needle = String(element('production-employee-search').value || '').trim().toLocaleLowerCase();
    const status = element('production-employee-filter-status').value;
    const rows = window.PCMSProductionEmployees.list().filter(item=>{
      if(status === 'active' && item.active !== true) return false;
      if(status === 'inactive' && item.active === true) return false;
      return !needle || [item.employeeId,item.name,item.department].some(value=>String(value || '').toLocaleLowerCase().includes(needle));
    });
    body.replaceChildren();
    rows.forEach(employee=>{
      const row = document.createElement('tr');
      [employee.employeeId,employee.name,employee.department].forEach(value=>{
        const cell = document.createElement('td'); cell.textContent = String(value || '—'); row.appendChild(cell);
      });
      const statusCell = document.createElement('td');
      statusCell.className = 'production-center-cell';
      const badge = document.createElement('span');
      badge.className = `production-status ${employee.active === true ? 'is-active' : 'is-voided'}`;
      badge.textContent = employee.active === true ? 'Đang dùng / 啟用' : 'Ngừng dùng / 停用';
      statusCell.appendChild(badge);
      const actionCell = document.createElement('td');
      actionCell.className = 'production-row-actions';
      actionCell.append(
        actionButton('ti-edit','Chỉnh sửa','修改',()=>startEdit(employee)),
        actionButton(employee.active === true ? 'ti-user-off' : 'ti-user-check',employee.active === true ? 'Ngừng dùng' : 'Kích hoạt',employee.active === true ? '停用' : '啟用',()=>void toggleActive(employee),employee.active === true ? 'danger' : '')
      );
      if(isAdmin()) actionCell.append(
        actionButton('ti-trash','Xóa vĩnh viễn','永久刪除',()=>void deleteEmployee(employee),'danger')
      );
      row.append(statusCell,actionCell);
      body.appendChild(row);
    });
    element('production-employees-empty').hidden = rows.length > 0;
    element('production-employees-count').textContent = String(rows.length);
  }

  function init(){
    if(state.initialized) return;
    state.initialized = true;
    element('production-employee-save-button').addEventListener('click',()=>void save());
    element('production-employee-cancel-button').addEventListener('click',resetForm);
    element('production-department-add-button').addEventListener('click',()=>void addDepartment());
    element('production-department-manage-button').addEventListener('click',openDepartmentManager);
    element('production-employee-search').addEventListener('input',render);
    element('production-employee-filter-status').addEventListener('change',render);
  }

  async function loadProductionEmployeesData(options={}){
    await Promise.all([
      window.PCMSProductionEmployees.load({revalidate:options.background === true}),
      window.PCMSProductionEmployees.loadDepartments({revalidate:options.background === true})
    ]);
    return true;
  }

  function productionEmployeesInit(){
    init();
    renderDepartmentSelect(element('production-employee-department-input').value);
    render();
  }

  window.loadProductionEmployeesData = loadProductionEmployeesData;
  window.productionEmployeesInit = productionEmployeesInit;
})();
