import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('js/orders.js',root),'utf8');
const html=fs.readFileSync(new URL('index.html',root),'utf8');
const features=fs.readFileSync(new URL('js/features.js',root),'utf8');

function runtime(){
  const nodes=new Map();
  const g=id=>{
    if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:''});
    return nodes.get(id);
  };
  const escape=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const window={PCMSSafe:{text:escape,attribute:escape,inlineArgument:JSON.stringify}};
  const context={window,g,document:{getElementById:g},console,Map,Set,Date,
    isOrderUsable:order=>(!order.importStatus||order.importStatus==='ready')
      &&(!order.lifecycleStatus||order.lifecycleStatus==='active'),
    fmtVN:value=>String(value||''),formatLocalDate:value=>String(value||'')};
  vm.createContext(context);
  vm.runInContext(source,context);
  context.ensureOrderProcessesLoaded=async()=>{};
  return {window,context,g};
}

test('下方重複訂單管理表已移除，封存分頁仍保留',()=>{
  assert.doesNotMatch(html,/id="order-manager-panel"|id="orders-manager-table"/);
  assert.match(html,/id="pg-order-archive"/);
  assert.doesNotMatch(source,/function renderOrders\(|function restoreArchivedOrder\(/);
  assert.match(features,/page:'progress'[\s\S]*?onOpen:\['renderProgress'\]/);
});

test('主表顯示所有尚未出貨訂單，舊訂單不再被六十天篩選擋住',async()=>{
  const {window,context,g}=runtime();
  const oldDate=Date.now()-90*24*60*60*1000;
  window.allOrders=[{id:'old',orderId:'OLD-PO',client:'HUNTER',importStatus:'ready',
    lifecycleStatus:'active',dueDate:oldDate,totalQty:12,processCount:1}];
  await context.renderProgress();
  assert.match(g('prog-content').innerHTML,/OLD-PO/);
  assert.match(g('prog-content').innerHTML,/12/);
});

test('主表排除已出貨訂單，舊資料缺少狀態時仍視為尚未出貨',async()=>{
  const {window,context,g}=runtime();
  window.allOrders=[
    {id:'legacy',orderId:'LEGACY-PO',client:'A',importStatus:'ready',lifecycleStatus:'active',dueDate:2,totalQty:1,processCount:0},
    {id:'shipped',orderId:'SHIPPED-PO',client:'B',importStatus:'ready',lifecycleStatus:'active',shipmentStatus:'shipped',actualShipDate:3,dueDate:1,totalQty:1,processCount:0}
  ];
  await context.renderProgress();
  assert.match(g('prog-content').innerHTML,/LEGACY-PO/);
  assert.doesNotMatch(g('prog-content').innerHTML,/SHIPPED-PO/);
});

test('主表不展開款號工序，未選實際出貨日置頂且已選日期由近到遠排序',async()=>{
  const {window,context,g}=runtime();
  window.allOrders=[
    {id:'later',orderId:'LATER',client:'A',importStatus:'ready',lifecycleStatus:'active',dueDate:10,actualShipDate:30,totalQty:1},
    {id:'fallback',orderId:'FALLBACK',client:'A',importStatus:'ready',lifecycleStatus:'active',dueDate:20,actualShipDate:null,totalQty:1},
    {id:'earlier',orderId:'EARLIER',client:'A',importStatus:'ready',lifecycleStatus:'active',dueDate:40,actualShipDate:15,totalQty:1}
  ];
  await context.renderProgress();
  const output=g('prog-content').innerHTML;
  assert.doesNotMatch(output,/processCount|completeDate|actualCompleteDate/);
  assert.match(output,/data-ui-table-column="shipDate"/);
  assert.doesNotMatch(output,/data-orders-column=/);
  assert.ok(output.indexOf('FALLBACK')<output.indexOf('EARLIER'));
  assert.ok(output.indexOf('EARLIER')<output.indexOf('LATER'));
  assert.match(output,/data-ui-table-column="productionProgress"/);
  assert.match(output,/orders-production-progress-loading/);
  assert.doesNotMatch(output,/orders-production-progress is-loading[^>]*>[\s\S]{0,120}ti-loader-2/);
  assert.match(output,/Tiến độ/);
  assert.match(output,/生產進度/);
  assert.doesNotMatch(output,/toggleProgDetail|prog-detail-|orders-expanded-cell/);
});

test('訂單頁移除款號搜尋且選擇訂單不讀取工序明細',async()=>{
  const {window,context,g}=runtime();
  let processReads=0;
  context.ensureOrderProcessesLoaded=async()=>{processReads+=1;return [];};
  window.allOrders=[{id:'pending-a',orderId:'PENDING-A',client:'A',importStatus:'ready',lifecycleStatus:'active',totalQty:1,dueDate:1}];
  g('prog-sel').value='pending-a';
  await context.renderProgress();
  assert.equal(processReads,0);
  assert.doesNotMatch(html,/id="prog-code-q"/);
  assert.doesNotMatch(source,/loadProcessesForOrderSearch|scheduleProgressRender/);
});

test('使用說明位於匯入訂單左側並以共用雙語視窗顯示',()=>{
  const guideButton=html.indexOf('onclick="openOrderGuide()"');
  const importButton=html.indexOf('onclick="openImportOrder()"');
  assert.ok(guideButton>=0&&guideButton<importButton);
  assert.doesNotMatch(html,/class="orders-user-guide"/);
  assert.match(source,/function openOrderGuide\(\)/);
  assert.match(source,/orders-user-guide-dialog ui-language-sections/);
  assert.match(source,/Lưu trữ:[\s\S]*?Đã xuất hàng:[\s\S]*?Xuất báo cáo:[\s\S]*?Màu ngày xuất thực tế:[\s\S]*?Tiến độ sản xuất:[\s\S]*?Hoàn thành đơn hàng:/);
  assert.match(source,/封存：[\s\S]*?已出貨：[\s\S]*?報表匯出：[\s\S]*?實際出貨日顏色：[\s\S]*?生產進度：[\s\S]*?訂單完成：/);
  assert.match(source,/06:00[\s\S]*?05:59/);
  assert.match(source,/79,4% \/ 100%[\s\S]*?79\.4%／100%/);
  assert.match(source,/PCMSUIComponents\.alertDialog\(\{[\s\S]*?title:\{vi:'Hướng dẫn',zh:'使用說明'\}[\s\S]*?size:'large'/);
});

test('訂單主表沿用共用欄位勾選，列印按鈕位於匯入右側且只列印表格',()=>{
  const importButton=html.indexOf('onclick="openImportOrder()"');
  const printButton=html.indexOf('onclick="printOrdersTable()"');
  assert.ok(importButton>=0&&importButton<printButton);
  assert.doesNotMatch(html,/onclick="openOrderAdjustmentHistory\(\)"|id="m-order-adjust-history"/);
  assert.doesNotMatch(source,/openOrderAdjustmentHistory|loadMoreOrderAdjustmentHistory|renderOrderAdjustmentHistory/);
  assert.match(html,/id="pg-order-history"/);
  assert.match(features,/page:'order-history'[\s\S]*?scripts:\['history','orderHistory'\][\s\S]*?onOpen:\['orderHistoryInit'\]/);
  assert.match(source,/id="orders-progress-table" data-ui-table-controls="auto" data-ui-table-sort="none" data-ui-table-resizable="true"/);
  assert.doesNotMatch(source,/orders-progress-table[^\n]*data-ui-table-layout="special"/);
  ['index','client','orderId','quantity','productionProgress','dueDate','shipDate','remark','completionStatus','action']
    .forEach(key=>assert.match(source,new RegExp(`data-ui-table-column="${key}"`)));
  assert.match(source,/function prepareOrdersPrintTable\(sourceTable\)/);
  assert.match(source,/querySelectorAll\('\.is-column-hidden'\)\.forEach\(cell=>cell\.remove\(\)\)/);
  assert.match(source,/querySelector\('thead \[data-ui-table-column="action"\]'\)[\s\S]*?row\.cells\?\.\[actionIndex\]\?\.remove\(\)/);
  assert.match(source,/orders-remark-cell:not\(\.has-value\)[\s\S]*?cell\.textContent='—'/);
  assert.match(source,/printDocument\.documentElement\.dataset\.uiLanguageMode=languageMode/);
  assert.match(source,/table\{width:100%;border-collapse:collapse;table-layout:fixed\}/);
  assert.match(source,/\[data-ui-table-column="productionProgress"\]\{width:15%\}/);
  assert.match(source,/printDocument\.body\.appendChild\(prepareOrdersPrintTable\(sourceTable\)\)/);
  assert.doesNotMatch(source,/printOrdersTable[\s\S]{0,2500}orders-pending-quantity/);
  assert.doesNotMatch(source,/printOrdersTable[\s\S]{0,2500}saveOperationLog/);
});

test('訂單完成狀態位於操作欄左側，保留實際百分比並在列印時轉為文字',()=>{
  const completionColumn=source.indexOf('data-ui-table-column="completionStatus"');
  const actionColumn=source.indexOf('data-ui-table-column="action"',completionColumn);
  assert.ok(completionColumn>=0&&actionColumn>completionColumn);
  assert.match(source,/orders-completion-control is-pending/);
  assert.match(source,/orders-completion-control is-complete/);
  assert.match(source,/\$\{ordersSafeText\(shown\)\}%\$\{completed\?' \/ 100%':''\}/);
  assert.match(source,/const fillPercent=completed\?100:percent/);
  assert.match(source,/aria-valuenow="100"><div class="orders-production-progress-fill" style="width:100%"/);
  assert.match(source,/setProductionProgressCompleted\(target,completed/);
  assert.match(source,/currentProgressOrders=progressOrders\.filter\(order=>order\.productionProgressCompleted!==true\)/);
  assert.match(source,/orders-completion-cell'[\s\S]*?Đơn đã hoàn thành \/ 訂單完成'[\s\S]*?'—'/);
});

test('訂單完成狀態使用系統成功色與清楚的鍵盤焦點',()=>{
  const css=fs.readFileSync(new URL('styles/features/orders.css',root),'utf8');
  assert.match(css,/\.orders-completion-control\.is-complete\s*\{[\s\S]*?var\(--ui-color-success-background\)[\s\S]*?var\(--ui-color-success-text\)/);
  assert.match(css,/\.orders-completion-control:focus-visible/);
});

test('標題加總全部未出貨訂單數量且不受目前訂單篩選影響',async()=>{
  const {window,context,g}=runtime();
  window.allOrders=[
    {id:'pending-a',orderId:'PENDING-A',client:'A',importStatus:'ready',lifecycleStatus:'active',totalQty:1200,dueDate:1},
    {id:'pending-b',orderId:'PENDING-B',client:'A',importStatus:'ready',lifecycleStatus:'active',totalQty:2300,dueDate:2},
    {id:'shipped',orderId:'SHIPPED',client:'A',importStatus:'ready',lifecycleStatus:'active',shipmentStatus:'shipped',totalQty:9000,dueDate:3}
  ];
  g('prog-sel').value='pending-a';
  await context.renderProgress();
  assert.equal(g('orders-pending-quantity-vi').textContent,'3,500');
  assert.equal(g('orders-pending-quantity-zh').textContent,'3,500');
  assert.match(html,/Tổng số lượng chưa xuất/);
  assert.match(html,/未出貨總數量/);
});

test('每日進度更新涵蓋全部未出貨訂單且不受畫面篩選影響',async()=>{
  const {window,context,g}=runtime();
  let requested=[];
  window.PCMSOrderProductionProgress={
    load:orders=>{requested=orders.map(order=>order.id);return new Promise(()=>{});}
  };
  window.allOrders=[
    {id:'pending-a',orderId:'PENDING-A',client:'A',importStatus:'ready',lifecycleStatus:'active',totalQty:1,dueDate:1},
    {id:'pending-b',orderId:'PENDING-B',client:'A',importStatus:'ready',lifecycleStatus:'active',totalQty:1,dueDate:2},
    {id:'shipped',orderId:'SHIPPED',client:'A',importStatus:'ready',lifecycleStatus:'active',shipmentStatus:'shipped',totalQty:1,dueDate:3}
  ];
  g('prog-sel').value='pending-a';
  await context.renderProgress();
  assert.deepEqual(requested,['pending-a','pending-b']);
});

test('未出貨總數量使用系統資訊色底框',()=>{
  const css=fs.readFileSync(new URL('styles/features/orders.css',root),'utf8');
  assert.match(css,/#pg-progress \.orders-pending-quantity\s*\{[^}]*background:\s*var\(--ui-color-info-background\)/s);
  assert.match(css,/#pg-progress \.orders-pending-quantity\s*\{[^}]*border:\s*1px solid var\(--ui-color-info-border\)/s);
});

test('PO交期維持統一字色，實際出貨日依七天與十四天規則提示且空白使用淡綠底框',()=>{
  const css=fs.readFileSync(new URL('styles/features/orders.css',root),'utf8');
  assert.doesNotMatch(css,/\.orders-po-date\.is-(?:due-soon|overdue)/);
  assert.match(css,/\.orders-date-input\.is-empty\s*\{[\s\S]*?var\(--ui-color-success-border\)[\s\S]*?var\(--ui-color-success-background\)/);
  assert.match(css,/\.orders-date-input\.is-due-soon\s*\{[\s\S]*?var\(--ui-color-info-text\)/);
  assert.match(css,/\.orders-date-input\.is-urgent\s*\{[\s\S]*?var\(--ui-color-danger-text\)/);
  assert.doesNotMatch(css,/\.orders-date-input\.is-overdue/);
});

test('實際出貨日固定保存，逾期至七天內紅色、八至十四天藍色、十五天以上黑色',async()=>{
  const {window,context,g}=runtime();
  const selectedDate=new Date(2026,8,22).getTime();
  window.allOrders=[{id:'fixed',orderId:'FIXED',client:'A',importStatus:'ready',lifecycleStatus:'active',
    dueDate:new Date(2026,8,30).getTime(),actualShipDate:selectedDate,totalQty:1}];
  const now=new Date(2026,8,23).getTime();
  assert.equal(context.orderActualShipDateClass(selectedDate,now),' is-urgent');
  assert.equal(context.orderActualShipDateClass(new Date(2026,8,23).getTime(),now),' is-urgent');
  assert.equal(context.orderActualShipDateClass(new Date(2026,8,30).getTime(),now),' is-urgent');
  assert.equal(context.orderActualShipDateClass(new Date(2026,9,1).getTime(),now),' is-due-soon');
  assert.equal(context.orderActualShipDateClass(new Date(2026,9,7).getTime(),now),' is-due-soon');
  assert.equal(context.orderActualShipDateClass(new Date(2026,9,8).getTime(),now),'');
  assert.equal(context.orderActualShipDateClass(null,now),' is-empty');
  await context.renderProgress();
  assert.match(g('prog-content').innerHTML,new RegExp(`value="${selectedDate}"`));
  assert.equal(window.allOrders[0].actualShipDate,selectedDate);
});

test('訂單主表顯示進度最後更新狀態',()=>{
  assert.match(html,/id="orders-progress-refresh-status"/);
  assert.match(html,/id="orders-progress-manual-refresh"/);
  assert.match(html,/Cập nhật tiến độ[\s\S]*?更新生產進度/);
  assert.match(source,/Cập nhật gần nhất:[\s\S]*?最後更新：/);
  assert.match(source,/Cập nhật hôm nay thất bại[\s\S]*?今日更新失敗/);
  assert.match(source,/manualRefresh\(currentProgressOrders,\{onProgress:renderOrderProgressWorkStatus\}\)/);
  assert.match(source,/function settleOrderProgressRefreshStatus\(status\)[\s\S]*?renderOrderProgressWorkStatus\([\s\S]*?renderOrderProgressRefreshStatus\(status\)/);
  assert.match(source,/clearSession/);
  assert.match(source,/手動更新一次[\s\S]*?更新失敗[\s\S]*?今日次數仍視為已使用/);
});

test('匯入失敗與匯入中顯示於上方提醒，不增加雲端查詢或暴露原文字串',async()=>{
  const {window,context,g}=runtime();
  window.allOrders=[
    {id:'failed',orderId:'BAD<script>',importStatus:'failed',lifecycleStatus:'active'},
    {id:'importing',orderId:'WAIT-PO',importStatus:'importing',lifecycleStatus:'active'},
    {id:'archived',orderId:'ARCHIVED-PO',importStatus:'ready',lifecycleStatus:'archived'}
  ];
  window._getDoc=()=>{throw new Error('不應讀取雲端');};
  window._getDocs=()=>{throw new Error('不應讀取雲端');};
  await context.renderProgress();
  const output=g('prog-content').innerHTML;
  assert.match(output,/orders-import-issues ui-notice is-warning/);
  assert.match(output,/BAD&lt;script&gt;/);
  assert.match(output,/WAIT-PO/);
  assert.match(output,/匯入失敗/);
  assert.match(output,/匯入中/);
  assert.doesNotMatch(output,/<script>|ARCHIVED-PO/);
});
