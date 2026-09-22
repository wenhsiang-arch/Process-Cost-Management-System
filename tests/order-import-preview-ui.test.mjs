import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

test('訂單匯入預覽使用現行雙語視窗、水平捲動及共用欄寬拖曳',()=>{
  const html=read('index.html');
  const css=read('styles/features/orders.css');
  const orders=read('js/orders.js');
  const modal=html.slice(html.indexOf('id="m-import-order"'),html.indexOf('id="m-order-qty-adjust"'));

  assert.match(modal,/class="md orders-import-dialog"/);
  assert.match(modal,/class="ui-table-scroll orders-import-preview-scroll"/);
  assert.match(modal,/id="order-import-preview-table"[^>]*data-ui-table-resizable="true"/);
  for(const key of ['code','description','color','quantity','processCount','status']){
    assert.match(modal,new RegExp(`data-ui-table-column="${key}"`));
  }
  assert.match(modal,/Kéo mũi tên ở tiêu đề để chỉnh độ rộng/);
  assert.match(modal,/拖曳表頭箭頭調整欄寬/);
  assert.match(css,/#m-import-order \.orders-import-dialog[\s\S]*?width: min\(1180px, calc\(100vw - 64px\)\)/);
  assert.match(css,/#m-import-order \.orders-import-preview-scroll[\s\S]*?overflow: auto/);
  assert.match(orders,/function ensureOrderImportPreviewTableControl\(\)[\s\S]*?PCMSUITableControls[\s\S]*?resizable:true/);
  assert.match(orders,/preferenceKey:'progress:order-import-preview'/);
  assert.match(orders,/data-ui-table-column="description"/);
});

test('訂單匯入預覽改版不更動既有匯入入口與正式服務',()=>{
  const orders=read('js/orders.js');
  assert.match(orders,/function handleImportFile\(input\)[\s\S]*?targetId:'order-import'/);
  assert.match(orders,/PCMSOrderService\.importOrder\(\{/);
  assert.match(orders,/orderId,client:g\('imp-ord-client'\)\?\.value\|\|'',dueDate/);
});
