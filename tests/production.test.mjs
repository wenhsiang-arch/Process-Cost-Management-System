import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

function createProductionContext(){
  const employeeDocuments=[
    {id:'M91234',data:()=>({employeeId:'M91234',name:'Nguyễn An',department:'May',active:true})},
    {id:'A55678',data:()=>({employeeId:'A55678',name:'Trần Bình',department:'Đóng gói',active:true})}
  ]; // employeeDocuments（員工測試資料）
  const orderProcesses=[
    {id:'PROCESS-1',orderId:'ORDER-ABC-2026',orderNo:'OD-7788',code:'STYLE-500',desc:'Áo khoác',color:'Đen',sz:'M',processNo:'1',processVi:'May thân',processZh:'車身',orderQty:1000,workStdSec:48,processSec:48,slPerHour:63},
    {id:'PROCESS-2',orderId:'ORDER-ABC-2026',orderNo:'OD-7788',code:'STYLE-500',desc:'Áo khoác',color:'Đen',sz:'M',processNo:'12',processVi:'Kiểm tra',processZh:'檢查',orderQty:1000,workStdSec:30,processSec:30,slPerHour:100},
    {id:'PROCESS-3',orderId:'ORDER-ABC-2026',orderNo:'OD-7788',code:'STYLE-900',desc:'Quần dài',color:'Xanh',sz:'L',processNo:'1',processVi:'May túi',processZh:'車口袋',orderQty:800,workStdSec:50,processSec:50,slPerHour:60}
  ]; // orderProcesses（訂單工序測試資料）
  const window={
    firebaseAuthUser:{uid:'clerk-user'},
    cu:{user:'文員測試'},
    _collection:name=>name,
    _docRef:(collection,id)=>({collection,id}),
    _getDoc:async reference=>({
      exists:()=>reference.collection==='productionProcessTotals'&&reference.id==='PROCESS-1',
      data:()=>({registeredQty:250,orderQty:1000})
    }),
    _getDocs:async()=>({docs:employeeDocuments}),
    firebaseLoadCachedCollection:async scope=>scope === 'productionEmployees'
      ? employeeDocuments.map(item=>({id:item.id,...item.data()}))
      : [
          {id:'ORDER-ABC-2026',orderId:'ORDER-ABC-2026',client:'Khách A',importStatus:'ready',lifecycleStatus:'active',processVersion:'v1'},
          {id:'ORDER-OLD',orderId:'ORDER-OLD',client:'Khách cũ',importStatus:'failed'}
        ], // firebaseLoadCachedCollection（快取集合載入測試介面）
    PCMSOrderProcessCache:{
      read:async()=>orderProcesses,
      write:async()=>{},
      remove:async()=>{}
    }
  };
  const context={window,console,Map,Object,Array,String,Number,Math,Date,Error,RegExp};
  vm.createContext(context);
  vm.runInContext(read('js/production/employee-store.js'),context);
  vm.runInContext(read('js/production/entry-store.js'),context);
  return window;
}

function createEmployeeMutationContext(){
  const documents=new Map([
    ['productionEmployees/M91234',{employeeId:'M91234',name:'Nguyễn An',department:'May',active:true,createdAt:1,createdByUid:'admin-user',createdBy:'管理員',updatedAt:1,updatedByUid:'admin-user',updatedBy:'管理員',schemaVersion:1}],
    ['productionDepartments/may',{departmentId:'may',name:'May',active:true}],
    ['productionDepartments/%C4%91%C3%B3ng%20g%C3%B3i',{departmentId:'%C4%91%C3%B3ng%20g%C3%B3i',name:'Đóng gói',active:true}]
  ]); // documents（員工異動測試資料）
  const keyOf=reference=>`${reference.collection}/${reference.id}`; // keyOf（測試文件位置）
  const window={
    firebaseAuthUser:{uid:'clerk-user'},
    cu:{user:'文員測試'},
    _docRef:(collection,id)=>({collection,id}),
    _runTransaction:async task=>task({
      get:async reference=>({
        exists:()=>documents.has(keyOf(reference)),
        data:()=>({...documents.get(keyOf(reference))})
      }),
      set:(reference,data)=>documents.set(keyOf(reference),{...data}),
      delete:reference=>documents.delete(keyOf(reference))
    })
  };
  const context={window,console,Map,Object,Array,String,Number,Math,Date,Error,RegExp,encodeURIComponent};
  vm.createContext(context);
  vm.runInContext(read('js/production/employee-store.js'),context);
  return {window,documents};
}

