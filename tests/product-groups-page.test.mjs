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

function loadGroupStoreForManualSelection(){
  const products=[
    {code:'A',client:'GT',vi:'Vòng cổ',sz:'6MM',ops:[{no:'1',category:'SX',vi:'May',sec:10}]},
    {code:'A2',client:'GT',vi:'Vòng cổ',sz:'8MM',ops:[{no:'1',category:'SX',vi:'May',sec:12}]},
    {code:'B',client:'GT',vi:'Vòng cổ',sz:'10MM',ops:[{no:'1',category:'SX',vi:'Đục lỗ',sec:9}]},
    {code:'C',client:'SYLS',vi:'Vòng cổ',sz:'10MM',ops:[{no:'1',category:'SX',vi:'Đục lỗ',sec:9}]}
  ];
  const context={window:{D:products,firebaseAuthUser:{uid:'tester'},cu:{user:'Tester'}}};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  const groupData={
    groupId:'group-1',name:'Vòng cổ',signature:context.window.PCMSProductModel.groupSignature(products[0]),
    memberCodes:['A','A2'],active:true
  };
  context.window._collection=name=>({collection:name});
  context.window._docRef=(collection,id)=>({collection,id});
  context.window._newDocRef=collection=>({collection,id:'new-group'});
  context.window._getDocs=async()=>({docs:[{id:'group-1',data:()=>({...groupData,memberCodes:[...groupData.memberCodes]})}]});
  context.window._runTransaction=async callback=>callback({
    get:async reference=>reference.collection==='productGroups'
      ?{exists:()=>true,data:()=>({...groupData,memberCodes:[...groupData.memberCodes]})}
      :{exists:()=>false,data:()=>({})},
    update:(reference,value)=>{ if(reference.collection==='productGroups') Object.assign(groupData,value); },
    set:()=>{},delete:()=>{}
  });
  context.window.saveOperationLogToFB=async()=>true;
  vm.runInContext(read('js/production/process-edit-store.js'),context);
  return {store:context.window.PCMSProcessEditStore,groupData};
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

test('建立新群組維持推薦條件，既有群組可人工加入同客人款號',()=>{
  const page=read('js/production/product-groups.js');
  const store=read('js/production/process-edit-store.js');
  assert.match(page,/matchesGroupSignature\(item,group\.signature\)/);
  assert.match(store,/validateGroupMembers\(input\.memberCodes\)/);
  assert.match(store,/allowManualSelection=false/);
  assert.match(store,/validateGroupMembers\(input\.memberCodes,\{allowManualSelection:true,expectedClient\}\)/);
  assert.match(store,/群組內款號必須屬於同一位客人/);
  assert.match(store,/所選款號不屬於此群組的客人/);
  assert.doesNotMatch(store,/matchesGroupSignature\(validated\.memberProducts\[0\],current\.signature\)/);
});

test('既有群組可人工加入推薦不符合款號，但不能跨客人',async()=>{
  const {store,groupData}=loadGroupStoreForManualSelection();
  await store.loadGroups();
  const result=await store.updateGroupMembers({groupId:'group-1',memberCodes:['A','A2','B']});
  assert.equal(result.changed,true);
  assert.deepEqual([...groupData.memberCodes],['A','A2','B']);
  await assert.rejects(
    store.updateGroupMembers({groupId:'group-1',memberCodes:['A','A2','B','C']}),
    /群組內款號必須屬於同一位客人/
  );
  await assert.rejects(
    store.createGroup({memberCodes:['A','B']}),
    /不能建立同產品群組/
  );
});

test('已有群組只列同客人款號並可依款號或越文名稱篩選',()=>{
  const page=read('js/production/product-groups.js');
  const style=read('styles/features/production-process-edit.css');
  assert.match(page,/clientName\(item\)===groupClient\(group\)/);
  assert.match(page,/data-group-add-client disabled/);
  assert.match(page,/data-group-add-mode/);
  assert.match(page,/data-group-add-code-field/);
  assert.match(page,/data-group-add-vi-field/);
  assert.match(page,/normalize\(item\.vi\)===selectedVi/);
  assert.match(page,/const selectedMode=mode\.value\|\|'vi'/);
  assert.match(page,/matches\.slice\(0,ADD_RESULT_LIMIT\)/);
  assert.match(page,/請輸入款號開始篩選/);
  assert.match(page,/const disabled=!!other\|\|existingCodes\.has/);
  assert.match(page,/Không khớp đề xuất · cần xác nhận/);
  assert.match(page,/不符合系統推薦・需人工確認/);
  assert.match(page,/Đã thuộc nhóm:/);
  assert.match(page,/已在其他群組：/);
  assert.match(page,/class="is-status" title=/);
  assert.match(page,/Mã cần xác nhận thủ công/);
  assert.match(page,/需人工確認款號/);
  assert.doesNotMatch(page,/const disabled=.*!compatible/);
  assert.match(page,/renderSelector\(normalize\(added\[0\]\?\.sz\)\)/);
  assert.match(page,/data-product-group-detail-status/);
  assert.match(page,/danh sách chờ lưu/);
  assert.match(page,/待儲存清單/);
  assert.match(page,/if\(selector&&!nextActiveSize\)\{ selectedCodes=selector\.selectedCodes\(\);activeSize=selector\.activeSize\(\); \}/);
  assert.match(style,/\.product-group-add-filters\{display:grid/);
  assert.match(style,/\.product-group-add-dialog table\{width:100%;min-width:0;table-layout:fixed\}/);
  assert.match(style,/\.product-group-review\{color:var\(--warn\);font-weight:700\}/);
  assert.match(style,/\.product-group-add-dialog td\.is-status\{white-space:normal;overflow-wrap:anywhere\}/);
  assert.doesNotMatch(style,/\.product-group-add-dialog table\{min-width:820px\}/);
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
