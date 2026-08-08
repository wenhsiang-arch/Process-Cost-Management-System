// production-employees（產能員工頁程式）：處理員工表單、搜尋與停用確認。
(function(){
  'use strict';

  const state = {initialized:false,editingId:''}; // state（員工頁狀態）
  function element(id){ return document.getElementById(id); }

  function setMessage(vi,zh,kind='info'){
    const host = element('production-employee-status');
    host.hidden = !vi && !zh;
    host.className = `ui-notice is-${kind}`;
    window.PCMSUIText?.set?.(host,{vi:String(vi || ''),zh:String(zh || '')});
  }

  function resetForm(){
    state.editingId = '';
    element('production-employee-id').value = '';
    element('production-employee-id').readOnly = false;
    element('production-employee-name-input').value = '';
    element('production-employee-department-input').value = '';
    element('production-employee-active').checked = true;
    window.PCMSUIText?.set?.(element('production-employee-save-copy'),{vi:'Thêm nhân viên',zh:'新增員工'});
  }

  function startEdit(employee){
    state.editingId = employee.employeeId;
    element('production-employee-id').value = employee.employeeId;
    element('production-employee-id').readOnly = true;
    element('production-employee-name-input').value = employee.name || '';
    element('production-employee-department-input').value = employee.department || '';
    element('production-employee-active').checked = employee.active === true;
    window.PCMSUIText?.set?.(element('production-employee-save-copy'),{vi:'Lưu thay đổi',zh:'儲存修改'});
    element('production-employee-name-input').focus();
  }

  async function showError(error){
    const message = String(error?.message || 'Không thể hoàn tất thao tác. / 無法完成操作。');
    const parts = message.split(' / ');
    await window.PCMSUIComponents.alertDialog({kind:'danger',message:{vi:parts[0] || message,zh:parts.slice(1).join(' / ') || message}});
  }

  async function save(){
    const button = element('production-employee-save-button');
    return window.PCMSUIComponents.runActionOnce('production.employee.save',async()=>{
      try{
        const saved = await window.PCMSProductionEmployees.save({
          employeeId:element('production-employee-id').value,
          name:element('production-employee-name-input').value,
          department:element('production-employee-department-input').value,
          active:element('production-employee-active').checked
        });
        setMessage(
          `Đã lưu nhân viên ${saved.employeeId}.`,
          `已儲存員工 ${saved.employeeId}。`,
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
    element('production-employee-search').addEventListener('input',render);
    element('production-employee-filter-status').addEventListener('change',render);
  }

  async function loadProductionEmployeesData(){
    await window.PCMSProductionEmployees.load();
    return true;
  }

  function productionEmployeesInit(){ init(); render(); }

  window.loadProductionEmployeesData = loadProductionEmployeesData;
  window.productionEmployeesInit = productionEmployeesInit;
})();
