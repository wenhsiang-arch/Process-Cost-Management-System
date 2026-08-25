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
    'js/safe-dom.js','js/ui-text.js','js/ui-runtime.js','js/ui-components.js','js/ui-file-drop.js','js/ui-table.js',
    'js/utils.js','js/data-cache.js','js/usage-metrics.js','js/features.js','js/auth.js','js/firebase.js'
  ]);
  assert.match(html,/id="pg-home"/);
  assert.doesNotMatch(html,/JSZip|jszip|xlsx\.bundle\.js/);
});

test('共用表格控制跟隨功能生命週期啟用及清理',()=>{
  const source=read('js/features.js');
  assert.match(source,/runPageHooks\(pageName,'onOpen'\)[\s\S]*?PCMSUITable\?\.activatePage\?\.\(pageName\)/);
  assert.match(source,/PCMSUITable\?\.deactivatePage\?\.\(leavingPageName\)[\s\S]*?runPageHooks\(leavingPageName,'onLeave'\)/);
  assert.match(source,/function resetActivePage\(\)[\s\S]*?PCMSUITable\?\.deactivatePage\?\.\(previousPageName\)/);
});

test('共用表格操作只在使用功能開啟後按需載入',()=>{
  const html=read('index.html');
  const source=read('js/features.js');
  const productsStart=source.indexOf("id:'products'");
  const productsEnd=source.indexOf("id:'preparation'",productsStart);
  const products=source.slice(productsStart,productsEnd);
  assert.doesNotMatch(html,/js\/ui-table-controls\.js/);
  assert.match(source,/uiTableControls:'js\/ui-table-controls\.js\?v=20260821-1'/);
  assert.match(products,/scripts:\['history','fileIo','productCache','productModel','productionEfficiencyCore','productMasterStore','productResolver','productGroupStore','productMasterService','productImportImpact','productGroupRuntime','productionProcessGroupUi','productMasterEditor','productQuickEdit','uiTableControls','summary','data'\]/);
  assert.doesNotMatch(products,/productVersionStore/);
  assert.match(products,/onOpen:\['rSum'\],onLeave:\['summaryLeave'\]/);
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
    'accounts','costlog','cutting','export','performance-bonus-settings','permissions','product-groups',
    'production-analysis','production-attendance','production-bonus','production-employees','production-entry','production-records','progress','settings','summary','system-monitor'
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
  assert.deepEqual(Array.from(products.pages[1].restrictions||[]).map(item=>item.key),[]);
  assert.equal(settings.feature,'settings');
  assert.equal(settings.adminOnly===true,false);
  assert.deepEqual(Array.from(settings.scripts),['history','uiTableControls','summary','data','settings']);
  const normalized=context.window.normalizeFeaturePermissions({progress:true});
  assert.equal(normalized.progress,true);
  assert.equal(normalized.orderImport,true);
  const production=context.window.PCMSFeatures.getModule('production');
  assert.deepEqual(Array.from(production.pages).map(page=>page.page),[
    'production-entry','production-records','production-bonus','production-attendance','production-employees'
  ]);
  const productionEntry=production.pages.find(page=>page.page==='production-entry');
  assert.equal(productionEntry.scripts.includes('history'),true);
  assert.equal(productionEntry.scripts.indexOf('history')<productionEntry.scripts.indexOf('productMasterStore'),true);
  assert.equal(production.pages.every(page=>page.scripts.some(name=>name.startsWith('production'))),true);
  assert.equal(context.window.normalizeFeaturePermissions({productionEntry:true}).productionMain,true);
  const productionAnalysis=context.window.PCMSFeatures.getModule('production-analysis');
  assert.equal(productionAnalysis.mainKey,'productionAnalysis');
  assert.equal(productionAnalysis.usesInternalTabs,true);
  assert.deepEqual(Array.from(productionAnalysis.pages).map(page=>page.page),['production-analysis']);
  assert.deepEqual(Array.from(productionAnalysis.pages[0].dataScopes),[
    'products','productsMeta','productGroups','productionEmployeeMonths','productionMonths','operationLogs:productionAnalysis'
  ]);
  assert.equal(Array.from(productionAnalysis.pages[0].scripts).includes('productionProcessStatsStore'),false);
  assert.equal(context.window.PCMSFeatures.defaultPermissions.manager.productionAnalysis,false);
  const preparation=context.window.PCMSFeatures.getModule('preparation');
  assert.equal(preparation.mainKey,'preparationMain');
  assert.deepEqual(Array.from(preparation.pages).map(page=>page.page),['cutting']);
  assert.equal(context.window.PCMSFeatures.defaultPermissions.manager.preparationMain,false);
  assert.equal(context.window.normalizeFeaturePermissions({cutting:true}).preparationMain,false);
  const navigationHtml=read('index.html');
  assert.match(navigationHtml,/id="pg-production-analysis"[\s\S]*?id="production-analysis-root"/);
  assert.match(navigationHtml,/id="nv-production"[\s\S]*?onclick="openModule\('production-analysis'\)" id="nv-production-analysis"[\s\S]*?id="management-toggle"/);
  assert.match(navigationHtml,/js\/features\.js\?v=20260825-5/);
});

