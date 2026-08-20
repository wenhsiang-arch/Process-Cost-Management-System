// ui-table-controls.js（共用表格操作控制）：統一欄位選擇與排序狀態，不處理業務資料或權限來源。
(function(){
  'use strict';

  const COLUMN_CELL_SELECTOR = '[data-ui-table-column]'; // COLUMN_CELL_SELECTOR（共用欄位儲存格）
  const COLUMN_TOGGLE_SELECTOR = '[data-ui-table-column-toggle]'; // COLUMN_TOGGLE_SELECTOR（欄位顯示切換項目）
  const SORT_HEADER_SELECTOR = '[data-ui-table-sort-key]'; // SORT_HEADER_SELECTOR（可排序表頭）
  const SORT_TRIGGER_SELECTOR = '[data-ui-table-sort-trigger]'; // SORT_TRIGGER_SELECTOR（唯一可觸發排序的箭頭按鈕）
  const SORT_ICON_SELECTOR = '[data-ui-table-sort-icon]'; // SORT_ICON_SELECTOR（排序狀態圖示）
  const RESIZE_HANDLE_SELECTOR = '[data-ui-table-resize-handle]'; // RESIZE_HANDLE_SELECTOR（欄寬拖曳分隔線）
  const AUTO_TABLE_SELECTOR = 'table[data-ui-table-controls="auto"]'; // AUTO_TABLE_SELECTOR（可由共用程式接入的一般表格）
  const TABLE_PREFERENCE_SCOPE = 'uiTablePreferences'; // TABLE_PREFERENCE_SCOPE（依 UID 隔離的全表格介面偏好）
  const TABLE_PREFERENCE_VERSION = '1'; // TABLE_PREFERENCE_VERSION（表格偏好資料格式版本）
  const DEFAULT_MINIMUM_WIDTH = 56; // DEFAULT_MINIMUM_WIDTH（未指定時的最低可讀欄寬）
  const DEFAULT_MAXIMUM_WIDTH = 720; // DEFAULT_MAXIMUM_WIDTH（未指定時的最大合理欄寬）
  const autoRuntimes = new WeakMap(); // autoRuntimes（一般表格與共用操作執行狀態）
  const tableControls = new Set(); // tableControls（已建立表格控制；切換登入者時套用各自設定）
  let activePageName = ''; // activePageName（目前啟用一般表格操作的頁面）
  let activePage = null; // activePage（目前功能頁）
  let activeAutoTables = new Set(); // activeAutoTables（目前頁面的一般表格）
  let pageObserver = null; // pageObserver（動態表格與資料列觀察器）
  let pageFrameId = 0; // pageFrameId（等待中的一般表格更新工作）
  let generatedTableId = 0; // generatedTableId（沒有識別碼表格的本機流水號）
  let preparedPageName = ''; // preparedPageName（生命週期進入前已準備偏好的頁面）
  let preferenceUserId = ''; // preferenceUserId（目前記憶體偏好所屬可信任使用者）
  let tablePreferences = Object.create(null); // tablePreferences（目前 UID 的各表格欄位顯示與欄寬）
  let preferenceWritePromise = Promise.resolve(false); // preferenceWritePromise（依操作順序保存表格偏好）

  function currentLanguageMode(){
    return window.PCMSUIRuntime?.getLanguageMode?.() || 'bilingual';
  }

  function setLocalizedAttribute(target,attribute,value){
    if(window.PCMSUIText?.setLocalizedAttribute){
      window.PCMSUIText.setLocalizedAttribute(target,attribute,value);
      return;
    }
    const pair = value || {};
    const mode = currentLanguageMode();
    const text = mode === 'vi' ? pair.vi : (mode === 'zh' ? pair.zh : [pair.vi,pair.zh].filter(Boolean).join(' / '));
    target?.setAttribute?.(attribute,String(text || ''));
  }

  function resolveElement(value,root=document){
    if(!value) return null;
    if(typeof value !== 'string') return value;
    return root?.querySelector?.(value) || null;
  }

  function normalizeColumns(columns){
    return (Array.isArray(columns) ? columns : []).map(column=>{
      const label = {vi:String(column?.label?.vi || ''),zh:String(column?.label?.zh || '')};
      const headerLabel = {
        vi:String(column?.headerLabel?.vi || label.vi),
        zh:String(column?.headerLabel?.zh || label.zh)
      }; // headerLabel（表頭顯示名稱）：允許緊湊表頭使用核准短名，欄位選單仍使用完整名稱。
      return Object.freeze({
        key:String(column?.key || ''),
        label,
        headerLabel,
        defaultVisible:column?.defaultVisible !== false,
        available:column?.available,
        minimum:positiveWidth(column?.minimum,DEFAULT_MINIMUM_WIDTH),
        preferred:positiveWidth(column?.preferred,positiveWidth(column?.minimum,DEFAULT_MINIMUM_WIDTH)),
        maximum:positiveWidth(column?.maximum,DEFAULT_MAXIMUM_WIDTH),
        resizable:column?.resizable !== false
      });
    }).filter(column=>column.key);
  }

  function positiveWidth(value,fallback){
    const width = Number(value);
    return Number.isFinite(width) && width > 0 ? width : Number(fallback);
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

  function currentTrustedUserId(){
    const userId = String(window.cu?.authUid || '');
    return userId && window.firebaseAuthUser?.uid === userId ? userId : '';
  }

  function normalizePreferenceTables(value){
    if(!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null);
    return Object.fromEntries(Object.entries(value).filter(([key,item])=>String(key).trim()
      && item && typeof item === 'object' && !Array.isArray(item)));
  }

  async function preparePagePreferences(pageName=''){
    preparedPageName = String(pageName || '');
    const expectedUserId = currentTrustedUserId();
    if(!expectedUserId || !window.pcmsDataCache?.read){
      preferenceUserId = '';
      tablePreferences = Object.create(null);
      tableControls.forEach(control=>control.restorePreference?.());
      return false;
    }
    if(preferenceUserId === expectedUserId) return true;
    try{
      const stored = await window.pcmsDataCache.read(TABLE_PREFERENCE_SCOPE,TABLE_PREFERENCE_VERSION); // stored（目前 UID 的表格偏好）
      if(currentTrustedUserId() !== expectedUserId) return false;
      preferenceUserId = expectedUserId;
      tablePreferences = normalizePreferenceTables(stored?.tables);
      tableControls.forEach(control=>control.restorePreference?.());
      return true;
    }catch(_error){
      if(currentTrustedUserId() === expectedUserId){
        preferenceUserId = expectedUserId;
        tablePreferences = Object.create(null);
        tableControls.forEach(control=>control.restorePreference?.());
      }
      return false;
    }
  }

  function queuePreferenceWrite(){
    const expectedUserId = preferenceUserId;
    if(!expectedUserId || !window.pcmsDataCache?.write) return Promise.resolve(false);
    const snapshot = {tables:JSON.parse(JSON.stringify(tablePreferences))}; // snapshot（本次操作完成時的偏好副本）
    preferenceWritePromise = preferenceWritePromise
      .catch(()=>false)
      .then(()=>{
        if(currentTrustedUserId() !== expectedUserId) return false;
        return window.pcmsDataCache.write(TABLE_PREFERENCE_SCOPE,TABLE_PREFERENCE_VERSION,snapshot);
      });
    return preferenceWritePromise;
  }

  function tablePreferenceKey(table,explicitKey,signature){
    const key = String(explicitKey || table?.dataset?.uiTablePreferenceKey || table?.id || '').trim();
    if(key) return key;
    const pageName = activePageName || preparedPageName || String(table?.closest?.('.pg')?.id || '').replace(/^pg-/,'') || 'page';
    return `${pageName}:${String(signature || 'table')}`;
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

  function createSortLabel(label){
    const copy = document.createElement('span');
    copy.className = 'ui-table-sort-label ui-bilingual';
    const vi = document.createElement('span');
    vi.className = 'ui-text-vi';
    vi.textContent = String(label?.vi || '');
    const zh = document.createElement('span');
    zh.className = 'ui-text-zh';
    zh.textContent = String(label?.zh || '');
    copy.append(vi,zh);
    return copy;
  }

  function normalizeConfiguredHeader(header,column){
    if(!header || !column) return false;
    const visibleLabel = column.headerLabel || column.label; // visibleLabel（實際表頭文字）：不影響欄位選單的完整名稱。
    const sortKey = String(header.dataset?.uiTableSortKey || '');
    if(sortKey){
      const currentLabel = header.querySelector?.('.ui-table-sort-label');
      const currentVi = currentLabel?.querySelector?.('.ui-text-vi');
      const currentZh = currentLabel?.querySelector?.('.ui-text-zh');
      if(currentVi && currentZh){
        currentVi.textContent = visibleLabel.vi;
        currentZh.textContent = visibleLabel.zh;
        return true;
      }
      let icon = header.querySelector?.(SORT_ICON_SELECTOR);
      if(!icon){
        icon = document.createElement('i');
        icon.className = 'ti ti-arrows-sort ui-table-sort-icon is-idle';
        icon.dataset.uiTableSortIcon = 'true';
        icon.setAttribute('aria-hidden','true');
      }
      const trigger = icon.closest?.(SORT_TRIGGER_SELECTOR);
      const resizeHandles = Array.from(header.children || []).filter(child=>child?.dataset?.uiTableResizeHandle === 'true');
      const heading = document.createElement('span');
      heading.className = 'ui-table-sort-heading';
      heading.append(createSortLabel(visibleLabel),trigger || icon);
      header.replaceChildren(heading,...resizeHandles);
      header.classList?.add?.('ui-table-sortable-header');
      header.setAttribute?.('aria-sort',header.getAttribute?.('aria-sort') || 'none');
      return true;
    }
    const dual = header.querySelector?.(':scope > .ui-dual-copy');
    if(dual){
      const vi = dual.querySelector?.(':scope > strong');
      const zh = dual.querySelector?.(':scope > span');
      if(vi) vi.textContent = visibleLabel.vi;
      if(zh) zh.textContent = visibleLabel.zh;
      return true;
    }
    if(!header.querySelector?.(':scope > .tv, :scope > .lvi, :scope > .ui-bilingual')) return false;
    const resizeHandles = Array.from(header.children || []).filter(child=>child?.dataset?.uiTableResizeHandle === 'true');
    header.replaceChildren(createDualCopy(visibleLabel),...resizeHandles);
    return true;
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
    const columnMap = new Map(columns.map(column=>[column.key,column])); // columnMap（欄位識別與欄寬限制）
    const resizable = options.resizable === true || table?.dataset?.uiTableResizable === 'true'; // resizable（是否啟用滑鼠欄寬調整）
    const widthSignature = columns.map(column=>column.key).join('|'); // widthSignature（欄位結構識別）
    const preferenceKey = tablePreferenceKey(table,options.preferenceKey || options.resizeStorageKey,widthSignature); // preferenceKey（依頁面與表格隔離的個人設定鍵）
    const savedPreference = tablePreferences[preferenceKey] || null; // savedPreference（目前 UID 已保存設定；新增欄位沿用舊欄位選擇）
    const visibility = Object.create(null); // visibility（各欄位目前顯示狀態）
    columns.forEach(column=>{ visibility[column.key] = column.defaultVisible; });
    if(savedPreference?.visibility && typeof savedPreference.visibility === 'object'){
      columns.forEach(column=>{
        if(typeof savedPreference.visibility[column.key] === 'boolean') visibility[column.key] = savedPreference.visibility[column.key];
      });
    }
    let resizeWidths = resizable && savedPreference?.widths && typeof savedPreference.widths === 'object'
      ? Object.fromEntries(Object.entries(savedPreference.widths)
        .map(([column,width])=>[String(column),Number(width)])
        .filter(([column,width])=>columns.some(item=>item.key===column) && Number.isFinite(width) && width > 0))
      : {}; // resizeWidths（目前 UID 使用者調整後的各欄寬）
    let activeResize = null; // activeResize（目前進行中的欄寬拖曳）
    let measureCanvas = null; // measureCanvas（依目前表頭字型量測最低欄寬的畫布）
    let availabilitySignature = '';
    let sortState = Object.freeze({key:'',direction:'none'}); // sortState（目前單欄排序狀態）
    let destroyed = false;
    let controlApi = null; // controlApi（目前表格公開控制；銷毀時從登入者切換清單移除）

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

    function headerCells(){
      return Array.from(table.tHead?.rows?.[0]?.cells || []);
    }

    function headerForColumn(key){
      return headerCells().find(header=>String(header.dataset?.uiTableColumn || '') === String(key || '')) || null;
    }

    function cellsForColumn(key){
      return Array.from(table.querySelectorAll(COLUMN_CELL_SELECTOR))
        .filter(cell=>String(cell.dataset?.uiTableColumn || '') === String(key || ''));
    }

    function normalizeHeaderCopies(){
      columns.forEach(column=>normalizeConfiguredHeader(headerForColumn(column.key),column));
    }

    function textWidth(text,element){
      const content = String(text || '');
      const computed = window.getComputedStyle?.(element || table) || {};
      const fontSize = positiveWidth(Number.parseFloat(computed.fontSize),12);
      try{
        measureCanvas ||= document.createElement('canvas');
        const context = measureCanvas.getContext?.('2d');
        if(context){
          context.font = computed.font || `${computed.fontWeight || 400} ${fontSize}px ${computed.fontFamily || 'sans-serif'}`;
          return context.measureText(content).width;
        }
      }catch(_error){}
      return Array.from(content).reduce((total,character)=>total+(/[^\u0000-\u00ff]/.test(character) ? fontSize : fontSize*.58),0);
    }

    function headerMinimumWidth(column){
      const configured = positiveWidth(column?.minimum,DEFAULT_MINIMUM_WIDTH);
      if(column?.resizable === false || column?.key === 'action') return configured;
      const header = headerForColumn(column?.key);
      if(!header) return Math.max(DEFAULT_MINIMUM_WIDTH,Math.min(configured,positiveWidth(column?.preferred,configured)));
      const label = headerLabel(header);
      const heading = header.querySelector?.('.ui-table-sort-heading');
      const viElement = header.querySelector?.('.ui-table-sort-label .ui-text-vi') || heading?.querySelector?.(':scope > span') || header.querySelector?.('.ui-dual-copy > strong') || header;
      const zhElement = header.querySelector?.('.ui-table-sort-label .ui-text-zh') || header.querySelector?.(':scope > .tv') || header.querySelector?.('.ui-dual-copy > span') || header;
      const trigger = header.querySelector?.(SORT_TRIGGER_SELECTOR);
      const headingStyle = window.getComputedStyle?.(heading || header) || {};
      const headerStyle = window.getComputedStyle?.(header) || {};
      const gap = trigger ? positiveWidth(Number.parseFloat(headingStyle.columnGap || headingStyle.gap),3) : 0;
      const triggerWidth = trigger ? positiveWidth(trigger.getBoundingClientRect?.().width,20) : 0;
      const viWidth = textWidth(label.vi || column?.headerLabel?.vi || column?.label?.vi,viElement);
      const zhWidth = textWidth(label.zh || column?.headerLabel?.zh || column?.label?.zh,zhElement);
      const labelWidth = currentLanguageMode() === 'vi'
        ? viWidth
        : (currentLanguageMode() === 'zh' ? zhWidth : Math.max(viWidth,zhWidth));
      const horizontalPadding = (Number.parseFloat(headerStyle.paddingLeft) || 10)+(Number.parseFloat(headerStyle.paddingRight) || 10)+2;
      return Math.max(DEFAULT_MINIMUM_WIDTH,Math.ceil(labelWidth+triggerWidth+gap+horizontalPadding));
    }

    function clampWidth(value,column){
      const minimum = headerMinimumWidth(column);
      const maximum = Math.max(minimum,positiveWidth(column?.maximum,DEFAULT_MAXIMUM_WIDTH));
      return Math.max(minimum,Math.min(maximum,Math.round(Number(value) || minimum)));
    }

    function renderSortTriggers(){
      table.querySelectorAll(SORT_HEADER_SELECTOR).forEach(header=>{
        const icon = header.querySelector?.(SORT_ICON_SELECTOR);
        if(!icon) return;
        let trigger = icon.closest?.(SORT_TRIGGER_SELECTOR);
        if(!trigger){
          trigger = document.createElement('button');
          trigger.type = 'button';
          trigger.tabIndex = -1;
          trigger.className = 'ui-table-sort-trigger';
          trigger.dataset.uiTableSortTrigger = 'true';
          icon.parentElement?.insertBefore?.(trigger,icon);
          trigger.appendChild?.(icon);
        }
        setLocalizedAttribute(trigger,'title',{vi:'Sắp xếp cột',zh:'排序欄位'});
        setLocalizedAttribute(trigger,'aria-label',{vi:'Sắp xếp cột',zh:'排序欄位'});
      });
    }

    function renderResizeHandles(){
      if(!resizable) return;
      const available = new Set(currentAvailableColumns().filter(column=>column.resizable).map(column=>column.key));
      headerCells().forEach(header=>{
        const key = String(header.dataset?.uiTableColumn || '');
        const enabled = available.has(key) && header.dataset?.uiTableResizable !== 'false';
        const current = Array.from(header.children || []).find(child=>child?.dataset?.uiTableResizeHandle === 'true');
        if(!enabled){ current?.remove?.(); return; }
        if(current) return;
        const handle = document.createElement('span');
        handle.className = 'ui-table-resize-handle';
        handle.dataset.uiTableResizeHandle = 'true';
        handle.setAttribute('aria-hidden','true');
        setLocalizedAttribute(handle,'title',{
          vi:'Kéo để đổi độ rộng; nhấp đúp để vừa nội dung',
          zh:'拖曳調整欄寬；雙擊符合內容'
        });
        const icon = document.createElement('i');
        icon.className = 'ti ti-arrows-horizontal';
        icon.setAttribute('aria-hidden','true');
        handle.appendChild(icon);
        header.appendChild(handle);
      });
    }

    function applyResizeWidths(){
      if(!resizable) return;
      const resizedKeys = Object.keys(resizeWidths).filter(key=>columnMap.has(key));
      columns.forEach(column=>{
        const hasWidth = resizedKeys.includes(column.key);
        const width = hasWidth ? clampWidth(resizeWidths[column.key],column) : 0;
        cellsForColumn(column.key).forEach(cell=>{
          if(hasWidth) cell.style.width = `${width}px`;
          else cell.style.removeProperty('width');
        });
      });
      if(!resizedKeys.length){
        table.style.removeProperty('--ui-table-resized-min-width');
        window.PCMSUITable?.refresh?.();
        return;
      }
      const total = visibleKeys().reduce((sum,key)=>{
        const column = columnMap.get(key);
        const stored = Number(resizeWidths[key]);
        if(Number.isFinite(stored) && stored > 0) return sum+clampWidth(stored,column);
        const header = headerForColumn(key);
        const measured = Number(header?.getBoundingClientRect?.().width || column?.preferred || column?.minimum || 0);
        return sum+clampWidth(measured,column);
      },0);
      if(total > 0) table.style.setProperty('--ui-table-resized-min-width',`${Math.ceil(total)}px`);
      else table.style.removeProperty('--ui-table-resized-min-width');
      window.PCMSUITable?.refresh?.();
    }

    function captureVisibleWidths(){
      visibleKeys().forEach(key=>{
        const column = columnMap.get(key);
        const header = headerForColumn(key);
        if(!column || !header) return;
        const measured = Number(header.getBoundingClientRect?.().width || column.preferred || column.minimum);
        resizeWidths[key] = clampWidth(measured,column);
      });
    }

    function persistResizeWidths(){
      const widths = Object.fromEntries(Object.entries(resizeWidths)
        .filter(([key,width])=>columnMap.has(key) && Number.isFinite(Number(width)) && Number(width) > 0)
        .map(([key,width])=>[key,Math.round(Number(width))]));
      resizeWidths = widths;
      persistTablePreference();
    }

    function persistTablePreference(){
      if(!preferenceKey || !preferenceUserId) return false;
      tablePreferences[preferenceKey] = {
        signature:widthSignature,
        visibility:Object.fromEntries(columns.map(column=>[column.key,visibility[column.key] !== false])),
        widths:Object.fromEntries(Object.entries(resizeWidths)
          .filter(([key,width])=>columnMap.has(key) && Number.isFinite(Number(width)) && Number(width) > 0)
          .map(([key,width])=>[key,Math.round(Number(width))]))
      };
      void queuePreferenceWrite();
      return true;
    }

    function resetColumnWidths(){
      if(!resizable) return false;
      resizeWidths = {};
      applyResizeWidths();
      persistTablePreference();
      return true;
    }

    function measuredContentWidth(key){
      const column = columnMap.get(key);
      const widths = cellsForColumn(key).map(cell=>{
        const scrollWidth = Number(cell.scrollWidth || 0);
        const textWidth = Array.from(String(cell.textContent || '').trim()).length*8+24;
        return Math.max(scrollWidth,textWidth);
      });
      widths.push(headerMinimumWidth(column));
      return clampWidth(Math.max(...widths),column);
    }

    function finishResize(save=true){
      if(!activeResize) return;
      activeResize.header?.classList?.remove?.('is-ui-table-resizing-column');
      activeResize = null;
      table.classList.remove('is-ui-table-resizing');
      document.body?.classList?.remove?.('is-ui-table-resizing');
      window.removeEventListener('pointermove',handleResizePointerMove);
      window.removeEventListener('pointerup',handleResizePointerUp);
      window.removeEventListener('pointercancel',handleResizePointerCancel);
      if(save) persistResizeWidths();
    }

    function handleResizePointerDown(event){
      const handle = event.target?.closest?.(RESIZE_HANDLE_SELECTOR);
      if(!resizable || !handle || !table.contains(handle) || (event.button != null && event.button !== 0)) return;
      const header = handle.closest('th');
      const key = String(header?.dataset?.uiTableColumn || '');
      const column = columnMap.get(key);
      if(!column || column.resizable === false) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      captureVisibleWidths();
      activeResize = {
        key,column,header,startX:Number(event.clientX || 0),
        startWidth:clampWidth(resizeWidths[key] || header.getBoundingClientRect?.().width,column)
      };
      table.classList.add('is-ui-table-resizing');
      header.classList?.add?.('is-ui-table-resizing-column');
      document.body?.classList?.add?.('is-ui-table-resizing');
      window.addEventListener('pointermove',handleResizePointerMove);
      window.addEventListener('pointerup',handleResizePointerUp);
      window.addEventListener('pointercancel',handleResizePointerCancel);
    }

    function handleResizePointerMove(event){
      if(!activeResize) return;
      event.preventDefault?.();
      resizeWidths[activeResize.key] = clampWidth(
        activeResize.startWidth+(Number(event.clientX || 0)-activeResize.startX),
        activeResize.column
      );
      applyResizeWidths();
    }

    function handleResizePointerUp(event){
      if(!activeResize) return;
      event.preventDefault?.();
      finishResize(true);
    }

    function handleResizePointerCancel(){ finishResize(false); }

    function handleResizeDoubleClick(event){
      const handle = event.target?.closest?.(RESIZE_HANDLE_SELECTOR);
      if(!resizable || !handle || !table.contains(handle)) return;
      const header = handle.closest('th');
      const key = String(header?.dataset?.uiTableColumn || '');
      if(!columnMap.has(key)) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      captureVisibleWidths();
      resizeWidths[key] = measuredContentWidth(key);
      applyResizeWidths();
      persistResizeWidths();
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
      renderSortTriggers();
      renderResizeHandles();
      applyResizeWidths();
      const keys = visibleKeys();
      if(frame) frame.hidden = keys.length === 0;
      if(empty) empty.hidden = keys.length !== 0;
      syncMenuToggles();
      options.onColumnsChanged?.({
        visibleKeys:[...keys],
        visibleCount:keys.length,
        visibility:Object.freeze({...visibility}),
        minimumWidth:keys.reduce((total,key)=>total+headerMinimumWidth(columnMap.get(key)),0)
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
      normalizeHeaderCopies();
      if(currentAvailabilitySignature() !== availabilitySignature) renderMenu();
      applyColumns();
      applySort();
      return true;
    }

    function restorePreference(){
      columns.forEach(column=>{ visibility[column.key] = column.defaultVisible; });
      const saved = tablePreferences[preferenceKey];
      if(saved?.visibility && typeof saved.visibility === 'object'){
        columns.forEach(column=>{
          if(typeof saved.visibility[column.key] === 'boolean') visibility[column.key] = saved.visibility[column.key];
        });
      }
      resizeWidths = resizable && saved?.widths && typeof saved.widths === 'object'
        ? Object.fromEntries(Object.entries(saved.widths)
          .map(([column,width])=>[String(column),Number(width)])
          .filter(([column,width])=>columnMap.has(column) && Number.isFinite(width) && width > 0))
        : {};
      return refresh();
    }

    function setAllColumns(visible){
      currentAvailableColumns().forEach(column=>{ visibility[column.key] = visible === true; });
      applyColumns();
      persistTablePreference();
    }

    function resetColumns(){
      columns.forEach(column=>{ visibility[column.key] = column.defaultVisible; });
      applyColumns();
      persistTablePreference();
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
      persistTablePreference();
    }

    function handleSettingsClick(event){
      if(event.target?.closest?.('[data-ui-table-columns-reset]')){
        resetColumns();
        resetColumnWidths();
      }
    }

    function handleTableClick(event){
      const trigger = event.target?.closest?.(SORT_TRIGGER_SELECTOR);
      if(!trigger || !table.contains(trigger)) return;
      const header = trigger.closest?.(SORT_HEADER_SELECTOR);
      if(!header || !table.contains(header)) return;
      event.preventDefault?.();
      event.stopPropagation?.();
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

    function handleLanguageChange(){
      refresh();
    }

    function deactivate(deactivateOptions={}){
      finishResize(false);
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
      table.removeEventListener('pointerdown',handleResizePointerDown);
      table.removeEventListener('dblclick',handleResizeDoubleClick);
      document.removeEventListener('click',handleDocumentClick);
      document.removeEventListener('keydown',handleDocumentKeydown);
      document.removeEventListener('pcms:languagechange',handleLanguageChange);
      finishResize(false);
      if(controlApi) tableControls.delete(controlApi);
      headerCells().forEach(header=>Array.from(header.children || [])
        .filter(child=>child?.dataset?.uiTableResizeHandle === 'true')
        .forEach(handle=>handle.remove?.()));
      destroyed = true;
      closeMenu();
    }

    settingsButton?.addEventListener?.('click',toggleMenu);
    settingsMenu?.addEventListener?.('change',handleSettingsChange);
    settingsMenu?.addEventListener?.('click',handleSettingsClick);
    table.addEventListener('click',handleTableClick);
    if(resizable){
      table.addEventListener('pointerdown',handleResizePointerDown);
      table.addEventListener('dblclick',handleResizeDoubleClick);
    }
    document.addEventListener('click',handleDocumentClick);
    document.addEventListener('keydown',handleDocumentKeydown);
    document.addEventListener('pcms:languagechange',handleLanguageChange);
    renderMenu();
    refresh();

    controlApi = Object.freeze({
      refresh,
      applyColumns,
      restorePreference,
      resetColumns,
      resetColumnWidths,
      setAllColumns,
      getVisibleKeys:()=>[...visibleKeys()],
      getVisibility:()=>Object.freeze({...visibility}),
      getColumnWidths:()=>Object.freeze({...resizeWidths}),
      getSort:()=>sortState,
      deactivate,
      destroy
    });
    tableControls.add(controlApi);
    return controlApi;
  }

  function headerLabel(header){
    const dual = header.querySelector?.('.ui-dual-copy');
    const vi = header.querySelector?.('.ui-table-sort-label .ui-text-vi')?.textContent
      || dual?.querySelector?.('strong')?.textContent
      || header.querySelector?.('.ui-table-sort-heading > span')?.textContent
      || Array.from(header.childNodes || []).filter(node=>node.nodeType === 3).map(node=>node.textContent).join(' ').trim()
      || String(header.textContent || '').trim();
    const zh = header.querySelector?.('.ui-table-sort-label .ui-text-zh')?.textContent
      || dual?.querySelector?.(':scope > span:not(.ui-table-sort-heading)')?.textContent
      || header.querySelector?.('.tv')?.textContent
      || '';
    return {vi:String(vi || '').trim(),zh:String(zh || '').trim()};
  }

  function autoColumnKey(header,index){
    return String(header.dataset.uiTableColumn || header.dataset.uiTableKey || `column-${index+1}`);
  }

  function autoColumnDefinition(header,index,sortEnabled){
    const key = autoColumnKey(header,index);
    const label = headerLabel(header);
    const actionLike = header.dataset.uiTableSortable === 'false'
      || key === 'action'
      || /^thao tác$/i.test(label.vi)
      || label.zh === '操作';
    const textAlign = String(header.style?.textAlign || '');
    const align = header.classList.contains('ui-table-number-cell') || textAlign === 'right'
      ? 'number'
      : (header.classList.contains('ui-table-center-cell') || textAlign === 'center' ? 'center' : 'text');
    const minimum = Number(header.dataset.uiTableMinWidth) || (actionLike ? 88 : (align === 'number' ? 92 : 128));
    const preferred = Math.max(minimum,Number(header.dataset.uiTableWidth) || minimum);
    const maximum = Math.max(preferred,Number(header.dataset.uiTableMaxWidth) || (align === 'text' ? 420 : preferred));
    return {
      key,
      label,
      defaultVisible:header.dataset.uiTableDefaultVisible !== 'false',
      sortable:sortEnabled && !actionLike,
      sortType:String(header.dataset.uiTableSortType || (align === 'number' ? 'number' : 'text')),
      minimum,
      preferred,
      maximum,
      ellipsis:header.dataset.uiTableEllipsis === 'true',
      align,
      resizable:header.dataset.uiTableResizable !== 'false'
    };
  }

  function decorateAutoHeader(header,column){
    header.dataset.uiTableColumn = column.key;
    header.style.setProperty('--ui-table-column-min',`${column.minimum}px`);
    header.style.setProperty('--ui-table-column-width',`${column.preferred}px`);
    header.style.setProperty('--ui-table-column-max',`${column.maximum}px`);
    header.classList.toggle('ui-table-number-cell',column.align === 'number');
    header.classList.toggle('ui-table-center-cell',column.align === 'center');
    if(column.ellipsis) header.classList.add('ui-table-ellipsis');
    if(!column.sortable){
      if(!header.querySelector?.('.ui-dual-copy')) header.replaceChildren(createDualCopy(column.label));
      return;
    }
    header.setAttribute('aria-sort','none');
    header.dataset.uiTableSortKey = column.key;
    header.classList.add('ui-table-sortable-header');
    if(header.querySelector(SORT_ICON_SELECTOR)) return;
    const heading = document.createElement('span');
    heading.className = 'ui-table-sort-heading';
    const label = createSortLabel(column.label);
    const icon = document.createElement('i');
    icon.className = 'ti ti-arrows-sort ui-table-sort-icon is-idle';
    icon.dataset.uiTableSortIcon = 'true';
    icon.setAttribute('aria-hidden','true');
    heading.append(label,icon);
    header.replaceChildren(heading);
  }

  function syncAutoCells(runtime){
    const rows = Array.from(runtime.table.tBodies || []).flatMap(body=>Array.from(body.rows || []));
    rows.forEach(row=>{
      if(row.cells.length !== runtime.columns.length) return;
      if(!runtime.originalOrder.has(row)) runtime.originalOrder.set(row,runtime.nextOrder++);
      runtime.columns.forEach((column,index)=>{
        const cell = row.cells[index];
        if(!cell) return;
        cell.dataset.uiTableColumn = column.key;
        cell.classList.toggle('ui-table-number-cell',column.align === 'number');
        cell.classList.toggle('ui-table-center-cell',column.align === 'center');
        cell.classList.toggle('ui-table-ellipsis',column.ellipsis);
        if(cell.classList.contains('ui-table-ellipsis')){
          const fullText = String(cell.textContent || '').trim();
          if(fullText && fullText !== '—') cell.title = fullText;
        }
      });
    });
  }

  function numericValue(value){
    const normalized = String(value || '').replace(/[,\s]/g,'').replace(/[^0-9+\-.]/g,'');
    const number = Number(normalized);
    return normalized && Number.isFinite(number) ? number : null;
  }

  function dateValue(value){
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if(match) return Number(`${match[1]}${match[2].padStart(2,'0')}${match[3].padStart(2,'0')}`);
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function autoCellValue(cell,column){
    const explicit = cell?.dataset?.uiTableSortValue;
    const input = cell?.querySelector?.('input,select,textarea');
    const text = explicit ?? input?.value ?? cell?.textContent ?? '';
    if(column.sortType === 'number') return numericValue(text);
    if(column.sortType === 'date') return dateValue(text);
    return String(text || '').trim();
  }

  function compareAutoValues(left,right,column,direction){
    const leftValue = autoCellValue(left,column);
    const rightValue = autoCellValue(right,column);
    if((leftValue == null || leftValue === '') && (rightValue == null || rightValue === '')) return 0;
    if(leftValue == null || leftValue === '') return 1;
    if(rightValue == null || rightValue === '') return -1;
    if(typeof leftValue === 'number' && typeof rightValue === 'number') return (leftValue-rightValue)*direction;
    return String(leftValue).localeCompare(String(rightValue),undefined,{numeric:true,sensitivity:'base'})*direction;
  }

  function applyAutoSort(runtime){
    const sort = runtime.control.getSort();
    const body = runtime.table.tBodies?.[0];
    if(!body) return;
    syncAutoCells(runtime);
    const rows = Array.from(body.rows || []).filter(row=>row.cells.length === runtime.columns.length);
    const columnIndex = runtime.columns.findIndex(column=>column.key === sort.key);
    const direction = sort.direction === 'descending' ? -1 : 1;
    const ordered = sort.direction === 'none' || columnIndex < 0
      ? rows.sort((left,right)=>(runtime.originalOrder.get(left)||0)-(runtime.originalOrder.get(right)||0))
      : rows.sort((left,right)=>compareAutoValues(left.cells[columnIndex],right.cells[columnIndex],runtime.columns[columnIndex],direction)
        || (runtime.originalOrder.get(left)||0)-(runtime.originalOrder.get(right)||0));
    const current = Array.from(body.rows || []).filter(row=>row.cells.length === runtime.columns.length);
    if(ordered.every((row,index)=>row === current[index])) return;
    ordered.forEach(row=>body.appendChild(row));
  }

  function updateAutoMinimumWidth(table,columns,visibleKeys,minimumWidth){
    const visible = new Set(visibleKeys);
    const minimum = Number.isFinite(Number(minimumWidth))
      ? Number(minimumWidth)
      : columns.reduce((total,column)=>total+(visible.has(column.key) ? column.minimum : 0),0);
    table.style.setProperty('--ui-table-visible-min-width',`${minimum}px`);
    table.querySelectorAll('tbody tr > td:only-child[colspan]').forEach(cell=>{
      cell.colSpan = Math.max(visibleKeys.length,1);
    });
    window.PCMSUITable?.refresh?.();
  }

  function autoSettingsTarget(table){
    const selector = String(table.dataset.uiTableSettingsTarget || '');
    if(selector) return table.closest('.ui-page')?.querySelector?.(selector) || document.querySelector(selector);
    const frame = table.closest('.ui-table-frame');
    const section = frame?.closest('.ui-data-section');
    const header = section?.querySelector?.('.ui-section-header');
    if(header && header.tagName !== 'BUTTON') return header;
    return frame?.querySelector?.('.ui-toolbar') || null;
  }

  function createAutoSettings(table){
    const target = autoSettingsTarget(table);
    if(!target) return {};
    const id = table.id || `ui-table-auto-${++generatedTableId}`;
    if(!table.id) table.id = id;
    const settings = document.createElement('div');
    settings.className = 'ui-table-column-settings ui-table-column-settings-auto';
    settings.dataset.uiTableAutoSettings = id;
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.className = 'ui-table-column-settings-button';
    setLocalizedAttribute(button,'aria-label',{vi:'Chọn cột hiển thị',zh:'選擇顯示欄位'});
    setLocalizedAttribute(button,'title',{vi:'Chọn cột hiển thị',zh:'選擇顯示欄位'});
    button.setAttribute('aria-expanded','false');
    button.dataset.uiTableColumnsButton = 'true';
    const icon = document.createElement('i');
    icon.className = 'ti ti-list-check';
    button.appendChild(icon);
    const menu = document.createElement('div');
    menu.className = 'ui-table-column-settings-menu';
    menu.hidden = true;
    menu.setAttribute('role','dialog');
    setLocalizedAttribute(menu,'aria-label',{vi:'Chọn cột hiển thị',zh:'選擇顯示欄位'});
    menu.dataset.uiTableColumnsMenu = 'true';
    const menuId = `${id}-column-settings-menu`;
    menu.id = menuId;
    button.setAttribute('aria-controls',menuId);
    settings.append(button,menu);
    target.prepend(settings);
    return {settings,button,menu};
  }

  function createAutoEmpty(table){
    const frame = table.closest('.ui-table-frame');
    if(!frame) return null;
    const empty = document.createElement('div');
    empty.className = 'ui-table-columns-empty';
    empty.hidden = true;
    empty.appendChild(createDualCopy({vi:'Chưa chọn cột hiển thị',zh:'尚未選擇顯示欄位'}));
    frame.insertAdjacentElement('afterend',empty);
    return empty;
  }

  function autoHeaderSignature(table){
    return Array.from(table.tHead?.rows?.[0]?.cells || [])
      .map((header,index)=>`${autoColumnKey(header,index)}:${headerLabel(header).vi}:${headerLabel(header).zh}`)
      .join('|');
  }

  function enhanceAutoTable(table){
    const current = autoRuntimes.get(table);
    const signature = autoHeaderSignature(table);
    if(current && current.signature === signature){
      syncAutoCells(current);
      current.control.refresh();
      applyAutoSort(current);
      return current;
    }
    if(current){
      current.control.destroy();
      current.settings?.remove?.();
      current.empty?.remove?.();
      autoRuntimes.delete(table);
    }
    const headers = Array.from(table.tHead?.rows?.[0]?.cells || []);
    if(!headers.length) return null;
    const preferenceKey = tablePreferenceKey(table,'',signature); // preferenceKey（動態表格在產生暫時 DOM ID 前取得穩定偏好鍵）
    const sortEnabled = table.dataset.uiTableSort !== 'none';
    const columns = headers.map((header,index)=>autoColumnDefinition(header,index,sortEnabled));
    columns.forEach((column,index)=>decorateAutoHeader(headers[index],column));
    const {settings,button,menu} = createAutoSettings(table);
    if(!settings || !button || !menu) return null;
    const empty = createAutoEmpty(table);
    const runtime = {
      table,columns,settings,empty,signature:autoHeaderSignature(table),
      originalOrder:new WeakMap(),nextOrder:1,control:null
    };
    syncAutoCells(runtime);
    runtime.control = create({
      root:table.closest('.ui-page') || document,
      table,
      settings,
      settingsButton:button,
      settingsMenu:menu,
      frame:table.closest('.ui-table-frame'),
      empty,
      columns,
      preferenceKey,
      resizable:table.dataset.uiTableResizable === 'true',
      onColumnsChanged:({visibleKeys,minimumWidth})=>updateAutoMinimumWidth(table,columns,visibleKeys,minimumWidth),
      onSortChanged:()=>applyAutoSort(runtime)
    });
    autoRuntimes.set(table,runtime);
    applyAutoSort(runtime);
    return runtime;
  }

  function scanActivePage(){
    pageFrameId = 0;
    if(!activePage?.classList?.contains('active')) return;
    const latest = new Set(Array.from(activePage.querySelectorAll(AUTO_TABLE_SELECTOR)));
    activeAutoTables.forEach(table=>{
      if(latest.has(table)) return;
      const runtime = autoRuntimes.get(table);
      runtime?.control?.deactivate?.({resetSort:true});
    });
    latest.forEach(enhanceAutoTable);
    activeAutoTables = latest;
  }

  function refreshPage(){
    if(pageFrameId) return;
    pageFrameId = window.requestAnimationFrame(scanActivePage);
  }

  function deactivatePage(pageName){
    if(pageName && activePageName && pageName !== activePageName) return;
    pageObserver?.disconnect?.();
    pageObserver = null;
    if(pageFrameId) window.cancelAnimationFrame(pageFrameId);
    pageFrameId = 0;
    activeAutoTables.forEach(table=>{
      const runtime = autoRuntimes.get(table);
      runtime?.control?.deactivate?.({resetSort:true});
      if(runtime) applyAutoSort(runtime);
    });
    activeAutoTables.clear();
    activePageName = '';
    activePage = null;
  }

  function activatePage(pageName){
    deactivatePage();
    const name = String(pageName || '');
    const page = document.getElementById(`pg-${name}`);
    if(!page) return false;
    activePageName = name;
    activePage = page;
    pageObserver = typeof MutationObserver === 'function' ? new MutationObserver(refreshPage) : null;
    pageObserver?.observe?.(activePage,{subtree:true,childList:true});
    scanActivePage();
    return true;
  }

  window.PCMSUITableControls = Object.freeze({ // PCMSUITableControls（共用表格操作介面）
    create,
    availableColumns,
    nextSortState,
    preparePagePreferences,
    activatePage,
    deactivatePage,
    refreshPage
  });
})();
