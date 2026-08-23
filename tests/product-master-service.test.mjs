import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

class MemoryDatabase{
  constructor(){ this.documents=new Map(); }
  key(reference){ return `${reference.collection}/${reference.id}`; }
  snapshot(reference){
    const value=this.documents.get(this.key(reference));
    return {id:reference.id,exists:()=>value!==undefined,data:()=>clone(value)};
  }
  async transaction(task){
    const writes=[];
    const transaction={
      get:async reference=>this.snapshot(reference),
      set:(reference,data,options)=>writes.push({type:'set',reference,data:clone(data),merge:options?.merge===true}),
      delete:reference=>writes.push({type:'delete',reference})
    };
    const result=await task(transaction);
    writes.forEach(write=>{
      const key=this.key(write.reference);
      if(write.type==='delete') this.documents.delete(key);
      else this.documents.set(key,write.merge?{...(this.documents.get(key)||{}),...write.data}:write.data);
    });
    return result;
  }
  get(collection,id){ return clone(this.documents.get(`${collection}/${id}`)); }
  count(collection){ return [...this.documents.keys()].filter(key=>key.startsWith(`${collection}/`)).length; }
}

function load(){
  const database=new MemoryDatabase();
  const window={firebaseAuthUser:{uid:'admin-1'},cu:{role:'admin',user:'管理員'},D:[]};
  Object.assign(window,{
    _docRef:(collection,id)=>({collection,id}),
    _runTransaction:task=>database.transaction(task)
  });
  const context={window,TextEncoder,console};
  vm.createContext(context);
  ['js/product-model.js','js/product-master-store.js','js/product-group-store.js','js/product-master-service.js']
    .forEach(path=>vm.runInContext(read(path),context));
  return {window,database};
}

const product={
  code:'P-001',client:'C1',zh:'產品',vi:'Sản phẩm',sz:'M',
  ops:[{no:'1',category:'SX',zh:'車縫',vi:'May',sec:60}]
};

test('新增款號、固定索引、單款歷史、版本提示與操作紀錄在同一交易完成',async()=>{
  const {window,database}=load();
  const saved=await window.PCMSProductMasterService.createProduct(product,{
    sourceKey:'legacy.product.1',processSourceKeys:['legacy.process.1'],now:1000
  });
  assert.equal(database.get('products',saved.productId).code,'P-001');
  assert.equal(database.get('productCodeIndex',window.PCMSProductModel.safeProductCodeKey('p-001')).productId,saved.productId);
  assert.equal(database.count('productHistory'),1);
  assert.equal(database.count('productChanges'),0);
  assert.equal(database.count('operationLogs'),1);
  assert.equal(database.get('system','productsMeta').changeSequence,1);
  assert.equal(database.get('system','productsMeta').productCount,1);
  assert.equal(database.get('system','productsMeta').lastProductId,saved.productId);
  const log=database.get('operationLogs',saved.operationLogId);
  assert.equal(log.targetRevision,1);
  assert.equal(log.targetCodeKey,saved.codeKey);
  assert.equal(log.targetHistoryId,saved.historyId);
  assert.equal(log.freshnessSequence,1);
  assert.equal(log.schemaVersion,3);
  assert.equal(window.D[0].productId,saved.productId);
});

test('完整編輯與快速修改共用 saveDraft，但款號代碼不可修改且不產生任何寫入',async()=>{
  const {window,database}=load();
  const base=await window.PCMSProductMasterService.createProduct(product,{
    sourceKey:'legacy.product.1',processSourceKeys:['legacy.process.1'],now:1000
  });
  const draft={...base,code:'NEW-001',ops:base.ops.map(operation=>({...operation,sec:50}))};
  await assert.rejects(
    window.PCMSProductMasterService.saveDraft({base,draft,now:2000}),
    /Mã hàng không được phép sửa|款號代碼不得修改/
  );
  const saved=database.get('products',base.productId);
  assert.equal(saved.code,'P-001');
  assert.equal(saved.ops[0].sec,60);
  assert.equal(database.get('productCodeIndex',window.PCMSProductModel.safeProductCodeKey('P-001')).productId,base.productId);
  assert.equal(database.get('productCodeIndex',window.PCMSProductModel.safeProductCodeKey('new-001')),undefined);
  assert.equal(database.count('operationLogs'),1);
  assert.equal(database.get('system','productsMeta').changeSequence,1);
  assert.equal(database.get('system','productsMeta').productCount,1);
});

test('未修改款號代碼時不重寫代碼索引',async()=>{
  const {window,database}=load();
  const base=await window.PCMSProductMasterService.createProduct(product,{
    sourceKey:'legacy.product.1',processSourceKeys:['legacy.process.1'],now:1000
  });
  const codeKey=window.PCMSProductModel.safeProductCodeKey(base.code);
  await window.PCMSProductMasterService.saveDraft({base,draft:{...base,client:'C2'},now:2000});
  assert.equal(database.get('productCodeIndex',codeKey).updatedAt,1000);
  assert.equal(database.count('productChanges'),0);
});

