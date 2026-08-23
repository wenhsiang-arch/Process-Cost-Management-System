import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

function load(){
  const context={window:{},TextEncoder,console,setTimeout,clearTimeout};
  vm.createContext(context);
  [
    'js/product-model.js','js/product-resolver.js','js/order-item-store.js','js/product-group-store.js',
    'js/production/efficiency-core.js'
  ].forEach(path=>vm.runInContext(read(path),context));
  return context.window;
}

function fixtures(model){
  const productId=model.deterministicLegacyId('product','product-A');
  const processId=model.deterministicLegacyId('process','product-A-process-1');
  return {
    productId,processId,
    product:{
      productId,code:'NEW-A',client:'Master Client',zh:'最新產品',vi:'Sản phẩm mới',sz:'L',active:true,
      ops:[{processId,no:'7',sortOrder:2,category:'SX',zh:'最新包邊',vi:'Viền mới',sec:50,active:true}]
    }
  };
}

test('未鎖定舊資料只按固定身分取得最新主檔，不使用舊文字與秒數快照',()=>{
  const window=load();
  const data=fixtures(window.PCMSProductModel);
  const legacyRow={
    id:'entry-1',productId:data.productId,processId:data.processId,orderId:'ORDER-1',orderItemId:'ITEM-1',quantity:100,
    productCode:'OLD-A',processNo:'3',processNameZh:'舊工序',processSecSnapshot:60,orderClient:'Order Client'
  };
  const result=window.PCMSProductResolver.resolveRows([legacyRow],[data.product],{
    efficiencyCore:window.PCMSProductionEfficiencyCore,workSeconds:3000
  });
  assert.equal(result.exceptions.length,0);
  assert.equal(result.rows[0].display.productCode,'NEW-A');
  assert.equal(result.rows[0].display.processNo,'7');
  assert.equal(result.rows[0].display.processNameZh,'最新包邊');
  assert.equal(result.rows[0].display.processSeconds,50);
  assert.equal(result.rows[0].display.hourlyCapacity,60);
  assert.equal(result.rows[0].source.orderClient,'Order Client');
});

test('找不到固定工序時列為例外，不退回舊 processNo 或秒數快照',()=>{
  const window=load();
  const data=fixtures(window.PCMSProductModel);
  const missingProcessId=window.PCMSProductModel.deterministicLegacyId('process','missing');
  const result=window.PCMSProductResolver.resolveRows([{
    productId:data.productId,processId:missingProcessId,processNo:'3',processSecSnapshot:60
  }],[data.product]);
  assert.equal(result.rows.length,0);
  assert.equal(result.exceptions.length,1);
  assert.equal(result.exceptions[0].code,'process-not-found');
});

test('Resolver 先去重 productId，並讓同一批同時查詢共用載入工作',async()=>{
  const window=load();
  const data=fixtures(window.PCMSProductModel);
  let calls=0;
  let requested=[];
  const resolver=window.PCMSProductResolver.create({
    loadProductsByIds:async ids=>{
      calls+=1;
      requested=ids;
      await new Promise(resolve=>setTimeout(resolve,5));
      return [data.product];
    }
  });
  const rows=[
    {productId:data.productId,processId:data.processId},
    {productId:data.productId,processId:data.processId}
  ];
  const [first,second]=await Promise.all([resolver.resolve(rows),resolver.resolve(rows)]);
  assert.equal(calls,1);
  assert.equal(requested.length,1);
  assert.equal(first.rows.length,2);
  assert.equal(second.rows.length,2);
});

test('同一訂單可有多行相同款號，每行固定 orderItemId 與訂單資料互相獨立',()=>{
  const window=load();
  const data=fixtures(window.PCMSProductModel);
  const options={sourceKey:'legacy.order.ORDER-1',sourceKeys:['legacy.row.10','legacy.row.11']};
  const rows=[
    {productId:data.productId,quantity:100,po:'PO-A',color:'Red',description:'First'},
    {productId:data.productId,quantity:200,po:'PO-B',color:'Blue',description:'Second'}
  ];
  const first=window.PCMSOrderItemStore.prepareOrderItems('ORDER-1',rows,options);
  const repeated=window.PCMSOrderItemStore.prepareOrderItems('ORDER-1',rows,options);
  assert.equal(first.length,2);
  assert.equal(first[0].productId,first[1].productId);
  assert.notEqual(first[0].orderItemId,first[1].orderItemId);
  assert.equal(first[0].orderItemId,repeated[0].orderItemId);
  assert.equal(first[0].po,'PO-A');
  assert.equal(first[1].po,'PO-B');
  assert.equal('productCode' in first[0],false);
  assert.equal('processes' in first[0],false);
});

test('訂單量不得降到任一道工序已完成數量以下',()=>{
  const window=load();
  const data=fixtures(window.PCMSProductModel);
  const item=window.PCMSOrderItemStore.prepareOrderItems('ORDER-1',[{productId:data.productId,quantity:200}],{
    sourceKeys:['legacy.row.1']
  })[0];
  const otherProcessId=window.PCMSProductModel.deterministicLegacyId('process','other-process');
  const totals=[
    {orderItemId:item.orderItemId,processId:data.processId,registeredQty:120},
    {orderItemId:item.orderItemId,processId:otherProcessId,registeredQty:80}
  ];
  assert.throws(()=>window.PCMSOrderItemStore.validateQuantityChange(item,100,totals),/120/);
  assert.equal(window.PCMSOrderItemStore.validateQuantityChange(item,150,totals).quantity,150);
});

test('款號群組只以 productId 保存成員，不保存正式款號內容',()=>{
  const window=load();
  const first=fixtures(window.PCMSProductModel).productId;
  const second=window.PCMSProductModel.deterministicLegacyId('product','product-B');
  const group=window.PCMSProductGroupStore.normalizeGroup({name:'Nhóm A',memberProductIds:[first,second]},
    {sourceKey:'legacy.group.1'});
  const indexes=window.PCMSProductGroupStore.memberIndexDocuments(group);
  assert.equal(group.memberProductIds.join(','),`${first},${second}`);
  assert.equal(indexes.length,2);
  assert.deepEqual(Object.keys(indexes[0].data).sort(),['groupId','productId']);
});
