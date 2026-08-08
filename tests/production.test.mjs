import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

function createProductionContext(){
  const employeeDocuments=[
    {id:'M91234',data:()=>({employeeId:'M91234',name:'Nguyễn An',department:'May',active:true})},
    {id:'A55678',data:()=>({employeeId:'A55678',name:'Trần Bình',department:'Đóng gói',active:true})}
  ]; // employeeDocuments（員工測試資料）
  const orderProcesses=[
    {id:'PROCESS-1',orderId:'ORDER-ABC-2026',orderNo:'OD-7788',code:'STYLE-500',desc:'Áo khoác',color:'Đen',sz:'M',processNo:'1',processVi:'May thân',processZh:'車身',orderQty:1000,workStdSec:48,processSec:48,slPerHour:63},
    {id:'PROCESS-2',orderId:'ORDER-ABC-2026',orderNo:'OD-7788',code:'STYLE-500',desc:'Áo khoác',color:'Đen',sz:'M',processNo:'12',processVi:'Kiểm tra',processZh:'檢查',orderQty:1000,workStdSec:30,processSec:30,slPerHour:100},
    {id:'PROCESS-3',orderId:'ORDER-ABC-2026',orderNo:'OD-7788',code:'STYLE-900',desc:'Quần dài',color:'Xanh',sz:'L',processNo:'1',processVi:'May túi',processZh:'車口袋',orderQty:800,workStdSec:50,processSec:50,slPerHour:60}
  ]; // orderProcesses（訂單工序測試資料）
  const window={
    firebaseAuthUser:{uid:'clerk-user'},
    cu:{user:'文員測試'},
    _collection:name=>name,
    _getDocs:async()=>({docs:employeeDocuments}),
    firebaseLoadCachedCollection:async()=>[
      {id:'ORDER-ABC-2026',orderId:'ORDER-ABC-2026',client:'Khách A',importStatus:'ready',lifecycleStatus:'active',processVersion:'v1'},
      {id:'ORDER-OLD',orderId:'ORDER-OLD',client:'Khách cũ',importStatus:'failed'}
    ],
    PCMSOrderProcessCache:{
      read:async()=>orderProcesses,
      write:async()=>{},
      remove:async()=>{}
    }
  };
  const context={window,console,Map,Object,Array,String,Number,Math,Date,Error,RegExp};
  vm.createContext(context);
  vm.runInContext(read('js/production/employee-store.js'),context);
  vm.runInContext(read('js/production/entry-store.js'),context);
  return window;
}

test('員工工號、姓名及部門可用整段任意文字搜尋',async()=>{
  const window=createProductionContext();
  await window.PCMSProductionEmployees.load();
  assert.equal(window.PCMSProductionEmployees.search('1234')[0].employeeId,'M91234');
  assert.equal(window.PCMSProductionEmployees.search('uyễn')[0].employeeId,'M91234');
  assert.equal(window.PCMSProductionEmployees.search('gói')[0].employeeId,'A55678');
  assert.equal(window.PCMSProductionEmployees.validateEmployee({employeeId:'m91234',name:'A',department:'B'}).employeeId,'M91234');
});

test('訂單、款號及工序只在目前訂單範圍內搜尋',async()=>{
  const window=createProductionContext();
  await window.PCMSProductionEntryStore.loadOrders();
  assert.equal(window.PCMSProductionEntryStore.searchOrders('ABC')[0].id,'ORDER-ABC-2026');
  assert.equal(window.PCMSProductionEntryStore.searchOrders('Khách A')[0].id,'ORDER-ABC-2026');
  assert.equal(window.PCMSProductionEntryStore.searchOrders('OLD').length,0);
  await window.PCMSProductionEntryStore.loadProcesses('ORDER-ABC-2026');
  assert.deepEqual(
    Array.from(window.PCMSProductionEntryStore.searchProducts('ORDER-ABC-2026','500')).map(item=>item.code),
    ['STYLE-500']
  );
  assert.equal(window.PCMSProductionEntryStore.findProcess('ORDER-ABC-2026','STYLE-500','1').id,'PROCESS-1');
  assert.equal(window.PCMSProductionEntryStore.findProcess('ORDER-ABC-2026','STYLE-900','12'),null);
});

test('生產數量只接受正整數且生產日期必須明確填寫',()=>{
  const window=createProductionContext();
  const valid={productionDate:'2026-08-08',employeeId:'M91234',orderId:'ORDER-ABC-2026',productCode:'STYLE-500',processNo:'1',quantity:500};
  assert.equal(window.PCMSProductionEntryStore.validateEntryInput(valid).quantity,500);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...valid,quantity:0}),/正整數/);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...valid,quantity:1.5}),/正整數/);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...valid,productionDate:''}),/生產日期/);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...valid,productionDate:'2026-02-31'}),/生產日期/);
});

test('產能永久刪除只供管理員使用且同步處理員工關聯與工序累計',()=>{
  const employeeStore=read('js/production/employee-store.js'); // employeeStore（員工資料存取程式內容）
  const entryStore=read('js/production/entry-store.js'); // entryStore（生產資料存取程式內容）
  const employeePage=read('js/production/production-employees.js'); // employeePage（員工資料頁程式內容）
  const entryPage=read('js/production/production-entry.js'); // entryPage（生產登記頁程式內容）
  const recordsPage=read('js/production/production-records.js'); // recordsPage（生產紀錄頁程式內容）

  assert.match(employeeStore,/window\.cu\?\.role !== 'admin'/);
  assert.match(employeeStore,/_where\('employeeId','==',normalized\)/);
  assert.match(employeeStore,/transaction\.delete\(reference\)/);
  assert.match(entryStore,/window\.cu\?\.role !== 'admin'/);
  assert.match(entryStore,/nextRegistered === 0\) transaction\.delete\(totalReference\)/);
  assert.match(entryStore,/transaction\.delete\(entryReference\)/);
  assert.match(entryStore,/productionEntryDelete/);
  [employeePage,entryPage,recordsPage].forEach(source=>{
    assert.match(source,/window\.cu\?\.role === 'admin'/);
    assert.match(source,/永久刪除/);
  });
});
