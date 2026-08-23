import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

test('中央功能清單只把新固定身分架構接入正式頁面',()=>{
  const source=read('js/features.js');
  assert.match(source,/productionSummaryStore:'js\/production\/linked-summary-store\.js/);
  assert.match(source,/productionEntryStore:'js\/production\/linked-entry-store\.js/);
  assert.match(source,/productionProcessSecondsQuickEdit:'js\/production\/product-seconds-adapter\.js/);
  assert.match(source,/performanceBonusLockService:'js\/performance-bonus\/bonus-lock-service\.js/);
  assert.doesNotMatch(source,/scripts:\[[^\]]*productionSummaryMigration/);
  assert.doesNotMatch(source,/page:'production-process-edit'/);
  assert.doesNotMatch(source,/scripts:\[[^\]]*productionProcessEditStore/);
});

test('月績效正式頁不再提供摘要轉換、硬編碼月份清除或真正解除鎖定',()=>{
  const page=read('js/performance-bonus/monthly-bonus-page.js');
  const store=read('js/performance-bonus/bonus-store.js');
  assert.doesNotMatch(page,/PCMSProductionSummaryMigration|resetAugustTestData|performance-bonus-migrate|performance-bonus-reset-august/);
  assert.match(page,/功能尚未接入/);
  const unlockBody=store.match(/async function unlockMonth\(month\)\{([\s\S]*?)\n  \}\n  function canUnlock/)?.[1]||'';
  assert.doesNotMatch(unlockBody,/_runTransaction|transaction\.set/);
});

test('正式秒數快速修改轉接不含工序優化或標準錯誤訂正模式',()=>{
  const source=read('js/production/product-seconds-adapter.js');
  assert.match(source,/PCMSProductQuickEdit\.open/);
  assert.doesNotMatch(source,/standardCorrection|processOptimization|chooseEditMode|標準錯誤訂正|工序優化/);
});

test('訂單正式畫面以 orderItemId 分隔同款多行並由目前主檔產生工序',()=>{
  const service=read('js/order-service.js');
  const page=read('js/orders.js');
  assert.match(service,/loadProcessViews/);
  assert.match(service,/productId:item\.productId,processId/);
  assert.match(page,/const key=p\.orderItemId\|\|p\.code/);
  assert.match(page,/PCMSOrderService\.updateItemQuantity/);
  assert.doesNotMatch(service,/quoteSnapshotSec|workStdSec:item|processNameSnapshot/);
});

test('群組正式執行來源使用固定 productId 並以停用取代永久刪除',()=>{
  const runtime=read('js/product-group-runtime.js');
  const page=read('js/production/product-groups.js');
  assert.match(runtime,/memberProductIds/);
  assert.match(runtime,/setActive\(current,false/);
  assert.match(page,/PCMSProductGroupRuntime/);
  assert.match(page,/群組已停用/);
  assert.doesNotMatch(page,/確認永久刪除群組/);
});

test('舊資料來源與舊程式在正式 Runtime 為零存取',()=>{
  const retiredFiles=[
    'js/order-process-cache.js','js/product-version-store.js','js/production/change-store.js',
    'js/production/entry-store.js','js/production/summary-store.js','js/production/summary-migration.js',
    'js/production/process-edit-store.js','js/production/process-edit.js',
    'js/production/process-seconds-quick-edit.js','js/production-analysis/process-stats-store.js'
  ];
  retiredFiles.forEach(path=>assert.equal(fs.existsSync(new URL(path,root)),false,`${path} 不得留在正式程式`));
  const runtimeSource=fs.readdirSync(new URL('js/',root),{recursive:true})
    .filter(path=>String(path).endsWith('.js'))
    .map(path=>read(`js/${String(path).replaceAll('\\','/')}`)).join('\n');
  for(const legacy of ['orderProcesses','productProcessStandards','processEditJobs','productionAnalysisSummaries',
    'productionDayChanges','productionProcessAnalysisQueue']){
    assert.equal(runtimeSource.includes(legacy),false,`${legacy} 不得由正式 Runtime 存取`);
  }
  assert.doesNotMatch(read('index.html'),/id="pg-production-process-edit"/);
});
