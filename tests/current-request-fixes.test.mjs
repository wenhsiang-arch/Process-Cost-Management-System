import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

function loadAttendance(){
  const context={window:{},console,Map,Set,Promise,Date,Number,String,Array,Object,Math,RegExp};
  vm.createContext(context);
  vm.runInContext(read('js/production/attendance-store.js'),context);
  return context.window.PCMSProductionAttendance;
}

function loadPerformance(attendance){
  const employees=new Map([
    ['M1',{employeeId:'M1',name:'A',department:'May'}],
    ['M2',{employeeId:'M2',name:'B',department:'May'}],
    ['M3',{employeeId:'M3',name:'C',department:'May'}],
    ['M4',{employeeId:'M4',name:'D',department:'May'}]
  ]);
  const context={
    window:{
      PCMSProductionEmployees:{find:id=>employees.get(id)||null},
      PCMSProductionAttendance:attendance
    },
    console,Map,Set,Promise,Date,Number,String,Array,Object,Math,RegExp
  };
  vm.createContext(context);
  vm.runInContext(read('js/production/production-records.js'),context);
  return context.window.PCMSProductionPerformance;
}

test('未出勤不列入績效，同日依績效由高到低且異常放最後',()=>{
  const attendance=loadAttendance();
  const performance=loadPerformance(attendance);
  const entries=[
    {status:'active',productionDate:'2026-08-14',employeeId:'M1',quantity:80,hourlyCapacitySnapshot:10,processNo:'1'},
    {status:'active',productionDate:'2026-08-14',employeeId:'M2',quantity:40,hourlyCapacitySnapshot:10,processNo:'1'},
    {status:'active',productionDate:'2026-08-14',employeeId:'M4',quantity:10,hourlyCapacitySnapshot:10,processNo:'1'}
  ];
  const attendanceByDate=new Map([['2026-08-14',[
    {employeeId:'M1',normalHours:8,overtimeHours:0},
    {employeeId:'M2',normalHours:8,overtimeHours:0},
    {employeeId:'M3',normalHours:0,overtimeHours:0},
    {employeeId:'M4',normalHours:0,overtimeHours:0}
  ]]]);
  const rows=performance.aggregatePerformance(entries,attendanceByDate);
  assert.deepEqual(Array.from(rows,row=>row.employeeId),['M1','M2','M4']);
  assert.deepEqual(Array.from(rows,row=>row.percentage),[100,50,null]);
  assert.equal(rows[2].status,'invalid-attendance');
  assert.equal(attendance.calculateEfficiency([],attendanceByDate.get('2026-08-14')[2]).status,'absent');
});

test('正常績效跳到指定日期紀錄，只有工序異常才定位工序',()=>{
  const records=read('js/production/production-records.js');
  const entry=read('js/production/production-entry.js');
  assert.match(records,/openEmployeeRegistration\(item,\{targetProcess:false\}\)/);
  assert.match(records,/openEmployeeRegistration\(item,\{targetProcess:true\}\)/);
  assert.match(records,/const context=\{[\s\S]*?employeeId:item\.employeeId,[\s\S]*?productionDate:item\.productionDate[\s\S]*?\};[\s\S]*?if\(options\.targetProcess===true\)/);
  assert.match(entry,/const targetProcess=Boolean\(pending\.orderId\|\|pending\.orderNo\|\|pending\.code\|\|pending\.processNo\)/);
  assert.match(entry,/if\(targetProcess\)\{[\s\S]*?production-process-input[\s\S]*?\}else\{[\s\S]*?production-entry-data-section[\s\S]*?scrollIntoView/);
});

function loadOrderValidation(){
  const context={
    window:{PCMSSafe:{text:String,attribute:String,inlineArgument:value=>JSON.stringify(value)}},
    console,Map,Set,Promise,Date,Number,String,Array,Object,Math,RegExp
  };
  vm.createContext(context);
  vm.runInContext(read('js/orders.js'),context);
  return context.window.PCMSOrderImportValidation;
}

test('一般訂單可在前置說明後辨識 STYLE 與 PCS 並核對總數量',()=>{
  const validation=loadOrderValidation();
  const source=read('js/orders.js');
  const rows=Array.from({length:12},()=>['說明']);
  rows.push(['STYLE','DESCRIPTION','PCS']);
  rows.push(['abc-01','Product A',100]);
  rows.push(['ABC-02','Product B',200]);
  rows.push(['','TOTAL',300]);
  const result=validation.parseRows(rows,'Order');
  assert.equal(result.errors.length,0);
  assert.equal(result.totalQuantity,300);
  assert.deepEqual(Array.from(result.items,item=>({code:item.code,qty:item.qty})),[
    {code:'ABC-01',qty:100},
    {code:'ABC-02',qty:200}
  ]);
  assert.match(source,/wb\.SheetNames\.length!==1/);
  assert.match(source,/const parsed=parseGeneralOrderRows\(rows,wb\.SheetNames\[0\],\{formulaRows\}\)/);
  assert.match(source,/const productsByCode=new Map/);
  assert.doesNotMatch(source,/Math\.min\(10,rows\.length\)/);
});

test('一般訂單阻止空白款號、空白數量、零、小數及大小寫重複款號',()=>{
  const validation=loadOrderValidation();
  const result=validation.parseRows([
    ['MÃ HÀNG','SL:PO PCS'],
    ['',20],
    ['A-01',''],
    ['A-02',0],
    ['A-03',1.5],
    ['abc-04',10],
    ['ABC-04',20]
  ],'Order');
  assert.equal(result.items.length,0);
  assert.equal(result.errors.length,5);
  assert.match(result.errors.join('\n'),/款號空白/);
  assert.match(result.errors.join('\n'),/訂單數量空白/);
  assert.match(result.errors.join('\n'),/訂單數量為 0/);
  assert.match(result.errors.join('\n'),/小數/);
  assert.match(result.errors.join('\n'),/重複出現/);
});

test('左側選單標題與收合按鍵固定在可視區頂端',()=>{
  const html=read('index.html');
  assert.match(html,/\.sb-logo\{position:sticky;top:0;z-index:3;flex-shrink:0;[\s\S]*?background:var\(--navy\)\}/);
  assert.match(html,/<div class="sb-logo">[\s\S]*?id="primary-sidebar-toggle"/);
});
