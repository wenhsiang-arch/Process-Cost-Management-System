import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  applyMigrationPlan,assertMigrationPlanIntegrity,buildMigrationPlan,createMemoryRepository,deterministicLegacyId,inventoryRepository,
  FORMAL_DOCUMENT_KEYS,legacySourceKey,migrationCompletionLogId,safeProductCodeKey,validateRepository,withEmulatorRepository
} from '../tools/product-master-migration/shared.mjs';
import {
  FORMAL_CAPTURE_COLLECTIONS,FORMAL_MAINTENANCE_CONFIRMATION,FORMAL_MAINTENANCE_ROLES,FORMAL_PROJECT_ID,
  FORMAL_WRITE_CONFIRMATION,captureFormalSnapshot,encodeFirestoreFields,verifyFormalSnapshot
} from '../tools/product-master-migration/formal-capture.mjs';
import {applyFormalSnapshot} from '../tools/product-master-migration/formal-apply.mjs';

const now=1787500800000;
const assertExactKeys=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
const fixture=()=>({
  products:[{id:'ABC123',code:'ABC123',client:'客戶甲',zh:'手套',vi:'Găng tay',sz:'M',ops:[
    {no:'1',sortOrder:1,category:'SX',zh:'車縫',vi:'May',sec:60},
    {no:'2',sortOrder:2,category:'QC',zh:'檢查',vi:'Kiểm tra',sec:30}
  ]},{id:'DEF456',code:'DEF456',client:'客戶甲',zh:'手套大碼',vi:'Găng tay',sz:'L',ops:[
    {no:'1',sortOrder:1,category:'SX',zh:'車縫',vi:'May',sec:70}
  ]}],
  productGroups:[{id:'GROUP-OLD-1',groupId:'GROUP-OLD-1',name:'同款手套',memberCodes:['ABC123','DEF456'],active:true}],
  orders:[{id:'order-doc-1',orderId:'SO-001',client:'訂單客戶',dueDate:1788105600000,remark:'訂單備註'}],
  orderProcesses:[
    {id:'op-1a',orderId:'order-doc-1',orderNo:'SO-001',code:'ABC123',lineNumber:1,po:'PO-A',color:'紅',desc:'第一行',orderQty:100,processNo:'1'},
    {id:'op-2a',orderId:'order-doc-1',orderNo:'SO-001',code:'ABC123',lineNumber:1,po:'PO-A',color:'紅',desc:'第一行',orderQty:100,processNo:'2'},
    {id:'op-1b',orderId:'order-doc-1',orderNo:'SO-001',code:'ABC123',lineNumber:2,po:'PO-B',color:'藍',desc:'第二行',orderQty:80,processNo:'1'},
    {id:'op-2b',orderId:'order-doc-1',orderNo:'SO-001',code:'ABC123',lineNumber:2,po:'PO-B',color:'藍',desc:'第二行',orderQty:80,processNo:'2'}
  ],
  productionAttendance:[{id:'2026-08-23__E01',attendanceDate:'2026-08-23',employeeId:'E01',employeeName:'員工甲',department:'車縫',normalHours:8,overtimeHours:0}],
  productionEntries:[
    {id:'entry-1',productionDate:'2026-08-23',employeeId:'E01',employeeName:'員工甲',department:'車縫',orderProcessId:'op-1a',productCode:'ABC123',processNo:'1',quantity:60,createdAt:now},
    {id:'entry-2',productionDate:'2026-08-23',employeeId:'E01',employeeName:'員工甲',department:'車縫',orderProcessId:'op-2a',productCode:'ABC123',processNo:'2',quantity:70,createdAt:now+1},
    {id:'entry-3',productionDate:'2026-08-23',employeeId:'E01',employeeName:'員工甲',department:'車縫',orderProcessId:'op-1b',productCode:'ABC123',processNo:'1',quantity:40,createdAt:now+2}
  ]
});