test('操作歷史依使用者動作載入且不阻止主功能開啟',()=>{
  const source=read('js/features.js');
  const context={
    window:{},
    CONFIGURABLE_ROLES:['manager','clerk','productionDevelopment','productionControl','sales']
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  const feature=context.window.PCMSFeatures;
  const summaryLoaders=feature.getPage('summary').dataLoaders;
  const costLogLoaders=feature.getPage('costlog').dataLoaders;
  assert.equal(summaryLoaders.some(item=>(typeof item==='string'?item:item?.name)==='ensureImportHistoryLoaded'),false);
  assert.equal(feature.getPage('summary').scripts.includes('history'),true);
  assert.equal(costLogLoaders.includes('ensureCostLogLoaded'),true);
  assert.match(read('index.html'),/onclick="openImportHistory\(\)"/);
  assert.match(read('js/data.js'),/async function openImportHistory\(force=false\)/);
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
    history:'js/history.js',fileIo:'js/file-io.js',costLog:'js/cost-log.js',
    settings:'js/settings.js',uiTableControls:'js/ui-table-controls.js',uiSearchDropdown:'js/ui-search-dropdown.js',
    productCache:'js/product-cache.js',
    summary:'js/summary.js',data:'js/data.js',cuttingStore:'js/cutting-store.js',cutting:'js/cutting.js',
    accounts:'js/accounts.js',orders:'js/orders.js',permissions:'js/permissions.js',
    productModel:'js/product-model.js',productMasterStore:'js/product-master-store.js',productResolver:'js/product-resolver.js',
    productGroupStore:'js/product-group-store.js',productMasterService:'js/product-master-service.js',
    productImportImpact:'js/product-import-impact.js',
    productMasterEditor:'js/product-master-editor.js',productQuickEdit:'js/product-quick-edit.js',
    productGroupRuntime:'js/product-group-runtime.js',
    orderItemStore:'js/order-item-store.js',orderService:'js/order-service.js',
    productionEmployeeStore:'js/production/employee-store.js',
    productionEfficiencyCore:'js/production/efficiency-core.js',
    productionSummaryStore:'js/production/linked-summary-store.js',
    productionGuardStore:'js/production/production-guard-store.js',
    productionEntryStore:'js/production/linked-entry-store.js',
    productionReportStore:'js/production/report-store.js',
    productionAttendanceStore:'js/production/attendance-store.js',
    productionEntry:'js/production/production-entry.js',
    productionRecords:'js/production/production-records.js',
    performanceBonusCalculations:'js/performance-bonus/bonus-calculations.js',
    performanceBonusLockService:'js/performance-bonus/bonus-lock-service.js',
    performanceBonusStore:'js/performance-bonus/bonus-store.js',
    performanceBonusSettingsPage:'js/performance-bonus/bonus-settings-page.js',
    performanceBonusMonthlyPage:'js/performance-bonus/monthly-bonus-page.js',
    productionAnomalyFilter:'js/production/production-anomaly-filter.js',
    productionAttendance:'js/production/production-attendance.js',
    productionEmployees:'js/production/production-employees.js',
    productionProcessGroupUi:'js/production/process-group-ui.js',
    productionProcessSecondsQuickEdit:'js/production/product-seconds-adapter.js',
    productionProductGroups:'js/production/product-groups.js',
    productionAnalysisCalculations:'js/production-analysis/analysis-calculations.js',
    productionAnalysisStore:'js/production-analysis/analysis-store.js',
    productionAnalysisExport:'js/production-analysis/analysis-export.js',
    productionEmployeeAnalysis:'js/production-analysis/employee-analysis.js',
    productionIeAnalysis:'js/production-analysis/ie-analysis.js',
    productionDepartmentAnalysis:'js/production-analysis/department-analysis.js',
    productionAnalysis:'js/production-analysis/production-analysis.js',
    systemMonitorStore:'js/system-monitor/system-monitor-store.js',
    systemMonitor:'js/system-monitor/system-monitor.js'
  }; // scriptFiles（中央清單程式來源）
  const coreFiles=['js/utils.js','js/data-cache.js','js/usage-metrics.js','js/features.js','js/auth.js','js/firebase.js','js/safe-dom.js'];
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
  const activeScripts=context.window.PCMSFeatures.modules.flatMap(module=>module.pages)
    .flatMap(page=>Array.from(page.scripts||[]));
  assert.equal(activeScripts.includes('productionChangeStore'),false);
  assert.equal(activeScripts.includes('productVersionStore'),false);
  assert.equal(activeScripts.includes('productionProcessEditStore'),false);
  assert.equal(activeScripts.includes('productionProcessStatsStore'),false);
});

