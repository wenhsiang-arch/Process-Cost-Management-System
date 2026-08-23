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
  const moved=result.merged.ops.find(item=>item.processId===base.ops[0].processId);
  assert.equal(moved.processId,base.ops[0].processId);
  assert.equal(moved.no,'7');
  assert.equal(moved.sec,50);
  assert.equal(result.plan.deletes.length,1);
});

test('工序號就是排序，移到已存在位置會順移並保留全部固定身分',()=>{
  const {PCMSProductModel:model}=load();
  const operations=['A','B','C'].map((key,index)=>({
    processId:model.deterministicLegacyId('process',key),no:String(index+1),sortOrder:index+1,category:'SX',zh:key,vi:key,sec:10
  }));
  const moved=model.moveOperation(operations,operations[2].processId,2);
  assert.deepEqual(Array.from(moved,item=>item.zh),['A','C','B']);
  assert.deepEqual(Array.from(moved,item=>item.no),['1','2','3']);
  assert.deepEqual(Array.from(moved,item=>item.sortOrder),[1,2,3]);
  assert.deepEqual(new Set(moved.map(item=>item.processId)),new Set(operations.map(item=>item.processId)));
});

test('群組差異會分別標示工序數量、越文描述及標準秒數，僅供提醒',()=>{
  const {PCMSProductModel:model}=load();
  const productId=index=>model.deterministicLegacyId('product',`GROUP-${index}`);
  const products=[
    {...sourceProduct,productId:productId(1),code:'P1'},
    {...sourceProduct,productId:productId(2),code:'P2',ops:sourceProduct.ops.map((item,index)=>index?item:{...item,vi:'May khác'})},
    {...sourceProduct,productId:productId(3),code:'P3',ops:sourceProduct.ops.map((item,index)=>index?item:{...item,sec:55})},
    {...sourceProduct,productId:productId(4),code:'P4',ops:sourceProduct.ops.slice(0,1)}
  ];
  const rows=model.compareGroupConsistency(products);
  assert.equal(rows.length,4);
  assert.equal(rows.some(item=>item.descriptionDifferent),true);
  assert.equal(rows.some(item=>item.secondsDifferent),true);
  assert.equal(rows.some(item=>item.countDifferent),true);
});

test('款號代碼修改會列入正式差異與預覽',()=>{
  const {PCMSProductModel:model}=load();
  assert.equal(model.compareProducts(sourceProduct,{...sourceProduct,code:'NEW-CODE'}).some(item=>item.field==='code'),true);
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

test('Excel 完整覆蓋保留同款號及同工序固定身分，並精確替代全部工序',()=>{
  const {PCMSProductMasterStore:store,PCMSProductModel:model}=load();
  const original={...sourceProduct,ops:Array.from({length:12},(_,index)=>({
    no:String(index+1),sortOrder:index+1,category:'SX',zh:`工序${index+1}`,vi:`Công đoạn ${index+1}`,sec:20+index
  }))};
  const current=store.prepareCreate(original,{
    actor,now:1000,sourceKey:'legacy.products.OVERWRITE',
    processSourceKeys:original.ops.map(item=>`legacy.process.${item.no}`)
  }).product;
  const incoming={...sourceProduct,client:'Khách mới',ops:Array.from({length:11},(_,index)=>({
    no:String(index+1),category:index===0?'QC':'SX',zh:`新工序${index+1}`,vi:`Công đoạn mới ${index+1}`,sec:30+index
  }))};
  const replacement=model.reconcileImportReplacement(current,incoming);
  assert.equal(replacement.productId,current.productId);
  assert.equal(replacement.ops.length,11);
  assert.equal(replacement.ops[0].processId,current.ops[0].processId);
  assert.equal(replacement.ops[10].processId,current.ops[10].processId);
  assert.equal(replacement.ops.some(item=>item.processId===current.ops[11].processId),false);
  const prepared=store.prepareImportReplacement({current,incoming,actor,now:2000});
  assert.equal(prepared.plan.product.ops.length,11);
  assert.equal(prepared.plan.product.revision,2);
  assert.equal(prepared.plan.product.operationLogId.endsWith('__productImport'),true);
});

test('Excel 新增工序只替新工序建立固定身分，原工序身分全部沿用',()=>{
  const {PCMSProductMasterStore:store}=load();
  const current=store.prepareCreate(sourceProduct,{
    actor,now:1000,sourceKey:'legacy.products.ADD',processSourceKeys:['legacy.process.ADD.1','legacy.process.ADD.2']
  }).product;
  const incoming={...sourceProduct,ops:[...sourceProduct.ops,{no:'3',category:'DG',zh:'包裝',vi:'Đóng gói',sec:20}]};
  const saved=store.prepareImportReplacement({current,incoming,actor,now:2000}).plan.product;
  assert.equal(saved.ops.length,3);
  assert.equal(saved.ops[0].processId,current.ops[0].processId);
  assert.equal(saved.ops[1].processId,current.ops[1].processId);
  assert.match(saved.ops[2].processId,/^prc_/);
  assert.notEqual(saved.ops[2].processId,current.ops[0].processId);
});
