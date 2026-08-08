import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm'; // vm（隔離執行環境）：驗證動態功能抬頭的實際輸出。

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

const featurePages=['summary','cutting','sync','progress','settings','export','costlog','accounts','permissions']; // featurePages（正式功能頁）
const featureScripts=['cutting','orders','sync','summary','data','settings','accounts','permissions']; // featureScripts（本輪介面功能程式）
const featureStyles=['cutting','orders','products','sync','cost','accounts']; // featureStyles（功能專屬樣式）

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
  const progressScripts=['cutting','orders','sync','data']; // progressScripts（含長時間工作的功能程式）
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
    sync:['ui-work-panel','ui-operation-panel','ui-command-row','ui-data-section','ui-table-frame'],
    settings:['ui-work-panel','ui-operation-panel','ui-command-row','ui-summary-row','ui-data-section','ui-table-frame'],
    export:['ui-work-panel','ui-operation-panel','ui-command-row','ui-data-section','ui-table-frame'],
    costlog:['ui-work-panel','ui-data-section','ui-table-frame'],
    accounts:['ui-work-panel','ui-operation-panel','ui-command-row','ui-data-section','ui-table-frame'],
    permissions:['ui-work-panel','ui-operation-panel','ui-command-row','ui-data-section','ui-table-frame']
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

test('系統設定頁使用緊湊分組矩陣且保留原欄位事件',()=>{
  const html=read('index.html');
  const style=read('styles/features/cost.css');
  const pageStart=html.indexOf('id="pg-settings"'); // pageStart（設定頁起點）
  const pageEnd=html.indexOf('<div class="pg',pageStart+1); // pageEnd（設定頁終點）
  const settingsMarkup=html.slice(pageStart,pageEnd); // settingsMarkup（設定頁標記）
  assert.match(settingsMarkup,/class="settings-matrix"/);
  assert.match(settingsMarkup,/settings-personnel-section[\s\S]*?settings-rate-section[\s\S]*?settings-efficiency-section/);
  assert.match(settingsMarkup,/class="settings-summary-row ui-summary-row"/);
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
    assert.ok(fieldTag.includes(`oninput="${event}"`),`${id}（設定欄位）原事件不可變更`);
  }
  const rateButtonTag=settingsMarkup.match(/<button[^>]*id="btn-fetchrate"[^>]*>/)?.[0]||''; // rateButtonTag（匯率按鈕標記）
  assert.ok(rateButtonTag.includes('onclick="fetchRates()"'));
  assert.match(style,/\.settings-matrix \{[\s\S]*?grid-template-columns: minmax\(520px, 1\.12fr\) minmax\(420px, \.88fr\);/);
  assert.match(style,/\.settings-matrix-row \{[\s\S]*?grid-template-columns:[^;]+;/);
  assert.doesNotMatch(style,/#pg-settings \.settings-summary-row[^\{]*\{[^\}]*grid-template-columns: repeat\(2/);
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
  assert.match(features,/id:'cutting'[\s\S]*?usesInternalTabs:true/);
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
  assert.match(cuttingStyle,/#pg-cutting \.cutting-history-scroll \{[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/);
  assert.match(ordersStyle,/#pg-progress \.orders-table-wrap \{[\s\S]*?overflow: visible;/);
  assert.match(ordersStyle,/#pg-progress \.order-manager-panel \{[\s\S]*?overflow: visible;/);
  assert.match(summarySource,/class="summary-detail-table-wrap"><table class="summary-detail-table">/);
  assert.doesNotMatch(summarySource,/style="overflow-x:auto"><table class="summary-detail-table">/);
  assert.match(html,/id="m-order-adjust-history"[\s\S]*?max-height:520px;overflow:auto/);
  assert.match(cuttingSource,/class="ts" style="max-height:320px"/);
});
