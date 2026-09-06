import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm'; // vm（隔離執行環境）：驗證動態功能抬頭的實際輸出。

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

const featurePages=[
  'summary','product-change-log','cutting','progress','settings','export','costlog','accounts','permissions',
  'production-entry','production-records','production-bonus','production-attendance','production-employees','performance-bonus-settings'
]; // featurePages（正式功能頁）
const featureScripts=['cutting','orders','summary','data','settings','accounts','permissions']; // featureScripts（本輪介面功能程式）
const featureStyles=['cutting','orders','products','product-change-log','cost','accounts','production','production-process-edit','performance-bonus']; // featureStyles（功能專屬樣式）

test('全部正式功能頁均接上共用頁面與功能樣式',()=>{
  const html=read('index.html');
  const features=read('js/features.js');
  for(const page of featurePages){
    const opening=html.match(new RegExp(`<div class="([^"]*\\bpg\\b[^"]*)" id="pg-${page}"`));
    assert.ok(opening,`缺少 ${page}（功能頁）`);
    if(page==='cutting') assert.match(html,/<div class="cutting-page ui-page">/);
    else assert.match(opening[1],/\bui-page\b/,`${page}（功能頁）未套用共用頁面樣式`);
  }
  for(const style of featureStyles){
    const file=`styles/features/${style}.css`;
    assert.equal(fs.existsSync(new URL(file,root)),true,`${file}（功能樣式）不存在`);
    assert.match(features,new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
});

test('全系統正式功能預設使用緊湊桌機密度且保留可讀控制高度',()=>{
  const html=read('index.html');
  const features=read('js/features.js');
  const core=read('styles/ui-core.css');
  const accounts=read('styles/features/accounts.css');
  const cost=read('styles/features/cost.css');
  const cutting=read('styles/features/cutting.css');
  const products=read('styles/features/products.css');
  const production=read('styles/features/production.css');
  const processEdit=read('styles/features/production-process-edit.css');
  assert.match(core,/--ui-page-padding:\s*12px/);
  assert.match(core,/--ui-control-height-single:\s*36px/);
  assert.match(core,/--ui-control-height-bilingual:\s*44px/);
  assert.match(core,/--ui-tab-min-height:\s*46px/);
  assert.match(core,/--ui-action-tile-width:\s*100px/);
  assert.match(core,/--ui-action-tile-height:\s*68px/);
  assert.match(core,/--ui-section-header-min-height:\s*34px/);
  assert.match(core,/--ui-table-cell-padding-block:\s*5px/);
  assert.match(core,/--ui-table-cell-padding-inline:\s*10px/);
  assert.match(html,/styles\/ui-core\.css\?v=20260813-3/);
  assert.match(html,/\.ct\{[^}]*padding:var\(--ui-page-padding,12px\)/);
  assert.match(html,/js\/features\.js\?v=20260906-2/);
  assert.match(features,/cutting:'styles\/features\/cutting\.css\?v=20260813-1'/);
  assert.match(features,/orders:'styles\/features\/orders\.css\?v=20260810-2'/);
  assert.match(features,/products:'styles\/features\/products\.css\?v=20260824-5'/);
  assert.match(features,/productionProcessEdit:'styles\/features\/production-process-edit\.css\?v=20260825-5'/);
  assert.match(features,/cost:'styles\/features\/cost\.css\?v=20260810-4'/);
  assert.match(features,/accounts:'styles\/features\/accounts\.css\?v=20260813-1'/);
  assert.match(features,/production:'styles\/features\/production\.css\?v=20260824-1'/);
  assert.match(accounts,/\.permission-matrix-table tbody td \{[\s\S]*?height: 38px;[\s\S]*?padding: 4px 7px;/);
  assert.match(cost,/\.cost-log-table th \{[\s\S]*?height: 52px;/);
  assert.match(cost,/\.cost-log-table td \{[\s\S]*?height: 54px;/);
  assert.match(cutting,/\.cut-template-action \{[\s\S]*?height: 40px;/);
  assert.match(products,/\.summary-table-header \{[\s\S]*?min-height: 44px;/);
  assert.match(production,/\.production-registration-header \{[\s\S]*?min-height: 56px;/);
  assert.match(production,/\.production-entry-table-header \{[\s\S]*?min-height: 44px;/);
  assert.match(processEdit,/\.process-edit-section-header/);
});

test('共用操作列以六十八像素為最低高度且多排內容不再被裁切',()=>{
  const html=read('index.html');
  const core=read('styles/ui-core.css');
  const cost=read('styles/features/cost.css');
  const cutting=read('styles/features/cutting.css');
  const production=read('styles/features/production.css');
  const specification=read('UI設計規範與參照/介面設計規範.md');
  const commandRowRule=core.match(/\.ui-command-row \{[^}]*\}/)?.[0]||''; // commandRowRule（共用操作列規則）
  assert.match(core,/\.ui-command-row \{[\s\S]*?min-height: var\(--ui-action-tile-height\);[\s\S]*?height: auto;/);
  assert.doesNotMatch(commandRowRule,/^\s*height: var\(--ui-action-tile-height\);/m);
  assert.match(core,/\.ui-context-grid \{[\s\S]*?min-height: var\(--ui-action-tile-height\);[\s\S]*?height: auto;/);
  assert.match(core,/\.ui-command-row > \.ui-command-actions \{[\s\S]*?min-height: var\(--ui-action-tile-height\);[\s\S]*?height: auto;[\s\S]*?align-self: stretch;/);
  assert.match(core,/\.ui-file-picker \{[\s\S]*?min-height: calc\(var\(--ui-action-tile-height\) \+ 4px\);[\s\S]*?height: auto;/);
  assert.match(core,/\.ui-file-picker \{[\s\S]*?margin: 4px;[\s\S]*?padding: 5px 8px;/);
  assert.doesNotMatch(html,/\.detail-import-drop(?:\{|:hover|\.dragging|\s+i\{|\s+strong\{|\s+span\{)/);
  assert.match(core,/\.ui-context-item > i \{[\s\S]*?align-self: center;/);
  assert.doesNotMatch(core,/\.ui-context-item > i \{[\s\S]*?grid-row: 1 \/ span 2;/);
  assert.match(cost,/\.settings-command-content \{[\s\S]*?min-height: var\(--ui-action-tile-height\);[\s\S]*?height: auto;/);
  assert.match(cost,/\.settings-summary-row \{[\s\S]*?min-height: var\(--ui-action-tile-height\);[\s\S]*?height: auto;[\s\S]*?grid-template-rows: auto;/);
  for(const page of ['settings','export','accounts','permissions','progress']){
    const pageStart=html.indexOf(`id="pg-${page}"`);
    const pageEnd=html.indexOf('<div class="pg',pageStart+1);
    const markup=html.slice(pageStart,pageEnd<0?html.length:pageEnd);
    assert.match(markup,/ui-command-row/,`${page}（功能頁）未使用共用自動高度操作列`);
  }
  assert.match(cutting,/\.cutting-command-row \{[\s\S]*?min-height: var\(--ui-action-tile-height\);[\s\S]*?height: auto;/);
  assert.doesNotMatch(cutting,/\.cutting-command-row \{[\s\S]*?^\s*height: var\(--ui-action-tile-height\);/m);
  assert.match(production,/\.production-entry-command,[\s\S]*?\.production-employee-command \{[\s\S]*?height: auto;/);
  assert.match(specification,/共用操作列預設以 68 像素作為最低高度/);
  assert.match(specification,/右側操作按鈕以 100 × 68 像素為最小尺寸並同步承接該排實際高度/);
});

test('超寬正式表格使用共用浮動水平捲軸且不建立第二條垂直捲軸',()=>{
  const html=read('index.html');
  const source=read('js/ui-table.js');
  const core=read('styles/ui-core.css');
  const specification=read('UI設計規範與參照/介面設計規範.md');
  const commonTableSources=[html,read('js/orders.js'),read('js/cost-log.js')].join('\n');
  assert.match(html,/styles\/ui-core\.css\?v=20260813-3/);
  assert.match(html,/js\/ui-table\.js\?v=20260810-5/);
  assert.match(source,/TABLE_SCROLL_SELECTOR = '\.ui-table-scroll'/);
  assert.match(source,/function isManagedScroller\(element\)/);
  assert.doesNotMatch(source,/shouldShowFloating|scrollHost\.scrollTop|scrollHost\.scrollHeight/);
  assert.match(source,/scrollWidth[\s\S]*?clientWidth[\s\S]*?overflowX === 'auto'/);
  assert.match(source,/floatingScroll\.scrollLeft = activeTarget\.scrollLeft/);
  assert.match(source,/activeTarget\.scrollLeft = floatingScroll\.scrollLeft/);
  assert.match(source,/contentRect\.bottom-barHeight/);
  assert.doesNotMatch(source,/DATA_SECTION_SELECTOR|resolveFloatingAnchor|activeAnchor|anchorRect|showFloatingOnly|floatingOnly:/);
  assert.equal((commonTableSources.match(/data-ui-floating-scroll="only"/g)||[]).length,13);
  assert.match(core,/\.ui-table-floating-scroll \{[\s\S]*?position: fixed;[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: hidden;/);
  assert.match(core,/\.ui-table-floating-scroll\.is-visible \{[\s\S]*?pointer-events: auto;/);
  assert.doesNotMatch(core,/ui-table-floating-anchor|is-ui-floating-anchor/);
  assert.match(specification,/浮動水平捲軸/);
  assert.match(specification,/主內容可視區最下緣/);
  assert.match(specification,/頁面位於頂端時也必須立即顯示/);
});

test('介面功能不再使用瀏覽器原生提示、確認或輸入框',()=>{
  for(const script of featureScripts){
    const source=read(`js/${script}.js`);
    assert.doesNotMatch(source,/\b(?:alert|confirm|prompt)\s*\(/,`${script}.js（功能程式）仍使用瀏覽器原生視窗`);
  }
  const components=read('js/ui-components.js');
  assert.match(components,/function alertDialog\(/);
  assert.match(components,/function confirmDialog\(/);
  assert.match(components,/function promptDialog\(/);
  assert.match(components,/function progressDialog\(/);
});

test('長時間工作均使用共用進度視窗',()=>{
  const progressScripts=['cutting','orders','data']; // progressScripts（含長時間工作的功能程式）
  for(const script of progressScripts){
    const source=read(`js/${script}.js`);
    assert.match(source,/PCMSUIComponents\.progressDialog\(/,`${script}.js（功能程式）未使用共用進度視窗`);
  }
});

test('長篇雙語內容固定先完整越文再完整中文且外觀一致',()=>{
  const core=read('styles/ui-core.css');
  const components=read('js/ui-components.js');
  assert.match(core,/\.ui-language-sections \{[\s\S]*?flex-direction: column;[\s\S]*?color: inherit;[\s\S]*?font-size: inherit;/);
  assert.match(core,/\.ui-language-section \{[\s\S]*?color: inherit;[\s\S]*?font-size: inherit;[\s\S]*?white-space: pre-line;/);
  assert.match(components,/host\.append\(vi,zh\)/);
});

test('裁帶條件式操作匯入前白底且資料可用後才顯示深藍',()=>{
  const html=read('index.html');
  const style=read('styles/ui-core.css');
  const source=read('js/cutting.js');
  const templateButton=html.match(/<button[^>]*id="cut-template-confirm-btn"[^>]*>/)?.[0]||'';
  const previewButton=html.match(/<button[^>]*id="cut-preview-btn"[^>]*>/)?.[0]||'';
  assert.match(templateButton,/ui-command-action/);
  assert.match(templateButton,/is-condition-dependent/);
  assert.match(templateButton,/\bdisabled\b/);
  assert.match(previewButton,/ui-command-action/);
  assert.match(previewButton,/is-condition-dependent/);
  assert.match(previewButton,/\bdisabled\b/);
  assert.match(style,/\.ui-command-action\.is-primary\.is-condition-dependent \{[\s\S]*?background: var\(--ui-color-surface\);/);
  assert.match(style,/\.ui-command-action\.is-primary\.is-condition-dependent\.is-ready \{[\s\S]*?background: var\(--ui-color-primary\);[\s\S]*?color: var\(--ui-color-on-primary\);/);
  assert.match(source,/confirmButton\.classList\.toggle\('is-ready', hasReadyTemplate\)/);
  assert.match(source,/previewBtn\.classList\.toggle\('is-ready', canPreview\)/);
});

test('裁帶已使用正式共用版面骨架且專屬樣式不再重複骨架',()=>{
  const html=read('index.html');
  const core=read('styles/ui-core.css');
  const cuttingStyle=read('styles/features/cutting.css');
  const requiredClasses=[
    'ui-tabs','ui-tab','ui-work-panel','ui-operation-panel','ui-command-row',
    'ui-context-grid','ui-context-item','ui-file-picker','ui-command-actions',
    'ui-command-action','ui-summary-row','ui-summary-item','ui-data-section',
    'ui-section-header','ui-table-frame'
  ]; // requiredClasses（裁帶基準的必要共用類別）
  for(const className of requiredClasses){
    assert.match(html,new RegExp(`class="[^"]*\\b${className}\\b`),`${className}（共用版面類別）未套用到裁帶頁`);
    assert.match(core,new RegExp(`\\.${className}(?:[\\s\\.,:{]|$)`),`${className}（共用版面樣式）未定義於共用樣式`);
  }
  const migratedSelectors=[
    'cutting-tabs','cutting-tab','cutting-panel','cutting-operation-panel',
    'cutting-context-grid','cutting-context-item','cutting-file-picker','cutting-command-actions',
    'cutting-summary-row','cutting-summary-item','cutting-data-section','cutting-section-header'
  ]; // migratedSelectors（已搬入共用樣式的舊裁帶骨架選擇器）
  for(const selector of migratedSelectors){
    assert.doesNotMatch(cuttingStyle,new RegExp(`\\.${selector}\\s*\\{`),`${selector}（裁帶專屬骨架）不應重複定義`);
  }
});

test('第六階段舊功能頁全部使用裁帶共用版面骨架',()=>{
  const html=read('index.html');
  const requiredByPage={
    progress:['ui-work-panel','ui-operation-panel','ui-command-row','ui-data-section','ui-table-frame'],
    summary:['ui-work-panel','ui-operation-panel','ui-command-row','ui-summary-row','ui-data-section','ui-table-frame'],
    settings:['ui-work-panel','ui-operation-panel','ui-command-row','ui-summary-row','ui-data-section','ui-table-frame'],
    export:['ui-work-panel','ui-operation-panel','ui-command-row','ui-data-section','ui-table-frame'],
    costlog:['ui-work-panel','ui-data-section','ui-table-frame'],
    accounts:['ui-work-panel','ui-operation-panel','ui-command-row','ui-data-section','ui-table-frame'],
    permissions:['ui-work-panel','ui-operation-panel','ui-command-row','ui-data-section','ui-table-frame'],
    'production-entry':['ui-work-panel','ui-operation-panel','ui-command-row','ui-data-section','ui-table-frame'],
    'production-records':['ui-work-panel','ui-operation-panel','ui-command-row','ui-data-section','ui-table-frame'],
    'production-employees':['ui-work-panel','ui-operation-panel','ui-command-row','ui-data-section','ui-table-frame']
  }; // requiredByPage（各舊功能頁必要的共用骨架）
  for(const [page,classes] of Object.entries(requiredByPage)){
    const start=html.indexOf(`id="pg-${page}"`);
    assert.notEqual(start,-1,`${page}（功能頁）不存在`);
    const nextPage=html.indexOf('<div class="pg',start+1);
    const modalStart=html.indexOf('<!-- Modals -->',start); // modalStart（彈出視窗區起點）
    const candidates=[nextPage,modalStart,html.length].filter(position=>position>start);
    const markup=html.slice(start,Math.min(...candidates));
    for(const className of classes){
      assert.match(markup,new RegExp(`class="[^"]*\\b${className}\\b`),`${page}（功能頁）缺少 ${className}（共用骨架）`);
    }
    assert.doesNotMatch(markup,/<div class="card">/,`${page}（功能頁）仍使用舊卡片骨架`);
  }
});

test('產能登記維持快速輸入、雙語表頭與下方工序資料配置',()=>{
  const html=read('index.html');
  const core=read('styles/ui-core.css');
  const style=read('styles/features/production.css');
  const searchDropdown=read('js/ui-search-dropdown.js');
  const entrySource=read('js/production/production-entry.js');
  const recordSource=read('js/production/production-records.js');
  const pageStart=html.indexOf('id="pg-production-entry"');
  const pageEnd=html.indexOf('<div class="pg',pageStart+1);
  const markup=html.slice(pageStart,pageEnd);
  assert.match(markup,/id="production-employee-input"[\s\S]*?placeholder="M91234 \/ 1234"/);
  assert.match(markup,/id="production-entry-employee-name-input"[\s\S]*?id="production-employee-name-toggle"[\s\S]*?id="production-employee-name-options"/);
  assert.match(markup,/id="production-order-input"[\s\S]*?id="production-product-input"[\s\S]*?id="production-process-input"/);
  ['employee','order','product','process'].forEach(name=>{
    assert.match(markup,new RegExp(`class="ui-search-dropdown-input"[^>]*id="production-${name}-input"[\\s\\S]*?class="ui-search-dropdown-toggle"[^>]*id="production-${name}-toggle"`));
  });
  assert.match(markup,/Mã hàng[\s\S]*?款號[\s\S]*?SL đơn hàng[\s\S]*?訂單數量[\s\S]*?Số CĐ[\s\S]*?工序號[\s\S]*?SL sản xuất[\s\S]*?生產數量[\s\S]*?Giây[\s\S]*?工序秒數[\s\S]*?SL\/giờ[\s\S]*?每小時數量/);
  assert.doesNotMatch(markup,/Hiệu suất|效率/);
  assert.match(core,/\.ui-search-dropdown-control \{[\s\S]*?position: relative;/);
  assert.match(core,/\.ui-search-dropdown-toggle \{[\s\S]*?position: absolute;[\s\S]*?right: 1px;/);
  assert.match(core,/\.ui-search-dropdown-options \{[\s\S]*?max-height: 260px;[\s\S]*?overflow-y: auto;/);
  assert.match(searchDropdown,/function handleToggle\(\)[\s\S]*?input\.focus\(\{preventScroll:true\}\)/);
  assert.doesNotMatch(searchDropdown,/mouseleave|mouseout/);
  assert.match(entrySource,/function initializeSearchDropdowns\(\)/);
  assert.match(searchDropdown,/event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
  assert.match(entrySource,/selectProcess\(exact,\{focusQuantity:options\.focusNext===true\}\)/);
  assert.match(entrySource,/production-quantity-input'\)\.addEventListener\('keydown'[\s\S]*?void saveEntry\(\)/);
  assert.match(entrySource,/function handleEntryTab\(event,currentId\)/);
  assert.match(entrySource,/function confirmProcessInput\(options=\{\}\)[\s\S]*?Không tìm thấy số công đoạn chính xác/);
  assert.doesNotMatch(recordSource,/\b(?:alert|confirm|prompt)\s*\(/);
  assert.match(markup,/class="production-entry-panels"/);
  assert.match(markup,/production-registration-context[\s\S]*?production-registration-header[\s\S]*?production-employee-inline-panel/);
  assert.match(markup,/class="production-field-label-row"[\s\S]*?id="production-calendar-button"[\s\S]*?id="production-date-input"[\s\S]*?id="production-date-previous"[\s\S]*?id="production-date-next"/);
  assert.match(markup,/id="production-column-settings-menu"[^>]*data-ui-table-columns-menu[^>]*hidden/);
  assert.match(entrySource,/PCMSUITableControls\.create\(\{[\s\S]*?columns:PRODUCTION_TABLE_COLUMNS/);
  assert.doesNotMatch(markup,/production-save-button|Lưu sản lượng|儲存產量/);
  assert.match(markup,/for="production-quantity-input"><strong id="production-quantity-label-vi">Số lượng<\/strong><span id="production-quantity-label-zh">數量<\/span>/);
  assert.match(markup,/id="production-process-input"[^>]*maxlength="2"[\s\S]*?id="production-process-name"[\s\S]*?id="production-quantity-input"/);
  assert.match(markup,/id="production-supplement-help-button"[\s\S]*?Hướng dẫn[\s\S]*?說明/);
  assert.match(entrySource,/key:'supplementHours'/);
  assert.match(markup,/Giờ bổ sung[\s\S]*?補充工時/);
  assert.match(markup,/Bản ghi của nhân viên trong tháng[\s\S]*?id="production-quantity-progress"[\s\S]*?已登記數量 \/ 訂單數量上限/);
  assert.match(style,/\.production-entry-command,[\s\S]*?\.production-employee-command\s*\{[\s\S]*?height:\s*auto;/);
  assert.match(style,/\.production-employee-inline-panel\s*\{[\s\S]*?width:\s*100%;[\s\S]*?grid-template-columns:\s*minmax\(210px, 1\.05fr\) minmax\(220px, 1\.15fr\)[\s\S]*?minmax\(68px, 86px\);[\s\S]*?background:\s*var\(--ui-color-table-header\)/);
  assert.match(style,/\.production-employee-inline-field input\s*\{[\s\S]*?height:\s*36px;[\s\S]*?border:\s*1px solid/);
  assert.match(style,/\.production-employee-inline-field \.ui-search-dropdown-control\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/);
  assert.match(style,/\.production-entry-command\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(style,/\.production-entry-fields\s*\{[\s\S]*?display:\s*flex;[\s\S]*?width:\s*100%;[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?gap:\s*clamp\(5px, \.65vw, 10px\);/);
  assert.match(style,/\.production-process-field \.ui-search-dropdown-control\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/);
  assert.match(style,/\.production-process-name-output\s*\{[\s\S]*?text-overflow:\s*ellipsis;/);
  assert.match(style,/\.production-entry-context-panel\.is-supplement-mode \.production-process-name-output/);
  assert.match(style,/\.production-supplement-help\s*\{/);
  assert.match(style,/\.production-quantity-progress\s*\{[\s\S]*?width:\s*clamp\(210px, 31%, 390px\);[\s\S]*?min-width:\s*0;[\s\S]*?background:\s*var\(--ui-color-primary-soft\);/);
  assert.match(style,/\.production-entry-table th\.production-number-cell,[\s\S]*?\.production-entry-table td\.production-number-cell\s*\{[\s\S]*?text-align:\s*right;/);
  assert.match(style,/\.production-entry-table th\.production-number-cell > \.ui-dual-copy\s*\{[\s\S]*?align-items:\s*flex-end;/);
  assert.match(entrySource,/production-product-code-cell/);
  assert.match(style,/\.production-entry-table td\.production-product-code-cell\s*\{[\s\S]*?font-weight:\s*700;/);
  assert.match(entrySource,/function ensureProductionTableControl\(\)/);
  assert.match(entrySource,/function employeeIdOptionCopy\(item\)\{[\s\S]*?primary:item\.employeeId/);
  assert.match(entrySource,/function employeeNameOptionCopy\(item\)\{[\s\S]*?primary:item\.name\|\|item\.employeeId/);
  assert.match(entrySource,/function confirmEmployeeInput\(optionsId\)[\s\S]*?matches\.length===1/);
  assert.match(style,/\.production-records-table \.production-date-cell,[\s\S]*?\.production-entry-table \.production-date-cell\s*\{/);
  assert.match(style,/\.production-data-section \.ui-table-frame\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(style,/\.production-data-section \.ui-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(style,/\.production-supplement-dialog-backdrop \.ui-dialog\s*\{[\s\S]*?transform:\s*translate\(-50%, -50%\);/);
  assert.match(entrySource,/document\.querySelector\('#ma > \.mn'\)[\s\S]*?new ResizeObserver\(updatePosition\)/);
  assert.match(entrySource,/function productionEntryLeave\(\)[\s\S]*?productionTableControl\?\.deactivate\?\.\(\{resetSort:true\}\)/);
  assert.match(markup,/id="production-entry-table"[^>]*data-ui-table-sticky="original"/);
  assert.doesNotMatch(entrySource,/cloneNode\(/);
  assert.match(style,/\.production-filter-grid\s*\{[\s\S]*?height:\s*auto;[\s\S]*?grid-template-columns:/);
  assert.match(style,/\.production-command-actions\s*\{[\s\S]*?height:\s*auto;[\s\S]*?align-self:\s*stretch;/);
  assert.match(style,/@media \(max-width:\s*1366px\)[\s\S]*?\.production-employee-inline-panel[\s\S]*?\.production-filter-grid[\s\S]*?\.production-employee-fields/);
  assert.doesNotMatch(style,/@media \(max-width:\s*1366px\)[\s\S]*?\.production-entry-fields/);
});

test('款號總表使用同欄配置、標題右側排序箭頭及欄位選擇功能',()=>{
  const html=read('index.html');
  const source=read('js/summary.js');
  const style=read('styles/features/products.css');
  const core=read('styles/ui-core.css');
  const controls=read('js/ui-table-controls.js');
  const features=read('js/features.js');
  const pageStart=html.indexOf('id="pg-summary"');
  const pageEnd=html.indexOf('<div class="pg',pageStart+1);
  const markup=html.slice(pageStart,pageEnd);
  assert.match(markup,/class="ui-section-header summary-table-header"[\s\S]*?class="ui-table-column-settings"[\s\S]*?data-ui-table-columns-button[\s\S]*?data-ui-table-columns-menu/);
  assert.doesNotMatch(markup,/summary-cost-column-option|data-ui-table-column-toggle/);
  assert.match(source,/const SUMMARY_COLUMNS=Object\.freeze\(\[/);
  for(const key of ['index','code','client','zh','vi','size','ops','cost','action']){
    assert.match(source,new RegExp(`key:'${key}'`));
  }
  assert.match(markup,/id="summary-main-table"/);
  assert.match(markup,/id="summary-columns-empty"[^>]*hidden/);
  assert.match(source,/PCMSUITableControls\.create\(\{[\s\S]*?columns:SUMMARY_COLUMNS/);
  assert.match(source,/key:'cost'[\s\S]*?available:\(\)=>canViewCosts\(\)/);
  assert.match(source,/onColumnsChanged:\(\{visibleCount\}\)=>/);
  assert.match(source,/getSort\?\.\(\)[\s\S]*?sort\.direction==='ascending'/);
  assert.match(source,/class="ui-table-sortable-header[\s\S]*?class="ui-table-sort-heading"[\s\S]*?data-ui-table-sort-icon[\s\S]*?class="tv"/);
  assert.doesNotMatch(source,/onclick="sumSort|keydown[\s\S]*?onSortChanged/);
  assert.match(source,/data-ui-table-column="code"[\s\S]*?data-ui-table-column="client"[\s\S]*?data-ui-table-column="action"/);
  assert.match(controls,/selectAll\.indeterminate = selected > 0 && selected < toggles\.length/);
  assert.match(controls,/currentAvailableColumns\(\)[\s\S]*?columnIsAvailable/);
  assert.match(style,/#pg-summary \.summary-main-table \{[\s\S]*?table-layout: fixed;/);
  assert.match(style,/data-ui-table-column="zh"\] \{ width: 22%; \}/);
  assert.match(style,/data-ui-table-column="vi"\] \{ width: 22%; \}/);
  assert.doesNotMatch(style,/summary-column-settings-menu|summary-sort-heading|summary-sort-icon/);
  assert.match(core,/\.ui-table-column-settings-menu \{[\s\S]*?position: absolute;[\s\S]*?width: min\(340px, calc\(100vw - 32px\)\);[\s\S]*?max-height: min\(640px, calc\(100vh - 96px\)\);[\s\S]*?overflow-y: auto;/);
  assert.match(core,/\.ui-table-sort-heading \{[\s\S]*?display: flex;[\s\S]*?align-items: center;/);
  assert.match(core,/\.ui-table-sortable-header \{[\s\S]*?--ui-table-sort-control-space: 23px;/);
  assert.match(core,/\.ui-table-sort-label \{[\s\S]*?max-width: calc\(100% - var\(--ui-table-sort-control-space\)\);[\s\S]*?flex: 0 1 auto;[\s\S]*?overflow: hidden;/);
  assert.match(core,/\.ui-table-sort-label > \.ui-text-vi,[\s\S]*?\.ui-table-sort-label > \.ui-text-zh \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.match(core,/\.ui-table-sort-trigger \{[\s\S]*?z-index: 1;[\s\S]*?flex: 0 0 20px;/);
  assert.match(core,/th\.ui-table-number-cell\.ui-table-sortable-header > \.tv \{[\s\S]*?padding-inline-end: var\(--ui-table-sort-control-space\);/);
  assert.match(core,/th\.ui-table-center-cell \.ui-table-sort-heading \{[\s\S]*?justify-content: center;/);
  assert.match(core,/th\.ui-table-center-cell\.ui-table-sortable-header > \.tv \{[\s\S]*?padding-inline-end: var\(--ui-table-sort-control-space\);[\s\S]*?text-align: center;/);
  assert.match(core,/\.ui-table \.is-column-hidden \{[\s\S]*?display: none;/);
  assert.match(features,/summary:'js\/summary\.js\?v=20260825-2'/);
  assert.match(features,/products:'styles\/features\/products\.css\?v=20260824-5'/);
});

test('訂單明細把工序秒數標示為目前主檔且不再建立訂單快照欄位',()=>{
  const source=read('js/orders.js');
  assert.match(source,/Giây công đoạn hiện tại<br><span[^>]*>目前主檔工序秒數<\/span>/);
  assert.match(source,/\(p\.workStdSec\|\|p\.processSec\|\|0\)\.toLocaleString\(\)/);
  assert.doesNotMatch(source,/quoteSnapshotSec|snapshotHr|orderProcesses/);
});

test('第一批正式表格支援拖曳欄寬、雙擊自動符合及恢復預設',()=>{
  const html=read('index.html');
  const controls=read('js/ui-table-controls.js');
  const core=read('styles/ui-core.css');
  const features=read('js/features.js');
  const specification=read('UI設計規範與參照/介面設計規範.md');
  for(const id of ['summary-main-table','production-entry-table','production-records-table','production-attendance-table']){
    assert.match(html,new RegExp(`id="${id}"[^>]*data-ui-table-resizable="true"`),`${id}（第一批表格）未啟用使用者欄寬調整`);
  }
  assert.match(html,/summary-table-scroll" data-ui-floating-scroll="only"/);
  assert.match(controls,/RESIZE_HANDLE_SELECTOR = '\[data-ui-table-resize-handle\]'/);
  assert.match(controls,/TABLE_PREFERENCE_SCOPE = 'uiTablePreferences'/);
  assert.match(controls,/pcmsDataCache\.write\(TABLE_PREFERENCE_SCOPE,TABLE_PREFERENCE_VERSION/);
  assert.match(controls,/addEventListener\('pointerdown',handleResizePointerDown\)/);
  assert.match(controls,/addEventListener\('dblclick',handleResizeDoubleClick\)/);
  assert.match(controls,/function resetColumnWidths\(\)/);
  assert.match(controls,/SORT_TRIGGER_SELECTOR = '\[data-ui-table-sort-trigger\]'/);
  assert.match(controls,/const trigger = event\.target\?\.closest\?\.\(SORT_TRIGGER_SELECTOR\)/);
  assert.match(controls,/function headerMinimumWidth\(column\)/);
  assert.match(controls,/ti ti-arrows-horizontal/);
  assert.match(controls,/createDualCopy\(\{vi:'Mặc định',zh:'恢復預設'\}\)/);
  assert.match(core,/\.ui-table-resize-handle \{[\s\S]*?cursor: col-resize;[\s\S]*?touch-action: none;/);
  assert.match(core,/\.ui-table-resize-handle \{[\s\S]*?width: 18px;[\s\S]*?height: 24px;[\s\S]*?border-radius: 999px;/);
  assert.match(core,/th:hover > \.ui-table-resize-handle/);
  assert.doesNotMatch(core,/\.ui-table-resize-handle::after/);
  assert.match(core,/\.ui-table-sort-trigger \{[\s\S]*?width: 20px;[\s\S]*?height: 20px;/);
  assert.match(core,/body\.is-ui-table-resizing,[\s\S]*?cursor: col-resize !important;/);
  assert.match(features,/uiTableControls:'js\/ui-table-controls\.js\?v=20260821-1'/);
  assert.match(specification,/只有越文標題右側的排序箭頭可觸發排序/);
  assert.match(specification,/最小寬度以正式表頭顯示名稱為準/);
  assert.doesNotMatch(specification,/整個可排序表頭都能以滑鼠點擊/);
});

test('系統設定頁使用緊湊分組矩陣且保留原欄位事件',()=>{
  const html=read('index.html');
  const style=read('styles/features/cost.css');
  const pageStart=html.indexOf('id="pg-settings"'); // pageStart（設定頁起點）
  const pageEnd=html.indexOf('<div class="pg',pageStart+1); // pageEnd（設定頁終點）
  const settingsMarkup=html.slice(pageStart,pageEnd); // settingsMarkup（設定頁標記）
  assert.match(settingsMarkup,/class="settings-matrix"/);
  assert.match(settingsMarkup,/settings-personnel-section[\s\S]*?settings-rate-section[\s\S]*?settings-efficiency-section/);
  assert.match(settingsMarkup,/settings-command-content[\s\S]*?settings-context-grid[\s\S]*?settings-summary-row ui-summary-row[\s\S]*?settings-command-actions/);
  assert.doesNotMatch(settingsMarkup,/settings-section-body|ui-form-grid/);
  const fieldEvents={
    'ss-sal':'aCC()','ss-ins':'aCC()','ss-meal':'aCC()',
    'ss-tc':'onMC()','ss-hr':'onMH()','ss-usd':'rAll()',
    'ss-twd':'rAll()','ss-ws':'rAll()','ss-eff':'uEff()'
  }; // fieldEvents（設定欄位與原有輸入事件）
  for(const [id,event] of Object.entries(fieldEvents)){
    assert.equal((settingsMarkup.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${id}（設定欄位）必須唯一`);
    const fieldTag=settingsMarkup.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0]||''; // fieldTag（設定欄位標記）
    assert.ok(fieldTag,`${id}（設定欄位）不存在`);
    assert.ok(fieldTag.includes(event),`${id}（設定欄位）原事件不可移除`);
  }
  const groupedNumberIds=['ss-sal','ss-ins','ss-meal','ss-tc','ss-hr','ss-usd','ss-twd']; // groupedNumberIds（千分位欄位識別碼）
  for(const id of groupedNumberIds){
    const fieldTag=settingsMarkup.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0]||'';
    assert.match(fieldTag,/type="text"/);
    assert.match(fieldTag,/inputmode="numeric"/);
    assert.match(fieldTag,/settings-grouped-number/);
    assert.match(fieldTag,/beginSettingNumberEdit\(this\)/);
    assert.match(fieldTag,/finishSettingNumberEdit\(this\)/);
  }
  assert.equal((settingsMarkup.match(/id="rate-updated"/g)||[]).length,1);
  assert.doesNotMatch(settingsMarkup,/rate-updated-twd/);
  assert.match(settingsMarkup,/id="rate-updated"[\s\S]*?id="btn-fetchrate"/);
  const rateButtonTag=settingsMarkup.match(/<button[^>]*id="btn-fetchrate"[^>]*>/)?.[0]||''; // rateButtonTag（匯率按鈕標記）
  assert.ok(rateButtonTag.includes('onclick="fetchRates()"'));
  assert.match(style,/\.settings-matrix \{[\s\S]*?grid-template-columns: minmax\(520px, 1\.12fr\) minmax\(420px, \.88fr\);/);
  assert.match(style,/\.settings-matrix-row \{[\s\S]*?grid-template-columns:[^;]+;/);
  assert.match(style,/#pg-settings \.settings-summary-row[^\{]*\{[\s\S]*?grid-template-columns: repeat\(3/);
  assert.match(style,/#pg-settings \.settings-summary-row \.ui-summary-item \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?grid-template-rows: minmax\(min-content, 1fr\) auto;[\s\S]*?align-content: stretch;/);
  assert.match(style,/#pg-settings \.settings-summary-row \.ui-summary-value \{[\s\S]*?justify-self: end;/);
  assert.match(style,/input\[type="number"\]::\-webkit-inner-spin-button/);
  assert.match(style,/\.settings-rate-status[\s\S]*?white-space: nowrap/);
  assert.doesNotMatch(settingsMarkup,/id="st-ok"/);
  assert.doesNotMatch(settingsMarkup,/id="e-ic"|id="e-fo"/);
  assert.match(settingsMarkup,/id="e-time"/);
  assert.match(settingsMarkup,/Hiệu suất sản xuất thực tế[\s\S]*?實際生產效率/);
  assert.match(settingsMarkup,/id="ss-ws-help"[\s\S]*?款號表/);
  assert.doesNotMatch(settingsMarkup,/<label class="settings-matrix-label"/);
  assert.doesNotMatch(settingsMarkup,/id="ss-eff"[^>]*max="100"/);
  const settingsSource=read('js/settings.js'); // settingsSource（設定功能程式內容）
  assert.match(settingsSource,/replace\(\/,\/g,''\)/);
  assert.match(settingsSource,/toLocaleString\('en-US'\)/);
  assert.match(settingsSource,/setRateUpdatedStatus\(info,now/);
  assert.doesNotMatch(settingsSource,/rate-updated-twd/);
  assert.match(settingsSource,/SETTINGS_POSITIVE_NUMBER_IDS/);
  assert.match(settingsSource,/effectiveMinutes[\s\S]*?workSeconds\*\(efficiency\/100\)[\s\S]*?\/60/);
  assert.match(settingsSource,/PCMSUIComponents\.showToast/);
  const specification=read('UI設計規範與參照/介面設計規範.md');
  assert.match(specification,/所有金額及匯率顯示值必須使用逗號千分位/);
  assert.match(specification,/計算、比對及儲存仍使用不含逗號的純數值/);
});

test('產品工價預覽一次顯示一種幣別且每頁固定五十筆',()=>{
  const html=read('index.html');
  const style=read('styles/features/cost.css');
  const source=read('js/data.js');
  const pageStart=html.indexOf('id="pg-export"'); // pageStart（產品工價匯出頁起點）
  const pageEnd=html.indexOf('<div class="pg',pageStart+1); // pageEnd（產品工價匯出頁終點）
  const markup=html.slice(pageStart,pageEnd); // markup（產品工價匯出頁標記）
  const renderStart=source.indexOf('function rExp()'); // renderStart（產品工價預覽函式起點）
  const renderEnd=source.indexOf('function showSpreadsheetSaveUnsupported',renderStart); // renderEnd（產品工價預覽函式終點）
  const renderSource=source.slice(renderStart,renderEnd); // renderSource（產品工價預覽函式內容）
  assert.match(markup,/id="ex-cl" onchange="setExportClientFilter\(\)"/);
  assert.match(markup,/class="export-preview-currency"[\s\S]*?id="ex-preview-vnd"[\s\S]*?id="ex-preview-usd"[\s\S]*?id="ex-preview-twd"/);
  assert.match(markup,/id="ex-pager"/);
  assert.match(source,/const EXPORT_PREVIEW_PAGE_SIZE=50/);
  assert.match(source,/function setExportPreviewCurrency\(/);
  assert.match(source,/function setExportClientFilter\(/);
  assert.match(source,/function goExportPreviewPage\(/);
  assert.match(source,/classList\.contains\('active'\)/);
  assert.match(renderSource,/filtered\.slice\(start,start\+EXPORT_PREVIEW_PAGE_SIZE\)/);
  assert.match(renderSource,/mkPager\('ex-pager',[\s\S]*?EXPORT_PREVIEW_PAGE_SIZE,'goExportPreviewPage'\)/);
  assert.doesNotMatch(renderSource,/Tổng giá công \(USD\)[\s\S]*?Tổng giá công \(VND\)[\s\S]*?Tổng giá công \(TWD\)/);
  assert.match(style,/#pg-export \.export-data-section table\[data-ui-table-controls="auto"\] \{[\s\S]*?table-layout: fixed;/);
  assert.match(style,/#pg-export \.export-preview-currency-button\.is-active/);
});

test('共用成功提示固定顯示且不改變頁面高度',()=>{
  const html=read('index.html');
  const core=read('styles/ui-core.css');
  const components=read('js/ui-components.js');
  const accounts=read('js/accounts.js');
  const permissions=read('js/permissions.js');
  const productionEntry=read('js/production/production-entry.js');
  const productionEmployees=read('js/production/production-employees.js');
  assert.doesNotMatch(html,/id="sync-status"/);
  assert.match(core,/\.ui-toast-stack \{[\s\S]*?position: fixed;[\s\S]*?top: 70px;[\s\S]*?right: 18px;/);
  assert.match(core,/\.ui-toast-stack \{[\s\S]*?width: auto;[\s\S]*?max-width: min\(360px,[\s\S]*?align-items: flex-end;/);
  assert.match(core,/\.ui-toast \{[\s\S]*?width: max-content;[\s\S]*?padding: 8px 11px;/);
  assert.match(components,/function showToast\(/);
  assert.match(components,/durationMs[\s\S]*?3200/);
  assert.match(components,/showToast,/);
  for(const source of [accounts,permissions,productionEntry,productionEmployees]){
    assert.match(source,/PCMSUIComponents\.showToast/);
  }
});

test('帳號表格使用固定欄寬且使用者識別碼不撐寬頁面',()=>{
  const style=read('styles/features/accounts.css');
  const source=read('js/accounts.js');
  const html=read('index.html');
  assert.match(style,/#pg-accounts table\[data-ui-table-controls="auto"\] \{[\s\S]*?min-width: max\(100%, var\(--ui-table-visible-min-width, 100%\)\);[\s\S]*?table-layout: fixed;/);
  assert.match(html,/id="accounts-table"[^>]*data-ui-table-controls="auto"[^>]*data-ui-table-sticky="original"/);
  assert.match(html,/data-ui-table-column="email"[^>]*data-ui-table-min-width="220"[^>]*data-ui-table-width="300"[^>]*data-ui-table-max-width="420"/);
  assert.match(html,/data-ui-table-column="uid"[^>]*data-ui-table-ellipsis="true"/);
  assert.match(style,/\.accounts-uid \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.match(source,/setLocalizedAttribute\(uidCell,'title'/);
});

test('每個功能頁保留裁帶式平面抬頭且單頁不得省略',()=>{
  const html=read('index.html');
  const core=read('styles/ui-core.css');
  const features=read('js/features.js');
  const auth=read('js/auth.js');
  const specification=read('UI設計規範與參照/介面設計規範.md');
  assert.match(html,/class="module-tabs ui-tabs ui-page-tabs" id="module-tabs-host"/);
  assert.doesNotMatch(html,/\.module-tab\s*\{/);
  assert.match(core,/\.ui-page-tabs \{[\s\S]*?flex-wrap: nowrap;/);
  assert.match(auth,/if\(!pages\.length\|\|moduleConfig\?\.usesInternalTabs===true\)/);
  assert.doesNotMatch(auth,/pages\.length\s*<=\s*1/);
  assert.match(auth,/class="module-tab ui-tab\$\{item\.page===name\?' active':''\}"/);
  assert.match(auth,/class="module-tab-copy ui-dual-copy"/);
  assert.doesNotMatch(auth,/<i class="ti \$\{item\.icon\}"><\/i>/);
  assert.match(features,/id:'preparation'[\s\S]*?mainKey:'preparationMain'[\s\S]*?usesInternalTabs:true/);
  assert.match(html,/data-page-nav="cutting" onclick="sp\('cutting'\)" id="nv-cutting"/);
  assert.match(html,/data-page-nav="piece-cutting" onclick="sp\('piece-cutting'\)" id="nv-piece-cutting"/);
  assert.match(auth,/document\.querySelectorAll\('\[data-page-nav\]'\)/);
  assert.match(auth,/pageConfig\.navId\|\|moduleConfig\?\.navId\|\|name/);
  assert.match(specification,/只有一個頁面時仍顯示一格/);
});

test('動態功能抬頭正確處理單頁、多頁權限與內部分頁',()=>{
  const auth=read('js/auth.js');
  const renderer=auth.match(/function renderModuleTabs\(name\)\{[\s\S]*?^\}/m)?.[0]; // renderer（功能抬頭產生函式）
  assert.ok(renderer,'找不到功能抬頭產生函式');
  const pages=[
    {page:'first',vi:'Trang một',zh:'頁面一'},
    {page:'second',vi:'Trang hai',zh:'頁面二'}
  ]; // pages（測試頁面）
  const render=(name,moduleConfig,allowedPages)=>{
    const host={hidden:true,innerHTML:''}; // host（功能抬頭容器）
    const context={
      window:{PCMSFeatures:{getPage:()=>({moduleId:'demo'}),getModule:()=>moduleConfig}},
      g:()=>host,
      canOpenPage:page=>allowedPages.includes(page)
    }; // context（隔離測試環境）
    vm.runInNewContext(`${renderer}\nrenderModuleTabs(${JSON.stringify(name)});`,context);
    return host;
  };
  const single=render('first',{pages:[pages[0]]},['first']);
  assert.equal(single.hidden,false);
  assert.equal((single.innerHTML.match(/<button/g)||[]).length,1);
  assert.match(single.innerHTML,/module-tab ui-tab active/);
  const permissionFiltered=render('first',{pages},['first']);
  assert.equal(permissionFiltered.hidden,false);
  assert.equal((permissionFiltered.innerHTML.match(/<button/g)||[]).length,1);
  const multiple=render('second',{pages},['first','second']);
  assert.equal((multiple.innerHTML.match(/<button/g)||[]).length,2);
  assert.match(multiple.innerHTML,/Trang hai[\s\S]*?頁面二/);
  const internal=render('first',{pages:[pages[0]],usesInternalTabs:true},['first']);
  assert.equal(internal.hidden,true);
  assert.equal(internal.innerHTML,'');
});

test('裁帶錯誤表維持六比四資訊比例、自動增高及分語言順序',()=>{
  const style=read('styles/features/cutting.css');
  const source=read('js/cutting.js');
  assert.match(style,/\.cutting-error-table \{[\s\S]*?table-layout: fixed;/);
  assert.match(style,/\.cutting-error-table th:nth-child\(1\) \{\s*width: 14%;/);
  assert.match(style,/\.cutting-error-table th:nth-child\(2\) \{\s*width: 52%;/);
  assert.match(style,/\.cutting-error-table th:nth-child\(3\) \{\s*width: 34%;/);
  assert.match(style,/\.cutting-error-table td \{[\s\S]*?height: auto;[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(source,/locationVi[\s\S]*?reasonVi[\s\S]*?locationZh[\s\S]*?reasonZh/);
  assert.doesNotMatch(style,/cutting-error-location|cutting-error-reason/);
});

test('介面規範保留三種正式桌機驗收尺寸',()=>{
  const specification=read('UI設計規範與參照/介面設計規範.md');
  assert.match(specification,/1280\s*[×x]\s*720/);
  assert.match(specification,/1366\s*[×x]\s*768/);
  assert.match(specification,/1920\s*[×x]\s*1080/);
});

test('功能專屬樣式維持桌機版面且內容可縮排',()=>{
  for(const style of featureStyles){
    const source=read(`styles/features/${style}.css`);
    assert.match(source,/min-width:\s*0/,`${style}.css（功能樣式）缺少可縮排保護`);
    assert.doesNotMatch(source,/@media[^\{]*max-width:\s*(?:[1-9]\d{0,2})px/,`${style}.css（功能樣式）不應加入手機尺寸規則`);
  }
});

test('主要功能頁表格只使用主內容區捲軸且不改彈出視窗',()=>{
  const html=read('index.html');
  const core=read('styles/ui-core.css');
  const cuttingStyle=read('styles/features/cutting.css');
  const ordersStyle=read('styles/features/orders.css');
  const summarySource=read('js/summary.js'); // summarySource（款號摘要程式內容）
  const cuttingSource=read('js/cutting.js'); // cuttingSource（裁帶程式內容）
  assert.match(html,/\.ct\{flex:1;overflow:auto;/);
  assert.match(core,/\.ui-page \.ui-table-frame \{\s*overflow: visible;/);
  assert.match(core,/\.ui-page \.ui-table-scroll \{[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/);
  assert.match(cuttingStyle,/#pg-cutting \.ts \{[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/);
  assert.match(cuttingStyle,/#pg-cutting \.cutting-history-scroll \{[\s\S]*?max-height: none;[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: visible;/);
  assert.match(ordersStyle,/#pg-progress \.orders-table-wrap \{[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: visible;/);
  assert.match(ordersStyle,/#pg-progress \.order-manager-panel \{[\s\S]*?overflow: visible;/);
  assert.match(summarySource,/class="summary-detail-table-wrap"><table class="summary-detail-table ui-table" data-ui-table-layout="special">/);
  assert.doesNotMatch(summarySource,/style="overflow-x:auto"><table class="summary-detail-table/);
  assert.match(html,/id="m-order-adjust-history"[\s\S]*?max-height:520px;overflow:auto/);
  assert.match(cuttingSource,/class="ts" style="max-height:320px"/);
});

test('權限管理使用固定職務矩陣、合併母子欄並只標示敏感權限',()=>{
  const html=read('index.html');
  const source=read('js/permissions.js');
  const features=read('js/features.js');
  const style=read('styles/features/accounts.css');
  const specification=read('UI設計規範與參照/介面設計規範.md');
  assert.doesNotMatch(html,/permission-role-tabs|permission-role-card|permission-switch/);
  assert.match(source,/function permissionMatrixRows\(\)/);
  assert.match(source,/const roles=\['admin',\.\.\.CONFIGURABLE_ROLES\]/);
  assert.match(source,/class="permission-matrix-table ui-table"/);
  assert.match(source,/data-permission-filter="differences"/);
  assert.match(source,/data-permission-filter="sensitive"/);
  assert.match(source,/function permissionParentEnabled\(role,row\)/);
  assert.match(source,/function permissionMatrixVisibleRows\(rows\)/);
  assert.match(source,/function permissionMatrixBodyHtml\(rows,roles\)/);
  assert.match(source,/rowspan="\$\{moduleSpan\}"/);
  assert.match(source,/rowspan="\$\{pageSpan\}"/);
  assert.match(source,/permissionMatrixCopy\('Quyền nhạy cảm','敏感權限'\)/);
  assert.match(source,/itemVi:'',itemZh:''/);
  assert.doesNotMatch(source,/Sử dụng chức năng chính|使用主功能|Sử dụng trang|使用分頁/);
  assert.match(source,/window\.permissionSettings\[role\]\[key\]=checked===true/);
  assert.match(source,/firebaseSaveRolePermissions\(payload\)/);
  assert.match(features,/permissions:'js\/permissions\.js\?v=20260823-1'/);
  assert.match(features,/accounts:'styles\/features\/accounts\.css\?v=20260813-1'/);
  assert.match(style,/\.permission-matrix-table \{[\s\S]*?table-layout: fixed;/);
  assert.match(style,/\.permission-matrix-shell \{[\s\S]*?overflow: visible;/);
  assert.doesNotMatch(style,/\.permission-matrix-shell \{[\s\S]*?overflow-x:\s*auto/);
  assert.match(style,/\.permission-matrix-col-module \{ width: 18%; \}/);
  assert.match(style,/\.permission-matrix-col-page \{ width: 20%; \}/);
  assert.match(style,/\.permission-matrix-col-item \{ width: 14%; \}/);
  assert.match(style,/\.permission-matrix-checkmark \{[\s\S]*?width: 20px;[\s\S]*?height: 20px;/);
  assert.match(specification,/權限管理預設使用單一固定矩陣/);
  assert.match(specification,/合併儲存格/);
  assert.match(specification,/母功能關閉時，只暫停該職務下層權限/);
});
