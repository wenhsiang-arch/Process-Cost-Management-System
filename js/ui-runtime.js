// ui-runtime.js（共用介面執行控制）：集中主題與字型登記、套用、記憶及安全回復。
(function(){
  const DEFAULT_THEME_ID = 'default'; // DEFAULT_THEME_ID（預設主題識別碼）
  const DEFAULT_FONT_ID = 'default'; // DEFAULT_FONT_ID（預設字型識別碼）
  const THEME_STORAGE_KEY = 'pcms-ui-theme'; // THEME_STORAGE_KEY（主題選擇本機記憶鍵）
  const FONT_STORAGE_KEY = 'pcms-ui-font'; // FONT_STORAGE_KEY（字型選擇本機記憶鍵）
  const ID_PATTERN = /^[a-z0-9-]+$/; // ID_PATTERN（外觀識別碼允許格式）
  const themeRegistry = new Map(); // themeRegistry（可用主題清單）
  const fontRegistry = new Map(); // fontRegistry（可用字型清單）

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

  // initialize（初始化外觀）：先套用已保存選擇，無效時自動回到預設值。
  function initialize(){
    applyTheme(readStored(THEME_STORAGE_KEY));
    applyFont(readStored(FONT_STORAGE_KEY));
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
    listThemes,
    listFonts,
    initialize
  });

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initialize, {once:true}); // DOMContentLoaded（網頁結構載入完成事件）
  }else{
    initialize();
  }
})();
