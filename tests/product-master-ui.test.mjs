import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

function loadQuickEdit(){
  const context={window:{},TextEncoder,console};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  vm.runInContext(read('js/product-quick-edit.js'),context);
  return context.window;
}

function products(model){
  const first=model.deterministicLegacyId('product','P1');
  const second=model.deterministicLegacyId('product','P2');
  const third=model.deterministicLegacyId('product','P3');
  return [
    {productId:first,code:'P1',client:'C',zh:'一',vi:'Một',sz:'S',ops:[{processId:model.deterministicLegacyId('process','P1-1'),no:'1',sortOrder:1,category:'SX',zh:'車',vi:'May',sec:60}]},
    {productId:second,code:'P2',client:'C',zh:'二',vi:'Hai',sz:'M',ops:[{processId:model.deterministicLegacyId('process','P2-1'),no:'1',sortOrder:1,category:'SX',zh:'車',vi:'May',sec:55}]},
    {productId:third,code:'P3',client:'C',zh:'三',vi:'Ba',sz:'L',ops:[{processId:model.deterministicLegacyId('process','P3-2'),no:'2',sortOrder:1,category:'QC',zh:'檢',vi:'Kiểm',sec:30}]}
  ];
}

test('群組快速修改預設全選，找不到相同工序號的款號不猜測且預設不選',()=>{
  const window=loadQuickEdit();
  const rows=products(window.PCMSProductModel);
  const group={memberProductIds:rows.map(item=>item.productId)};
  const targets=window.PCMSProductQuickEdit.buildTargets({
    field:'processSeconds',sourceProductId:rows[0].productId,sourceProcessId:rows[0].ops[0].processId,products:rows,group
  });
  assert.equal(targets.length,3);
  assert.equal(targets[0].selected,true);
  assert.equal(targets[1].selected,true);
  assert.equal(targets[2].matched,false);
  assert.equal(targets[2].selected,false);
});

test('款號代碼快速修改仍顯示全組，但每個款號保留自己的輸入值',()=>{
  const window=loadQuickEdit();
  const rows=products(window.PCMSProductModel);
  const targets=window.PCMSProductQuickEdit.buildTargets({
    field:'code',sourceProductId:rows[0].productId,products:rows,group:{memberProductIds:rows.map(item=>item.productId)}
  });
  assert.equal(targets.every(item=>item.selected),true);
  assert.equal(targets.map(item=>item.value).join(','),'P1,P2,P3');
});

test('快速修改與完整編輯只呼叫 Product Master Service，不保留工序優化或標準訂正模式',()=>{
  const quick=read('js/product-quick-edit.js');
  const editor=read('js/product-master-editor.js');
  const service=read('js/product-master-service.js');
  assert.match(quick,/PCMSProductMasterService/);
  assert.match(editor,/PCMSProductMasterService/);
  assert.match(service,/saveDraft/);
  for(const source of [quick,editor,service]){
    assert.doesNotMatch(source,/standardCorrection|processOptimization|標準錯誤訂正|工序優化/);
  }
});

test('款號總表與完整工序編輯不提供刪除或停用功能',()=>{
  const editor=read('js/product-master-editor.js');
  const store=read('js/product-master-store.js');
  const summary=read('js/summary.js');
  const page=read('index.html');
  assert.doesNotMatch(editor,/data-toggle-process|data-delete-process|checkProcessDeletion/);
  assert.doesNotMatch(summary,/summary-delete|function askDel\(|function confDel\(|productDeactivate/);
  assert.doesNotMatch(page,/id="m-del"|onclick="confDel\(\)"/);
  assert.doesNotMatch(store,/PRODUCT_FIELDS[^\n]*'active'/);
  assert.doesNotMatch(store,/PROCESS_FIELDS[^\n]*'active'/);
});

test('款號總表在新 Loader 載入後提供款號與工序各欄位快速入口及完整編輯',()=>{
  const summary=read('js/summary.js');
  assert.match(summary,/PCMSProductQuickEdit\.createTrigger/);
  assert.match(summary,/PCMSProductMasterEditor\.createButton/);
  ['code','client','zh','vi','sz','processNo','processSortOrder','processCategory','processNameZh','processNameVi','processSeconds']
    .forEach(field=>assert.match(summary,new RegExp(field)));
});

test('款號匯入的新流程共用 Product Master Service 並由每個款號交易保存操作紀錄',()=>{
  const data=read('js/data.js');
  const service=read('js/product-master-service.js');
  assert.match(data,/PCMSProductMasterService\.importProducts/);
  assert.match(service,/action:'productImport'/);
  assert.match(service,/COLLECTIONS\.logs/);
  assert.match(service,/transaction\.set\(window\._docRef\(store\(\)\.COLLECTIONS\.logs/);
});