test('操作歷史查詢所需複合索引已登記',()=>{
  const indexes=JSON.parse(read('firestore.indexes.json')); // indexes（資料庫索引設定）
  const operationLogIndex=indexes.indexes.find(item=>item.collectionGroup==='operationLogs'&&item.fields.length===2);
  assert.deepEqual(operationLogIndex?.fields,[
    {fieldPath:'permissionKey',order:'ASCENDING'},
    {fieldPath:'createdAt',order:'DESCENDING'}
  ]);
  const actionIndex=indexes.indexes.find(item=>item.collectionGroup==='operationLogs'&&item.fields.length===3);
  assert.deepEqual(actionIndex?.fields,[
    {fieldPath:'permissionKey',order:'ASCENDING'},
    {fieldPath:'action',order:'ASCENDING'},
    {fieldPath:'createdAt',order:'DESCENDING'}
  ]);
  const productionEntryIndex=indexes.indexes.find(item=>item.collectionGroup==='productionEntries');
  assert.deepEqual(productionEntryIndex?.fields,[
    {fieldPath:'employeeId',order:'ASCENDING'},
    {fieldPath:'productionDate',order:'DESCENDING'}
  ]);
  const correctionIndex=indexes.indexes.find(item=>item.collectionGroup==='productionEntries'
    && item.fields.some(field=>field.fieldPath==='productCode'));
  assert.deepEqual(correctionIndex?.fields,[
    {fieldPath:'productCode',order:'ASCENDING'},
    {fieldPath:'processNo',order:'ASCENDING'},
    {fieldPath:'createdAt',order:'ASCENDING'}
  ]);
  const pendingJobIndex=indexes.indexes.find(item=>item.collectionGroup==='processEditJobs');
  assert.deepEqual(pendingJobIndex?.fields,[
    {fieldPath:'createdByUid',order:'ASCENDING'},
    {fieldPath:'jobType',order:'ASCENDING'},
    {fieldPath:'status',order:'ASCENDING'},
    {fieldPath:'createdAt',order:'DESCENDING'}
  ]);
});