test('員工工號、姓名及部門可用整段任意文字搜尋',async()=>{
  const window=createProductionContext();
  await window.PCMSProductionEmployees.load();
  assert.equal(window.PCMSProductionEmployees.search('1234')[0].employeeId,'M91234');
  assert.equal(window.PCMSProductionEmployees.search('uyễn')[0].employeeId,'M91234');
  assert.equal(window.PCMSProductionEmployees.search('gói')[0].employeeId,'A55678');
  assert.equal(window.PCMSProductionEmployees.validateEmployee({employeeId:'m91234',name:'A',department:'B'}).employeeId,'M91234');
});

test('新增既有工號必須拒絕且只有編輯流程可以更新',async()=>{
  const {window,documents}=createEmployeeMutationContext();
  await assert.rejects(
    window.PCMSProductionEmployees.createEmployee({employeeId:'m91234',name:'覆蓋名稱',department:'May'}),
    /工號已存在/
  );
  assert.equal(documents.get('productionEmployees/M91234').name,'Nguyễn An');
  const updated=await window.PCMSProductionEmployees.updateEmployee('M91234',{
    employeeId:'M91234',name:'Nguyễn An mới',department:'Đóng gói',active:true
  });
  assert.equal(updated.name,'Nguyễn An mới');
  assert.equal(documents.get('productionEmployees/M91234').department,'Đóng gói');
  await assert.rejects(
    window.PCMSProductionEmployees.updateEmployee('M91234',{employeeId:'M90000',name:'A',department:'B'}),
    /工號不可變更/
  );
  await assert.rejects(
    window.PCMSProductionEmployees.createEmployee({employeeId:'M93333',name:'A',department:'Không tồn tại'}),
    /請先新增並啟用部門/
  );
});

test('訂單、款號及工序只在目前訂單範圍內搜尋',async()=>{
  const window=createProductionContext();
  await window.PCMSProductionEntryStore.loadOrders();
  assert.equal(window.PCMSProductionEntryStore.searchOrders('')[0].id,'ORDER-ABC-2026');
  assert.equal(window.PCMSProductionEntryStore.searchOrders('ABC')[0].id,'ORDER-ABC-2026');
  assert.equal(window.PCMSProductionEntryStore.searchOrders('Khách A')[0].id,'ORDER-ABC-2026');
  assert.equal(window.PCMSProductionEntryStore.searchOrders('OLD').length,0);
  await window.PCMSProductionEntryStore.loadProcesses('ORDER-ABC-2026');
  assert.deepEqual(
    Array.from(window.PCMSProductionEntryStore.searchProducts('ORDER-ABC-2026','')).map(item=>item.code),
    ['STYLE-500','STYLE-900']
  );
  assert.deepEqual(
    Array.from(window.PCMSProductionEntryStore.searchProducts('ORDER-ABC-2026','500')).map(item=>item.code),
    ['STYLE-500']
  );
  assert.equal(window.PCMSProductionEntryStore.findProcess('ORDER-ABC-2026','STYLE-500','1').id,'PROCESS-1');
  assert.equal(window.PCMSProductionEntryStore.findProcess('ORDER-ABC-2026','STYLE-900','12'),null);
  assert.deepEqual(
    {...await window.PCMSProductionEntryStore.loadProcessTotal('PROCESS-1')},
    {registeredQuantity:250,orderQuantity:1000}
  );
});