function rawDocument(collection,id,data,sequence=0){
  const updateTime=new Date(now+sequence+1000).toISOString();
  return {name:`projects/${FORMAL_PROJECT_ID}/databases/(default)/documents/${collection}/${id}`,
    createTime:updateTime,updateTime,fields:encodeFirestoreFields(data)};
}
function formalSeed(options={}){
  const seed=fixture(),rawByCollection=new Map(),sequence={value:0};
  Object.entries(seed).forEach(([collection,rows])=>rawByCollection.set(collection,rows.map(({id,...data})=>
    rawDocument(collection,id,data,sequence.value++))));
  rawByCollection.set('rolePermissions',FORMAL_MAINTENANCE_ROLES.map(role=>rawDocument('rolePermissions',role,
    {role,active:options.activeRole===role,features:{}},sequence.value++)));
  if(options.existingProductIndex){
    const id=safeProductCodeKey('ABC123');
    rawByCollection.set('productCodeIndex',[rawDocument('productCodeIndex',id,{codeKey:id,code:'ABC123',legacy:true},sequence.value++)]);
  }
  const productsMeta=rawDocument('system','productsMeta',{version:'legacy',productCount:2},sequence.value++);
  return {rawByCollection,productsMeta};
}
function fakeFormalClient(seed){
  const calls={lists:[],gets:[],commits:[]};let writeSequence=0;
  const client={projectId:FORMAL_PROJECT_ID,databaseId:'(default)',calls,
    async listCollection(collection){ calls.lists.push(collection);return structuredClone(seed.rawByCollection.get(collection)||[]); },
    async getDocument(collection,id){
      calls.gets.push(`${collection}/${id}`);
      if(collection==='system'&&id==='productsMeta') return structuredClone(seed.productsMeta);
      return structuredClone((seed.rawByCollection.get(collection)||[]).find(item=>item.name.endsWith(`/${id}`))||null);
    },
    async findDocumentsByIds(collection,ids){
      calls.gets.push(`${collection}/targets:${ids.length}`);
      const requested=new Set(ids);
      const documents=(seed.rawByCollection.get(collection)||[]).filter(item=>requested.has(item.name.split('/').at(-1)));
      return {documents:structuredClone(documents),estimatedReads:Math.max(1,documents.length)};
    },
    async commit(writes){
      calls.commits.push(structuredClone(writes));
      return {writeResults:writes.map(()=>({updateTime:new Date(now+100000+(writeSequence++)).toISOString()}))};
    }};
  return client;
}
function createWorkspaceTempDirectory(){
  const testsRoot=path.resolve(process.cwd(),'tests'),directory=fs.mkdtempSync(path.join(testsRoot,'tmp-product-master-migration-'));
  if(!directory.startsWith(`${testsRoot}${path.sep}`)) throw new Error('測試暫存資料夾超出工作區。');
  fs.rmdirSync(directory); // 正式擷取必須從不存在的唯一目錄開始，測試也遵守相同防覆蓋條件。
  return directory;
}
function removeWorkspaceTempDirectory(directory){
  const testsRoot=path.resolve(process.cwd(),'tests'),resolved=path.resolve(directory);
  if(!resolved.startsWith(`${testsRoot}${path.sep}`)) throw new Error('拒絕清除工作區以外的測試資料夾。');
  fs.rmSync(resolved,{recursive:true,force:true});
}

test('轉換工具的固定識別碼與正式款號模型完全一致',()=>{
  const source=new URL('../js/product-model.js',import.meta.url);
  const context={window:{},TextEncoder,crypto:globalThis.crypto,BigInt,encodeURIComponent,decodeURIComponent,
    String,Number,Math,Date,Array,Object,Set,Map,JSON,RegExp,Error};
  vm.createContext(context);vm.runInContext(fs.readFileSync(source,'utf8'),context);
  const key=legacySourceKey('products','ABC123');
  assert.equal(deterministicLegacyId('product',key),context.window.PCMSProductModel.deterministicLegacyId('product',key));
});

