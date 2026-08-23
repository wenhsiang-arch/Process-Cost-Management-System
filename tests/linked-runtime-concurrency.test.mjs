import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

class VersionedDatabase{
  constructor(){
    this.documents=new Map();
    this.versions=new Map();
    this.sequence=0;
    this.commitQueue=Promise.resolve();
    this.barrier=null;
    this.lastCollisionCount=0;
  }
  key(reference){ return `${reference.collection}/${reference.id}`; }
  set(collection,id,data){
    const key=`${collection}/${id}`;
    this.documents.set(key,clone(data));
    this.versions.set(key,(this.versions.get(key)||0)+1);
  }
  get(collection,id){ return clone(this.documents.get(`${collection}/${id}`)); }
  count(collection){ return [...this.documents.keys()].filter(key=>key.startsWith(`${collection}/`)).length; }
  snapshot(reference){
    const value=this.documents.get(this.key(reference));
    return {id:reference.id,ref:reference,exists:()=>value!==undefined,data:()=>clone(value)};
  }
  query(statement){
    const collection=typeof statement==='string'?statement:statement.collection;
    const filters=statement.filters||[];
    return [...this.documents.entries()]
      .filter(([key])=>key.startsWith(`${collection}/`))
      .map(([key,data])=>({id:key.slice(collection.length+1),data:clone(data)}))
      .filter(row=>filters.every(filter=>filter.op==='=='&&row.data?.[filter.field]===filter.value));
  }
  collideNextTransactions(participants=2){
    let release;
    const promise=new Promise(resolve=>{ release=resolve; });
    const barrier={participants,count:0,promise,release};
    barrier.timer=setTimeout(()=>{
      if(this.barrier===barrier) this.barrier=null;
      this.lastCollisionCount=barrier.count;
      barrier.release();
    },1000);
    this.barrier=barrier;
  }
  async waitAtBarrier(attempt){
    if(attempt!==0||!this.barrier) return;
    const barrier=this.barrier;
    barrier.count+=1;
    if(barrier.count>=barrier.participants){
      this.barrier=null;
      clearTimeout(barrier.timer);
      this.lastCollisionCount=barrier.count;
      barrier.release();
    }
    await barrier.promise;
  }
  async commit(readVersions,writes){
    const previous=this.commitQueue;
    let release;
    this.commitQueue=new Promise(resolve=>{ release=resolve; });
    await previous;
    try{
      const conflict=[...readVersions].some(([key,version])=>(this.versions.get(key)||0)!==version);
      if(conflict) return false;
      for(const write of writes){
        const key=this.key(write.reference);
        if(write.type==='delete') this.documents.delete(key);
        else{
          const before=this.documents.get(key)||{};
          this.documents.set(key,write.merge?{...clone(before),...clone(write.data)}:clone(write.data));
        }
        this.versions.set(key,(this.versions.get(key)||0)+1);
      }
      return true;
    }finally{ release(); }
  }
  async transaction(task){
    for(let attempt=0;attempt<6;attempt+=1){
      const reads=new Map();
      const writes=[];
      const transaction={
        get:async reference=>{
          const key=this.key(reference);
          reads.set(key,this.versions.get(key)||0);
          return this.snapshot(reference);
        },
        set:(reference,data,options)=>writes.push({type:'set',reference,data:clone(data),merge:options?.merge===true}),
        delete:reference=>writes.push({type:'delete',reference})
      };
      const result=await task(transaction);
      await this.waitAtBarrier(attempt);
      if(await this.commit(reads,writes)) return result;
    }
    const error=new Error('Giao dịch xung đột quá nhiều lần. / 交易衝突重試次數過多。');
    error.code='transaction-conflict';
    throw error;
  }
}

