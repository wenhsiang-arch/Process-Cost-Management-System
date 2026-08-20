import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('..',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

function loadFeatures(){
  const context={window:{},CONFIGURABLE_ROLES:['manager','clerk','productionDevelopment','productionControl','sales']};
  vm.createContext(context);
  vm.runInContext(read('js/features.js'),context);
  return context.window;
}

function loadGroupUi(){
  const context={window:{PCMSSafe:{text:value=>String(value??''),attribute:value=>String(value??'')}}};
  vm.createContext(context);
  vm.runInContext(read('js/production/process-group-ui.js'),context);
  return context.window.PCMSProcessGroupUI;
}

test('款號管理抬頭包含款號總表、工序修改及同產品群組',()=>{
  const {PCMSFeatures}=loadFeatures();
  assert.deepEqual(Array.from(PCMSFeatures.getModule('products').pages,item=>item.page),[
    'summary','production-process-edit','product-groups'
  ]);
  assert.deepEqual(Array.from(PCMSFeatures.getModule('production').pages,item=>item.page),[
    'production-entry','production-records','production-bonus','production-attendance','production-employees'
  ]);
  assert.equal(PCMSFeatures.getPage('product-groups').feature,'productionProcessEdit');
  assert.equal(PCMSFeatures.getPage('product-groups').permissionVisible,false);
  assert.equal(PCMSFeatures.getModule('products').pages.filter(page=>page.feature==='productionProcessEdit').length,2);
  assert.equal(PCMSFeatures.permissionStructure.find(module=>module.id==='products').pages.filter(page=>page.key==='productionProcessEdit').length,1);
});

test('舊權限只開工序修改時仍能進入款號管理入口',()=>{
  const {normalizeFeaturePermissions}=loadFeatures();
  const normalized=normalizeFeaturePermissions({productsMain:false,productionMain:false,productionProcessEdit:true});
  assert.equal(normalized.productsMain,true);
  assert.equal(normalized.productionMain,false);
  assert.equal(normalized.productionProcessEdit,true);
  assert.equal(normalized.processSecondsEdit,false);
});

test('同產品群組依款號表尺寸分成第二層且未設定尺寸獨立顯示',()=>{
  const ui=loadGroupUi();
  const groups=ui.groupBySize([
    {code:'A',sz:'15MM'},{code:'B',sz:'20MM'},{code:'C',sz:'15MM'},{code:'D',sz:''}
  ]);
  assert.deepEqual(Array.from(groups,item=>item.label),['15MM','20MM','—']);
  assert.deepEqual(Array.from(groups[0].members,item=>item.code),['A','C']);
  assert.equal(groups[2].labelPair.zh,'未設定尺寸');
});

test('群組頁先顯示全部清單，建立群組才開啟三步驟視窗',()=>{
  const page=read('js/production/product-groups.js');
  const html=read('index.html');
  assert.match(html,/id="pg-product-groups"/);
  assert.match(html,/id="product-groups-root"/);
  assert.match(page,/Danh sách tất cả nhóm/);
  assert.match(page,/全部群組清單/);
  assert.match(page,/store\(\)\.listGroups\(\)/);
  assert.match(page,/store\(\)\.createGroup/);
  assert.match(page,/product-groups-new-button/);
  assert.match(page,/product-groups-wizard-client/);
  assert.match(page,/data-product-groups-step="1"/);
  assert.match(page,/data-product-groups-step="2"/);
  assert.match(page,/data-product-groups-step="3"/);
  assert.match(page,/product-groups-list-client/);
  assert.match(page,/createMemberSelector/);
});

test('群組清單只顯示群組摘要且點名稱開啟可修改成員的緊湊視窗',()=>{
  const page=read('js/production/product-groups.js');
  const store=read('js/production/process-edit-store.js');
  const style=read('styles/features/production-process-edit.css');
  assert.match(page,/class="product-group-name-button" data-product-group-view/);
  assert.doesNotMatch(page,/Xem thành viên|查看成員|data-product-group-edit|Sửa công đoạn/);
  assert.match(page,/Chi tiết nhóm cùng sản phẩm/);
  assert.match(page,/同產品群組明細/);
  assert.match(page,/updateGroupMembers/);
  assert.match(page,/Mã thêm mới/);
  assert.match(page,/Mã bị xóa/);
  assert.match(page,/Kích thước bị ảnh hưởng/);
  assert.match(page,/data-product-group-add/);
  assert.match(page,/data-product-group-delete/);
  assert.match(page,/deleteGroup/);
  assert.match(page,/renameGroup/);
  assert.match(page,/Xác nhận xóa vĩnh viễn nhóm/);
  assert.match(store,/async function deleteGroup\(groupId\)/);
  assert.match(store,/previousCodes\.forEach\(code=>transaction\.delete/);
  assert.match(store,/transaction\.delete\(groupReference\)/);
  assert.match(store,/action:'productGroupDelete'/);
  assert.match(store,/async function renameGroup\(input=\{\}\)/);
  assert.match(store,/action:'productGroupRename'/);
  assert.match(page,/Khách hàng:<\/strong>/);
  assert.match(style,/\.product-group-detail-dialog \.process-size-tabs/);
  assert.match(style,/grid-template-columns:repeat\(auto-fit,minmax\(72px,1fr\)\)/);
  assert.match(style,/\.product-group-detail-dialog \.ui-table-scroll\{max-height:none;overflow:visible\}/);
});

test('群組新增成員及舊群組驗證共用相容版候選特徵',()=>{
  const page=read('js/production/product-groups.js');
  const store=read('js/production/process-edit-store.js');
  assert.match(page,/matchesGroupSignature\(item,group\.signature\)/);
  assert.match(store,/matchesGroupSignature\(validated\.memberProducts\[0\],current\.signature\)/);
});

test('工序修改安全預設只改目前款號，主動選擇後才展開群組',()=>{
  const page=read('js/production/process-edit.js');
  assert.match(page,/process-edit-client-select/);
  assert.match(page,/state\.selectedClient/);
  assert.match(page,/applyMode:'current'/);
  assert.match(page,/Chỉ sửa mã hiện tại/);
  assert.match(page,/只修改目前款號/);
  assert.match(page,/process-edit-group-targets/);
  assert.match(page,/process-edit-toolbar-group/);
  assert.match(page,/process-edit-operation-number/);
  assert.match(page,/process-edit-operation-name/);
  assert.match(page,/data-process-group-selector/);
  assert.match(page,/createMemberSelector/);
  assert.match(page,/data-ui-table-default-visible="false"/);
  assert.match(page,/process-edit-drag-handle/);
  assert.doesNotMatch(page,/class="process-edit-reason"/);
  assert.doesNotMatch(page,/order-exception-button/);
  assert.match(page,/sp\?\.\('product-groups'\)/);
  assert.doesNotMatch(page,/data-process-switch/);
  assert.doesNotMatch(page,/編輯此款/);
  assert.doesNotMatch(page,/data-group-candidate/);
  assert.doesNotMatch(page,/createSuggestedGroup/);
});

test('工序修改與群組頁支援中央三種語言顯示模式',()=>{
  const process=read('js/production/process-edit.js');
  const groups=read('js/production/product-groups.js');
  const css=read('styles/features/production-process-edit.css');
  assert.match(process,/ui-dual-copy/);
  assert.match(groups,/ui-dual-copy/);
  assert.match(groups,/pcms:languagechange/);
  assert.match(css,/data-ui-language-mode="vi"/);
  assert.match(css,/data-ui-language-mode="zh"/);
});
