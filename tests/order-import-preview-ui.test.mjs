import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

function loadOrderImportValidation(){
  const context={window:{PCMSSafe:{text:String,attribute:String,inlineArgument:value=>JSON.stringify(value)}},console,Map,Set,Promise,Date,Number,String,Array,Object,Math,RegExp};
  vm.createContext(context);
  vm.runInContext(read('js/orders.js'),context);
  return context.window.PCMSOrderImportValidation;
}

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
  assert.match(css,/#m-import-order\.orders-import-modal[\s\S]*?align-items: center[\s\S]*?justify-content: center/);
  assert.match(css,/#m-import-order \.orders-import-preview-scroll[\s\S]*?overflow: auto/);
  assert.match(css,/#m-import-order \.orders-import-actions[\s\S]*?justify-content: flex-end/);
  assert.match(orders,/function ensureOrderImportPreviewTableControl\(\)[\s\S]*?PCMSUITableControls[\s\S]*?resizable:true/);
  assert.match(orders,/preferenceKey:'progress:order-import-preview'/);
  assert.match(orders,/available:\(\)=>orderImportOptionalColumns\.description/);
  assert.match(orders,/available:\(\)=>orderImportOptionalColumns\.color/);
  assert.match(orders,/if\(iDesc>=0\) cells\.push\(`<td data-ui-table-column="description"/);
  assert.match(orders,/if\(iColor>=0\) cells\.push\(`<td data-ui-table-column="color"/);
});

test('訂單號碼沿用裁帶規則，只有唯一結果才自動採用',()=>{
  const validation=loadOrderImportValidation();
  const source=read('js/orders.js');
  assert.equal(validation.findOrderNumber([
    ['ORDER NO: 2026-117767'],
    ['ITEM #','DESCRIPTION','QTY/PCS']
  ]),'2026-117767');
  assert.equal(validation.findOrderNumber([
    ['ORDER NUMBER','','PO#GT-08062026 VN'],
    ['Item-No:','DESCRIPTION','COLOR','QTY/PCS']
  ]),'GT-08062026 VN');
  assert.equal(validation.findOrderNumber([
    ['ORDER NO','A-001'],
    ['ORDER NUMBER','B-002']
  ]),'');
  assert.match(source,/if\(detectedOrderNumber&&orderNumberInput&&!orderNumberInput\.value\.trim\(\)\)/);
  assert.match(source,/if\(orderImportAutoFilledNumber&&orderNumberInput\?\.value\.trim\(\)===orderImportAutoFilledNumber\) orderNumberInput\.value=''/);
});

test('訂單預覽只依實際表頭呈現產品說明與顏色',()=>{
  const validation=loadOrderImportValidation();
  assert.deepEqual({...validation.optionalColumns(['No','Item #','Width','Length','Description','QTY/PCS'])},{description:true,color:false});
  assert.deepEqual({...validation.optionalColumns(['No','Item-No:','DESCRIPTION','COLOR','QTY/PCS'])},{description:true,color:true});
});

test('訂單匯入預覽改版不更動既有匯入入口與正式服務',()=>{
  const orders=read('js/orders.js');
  assert.match(orders,/function handleImportFile\(input\)[\s\S]*?targetId:'order-import'/);
  assert.match(orders,/PCMSOrderService\.importOrder\(\{/);
  assert.match(orders,/orderId,client:g\('imp-ord-client'\)\?\.value\|\|'',dueDate/);
});

test('xls 與 xlsx 共用陣列緩衝區解析且預覽不保存完整工序陣列',()=>{
  const orders=read('js/orders.js');
  assert.ok(orders.includes("if(!/\\.(xlsx|xls)$/i.test"));
  assert.match(orders,/reader\.readAsArrayBuffer\(file\)/);
  assert.match(orders,/XLSX\.read\(e\.target\.result,\{type:'array'\}\)/);
  assert.doesNotMatch(orders,/readAsBinaryString|type:'binary'|window\._impData/);
  assert.match(orders,/let orderImportPreviewData=null/);
  assert.match(orders,/processCount:Array\.isArray\(prod\.ops\)\?prod\.ops\.length:0/);
  assert.doesNotMatch(orders,/ops:prod\.ops/);
});

test('選檔後上傳區縮成單列並保留重新選擇入口',()=>{
  const html=read('index.html');
  const css=read('styles/features/orders.css');
  const orders=read('js/orders.js');
  assert.match(html,/orders-import-drop-prompt/);
  assert.match(html,/orders-import-reselect[\s\S]*?Chọn lại tệp[\s\S]*?重新選擇/);
  assert.match(css,/\.orders-import-drop\.is-selected[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(css,/\.orders-import-drop\.is-selected \.orders-import-drop-prompt[\s\S]*?display: none/);
  assert.match(css,/\.orders-import-drop\.is-selected \.orders-import-reselect[\s\S]*?display: inline-flex/);
  assert.match(orders,/setOrderImportFileSelected\(true\);[\s\S]*?processImportOrderFile/);
  assert.match(orders,/setOrderImportFileSelected\(false\);/);
});
