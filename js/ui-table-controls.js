// ui-table-controls.js（共用表格操作控制）：統一欄位選擇與排序狀態，不處理業務資料或權限來源。
(function(){
  'use strict';

  const COLUMN_CELL_SELECTOR = '[data-ui-table-column]'; // COLUMN_CELL_SELECTOR（共用欄位儲存格）
  const COLUMN_TOGGLE_SELECTOR = '[data-ui-table-column-toggle]'; // COLUMN_TOGGLE_SELECTOR（欄位顯示切換項目）
  const SORT_HEADER_SELECTOR = '[data-ui-table-sort-key]'; // SORT_HEADER_SELECTOR（可排序表頭）
  const SORT_ICON_SELECTOR = '[data-ui-table-sort-icon]'; // SORT_ICON_SELECTOR（排序狀態圖示）

  function resolveElement(value,root=document){
    if(!value) return null;
    if(typeof value !== 'string') return value;
    return root?.querySelector?.(value) || null;
  }

  function normalizeColumns(columns){
    return (Array.isArray(columns) ? columns : []).map(column=>Object.freeze({
      key:String(column?.key || ''),
      label:{vi:String(column?.label?.vi || ''),zh:String(column?.label?.zh || '')},
      defaultVisible:column?.defaultVisible !== false,
      available:column?.available
    })).filter(column=>column.key);
  }

  function columnIsAvailable(column){
    try{
      return typeof column?.available === 'function' ? column.available() !== false : column?.available !== false;
    }catch(_error){
      return false;
    }
  }

  function availableColumns(columns){
    return normalizeColumns(columns).filter(columnIsAvailable);
  }

  function nextSortState(current,key){
    const nextKey = String(key || '');
    const currentKey = String(current?.key || '');
    const direction = String(current?.direction || 'none');
    if(!nextKey) return Object.freeze({key:'',direction:'none'});
    if(currentKey !== nextKey || direction === 'none'){
      return Object.freeze({key:nextKey,direction:'ascending'});
    }
    if(direction === 'ascending'){
      return Object.freeze({key:nextKey,direction:'descending'});
    }
    return Object.freeze({key:'',direction:'none'});
  }

  function createDualCopy(label){
    const copy = document.createElement('span');
    copy.className = 'ui-dual-copy';
    const vi = document.createElement('strong');
    const zh = document.createElement('span');
    vi.textContent = String(label?.vi || '');
    zh.textContent = String(label?.zh || '');
    copy.append(vi,zh);
    return copy;
  }

  function create(options={}){
    const root = resolveElement(options.root) || document;
    const table = resolveElement(options.table,root);
    const settings = resolveElement(options.settings,root);
    const settingsButton = resolveElement(options.settingsButton,root);
    const settingsMenu = resolveElement(options.settingsMenu,root);
    const frame = resolveElement(options.frame,root);
    const empty = resolveElement(options.empty,root);
    const columns = normalizeColumns(options.columns);
    const visibility = Object.create(null); // visibility（各欄位目前顯示狀態）
    columns.forEach(column=>{ visibility[column.key] = column.defaultVisible; });
    let availabilitySignature = '';
    let sortState = Object.freeze({key:'',direction:'none'}); // sortState（目前單欄排序狀態）
    let destroyed = false;

    if(!table) throw new Error('Thiếu bảng dùng chung / 缺少共用表格');

    function currentAvailableColumns(){
      return columns.filter(columnIsAvailable);
    }

    function currentAvailabilitySignature(){
      return currentAvailableColumns().map(column=>column.key).join('|');
    }

    function visibleKeys(){
      return currentAvailableColumns()
        .filter(column=>visibility[column.key] !== false)
        .map(column=>column.key);
    }

    function closeMenu(){
      if(settingsMenu) settingsMenu.hidden = true;
      settingsButton?.setAttribute?.('aria-expanded','false');
    }

    function toggleMenu(){
      if(!settingsMenu || !settingsButton) return;
      const willOpen = settingsMenu.hidden === true;
      settingsMenu.hidden = !willOpen;
      settingsButton.setAttribute('aria-expanded',String(willOpen));
    }

    function renderMenu(){
      if(!settingsMenu) return;
      const available = currentAvailableColumns();
      settingsMenu.replaceChildren();

      const heading = document.createElement('div');
      heading.className = 'ui-table-column-settings-heading';

      const selectAllLabel = document.createElement('label');
      selectAllLabel.className = 'ui-table-column-settings-select-all';
      const selectAll = document.createElement('input');
      selectAll.type = 'checkbox';
      selectAll.dataset.uiTableSelectAll = 'true';
      selectAllLabel.append(selectAll,createDualCopy({vi:'Chọn tất cả',zh:'全選'}));

      const title = createDualCopy({vi:'Chọn cột hiển thị',zh:'選擇顯示欄位'});
      title.classList.add('ui-table-column-settings-title');

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.tabIndex = -1;
      reset.className = 'ui-table-column-settings-reset';
      reset.dataset.uiTableColumnsReset = 'true';
      reset.appendChild(createDualCopy({vi:'Mặc định',zh:'恢復預設'}));
      heading.append(selectAllLabel,title,reset);
      settingsMenu.appendChild(heading);

      available.forEach(column=>{
        const label = document.createElement('label');
        label.className = 'ui-table-column-settings-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.uiTableColumnToggle = column.key;
        input.checked = visibility[column.key] !== false;
        label.append(input,createDualCopy(column.label));
        settingsMenu.appendChild(label);
      });
      availabilitySignature = available.map(column=>column.key).join('|');
    }

    function syncSelectAll(){
      if(!settingsMenu) return;
      const selectAll = settingsMenu.querySelector('[data-ui-table-select-all]');
      if(!selectAll) return;
      const toggles = Array.from(settingsMenu.querySelectorAll(COLUMN_TOGGLE_SELECTOR));
      const selected = toggles.filter(input=>visibility[input.dataset.uiTableColumnToggle] !== false).length;
      selectAll.checked = toggles.length > 0 && selected === toggles.length;
      selectAll.indeterminate = selected > 0 && selected < toggles.length;
    }

    function syncMenuToggles(){
      if(!settingsMenu) return;
      settingsMenu.querySelectorAll(COLUMN_TOGGLE_SELECTOR).forEach(input=>{
        input.checked = visibility[input.dataset.uiTableColumnToggle] !== false;
      });
      syncSelectAll();
    }

    function applyColumns(){
      const availableKeys = new Set(currentAvailableColumns().map(column=>column.key));
      table.querySelectorAll(COLUMN_CELL_SELECTOR).forEach(cell=>{
        const key = String(cell.dataset.uiTableColumn || '');
        const visible = availableKeys.has(key) && visibility[key] !== false;
        cell.classList.toggle('is-column-hidden',!visible);
      });
      const keys = visibleKeys();
      if(frame) frame.hidden = keys.length === 0;
      if(empty) empty.hidden = keys.length !== 0;
      syncMenuToggles();
      options.onColumnsChanged?.({
        visibleKeys:[...keys],
        visibleCount:keys.length,
        visibility:Object.freeze({...visibility})
      });
      window.PCMSUITable?.refresh?.();
      return keys;
    }

    function applySort(){
      table.querySelectorAll(SORT_HEADER_SELECTOR).forEach(header=>{
        const key = String(header.dataset.uiTableSortKey || '');
        const active = sortState.key === key && sortState.direction !== 'none';
        header.setAttribute('aria-sort',active ? sortState.direction : 'none');
        const icon = header.querySelector(SORT_ICON_SELECTOR);
        if(!icon) return;
        icon.className = active
          ? `ti ${sortState.direction === 'ascending' ? 'ti-arrow-up' : 'ti-arrow-down'} ui-table-sort-icon`
          : 'ti ti-arrows-sort ui-table-sort-icon is-idle';
      });
    }

    function refresh(){
      if(destroyed) return false;
      if(currentAvailabilitySignature() !== availabilitySignature) renderMenu();
      applyColumns();
      applySort();
      return true;
    }

    function setAllColumns(visible){
      currentAvailableColumns().forEach(column=>{ visibility[column.key] = visible === true; });
      applyColumns();
    }

    function resetColumns(){
      columns.forEach(column=>{ visibility[column.key] = column.defaultVisible; });
      applyColumns();
    }

    function handleSettingsChange(event){
      const target = event.target;
      if(target?.dataset?.uiTableSelectAll === 'true'){
        setAllColumns(target.checked);
        return;
      }
      const key = String(target?.dataset?.uiTableColumnToggle || '');
      if(!key || !Object.prototype.hasOwnProperty.call(visibility,key)) return;
      visibility[key] = target.checked === true;
      applyColumns();
    }

    function handleSettingsClick(event){
      if(event.target?.closest?.('[data-ui-table-columns-reset]')) resetColumns();
    }

    function handleTableClick(event){
      const header = event.target?.closest?.(SORT_HEADER_SELECTOR);
      if(!header || !table.contains(header)) return;
      const key = String(header.dataset.uiTableSortKey || '');
      sortState = nextSortState(sortState,key);
      applySort();
      options.onSortChanged?.(sortState);
    }

    function handleDocumentClick(event){
      if(settings?.contains?.(event.target)) return;
      closeMenu();
    }

    function handleDocumentKeydown(event){
      if(event.key === 'Escape') closeMenu();
    }

    function deactivate(deactivateOptions={}){
      closeMenu();
      if(deactivateOptions.resetSort === true){
        sortState = Object.freeze({key:'',direction:'none'});
        applySort();
      }
    }

    function destroy(){
      if(destroyed) return;
      settingsButton?.removeEventListener?.('click',toggleMenu);
      settingsMenu?.removeEventListener?.('change',handleSettingsChange);
      settingsMenu?.removeEventListener?.('click',handleSettingsClick);
      table.removeEventListener('click',handleTableClick);
      document.removeEventListener('click',handleDocumentClick);
      document.removeEventListener('keydown',handleDocumentKeydown);
      destroyed = true;
      closeMenu();
    }

    settingsButton?.addEventListener?.('click',toggleMenu);
    settingsMenu?.addEventListener?.('change',handleSettingsChange);
    settingsMenu?.addEventListener?.('click',handleSettingsClick);
    table.addEventListener('click',handleTableClick);
    document.addEventListener('click',handleDocumentClick);
    document.addEventListener('keydown',handleDocumentKeydown);
    renderMenu();
    refresh();

    return Object.freeze({
      refresh,
      applyColumns,
      resetColumns,
      setAllColumns,
      getVisibleKeys:()=>[...visibleKeys()],
      getVisibility:()=>Object.freeze({...visibility}),
      getSort:()=>sortState,
      deactivate,
      destroy
    });
  }

  window.PCMSUITableControls = Object.freeze({ // PCMSUITableControls（共用表格操作介面）
    create,
    availableColumns,
    nextSortState
  });
})();