test('同欄位衝突不寫入 Product 或操作紀錄並回傳雙方內容',async()=>{
  const {window,database}=load();
  const base=await window.PCMSProductMasterService.createProduct(product,{
    sourceKey:'legacy.product.1',processSourceKeys:['legacy.process.1'],now:1000
  });
  database.documents.set(`products/${base.productId}`,{...database.get('products',base.productId),zh:'雲端名稱',revision:2});
  await assert.rejects(
    window.PCMSProductMasterService.saveDraft({base,draft:{...base,zh:'我的名稱'},now:2000}),
    error=>error.code==='product-field-conflict'&&error.conflicts[0].currentValue==='雲端名稱'
  );
  assert.equal(database.get('products',base.productId).zh,'雲端名稱');
  assert.equal(database.count('operationLogs'),1);
});

test('匯入覆蓋在單款交易內完整替代工序並同時建立歷史與操作紀錄',async()=>{
  const {window,database}=load();
  const base=await window.PCMSProductMasterService.createProduct({...product,ops:[
    {no:'1',category:'SX',zh:'車縫',vi:'May',sec:60},
    {no:'2',category:'QC',zh:'檢查',vi:'Kiểm',sec:30}
  ]},{sourceKey:'legacy.product.replace',processSourceKeys:['legacy.process.replace.1','legacy.process.replace.2'],now:1000});
  const firstProcessId=base.ops[0].processId;
  const removedProcessId=base.ops[1].processId;
  const progress=[];
  const result=await window.PCMSProductMasterService.importProducts([{
    mode:'replace',existing:base,incoming:{...product,code:'p-001',client:'C2',ops:[
      {no:'1',category:'SX',zh:'新車縫',vi:'May mới',sec:45},
      {no:'3',category:'DG',zh:'包裝',vi:'Đóng gói',sec:20}
    ]}
  }],{fileName:'products.xlsx',onProgress:item=>progress.push(item.phase)});
  assert.equal(result.failures.length,0);
  const saved=result.successes[0].product;
  assert.equal(saved.productId,base.productId);
  assert.equal(saved.code,base.code);
  assert.equal(saved.client,'C2');
  assert.equal(saved.ops.length,2);
  assert.equal(saved.ops[0].processId,firstProcessId);
  assert.equal(saved.ops.some(item=>item.processId===removedProcessId),false);
  assert.match(saved.ops[1].processId,/^prc_/);
  assert.equal(database.count('productHistory'),2);
  assert.equal(database.count('operationLogs'),2);
  assert.equal(database.get('operationLogs',saved.operationLogId).action,'productImport');
  assert.deepEqual(progress,['start','complete']);
});

test('匯入遇到失敗款號立即停止並回報尚未處理數量',async()=>{
  const {window,database}=load();
  const result=await window.PCMSProductMasterService.importProducts([
    {mode:'create',incoming:{...product,code:'P-NEW'}},
    {mode:'create',incoming:{...product,code:'P-BAD',ops:[]}},
    {mode:'create',incoming:{...product,code:'P-NOT-RUN'}}
  ],{fileName:'products.xlsx'});
  assert.equal(result.successes.length,1);
  assert.equal(result.failures.length,1);
  assert.equal(result.remaining,1);
  assert.equal(database.get('productCodeIndex',window.PCMSProductModel.safeProductCodeKey('P-NOT-RUN')),undefined);
});

test('群組批次每個款號獨立成功或失敗，失敗不會撤銷已成功項目',async()=>{
  const {window,database}=load();
  const first=await window.PCMSProductMasterService.createProduct(product,{
    sourceKey:'legacy.product.1',processSourceKeys:['legacy.process.1'],now:1000
  });
  const second=await window.PCMSProductMasterService.createProduct({...product,code:'P-002',sz:'L'},
    {sourceKey:'legacy.product.2',processSourceKeys:['legacy.process.2'],now:1001});
  const result=await window.PCMSProductMasterService.saveManyDrafts([
    {base:first,draft:{...first,client:'C2'}},
    {base:second,draft:{...second,code:'P-001'}}
  ]);
  assert.equal(result.successes.length,1);
  assert.equal(result.failures.length,1);
  assert.equal(database.get('products',first.productId).client,'C2');
  assert.equal(database.get('products',second.productId).code,'P-002');
});

test('群組與全部 productId 成員索引及操作紀錄同成同敗',async()=>{
  const {window,database}=load();
  const first=window.PCMSProductModel.deterministicLegacyId('product','P1');
  const second=window.PCMSProductModel.deterministicLegacyId('product','P2');
  const group=await window.PCMSProductMasterService.createGroup({name:'Nhóm A',memberProductIds:[first,second]},
    {sourceKey:'legacy.group.1',now:1000});
  assert.equal(database.get('productGroups',group.groupId).memberProductIds.length,2);
  assert.equal(database.get('productGroupMembers',first).groupId,group.groupId);
  assert.equal(database.get('productGroupMembers',second).groupId,group.groupId);
  assert.equal(database.count('operationLogs'),1);
  const groupDocument=database.get('productGroups',group.groupId);
  const groupLog=database.get('operationLogs',groupDocument.operationLogId);
  assert.equal(group.operationLogId,groupDocument.operationLogId);
  assert.equal(database.get('productGroupMembers',first).operationLogId,groupDocument.operationLogId);
  assert.equal(database.get('productGroupMembers',second).operationLogId,groupDocument.operationLogId);
  assert.equal(groupLog.operationLogId,groupDocument.operationLogId);
  assert.equal(groupLog.schemaVersion,2);
});