test('生產數量只接受正整數且生產日期必須明確填寫',()=>{
  const window=createProductionContext();
  const valid={productionDate:'2026-08-08',employeeId:'M91234',orderId:'ORDER-ABC-2026',productCode:'STYLE-500',processNo:'1',quantity:500};
  assert.equal(window.PCMSProductionEntryStore.validateEntryInput(valid).quantity,500);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...valid,quantity:0}),/正整數/);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...valid,quantity:1.5}),/正整數/);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...valid,productionDate:''}),/生產日期/);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...valid,productionDate:'2026-02-31'}),/生產日期/);
});

test('產能永久刪除只供管理員使用且同步處理員工關聯與工序累計',()=>{
  const employeeStore=read('js/production/employee-store.js'); // employeeStore（員工資料存取程式內容）
  const entryStore=read('js/production/entry-store.js'); // entryStore（生產資料存取程式內容）
  const employeePage=read('js/production/production-employees.js'); // employeePage（員工資料頁程式內容）
  const entryPage=read('js/production/production-entry.js'); // entryPage（生產登記頁程式內容）
  const recordsPage=read('js/production/production-records.js'); // recordsPage（生產紀錄頁程式內容）

  assert.match(employeeStore,/window\.cu\?\.role !== 'admin'/);
  assert.match(employeeStore,/_where\('employeeId','==',normalized\)/);
  assert.match(employeeStore,/transaction\.delete\(reference\)/);
  assert.match(entryStore,/window\.cu\?\.role !== 'admin'/);
  assert.match(entryStore,/nextRegistered === 0\) transaction\.delete\(totalReference\)/);
  assert.match(entryStore,/transaction\.delete\(entryReference\)/);
  assert.match(entryStore,/productionEntryDelete/);
  [employeePage,entryPage,recordsPage].forEach(source=>{
    assert.match(source,/window\.cu\?\.role === 'admin'/);
    assert.match(source,/永久刪除/);
  });
});

