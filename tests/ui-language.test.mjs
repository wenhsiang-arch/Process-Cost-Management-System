import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');
const source=read('js/ui-runtime.js');

function loadRuntime({storedPreference=null}={}){
  const events=[];
  const writes=[];
  const local=new Map();
  const picker={
    value:'',dataset:{},listeners:new Map(),
    addEventListener(type,listener){ this.listeners.set(type,listener); }
  };
  const rootElement={
    dataset:{uiTheme:'default',uiFont:'default',uiLanguageMode:'bilingual'},
    attributes:{lang:'vi'},
    setAttribute(name,value){ this.attributes[name]=String(value); }
  };
  class CustomEvent{
    constructor(type,options={}){ this.type=type; this.detail=options.detail; }
  }
  const document={
    readyState:'complete',documentElement:rootElement,
    getElementById:id=>id==='ui-language-mode'?picker:null,
    querySelector:()=>null,
    dispatchEvent:event=>{ events.push(event); return true; }
  };
  const window={
    CustomEvent,cu:{authUid:'uid-a'},firebaseAuthUser:{uid:'uid-a'},
    pcmsDataCache:{
      async read(scope,version){
        assert.equal(scope,'uiLanguagePreference');
        assert.equal(version,'1');
        return storedPreference;
      },
      async write(scope,version,data){ writes.push({scope,version,data,uid:window.cu?.authUid}); return true; }
    }
  };
  const context={window,document,CustomEvent,globalThis:null,console,Promise,
    localStorage:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,String(value))},
    getComputedStyle:()=>({getPropertyValue:name=>name==='--ui-theme-id'||name==='--ui-font-id'?'default':''})
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(source,context);
  return {api:window.PCMSUIRuntime,window,document,picker,rootElement,events,writes};
}

test('中央語言模式只接受雙語、越文與中文三種值',()=>{
  const {api,rootElement,picker}=loadRuntime();
  assert.deepEqual(Array.from(api.listLanguageModes(),item=>item.id),['bilingual','vi','zh']);
  assert.equal(api.applyLanguageMode('vi'),'vi');
  assert.equal(rootElement.dataset.uiLanguageMode,'vi');
  assert.equal(rootElement.attributes.lang,'vi');
  assert.equal(picker.value,'vi');
  assert.equal(api.applyLanguageMode('zh'),'zh');
  assert.equal(rootElement.attributes.lang,'zh-Hant');
  assert.equal(api.applyLanguageMode('damaged'),'bilingual');
});

test('登入後依目前 UID 讀取與保存語言偏好',async()=>{
  const {api,writes,rootElement}=loadRuntime({storedPreference:{mode:'zh'}});
  assert.equal(await api.loadLanguagePreference(),'zh');
  assert.equal(rootElement.dataset.uiLanguageMode,'zh');
  assert.equal(await api.setLanguageMode('vi'),'vi');
  assert.equal(writes.length,1);
  assert.equal(writes[0].scope,'uiLanguagePreference');
  assert.equal(writes[0].version,'1');
  assert.equal(writes[0].data.mode,'vi');
  assert.equal(writes[0].uid,'uid-a');
});

test('登出只把畫面恢復雙語，不刪除已保存偏好',()=>{
  const {api,rootElement,writes}=loadRuntime();
  api.applyLanguageMode('zh');
  assert.equal(api.resetLanguageMode(),'bilingual');
  assert.equal(rootElement.dataset.uiLanguageMode,'bilingual');
  assert.equal(writes.length,0);
});

