import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const lockSource=read('js/performance-bonus/bonus-lock-service.js');
const storeSource=read('js/performance-bonus/bonus-store.js');
const pageSource=read('js/performance-bonus/monthly-bonus-page.js');
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

function snapshot(id,value){ return {id,exists:()=>value!==undefined,data:()=>clone(value)}; }
function load(){
  const documents=new Map();
  const key=ref=>`${ref.collection}/${ref.id}`;
  const window={firebaseAuthUser:{uid:'admin-1'},cu:{role:'admin',user:'管理員',authUid:'admin-1'},
    _docRef:(collection,id)=>({collection,id}),_newDocRef:collection=>({collection,id:`log-${documents.size+1}`}),
    _getDoc:async ref=>snapshot(ref.id,documents.get(key(ref))),
    _writeBatch:()=>{ const writes=[];return {set:(ref,data)=>writes.push([ref,clone(data)]),commit:async()=>writes.forEach(([ref,data])=>documents.set(key(ref),data))}; },
    _runTransaction:async callback=>{
      const writes=[];
      await callback({get:async ref=>snapshot(ref.id,documents.get(key(ref))),set:(ref,data)=>writes.push([ref,clone(data)])});
      writes.forEach(([ref,data])=>documents.set(key(ref),data));
    }
  };
  const context={window,console,Date,Map,Set,Promise,JSON,String,Number,Math,RegExp,Error,Object,Array};
  vm.createContext(context);vm.runInContext(lockSource,context);
  return {window,documents,key};
}

function payload(window){
  return window.PCMSPerformanceBonusLockService.buildSnapshotPayload({
    month:'2026-08',sourceState:{entriesVersion:'E1',attendanceVersion:'A1',summaryVersion:'S1'},frozenAt:1,
    current:{metadata:{month:'2026-08',status:'draft',sourceEntriesVersion:'E1',sourceAttendanceVersion:'A1',
      sourceSummaryVersion:'S1',employeeCount:1,eligibleEmployeeCount:1,finalBonusTotal:32000},
    employees:[{employeeId:'M1',employeeName:'An',days:[],finalBonus:32000}]},
    products:[{productId:'P1',code:'OLD',ops:[{processId:'PR1',no:'1',sec:60}]}],
    orders:[{id:'O1',customer:'C',po:'PO1'}],orderItems:[{orderItemId:'I1',orderId:'O1',productId:'P1',quantity:100}],
    entries:[{id:'E1',orderItemId:'I1',productId:'P1',processId:'PR1',quantity:100}],
    resolvedSummaries:[{employeeId:'M1',days:{}}],rawSummaries:[{employeeId:'M1',days:{}}],referenceTable:{version:1}
  });
}

test('鎖定快照完整保存主檔、訂單、產能、分析、績效與最終獎金',()=>{
  const {window}=load();const result=payload(window);
  assert.equal(result.productMaster.products[0].ops[0].processId,'PR1');
  assert.equal(result.orderContext.orderItems[0].orderItemId,'I1');
  assert.equal(result.production.entries[0].processId,'PR1');
  assert.equal(result.bonus.employees[0].finalBonus,32000);
  assert.ok(Array.isArray(result.performance));
  assert.ok(Array.isArray(result.analysis.employees));
});

test('大型快照可安全分段、重組並偵測內容異常',()=>{
  const {window}=load();const service=window.PCMSPerformanceBonusLockService;
  const source={month:'2026-08',rows:Array.from({length:200},(_,index)=>({index,name:'工序'.repeat(300)}))};
  const encoded=service.splitJson(source,5000);
  assert.ok(encoded.parts.length>1);
  assert.deepEqual(service.joinJson(encoded.parts,encoded.hash),source);
  assert.throws(()=>service.joinJson([`${encoded.parts[0]}X`,...encoded.parts.slice(1)],encoded.hash),/快照不完整/);
});

test('鎖定可重跑且最後交易同時保存月份、快照狀態與操作紀錄',async()=>{
  const {window,documents}=load();const service=window.PCMSPerformanceBonusLockService;
  documents.set('productionMonths/2026-08',{month:'2026-08',status:'open',summaryReady:true,revision:2,
    entriesVersion:'E1',attendanceVersion:'A1',summaryVersion:'S1'});
  const current=payload(window).bonus;
  const input=payload(window);
  const first=await service.lockMonth('2026-08',current,{payload:input});
  assert.equal(first.status,'locked');assert.ok(first.snapshotId);
  assert.equal(documents.get('productionMonths/2026-08').status,'locked');
  assert.equal(documents.get(`performanceBonusSnapshots/${first.snapshotId}`).state,'locked');
  assert.equal(first.operationLogId,`pbl_${first.snapshotId}`);
  assert.ok(documents.has(`operationLogs/${first.operationLogId}`));
  assert.equal(documents.get(`performanceBonusSnapshots/${first.snapshotId}`).operationLogId,first.operationLogId);
  assert.equal(documents.get('productionMonths/2026-08').operationLogId,first.operationLogId);
  const operationLog=documents.get(`operationLogs/${first.operationLogId}`);
  assert.equal(operationLog.schemaVersion,2);
  assert.equal(operationLog.targetRevision,first.lockRevision);
  assert.equal(operationLog.controlRevision,documents.get('productionMonths/2026-08').revision);
  const stored=await service.readSnapshot(first.snapshotId);
  assert.equal(stored.bonus.employees[0].finalBonus,32000);
  await assert.rejects(()=>service.lockMonth('2026-08',current,{payload:input}),/月份尚未準備好鎖定/);
});

test('解除鎖定只保留入口提示，資料層不得寫回草稿或開啟月份',()=>{
  const unlockBody=storeSource.match(/async function unlockMonth\(month\)\{([\s\S]*?)\n  \}\n  function canUnlock/)?.[1]||'';
  assert.match(unlockBody,/功能尚未接入/);
  assert.doesNotMatch(unlockBody,/_runTransaction|transaction\.set|status:'draft'|status:'open'/);
  assert.match(pageSource,/Chức năng chưa được kết nối/);
  assert.doesNotMatch(pageSource,/store\(\)\.unlockMonth/);
});
