import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

function load(){
  const context={window:{firebaseAuthUser:null,cu:null},TextEncoder,console};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  vm.runInContext(read('js/product-master-store.js'),context);
  return context.window;
}

const actor={uid:'admin-1',name:'Quản trị / 管理員'};
const sourceProduct={
  code:'Ab-001',client:'Khách A',zh:'產品甲',vi:'Sản phẩm A',sz:'M',
  ops:[
    {no:'1',sortOrder:1,category:'SX',zh:'車縫',vi:'May',sec:60},
    {no:'2',sortOrder:2,category:'QC',zh:'檢查',vi:'Kiểm tra',sec:30}
  ]
};

test('款號代碼使用 Unicode 正規化、大小寫不敏感安全索引且保留顯示格式',()=>{
  const {PCMSProductModel:model}=load();
  assert.equal(model.normalizeProductCode('  Ａb－００１  '),'Ab-001');
  assert.equal(model.productCodeComparisonKey('ab-001'),model.productCodeComparisonKey('ＡＢ－００１'));
  const safeKey=model.safeProductCodeKey('Ab-001/特殊');
  assert.match(safeKey,/^code_[A-Za-z0-9_-]+$/);
  assert.equal(model.productCodeFromSafeKey(safeKey),'AB-001/特殊');
  assert.throws(()=>model.normalizeProductCode('A\u0000B'),/控制字元/);
  assert.throws(()=>model.normalizeProductCode('A'.repeat(81)),/80/);
});

test('舊資料固定識別碼與對照、例外文件可安全重跑',()=>{
  const {PCMSProductModel:model}=load();
  const sourceKey=model.legacySourceKey('products','ABC-001');
  const first=model.deterministicLegacyId('product',sourceKey);
  const second=model.deterministicLegacyId('product',sourceKey);
  assert.equal(first,second);
  assert.notEqual(first,model.deterministicLegacyId('product',model.legacySourceKey('products','ABC-002')));
  const mapping=model.buildLegacyMapping({sourceType:'product',sourceKey,targetKind:'product',targetId:first});
  const repeated=model.buildLegacyMapping({sourceType:'product',sourceKey,targetKind:'product',targetId:first});
  assert.equal(mapping.mappingId,repeated.mappingId);
  assert.equal(mapping.targetId,first);
  const exception=model.buildMigrationException({sourceType:'process',sourceKey,reasonCode:'ambiguous-process',candidateIds:['b','a','a']});
  assert.equal(exception.candidateIds.join(','),'a,b');
  assert.equal(exception.status,'unresolved');
});

test('建立款號時固定 productId 與 processId，重跑相同舊來源不會產生第二組身分',()=>{
  const {PCMSProductMasterStore:store}=load();
  const options={actor,now:1000,sourceKey:'legacy.products.ABC-001',processSourceKeys:['legacy.process.1','legacy.process.2']};
  const first=store.prepareCreate(sourceProduct,options);
  const repeated=store.prepareCreate(sourceProduct,options);
  assert.equal(first.product.productId,repeated.product.productId);
  assert.equal(first.product.ops.map(item=>item.processId).join(','),repeated.product.ops.map(item=>item.processId).join(','));
  assert.equal(first.atomic,true);
  assert.equal(first.writes.some(write=>write.collection==='operationLogs'),true);
  assert.equal(first.writes.some(write=>write.collection==='productCodeIndex'),true);
  assert.equal(first.product.revision,1);
});

test('兩人修改不同欄位可合併，固定身分不因代碼、名稱或工序內容改變',()=>{
  const {PCMSProductMasterStore:store}=load();
  const base=store.prepareCreate(sourceProduct,{
    actor,now:1000,sourceKey:'legacy.products.ABC-001',processSourceKeys:['legacy.process.1','legacy.process.2']
  }).product;
  const current={...base,client:'Khách B',revision:2,updatedAt:1100,updatedByUid:'other'};
  const draft={...base,code:'NEW-001',zh:'產品新版',ops:base.ops.map((operation,index)=>index===0?{...operation,no:'7',sec:50}:operation)};
  const result=store.prepareUpdate({base,current,draft,actor,now:1200});
  assert.equal(result.hasConflicts,false);
  assert.equal(result.merged.client,'Khách B');
  assert.equal(result.merged.code,'NEW-001');
  assert.equal(result.merged.zh,'產品新版');
  assert.equal(result.merged.productId,base.productId);
  assert.equal(result.merged.ops[0].processId,base.ops[0].processId);
  assert.equal(result.merged.ops[0].no,'7');
  assert.equal(result.merged.ops[0].sec,50);
  assert.equal(result.plan.deletes.length,1);
});

test('兩人修改同一欄位時保留雲端值與草稿值並回報衝突',()=>{
  const {PCMSProductMasterStore:store}=load();
  const base=store.prepareCreate(sourceProduct,{
    actor,now:1000,sourceKey:'legacy.products.ABC-001',processSourceKeys:['legacy.process.1','legacy.process.2']
  }).product;
  const current={...base,zh:'雲端名稱',revision:2};
  const draft={...base,zh:'我的名稱'};
  const result=store.prepareUpdate({base,current,draft,actor,now:1200});
  assert.equal(result.hasConflicts,true);
  assert.equal(result.plan,null);
  assert.equal(result.conflicts[0].path,'product.zh');
  assert.equal(result.conflicts[0].currentValue,'雲端名稱');
  assert.equal(result.conflicts[0].draftValue,'我的名稱');
});

test('同一道固定工序的相同欄位同時修改時只回報該欄位衝突',()=>{
  const {PCMSProductMasterStore:store}=load();
  const base=store.prepareCreate(sourceProduct,{
    actor,now:1000,sourceKey:'legacy.products.ABC-001',processSourceKeys:['legacy.process.1','legacy.process.2']
  }).product;
  const current={...base,revision:2,ops:base.ops.map((operation,index)=>index===0?{...operation,sec:55}:operation)};
  const draft={...base,ops:base.ops.map((operation,index)=>index===0?{...operation,sec:50}:operation)};
  const result=store.prepareUpdate({base,current,draft,actor,now:1200});
  assert.equal(result.hasConflicts,true);
  assert.equal(result.conflicts.length,1);
  assert.equal(result.conflicts[0].path,`process.${base.ops[0].processId}.sec`);
  assert.equal(result.conflicts[0].currentValue,55);
  assert.equal(result.conflicts[0].draftValue,50);
});

test('款號與既有工序不得透過共用儲存服務停用或移除',()=>{
  const {PCMSProductMasterStore:store}=load();
  const base=store.prepareCreate({...sourceProduct,active:false,ops:sourceProduct.ops.map(item=>({...item,active:false}))},{
    actor,now:1000,sourceKey:'legacy.products.ABC-001',processSourceKeys:['legacy.process.1','legacy.process.2']
  }).product;
  assert.equal(base.active,true);
  assert.equal(base.ops.every(item=>item.active===true),true);
  const inactiveDraft={...base,active:false,ops:base.ops.map((item,index)=>index===0?{...item,active:false}:item)};
  const inactive=store.prepareUpdate({base,current:base,draft:inactiveDraft,actor,now:1200});
  assert.equal(inactive.hasConflicts,false);
  assert.equal(inactive.merged.active,true);
  assert.equal(inactive.merged.ops[0].active,true);
  const removed=store.prepareUpdate({base,current:base,draft:{...base,ops:[base.ops[0]]},actor,now:1201});
  assert.equal(removed.hasConflicts,true);
  assert.equal(removed.conflicts[0].reason,'process-removal-requires-reference-check');
});
