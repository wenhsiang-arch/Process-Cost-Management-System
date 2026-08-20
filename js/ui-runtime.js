// ui-runtime.js（共用介面執行控制）：集中主題、字型與語言顯示模式的登記、套用、記憶及安全回復。
(function(){
  const DEFAULT_THEME_ID = 'default'; // DEFAULT_THEME_ID（預設主題識別碼）
  const DEFAULT_FONT_ID = 'default'; // DEFAULT_FONT_ID（預設字型識別碼）
  const DEFAULT_LANGUAGE_MODE = 'bilingual'; // DEFAULT_LANGUAGE_MODE（未登入與偏好失效時固定使用雙語）
  const LANGUAGE_PREFERENCE_SCOPE = 'uiLanguagePreference'; // LANGUAGE_PREFERENCE_SCOPE（依 UID 隔離的語言偏好快取範圍）
  const LANGUAGE_PREFERENCE_VERSION = '1'; // LANGUAGE_PREFERENCE_VERSION（語言偏好資料格式版本）
  const THEME_STORAGE_KEY = 'pcms-ui-theme'; // THEME_STORAGE_KEY（主題選擇本機記憶鍵）
  const FONT_STORAGE_KEY = 'pcms-ui-font'; // FONT_STORAGE_KEY（字型選擇本機記憶鍵）
  const ID_PATTERN = /^[a-z0-9-]+$/; // ID_PATTERN（外觀識別碼允許格式）
  const LANGUAGE_MODES = Object.freeze([
    Object.freeze({id:'bilingual',vi:'Song ngữ',zh:'雙語'}),
    Object.freeze({id:'vi',vi:'Tiếng Việt',zh:'越文'}),
    Object.freeze({id:'zh',vi:'Tiếng Hoa',zh:'中文'})
  ]); // LANGUAGE_MODES（全系統唯一語言顯示模式清單）
  const LANGUAGE_MODE_IDS = new Set(LANGUAGE_MODES.map(option=>option.id)); // LANGUAGE_MODE_IDS（允許保存的語言模式）
  const themeRegistry = new Map(); // themeRegistry（可用主題清單）
  const fontRegistry = new Map(); // fontRegistry（可用字型清單）
  let currentLanguageMode = DEFAULT_LANGUAGE_MODE; // currentLanguageMode（目前實際顯示模式）
  let languageWritePromise = Promise.resolve(); // languageWritePromise（依使用者操作順序保存語言偏好）
  const ENTER_INPUT_TYPES = new Set(['text','search','number','date','month','email','tel','url','password']); // ENTER_INPUT_TYPES（支援確認鍵的單行輸入類型）

  // normalizeOption（正規化外觀選項）：每個選項都保留越文與中文名稱。
  function normalizeOption(option){
    const id = String(option?.id || '').trim(); // id（外觀選項識別碼）
    if(!ID_PATTERN.test(id)) throw new Error('ID giao diện không hợp lệ / 介面識別碼格式無效');
    return Object.freeze({
      id,
      vi:String(option?.vi || ''),
      zh:String(option?.zh || '')
    });
  }

  // registerTheme（登記主題）：新主題只需載入獨立色彩檔並登記一個選項。
  function registerTheme(option){
    const normalized = normalizeOption(option); // normalized（正規化後的主題）
    themeRegistry.set(normalized.id, normalized);
    return normalized;
  }

  // unregisterTheme（移除主題）：預設主題永久保留，其他主題可獨立移除。
  function unregisterTheme(id){
    const targetId = String(id || ''); // targetId（準備移除的主題識別碼）
    if(targetId === DEFAULT_THEME_ID) return false;
    const removed = themeRegistry.delete(targetId); // removed（是否成功移除）
    if(document.documentElement.dataset.uiTheme === targetId) applyTheme(DEFAULT_THEME_ID);
    return removed;
  }

  // registerFont（登記字型）：新字型只需載入獨立字型檔並登記一個選項。
  function registerFont(option){
    const normalized = normalizeOption(option); // normalized（正規化後的字型）
    fontRegistry.set(normalized.id, normalized);
    return normalized;
  }

  // unregisterFont（移除字型）：預設字型永久保留，其他字型可獨立移除。
  function unregisterFont(id){
    const targetId = String(id || ''); // targetId（準備移除的字型識別碼）
    if(targetId === DEFAULT_FONT_ID) return false;
    const removed = fontRegistry.delete(targetId); // removed（是否成功移除）
    if(document.documentElement.dataset.uiFont === targetId) applyFont(DEFAULT_FONT_ID);
    return removed;
  }

  // readStored（讀取本機外觀選擇）：瀏覽器拒絕存取時直接使用預設值。
  function readStored(key){
    try{
      return localStorage.getItem(key) || '';
    }catch(_){
      return '';
    }
  }

  // writeStored（保存本機外觀選擇）：保存失敗不得影響畫面操作。
  function writeStored(key, value){
    try{
      localStorage.setItem(key, value);
    }catch(_){}
  }

  // normalizeLanguageMode（正規化語言模式）：未知或損壞的值一律安全回到雙語。
  function normalizeLanguageMode(mode){
    const normalized = String(mode || '').trim().toLowerCase(); // normalized（正規化後的語言模式）
    return LANGUAGE_MODE_IDS.has(normalized) ? normalized : DEFAULT_LANGUAGE_MODE;
  }

  // languageDocumentCode（頁面語言代碼）：單語時供瀏覽器及輔助工具辨識目前可見語言。
  function languageDocumentCode(mode){
    return mode === 'zh' ? 'zh-Hant' : 'vi';
  }

  // syncLanguagePicker（同步語言選擇器）：登入後的全域選擇器永遠反映目前模式。
  function syncLanguagePicker(mode){
    const picker = document.getElementById?.('ui-language-mode'); // picker（頂部語言選擇器）
    if(picker && picker.value !== mode) picker.value = mode;
  }

  // notifyLanguageChange（通知版面更新）：共用表格及按需載入功能可由同一事件刷新尺寸。
  function notifyLanguageChange(mode, previousMode){
    if(mode === previousMode || typeof document.dispatchEvent !== 'function') return;
    const EventConstructor = window.CustomEvent || globalThis.CustomEvent; // EventConstructor（自訂事件建構函式）
    if(typeof EventConstructor !== 'function') return;
    document.dispatchEvent(new EventConstructor('pcms:languagechange',{
      detail:Object.freeze({mode,previousMode})
    }));
  }

  // applyLanguageMode（套用語言顯示模式）：只改介面根節點，不讀寫業務資料。
  function applyLanguageMode(mode, options = {}){
    const selected = normalizeLanguageMode(mode); // selected（實際套用的語言模式）
    const previousMode = currentLanguageMode; // previousMode（套用前模式）
    currentLanguageMode = selected;
    document.documentElement.dataset.uiLanguageMode = selected;
    document.documentElement.setAttribute?.('lang',languageDocumentCode(selected));
    syncLanguagePicker(selected);
    if(options.notify !== false) notifyLanguageChange(selected,previousMode);
    return selected;
  }

  // saveLanguagePreference（保存語言偏好）：沿用既有 IndexedDB 並由 data-cache 依可信任 UID 隔離。
  function saveLanguagePreference(mode){
    const expectedUid = String(window.cu?.authUid || ''); // expectedUid（本次保存所屬使用者）
    if(!expectedUid || !window.pcmsDataCache?.write) return Promise.resolve(false);
    languageWritePromise = languageWritePromise
      .catch(()=>false)
      .then(()=>{
        if(String(window.cu?.authUid || '') !== expectedUid) return false;
        return window.pcmsDataCache.write(
          LANGUAGE_PREFERENCE_SCOPE,
          LANGUAGE_PREFERENCE_VERSION,
          {mode:normalizeLanguageMode(mode)}
        );
      });
    return languageWritePromise;
  }

  // setLanguageMode（使用者切換語言）：畫面立即生效，本機保存失敗不阻止當次操作。
  async function setLanguageMode(mode, options = {}){
    const selected = applyLanguageMode(mode); // selected（使用者選擇後的模式）
    if(options.persist !== false) await saveLanguagePreference(selected);
    return selected;
  }

  // loadLanguagePreference（登入後載入偏好）：必須在已建立可信任 UID、主畫面尚未顯示時執行。
  async function loadLanguagePreference(){
    if(!window.cu?.authUid || !window.pcmsDataCache?.read) return applyLanguageMode(DEFAULT_LANGUAGE_MODE);
    try{
      const stored = await window.pcmsDataCache.read(LANGUAGE_PREFERENCE_SCOPE,LANGUAGE_PREFERENCE_VERSION); // stored（目前 UID 的語言偏好）
      return applyLanguageMode(typeof stored === 'string' ? stored : stored?.mode);
    }catch(_error){
      return applyLanguageMode(DEFAULT_LANGUAGE_MODE);
    }
  }

  // resetLanguageMode（清除工作階段顯示狀態）：登出不刪除該 UID 已保存的偏好。
  function resetLanguageMode(){
    return applyLanguageMode(DEFAULT_LANGUAGE_MODE);
  }

  // bindLanguagePicker（連接頂部選擇器）：相同節點只綁定一次，避免重新登入後重複保存。
  function bindLanguagePicker(){
    const picker = document.getElementById?.('ui-language-mode'); // picker（頂部語言選擇器）
    if(!picker || picker.dataset.uiLanguageBound === 'true') return false;
    picker.dataset.uiLanguageBound = 'true';
    picker.addEventListener('change',event=>{
      void setLanguageMode(event.currentTarget?.value);
    });
    syncLanguagePicker(currentLanguageMode);
    return true;
  }

  function unsafeEnterAction(button){
    const identity = `${button?.id || ''} ${button?.className || ''} ${button?.dataset?.uiAction || ''}`.toLowerCase();
    return button?.classList?.contains?.('is-danger')
      || /(^|[\s_-])(danger|delete|remove|destroy|void|revoke|rollback|reset|unlock|cancel|bd2)([\s_-]|$)/.test(identity);
  }

  function safeEnterAction(input){
    const explicitHost = input.closest?.('[data-ui-enter-action]'); // explicitHost（功能明確指定確認動作的容器）
    const selector = String(input.dataset?.uiEnterAction || explicitHost?.dataset?.uiEnterAction || '').trim();
    if(selector){
      try{
        const explicit = document.querySelector(selector);
        if(explicit?.matches?.('button:not(:disabled), input[type="submit"]:not(:disabled)')
          && !unsafeEnterAction(explicit)) return explicit;
      }catch(_error){}
    }
    const searchContext = input.type === 'search'
      || Boolean(input.closest?.('[class*="search"], [class*="filter"], [id*="search"], [id*="filter"]'));
    if(!searchContext) return null;
    const host = input.closest?.('.ui-command-row, .ui-operation-panel, .ui-toolbar, .ui-section-header, .ui-dialog, .md, .pg') || document;
    const actionPattern = input.type === 'search' ? /(search|find|load)/ : /(search|find|load|apply)/;
    return Array.from(host.querySelectorAll?.('button:not(:disabled)') || []).find(button=>{
      if(unsafeEnterAction(button)) return false;
      const identity = `${button.id || ''} ${button.className || ''} ${button.dataset?.uiAction || ''}`.toLowerCase();
      if(/(toggle|dropdown|picker|clear|previous|next)/.test(identity)) return false;
      return actionPattern.test(identity);
    }) || null;
  }

  // bindEnterInputSupport（全域單行輸入確認）：搜尋區執行搜尋，其餘輸入只完成目前值，不自動觸發破壞性動作。
  function bindEnterInputSupport(){
    if(typeof document.addEventListener !== 'function') return false;
    if(document.documentElement.dataset.uiEnterInputBound === 'true') return false;
    document.documentElement.dataset.uiEnterInputBound = 'true';
    document.addEventListener('keydown',event=>{
      if(event.key !== 'Enter' || event.defaultPrevented || event.isComposing || event.repeat
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const input = event.target;
      if(!(input instanceof HTMLInputElement) || !ENTER_INPUT_TYPES.has(String(input.type || 'text').toLowerCase())
        || input.disabled || input.readOnly || input.dataset.uiEnterIgnore === 'true') return;
      if(input.form || input.closest?.('form')) return;
      const action = safeEnterAction(input);
      event.preventDefault();
      if(action){
        action.click();
        return;
      }
      input.blur?.();
    });
    return true;
  }

  // readMarker（讀取樣式定義識別碼）：用來辨識登記存在但樣式檔遺失的情況。
  function readMarker(propertyName){
    return getComputedStyle(document.documentElement).getPropertyValue(propertyName).trim();
  }

  // updateBrowserThemeColor（更新瀏覽器外框色）：只讀取目前主題的語意色。
  function updateBrowserThemeColor(){
    const meta = document.querySelector('meta[name="theme-color"]'); // meta（瀏覽器主題色標籤）
    const color = readMarker('--ui-browser-theme-color'); // color（目前瀏覽器外框色）
    if(meta && color) meta.setAttribute('content', color);
  }

  // applyTheme（套用主題）：名稱不存在或樣式檔遺失時安全回復預設主題。
  function applyTheme(id, options = {}){
    const requested = themeRegistry.has(String(id || '')) ? String(id) : DEFAULT_THEME_ID; // requested（本次要求的主題）
    document.documentElement.dataset.uiTheme = requested;
    const selected = readMarker('--ui-theme-id') === requested ? requested : DEFAULT_THEME_ID; // selected（實際生效的主題）
    if(selected !== requested) document.documentElement.dataset.uiTheme = DEFAULT_THEME_ID;
    if(options.persist !== false) writeStored(THEME_STORAGE_KEY, selected); // persist（是否保存選擇）
    updateBrowserThemeColor();
    return selected;
  }

  // applyFont（套用字型）：名稱不存在或樣式檔遺失時安全回復預設字型。
  function applyFont(id, options = {}){
    const requested = fontRegistry.has(String(id || '')) ? String(id) : DEFAULT_FONT_ID; // requested（本次要求的字型）
    document.documentElement.dataset.uiFont = requested;
    const selected = readMarker('--ui-font-id') === requested ? requested : DEFAULT_FONT_ID; // selected（實際生效的字型）
    if(selected !== requested) document.documentElement.dataset.uiFont = DEFAULT_FONT_ID;
    if(options.persist !== false) writeStored(FONT_STORAGE_KEY, selected); // persist（是否保存選擇）
    return selected;
  }

  // listThemes（列出可用主題）：回傳副本，避免功能頁修改中央清單。
  function listThemes(){
    return Array.from(themeRegistry.values(), item=>({...item}));
  }

  // listFonts（列出可用字型）：回傳副本，避免功能頁修改中央清單。
  function listFonts(){
    return Array.from(fontRegistry.values(), item=>({...item}));
  }

  // initialize（初始化外觀）：未取得可信任 UID 前固定雙語，主題與字型沿用既有本機選擇。
  function initialize(){
    applyTheme(readStored(THEME_STORAGE_KEY));
    applyFont(readStored(FONT_STORAGE_KEY));
    applyLanguageMode(DEFAULT_LANGUAGE_MODE,{notify:false});
    bindLanguagePicker();
    bindEnterInputSupport();
  }

  registerTheme({id:DEFAULT_THEME_ID, vi:'Mặc định xanh trắng xám', zh:'預設藍白灰'});
  registerFont({id:DEFAULT_FONT_ID, vi:'Phông chữ mặc định', zh:'預設字型'});

  window.PCMSUIRuntime = Object.freeze({ // PCMSUIRuntime（共用介面執行控制）
    registerTheme,
    unregisterTheme,
    registerFont,
    unregisterFont,
    applyTheme,
    applyFont,
    applyLanguageMode,
    setLanguageMode,
    loadLanguagePreference,
    resetLanguageMode,
    getLanguageMode:()=>currentLanguageMode,
    listLanguageModes:()=>LANGUAGE_MODES.map(option=>({...option})),
    listThemes,
    listFonts,
    bindEnterInputSupport,
    initialize
  });

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initialize, {once:true}); // DOMContentLoaded（網頁結構載入完成事件）
  }else{
    initialize();
  }
})();
