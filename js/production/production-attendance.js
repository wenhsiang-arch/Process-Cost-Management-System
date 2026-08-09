// production-attendance（產能考勤頁程式）：依日期與部門批次登記員工正常及加班工時。
(function(){
  'use strict';

  const state = {
    initialized:false,
    records:[],
    drafts:new Map(),
    dirty:new Set(),
    loading:false
  }; // state（考勤頁目前狀態）

  function element(id){ return document.getElementById(id); }
  function isAdmin(){ return window.cu?.role === 'admin'; }
  function today(){ return typeof formatLocalDate === 'function' ? formatLocalDate(new Date()) : new Date().toISOString().slice(0,10); }
  function normalize(value){ return String(value || '').trim().toLocaleLowerCase(); }
  function hoursText(value){
    const hours = Number(value || 0);
    return hours.toLocaleString(undefined,{minimumFractionDigits:hours % 1 === 0 ? 0 : 1,maximumFractionDigits:1});
  }
  function dateObject(value){
    const [year,month,day] = String(value || '').split('-').map(Number);
    const result = new Date(year,month-1,day);
    return Number.isFinite(result.getTime()) ? result : new Date();
  }
  function syncDateControl(){
    const date = element('production-attendance-date');
    const next = element('production-attendance-next');
    if(!date) return;
    date.max = today();
    if(next) next.disabled = date.value >= date.max;
  }
  function shiftAttendanceDate(days){
    const input = element('production-attendance-date');
    if(!input) return;
    const value = dateObject(input.value || today());
    value.setDate(value.getDate()+days);
    const nextValue = typeof formatLocalDate === 'function' ? formatLocalDate(value) : value.toISOString().slice(0,10);
    input.value = nextValue > today() ? today() : nextValue;
    syncDateControl();
    void load();
  }
  function openAttendanceCalendar(){
    const input = element('production-attendance-date');
    if(!input) return;
    if(typeof input.showPicker === 'function') input.showPicker();
    else input.focus({preventScroll:true});
  }

  function setStatus(vi,zh,kind='info'){
    const host = element('production-attendance-status');
    if(!host) return;
    if(kind === 'success'){
      host.hidden = true;
      window.PCMSUIComponents.showToast({kind,text:{vi,zh}});
      return;
    }
    host.hidden = !vi && !zh;
    host.className = `production-entry-status ui-notice is-${kind}`;
    window.PCMSUIText?.set?.(host,{vi:String(vi || ''),zh:String(zh || '')});
  }

  async function showError(error){
    const message = String(error?.message || 'Không thể hoàn tất thao tác. / 無法完成操作。');
    const parts = message.split(' / ');
    await window.PCMSUIComponents.alertDialog({
      kind:'danger',
      message:{vi:parts[0] || message,zh:parts.slice(1).join(' / ') || message}
    });
  }

  function recordMap(){ return new Map(state.records.map(item=>[item.employeeId,item])); }

  function employeeRows(){
    const records = recordMap();
    const employees = new Map(window.PCMSProductionEmployees.list({activeOnly:false}).map(item=>[
      item.employeeId,{...item,missing:false}
    ]));
    state.records.forEach(item=>{
      if(employees.has(item.employeeId)) return;
      employees.set(item.employeeId,{
        employeeId:item.employeeId,
        name:item.employeeName,
        department:item.department,
        active:false,
        missing:true
      });
    });
    return Array.from(employees.values())
      .filter(item=>item.active === true || records.has(item.employeeId))
      .sort((a,b)=>String(a.employeeId).localeCompare(String(b.employeeId),'en',{numeric:true,sensitivity:'base'}));
  }

  function resetDrafts(){
    const records = recordMap();
    state.drafts.clear();
    state.dirty.clear();
    employeeRows().forEach(employee=>{
      const record = records.get(employee.employeeId) || null;
      state.drafts.set(employee.employeeId,{
        employee,
        record,
        normalHours:Number(record?.normalHours || 0),
        overtimeHours:Number(record?.overtimeHours || 0),
        note:String(record?.note || '')
      });
    });
    updateSaveButton();
  }

  function departments(){
    return [...new Set(employeeRows().map(item=>String(item.department || '').trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'vi',{numeric:true,sensitivity:'base'}));
  }

  function renderDepartmentOptions(){
    const select = element('production-attendance-department');
    const selected = select.value;
    select.replaceChildren();
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'Tất cả / 全部';
    select.appendChild(all);
    departments().forEach(name=>{
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    select.value = departments().includes(selected) ? selected : '';
  }

  function visibleDrafts(){
    const department = element('production-attendance-department').value;
    const needle = normalize(element('production-attendance-search').value);
    return Array.from(state.drafts.values()).filter(draft=>{
      if(department && draft.employee.department !== department) return false;
      if(needle && ![draft.employee.employeeId,draft.employee.name,draft.employee.department]
        .some(value=>normalize(value).includes(needle))) return false;
      return true;
    });
  }

  function updateSaveButton(){
    const button = element('production-attendance-save-button');
    if(button) button.disabled = state.loading || state.dirty.size === 0;
  }

  function validateDraft(draft){
    return window.PCMSProductionAttendance.validateAttendanceInput({
      attendanceDate:element('production-attendance-date').value,
      employeeId:draft.employee.employeeId,
      normalHours:draft.normalHours,
      overtimeHours:draft.overtimeHours,
      note:draft.note
    });
  }

  function markDirty(employeeId){
    state.dirty.add(employeeId);
    updateSaveButton();
  }

  function refreshRowStatus(input,draft){
    const statusCell = input.closest('tr')?.querySelector('[data-attendance-status]');
    if(statusCell) statusCell.replaceChildren(statusBadge(draft));
  }

  function createHoursInput(draft,field){
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'production-attendance-hours-input';
    input.min = '0';
    input.max = '24';
    input.step = '0.5';
    input.inputMode = 'decimal';
    input.value = String(draft[field]);
    input.disabled = draft.employee.missing === true;
    input.addEventListener('input',()=>{
      draft[field] = Number(input.value);
      markDirty(draft.employee.employeeId);
      const total = input.closest('tr')?.querySelector('[data-attendance-total]');
      if(total) total.textContent = hoursText(Number(draft.normalHours || 0)+Number(draft.overtimeHours || 0));
      refreshRowStatus(input,draft);
    });
    return input;
  }

  function addTextCell(row,value,className=''){
    const cell = document.createElement('td');
    if(className) cell.className = className;
    cell.textContent = String(value || '—');
    if(value) cell.title = String(value);
    row.appendChild(cell);
    return cell;
  }

  function statusBadge(draft){
    const badge = document.createElement('span');
    const dirty = state.dirty.has(draft.employee.employeeId);
    badge.className = `production-status ${draft.employee.missing ? 'is-voided' : draft.record && !dirty ? 'is-active' : 'is-pending'}`;
    badge.classList.add('ui-dual-copy');
    const vi = document.createElement('strong');
    const zh = document.createElement('span');
    if(draft.employee.missing){ vi.textContent = 'Thiếu nhân viên'; zh.textContent = '員工已刪除'; }
    else if(dirty){ vi.textContent = 'Chưa lưu'; zh.textContent = '尚未儲存'; }
    else if(draft.record){ vi.textContent = 'Đã lưu'; zh.textContent = '已登記'; }
    else{ vi.textContent = 'Chưa đăng ký'; zh.textContent = '未登記'; }
    badge.append(vi,zh);
    return badge;
  }

  function deleteButton(draft){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'production-row-button is-danger';
    button.title = 'Xóa chấm công / 刪除考勤';
    button.setAttribute('aria-label','Xóa chấm công / 刪除考勤');
    const icon = document.createElement('i');
    icon.className = 'ti ti-trash';
    button.appendChild(icon);
    button.addEventListener('click',()=>void deleteRecord(draft));
    return button;
  }

  function render(){
    const body = element('production-attendance-table-body');
    const visible = visibleDrafts();
    body.replaceChildren();
    visible.forEach(draft=>{
      const row = document.createElement('tr');
      addTextCell(row,draft.employee.employeeId,'production-record-text-cell');
      addTextCell(row,draft.employee.name,'production-record-text-cell');
      addTextCell(row,draft.employee.department,'production-record-text-cell');
      const normalCell = document.createElement('td');
      normalCell.className = 'production-number-cell';
      normalCell.appendChild(createHoursInput(draft,'normalHours'));
      const overtimeCell = document.createElement('td');
      overtimeCell.className = 'production-number-cell';
      overtimeCell.appendChild(createHoursInput(draft,'overtimeHours'));
      const totalCell = document.createElement('td');
      totalCell.className = 'production-number-cell production-attendance-total';
      totalCell.dataset.attendanceTotal = 'true';
      totalCell.textContent = hoursText(Number(draft.normalHours || 0)+Number(draft.overtimeHours || 0));
      const statusCell = document.createElement('td');
      statusCell.className = 'production-center-cell';
      statusCell.dataset.attendanceStatus = 'true';
      statusCell.appendChild(statusBadge(draft));
      const actionCell = document.createElement('td');
      actionCell.className = 'production-row-actions';
      if(isAdmin() && draft.record) actionCell.appendChild(deleteButton(draft));
      row.append(normalCell,overtimeCell,totalCell,statusCell,actionCell);
      body.appendChild(row);
    });
    element('production-attendance-empty').hidden = visible.length > 0;
    element('production-attendance-count').textContent = String(visible.length);
    window.PCMSUITable?.refresh?.();
    updateSaveButton();
  }

  async function load(){
    if(state.loading) return;
    state.loading = true;
    updateSaveButton();
    setStatus('Đang tải dữ liệu chấm công...','正在載入考勤資料…','info');
    try{
      state.records = await window.PCMSProductionAttendance.loadDay(
        element('production-attendance-date').value,{force:true}
      );
      resetDrafts();
      renderDepartmentOptions();
      render();
      setStatus('','','info');
    }catch(error){
      state.records = [];
      resetDrafts();
      render();
      setStatus('Không thể tải dữ liệu chấm công.','無法載入考勤資料。','danger');
      await showError(error);
    }finally{
      state.loading = false;
      updateSaveButton();
    }
  }

  function batchValues(){
    const normalHours = Number(element('production-attendance-batch-normal').value);
    const overtimeHours = Number(element('production-attendance-batch-overtime').value);
    if(!window.PCMSProductionAttendance.isValidHours(normalHours)
      || !window.PCMSProductionAttendance.isValidHours(overtimeHours)
      || normalHours+overtimeHours > 24){
      throw new Error('Giờ hàng loạt phải theo đơn vị 0,5 giờ và tổng không vượt quá 24 giờ. / 批次工時須以0.5小時為單位，合計不得超過24小時。');
    }
    return {normalHours,overtimeHours};
  }

  async function applyBatch(){
    try{
      const values = batchValues();
      const targets = visibleDrafts().filter(draft=>draft.employee.missing !== true);
      targets.forEach(draft=>{
        draft.normalHours = values.normalHours;
        draft.overtimeHours = values.overtimeHours;
        markDirty(draft.employee.employeeId);
      });
      render();
      setStatus(
        `Đã áp dụng cho ${targets.length} nhân viên, chưa lưu lên đám mây.`,
        `已套用至 ${targets.length} 位員工，尚未儲存到雲端。`,
        'info'
      );
    }catch(error){ await showError(error); }
  }

  async function save(){
    if(!state.dirty.size) return;
    const inputs = [];
    try{
      state.dirty.forEach(employeeId=>{
        const draft = state.drafts.get(employeeId);
        if(draft && draft.employee.missing !== true) inputs.push(validateDraft(draft));
      });
    }catch(error){ await showError(error); return; }
    state.loading = true;
    updateSaveButton();
    setStatus('Đang lưu dữ liệu chấm công...','正在儲存考勤資料…','info');
    try{
      await window.PCMSProductionAttendance.saveMany(inputs);
      state.loading = false;
      await load();
      setStatus(`Đã lưu ${inputs.length} nhân viên.`,`已儲存 ${inputs.length} 位員工的考勤。`,'success');
    }catch(error){
      setStatus('Chưa lưu dữ liệu chấm công.','考勤資料尚未儲存。','danger');
      await showError(error);
    }finally{
      state.loading = false;
      updateSaveButton();
    }
  }

  async function deleteRecord(draft){
    const record = draft.record;
    if(!record) return;
    const confirmed = await window.PCMSUIComponents.confirmDialog({
      title:{vi:'Xóa chấm công',zh:'刪除考勤'},
      message:{
        vi:`Xóa chấm công ngày ${record.attendanceDate} của ${record.employeeId}? Dữ liệu không thể khôi phục.`,
        zh:`確定刪除 ${record.employeeId} 在 ${record.attendanceDate} 的考勤？刪除後不能復原。`
      }
    });
    if(!confirmed) return;
    try{
      await window.PCMSProductionAttendance.deleteAttendance(record.id);
      await load();
      setStatus('Đã xóa chấm công.','考勤已刪除。','success');
    }catch(error){ await showError(error); }
  }

  function init(){
    if(state.initialized) return;
    state.initialized = true;
    const date = element('production-attendance-date');
    date.value = today();
    syncDateControl();
    date.addEventListener('change',()=>{ syncDateControl(); void load(); });
    element('production-attendance-calendar').addEventListener('click',openAttendanceCalendar);
    element('production-attendance-previous').addEventListener('click',()=>shiftAttendanceDate(-1));
    element('production-attendance-next').addEventListener('click',()=>shiftAttendanceDate(1));
    element('production-attendance-department').addEventListener('change',render);
    element('production-attendance-search').addEventListener('input',render);
    element('production-attendance-apply-button').addEventListener('click',()=>void applyBatch());
    element('production-attendance-save-button').addEventListener('click',()=>void save());
  }

  async function loadProductionAttendanceData(options={}){
    await window.PCMSProductionEmployees.load({revalidate:options.background === true});
    return true;
  }

  async function productionAttendanceInit(){ init(); await load(); }
  function productionAttendanceLeave(){ setStatus('','','info'); }

  window.loadProductionAttendanceData = loadProductionAttendanceData;
  window.productionAttendanceInit = productionAttendanceInit;
  window.productionAttendanceLeave = productionAttendanceLeave;
})();
