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

test('款號管理抬頭只保留款號總表及同產品群組，工序由快速修改進入',()=>{
  const {PCMSFeatures}=loadFeatures();
  assert.deepEqual(Array.from(PCMSFeatures.getModule('products').pages,item=>item.page),[
    'summary','product-groups'
  ]);
  assert.deepEqual(Array.from(PCMSFeatures.getModule('production').pages,item=>item.page),[
    'production-entry','production-records','production-bonus','production-attendance','production-employees'
  ]);
  assert.equal(PCMSFeatures.getPage('product-groups').feature,'productionProcessEdit');
  assert.notEqual(PCMSFeatures.getPage('product-groups').permissionVisible,false);
  assert.equal(PCMSFeatures.getModule('products').pages.filter(page=>page.feature==='productionProcessEdit').length,1);
  assert.equal(PCMSFeatures.permissionStructure.find(module=>module.id==='products').pages.filter(page=>page.key==='productionProcessEdit').length,1);
});

test('款號管理主入口明確關閉時不由子權限偷偷開啟',()=>{
  const {normalizeFeaturePermissions}=loadFeatures();
  const normalized=normalizeFeaturePermissions({productsMain:false,productionMain:false,productionProcessEdit:true});
  assert.equal(normalized.productsMain,false);
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

test('群組差異只在同尺寸內比較，單一款號與無明確主要版本不誤報三種異常',()=>{
  const ui=loadGroupUi();
  const operation=(no,vi,sec)=>({no:String(no),vi,sec});
  const rows=[
    {productId:'p-10-a',code:'10-A',sz:'10MM',ops:[operation(1,'May A',16),operation(2,'May B',20)]},
    {productId:'p-10-b',code:'10-B',sz:'10MM',ops:[operation(1,'May A',16),operation(2,'May B',20)]},
    {productId:'p-15-a',code:'15-A',sz:'15MM',ops:[operation(1,'Mô tả khác',30)]}
  ];
  const context=ui.comparisonContext(rows);
  assert.equal(context.summaries.get('p-10-a').comparisonState,'consistent');
  assert.equal(context.summaries.get('p-10-b').comparisonState,'consistent');
  assert.equal(context.summaries.get('p-15-a').comparisonState,'single');
  assert.equal(context.summaries.get('p-15-a').countDifferent,false);
  assert.equal(context.summaries.get('p-15-a').descriptionDifferent,false);
  assert.equal(context.summaries.get('p-15-a').secondsDifferent,false);

  const tied=ui.comparisonContext([
    {productId:'tie-a',code:'T-A',sz:'M',ops:[operation(1,'May A',10)]},
    {productId:'tie-b',code:'T-B',sz:'M',ops:[operation(1,'May B',20)]}
  ]);
  assert.equal(tied.summaries.get('tie-a').comparisonState,'ambiguous');
  assert.equal(tied.summaries.get('tie-b').comparisonState,'ambiguous');
  assert.equal(tied.summaries.get('tie-a').descriptionDifferent,false);
  assert.equal(tied.summaries.get('tie-b').secondsDifferent,false);
});

test('同尺寸有明確主要版本時只標記真正不同的款號與差異項目',()=>{
  const ui=loadGroupUi();
  const rows=[
    {productId:'base-a',code:'A',sz:'M',ops:[{no:'1',vi:'May',sec:16}]},
    {productId:'base-b',code:'B',sz:'M',ops:[{no:'1',vi:'May',sec:16}]},
    {productId:'outlier',code:'C',sz:'M',ops:[{no:'1',vi:'May',sec:20}]}
  ];
  const summaries=ui.comparisonContext(rows).summaries;
  assert.equal(summaries.get('base-a').consistent,true);
  assert.equal(summaries.get('base-b').consistent,true);
  assert.equal(summaries.get('outlier').countDifferent,false);
  assert.equal(summaries.get('outlier').descriptionDifferent,false);
  assert.equal(summaries.get('outlier').secondsDifferent,true);
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
  const runtime=read('js/product-group-runtime.js');
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
  assert.doesNotMatch(page,/Xác nhận xóa vĩnh viễn nhóm|確認永久刪除群組/);
  assert.match(page,/Xác nhận ngừng dùng nhóm/);
  assert.match(page,/確認停用群組/);
  assert.match(runtime,/async function deleteGroup\(groupId,options=\{\}\)/);
  assert.match(runtime,/setActive\(current,false,options\)/);
  assert.doesNotMatch(runtime,/transaction\.delete/);
  assert.match(runtime,/async function renameGroup\(input,options=\{\}\)/);
  assert.match(page,/Khách hàng:<\/strong>/);
  assert.match(style,/\.product-group-detail-dialog \.process-size-tabs/);
  assert.match(style,/grid-template-columns:repeat\(auto-fit,minmax\(72px,1fr\)\)/);
  assert.match(style,/\.product-group-detail-dialog \.ui-table-scroll\{max-height:none;overflow:visible\}/);
});

test('建立新群組維持推薦條件，正式儲存只使用固定 productId',()=>{
  const page=read('js/production/product-groups.js');
  const runtime=read('js/product-group-runtime.js');
  const groupUi=read('js/production/process-group-ui.js');
  const service=read('js/product-master-service.js');
  assert.match(page,/matchesGroupSignature\(item,group\.signature\)/);
  assert.match(page,/groupRecommendation\(source,candidate\)/);
  assert.match(page,/candidatePlan\(product\.code\)/);
  assert.match(page,/selectedCodes:plan\.selectedCodes/);
  assert.match(page,/disabledCodes:plan\.disabledCodes/);
  assert.match(groupUi,/Khớp cao/);
  assert.match(groupUi,/高度符合/);
  assert.match(groupUi,/Khác số lượng công đoạn/);
  assert.match(groupUi,/Khác mô tả tiếng Việt/);
  assert.match(groupUi,/Khác giây tiêu chuẩn/);
  assert.match(groupUi,/recommendationStatusHtml/);
  assert.match(runtime,/memberProductIds/);
  assert.match(runtime,/recommendation\(item\)\.eligible/);
  assert.match(runtime,/service\(\)\.createGroup/);
  assert.match(service,/async function createGroup/);
  assert.match(service,/productGroupMembers/);
  assert.doesNotMatch(runtime,/process-edit-store|PCMSProcessEditStore/);
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

test('工序快速修改預設勾選可匹配群組且共用正式儲存服務',()=>{
  const page=read('js/product-quick-edit.js');
  const groupUi=read('js/production/process-group-ui.js');
  assert.match(page,/function buildTargets/);
  assert.match(page,/memberProductIds/);
  assert.match(page,/matched:config\.scope==='product'\|\|!!operation/);
  assert.match(page,/selected:config\.scope==='product'\|\|!!operation/);
  assert.match(page,/目前群組預設全選；差異只作提醒，不阻止執行/);
  assert.match(page,/service\(\)\.saveManyDrafts/);
  assert.match(page,/product-quick-summary/);
  assert.match(page,/Tổng số công đoạn/);
  assert.match(page,/data-product-quick-expand/);
  assert.match(groupUi,/process-member-code-button/);
  assert.match(groupUi,/Tổng số công đoạn/);
  assert.doesNotMatch(page,/工序優化|標準錯誤訂正|order-exception-button/);
});

test('工序快速修改與群組頁支援中央三種語言顯示模式',()=>{
  const process=read('js/product-quick-edit.js');
  const groups=read('js/production/product-groups.js');
  const css=read('styles/features/production-process-edit.css');
  assert.match(process,/ui-dual-copy/);
  assert.match(groups,/ui-dual-copy/);
  assert.match(groups,/pcms:languagechange/);
  assert.match(css,/data-ui-language-mode="vi"/);
  assert.match(css,/data-ui-language-mode="zh"/);
});