test('共用輔助文字依目前模式更新且保留兩種來源',()=>{
  const {api,window,document}=loadRuntime();
  const textSource=read('js/ui-text.js');
  const attributes=new Map();
  const target={
    setAttribute(name,value){ attributes.set(name,String(value)); },
    getAttribute(name){ return attributes.get(name)??null; },
    matches(selector){ return attributes.has(String(selector).slice(1,-1)); },querySelectorAll(){ return []; }
  };
  vm.runInContext(textSource,vm.createContext({window,document,console}));
  window.PCMSUIText.setLocalizedAttribute(target,'aria-label',{vi:'Lưu',zh:'儲存'});
  assert.equal(attributes.get('aria-label'),'Lưu / 儲存');
  api.applyLanguageMode('zh');
  window.PCMSUIText.refreshLocalizedAttributes(target);
  assert.equal(attributes.get('aria-label'),'儲存');
  assert.equal(attributes.get('data-ui-localized-aria-label-vi'),'Lưu');
  assert.equal(attributes.get('data-ui-localized-aria-label-zh'),'儲存');
});

test('舊雙語介面字串只在明確的越文與中文成對時轉換',()=>{
  const {api,window,document}=loadRuntime();
  vm.runInContext(read('js/ui-text.js'),vm.createContext({window,document,console}));
  const pair=window.PCMSUIText.parseLegacyPair('Lưu / 儲存');
  assert.equal(pair.vi,'Lưu');
  assert.equal(pair.zh,'儲存');
  assert.equal(window.PCMSUIText.parseLegacyPair('A / B'),null);
  assert.equal(window.PCMSUIText.parseLegacyPair('訂單 / 123'),null);
  api.applyLanguageMode('vi');
  assert.equal(window.PCMSUIText.visibleText(pair),'Lưu');
  api.applyLanguageMode('zh');
  assert.equal(window.PCMSUIText.visibleText(pair),'儲存');
});

test('明確登記的唯讀欄位值會跟隨語言切換且不改一般輸入值',()=>{
  const {api,window,document}=loadRuntime();
  vm.runInContext(read('js/ui-text.js'),vm.createContext({window,document,console}));
  const attributes=new Map();
  const target={
    value:'原值',
    setAttribute(name,value){ attributes.set(name,String(value)); },
    getAttribute(name){ return attributes.get(name)??null; },
    removeAttribute(name){ attributes.delete(name); },
    matches(selector){ return attributes.has(String(selector).slice(1,-1)); },
    querySelectorAll(){ return []; }
  };
  window.PCMSUIText.setLocalizedValue(target,{vi:'Chưa đăng nhập',zh:'尚未登入'});
  assert.equal(target.value,'Chưa đăng nhập / 尚未登入');
  api.applyLanguageMode('zh');
  window.PCMSUIText.refreshLocalizedValues(target);
  assert.equal(target.value,'尚未登入');
  window.PCMSUIText.clearLocalizedValue(target,'UID-123');
  api.applyLanguageMode('vi');
  window.PCMSUIText.refreshLocalizedValues(target);
  assert.equal(target.value,'UID-123');
});

test('主畫面在顯示前載入 UID 偏好且登出先重設語言',()=>{
  const html=read('index.html');
  const auth=read('js/auth.js');
  const css=read('styles/ui-core.css');
  assert.match(html,/data-ui-language-mode="bilingual"/);
  assert.match(html,/id="ui-language-mode"[\s\S]*?value="bilingual"[\s\S]*?value="vi"[\s\S]*?value="zh"/);
  assert.ok(auth.indexOf('loadLanguagePreference')<auth.indexOf("g('ma').classList.remove('hidden')"));
  assert.ok(auth.indexOf('resetLanguageMode')<auth.indexOf('window.cu=null'));
  assert.match(css,/html\[data-ui-language-mode="vi"\] \.ui-text-zh/);
  assert.match(css,/html\[data-ui-language-mode="zh"\] \.ui-text-vi/);
  assert.match(css,/:root\[data-ui-language-mode="vi"\][\s\S]*?--ui-action-tile-height:\s*56px/);
  assert.match(read('js/ui-text.js'),/LEGACY_TEXT_TARGETS[\s\S]*?button,label,th,option/);
  assert.match(read('js/safe-dom.js'),/PCMSUIText\?\.parseLegacyPair/);
});

