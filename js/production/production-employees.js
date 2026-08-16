// production-employees（產能員工頁程式）：處理員工表單、部門管理、搜尋與停用確認。
(function(){
  'use strict';

  const MANAGE_DEPARTMENT_VALUE = '__manage__'; // MANAGE_DEPARTMENT_VALUE（開啟部門管理的下拉選項值）
  const state = {initialized:false}; // state（員工頁狀態）
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
    await window.PCMSUIComponents.alertDialog({kind:'danger',message:window.PCMSUIText.errorPair(error)});
  }

  function fillDepartmentSelect(select,selected='',options={}){
    const activeRows = window.PCMSProductionEmployees.listDepartments({activeOnly:true});
    const selectedValue = String(selected || '').trim();
    const departmentRows = activeRows.slice();
    if(selectedValue && !departmentRows.some(item=>item.name === selectedValue)){
      const existing = window.PCMSProductionEmployees.findDepartment(selectedValue);
      departmentRows.push(existing || {departmentId:'legacy',name:selectedValue,active:false}); // legacy（既有舊部門暫時選項）
    }
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Chọn bộ phận / 選擇部門';
    select.appendChild(placeholder);
    departmentRows.forEach(department=>{
      const option = document.createElement('option');
      option.value = department.name;
      option.textContent = department.active === true
        ? department.name
        : window.PCMSUIText.visibleText({vi:`${department.name} · Ngừng dùng`,zh:`${department.name} · 停用`});
      if(department.active !== true){
        option.setAttribute('data-ui-option-vi',`${department.name} · Ngừng dùng`);
        option.setAttribute('data-ui-option-zh',`${department.name} · 停用`);
      }
      select.appendChild(option);
    });
    if(options.includeManage === true){
      const manage = document.createElement('option');
      manage.value = MANAGE_DEPARTMENT_VALUE;
      manage.textContent = 'Chỉnh sửa bộ phận / 編輯部門';
      select.appendChild(manage);
    }
    select.value = selectedValue;
    select.dataset.previousValue = select.value;
  }

  function renderDepartmentSelect(selected=''){
    fillDepartmentSelect(element('production-employee-department-input'),selected,{includeManage:true});
  }

  function handleDepartmentSelection(){
    const select = element('production-employee-department-input');
    if(select.value !== MANAGE_DEPARTMENT_VALUE){
      select.dataset.previousValue = select.value;
      return;
    }
    const previous = String(select.dataset.previousValue || '');
    select.value = Array.from(select.options).some(option=>option.value === previous) ? previous : '';
    openDepartmentManager();
  }

  function resetForm(){
    element('production-employee-id').value = '';
    element('production-employee-name-input').value = '';
    renderDepartmentSelect('');
  }

  async function save(){
    const button = element('production-employee-save-button');
    return window.PCMSUIComponents.runActionOnce('production.employee.save',async()=>{
      try{
        const input = {
          employeeId:element('production-employee-id').value,
          name:element('production-employee-name-input').value,
          department:element('production-employee-department-input').value,
          active:true
        }; // input（員工表單資料）
        const saved = await window.PCMSProductionEmployees.createEmployee(input);
        setMessage(`Đã thêm nhân viên ${saved.employeeId}.`,`已新增員工 ${saved.employeeId}。`,'success');
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
        vi:`Xóa vĩnh viễn ${employee.employeeId} · ${employee.name}? Chỉ nhân viên được tạo nhầm và chưa có bất kỳ dữ liệu nghiệp vụ nào mới có thể xóa.`,
        zh:`確定永久刪除 ${employee.employeeId} · ${employee.name}？只有建立錯誤且完全沒有任何歷史業務資料的員工可以刪除。`
      }
    });
    if(!confirmed) return;
    try{
      await window.PCMSProductionEmployees.deleteEmployee(employee.employeeId);
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
    table.className = 'production-table production-department-table ui-table';
    table.dataset.uiTableLayout = 'special';
    table.dataset.uiTableSticky = 'container';
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
      window.PCMSUIText.set(badge,department.active === true
        ? {vi:'Đang dùng',zh:'啟用'}
        : {vi:'Ngừng dùng',zh:'停用'});
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
      title:{vi:'Chỉnh sửa bộ phận',zh:'編輯部門'},
      body:departmentManagerBody(),
      size:'large',
      actions:[
        {text:{vi:'Thêm bộ phận',zh:'新增部門'},icon:'ti-plus',close:false,onClick:()=>void addDepartment(true)},
        {text:'common.close'}
      ]
    });
  }

  function editDialogField(vi,zh,control){
    const field = document.createElement('div');
    field.className = 'ui-dialog-field';
    const label = document.createElement('label');
    if(control.id) label.htmlFor = control.id;
    label.appendChild(window.PCMSUIText.create({vi,zh}));
    field.append(label,control);
    return field;
  }

  function employeeEditBody(employee){
    const host = document.createElement('div');
    host.className = 'production-employee-edit-form';

    const employeeId = document.createElement('div');
    employeeId.className = 'production-employee-edit-value';
    employeeId.textContent = employee.employeeId;

    const name = document.createElement('input');
    name.id = 'production-employee-edit-name';
    name.type = 'text';
    name.maxLength = 100;
    name.autocomplete = 'off';
    name.value = employee.name || '';

    const department = document.createElement('select');
    department.id = 'production-employee-edit-department';
    fillDepartmentSelect(department,employee.department || '');

    const status = document.createElement('span');
    status.className = `production-status ui-dual-copy ${employee.active === true ? 'is-active' : 'is-voided'}`;
    const statusVi = document.createElement('strong');
    const statusZh = document.createElement('span');
    statusVi.textContent = employee.active === true ? 'Đang dùng' : 'Ngừng dùng';
    statusZh.textContent = employee.active === true ? '啟用' : '停用';
    status.append(statusVi,statusZh);
    const statusValue = document.createElement('div');
    statusValue.className = 'production-employee-edit-status';
    statusValue.appendChild(status);

    host.append(
      editDialogField('Mã nhân viên','員工工號',employeeId),
      editDialogField('Tên nhân viên','員工姓名',name),
      editDialogField('Bộ phận','部門',department),
      editDialogField('Trạng thái','狀態',statusValue)
    );
    return {host,name,department};
  }

  function openEmployeeEditor(employee){
    const fields = employeeEditBody(employee);
    window.PCMSUIComponents.openDialog({
      title:{vi:'Chỉnh sửa nhân viên',zh:'修改員工'},
      body:fields.host,
      actions:[
        {text:'common.cancel'},
        {
          text:{vi:'Lưu thay đổi',zh:'儲存修改'},
          icon:'ti-device-floppy',
          kind:'primary',
          onClick:async()=>{
            const saved = await window.PCMSProductionEmployees.updateEmployee(employee.employeeId,{
              employeeId:employee.employeeId,
              name:fields.name.value,
              department:fields.department.value,
              active:employee.active === true
            });
            render();
            setMessage(`Đã cập nhật nhân viên ${saved.employeeId}.`,`已更新員工 ${saved.employeeId}。`,'success');
            return saved;
          }
        }
      ],
      onError:error=>void showError(error)
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
      window.PCMSUIText.set(badge,employee.active === true
        ? {vi:'Đang dùng',zh:'啟用'}
        : {vi:'Ngừng dùng',zh:'停用'});
      statusCell.appendChild(badge);
      const actionCell = document.createElement('td');
      actionCell.className = 'production-row-actions';
      actionCell.append(
        actionButton('ti-edit','Chỉnh sửa','修改',()=>openEmployeeEditor(employee)),
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
    element('production-employee-department-input').addEventListener('change',handleDepartmentSelection);
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
