import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

class MemoryDb{
  constructor(){this.documents=new Map();this.ids=0;}
  key(ref){return `${ref.collection}/${ref.id}`;}
  snapshot(ref){const value=this.documents.get(this.key(ref));return {id:ref.id,exists:()=>value!==undefined,data:()=>clone(value),ref};}
  apply(writes){for(const write of writes){const key=this.key(write.ref);this.documents.set(key,write.merge?{...(this.documents.get(key)||{}),...clone(write.data)}:clone(write.data));}}
  async transaction(task){const writes=[];const tx={get:async ref=>this.snapshot(ref),set:(ref,data,options)=>writes.push({ref,data,merge:options?.merge===true})};const value=await task(tx);this.apply(writes);return value;}
  batch(){const writes=[];return {set:(ref,data,options)=>writes.push({ref,data,merge:options?.merge===true}),commit:async()=>this.apply(writes)};}
}

function load(){
  const db=new MemoryDb();
  const window={firebaseAuthUser:{uid:'admin'},cu:{user:'管理員'}};
  Object.assign(window,{
    _docRef:(collection,id)=>({collection,id}),_newDocRef:collection=>({collection,id:`generated-${++db.ids}`}),
    _runTransaction:task=>db.transaction(task),_writeBatch:()=>db.batch()
  });
  const context={window,TextEncoder,console,Date};vm.createContext(context);
  ['js/product-model.js','js/order-item-store.js','js/order-service.js'].forEach(path=>vm.runInContext(read(path),context));
  return {window,db};
}

test('同一訂單允許多行相同 productId 且保留各自訂單欄位',()=>{
  const {window}=load();
  const productId=window.PCMSProductModel.deterministicLegacyId('product','P-001');
  const plan=window.PCMSOrderService.prepareImport({orderId:'ORDER-1',client:'客戶A',dueDate:'2026-09-01'},[
    {productId,quantity:100,po:'PO-A',color:'Red',description:'First',sourceRowId:2},
    {productId,quantity:200,po:'PO-B',color:'Blue',description:'Second',sourceRowId:3}
  ],{orderDocumentId:'ORDER-DOC-1'});
  assert.equal(plan.items.length,2);
  assert.equal(plan.items[0].productId,plan.items[1].productId);
  assert.notEqual(plan.items[0].orderItemId,plan.items[1].orderItemId);
  assert.equal(plan.items[1].po,'PO-B');
  assert.equal(plan.order.totalQty,300);
});

test('分批訂單匯入最後才讓訂單可見且操作紀錄同一交易完成',async()=>{
  const {window,db}=load();
  const productId=window.PCMSProductModel.deterministicLegacyId('product','P-001');
  const saved=await window.PCMSOrderService.importOrder({orderId:'ORDER-1',client:'客戶A',dueDate:'2026-09-01'},[
    {productId,quantity:100,sourceRowId:2},{productId,quantity:200,sourceRowId:3}
  ],{now:1000,fileName:'order.xlsx'});
  assert.equal(db.documents.get(`orders/${saved.id}`).importStatus,'ready');
  assert.equal([...db.documents.keys()].filter(key=>key.startsWith('orderItems/')).length,2);
  const operationLogId=`${saved.id}__orderImport`;
  const log=db.documents.get(`operationLogs/${operationLogId}`);
  const lockId=window.PCMSOrderService.prepareImport({orderId:'ORDER-1',client:'客戶A',dueDate:'2026-09-01'},[{productId,quantity:1}],{orderDocumentId:'x'}).lockId;
  assert.equal(log.status,'success');
  assert.equal(log.schemaVersion,2);
  assert.equal(log.operationLogId,operationLogId);
  assert.equal(db.documents.get(`orders/${saved.id}`).operationLogId,operationLogId);
  assert.equal(db.documents.get(`orderImportLocks/${lockId}`).status,'ready');
  assert.equal(db.documents.get(`orderImportLocks/${lockId}`).operationLogId,operationLogId);
});