test('同款號多行訂單可唯一轉換，產能只保存固定身分',async()=>{
  const repository=createMemoryRepository(fixture());
  const {source}=await inventoryRepository(repository),plan=buildMigrationPlan(source,{now});
  assert.equal(plan.exceptions.length,0);
  assert.equal(plan.manifest.orderItemCount,2);
  assert.ok(plan.mappings.length>0);
  assert.equal(plan.writes.filter(write=>write.collection==='productMasterLegacyMappings').length,0);
  assert.equal(plan.writes.filter(write=>write.collection==='operationLogs').length,0);
  assert.equal(plan.writes.filter(write=>write.collection==='productHistory').length,2);
  await applyMigrationPlan(repository,plan,{batchSize:17});
  const entries=await repository.list('productionEntries');
  const first=entries.find(row=>row.id==='entry-1'),third=entries.find(row=>row.id==='entry-3');
  assert.match(first.productId,/^prd_/);assert.match(first.processId,/^prc_/);assert.match(first.orderItemId,/^oit_/);
  assert.notEqual(first.orderItemId,third.orderItemId);
  for(const key of ['productCode','processNo','processSecSnapshot','processNameZh']) assert.equal(key in first,false);
  assert.equal((await repository.get('orders','order-doc-1')).client,'訂單客戶');
  assert.equal((await repository.get('orders','order-doc-1')).remark,'訂單備註');
  assert.equal((await repository.get('products','ABC123')).deleted,true);
  const products=(await repository.list('products')).filter(row=>row.deleted!==true);
  assert.equal(products.length,2);
  const product=products.find(row=>row.code==='ABC123'),{id:productDocumentId,...productData}=product;
  assertExactKeys(productData,FORMAL_DOCUMENT_KEYS.product);
  assertExactKeys(await repository.get('productCodeIndex',product.codeKey),FORMAL_DOCUMENT_KEYS.productCodeIndex);
  assertExactKeys(await repository.get('productHistory',product.historyId),FORMAL_DOCUMENT_KEYS.productHistory);
  const completionLogId=migrationCompletionLogId(plan.runId),completionLog=await repository.get('operationLogs',completionLogId);
  assert.equal(product.operationLogId,completionLogId);
  assertExactKeys(completionLog,FORMAL_DOCUMENT_KEYS.migrationOperationLog);
  assert.equal(completionLog.planHash,plan.planHash);
  assert.equal(completionLog.mappingCount,plan.mappings.length);
  assert.equal((await repository.list('operationLogs')).length,1);
  assertExactKeys(await repository.get('system','productsMeta'),FORMAL_DOCUMENT_KEYS.productsMeta);
  const groups=await repository.list('productGroups'),activeGroup=groups.find(row=>row.deleted!==true);
  assert.match(activeGroup.groupId,/^grp_/);assert.equal(activeGroup.memberProductIds.length,2);
  const {id:groupDocumentId,...groupData}=activeGroup;
  assertExactKeys(groupData,FORMAL_DOCUMENT_KEYS.productGroup);
  assert.equal(activeGroup.operationLogId,completionLogId);
  assert.equal((await repository.get('productGroups','GROUP-OLD-1')).deleted,true);
  for(const productId of activeGroup.memberProductIds){
    const member=await repository.get('productGroupMembers',productId);
    assert.equal(member.groupId,activeGroup.groupId);assertExactKeys(member,FORMAL_DOCUMENT_KEYS.productGroupMember);
  }
  const order=await repository.get('orders','order-doc-1');
  assertExactKeys(order,FORMAL_DOCUMENT_KEYS.order);
  assertExactKeys(await repository.get('orderImportLocks',order.importLockId),FORMAL_DOCUMENT_KEYS.orderImportLock);
  assert.equal(order.operationLogId,completionLogId);
  const validation=await validateRepository(repository);
  assert.equal(validation.ok,true,validation.errors.join('\n'));
});

