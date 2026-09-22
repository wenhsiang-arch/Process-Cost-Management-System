import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('js/order-history.js',root),'utf8');
const css=fs.readFileSync(new URL('styles/features/order-history.css',root),'utf8');
const features=fs.readFileSync(new URL('js/features.js',root),'utf8');

function runtime(){
  const nodes=new Map();
  const makeNode=id=>({id,dataset:{},innerHTML:'',textContent:'',hidden:false,disabled:false});
  const getElementById=id=>{
    if(!nodes.has(id)) nodes.set(id,makeNode(id));
    return nodes.get(id);
  };
  getElementById('order-history-root');
  const calls=[];
  const rows=[
    {id:'log-1',feature:'orders',action:'orderItemQuantityUpdate',status:'success',targetId:'item-1',note:'PO-001｜Điều chỉnh',
      createdAt:Date.UTC(2026,8,23,6),createdBy:'Quản lý',changes:[{field:'quantity',before:100,after:120}]},
    {id:'log-2',feature:'inspectionReport',action:'inspectionReportExcelExport',status:'success',fileName:'PO-001.xlsx',
      note:'PO-001',itemCount:3,detailCount:20,createdAt:Date.UTC(2026,8,23,5),createdBy:'Quản lý'},
    {id:'log-3',feature:'orders',action:'orderUpdate',status:'success',targetId:'internal-order-id',note:'actualShipDate',
      createdAt:Date.UTC(2026,8,23,4),createdBy:'Quản lý',changes:[]}
  ];
  const window={PCMSHistory:{
    loadOperationLogs:async options=>{calls.push(options);return rows;},
    hasMore:()=>false
  }};
  const context={window,document:{getElementById},console,Date,setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(source,context);
  return {window,nodes,calls};
}

const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test('歷史操作只在開頁後讀取整個訂單主功能且單次最多五十筆',async()=>{
  const {window,nodes,calls}=runtime();
  assert.equal(calls.length,0);
  window.orderHistoryInit();
  await settle();
  assert.equal(calls.length,1);
  assert.equal(calls[0].permissionKey,'progress');
  assert.equal(calls[0].limit,50);
  assert.equal('actions' in calls[0],false);
  assert.match(nodes.get('order-history-root').innerHTML,/歷史操作紀錄/);
  assert.match(nodes.get('order-history-body').innerHTML,/調整數量/);
  assert.match(nodes.get('order-history-body').innerHTML,/100[\s\S]*120/);
  assert.match(nodes.get('order-history-body').innerHTML,/PO-001\.xlsx/);
  assert.match(nodes.get('order-history-body').innerHTML,/匯出品檢報告/);
  assert.doesNotMatch(nodes.get('order-history-body').innerHTML,/actualShipDate|internal-order-id/);
  const shell=nodes.get('order-history-root').innerHTML;
  assert.ok(shell.indexOf('操作者')<shell.indexOf('訂單／對象'));
});

test('同一登入期間重開分頁使用暫存，只有載入更多與重新整理再次查詢',async()=>{
  const {window,calls}=runtime();
  window.orderHistoryInit();
  await settle();
  window.orderHistoryLeave();
  window.orderHistoryInit();
  await settle();
  assert.equal(calls.length,1);
  window.orderHistoryLoadMore();
  await settle();
  assert.equal(calls.at(-1).loadMore,true);
  window.orderHistoryRefresh();
  await settle();
  assert.equal(calls.at(-1).force,true);
});

test('歷史分頁使用獨立程式樣式、共用表格與雙語排版',()=>{
  assert.match(features,/orderHistory:'js\/order-history\.js/);
  assert.match(features,/orderHistory:'styles\/features\/order-history\.css/);
  assert.match(source,/class="ui-table"/);
  assert.match(source,/class="ui-dual-copy"/);
  assert.match(css,/#order-history-table/);
  assert.match(css,/var\(--ui-color-success-background\)/);
  assert.ok(features.indexOf("page:'inspection-report-template'")<features.indexOf("page:'order-history'"));
});
