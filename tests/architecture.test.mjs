import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

test('登入首頁只預載核心程式且不包含大型表格工具',()=>{
  const html=read('index.html');
  const coreScripts=[...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1].split('?')[0]);
  assert.deepEqual(coreScripts,[
    'js/safe-dom.js','js/ui-text.js','js/ui-runtime.js','js/ui-components.js','js/ui-file-drop.js',
    'js/utils.js','js/data-cache.js','js/features.js','js/auth.js','js/firebase.js'
  ]);
  assert.match(html,/id="pg-home"/);
  assert.doesNotMatch(html,/JSZip|jszip|xlsx\.bundle\.js/);
});

test('電子信箱只用於首次核准且業務權限固定使用 UID',()=>{
  const firebaseSource=read('js/firebase.js');
  const rulesSource=read('firestore.rules');
  const accountsSource=read('js/accounts.js');
  assert.match(firebaseSource,/migrateEmailApprovalToUid/);
  assert.match(firebaseSource,/runTransaction\(db,async transaction=>/);
  assert.match(firebaseSource,/transaction\.set\(uidRef,migratedAccess\)/);
  assert.match(firebaseSource,/transaction\.delete\(emailRef\)/);
  assert.match(rulesSource,/function selfCreatesUidAccess\(userId\)/);
  assert.match(rulesSource,/function selfDeletesMigratedEmailAccess\(userId\)/);
  assert.match(rulesSource,/function accessDocument\(\)[\s\S]*userAccess\/\$\(request\.auth\.uid\)/);
  assert.doesNotMatch(rulesSource,/function hasEmailAccessDocument\(/);
  assert.match(accountsSource,/declaredUid===normalizedAccessId\|\|!email\?'uid':'email'/);
});

test('中央功能清單涵蓋全部頁面及目前全部角色',()=>{
  const source=read('js/features.js');
  const context={
    window:{},
    CONFIGURABLE_ROLES:['manager','clerk','productionDevelopment','productionControl','sales']
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  const feature=context.window.PCMSFeatures;
  const pages=feature.modules.flatMap(module=>module.pages.map(page=>page.page));
  assert.equal(new Set(pages).size,pages.length);
  assert.deepEqual(Array.from(pages).sort(),[
    'accounts','costlog','cutting','export','permissions','progress','settings','summary','sync'
  ]);
  assert.match(read('index.html'),/value="productionDevelopment">Phát triển \/ 開發/);
  assert.match(read('index.html'),/value="sales">Kinh doanh \/ 業務/);
  assert.match(read('js/utils.js'),/productionDevelopment:'Phát triển \/ 開發'/);
  assert.match(read('js/utils.js'),/sales:'Kinh doanh \/ 業務'/);
  assert.doesNotMatch(read('index.html'),/生產開發/);
  assert.doesNotMatch(read('js/utils.js'),/生產開發/);
  for(const role of context.CONFIGURABLE_ROLES){
    assert.equal(Object.values(feature.defaultPermissions[role]).every(value=>value===false),true);
  }
  const orders=feature.getModule('orders');
  const products=feature.getModule('products');
  const settings=feature.getPage('settings');
  assert.equal(orders.restrictions?.length||0,0);
  assert.deepEqual(Array.from(products.pages[0].restrictions||[]).map(item=>item.key),['costView']);
  assert.equal(settings.feature,'settings');
  assert.equal(settings.adminOnly===true,false);
  const normalized=context.window.normalizeFeaturePermissions({progress:true});
  assert.equal(normalized.progress,true);
  assert.equal(normalized.orderImport,true);
});

test('附屬歷史載入失敗不會阻止主功能開啟',()=>{
  const source=read('js/features.js');
  const context={
    window:{},
    CONFIGURABLE_ROLES:['manager','clerk','productionDevelopment','productionControl','sales']
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  const feature=context.window.PCMSFeatures;
  const summaryLoaders=feature.getPage('summary').dataLoaders;
  const settingsLoaders=feature.getPage('settings').dataLoaders;
  const costLogLoaders=feature.getPage('costlog').dataLoaders;
  const importHistory=summaryLoaders.find(item=>item?.name==='ensureImportHistoryLoaded');
  assert.equal(importHistory?.optional,true);
  assert.equal(importHistory?.fallbackTarget,'impHist');
  assert.equal(settingsLoaders.includes('ensureCostLogLoaded'),false);
  assert.equal(costLogLoaders.includes('ensureCostLogLoaded'),true);
  const authSource=read('js/auth.js');
  assert.match(authSource,/if\(item\.optional!==true\) throw error/);
  assert.match(authSource,/showFeatureDataWarnings\(dataWarnings\)/);
});

test('全部功能頁的程式、資料函式及開頁函式均有來源',()=>{
  const source=read('js/features.js');
  const context={
    window:{},
    CONFIGURABLE_ROLES:['manager','clerk','productionDevelopment','productionControl','sales']
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  const scriptFiles={
    settings:'js/settings.js',productCache:'js/product-cache.js',orderProcessCache:'js/order-process-cache.js',
    summary:'js/summary.js',data:'js/data.js',cuttingStore:'js/cutting-store.js',cutting:'js/cutting.js',
    accounts:'js/accounts.js',orders:'js/orders.js',sync:'js/sync.js',permissions:'js/permissions.js'
  }; // scriptFiles（中央清單程式來源）
  const coreFiles=['js/utils.js','js/data-cache.js','js/features.js','js/auth.js','js/firebase.js','js/safe-dom.js'];
  const hasFunction=(combined,name)=>new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(|window\\.${name}\\s*=`).test(combined);
  for(const module of context.window.PCMSFeatures.modules){
    for(const page of module.pages){
      const files=[...coreFiles,...(page.scripts||[]).map(name=>scriptFiles[name])];
      files.forEach(file=>assert.equal(typeof file==='string'&&fs.existsSync(new URL(file,root)),true,`${page.page}: ${file}`));
      const combined=files.map(read).join('\n');
      for(const loaderConfig of page.dataLoaders||[]){
        const name=typeof loaderConfig==='string'?loaderConfig:loaderConfig.name;
        assert.equal(hasFunction(combined,name),true,`${page.page}: ${name}`);
      }
      for(const name of page.onOpen||[]){
        assert.equal(hasFunction(combined,name),true,`${page.page}: ${name}`);
      }
    }
  }
});

test('操作歷史查詢所需複合索引已登記',()=>{
  const indexes=JSON.parse(read('firestore.indexes.json')); // indexes（資料庫索引設定）
  const operationLogIndex=indexes.indexes.find(item=>item.collectionGroup==='operationLogs');
  assert.deepEqual(operationLogIndex?.fields,[
    {fieldPath:'permissionKey',order:'ASCENDING'},
    {fieldPath:'createdAt',order:'DESCENDING'}
  ]);
});

test('裁帶模板識別碼安全且歷史只在點開分頁後讀取',()=>{
  const source=read('js/cutting.js');
  const firebaseSource=read('js/firebase.js');
  const htmlSource=read('index.html');
  assert.match(source,/cuttingDownloadTemplate\(\$\{inlineArg\(t\.id\)\}, this\)/);
  assert.match(source,/cuttingDeleteTemplate\(\$\{inlineArg\(t\.id\)\}\)/);
  assert.doesNotMatch(source,/cuttingDownloadTemplate\('\$\{esc\(t\.id\)\}'/);
  const deleteBody=source.match(/async function cuttingDeleteTemplate\(id\)\{([\s\S]*?)\n  \}\n\n  function cuttingPickOrder/)?.[1]||''; // deleteBody（裁帶模板刪除函式內容）
  assert.match(deleteBody,/action:'cuttingTemplateDelete'/);
  assert.match(deleteBody,/rememberCuttingHistoryLog\(savedLog\)/);
  assert.match(htmlSource,/id="cut-tab-history" onclick="cuttingSwitchTab\('history'\)"/);
  assert.match(htmlSource,/id="cut-history-tb"/);
  assert.match(source,/if\(selectedTab === 'history'\) void cuttingLoadHistory\(\)/);
  assert.match(firebaseSource,/ensureCuttingHistoryLoaded[\s\S]*loadOperationLogs\('cutting'/);
  const featureSource=read('js/features.js');
  const context={window:{},CONFIGURABLE_ROLES:['manager','clerk','productionDevelopment','productionControl','sales']};
  vm.createContext(context);
  vm.runInContext(featureSource,context);
  assert.deepEqual(Array.from(context.window.PCMSFeatures.getPage('cutting').dataLoaders),[]);
});

test('裁帶操作區使用頁面捲動、可辨識結果框與內嵌側欄開關',()=>{
  const html=read('index.html');
  const style=read('styles/features/cutting.css');
  assert.match(html,/<div class="sb-logo">[\s\S]*?id="primary-sidebar-toggle"[\s\S]*?<div class="sb-sec">/);
  assert.match(html,/\.app\.sidebar-collapsed \.sb\{width:44px\}/);
  assert.match(html,/id="cut-results-box"/);
  assert.match(html,/id="cut-results-empty"/);
  assert.match(html,/class="cutting-result-group" id="cut-missing-box"/);
  assert.match(html,/class="cutting-result-group" id="cut-error-box"/);
  assert.match(html,/class="to cutting-page-table">\s*<table>[\s\S]*?id="cut-template-tb"/);
  assert.doesNotMatch(html,/class="ts" style="max-height:260px">\s*<table>[\s\S]*?id="cut-template-tb"/);
  assert.match(style,/\.cutting-guide-disclosure \{\s*position: static;/);
  assert.match(style,/\.cutting-guide-panel \{[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\)/);
  assert.match(style,/\.cutting-command-row \{[\s\S]*?height: var\(--ui-action-tile-height\)/);
  assert.match(style,/\.cutting-command-action\.is-primary:disabled \{/);
});

test('停用主要操作與全域拖曳提示維持可辨識及可讀狀態',()=>{
  const coreStyle=read('styles/ui-core.css'); // coreStyle（共用介面核心樣式）
  const cuttingStyle=read('styles/features/cutting.css'); // cuttingStyle（裁帶專屬樣式）
  const fileDropSource=read('js/ui-file-drop.js'); // fileDropSource（全域拖曳匯入程式）
  assert.match(coreStyle,/\.ui-action-item\.is-primary:disabled,[\s\S]*?background: color-mix\(in srgb, var\(--ui-color-primary\) 12%, var\(--ui-color-surface-muted\)\)/);
  assert.match(cuttingStyle,/\.cutting-command-action\.is-primary:disabled \{[\s\S]*?background: color-mix\(in srgb, var\(--ui-color-primary\) 12%, var\(--ui-color-surface-muted\)\)/);
  assert.match(coreStyle,/\.ui-file-drop-copy \.ui-text-vi \{[\s\S]*?font-size: clamp\(18px,/);
  assert.match(coreStyle,/\.ui-file-drop-copy \.ui-text-zh \{[\s\S]*?font-size: clamp\(15px,/);
  assert.match(coreStyle,/\.ui-file-drop-overlay\.is-icon-only \.ui-file-drop-copy \{[\s\S]*?clip-path: inset\(50%\)/);
  assert.match(fileDropSource,/MIN_TEXT_OVERLAY_WIDTH = 420/);
  assert.match(fileDropSource,/MIN_TEXT_OVERLAY_HEIGHT = 220/);
  assert.match(fileDropSource,/Math\.min\(viewportWidth,rect\.right\)/);
  assert.match(fileDropSource,/Math\.min\(viewportHeight,rect\.bottom\)/);
  assert.match(fileDropSource,/classList\.toggle\('is-icon-only',iconOnly\)/);
});

test('共用操作鎖可區分一秒按鈕冷卻與實際工作狀態',async()=>{
  const timers=[];
  const context={
    window:{
      PCMSUIText:{
        assistiveLabel:()=>'',
        create:()=>({}),
        set:()=>null
      }
    },
    document:{addEventListener:()=>{},querySelectorAll:()=>[]},
    console,
    setTimeout:callback=>{ timers.push(callback); return timers.length; }
  };
  vm.createContext(context);
  vm.runInContext(read('js/ui-components.js'),context);
  const ui=context.window.PCMSUIComponents;
  const control={disabled:false,isConnected:true};
  let finish;
  let runs=0;
  let duplicates=0;
  const task=new Promise(resolve=>{ finish=resolve; });
  const first=ui.runActionOnce('cutting.pdfToolStart',()=>{ runs+=1; return task; },{
    controls:[control],cooldownMs:1000,onDuplicate:()=>{ duplicates+=1; }
  });
  await Promise.resolve();
  assert.equal(control.disabled,true);
  assert.equal(ui.isActionRunning('cutting.pdfToolStart'),true);
  const second=ui.runActionOnce('cutting.pdfToolStart',()=>{ runs+=1; },{onDuplicate:()=>{ duplicates+=1; }});
  assert.equal(first,second);
  assert.equal(runs,1);
  assert.equal(duplicates,1);
  timers[0]();
  assert.equal(control.disabled,false);
  assert.equal(ui.isActionRunning('cutting.pdfToolStart'),true);
  finish(true);
  await first;
  await Promise.resolve();
  assert.equal(ui.isActionRunning('cutting.pdfToolStart'),false);
});

test('裁帶 PDF（可攜式文件）啟動與匯出共用啟動狀態且十秒後可重試',()=>{
  const source=read('js/cutting.js');
  assert.match(source,/PDF_TOOL_START_TIMEOUT_MS = 10000/);
  assert.match(source,/isActionRunning\?\.\(PDF_TOOL_START_ACTION_KEY\)/);
  assert.match(source,/runActionOnce\(PDF_TOOL_START_ACTION_KEY/);
  assert.match(source,/runActionOnce\(PDF_EXPORT_OPEN_ACTION_KEY/);
  assert.match(source,/controls:\[g\('cut-start-pdf-tool-btn'\)\],[\s\S]*?cooldownMs:1000/);
  assert.match(source,/controls:\[g\('cut-preview-btn'\)\],[\s\S]*?cooldownMs:1000/);
  assert.match(source,/if\(toolReadyBeforeSave === null\) return/);
});

test('訂單開頁不再完整讀取全部訂單工序',()=>{
  const source=read('js/orders.js');
  const loadBody=source.match(/async function loadOrderData\(\)\{([\s\S]*?)\n\}/)?.[1]||'';
  assert.match(loadBody,/reloadOrders\(\)/);
  assert.doesNotMatch(loadBody,/reloadProcesses\(/);
  assert.doesNotMatch(source,/_getDocs\(window\._collection\(COL\.processes\)\)/);
  assert.match(source,/where\('orderId','==',target\)/);
});

test('款號寫入使用交易並建立增量變更',()=>{
  const source=read('js/firebase.js');
  assert.match(source,/runTransaction\(db,async transaction=>/);
  assert.match(source,/PRODUCT_CHANGES_COL/);
  assert.match(source,/changedCodes/);
  assert.match(source,/deletedCodes/);
});
