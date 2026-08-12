import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=path=>fs.readFileSync(new URL(path,root),'utf8'); // read（讀取待驗收程式）

function createFileDrop(){
  const document={
    addEventListener:()=>{},
    getElementById:()=>null,
    documentElement:{clientWidth:1280,clientHeight:720}
  };
  const window={
    addEventListener:()=>{},
    innerWidth:1280,
    innerHeight:720,
    PCMSUIText:{register:()=>{},resolve:value=>typeof value==='string'?{vi:value,zh:value}:value}
  };
  const context={window,document,CustomEvent:class{ constructor(type,options){ this.type=type; this.detail=options?.detail; } },setTimeout,clearTimeout,console};
  vm.createContext(context);
  vm.runInContext(read('js/ui-file-drop.js'),context);
  return window.PCMSUIFileDrop;
}

test('共用全視窗拖曳限制格式、數量並在離開頁面後停止接收',async()=>{
  const fileDrop=createFileDrop(); // fileDrop（全視窗拖曳共用介面）
  const received=[];
  fileDrop.register({
    id:'test-import',page:'test-page',accept:['.xlsx','.xls'],maxFiles:1,
    onDrop:files=>received.push(files[0].name)
  });
  fileDrop.activatePage('test-page');
  assert.equal((await fileDrop.receiveFiles([{name:'order.xlsx'}])).accepted,true);
  assert.deepEqual(received,['order.xlsx']);
  assert.equal((await fileDrop.receiveFiles([{name:'order.pdf'}])).status,'invalidType');
  assert.equal((await fileDrop.receiveFiles([{name:'a.xlsx'},{name:'b.xlsx'}])).status,'tooManyFiles');
  fileDrop.deactivatePage('test-page');
  assert.equal((await fileDrop.receiveFiles([{name:'order.xlsx'}])).status,'unavailable');
});

test('款號與訂單匯入都登記全視窗用途並共用點擊選檔流程',()=>{
  const data=read('js/data.js');
  const orders=read('js/orders.js');
  const features=read('js/features.js');
  const html=read('index.html');

  assert.match(data,/id:'product-import'[\s\S]*?page:'summary'[\s\S]*?accept:\['\.xlsx','\.xls'\]/);
  assert.match(data,/function hImport\(input\)[\s\S]*?receiveFiles\?\.\(input\.files,\{targetId:'product-import',source:'picker'\}\)/);
  assert.match(data,/function handleDetailImportDrop\(event\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?targetId:'product-import'/);

  assert.match(orders,/id:'order-import'[\s\S]*?page:'progress'[\s\S]*?accept:\['\.xlsx','\.xls'\]/);
  assert.match(orders,/function handleImportFile\(input\)[\s\S]*?receiveFiles\?\.\(input\.files,\{targetId:'order-import',source:'picker'\}\)/);
  assert.match(orders,/function tryProcessPendingOrderImport\(\)[\s\S]*?orderImportPrerequisitesComplete\(\)[\s\S]*?processImportOrderFile/);
  assert.match(orders,/registerOrderFileDropTarget\(\);/);
  assert.match(data,/registerProductFileDropTarget\(\);/);
  assert.match(features,/onOpen:\['renderProgress','renderOrders'\]/);
  assert.match(features,/onOpen:\['rSum'\],onLeave:\['summaryLeave'\]/);
  assert.match(html,/id="imp-file-drop"[\s\S]*?onclick="g\('imp-file'\)\.click\(\)"/);
});
