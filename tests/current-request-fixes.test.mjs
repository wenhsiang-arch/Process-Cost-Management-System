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
    {status:'active',productionDate:'2026-08-14',employeeId:'M1',quantity:80,hourlyCapacity:10,processNo:'1'},
    {status:'active',productionDate:'2026-08-14',employeeId:'M2',quantity:40,hourlyCapacity:10,processNo:'1'},
    {status:'active',productionDate:'2026-08-14',employeeId:'M4',quantity:10,hourlyCapacity:10,processNo:'1'}
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

test('一般訂單阻止空白款號、空白數量、零與小數，但保留大小寫相同款號的各列',()=>{
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
  assert.equal(result.items.length,2);
  assert.equal(result.errors.length,4);
  assert.deepEqual(Array.from(result.items,item=>item.qty),[10,20]);
  assert.match(result.errors.join('\n'),/款號空白/);
  assert.match(result.errors.join('\n'),/訂單數量空白/);
  assert.match(result.errors.join('\n'),/訂單數量為 0/);
  assert.match(result.errors.join('\n'),/小數/);
  assert.doesNotMatch(result.errors.join('\n'),/重複出現/);
});

test('左側選單標題與收合按鍵固定在可視區頂端',()=>{
  const html=read('index.html');
  assert.match(html,/\.sb-logo\{position:sticky;top:0;z-index:3;flex-shrink:0;[\s\S]*?background:var\(--navy\)\}/);
  assert.match(html,/<div class="sb-logo">[\s\S]*?id="primary-sidebar-toggle"/);
});

function loadIdlePolicy(){
  const auth=read('js/auth.js');
  const start=auth.indexOf('const IDLE_MS');
  const end=auth.indexOf('// ===== Firebase Authentication',start);
  assert.ok(start>=0&&end>start,'找不到閒置規則程式');
  const context={Date,Number,Math,setInterval,clearInterval,document:{},window:{}};
  vm.createContext(context);
  vm.runInContext(`${auth.slice(start,end)}\nthis.idlePolicy={
    vietnamMinutesOfDay,isVietnamDaytime,vietnamNightWindowStartAt,idleExpired,
    setState(active,lastActivityAt){ idleActive=active; idleLastActivityAt=lastActivityAt; }
  };`,context);
  return context.idlePolicy;
}

test('非管理員只在越南時間夜間連續 30 分鐘未操作時登出，管理員不啟動閒置計時',()=>{
  const auth=read('js/auth.js');
  const html=read('index.html');
  const policy=loadIdlePolicy();
  assert.match(auth,/const IDLE_MS = 30\*60\*1000/);
  assert.match(auth,/const VIETNAM_UTC_OFFSET_MS = 7\*60\*60\*1000/);
  assert.match(auth,/function idleExpired\(now=Date\.now\(\)\)/);
  assert.match(auth,/Math\.max\(idleLastActivityAt,vietnamNightWindowStartAt\(now\)\)/);
  assert.match(auth,/document\.addEventListener\('visibilitychange',checkIdleAfterResume\)/);
  assert.match(auth,/window\.addEventListener\('focus',checkIdleAfterResume\)/);
  assert.match(auth,/window\.addEventListener\('pageshow',checkIdleAfterResume\)/);
  assert.match(auth,/doLogout\('idle'\)/);
  assert.match(auth,/if\(window\.cu\.role==='admin'\) stopIdle\(\);\s*else startIdle\(\);/);
  assert.doesNotMatch(auth,/idleT--|data-idle-countdown|idleprog/);
  assert.doesNotMatch(html,/data-idle-countdown|id="idleprog"|sidebar-idle-info/);

  const at=localTime=>Date.parse(`${localTime}+07:00`);
  assert.equal(policy.isVietnamDaytime(at('2026-09-30T07:29:59')),false);
  assert.equal(policy.isVietnamDaytime(at('2026-09-30T07:30:00')),true);
  assert.equal(policy.isVietnamDaytime(at('2026-09-30T20:29:59')),true);
  assert.equal(policy.isVietnamDaytime(at('2026-09-30T20:30:00')),false);

  policy.setState(true,at('2026-09-30T18:00:00'));
  assert.equal(policy.idleExpired(at('2026-09-30T20:59:59')),false,'白天未操作不得在 20:30 立即登出');
  assert.equal(policy.idleExpired(at('2026-09-30T21:00:00')),true,'夜間開始 30 分鐘後應登出');
  policy.setState(true,at('2026-09-30T21:10:00'));
  assert.equal(policy.idleExpired(at('2026-09-30T21:39:59')),false);
  assert.equal(policy.idleExpired(at('2026-09-30T21:40:00')),true);
  policy.setState(true,at('2026-09-30T21:10:00'));
  assert.equal(policy.idleExpired(at('2026-10-01T07:30:00')),false,'07:30 起白天不因閒置登出');
});

test('月績效獎金標題列只有總金額使用與累積獎金一致的藍色底框',()=>{
  const page=read('js/performance-bonus/monthly-bonus-page.js');
  const style=read('styles/features/performance-bonus.css');
  const countRule=style.match(/\.performance-bonus-count\{([^}]*)\}/)?.[1]||'';
  const totalRule=style.match(/\.performance-bonus-total\{([^}]*)\}/)?.[1]||'';
  const amountRule=style.match(/\.performance-bonus-amount\{([^}]*)\}/)?.[1]||'';
  assert.match(page,/id="performance-bonus-count">0<\/span><span class="ui-text-vi">người<\/span>/);
  assert.doesNotMatch(page,/performance-bonus-count-zh/);
  assert.match(page,/Tổng thưởng[\s\S]*?獎金總和[\s\S]*?class="performance-bonus-total"/);
  assert.match(countRule,/white-space:\s*nowrap/);
  assert.match(countRule,/flex-direction:\s*row/);
  assert.match(countRule,/flex-wrap:\s*nowrap/);
  assert.doesNotMatch(countRule,/background:|border:/);
  for(const declaration of [
    /min-width:\s*150px/,
    /padding:\s*8px 12px/,
    /border:\s*1px solid var\(--ui-color-operation-border\)/,
    /border-radius:\s*10px/,
    /background:\s*var\(--ui-color-primary-soft\)/,
    /color:\s*var\(--ui-color-primary\)/,
    /font-weight:\s*var\(--ui-font-weight-emphasis\)/
  ]){
    assert.match(totalRule,declaration);
    assert.match(amountRule,declaration);
  }
});

test('員工績效日期範圍仍是上限，全部員工按七天、精確單人按月份分頁',()=>{
  const performance=loadPerformance(loadAttendance());
  const weekly=performance.performancePeriods('2026-08-01','2026-08-14',false);
  const monthly=performance.performancePeriods('2026-07-25','2026-08-24',true);
  assert.deepEqual(Array.from(weekly,item=>[item.from,item.to]),[
    ['2026-08-08','2026-08-14'],['2026-08-01','2026-08-07']
  ]);
  assert.deepEqual(Array.from(monthly,item=>[item.from,item.to]),[
    ['2026-08-01','2026-08-24'],['2026-07-25','2026-07-31']
  ]);
});
