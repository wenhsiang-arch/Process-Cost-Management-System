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
  set(collection,id,data){this.documents.set(`${collection}/${id}`,clone(data));}
  get(collection,id){return clone(this.documents.get(`${collection}/${id}`));}
  snapshot(ref){const value=this.documents.get(this.key(ref));return {id:ref.id,ref,exists:()=>value!==undefined,data:()=>clone(value)};}
  async transaction(task){
    const writes=[];
    const tx={get:async ref=>this.snapshot(ref),set:(ref,data,options)=>writes.push({type:'set',ref,data:clone(data),merge:options?.merge===true}),delete:ref=>writes.push({type:'delete',ref})};
    const result=await task(tx);
    for(const write of writes){const key=this.key(write.ref);if(write.type==='delete')this.documents.delete(key);else this.documents.set(key,write.merge?{...(this.documents.get(key)||{}),...write.data}:write.data);}
    return result;
  }
  query(statement){
    const collection=typeof statement==='string'?statement:statement.collection;
    const rows=[...this.documents.entries()].filter(([key])=>key.startsWith(`${collection}/`)).map(([key,data])=>({id:key.slice(collection.length+1),data}));
    const filters=statement.filters||[];
    return rows.filter(row=>filters.every(filter=>filter.op==='=='&&row.data?.[filter.field]===filter.value));
  }
}

function load(){
  const db=new MemoryDb();
  const window={firebaseAuthUser:{uid:'clerk'},cu:{role:'clerk',user:'文員'},S:{ws:3000}};
  Object.assign(window,{
    _docRef:(collection,id)=>({collection,id}),_newDocRef:collection=>({collection,id:`entry-${++db.ids}`}),
    _collection:collection=>collection,_where:(field,op,value)=>({field,op,value}),
    _query:(collection,...filters)=>({collection,filters}),_getDoc:async ref=>db.snapshot(ref),
    _getDocs:async statement=>({docs:db.query(statement).map(row=>({id:row.id,ref:{collection:typeof statement==='string'?statement:statement.collection,id:row.id},data:()=>clone(row.data)}))}),
    _runTransaction:task=>db.transaction(task)
  });
  const context={window,TextEncoder,console,Date,Map,Set,Promise};vm.createContext(context);
  ['js/product-model.js','js/product-resolver.js','js/order-item-store.js','js/production/efficiency-core.js',
    'js/production/linked-summary-store.js','js/production/linked-entry-store.js']
    .forEach(path=>vm.runInContext(read(path),context));
  const model=window.PCMSProductModel;
  const productId=model.deterministicLegacyId('product','P-001');
  const processA=model.deterministicLegacyId('process','P-001-A');
  const processB=model.deterministicLegacyId('process','P-001-B');
  const itemA=model.deterministicLegacyId('orderItem','ORDER-1-A');
  const itemB=model.deterministicLegacyId('orderItem','ORDER-1-B');
  db.set('products',productId,{code:'P-001',client:'Master',zh:'產品',vi:'Sản phẩm',sz:'M',active:true,ops:[
    {processId:processA,no:'1',sortOrder:1,category:'SX',zh:'車縫',vi:'May',sec:60,active:true},
    {processId:processB,no:'2',sortOrder:2,category:'QC',zh:'檢查',vi:'Kiểm',sec:30,active:true}
  ]});
  db.set('orders','ORDER-1',{orderId:'SO-001',client:'Order Client',dueDate:1788192000000,importStatus:'ready',lifecycleStatus:'active'});
  db.set('orderItems',itemA,{orderItemId:itemA,orderId:'ORDER-1',productId,quantity:100,lineNumber:1,po:'PO-A',color:'Red',active:true});
  db.set('orderItems',itemB,{orderItemId:itemB,orderId:'ORDER-1',productId,quantity:200,lineNumber:2,po:'PO-B',color:'Blue',active:true});
  db.set('productionMonths','2026-08',{month:'2026-08',status:'open',summaryReady:true,entriesVersion:'0',attendanceVersion:'A1',
    summaryVersion:'A1',revision:1,updatedAt:1,updatedByUid:'clerk',updatedBy:'文員',schemaVersion:3});
  for(const employee of ['M001','M002']) db.set('productionAttendance',`2026-08-23__${employee}`,{employeeName:employee,department:'May',normalHours:8,overtimeHours:0});
  return {window,db,ids:{productId,processA,processB,itemA,itemB}};
}

test('重複款號訂單項目在產能選擇中保持兩列，僅輸入款號時不得猜測',async()=>{
  const {window,ids}=load();
  const store=window.PCMSProductionEntryStore;
  await store.loadOrders();await store.loadProcesses('ORDER-1');
  const items=store.productsForOrder('ORDER-1');
  assert.equal(items.length,2);
  assert.equal(items[0].productId,items[1].productId);
  assert.notEqual(items[0].orderItemId,items[1].orderItemId);
  assert.equal(store.findProcess('ORDER-1','P-001','1'),null);
  assert.equal(store.findProcess('ORDER-1',ids.itemA,'1').processId,ids.processA);
});

