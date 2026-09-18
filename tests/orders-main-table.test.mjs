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

test('明確選取舊訂單後可在上方查看，不再被六十天預設篩選擋住',async()=>{
  const {window,context,g}=runtime();
  const oldDate=Date.now()-90*24*60*60*1000;
  window.allOrders=[{id:'old',orderId:'OLD-PO',client:'HUNTER',importStatus:'ready',
    lifecycleStatus:'active',dueDate:oldDate,totalQty:12,processCount:1}];
  await context.renderProgress();
  assert.doesNotMatch(g('prog-content').innerHTML,/OLD-PO/);
  g('prog-sel').value='old';
  await context.renderProgress();
  assert.match(g('prog-content').innerHTML,/OLD-PO/);
  assert.match(g('prog-content').innerHTML,/12/);
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