async function loadScenario({registeredQty=0}={}){
  const database=new VersionedDatabase();
  const window={firebaseAuthUser:{uid:'admin-user'},cu:{role:'admin',user:'管理員'},D:[],S:{ws:3000}};
  Object.assign(window,{
    _docRef:(collection,id)=>({collection,id}),
    _newDocRef:collection=>({collection,id:`generated-${++database.sequence}`}),
    _collection:collection=>collection,
    _where:(field,op,value)=>({field,op,value}),
    _query:(collection,...filters)=>({collection,filters}),
    _getDoc:reference=>Promise.resolve(database.snapshot(reference)),
    _getDocs:statement=>Promise.resolve({docs:database.query(statement).map(row=>({id:row.id,ref:{collection:statement.collection||statement,id:row.id},data:()=>clone(row.data)}))}),
    _runTransaction:task=>database.transaction(task),
    _writeBatch:()=>({set(){return this;},commit:async()=>true}),
    pcmsDataCache:{read:async()=>null,write:async()=>true,remove:async()=>true}
  });
  const context={window,TextEncoder,console,Date,Map,Set,Promise};
  vm.createContext(context);
  [
    'js/product-model.js','js/product-master-store.js','js/product-group-store.js','js/product-master-service.js',
    'js/product-resolver.js','js/order-item-store.js','js/production/efficiency-core.js',
    'js/production/linked-summary-store.js','js/production/linked-entry-store.js','js/order-service.js'
  ].forEach(path=>vm.runInContext(read(path),context));
  const product=await window.PCMSProductMasterService.createProduct({
    code:'P-001',client:'C1',zh:'產品',vi:'Sản phẩm',sz:'M',
    ops:[{no:'1',sortOrder:1,category:'SX',zh:'車縫',vi:'May',sec:60}]
  },{sourceKey:'concurrency.product',processSourceKeys:['concurrency.process'],now:1000});
  const processId=product.ops[0].processId;
  const orderItemId=window.PCMSProductModel.deterministicLegacyId('orderItem','concurrency.order.item');
  database.set('orders','ORDER-1',{orderId:'SO-001',client:'C1',totalQty:100,itemCount:1,
    importStatus:'ready',lifecycleStatus:'active',schemaVersion:2});
  database.set('orderItems',orderItemId,{orderItemId,orderId:'ORDER-1',productId:product.productId,quantity:100,
    lineNumber:1,po:'PO-1',color:'Blue',description:'Order line',active:true,revision:1,schemaVersion:2});
  database.set('productionMonths','2026-08',{month:'2026-08',status:'open',summaryReady:true,entriesVersion:'E1',
    attendanceVersion:'A1',summaryVersion:'S1',revision:1,updatedAt:1,updatedByUid:'admin-user',updatedBy:'管理員',schemaVersion:3});
  for(const employeeId of ['M001','M002']) database.set('productionAttendance',`2026-08-23__${employeeId}`,{
    attendanceDate:'2026-08-23',employeeId,employeeName:employeeId,department:'May',normalHours:8,overtimeHours:0,
    revision:1,updatedAt:1,updatedByUid:'admin-user',updatedBy:'管理員',schemaVersion:2
  });
  const totalId=window.PCMSOrderItemStore.processTotalId(orderItemId,processId);
  if(registeredQty>0) database.set('productionProcessTotals',totalId,{orderItemId,orderId:'ORDER-1',productId:product.productId,
    processId,orderQty:100,registeredQty,updatedAt:1,updatedByUid:'admin-user',lastMutation:'seed',lastDelta:registeredQty,
    lastEntryId:'seed',operationLogId:'seed',schemaVersion:2});
  const entry=({employeeId,quantity})=>({productionDate:'2026-08-23',employeeId,orderId:'ORDER-1',orderItemId,
    productId:product.productId,processId,processNo:'1',quantity});
  return {window,database,product,processId,orderItemId,totalId,entry};
}

