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

test('款號管理抬頭提供款號總表、修改流水帳及工序修改（含群組）',()=>{
  const {PCMSFeatures}=loadFeatures();
  assert.deepEqual(Array.from(PCMSFeatures.getModule('products').pages,item=>item.page),[
    'summary','product-change-log','product-groups'
  ]);
  assert.deepEqual(Array.from(PCMSFeatures.getModule('production').pages,item=>item.page),[
    'production-entry','production-records','production-bonus','production-attendance','production-employees'
  ]);
  assert.equal(PCMSFeatures.getPage('product-change-log').feature,'productsMain');
  assert.equal(PCMSFeatures.getPage('product-change-log').permissionVisible,false);
  assert.equal(PCMSFeatures.getPage('product-groups').feature,'productionProcessEdit');
  assert.equal(PCMSFeatures.getPage('product-groups').zh,'工序修改（含群組）');
  assert.equal(PCMSFeatures.getPage('product-groups').vi,'Sửa công đoạn (gồm nhóm)');
  assert.notEqual(PCMSFeatures.getPage('product-groups').permissionVisible,false);
  assert.equal(PCMSFeatures.getModule('products').pages.filter(page=>page.feature==='productionProcessEdit').length,1);
  assert.equal(PCMSFeatures.permissionStructure.find(module=>module.id==='products').pages.filter(page=>page.key==='productionProcessEdit').length,1);
  assert.equal(PCMSFeatures.permissionKeys.includes('processSecondsEdit'),false);
});

test('款號管理主入口明確關閉時不由子權限偷偷開啟',()=>{
  const {normalizeFeaturePermissions}=loadFeatures();
  const normalized=normalizeFeaturePermissions({productsMain:false,productionMain:false,productionProcessEdit:true});
  assert.equal(normalized.productsMain,false);
  assert.equal(normalized.productionMain,false);
  assert.equal(normalized.productionProcessEdit,true);
  assert.equal('processSecondsEdit' in normalized,false);
});