test('重複工號拒絕覆蓋、部門使用下拉管理且搜尋下拉只由輸入或箭頭展開',()=>{
  const employeeStore=read('js/production/employee-store.js'); // employeeStore（員工資料存取程式內容）
  const employeePage=read('js/production/production-employees.js'); // employeePage（員工資料頁程式內容）
  const entryPage=read('js/production/production-entry.js'); // entryPage（生產登記頁程式內容）
  const recordsPage=read('js/production/production-records.js'); // recordsPage（生產紀錄頁程式內容）
  const html=read('index.html'); // html（主畫面內容）

  assert.match(employeeStore,/async function createEmployee/);
  assert.match(employeeStore,/if\(snapshot\.exists\(\)\)\{\s*throw new Error\('Mã nhân viên đã tồn tại/);
  assert.match(employeeStore,/async function updateEmployee/);
  assert.match(employeePage,/updateEmployee\(state\.editingId,input\)/);
  assert.match(employeePage,/createEmployee\(input\)/);
  assert.match(employeePage,/active:state\.editingId \? existing\?\.active === true : true/);
  assert.doesNotMatch(employeePage,/production-employee-active/);
  assert.match(html,/<select id="production-employee-department-input">/);
  assert.match(html,/id="production-department-add-button"/);
  assert.match(html,/id="production-department-manage-button"/);
  assert.match(employeeStore,/async function departmentInUse/);
  assert.match(employeeStore,/_where\('department','==',normalized\)/);
  assert.match(employeeStore,/productionDepartmentCreate/);
  assert.match(employeeStore,/productionDepartmentRename/);
  assert.match(employeeStore,/productionDepartmentStatus/);
  assert.match(employeeStore,/productionDepartmentDelete/);
  assert.match(employeeStore,/firebaseLoadCachedCollection\(COLLECTION_NAME,COLLECTION_NAME,options\)/);
  assert.match(employeeStore,/firebaseLoadCachedCollection\(DEPARTMENT_COLLECTION_NAME,DEPARTMENT_COLLECTION_NAME,options\)/);
  assert.match(employeeStore,/options\.revalidate !== true/);
  [employeePage,entryPage,recordsPage].forEach(source=>{
    assert.match(source,/revalidate:options\.background === true/);
  });
  assert.doesNotMatch(html,/id="production-employee-active"/);
  ['employee','order','product','process'].forEach(name=>{
    assert.match(html,new RegExp(`id="production-${name}-input"[\\s\\S]*?id="production-${name}-toggle"`));
    assert.match(html,new RegExp(`<div class="ui-search-dropdown-control">[\\s\\S]*?id="production-${name}-input"[\\s\\S]*?id="production-${name}-toggle"[\\s\\S]*?id="production-${name}-options"[\\s\\S]*?</div>`));
  });
  assert.match(entryPage,/production-employee-toggle'\)\.addEventListener\('click',toggleEmployeeDropdown\)/);
  assert.match(entryPage,/production-order-toggle'\)\.addEventListener\('click',toggleOrderDropdown\)/);
  assert.match(entryPage,/production-product-toggle'\)\.addEventListener\('click',toggleProductDropdown\)/);
  assert.match(entryPage,/production-process-toggle'\)\.addEventListener\('click',toggleProcessDropdown\)/);
  assert.match(entryPage,/PCMSProductionEmployees\.list\(\{activeOnly:true\}\)/);
  assert.match(entryPage,/PCMSProductionEntryStore\.listOrders\(\)/);
  assert.match(entryPage,/PCMSProductionEntryStore\.productsForOrder\(state\.order\.id\)/);
  assert.match(entryPage,/dataset\.dropdownMode === 'all'[\s\S]*?renderDropdown\(id,items,render,onSelect,'all'\)/);
  assert.match(entryPage,/addEventListener\('mouseleave'/);
  assert.doesNotMatch(entryPage,/latest\.length === 1|if\(exact\) selectProcess\(exact\)/);
  assert.doesNotMatch(entryPage,/production-(?:order|product)-input'\)\.addEventListener\('(?:focus|click)'/);
});

test('產能搜尋下拉緊貼輸入框且沒有滑鼠移動斷層',()=>{
  const style=read('styles/features/production.css'); // style（產能介面樣式）
  const features=read('js/features.js'); // features（中央功能載入設定）
  assert.match(style,/\.production-options \{[\s\S]*?top: calc\(100% - 1px\);/);
  assert.match(style,/\.production-options \{[\s\S]*?border-radius: 0 0 var\(--ui-radius-control\) var\(--ui-radius-control\);/);
  assert.doesNotMatch(style,/\.production-options \{[\s\S]*?top: calc\(100% \+ 4px\);/);
  assert.match(features,/production:'styles\/features\/production\.css\?v=20260809-8'/);
});

test('生產登記分開員工資訊與登記區且表格欄位可以按需顯示',()=>{
  const html=read('index.html');
  const source=read('js/production/production-entry.js');
  const records=read('js/production/production-records.js');
  const style=read('styles/features/production.css');
  const features=read('js/features.js');
  const pageStart=html.indexOf('id="pg-production-entry"');
  const pageEnd=html.indexOf('<div class="pg',pageStart+1);
  const markup=html.slice(pageStart,pageEnd);
  assert.match(markup,/production-registration-context[\s\S]*?production-registration-header[\s\S]*?Đăng ký sản xuất[\s\S]*?生產登記/);
  assert.match(markup,/production-employee-inline-panel[\s\S]*?Mã nhân viên[\s\S]*?員工工號[\s\S]*?Tên nhân viên[\s\S]*?姓名[\s\S]*?Bộ phận[\s\S]*?部門/);
  assert.match(markup,/production-registration-context[\s\S]*?production-date-input[\s\S]*?production-order-input[\s\S]*?production-product-input[\s\S]*?production-process-input[\s\S]*?production-quantity-input/);
  assert.doesNotMatch(markup,/production-save-button|Lưu sản lượng|儲存產量/);
  assert.match(markup,/tabindex="-1"[^>]*id="production-calendar-button"[\s\S]*?ti-calendar-time/);
  assert.match(markup,/tabindex="-1"[^>]*id="production-date-previous"[\s\S]*?tabindex="-1"[^>]*id="production-date-next"/);
  assert.match(markup,/id="production-quantity-input"[^>]*placeholder="Enter để lưu \/ Enter 儲存"/);
  assert.match(markup,/for="production-quantity-input"><strong>Số lượng<\/strong><span>數量<\/span>/);
  assert.match(markup,/id="production-entry-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.doesNotMatch(markup,/id="production-entry-status"[^>]*ui-notice/);
  assert.match(markup,/tabindex="-1"[^>]*id="production-column-settings-button"[^>]*aria-expanded="false"/);
  assert.match(markup,/production-column-settings-heading[\s\S]*?id="production-column-settings-reset"/);
  for(const key of ['order','product','processNo','processName','quantity','orderQuantity','processSeconds','action']){
    assert.match(markup,new RegExp(`data-production-column-toggle="${key}"`));
    if(key !== 'action') assert.match(markup,new RegExp(`data-production-column="${key}"`));
  }
  assert.doesNotMatch(markup,/data-production-column-toggle="[^"]+"[^>]*disabled/);
  assert.match(markup,/id="production-columns-empty"[^>]*hidden/);
  assert.match(source,/function applyColumnVisibility\(\)/);
  assert.match(source,/function resetColumnVisibility\(\)/);
  assert.match(source,/const ENTRY_INPUT_IDS = Object\.freeze\(\[/);
  assert.match(source,/function handleEntryTab\(event,currentIndex\)/);
  assert.match(source,/event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
  assert.match(source,/selectProcess\(exact,\{focusQuantity:true\}\)/);
  assert.match(source,/production-quantity-input'\)\.addEventListener\('keydown'[\s\S]*?void saveEntry\(\)/);
  assert.match(source,/const quantityInput = element\('production-quantity-input'\)[\s\S]*?controls:\[quantityInput\]/);
  assert.match(source,/loadProcessTotal\(process\?\.id\)/);
  assert.match(source,/preview\?\.exceededQuantity > 0/);
  assert.match(source,/setPendingFilters\?\.\(\{/);
  assert.match(source,/date\.max = maximum/);
  assert.match(records,/function dateBadgeText\(value\)/);
  assert.match(records,/production-date-group-start/);
  assert.match(records,/function setPendingFilters\(filters=\{\}\)/);
  assert.match(records,/function applyPendingFilters\(\)/);
  assert.match(records,/window\.PCMSProductionRecords = Object\.freeze\(\{setPendingFilters\}\)/);
  assert.match(source,/dataset\.productionColumn/);
  assert.match(source,/event\.key !== 'Escape'/);
  assert.match(style,/\.production-entry-fields \{[\s\S]*?width: max-content;[\s\S]*?grid-template-columns: 172px 210px 160px 104px 126px;/);
  assert.match(style,/\.production-registration-header \{[\s\S]*?grid-template-columns: 180px minmax\(0, 1fr\);/);
  assert.match(style,/\.production-employee-inline-panel \{[\s\S]*?background: var\(--ui-color-surface-muted\);/);
  assert.match(style,/\.production-employee-inline-field \.ui-search-dropdown-control \{[\s\S]*?width: 112px;[\s\S]*?max-width: 112px;/);
  assert.match(style,/\.production-quantity-progress \{[\s\S]*?max-width: none;[\s\S]*?overflow: visible;/);
  assert.match(style,/\.production-quantity-progress\.is-over \{[\s\S]*?var\(--ui-color-danger-text\)/);
  assert.match(style,/\.production-records-table \.production-date-cell \{/);
  assert.match(style,/\.production-column-settings-menu \{[\s\S]*?position: absolute;/);
  assert.match(features,/productionEntryStore:'js\/production\/entry-store\.js\?v=20260809-2'/);
  assert.match(features,/productionEntry:'js\/production\/production-entry\.js\?v=20260809-8'/);
  assert.match(features,/productionRecords:'js\/production\/production-records\.js\?v=20260809-3'/);
});