test('同一訂單項目各工序分別限制累計，允許不同員工與多筆報工',async()=>{
  const {window,db,ids}=load();
  const store=window.PCMSProductionEntryStore;
  await store.loadOrders();await store.loadProcesses('ORDER-1');
  const base={productionDate:'2026-08-23',orderId:'ORDER-1',orderItemId:ids.itemA,productId:ids.productId};
  await store.createEntry({...base,employeeId:'M001',processId:ids.processA,processNo:'1',quantity:60});
  await store.createEntry({...base,employeeId:'M002',processId:ids.processA,processNo:'1',quantity:40});
  await store.createEntry({...base,employeeId:'M001',processId:ids.processB,processNo:'2',quantity:100});
  await assert.rejects(store.createEntry({...base,employeeId:'M001',processId:ids.processA,processNo:'1',quantity:1}),/超過訂單數量/);
  const totalA=db.get('productionProcessTotals',window.PCMSOrderItemStore.processTotalId(ids.itemA,ids.processA));
  const totalB=db.get('productionProcessTotals',window.PCMSOrderItemStore.processTotalId(ids.itemA,ids.processB));
  assert.equal(totalA.registeredQty,100);
  assert.equal(totalB.registeredQty,100);
  assert.match(totalA.lastEntryId,/^entry-/);
  assert.match(totalB.lastEntryId,/^entry-/);
  assert.match(totalA.operationLogId,/^peo_/);
  assert.equal([...db.documents.keys()].filter(key=>key.startsWith('productionEntries/')).length,3);
  assert.equal([...db.documents.keys()].filter(key=>key.startsWith('operationLogs/')).length,3);
  const day=db.get('productionDaySummaries','2026-08-23__M001');
  assert.equal(day.schemaVersion,3);
  assert.match(day.operationLogId,/^peo_/);
  assert.equal(day.processes.some(item=>Object.hasOwn(item,'processSecSnapshot')),false);
  const employeeMonth=db.get('productionEmployeeMonths','2026-08__M001');
  assert.equal(employeeMonth.summaryComplete,true);
  assert.equal(employeeMonth.operationLogId,day.operationLogId);
  assert.equal(db.get('productionMonths','2026-08').operationLogId,day.operationLogId);
});

test('未鎖定產能文件不複製款號與工序文字，顯示時使用最新主檔',async()=>{
  const {window,db,ids}=load();
  const store=window.PCMSProductionEntryStore;
  await store.loadOrders();await store.loadProcesses('ORDER-1');
  const saved=await store.createEntry({productionDate:'2026-08-23',employeeId:'M001',orderId:'ORDER-1',orderItemId:ids.itemA,
    productId:ids.productId,processId:ids.processA,processNo:'1',quantity:10});
  const raw=db.get('productionEntries',saved.id);
  for(const field of ['productCode','processNo','processNameVi','processNameZh','processSeconds','hourlyCapacity']){
    assert.equal(Object.hasOwn(raw,field),false,field);
  }
  const product=db.get('products',ids.productId);
  product.code='P-NEW';product.ops[0]={...product.ops[0],no:'7',vi:'May mới',zh:'新車縫',sec:50};
  db.set('products',ids.productId,product);
  store.refreshLoadedProcessStandards('ORDER-1');
  await store.loadProcesses('ORDER-1',{force:true});
  const [display]=await store.decorateEntries([{id:saved.id,...raw}]);
  assert.equal(display.productCode,'P-NEW');
  assert.equal(display.processNo,'7');
  assert.equal(display.processSeconds,50);
});

test('作廢產能會以新操作識別碼同批更新累計與日月摘要',async()=>{
  const {window,db,ids}=load();const store=window.PCMSProductionEntryStore;
  await store.loadOrders();await store.loadProcesses('ORDER-1');
  const saved=await store.createEntry({productionDate:'2026-08-23',employeeId:'M001',orderId:'ORDER-1',orderItemId:ids.itemA,
    productId:ids.productId,processId:ids.processA,processNo:'1',quantity:40});
  const voided=await store.voidEntry(saved.id,'測試作廢');
  const raw=db.get('productionEntries',saved.id);
  const total=db.get('productionProcessTotals',window.PCMSOrderItemStore.processTotalId(ids.itemA,ids.processA));
  const day=db.get('productionDaySummaries','2026-08-23__M001');
  assert.equal(voided.status,'voided');
  assert.equal(total.registeredQty,0);
  assert.equal(day.activeEntryCount,0);
  assert.match(raw.operationLogId,/__void__2$/);
  assert.equal(total.operationLogId,raw.operationLogId);
  assert.equal(day.operationLogId,raw.operationLogId);
  assert.ok(db.get('operationLogs',raw.operationLogId));
});