test('正式資料批次與檢查點同成同敗，驗證也會拒絕轉換標記混入主檔',async()=>{
  const base=createMemoryRepository(fixture()),commits=[];
  const repository={
    list:name=>base.list(name),get:(name,id)=>base.get(name,id),dump:()=>base.dump(),
    async commit(writes){ commits.push(writes.map(write=>({collection:write.collection,id:write.id})));await base.commit(writes); }
  };
  const plan=buildMigrationPlan((await inventoryRepository(repository)).source,{now});
  await applyMigrationPlan(repository,plan,{batchSize:1});
  const product=(await repository.list('products')).find(row=>row.deleted!==true&&row.code==='ABC123');
  const productCommit=commits.find(batch=>batch.some(write=>write.collection==='products'&&write.id===product.id));
  assert.ok(productCommit.some(write=>write.collection==='productCodeIndex'&&write.id===product.codeKey));
  assert.ok(productCommit.some(write=>write.collection==='productHistory'&&write.id===product.historyId));
  assert.ok(productCommit.some(write=>write.collection==='productMasterMigrationRuns'&&write.id===plan.runId));
  const metadata=await repository.get('system','productsMeta');
  const metadataCommit=commits.find(batch=>batch.some(write=>write.collection==='system'&&write.id==='productsMeta'));
  assert.ok(metadataCommit.some(write=>write.collection==='products'&&write.id===metadata.lastProductId));
  const group=(await repository.list('productGroups')).find(row=>row.deleted!==true);
  const groupCommit=commits.find(batch=>batch.some(write=>write.collection==='productGroups'&&write.id===group.id));
  assert.ok(groupCommit.some(write=>write.collection==='productMasterMigrationRuns'&&write.id===plan.runId));
  assert.equal(group.memberProductIds.every(productId=>groupCommit.some(write=>write.collection==='productGroupMembers'&&write.id===productId)),true);
  const dataCommits=commits.filter(batch=>batch.some(write=>!['productMasterMigrationRuns','operationLogs'].includes(write.collection)));
  assert.equal(dataCommits.every(batch=>batch.some(write=>write.collection==='productMasterMigrationRuns'&&write.id===plan.runId)),true);
  assert.equal((await repository.list('operationLogs')).length,1);
  await repository.commit([{collection:'products',id:product.id,data:{migrationVersion:'不得出現在正式款號'},merge:true}]);
  const validation=await validateRepository(repository);
  assert.equal(validation.structurallyValid,false);
  assert.ok(validation.errors.some(error=>error.includes('含非正式欄位：migrationVersion')));
});

test('批次中斷後依檢查點續跑，完成後重跑不新增另一組身分',async()=>{
  const repository=createMemoryRepository(fixture());
  let inventory=await inventoryRepository(repository),plan=buildMigrationPlan(inventory.source,{now});
  await assert.rejects(()=>applyMigrationPlan(repository,plan,{batchSize:4,failAfterBatches:2}),/測試用批次中斷/);
  assert.equal((await repository.get('productMasterMigrationRuns',plan.runId)).completedBatches,2);
  inventory=await inventoryRepository(repository);plan=buildMigrationPlan(inventory.source,{now});
  const completed=await applyMigrationPlan(repository,plan,{batchSize:4});
  assert.equal(completed.status,'complete');
  const fixedBefore=(await repository.list('products')).filter(row=>row.deleted!==true).map(row=>row.id);
  inventory=await inventoryRepository(repository);plan=buildMigrationPlan(inventory.source,{now});
  const rerun=await applyMigrationPlan(repository,plan,{batchSize:4});
  assert.equal(rerun.alreadyComplete,true);
  assert.deepEqual((await repository.list('products')).filter(row=>row.deleted!==true).map(row=>row.id),fixedBefore);
});

