import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
