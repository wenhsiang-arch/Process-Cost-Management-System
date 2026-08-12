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
  const cutting=read('js/cutting.js');
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

  const fileInputs=Array.from(html.matchAll(/<input\b[^>]*\btype="file"[^>]*>/g),match=>match[0]); // fileInputs（全部正式檔案匯入入口）
  assert.ok(fileInputs.length>0);
  const registeredSources=`${cutting}\n${data}\n${orders}`; // registeredSources（功能頁全視窗用途登記來源）
  fileInputs.forEach(input=>{
    const inputId=input.match(/\bid="([^"]+)"/)?.[1]||''; // inputId（檔案入口識別碼）
    const targetId=input.match(/\bdata-file-drop-target="([^"]+)"/)?.[1]||''; // targetId（對應全視窗用途識別碼）
    assert.ok(targetId,`${inputId||'unknown'} 缺少全視窗拖曳用途`);
    assert.match(registeredSources,new RegExp(`id:'${targetId.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}'`),`${inputId} 的全視窗拖曳用途尚未登記`);
  });
});