test('缺少正式工序及無法分辨的相同訂單行只進入例外報告，不偷用訂單快照',async()=>{
  const data=fixture();
  data.products[0].ops=data.products[0].ops.filter(operation=>operation.no==='1');
  data.orderProcesses.push(
    {id:'amb-1',orderId:'order-doc-1',code:'ABC123',orderQty:50,processNo:'1'},
    {id:'amb-2',orderId:'order-doc-1',code:'ABC123',orderQty:50,processNo:'1'}
  );
  const repository=createMemoryRepository(data),{source}=await inventoryRepository(repository);
  const plan=buildMigrationPlan(source,{now});
  assert.ok(plan.exceptions.some(item=>item.reasonCode==='missing-product-master-process'));
  assert.ok(plan.exceptions.some(item=>item.reasonCode==='ambiguous-identical-order-lines'));
  assert.ok(plan.exceptions.every(item=>item.status==='unresolved'));
});

test('舊款號只移除標點時可唯一連結目前款號，不會建立另一個主檔身分',async()=>{
  const data=fixture();
  data.products[0].code='ABC123';
  data.orderProcesses.filter(row=>row.code==='ABC123').forEach(row=>{ row.code='ABC.123'; });
  data.productionEntries.forEach(row=>{ row.productCode='ABC.123'; });
  const plan=buildMigrationPlan((await inventoryRepository(createMemoryRepository(data))).source,{now});
  assert.equal(plan.exceptions.length,0);
  const productId=plan.writes.find(write=>write.collection==='products'&&write.data.code==='ABC123').data.productId;
  const itemWrites=plan.writes.filter(write=>write.collection==='orderItems');
  assert.ok(itemWrites.length>0);
  assert.ok(itemWrites.every(write=>write.data.productId===productId));
});

test('舊款號相差一字且名稱尺寸與全部工序唯一相符時可恢復固定身分',async()=>{
  const data=fixture();
  data.products[0].code='AQC123';
  data.productGroups[0].memberCodes=['AQC123','DEF456'];
  data.orderProcesses.forEach(row=>{
    const operation=data.products[0].ops.find(item=>String(item.no)===String(row.processNo));
    if(row.code==='ABC123') Object.assign(row,{zh:'手套',sz:'M',processZh:operation.zh,processVi:operation.vi,processSec:operation.sec});
  });
  const plan=buildMigrationPlan((await inventoryRepository(createMemoryRepository(data))).source,{now});
  assert.equal(plan.exceptions.length,0);
  const productId=plan.writes.find(write=>write.collection==='products'&&write.data.code==='AQC123').data.productId;
  assert.ok(plan.writes.filter(write=>write.collection==='orderItems').every(write=>write.data.productId===productId));
});

test('一字差異若仍有多個候選就保留例外，不以模糊規則替使用者選款號',async()=>{
  const data=fixture();
  data.products[0].code='AQC123';
  data.products.push({...structuredClone(data.products[0]),id:'ALT-CANDIDATE',code:'ADC123'});
  data.orderProcesses.forEach(row=>{
    const operation=data.products[0].ops.find(item=>String(item.no)===String(row.processNo));
    if(row.code==='ABC123') Object.assign(row,{zh:'手套',sz:'M',processZh:operation.zh,processVi:operation.vi,processSec:operation.sec});
  });
  const plan=buildMigrationPlan((await inventoryRepository(createMemoryRepository(data))).source,{now});
  assert.ok(plan.exceptions.some(item=>item.reasonCode==='ambiguous-order-product'));
});

test('工序號改變但名稱與秒數唯一一致時仍連結同一道正式工序',async()=>{
  const data=fixture();
  data.products[0].ops[0].no='9';
  data.orderProcesses.filter(row=>row.code==='ABC123'&&row.processNo==='1').forEach(row=>Object.assign(row,{
    processZh:'車縫',processVi:'May',processSec:60
  }));
  const plan=buildMigrationPlan((await inventoryRepository(createMemoryRepository(data))).source,{now});
  assert.equal(plan.exceptions.length,0);
  const productWrite=plan.writes.find(write=>write.collection==='products'&&write.data.code==='ABC123');
  const changedOperation=productWrite.data.ops.find(operation=>operation.no==='9');
  const entryWrites=plan.writes.filter(write=>write.collection==='productionEntries'
    &&['entry-1','entry-3'].includes(write.id));
  assert.equal(entryWrites.length,2);
  assert.ok(entryWrites.every(write=>write.data.processId===changedOperation.processId));
});