test('裁帶模板識別碼安全且歷史只在點開分頁後讀取',()=>{
  const source=read('js/cutting.js');
  const historySource=read('js/history.js');
  const htmlSource=read('index.html');
  assert.match(source,/cuttingDownloadTemplate\(\$\{inlineArg\(t\.id\)\}, this\)/);
  assert.match(source,/cuttingDeleteTemplate\(\$\{inlineArg\(t\.id\)\}\)/);
  assert.doesNotMatch(source,/cuttingDownloadTemplate\('\$\{esc\(t\.id\)\}'/);
  const deleteStart=source.indexOf('async function cuttingDeleteTemplate(id)'); // deleteStart（裁帶模板刪除函式起點）
  const deleteEnd=source.indexOf('function cuttingPickOrder()',deleteStart); // deleteEnd（下一個裁帶函式起點）
  const deleteBody=source.slice(deleteStart,deleteEnd); // deleteBody（裁帶模板刪除函式內容）
  assert.match(deleteBody,/action:'cuttingTemplateDelete'/);
  assert.match(deleteBody,/rememberCuttingHistoryLog\(savedLog\)/);
  assert.match(htmlSource,/id="cut-tab-history" onclick="cuttingSwitchTab\('history'\)"/);
  assert.match(htmlSource,/id="cut-history-tb"/);
  assert.match(source,/if\(selectedTab === 'history'\) void cuttingLoadHistory\(\)/);
  assert.match(historySource,/ensureCuttingHistoryLoaded[\s\S]*permissionKey:'cutting'/);
  assert.match(historySource,/cuttingTemplateImport[\s\S]*cuttingTemplateDelete[\s\S]*cuttingPdfExport/);
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
  assert.match(html,/class="to cutting-page-table ui-table-frame">\s*<div class="ui-table-scroll"[^>]*>\s*<table class="ui-table"[^>]*>[\s\S]*?id="cut-template-tb"/);
  assert.doesNotMatch(html,/class="ts" style="max-height:260px">\s*<table>[\s\S]*?id="cut-template-tb"/);
  assert.match(style,/\.cutting-guide-disclosure \{\s*position: static;/);
  assert.match(style,/\.cutting-guide-panel \{[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\)/);
  assert.match(style,/\.cutting-command-row \{[\s\S]*?height: var\(--ui-action-tile-height\)/);
  assert.match(style,/\.cutting-command-action\.is-primary:disabled \{/);
});

test('側邊導覽只保留畫面按鈕，不再使用反引號快捷鍵',()=>{
  const html=read('index.html');
  assert.match(html,/id="primary-sidebar-toggle"[\s\S]*?onclick="togglePrimarySidebar\(\)"/);
  assert.doesNotMatch(html,/function handlePrimarySidebarShortcut/);
  assert.doesNotMatch(html,/addEventListener\('keydown',handlePrimarySidebarShortcut\)/);
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

test('訂單開頁只讀訂單項目並由目前款號主檔解析工序',()=>{
  const source=read('js/orders.js');
  const service=read('js/order-service.js');
  const loadBody=source.match(/async function loadOrderData\(\)\{([\s\S]*?)\n\}/)?.[1]||'';
  assert.match(loadBody,/reloadOrders\(\)/);
  assert.doesNotMatch(loadBody,/reloadProcesses\(/);
  assert.doesNotMatch(source,/_getDocs\(window\._collection\(COL\.processes\)\)/);
  assert.match(source,/PCMSOrderService\.loadProcessViews\(target,\{order\}\)/);
  assert.match(service,/_where\('orderId','==',target\)/);
  assert.match(service,/PCMSProductResolver\.create\(/);
  assert.match(service,/resolver\.resolve\(items\)/);
  assert.doesNotMatch(source,/orderProcesses|orderProcessCache/);
});

test('款號版本不同時重讀目前主檔且不依賴永久增量變更集合',()=>{
  const source=read('js/firebase.js');
  const store=read('js/product-master-store.js');
  const service=read('js/product-master-service.js');
  assert.match(source,/loadProductsMeta\(metrics,force\)/);
  assert.match(source,/let saved=await loadProductsData\(metrics\)/);
  assert.doesNotMatch(source,/PRODUCT_CHANGES_COL|loadProductChangesAfter|applyProductChanges/);
  assert.match(service,/window\._runTransaction/);
  assert.match(store,/operationLogId/);
});

test('檔案儲存只由共用程式選擇位置與安全寫入',()=>{
  const fileIoSource=read('js/file-io.js');
  const dataSource=read('js/data.js');
  const cuttingSource=read('js/cutting.js');
  assert.match(fileIoSource,/async function chooseSaveHandle/);
  assert.match(fileIoSource,/async function writeToHandle/);
  assert.match(fileIoSource,/writable\.abort\(\)/);
  assert.doesNotMatch(dataSource,/function chooseSpreadsheetSaveHandle/);
  assert.doesNotMatch(cuttingSource,/function chooseCuttingSaveHandle/);
  assert.match(dataSource,/PCMSFileIO\.writeWorkbookToHandle/);
  assert.match(cuttingSource,/PCMSFileIO\.writeToHandle/);
});

test('功能頁重複切換使用工作階段資料並在背景檢查',()=>{
  const featureSource=read('js/features.js');
  const authSource=read('js/auth.js');
  const cuttingSource=read('js/cutting.js');
  assert.match(featureSource,/PAGE_DATA_FRESH_MS = 60000/);
  assert.match(featureSource,/async function refreshPageDataInBackground/);
  assert.match(featureSource,/function invalidateDataScopes/);
  assert.match(authSource,/const pageDataReady=/);
  assert.match(authSource,/refreshPageDataInBackground\(name\)/);
  assert.match(cuttingSource,/CUTTING_BACKGROUND_CHECK_MS = 60000/);
  assert.match(cuttingSource,/if\(!state\.initialized\)/);
});

test('一般資料版本同批完成，產能與考勤只使用唯一月份版本',()=>{
  const source=read('js/firebase.js');
  const cacheableDeclaration=source.match(/const CACHEABLE_COLLECTIONS = new Set\(\[[\s\S]*?\]\);/)?.[0]||'';
  const cacheableScopes=[...cacheableDeclaration.matchAll(/'([^']+)'/g)].map(match=>match[1]);
  assert.deepEqual(cacheableScopes,['orders','productionEmployees','productionDepartments','productGroups']);
  assert.match(source,/firebaseAuthLogout = \(\) => signOut\(auth\)/);
  assert.doesNotMatch(source,/SENSITIVE_PRODUCTION_CACHE_SCOPES/);
  const cacheSource=read('js/data-cache.js'); // cacheSource（共用資料快取程式內容）
  assert.match(cacheSource,/async function removeForUser\(userId,scope\)/);
  assert.match(source,/appendDataVersionWrite\(batch,\[scope\]\)[\s\S]*?await batch\.commit\(\)/);
  assert.match(source,/committedVersionChange=createDataVersionChange\(skipDataVersions\?\[\]:\[\.\.\.scopes\]\)/);
  assert.doesNotMatch(cacheableDeclaration,/productionEntries|productionAttendance/);
  assert.match(source,/appendDataVersionWrite\(rawTransaction,\[\.\.\.scopes\]\)/);
  assert.doesNotMatch(source,/touchDataVersions\(\['productionEntries'\]\)/);
  assert.match(source,/const versionChange=createDataVersionChange\(skipDataVersions\?\[\]:\[\.\.\.scopes\]\)[\s\S]*?await rawBatch\.commit\(\)/);
  assert.match(source,/options\?\.skipDataVersions===true/);
  assert.doesNotMatch(source,/persistDeferredDataVersionScopes/);
});

test('一般 dataVersions（資料版本）只保留四個正式範圍且沒有全域回退',()=>{
  const source=read('js/firebase.js');
  const attendanceSource=read('js/production/attendance-store.js');
  const reportSource=read('js/production/report-store.js');
  const analysisSource=read('js/production-analysis/analysis-store.js');
  const bonusSource=read('js/performance-bonus/bonus-store.js');
  assert.match(source,/const DATA_VERSION_COLLECTION = 'dataVersions'/);
  assert.match(source,/async function readScopedDataVersion/);
  assert.match(source,/getDocFromServer\(doc\(db,DATA_VERSION_COLLECTION,scope\)\)/);
  assert.match(source,/writer\.set\(doc\(db,DATA_VERSION_COLLECTION,item\.scope\),item\)/);
  assert.match(source,/readDataVersions\(\[scope\]\)/);
  assert.match(source,/readDataVersions\(\[scope\],true\)/);
  assert.doesNotMatch(source,/DATA_VERSIONS_KEY|readLegacyDataVersions|scopedDataVersionCapability/);
  assert.doesNotMatch(source,/doc\(db,'system','dataVersions'\)/);
  assert.match(source,/loadDirectSystemSetting\('operationSettings',options\)/);
  assert.match(source,/loadDirectSystemSetting\('costSettings',options\)/);
  assert.doesNotMatch(source,/pcmsDataCache\?\.write\('operationSettings'|pcmsDataCache\?\.write\('costSettings'/);
  assert.match(attendanceSource,/_docRef\('productionMonths',month\)/);
  assert.match(attendanceSource,/snapshot\.data\(\)\?\.attendanceVersion/);
  assert.doesNotMatch(attendanceSource,/firebaseReadDataVersions|system','dataVersions/);
  assert.match(reportSource,/const MONTH_COLLECTION_NAME = 'productionMonths'/);
  assert.match(reportSource,/snapshot\.data\(\)\?\.entriesVersion/);
  assert.doesNotMatch(reportSource,/firebaseReadDataVersions|CACHE_VERSION_KEY|system','dataVersions/);
  assert.doesNotMatch(analysisSource,/productionEmployeeMonths/);
  assert.match(analysisSource,/productionMonths/);
  assert.match(analysisSource,/summaryVersion/);
  assert.match(analysisSource,/PCMSProductionSummaries/);
  assert.doesNotMatch(analysisSource,/productionAnalysisSummaries|readEntry|saveCache/);
  assert.doesNotMatch(analysisSource,/productionMonthControls|productionMonthVersions/);
  assert.doesNotMatch(analysisSource,/firebaseReadDataVersions|productionEntries|productionAttendance/);
  assert.match(analysisSource,/loadCurrentStandards/);
  assert.match(analysisSource,/source:'resolved-product-master'/);
  assert.doesNotMatch(analysisSource,/productProcessStandards|getProductsMetaForFeature|ensureProductsLoaded/);
  assert.match(bonusSource,/PCMSProductionSummaries/);
  assert.doesNotMatch(bonusSource,/firebaseReadDataVersions|firebaseTouchDataVersions|pcmsDataCache/);
});

test('績效獎金未鎖定時由月份摘要即時計算，只在鎖定時保存快照',()=>{
  const browserSource=read('js/performance-bonus/bonus-store.js');
  const lockSource=read('js/performance-bonus/bonus-lock-service.js');
  const firebaseConfig=read('firebase.json');
  assert.match(browserSource,/PCMSProductionSummaries/);
  assert.match(browserSource,/const ADJUSTMENT_COLLECTION='performanceBonusAdjustments'/);
  assert.match(browserSource,/async function loadStablePerformance/);
  assert.match(browserSource,/async function loadDailyBonuses/);
  assert.match(browserSource,/PCMSPerformanceBonusLockService/);
  assert.match(browserSource,/return service\.lockMonth\(normalized,current\)/);
  assert.match(lockSource,/async function captureSnapshot/);
  assert.match(lockSource,/async function stageSnapshot/);
  assert.match(lockSource,/snapshotId:manifest\.snapshotId/);
  assert.doesNotMatch(lockSource,/frozenEmployees:current\.employees/);
  assert.match(browserSource,/SETTINGS_VERSION_COLLECTION='performanceBonusSettingVersions'/);
  assert.match(browserSource,/skipDataVersions:true/);
  assert.doesNotMatch(browserSource,/firebaseReadDataVersions|firebaseTouchDataVersions|pcmsDataCache/);
  assert.doesNotMatch(browserSource,/calculateAndPersistMonth|calculateAndPublishMonth|writeChunks/);
  assert.doesNotMatch(browserSource,/waitForSettingsApplied|performanceBonusRuns/);
  assert.doesNotMatch(firebaseConfig,/"functions"/);
});

test('訂單調整歷史改讀不可變操作紀錄並使用五十筆游標分頁',()=>{
  const historySource=read('js/history.js');
  const ordersSource=read('js/orders.js');
  assert.match(historySource,/const DEFAULT_PAGE_SIZE = 50/);
  assert.match(historySource,/window\._startAfter\(state\.cursor\)/);
  assert.match(historySource,/async function loadOperationLogs/);
  assert.doesNotMatch(ordersSource,/_getDocs\(window\._collection\(COL\.orderAdjustments\)\)/);
  assert.match(ordersSource,/loadOperationLogs\(\{permissionKey:'progress',actions:\['orderItemQuantityUpdate'\],limit:50,loadMore:true\}\)/);
});
