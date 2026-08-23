import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

function load(counts={}){
  const queries=[];
  const window={
    _collection:name=>({name}),
    _where:(field,operator,value)=>({field,operator,value}),
    _query:(collection,...conditions)=>({collection,conditions}),
    _getCountFromServer:async query=>{
      const processId=query.conditions[0].value;
      queries.push(processId);
      return {data:()=>({count:Number(counts[processId]||0)})};
    }
  };
  const context={window,TextEncoder,console};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  vm.runInContext(read('js/product-import-impact.js'),context);
  return {window,queries};
}

function fixtures(model){
  const productId=model.deterministicLegacyId('product','impact-product');
  const first=model.deterministicLegacyId('process','impact-process-1');
  const second=model.deterministicLegacyId('process','impact-process-2');
  const existing={
    productId,revision:3,code:'P-IMPACT',client:'C1',zh:'舊產品',vi:'Sản phẩm cũ',sz:'M',
    ops:[
      {processId:first,no:'1',sortOrder:1,category:'SX',zh:'舊車縫',vi:'May cũ',sec:60,active:true},
      {processId:second,no:'2',sortOrder:2,category:'QC',zh:'舊檢查',vi:'Kiểm cũ',sec:30,active:true}
    ]
  };
  const incoming={
    code:'P-IMPACT',client:'C2',zh:'新產品',vi:'Sản phẩm mới',sz:'M',
    ops:[
      {no:'1',category:'SX',zh:'新車縫',vi:'May mới',sec:45},
      {no:'3',category:'DG',zh:'包裝',vi:'Đóng gói',sec:20}
    ]
  };
  return {existing,incoming,first,second};
}

test('影響預覽只計數既有固定工序，新工序不產生無意義讀取',async()=>{
  const prepared=load();
  const data=fixtures(prepared.window.PCMSProductModel);
  const counts={[data.first]:5,[data.second]:0};
  const {window,queries}=load(counts);
  const plan=window.PCMSProductImportImpact.buildPlan({
    newItems:[],sameItems:[],differentItems:[{existing:data.existing,incoming:data.incoming}]
  });
  const progress=[];
  await window.PCMSProductImportImpact.loadImpactCounts(plan,{concurrency:2,onProgress:item=>progress.push(item.completed)});
  assert.equal(plan.overwriteCount,1);
  assert.equal(plan.processChangeCount,3);
  assert.equal(plan.rows.length,3);
  assert.equal(plan.affectedEntryCount,5);
  assert.equal(plan.hasBlockingImpact,false);
  assert.deepEqual(new Set(queries),new Set([data.first,data.second]));
  assert.equal(progress.at(-1),2);
});
test('只有被移除且確有報工、又沒有相同工序號可承接時才阻止確認',async()=>{
  const prepared=load();
  const data=fixtures(prepared.window.PCMSProductModel);
  const {window}=load({[data.first]:5,[data.second]:2});
  const plan=window.PCMSProductImportImpact.buildPlan({
    newItems:[],sameItems:[],differentItems:[{existing:data.existing,incoming:data.incoming}]
  });
  await window.PCMSProductImportImpact.loadImpactCounts(plan);
  assert.equal(plan.hasBlockingImpact,true);
  assert.equal(plan.blockingRows.length,1);
  assert.equal(plan.blockingRows[0].processNo,'2');
  assert.equal(plan.blockingRows[0].impactCount,2);
});