test('正式來源只讀一次便同步形成 Before Image、Hash、Manifest 與本機轉換計畫',async()=>{
  const directory=createWorkspaceTempDirectory();
  try{
    const client=fakeFormalClient(formalSeed({existingProductIndex:true}));
    const result=await captureFormalSnapshot(client,{projectId:FORMAL_PROJECT_ID,outputDirectory:directory,now,
      exclusiveAdminConfirmation:FORMAL_MAINTENANCE_CONFIRMATION});
    const verified=verifyFormalSnapshot(directory);
    assert.equal(verified.manifest.planHash,result.envelope.plan.planHash);
    assert.equal(verified.manifest.sourceDocumentCount,12);
    assert.equal(client.calls.lists.filter(name=>name==='rolePermissions').length,1);
    FORMAL_CAPTURE_COLLECTIONS.forEach(name=>assert.equal(client.calls.lists.filter(value=>value===name).length,1,`${name} 被重複讀取`));
    assert.ok(client.calls.gets.includes('system/productsMeta'));
    assert.ok(client.calls.gets.some(value=>value.startsWith('productCodeIndex/targets:')));
    assert.ok(client.calls.gets.some(value=>value.startsWith('productHistory/targets:')));
    assert.ok(client.calls.gets.some(value=>value.startsWith('operationLogs/targets:')));
    assert.equal(verified.envelope.preconditions['orders/order-doc-1'].exists,true);
    assert.equal(verified.envelope.preconditions['system/productsMeta'].exists,true);
    assert.equal(verified.envelope.preconditions[`productCodeIndex/${safeProductCodeKey('ABC123')}`].exists,true);
    assert.equal(verified.manifest.targetCollections.productCodeIndex.count,1);
    assert.equal(verified.envelope.preconditions[`productMasterMigrationRuns/${verified.envelope.plan.runId}`].exists,false);
    assert.equal(verified.envelope.preconditions[`operationLogs/${verified.envelope.plan.runId}__complete`].exists,false);
    assertMigrationPlanIntegrity(verified.envelope.plan);
  }finally{ removeWorkspaceTempDirectory(directory); }
});

test('正式套用只使用本機計畫，所有覆寫與新增均帶修改時間或不存在前置條件',async()=>{
  const directory=createWorkspaceTempDirectory();
  try{
    const seed=formalSeed(),captureClient=fakeFormalClient(seed);
    const captured=await captureFormalSnapshot(captureClient,{projectId:FORMAL_PROJECT_ID,outputDirectory:directory,now,
      exclusiveAdminConfirmation:FORMAL_MAINTENANCE_CONFIRMATION});
    const applyClient=fakeFormalClient(seed);
    const result=await applyFormalSnapshot(applyClient,directory,{confirmProject:FORMAL_PROJECT_ID,
      confirmPlanHash:captured.manifest.planHash,confirmWrite:FORMAL_WRITE_CONFIRMATION,
      exclusiveAdminConfirmation:FORMAL_MAINTENANCE_CONFIRMATION,batchSize:17});
    assert.equal(result.status,'complete');
    assert.deepEqual(applyClient.calls.lists,['rolePermissions']);
    assert.deepEqual(applyClient.calls.gets,[`productMasterMigrationRuns/${captured.envelope.plan.runId}`]);
    const allWrites=applyClient.calls.commits.flat();
    const orderWrite=allWrites.find(write=>write.update?.name.endsWith('/orders/order-doc-1'));
    const newItemWrite=allWrites.find(write=>write.update?.name.includes('/orderItems/'));
    const retiredProduct=allWrites.find(write=>write.update?.name.endsWith('/products/ABC123'));
    const completionLogWrite=allWrites.find(write=>write.update?.name.endsWith(`/operationLogs/${captured.envelope.plan.runId}__complete`));
    assert.ok(orderWrite.currentDocument.updateTime);
    assert.deepEqual(newItemWrite.currentDocument,{exists:false});
    assert.ok(retiredProduct.currentDocument.updateTime);
    assert.ok(retiredProduct.updateMask.fieldPaths.includes('deleted'));
    assert.equal(completionLogWrite.update.fields.planHash.stringValue,captured.manifest.planHash);
    assert.equal(completionLogWrite.update.fields.sourceHash.stringValue,captured.manifest.sourceHash);
  }finally{ removeWorkspaceTempDirectory(directory); }
});