test('同產品群組依款號表尺寸分成第二層且未設定尺寸獨立顯示',()=>{
  const ui=loadGroupUi();
  const groups=ui.groupBySize([
    {code:'A',sz:'15MM'},{code:'B',sz:'20MM'},{code:'C',sz:'15MM'},{code:'D',sz:''}
  ]);
  assert.deepEqual(Array.from(groups,item=>item.label),['15MM','20MM','—']);
  assert.deepEqual(Array.from(groups[0].members,item=>item.code),['A','C']);
  assert.equal(groups[2].labelPair.zh,'未設定尺寸');
  const recommended=ui.groupBySize([
    {code:'A',sz:'15MM'},{code:'B',sz:'15MM'},{code:'C',sz:'15MM'}
  ],{orderCodes:['C','A','B']});
  assert.deepEqual(Array.from(recommended[0].members,item=>item.code),['C','A','B']);
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

test('未分組推薦的來源尺寸以來源款號為準，其他尺寸各自使用多數版本',()=>{
  const ui=loadGroupUi();
  const operation=(no,vi,sec)=>({no:String(no),vi,sec});
  const rows=[
    {productId:'s-a',code:'S-A',vi:'Vòng cổ',sz:'S',ops:[operation(1,'May',60)]},
    {productId:'s-b',code:'S-B',vi:'Vòng cổ',sz:'S',ops:[operation(1,'May',60)]},
    {productId:'s-c',code:'S-C',vi:'Vòng cổ',sz:'S',ops:[operation(1,'May',75)]},
    {productId:'s-d',code:'S-D',vi:'Vòng cổ',sz:'S',ops:[operation(1,'May',75)]},
    {productId:'m-a',code:'M-A',vi:'Dây đeo',sz:'M',ops:[operation(1,'Cắt',30)]},
    {productId:'m-b',code:'M-B',vi:'Dây đeo',sz:'M',ops:[operation(1,'Cắt',30)]},
    {productId:'m-c',code:'M-C',vi:'Dây đeo',sz:'M',ops:[operation(1,'Cắt khác',30)]}
  ];
  const summaries=ui.comparisonContext(rows,{includeProductName:true,referenceProductId:'s-a'}).summaries;
  assert.equal(summaries.get('s-a').comparisonState,'consistent');
  assert.equal(summaries.get('s-b').comparisonState,'consistent');
  assert.equal(summaries.get('s-c').secondsDifferent,true);
  assert.equal(summaries.get('s-d').secondsDifferent,true);
  assert.equal(summaries.get('m-a').comparisonState,'consistent');
  assert.equal(summaries.get('m-b').comparisonState,'consistent');
  assert.equal(summaries.get('m-c').descriptionDifferent,true);
  assert.equal(summaries.get('m-c').secondsDifferent,false);
});

test('推薦狀態固定依一致、差異、其他群組排序且同層保留原順序',()=>{
  const ui=loadGroupUi();
  const rows=[
    {productId:'different',code:'D'},
    {productId:'blocked',code:'B'},
    {productId:'consistent',code:'C'},
    {productId:'source',code:'S'}
  ];
  const summaries=new Map([
    ['different',{comparisonState:'different'}],
    ['blocked',{comparisonState:'consistent'}],
    ['consistent',{comparisonState:'consistent'}],
    ['source',{comparisonState:'different'}]
  ]);
  const sorted=ui.sortRecommendationMembers(rows,{summaries,requiredCodes:['S'],disabledCodes:['B']});
  assert.deepEqual(Array.from(sorted,item=>item.code),['C','S','D','B']);
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

test('建立新群組只列同客人同越文品名候選，依尺寸預選一致款號並只使用固定 productId',()=>{
  const page=read('js/production/product-groups.js');
  const runtime=read('js/product-group-runtime.js');
  const groupUi=read('js/production/process-group-ui.js');
  const service=read('js/product-master-service.js');
  assert.match(page,/matchesGroupSignature\(item,group\.signature\)/);
  assert.match(page,/sizeRecommendationStatusHtml\(summary\|\|\{\},assigned\)/);
  assert.match(page,/candidatePlan\(product\.code\)/);
  assert.doesNotMatch(page,/selectedCodes:plan\.selectedCodes/);
  assert.match(page,/selectConsistentByDefault:true/);
  assert.match(page,/同一客人且越文品名相同/);
  assert.match(page,/disabledCodes:plan\.disabledCodes/);
  assert.match(groupUi,/Khớp cao/);
  assert.match(groupUi,/高度符合/);
  assert.match(groupUi,/Khác tên sản phẩm Việt/);
  assert.match(groupUi,/Khác số lượng công đoạn/);
  assert.match(groupUi,/Khác mô tả tiếng Việt/);
  assert.match(groupUi,/Khác giây tiêu chuẩn/);
  assert.match(groupUi,/recommendationStatusHtml/);
  assert.match(runtime,/memberProductIds/);
  assert.match(runtime,/recommendation\(item\)\.eligible/);
  assert.match(runtime,/const selectedCodes=\[source\.code\]/);
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

test('工序快速修改只預設勾選來源與一致款號且共用正式儲存服務',()=>{
  const page=read('js/product-quick-edit.js');
  const groupUi=read('js/production/process-group-ui.js');
  assert.match(page,/function buildTargets/);
  assert.match(page,/memberProductIds/);
  assert.match(page,/const matched=config\.scope==='product'\|\|!!operation/);
  assert.match(page,/selected:matched&&\(isSource\|\|recommended\)/);
  assert.match(page,/required:false/);
  assert.doesNotMatch(page,/selected:matched&&\(group\?true/);
  assert.match(page,/candidatePlan/);
  assert.match(page,/prepareGroupContext/);
  assert.match(page,/已有群組只顯示目前群組；沒有群組才尋找推薦/);
  assert.match(page,/高度符合者預設勾選；有差異者預設不勾選/);
  assert.match(page,/service\(\)\.saveManyDrafts/);
  assert.match(page,/product-quick-summary/);
  assert.match(page,/Tổng số công đoạn/);
  assert.match(page,/data-product-quick-expand/);
  assert.match(groupUi,/process-member-code-button/);
  assert.match(groupUi,/Tổng số công đoạn/);
  assert.doesNotMatch(page,/工序優化|標準錯誤訂正|order-exception-button/);
});

test('群組可由單一款號建立但仍拒絕空群組',()=>{
  const page=read('js/production/product-groups.js');
  const quick=read('js/product-quick-edit.js');
  const store=read('js/product-group-store.js');
  const rules=read('firestore.rules');
  assert.match(page,/selected<1/);
  assert.match(page,/memberCodes\.length<1/);
  assert.match(quick,/memberCodes\.length<1/);
  assert.match(store,/memberProductIds\.length<1/);
  assert.match(rules,/memberProductIds\.size\(\) >= 1/);
  assert.doesNotMatch(rules,/memberProductIds\.size\(\) >= 2/);
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

test('工序差異底色不會被滑鼠移入狀態覆蓋',()=>{
  const css=read('styles/features/production-process-edit.css');
  assert.match(css,/\.process-member-detail td\.is-different,\.process-member-detail tr:hover td\.is-different/);
});

test('群組清單與快速修改表格共用欄寬控制，搜尋支援智慧比對與 Enter',()=>{
  const groups=read('js/production/product-groups.js');
  const quick=read('js/product-quick-edit.js');
  const summary=read('js/summary.js');
  const features=read('js/features.js');
  assert.match(groups,/PCMSUITableControls\.create/);
  assert.match(groups,/data-ui-table-resizable="true"/);
  assert.match(groups,/PCMSUISearchDropdown\?\.scoreText/);
  assert.match(groups,/event\.key==='Enter'/);
  assert.match(quick,/quickTableColumns/);
  assert.match(quick,/preferenceKey:`productQuickEdit:\$\{config\.scope\}:\$\{config\.key\}`/);
  assert.match(quick,/key:'processDescription'/);
  assert.match(summary,/function summarySearchScore/);
  assert.match(summary,/PCMSUISearchDropdown\?\.scoreText/);
  assert.match(features,/page:'product-groups'[\s\S]*?'uiTableControls','uiSearchDropdown','productionProductGroups'/);
});