test('雲端狀態與款號快速修改使用中央三種語言節點',()=>{
  const firebase=read('js/firebase.js');
  const processEdit=read('js/product-quick-edit.js');
  assert.match(firebase,/PCMSUIText\.set\(el,pair\)/);
  assert.match(firebase,/createLanguageSections\(firebaseDisplayPair/);
  assert.doesNotMatch(firebase,/雲端同步中\.\.\. \/ Đang đồng bộ/);
  assert.match(processEdit,/ui-dual-copy/);
  assert.match(processEdit,/PCMSUIText/);
  assert.match(read('styles/features/production-process-edit.css'),/data-ui-language-mode="vi"/);
  assert.match(read('styles/features/production-process-edit.css'),/data-ui-language-mode="zh"/);
});

test('大型功能的動態狀態與空資料提示具有明確語言身分',()=>{
  const employee=read('js/production/production-employees.js');
  const records=read('js/production/production-records.js');
  const analysis=read('js/production-analysis/production-analysis.js');
  const employeeAnalysis=read('js/production-analysis/employee-analysis.js');
  const cutting=read('js/cutting.js');
  const monitor=read('js/system-monitor/system-monitor.js');
  assert.match(employee,/PCMSUIText\.set\(badge/);
  assert.match(records,/weekday\.appendChild\(window\.PCMSUIText\.create/);
  assert.match(analysis,/function createDualCell/);
  assert.match(employeeAnalysis,/primary\.className='ui-text-vi'/);
  assert.match(cutting,/function cuttingDialogPair/);
  assert.match(cutting,/cutting-status-vi ui-text-vi/);
  assert.match(monitor,/system-monitor-notice[\s\S]*?ui-text-vi[\s\S]*?ui-text-zh/);
});

test('單語模式全域相容摘要、設定、動態提示與舊表頭',()=>{
  const text=read('js/ui-text.js');
  const controls=read('js/ui-table-controls.js');
  const summary=read('js/summary.js');
  const orders=read('js/orders.js');
  const accounts=read('js/accounts.js');
  const costLog=read('js/cost-log.js');
  const productionEntry=read('js/production/production-entry.js');
  const analyses=[
    read('js/production-analysis/employee-analysis.js'),
    read('js/production-analysis/ie-analysis.js'),
    read('js/production-analysis/department-analysis.js')
  ];
  assert.match(text,/LEGACY_TEXT_TARGETS[\s\S]*?\.ui-summary-label[\s\S]*?\.settings-summary-unit[\s\S]*?\.settings-matrix-unit[\s\S]*?\.settings-help-popover/);
  assert.match(text,/function upgradeSummaryLabel\(/);
  assert.match(text,/function upgradeHeaderSecondaryCopy\(/);
  assert.match(text,/attributes:true[\s\S]*?attributeFilter:LOCALIZED_ATTRIBUTES/);
  assert.match(controls,/function createSortLabel\([\s\S]*?ui-table-sort-label ui-bilingual/);
  assert.match(controls,/function normalizeConfiguredHeader\(/);
  assert.match(controls,/function refresh\(\)[\s\S]*?normalizeHeaderCopies\(\)/);
  assert.doesNotMatch(summary,/Khách hàng \/ 客人:/);
  assert.doesNotMatch(orders,/Ghi chú\.\.\. \/ 備註\.\.\./);
  assert.doesNotMatch(accounts,/textContent='Tôi \/ 我'|textContent=a\.active\?'Đang bật \/ 已啟用'/);
  assert.match(costLog,/cost-log-value-head[\s\S]*?ui-text-vi[\s\S]*?ui-text-zh/);
  assert.match(productionEntry,/setEntryLocalizedAttribute\(progress,'title'/);
  analyses.forEach(source=>assert.doesNotMatch(source,/class="ui-summary-label">[^$<]+<span>/));
});