test('維護狀態改變或 Before Image 被竄改時，正式套用在任何寫入前停止',async()=>{
  const directory=createWorkspaceTempDirectory();
  try{
    const seed=formalSeed(),captureClient=fakeFormalClient(seed);
    const captured=await captureFormalSnapshot(captureClient,{projectId:FORMAL_PROJECT_ID,outputDirectory:directory,now,
      exclusiveAdminConfirmation:FORMAL_MAINTENANCE_CONFIRMATION});
    const changedSeed=formalSeed();
    changedSeed.rawByCollection.get('rolePermissions')[0].updateTime=new Date(now+999999).toISOString();
    const changedClient=fakeFormalClient(changedSeed);
    await assert.rejects(()=>applyFormalSnapshot(changedClient,directory,{confirmProject:FORMAL_PROJECT_ID,
      confirmPlanHash:captured.manifest.planHash,confirmWrite:FORMAL_WRITE_CONFIRMATION,
      exclusiveAdminConfirmation:FORMAL_MAINTENANCE_CONFIRMATION}),/維護狀態.*曾變更/);
    assert.equal(changedClient.calls.commits.length,0);
    const productsFile=path.join(directory,'before-image','products.jsonl');
    fs.appendFileSync(productsFile,'\n');
    assert.throws(()=>verifyFormalSnapshot(directory),/Before Image.*Hash 不一致/);
  }finally{ removeWorkspaceTempDirectory(directory); }
});

test('Firestore Emulator 可完成中斷、續跑、驗證及重跑',{
  skip:!process.env.FIRESTORE_EMULATOR_HOST||!process.env.PCMS_FIREBASE_TOOLS_ROOT
},async()=>{
  await withEmulatorRepository(async repository=>{
    const seed=createMemoryRepository(fixture()).dump();
    for(const [collection,rows] of Object.entries(seed)){
      if(rows.length) await repository.commit(rows.map(({id,...data})=>({collection,id,data})));
    }
    let inventory=await inventoryRepository(repository),plan=buildMigrationPlan(inventory.source,{now});
    await assert.rejects(()=>applyMigrationPlan(repository,plan,{batchSize:5,failAfterBatches:1}),/測試用批次中斷/);
    inventory=await inventoryRepository(repository);plan=buildMigrationPlan(inventory.source,{now});
    await applyMigrationPlan(repository,plan,{batchSize:5});
    const validation=await validateRepository(repository);
    assert.equal(validation.ok,true,JSON.stringify({errors:validation.errors,warnings:validation.warnings,counts:validation.counts,
      exceptions:(await repository.list('productMasterMigrationExceptions')).map(item=>({sourceKey:item.sourceKey,reasonCode:item.reasonCode,detail:item.detail}))},null,2));
    const rerun=await applyMigrationPlan(repository,buildMigrationPlan((await inventoryRepository(repository)).source,{now}),{batchSize:5});
    assert.equal(rerun.alreadyComplete,true);
  },{projectId:'demo-pcms-product-master-migration-tests',clear:true});
});