test('兩名員工同時逼近同一工序上限時只有一筆成功且不超量',async()=>{
  const scenario=await loadScenario({registeredQty:90});
  scenario.database.collideNextTransactions(2);
  const results=await Promise.allSettled([
    scenario.window.PCMSProductionEntryStore.createEntry(scenario.entry({employeeId:'M001',quantity:10})),
    scenario.window.PCMSProductionEntryStore.createEntry(scenario.entry({employeeId:'M002',quantity:10}))
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(scenario.database.lastCollisionCount,2,results.map(result=>result.status==='rejected'?result.reason?.message:result.status).join(' | '));
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  assert.match(results.find(result=>result.status==='rejected').reason.message,/超過訂單數量/);
  assert.equal(scenario.database.get('productionProcessTotals',scenario.totalId).registeredQty,100);
  assert.equal(scenario.database.count('productionEntries'),1);
  assert.equal(scenario.database.count('operationLogs'),2); // 建立款號一筆、成功報工一筆。
});

test('訂單數量修改與報工同時發生時結果仍維持累計不超過訂單量',async()=>{
  const scenario=await loadScenario({registeredQty:80});
  scenario.database.collideNextTransactions(2);
  const current=scenario.database.get('orderItems',scenario.orderItemId);
  const results=await Promise.allSettled([
    scenario.window.PCMSProductionEntryStore.createEntry(scenario.entry({employeeId:'M001',quantity:10})),
    scenario.window.PCMSOrderService.updateItemQuantity(current,85,{reason:'並行驗收'})
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(scenario.database.lastCollisionCount,2,results.map(result=>result.status==='rejected'?result.reason?.message:result.status).join(' | '));
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  const total=scenario.database.get('productionProcessTotals',scenario.totalId).registeredQty;
  const quantity=scenario.database.get('orderItems',scenario.orderItemId).quantity;
  assert.ok(total<=quantity,`累計 ${total} 不得超過訂單量 ${quantity}`);
});

test('款號修改與報工同時發生時產能固定身分不變且最後解析最新主檔',async()=>{
  const scenario=await loadScenario();
  const draft=clone(scenario.product);
  draft.ops[0]={...draft.ops[0],no:'7',sec:50,vi:'May mới',zh:'新車縫'};
  scenario.database.collideNextTransactions(2);
  const [entryResult,productResult]=await Promise.all([
    scenario.window.PCMSProductionEntryStore.createEntry(scenario.entry({employeeId:'M001',quantity:10})),
    scenario.window.PCMSProductMasterService.saveDraft({base:scenario.product,draft,now:2000})
  ]);
  assert.equal(scenario.database.lastCollisionCount,2);
  assert.equal(productResult.productId,scenario.product.productId);
  assert.equal(productResult.ops[0].processId,scenario.processId);
  const raw=scenario.database.get('productionEntries',entryResult.id);
  assert.equal(raw.productId,scenario.product.productId);
  assert.equal(raw.processId,scenario.processId);
  for(const field of ['productCode','processNo','processSeconds','processNameVi']) assert.equal(Object.hasOwn(raw,field),false);
  scenario.window.PCMSProductionEntryStore.reset();
  const [display]=await scenario.window.PCMSProductionEntryStore.decorateEntries([{id:entryResult.id,...raw}]);
  assert.equal(display.processNo,'7');
  assert.equal(display.processSeconds,50);
  assert.equal(display.processNameVi,'May mới');
});

test('兩人同時修改同一款號欄位時不會發生 Lost Update',async()=>{
  const scenario=await loadScenario();
  const firstDraft={...clone(scenario.product),zh:'第一個名稱'};
  const secondDraft={...clone(scenario.product),zh:'第二個名稱'};
  scenario.database.collideNextTransactions(2);
  const results=await Promise.allSettled([
    scenario.window.PCMSProductMasterService.saveDraft({base:scenario.product,draft:firstDraft,now:2000}),
    scenario.window.PCMSProductMasterService.saveDraft({base:scenario.product,draft:secondDraft,now:2001})
  ]);
  assert.equal(scenario.database.lastCollisionCount,2);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const rejected=results.find(result=>result.status==='rejected');
  assert.equal(rejected.reason.code,'product-field-conflict');
  assert.ok(['第一個名稱','第二個名稱'].includes(scenario.database.get('products',scenario.product.productId).zh));
});
