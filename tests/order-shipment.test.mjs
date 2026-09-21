import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

class MemoryDb{
  constructor(){this.documents=new Map();this.ids=0;}
  key(ref){return `${ref.collection}/${ref.id}`;}
  snapshot(ref){const value=this.documents.get(this.key(ref));return {id:ref.id,exists:()=>value!==undefined,data:()=>clone(value),ref};}
  async transaction(task){
    const writes=[];
    const tx={get:async ref=>this.snapshot(ref),set:(ref,data,options)=>writes.push({ref,data,merge:options?.merge===true})};
    const value=await task(tx);
    writes.forEach(write=>{const key=this.key(write.ref);this.documents.set(key,write.merge?{...(this.documents.get(key)||{}),...clone(write.data)}:clone(write.data));});
    return value;
  }
  batch(){return {set(){},commit:async()=>{}};}
}

function load(){
  const db=new MemoryDb();
  const window={firebaseAuthUser:{uid:'manager-1'},cu:{user:'主管',role:'manager'},crypto:webcrypto};
  Object.assign(window,{
    _docRef:(collection,id)=>({collection,id}),_newDocRef:collection=>({collection,id:`log-${++db.ids}`}),
    _runTransaction:task=>db.transaction(task),_writeBatch:()=>db.batch()
  });
  const context={window,TextEncoder,console,Date};vm.createContext(context);
  ['js/product-model.js','js/order-item-store.js','js/order-service.js'].forEach(path=>vm.runInContext(read(path),context));
  return {window,db};
}

test('新匯入訂單預設為尚未出貨且保留使用中狀態',()=>{
  const {window}=load();
  const productId=window.PCMSProductModel.deterministicLegacyId('product','A-1');
  const plan=window.PCMSOrderService.prepareImport({orderId:'PO-1',client:'HUNTER',dueDate:'2026-09-30'},[
    {productId,quantity:10,sourceRowId:2}
  ],{orderDocumentId:'order-1'});
  assert.equal(plan.order.shipmentStatus,'pending');
  assert.equal(plan.order.actualShipDate,null);
  assert.equal(plan.order.lifecycleStatus,'active');
});

test('確認與取消出貨只改分類與日期，訂單仍保持使用中並留下操作紀錄',async()=>{
  const {window,db}=load();
  db.documents.set('orders/order-1',{
    schemaVersion:2,orderId:'PO-1',client:'HUNTER',dueDate:1,importLockId:'lock-1',itemCount:1,totalQty:10,
    importStatus:'ready',lifecycleStatus:'active',shipmentStatus:'pending',actualShipDate:null,
    createdAt:1,createdByUid:'importer',createdBy:'匯入者',updatedAt:1,updatedByUid:'importer'
  });
  const shipped=await window.PCMSOrderService.setShipmentStatus('order-1','shipped',{actualShipDate:'2026-09-22',now:2});
  assert.equal(shipped.lifecycleStatus,'active');
  assert.equal(shipped.shipmentStatus,'shipped');
  assert.equal(shipped.actualShipDate,new Date('2026-09-22').getTime());
  assert.equal(db.documents.get(`operationLogs/${shipped.operationLogId}`).action,'orderShipmentConfirm');
  const pending=await window.PCMSOrderService.setShipmentStatus('order-1','pending',{now:3});
  assert.equal(pending.lifecycleStatus,'active');
  assert.equal(pending.shipmentStatus,'pending');
  assert.equal(pending.actualShipDate,null);
  assert.equal(db.documents.get(`operationLogs/${pending.operationLogId}`).action,'orderShipmentCancel');
});

test('已出貨分頁依實際出貨日新到舊排列，只提供撤銷與 HUNTER 報告',()=>{
  const source=read('js/shipped-orders.js');
  const features=read('js/features.js');
  const html=read('index.html');
  assert.match(features,/page:'shipped-orders'[\s\S]*?onOpen:\['renderShippedOrders'\]/);
  assert.match(html,/id="pg-shipped-orders"/);
  assert.match(source,/Number\(b\.actualShipDate\)[\s\S]*Number\(a\.actualShipDate\)/);
  assert.match(source,/setShipmentStatus\(order\.id,'pending'/);
  assert.doesNotMatch(source,/openOrderDeleteWarning|Xóa \(Lưu trữ\)|刪除（封存）/);
  assert.match(source,/exportInspectionReportFromOrder/);
  assert.match(read('js/orders.js'),/openOrderDeleteWarning/);
});

test('安全規則限制出貨狀態與日期配對，並納入不可變操作紀錄',()=>{
  const rules=read('firestore.rules');
  assert.match(rules,/data\.shipmentStatus == 'pending'[\s\S]*data\.actualShipDate == null/);
  assert.match(rules,/data\.shipmentStatus == 'shipped'[\s\S]*data\.actualShipDate is number/);
  assert.match(rules,/orderShipmentConfirm/);
  assert.match(rules,/orderShipmentCancel/);
  assert.match(rules,/affectedKeys\(\)\.hasOnly\(\[[\s\S]*'shipmentStatus'/);
});
