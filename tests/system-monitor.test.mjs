import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

test('系統監控位於管理分類且只有管理員可開啟',()=>{
  const html=read('index.html');
  const context={window:{},CONFIGURABLE_ROLES:['manager','clerk','productionDevelopment','productionControl','sales']};
  vm.createContext(context);
  vm.runInContext(read('js/features.js'),context);
  const module=context.window.PCMSFeatures.getModule('system-monitor');
  const page=context.window.PCMSFeatures.getPage('system-monitor');
  assert.equal(module.navGroup,'management');
  assert.equal(module.adminOnly,true);
  assert.equal(module.usesInternalTabs,true);
  assert.equal(page.adminOnly,true);
  assert.equal(page.dataLoaders.length,0);
  assert.match(html,/id="nv-accounts"[\s\S]*?id="nv-system-monitor"/);
  assert.doesNotMatch(html,/id="nv-sync"/);
  assert.match(html,/id="pg-system-monitor"[\s\S]*?id="system-monitor-root"/);
});

test('系統監控將全站日誌、呼叫監控與快取狀況分成三個內部分頁',()=>{
  const source=read('js/system-monitor/system-monitor.js');
  const style=read('styles/features/system-monitor.css');
  assert.match(source,/Nhật ký toàn hệ thống','全站日誌/);
  assert.match(source,/Giám sát lượt gọi','呼叫監控/);
  assert.match(source,/Tình trạng bộ nhớ đệm','快取狀況/);
  assert.match(source,/data-sm-tab="logs"[\s\S]*data-sm-tab="calls"[\s\S]*data-sm-tab="cache"/);
  assert.match(source,/Firebase為準/);
  assert.match(source,/目前帳號、電腦與瀏覽器的快取，不是全站總量/);
  assert.match(source,/system-monitor-page ui-work-panel/);
  assert.match(source,/system-monitor-tabs ui-tabs ui-page-tabs/);
  assert.match(source,/class="ui-tab/);
  assert.match(style,/\.system-monitor-tabs/);
  assert.match(style,/\.system-monitor-page\{width:100%;max-width:100%;min-width:0/);
  assert.match(style,/\.system-monitor-summary\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(style,/\.system-monitor-summary\.is-six\{[^}]*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(style,/\.system-monitor-summary-card\{[^}]*flex-direction:column;align-items:flex-start/);
  assert.match(style,/\.system-monitor-summary-card>b\{[^}]*max-width:100%[^}]*white-space:nowrap/);
});

test('呼叫統計只保存數量且有十五分鐘同步限制',()=>{
  const usage=read('js/usage-metrics.js');
  const cache=read('js/data-cache.js');
  const firebase=read('js/firebase.js');
  assert.match(usage,/const FLUSH_INTERVAL_MS=15\*60\*1000/);
  assert.match(usage,/Date\.now\(\)-session\.lastFlushedAt<FLUSH_INTERVAL_MS/);
  assert.match(usage,/queryCount:0,writeRequestCount:0,documentReads:0,documentWrites:0/);
  assert.match(usage,/schemaVersion:2/);
  assert.match(usage,/systemUsageSessions/);
  assert.doesNotMatch(usage,/queryCondition|employeeName|productionQuantity/);
  assert.match(cache,/async function inspect\(\)/);
  assert.match(cache,/只回傳目前 UID 的中繼資料，不回傳業務資料內容/);
  assert.match(firebase,/recordCloudRead/);
  assert.match(firebase,/recordCloudWrite/);
  assert.match(firebase,/writeCount>0[^\n]*recordCloudWrite[^\n]*writeRequestCount:1,documentWrites:writeCount/);
  assert.match(firebase,/committedWrites>0[^\n]*recordCloudWrite[^\n]*writeRequestCount:1,documentWrites:committedWrites/);
});

test('呼叫監控以每日使用者彙整並以舊日平均標示異常',()=>{
  const source=read('js/system-monitor/system-monitor.js');
  assert.match(source,/const key=`\$\{item\.usageDate\|\|'unknown'\}__\$\{identity\}`/);
  assert.match(source,/history\.length<3/);
  assert.match(source,/attention:current>average\*2/);
  assert.match(source,/總呼叫＝讀取呼叫＋寫入呼叫/);
  assert.match(source,/一次批次寫入只算1次呼叫/);
  assert.match(source,/舊資料沒有獨立記錄寫入呼叫，因此以≥顯示/);
  assert.match(source,/依功能明細/);
  assert.match(source,/讀取文件/);
  assert.match(source,/寫入文件/);
});

test('App Check月估算沿用登入工作階段且不新增雲端統計資料',()=>{
  const source=read('js/system-monitor/system-monitor.js');
  const usage=read('js/usage-metrics.js');
  assert.match(source,/const APP_CHECK_REFRESH_MS=30\*60\*1000/);
  assert.match(source,/const AVERAGE_MONTH_DAYS=365\.25\/12/);
  assert.match(source,/Math\.ceil\(\(endedAt-startedAt\)\/APP_CHECK_REFRESH_MS\)/);
  assert.match(source,/內部App Check月估算/);
  assert.match(source,/不包含未登入瀏覽或外部攻擊，也不是Google正式統計/);
  assert.doesNotMatch(usage,/appCheckEstimate|appCheckAssessment/);
});

test('全站日誌可依日期分頁且登入登出與帳號權限異動會記錄',()=>{
  const store=read('js/system-monitor/system-monitor-store.js');
  const auth=read('js/auth.js');
  const accounts=read('js/accounts.js');
  const permissions=read('js/permissions.js');
  assert.match(store,/const PAGE_SIZE=50/);
  assert.match(store,/window\._where\('createdAt','>='/);
  assert.match(store,/window\._startAfter\(state.cursor\)/);
  assert.match(auth,/PCMSUsageMetrics\?\.startSession/);
  assert.match(auth,/PCMSUsageMetrics\?\.endSession/);
  assert.match(accounts,/accountCreate/);
  assert.match(accounts,/accountUpdate/);
  assert.match(accounts,/accountDelete/);
  assert.match(permissions,/rolePermissionsUpdate/);
});
