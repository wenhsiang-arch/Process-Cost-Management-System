import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));

function load(){
  const documents=new Map();
  const window={S:{ws:3000},_docRef:(collection,id)=>({collection,id}),_getDoc:async ref=>{
    const value=documents.get(`${ref.collection}/${ref.id}`);return {exists:()=>value!==undefined,data:()=>clone(value)};
  }};
  const context={window,TextEncoder,console,Date,Map,Set,Promise};vm.createContext(context);
  ['js/product-model.js','js/product-resolver.js','js/production/efficiency-core.js','js/production/linked-summary-store.js']
    .forEach(path=>vm.runInContext(read(path),context));
  const model=window.PCMSProductModel;
  const ids={productId:model.deterministicLegacyId('product','P1'),processId:model.deterministicLegacyId('process','P1-1'),
    orderItemId:model.deterministicLegacyId('orderItem','O1-I1')};
  documents.set(`products/${ids.productId}`,{code:'P-OLD',client:'C',zh:'產品',vi:'Sản phẩm',sz:'M',active:true,
    ops:[{processId:ids.processId,no:'1',sortOrder:1,category:'SX',zh:'車縫',vi:'May',sec:60,active:true}]});
  return {window,documents,ids};
}

test('未鎖定日月摘要只保存固定身分與數量，不保存主檔文字或秒數',()=>{
  const {window,ids}=load();const store=window.PCMSProductionSummaries;
  const actor={updatedAt:1,updatedByUid:'u1',updatedBy:'A'};
  let day=store.emptyDay({productionDate:'2026-08-23',employeeId:'M001',employeeName:'A',department:'May',
    attendance:{normalHours:8,overtimeHours:0},actor});
  day=store.applyEntry(day,{id:'e1',recordType:'standard',productionDate:'2026-08-23',employeeId:'M001',orderId:'O1',
    orderItemId:ids.orderItemId,productId:ids.productId,processId:ids.processId,quantity:100},1,actor);
  const month=store.applyDayToMonth(null,null,day,actor,{complete:true});
  const raw=month.days.d23.processes[0];
  assert.deepEqual(Object.keys(raw).sort(),['key','orderId','orderItemId','processId','productId','quantity'].sort());
  assert.equal(Object.hasOwn(month.days.d23,'standardHours'),false);
});

test('相同原始摘要在款號主檔修改後自動產生最新工序與績效',async()=>{
  const {window,documents,ids}=load();const store=window.PCMSProductionSummaries;
  const actor={updatedAt:1,updatedByUid:'u1',updatedBy:'A'};
  let day=store.emptyDay({productionDate:'2026-08-23',employeeId:'M001',employeeName:'A',department:'May',
    attendance:{normalHours:8,overtimeHours:0},actor});
  day=store.applyEntry(day,{id:'e1',recordType:'standard',productionDate:'2026-08-23',employeeId:'M001',orderId:'O1',
    orderItemId:ids.orderItemId,productId:ids.productId,processId:ids.processId,quantity:600},1,actor);
  const rawMonth=store.applyDayToMonth(null,null,day,actor,{complete:true});
  let resolved=(await store.resolveEmployeeMonths([rawMonth])).rows[0];
  assert.equal(resolved.days.d23.processes[0].productCode,'P-OLD');
  assert.equal(resolved.days.d23.processes[0].processNo,'1');
  assert.equal(resolved.days.d23.standardHours,12);
  const product=documents.get(`products/${ids.productId}`);
  product.code='P-NEW';product.ops[0]={...product.ops[0],no:'7',sec:50,zh:'新工序',vi:'Mới'};
  documents.set(`products/${ids.productId}`,product);store.invalidateProductResolution();
  resolved=(await store.resolveEmployeeMonths([rawMonth])).rows[0];
  assert.equal(resolved.days.d23.processes[0].productCode,'P-NEW');
  assert.equal(resolved.days.d23.processes[0].processNo,'7');
  assert.equal(resolved.days.d23.processes[0].processSeconds,50);
  assert.equal(resolved.days.d23.standardHours,10);
  assert.equal(resolved.days.d23.efficiencyPercentage,125);
});

test('分析、績效及未鎖定獎金使用新摘要介面而非固定版本2',()=>{
  const analysis=read('js/production-analysis/analysis-store.js');
  const bonus=read('js/performance-bonus/bonus-store.js');
  assert.match(analysis,/summaryStore\.loadEmployeeMonths/);
  assert.match(bonus,/Number\(item\.schemaVersion\)===Number\(summaryStore\.SCHEMA_VERSION\)/);
  assert.doesNotMatch(bonus,/Number\(item\.schemaVersion\)===2/);
});

test('產能來源版本保留考勤版本並連續遞增月份修訂號',()=>{
  const {window}=load();
  const api=window.PCMSProductionSummaries;
  const first=api.monthSourceVersionData('2026-08','entry-1',{updatedAt:100,updatedByUid:'u1',updatedBy:'A'},
    {month:'2026-08',status:'open',attendanceVersion:'A7',revision:4});
  assert.equal(first.status,'open');
  assert.equal(first.attendanceVersion,'A7');
  assert.equal(first.revision,5);
  assert.equal(first.schemaVersion,3);
  const second=api.monthSourceVersionData('2026-08','entry-2',{updatedAt:101,updatedByUid:'u1',updatedBy:'A'},first);
  assert.equal(second.revision,6);
  assert.notEqual(second.entriesVersion,first.entriesVersion);
});

test('產能交易操作識別碼會傳遞到日摘要、員工月摘要與月份狀態',()=>{
  const {window,ids}=load();const api=window.PCMSProductionSummaries;
  const actor={updatedAt:100,updatedByUid:'u1',updatedBy:'A',operationLogId:'peo_entry-1__create__1'};
  let day=api.emptyDay({productionDate:'2026-08-23',employeeId:'M001',employeeName:'A',department:'May',
    attendance:{normalHours:8,overtimeHours:0},actor});
  day=api.applyEntry(day,{id:'entry-1',recordType:'standard',productionDate:'2026-08-23',employeeId:'M001',orderId:'O1',
    orderItemId:ids.orderItemId,productId:ids.productId,processId:ids.processId,quantity:10},1,actor);
  const month=api.applyDayToMonth(null,null,day,actor,{complete:true});
  const control=api.monthSourceVersionData('2026-08','entry-1',actor,{month:'2026-08',status:'open',revision:1});
  assert.equal(day.operationLogId,actor.operationLogId);
  assert.equal(month.operationLogId,actor.operationLogId);
  assert.equal(control.operationLogId,actor.operationLogId);
});
