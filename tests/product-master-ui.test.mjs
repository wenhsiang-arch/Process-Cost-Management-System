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

test('款號代碼不提供快速修改欄位，底層也拒絕建立改碼目標',()=>{
  const window=loadQuickEdit();
  const rows=products(window.PCMSProductModel);
  assert.equal(window.PCMSProductQuickEdit.FIELD_CONFIG.code,undefined);
  assert.equal(window.PCMSProductQuickEdit.allowed('code'),false);
  assert.throws(()=>window.PCMSProductQuickEdit.buildTargets({
    field:'code',sourceProductId:rows[0].productId,products:rows
  }),/Trường sửa nhanh không hợp lệ|快速修改欄位不正確/);
});

test('快速修改與完整編輯只呼叫 Product Master Service，不保留工序優化或標準訂正模式',()=>{
  const quick=read('js/product-quick-edit.js');
  const editor=read('js/product-master-editor.js');
  const service=read('js/product-master-service.js');
  assert.match(quick,/PCMSProductMasterService/);
  assert.match(editor,/PCMSProductQuickEdit/);
  assert.match(editor,/saveWithWorkflow/);
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

test('款號總表保留款號展開但不提供改碼，其他款號與工序欄位共用快速修改',()=>{
  const summary=read('js/summary.js');
  assert.match(summary,/PCMSProductQuickEdit\.createTrigger/);
  assert.match(summary,/PCMSProductMasterEditor\.createButton/);
  ['client','zh','vi','sz','processNo','processCategory','processNameZh','processNameVi','processSeconds']
    .forEach(field=>assert.match(summary,new RegExp(field)));
  assert.doesNotMatch(summary,/const fields=\{code:'code'/);
  assert.match(summary,/summary-code/);
  assert.doesNotMatch(summary,/data-product-quick-field="processSortOrder"/);
  assert.doesNotMatch(summary,/工序號／排序/);
});

test('完整編輯只顯示單一款號，欄位點擊共用群組面板並保留拖曳、預覽、進度與結果',()=>{
  const editor=read('js/product-master-editor.js');
  const quick=read('js/product-quick-edit.js');
  const groupUi=read('js/production/process-group-ui.js');
  assert.doesNotMatch(editor,/createMemberSelector|product-master-group-selection|selectedProducts/);
  assert.match(editor,/product-master-readonly-value/);
  assert.match(editor,/readonly:true/);
  assert.match(editor,/createQuickTrigger/);
  assert.match(editor,/keepPrevious:true/);
  assert.match(editor,/draggable=true/);
  assert.match(editor,/saveWithWorkflow/);
  assert.match(quick,/groupBySize/);
  assert.match(quick,/createPreviewBody/);
  assert.match(quick,/progressDialog/);
  assert.match(quick,/createResultBody/);
  assert.match(quick,/product-change-workflow-table/);
  assert.match(quick,/Thông tin mã hàng/);
  assert.match(quick,/Tên công đoạn Việt/);
  assert.match(quick,/Trước sửa/);
  assert.match(quick,/Sau sửa/);
  assert.match(quick,/Ảnh hưởng/);
  assert.match(quick,/request:clone\(request\)/);
  assert.match(quick,/product-quick-summary/);
  assert.match(quick,/Mã hàng chưa có nhóm/);
  assert.match(quick,/Bỏ qua và tiếp tục/);
  assert.match(quick,/openGroupCreation/);
  assert.match(quick,/candidatePlan/);
  assert.match(quick,/Mã khớp cao được chọn sẵn/);
  assert.match(quick,/runOpenPreparation/);
  assert.match(quick,/không cần bấm lại/);
  assert.match(quick,/Hiện tại:/);
  assert.match(quick,/Sau sửa:/);
  assert.match(quick,/Tổng số công đoạn/);
  assert.match(quick,/data-product-quick-expand/);
  assert.match(quick,/尚未選擇對應工序/);
  assert.match(quick,/沒有可選擇的工序/);
  assert.match(groupUi,/Khác số lượng công đoạn/);
  assert.match(groupUi,/Khác mô tả tiếng Việt/);
  assert.match(groupUi,/Khác giây tiêu chuẩn/);
  assert.match(groupUi,/data-process-member-expand/);
  assert.match(groupUi,/Không có mã cùng kích thước để so sánh/);
  assert.match(groupUi,/Có nhiều phiên bản · cần kiểm tra/);
});

test('生產登記款號維持只讀，工序號、工序名稱及秒數接到同一款號主檔快速修改流程',()=>{
  const entry=read('js/production/production-entry.js');
  const adapter=read('js/production/product-seconds-adapter.js');
  assert.match(entry,/PCMSQuickProductMaster\.createButton/);
  [/field:'processNo'/,/field:item\.processNameVi\?'processNameVi':'processNameZh'/]
    .forEach(pattern=>assert.match(entry,pattern));
  assert.doesNotMatch(entry,/field:\s*'code'/);
  assert.match(adapter,/if\(field==='code'\) return false/);
  assert.match(adapter,/loadForProduct/);
  assert.match(adapter,/activeOpenPromise/);
  assert.match(adapter,/runOpenPreparation/);
  assert.match(adapter,/Đang tải bảng mã hàng hiện tại/);
  assert.match(adapter,/Đang kiểm tra nhóm của mã hàng/);
  assert.doesNotMatch(adapter,/ProductGroupRuntime\?\.load\?\./);
});

test('完整編輯的結構儲存只建立目前款號一筆請求，既有欄位不再直接輸入',()=>{
  const editor=read('js/product-master-editor.js');
  assert.match(editor,/\{base:clone\(base\),draft,action:'productFullEdit'\}/);
  assert.doesNotMatch(editor,/data-product-field=|applyTemplate|buildRequests/);
  assert.match(editor,/newOperationRow/);
  assert.match(editor,/data-new-process|newProcess/);
});

test('共用群組修改樣式由三個入口共同載入，數量與工序號固定置中分隔',()=>{
  const productStyles=read('styles/features/products.css');
  const sharedStyles=read('styles/features/production-process-edit.css');
  const features=read('js/features.js');
  const components=read('js/ui-components.js');
  assert.doesNotMatch(productStyles,/\.product-quick-summary/);
  assert.match(sharedStyles,/product-quick-edit（款號主檔共用群組修改）/);
  assert.match(sharedStyles,/th\.is-process-count[\s\S]*text-align:center/);
  assert.match(sharedStyles,/th\.is-process-no[\s\S]*border-left/);
  assert.match(features,/styles:\['products','productionProcessEdit'\]/);
  assert.match(features,/styles:\['production','productionProcessEdit'\]/);
  assert.match(components,/keepPrevious:options\.keepPrevious===true/);
});

test('生產登記按款號載入群組最多兩筆文件，重複開啟不再完整讀取',async()=>{
  const context={window:{},document:{dispatchEvent:null},TextEncoder,console};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  vm.runInContext(read('js/product-group-store.js'),context);
  const model=context.window.PCMSProductModel;
  const first=model.deterministicLegacyId('product','LOOKUP-1');
  const second=model.deterministicLegacyId('product','LOOKUP-2');
  const groupId=model.deterministicLegacyId('group','LOOKUP-GROUP');
  context.window.D=[{productId:first,code:'P1',ops:[]},{productId:second,code:'P2',ops:[]}];
  let reads=0;
  context.window._docRef=(collection,id)=>({collection,id});
  context.window._getDoc=async reference=>{
    reads+=1;
    if(reference.collection==='productGroupMembers') return {id:reference.id,exists:()=>true,data:()=>({productId:first,groupId})};
    return {id:groupId,exists:()=>true,data:()=>({name:'G',memberProductIds:[first,second],active:true,revision:1})};
  };
  vm.runInContext(read('js/product-group-runtime.js'),context);
  const firstResult=await context.window.PCMSProductGroupRuntime.loadForProduct(first);
  const secondResult=await context.window.PCMSProductGroupRuntime.loadForProduct(first);
  assert.equal(firstResult.groupId,groupId);
  assert.equal(secondResult.groupId,groupId);
  assert.equal(reads,2);
});

test('款號匯入以完整覆蓋預覽及兩段進度共用 Product Master Service，並由每個款號交易保存操作紀錄',()=>{
  const data=read('js/data.js');
  const service=read('js/product-master-service.js');
  const impact=read('js/product-import-impact.js');
  const page=read('index.html');
  assert.match(data,/PCMSProductMasterService\.importProducts/);
  assert.match(data,/loadImpactCounts/);
  assert.match(data,/confirmPreview/);
  assert.match(data,/Đang đọc số phiếu sản lượng bị ảnh hưởng/);
  assert.match(data,/Đang lưu dữ liệu mã hàng/);
  assert.doesNotMatch(data,/tất cả mã đã tồn tại sẽ bị bỏ qua|全部既有款號都會略過/);
  assert.match(service,/action:'productImport'/);
  assert.match(service,/COLLECTIONS\.logs/);
  assert.match(service,/transaction\.set\(window\._docRef\(store\(\)\.COLLECTIONS\.logs/);
  assert.match(impact,/Phiếu sản lượng bị ảnh hưởng/);
  assert.match(impact,/Chi tiết công đoạn của phiếu sản lượng bị ảnh hưởng/);
  assert.match(impact,/filter\(item=>Number\(item\.impactCount\)>0\)/);
  assert.match(impact,/Xác nhận ghi đè/);
  assert.doesNotMatch(page,/dup-import-new-btn|id="imp-prev"|id="dup-warn"/);
});
