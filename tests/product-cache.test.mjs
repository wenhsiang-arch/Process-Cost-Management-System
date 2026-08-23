import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/product-cache.js',import.meta.url),'utf8'); // source（款號快取程式內容）
const context={window:{},localStorage:{removeItem(){}}}; // context（測試用瀏覽器環境）
vm.createContext(context);
vm.runInContext(source,context);
const cache=context.window.PCMSProductCache; // cache（款號快取工具）

test('planChanges（增量規劃）保留每個款號最後一次動作',()=>{
  const plan=cache.planChanges([
    {sequence:11,changedCodes:['A','B'],deletedCodes:[]},
    {sequence:12,changedCodes:['C'],deletedCodes:['A']},
    {sequence:13,changedCodes:['A'],deletedCodes:['B']}
  ],10);
  assert.equal(plan.valid,true);
  assert.equal(plan.sequence,13);
  assert.deepEqual(Array.from(plan.changedCodes).sort(),['A','C']);
  assert.deepEqual(Array.from(plan.deletedCodes),['B']);
});

test('planChanges（增量規劃）遇到缺少序號會要求完整重讀',()=>{
  const plan=cache.planChanges([{sequence:12,changedCodes:['A'],deletedCodes:[]}],10);
  assert.equal(plan.valid,false);
});

test('固定 productId 增量可跨款號改名更新同一份快取',()=>{
  const plan=cache.planChanges([
    {sequence:21,changedProductIds:['prd_product000001'],deletedProductIds:[]}
  ],20);
  assert.deepEqual(Array.from(plan.changedProductIds),['prd_product000001']);
  const result=cache.merge(
    [{productId:'prd_product000001',code:'OLD',ops:[]}],
    [{productId:'prd_product000001',code:'NEW',ops:[]}]
  );
  assert.deepEqual(Array.from(result,item=>item.code),['NEW']);
});

test('第三版版本提示只補讀緊接的一次異動，漏多版改用完整重讀',()=>{
  assert.deepEqual(
    {...cache.planLatestMetaChange(8,{schemaVersion:3,changeSequence:9,lastProductId:'prd_product000001',lastRevision:2})},
    {valid:true,sequence:9,productId:'prd_product000001',revision:2}
  );
  assert.equal(cache.planLatestMetaChange(8,{
    schemaVersion:3,changeSequence:10,lastProductId:'prd_product000001',lastRevision:3
  }).valid,false);
});

test('merge（款號合併）只更新變動款號並移除刪除款號',()=>{
  const result=cache.merge(
    [{code:'A',ops:[]},{code:'B',ops:[]}],
    [{code:'A',client:'新客人',ops:[{no:'1'}]},{code:'C',ops:[]}],
    ['B']
  );
  assert.deepEqual(Array.from(result,item=>item.code),['A','C']);
  assert.equal(result[0].client,'新客人');
  assert.equal(result[0].ops.length,1);
});
