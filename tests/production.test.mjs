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

test('每日績效姓名優先顯示員工主資料並保留歷史快照備援',()=>{
  const recordsPage=read('js/production/production-records.js'); // recordsPage（生產紀錄頁程式內容）
  assert.match(recordsPage,/function employeeInfo\(employeeId,entries=\[\],attendance=null\)[\s\S]*?PCMSProductionEmployees\?\.find\?\.\(employeeId\)/);
  assert.match(recordsPage,/employee\?\.name \|\| snapshot\.employeeName/);
  assert.match(recordsPage,/addTextCell\(row,item\.employeeId/);
  assert.match(recordsPage,/addTextCell\(row,item\.employeeName/);
  assert.doesNotMatch(recordsPage,/`\$\{item\.employeeId\} · \$\{item\.employeeName\}`/);
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

test('工序0使用獨立補充工時欄位且單筆只接受0.5至24小時',()=>{
  const window=createProductionContext();
  const base={
    productionDate:'2026-08-08',employeeId:'M91234',orderId:'',productCode:'',processNo:'0',
    supplementReason:'返工處理',supplementHours:0.5
  }; // base（補充工時測試資料）
  const minimum=window.PCMSProductionEntryStore.validateEntryInput(base);
  const maximum=window.PCMSProductionEntryStore.validateEntryInput({...base,supplementHours:24});
  assert.equal(minimum.recordType,'supplement');
  assert.equal(minimum.supplementHours,0.5);
  assert.equal(maximum.supplementHours,24);
  assert.equal(window.PCMSProductionEntryStore.isSupplementEntry(minimum),true);
  assert.equal(window.PCMSProductionEntryStore.isValidSupplementHours(1.5),true);
  assert.equal(window.PCMSProductionEntryStore.isValidSupplementHours(0.25),false);
  assert.equal(window.PCMSProductionEntryStore.isValidSupplementHours(24.5),false);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...base,supplementHours:0.25}),/0.5至24小時/);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...base,supplementHours:24.5}),/0.5至24小時/);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...base,supplementReason:''}),/補充工時原因/);
  assert.throws(()=>window.PCMSProductionEntryStore.validateEntryInput({...base,orderId:'ORDER-ABC-2026'}),/訂單與款號/);
  assert.equal(window.PCMSProductionEntryStore.validateEntryInput({
    ...base,orderId:'ORDER-ABC-2026',productCode:'STYLE-500',supplementHours:2
  }).productCode,'STYLE-500');

  const entryStore=read('js/production/entry-store.js'); // entryStore（生產資料存取程式內容）
  const supplementSource=entryStore.match(/async function createSupplementEntry\(normalized\)\{[\s\S]*?(?=\n  async function createEntry)/)?.[0] || '';
  assert.ok(supplementSource,'找不到補充工時建立流程');
  assert.match(supplementSource,/recordType:'supplement'/);
  assert.match(supplementSource,/supplementHours:normalized\.supplementHours/);
  assert.doesNotMatch(supplementSource,/totalReference|productionProcessTotals|quantity:/);
});

test('考勤以0.5小時為單位且每日效率使用每小時產能與補充工時',()=>{
  const attendanceStore=read('js/production/attendance-store.js'); // attendanceStore（產能考勤資料存取程式內容）
  const window=createProductionContext();
  const context={window,console,Map,Object,Array,String,Number,Math,Date,Error,RegExp,Set};
  vm.createContext(context);
  vm.runInContext(attendanceStore,context);
  const attendance=window.PCMSProductionAttendance;
  assert.equal(attendance.isValidHours(0),true);
  assert.equal(attendance.isValidHours(0.5),true);
  assert.equal(attendance.isValidHours(0.25),false);
  assert.throws(()=>attendance.validateAttendanceInput({
    attendanceDate:'2026-08-08',employeeId:'M91234',normalHours:20,overtimeHours:4.5,note:''
  }),/不得超過24小時/);
  const entries=[
    {recordType:'standard',status:'active',quantity:500,hourlyCapacitySnapshot:500},
    {recordType:'supplement',status:'active',processNo:'0',supplementHours:2}
  ];
  const result=attendance.calculateEfficiency(entries,{normalHours:8,overtimeHours:2});
  assert.equal(result.standardHours,3);
  assert.equal(result.workedHours,10);
  assert.equal(result.percentage,30);
  assert.equal(attendance.calculateEfficiency(entries,null).status,'missing-attendance');
  assert.equal(attendance.calculateEfficiency(entries,{normalHours:0,overtimeHours:0}).status,'invalid-attendance');
  assert.equal(attendance.calculateEfficiency([],{normalHours:0,overtimeHours:0}).percentage,0);
  assert.match(attendanceStore,/const CACHE_SCOPE = 'productionAttendance'/);
  assert.match(attendanceStore,/const MAX_CACHED_DAYS = 31/);
  assert.match(attendanceStore,/const MAX_CACHED_RECORDS = 300/);
  assert.match(attendanceStore,/pcmsDataCache\?\.read\(CACHE_SCOPE,version\)/);
  assert.match(attendanceStore,/productionAttendance:dataVersionToken\(\)/);
});

test('管理員測試刪除保留在各來源功能並同步處理關聯資料',()=>{
  const employeeStore=read('js/production/employee-store.js'); // employeeStore（員工資料存取程式內容）
  const entryStore=read('js/production/entry-store.js'); // entryStore（生產資料存取程式內容）
  const employeePage=read('js/production/production-employees.js'); // employeePage（員工資料頁程式內容）
  const entryPage=read('js/production/production-entry.js'); // entryPage（生產登記頁程式內容）
  const attendanceStore=read('js/production/attendance-store.js'); // attendanceStore（考勤資料存取程式內容）
  const attendancePage=read('js/production/production-attendance.js'); // attendancePage（考勤頁程式內容）
  const recordsPage=read('js/production/production-records.js'); // recordsPage（每日績效頁程式內容）

  assert.match(employeeStore,/window\.cu\?\.role !== 'admin'/);
  assert.match(employeeStore,/_where\('employeeId','==',normalized\)/);
  assert.match(employeeStore,/transaction\.delete\(reference\)/);
  assert.match(entryStore,/window\.cu\?\.role !== 'admin'/);
  assert.match(entryStore,/nextRegistered === 0\) transaction\.delete\(totalReference\)/);
  assert.match(entryStore,/transaction\.delete\(entryReference\)/);
  assert.match(entryStore,/productionEntryDelete/);
  assert.match(attendanceStore,/async function deleteAttendance/);
  assert.match(attendanceStore,/transaction\.delete\(reference\)/);
  [employeePage,entryPage].forEach(source=>{
    assert.match(source,/window\.cu\?\.role === 'admin'/);
    assert.match(source,/永久刪除/);
  });
  assert.match(attendancePage,/window\.cu\?\.role === 'admin'/);
  assert.match(attendancePage,/刪除考勤/);
  assert.doesNotMatch(recordsPage,/deleteEntry|deleteAttendance|永久刪除/);
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
  assert.match(html,/<option value="__manage__">Quản lý bộ phận \/ 部門管理<\/option>/);
  assert.doesNotMatch(html,/id="production-department-(?:add|manage)-button"/);
  assert.match(employeePage,/const MANAGE_DEPARTMENT_VALUE = '__manage__'/);
  assert.match(employeePage,/function handleDepartmentSelection\(\)[\s\S]*?openDepartmentManager\(\)/);
  assert.match(employeePage,/production-employee-department-input'\)\.addEventListener\('change',handleDepartmentSelection\)/);
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
  assert.match(features,/production:'styles\/features\/production\.css\?v=20260810-9'/);
});

test('生產登記分開員工資訊與登記區且表格欄位可以按需顯示',()=>{
  const html=read('index.html');
  const source=read('js/production/production-entry.js');
  const records=read('js/production/production-records.js');
  const style=read('styles/features/production.css');
  const core=read('styles/ui-core.css');
  const controls=read('js/ui-table-controls.js');
  const features=read('js/features.js');
  const pageStart=html.indexOf('id="pg-production-entry"');
  const pageEnd=html.indexOf('<div class="pg',pageStart+1);
  const markup=html.slice(pageStart,pageEnd);
  assert.doesNotMatch(markup,/production-registration-title[\s\S]*?Đăng ký sản xuất[\s\S]*?生產登記/);
  assert.match(markup,/production-employee-inline-panel[\s\S]*?Mã nhân viên[\s\S]*?員工工號[\s\S]*?Tên nhân viên[\s\S]*?姓名[\s\S]*?Bộ phận[\s\S]*?部門[\s\S]*?Giờ chấm công[\s\S]*?員工考勤時數/);
  assert.match(markup,/production-registration-context[\s\S]*?production-date-input[\s\S]*?production-order-input[\s\S]*?production-product-input[\s\S]*?production-process-input[\s\S]*?production-quantity-input/);
  assert.doesNotMatch(markup,/production-save-button|Lưu sản lượng|儲存產量/);
  assert.match(markup,/tabindex="-1"[^>]*id="production-calendar-button"[\s\S]*?ti-calendar-time/);
  assert.match(markup,/tabindex="-1"[^>]*id="production-date-previous"[\s\S]*?tabindex="-1"[^>]*id="production-date-next"/);
  assert.match(markup,/id="production-quantity-input"[^>]*placeholder="Enter để lưu \/ Enter 儲存"/);
  assert.match(markup,/for="production-quantity-input"><strong id="production-quantity-label-vi">Số lượng<\/strong><span id="production-quantity-label-zh">數量<\/span>/);
  assert.match(markup,/id="production-process-input"[^>]*maxlength="2"[\s\S]*?id="production-process-name"/);
  assert.match(markup,/Sản lượng của nhân viên trong ngày[\s\S]*?id="production-quantity-progress"[\s\S]*?Đã đăng ký \/ Giới hạn đơn hàng[\s\S]*?已登記數量 \/ 訂單數量上限/);
  assert.match(markup,/id="production-entry-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.doesNotMatch(markup,/id="production-entry-status"[^>]*ui-notice/);
  assert.match(markup,/tabindex="-1"[^>]*id="production-column-settings-button"[^>]*aria-expanded="false"/);
  assert.match(markup,/id="production-column-settings-menu"[^>]*data-ui-table-columns-menu[^>]*hidden/);
  for(const key of ['order','product','processNo','processName','quantity','supplementHours','orderQuantity','processSeconds','hourlyCapacity','status','action']){
    assert.match(source,new RegExp(`key:'${key}'`));
    if(key !== 'action') assert.match(markup,new RegExp(`data-production-column="${key}"`));
  }
  assert.match(markup,/id="production-columns-empty"[^>]*hidden/);
  assert.match(source,/PCMSUITableControls\.create\(\{[\s\S]*?columns:PRODUCTION_TABLE_COLUMNS/);
  assert.match(markup,/id="production-entry-table"[^>]*data-ui-table-resizable="true"/);
  assert.match(html,/id="production-records-table"[^>]*data-ui-table-resizable="true"/);
  assert.match(source,/const ENTRY_TABLE_COLUMN_MINIMUMS = Object\.freeze\(Object\.fromEntries\(/);
  for(const key of ['order','product','processNo','processName','quantity','supplementHours','orderQuantity','processSeconds','hourlyCapacity','status','action']){
    assert.match(source,new RegExp(`key:'${key}'[^\\n]*minimum:[^\\n]*preferred:[^\\n]*maximum:`));
  }
  assert.match(controls,/ui-table-column-settings-heading/);
  assert.match(controls,/selectAll\.indeterminate = selected > 0 && selected < toggles\.length/);
  assert.match(controls,/resetColumns\(\)/);
  assert.match(source,/const ENTRY_INPUT_IDS = Object\.freeze\(\[/);
  assert.match(source,/function confirmProcessForForwardTab\(\)/);
  assert.match(source,/function handleEntryTab\(event,currentId\)/);
  assert.match(source,/!event\.shiftKey && currentId === 'production-process-input' && !confirmProcessForForwardTab\(\)/);
  assert.match(source,/event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
  assert.match(source,/selectProcess\(exact,\{focusQuantity:true\}\)/);
  assert.match(source,/production-quantity-input'\)\.addEventListener\('keydown'[\s\S]*?void saveEntry\(\)/);
  assert.match(source,/const quantityInput = element\('production-quantity-input'\)[\s\S]*?controls:supplement \? \[reasonInput,quantityInput\] : \[quantityInput\]/);
  assert.match(source,/function setSupplementMode\(enabled,options=\{\}\)/);
  assert.match(source,/processNo:supplement \? '0' : state\.process\?\.processNo/);
  assert.match(source,/supplementHours:supplement \? quantityInput\.value : undefined/);
  assert.match(source,/function hourlyCapacityText\(value\)/);
  assert.match(source,/hourlyCapacityText\(item\.hourlyCapacitySnapshot\)/);
  assert.doesNotMatch(source,/hourlyCapacityText\([^)]*processSecSnapshot/);
  assert.match(source,/item\.productCode \|\| '—','production-product-code-cell','product'/);
  assert.match(source,/production-supplement-help-button'\)\.addEventListener\('click'/);
  assert.match(source,/production-supplement-dialog-backdrop/);
  assert.match(source,/new ResizeObserver\(updatePosition\)/);
  assert.match(source,/document\.querySelector\('#ma > \.mn'\)/);
  assert.match(source,/updateSupplementHours\(item\.id,Number\(valueText\),reason\)/);
  assert.match(source,/voidEntry\(item\.id,reason\)/);
  assert.match(source,/loadDaily\([\s\S]*?\{activeOnly:false\}/);
  assert.doesNotMatch(records,/updateSupplementHours|voidEntry|deleteEntry/);
  assert.match(source,/loadProcessTotal\(process\?\.id\)/);
  assert.match(source,/preview\?\.exceededQuantity > 0/);
  assert.match(source,/value\.textContent = `\$\{numberText\(summary\.registeredQuantity\)\} \/ \$\{numberText\(summary\.orderQuantity\)\}`/);
  assert.match(source,/function employeeOptionCopy\(item\)\{[\s\S]*?primary:item\.employeeId,secondary:''/);
  assert.match(source,/function setProcessName\(process\)/);
  assert.match(source,/function focusSelectedProcessRows\(\)/);
  assert.match(source,/row\.dataset\.orderProcessId/);
  assert.doesNotMatch(source,/setPendingFilters|PCMSProductionRecords/);
  assert.match(source,/date\.max = maximum/);
  assert.match(records,/function dateBadgeText\(value\)/);
  assert.match(records,/production-date-group-start/);
  assert.doesNotMatch(records,/setPendingFilters/);
  assert.match(records,/PCMSProductionEntry\?\.setPendingContext/);
  assert.match(source,/window\.PCMSProductionEntry = Object\.freeze\(\{setPendingContext\}\)/);
  assert.match(source,/dataset\.productionColumn/);
  assert.match(source,/event\.key !== 'Escape'/);
  assert.match(style,/\.production-entry-fields \{[\s\S]*?display: flex;[\s\S]*?width: 100%;[\s\S]*?flex-wrap: nowrap;[\s\S]*?gap: clamp\(5px, \.65vw, 10px\);/);
  assert.match(style,/\.production-process-field \.ui-search-dropdown-control \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/);
  assert.match(style,/\.production-registration-header \{[\s\S]*?width: 100%;[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?background: var\(--ui-color-table-header\);/);
  assert.match(style,/\.production-employee-inline-panel \{[\s\S]*?grid-template-columns: minmax\(210px, 1\.15fr\)[\s\S]*?minmax\(68px, 86px\);[\s\S]*?background: var\(--ui-color-table-header\);/);
  assert.match(style,/\.production-employee-inline-field \.ui-search-dropdown-control \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/);
  assert.match(style,/\.production-quantity-progress \{[\s\S]*?width: clamp\(210px, 31%, 390px\);[\s\S]*?min-width: 0;[\s\S]*?background: var\(--ui-color-primary-soft\);/);
  assert.match(style,/#production-quantity-progress-value \{[\s\S]*?font-size: 20px;[\s\S]*?font-variant-numeric: tabular-nums;/);
  assert.match(style,/\.production-quantity-progress\.is-over \{[\s\S]*?var\(--ui-color-danger-background\)[\s\S]*?var\(--ui-color-danger-text\)/);
  assert.match(style,/\.production-entry-table th\.production-number-cell,[\s\S]*?\.production-entry-table td\.production-number-cell \{[\s\S]*?text-align: right;/);
  assert.match(style,/\.production-entry-table th\.production-number-cell > \.ui-dual-copy \{[\s\S]*?align-items: flex-end;/);
  assert.match(style,/\.production-entry-table \{[\s\S]*?width: 100%;[\s\S]*?min-width: max\(100%, var\(--ui-table-visible-min-width, 1160px\)\);[\s\S]*?table-layout: fixed;/);
  assert.match(style,/data-production-column="order"\] \{[\s\S]*?width: 130px;/);
  assert.match(style,/data-production-column="processName"\] \{[\s\S]*?width: auto;/);
  assert.match(style,/data-production-column="supplementHours"\]/);
  assert.match(style,/data-production-column="hourlyCapacity"\] \{[\s\S]*?width: 105px;/);
  assert.match(style,/\.production-value-badge \{[\s\S]*?display: inline-flex;[\s\S]*?background: var\(--ui-color-primary-soft\);/);
  assert.match(style,/\.production-entry-table td\.production-product-code-cell \{[\s\S]*?font-weight: 700;/);
  assert.match(style,/data-production-column="processNo"\],[\s\S]*?data-production-column="processNo"\] \{[\s\S]*?text-align: center;/);
  assert.match(style,/\.production-entry-table td\.production-row-actions \{[\s\S]*?display: table-cell;[\s\S]*?text-align: center;/);
  assert.match(style,/\.production-records-table \.production-date-cell \{/);
  assert.match(style,/\.production-data-section \.ui-table-scroll \{[\s\S]*?overflow-x: auto;/);
  assert.match(style,/\.production-records-table,[\s\S]*?\.production-performance-table \{[\s\S]*?width: 100%;[\s\S]*?min-width: max\(100%, var\(--ui-table-visible-min-width, 1100px\)\);[\s\S]*?table-layout: fixed;/);
  assert.match(style,/\.production-records-table td\.production-row-actions \{[\s\S]*?display: table-cell;/);
  assert.match(style,/\.production-supplement-dialog-backdrop \.ui-dialog \{[\s\S]*?--production-dialog-center-x/);
  assert.match(core,/\.ui-table-column-settings-menu \{[\s\S]*?position: absolute;/);
  assert.match(features,/productionEntryStore:'js\/production\/entry-store\.js\?v=20260809-3'/);
  assert.match(features,/productionReportStore:'js\/production\/report-store\.js\?v=20260810-3'/);
  assert.match(features,/productionAttendanceStore:'js\/production\/attendance-store\.js\?v=20260810-1'/);
  assert.match(features,/productionEntry:'js\/production\/production-entry\.js\?v=20260810-5'/);
  assert.match(features,/productionRecords:'js\/production\/production-records\.js\?v=20260810-3'/);
  assert.match(features,/productionAttendance:'js\/production\/production-attendance\.js\?v=20260810-2'/);
  assert.match(features,/productionEmployees:'js\/production\/production-employees\.js\?v=20260810-3'/);
  assert.match(features,/production:'styles\/features\/production\.css\?v=20260810-9'/);
  assert.match(html,/js\/features\.js\?v=20260810-12/);
});

test('產能三個藍底操作區維持單排且員工績效使用員工搜尋',()=>{
  const html=read('index.html');
  const records=read('js/production/production-records.js');
  const reportStore=read('js/production/report-store.js');
  const employees=read('js/production/production-employees.js');
  const style=read('styles/features/production.css');
  const core=read('styles/ui-core.css');
  assert.match(html,/Hiệu suất nhân viên[\s\S]*?員工績效/);
  assert.match(html,/id="production-records-table"[^>]*data-ui-table-sort="none"/);
  assert.match(html,/id="production-record-search"[^>]*placeholder="Mã, tên, bộ phận \/ 工號、姓名、部門"/);
  assert.doesNotMatch(html,/id="production-record-(?:employee|order|product|process)"/);
  assert.match(records,/search:normalize\(element\('production-record-search'\)\.value\)/);
  assert.match(records,/element\('production-record-search'\)\.addEventListener\('input',render\)/);
  assert.match(records,/item\.employeeId,item\.employeeName,item\.department/);
  assert.match(reportStore,/async function loadRange\(fromValue,toValue,options=\{\}\)/);
  assert.match(style,/\.production-filter-grid \{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?align-items: end;/);
  assert.doesNotMatch(style,/\.production-filter-actions \{[\s\S]*?grid-column:/);
  assert.match(style,/\.production-filter-actions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(style,/\.production-attendance-fields \{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?align-items: end;/);
  assert.match(style,/\.production-employee-fields \{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?align-items: end;/);
  assert.match(style,/\.production-date-stepper \{[\s\S]*?width: 16px;[\s\S]*?height: 28px;/);
  assert.doesNotMatch(style,/\.production-date-stepper \{[\s\S]*?border-left:/);
  assert.match(core,/\.ui-button\.is-primary \.ui-dual-copy > span \{[\s\S]*?color: inherit;/);
  assert.match(employees,/handleDepartmentSelection/);
});

test('生產紀錄綜合搜尋可比對表格中的工號姓名訂單款號工序數值與日期',()=>{
  const context={window:{},console,Object,Array,String,Number,Date,Map,RegExp};
  vm.createContext(context);
  vm.runInContext(read('js/production/report-store.js'),context);
  const rows=[{
    id:'A',productionDate:'2026-08-10',employeeId:'M12345',displayEmployeeName:'Hỏa Vương',department:'May',
    orderNo:'OD-7788',productCode:'STYLE-500',processNo:'12',processNameVi:'May thân',processNameZh:'車身',
    quantity:500,orderQuantitySnapshot:1000,processSecSnapshot:48,hourlyCapacitySnapshot:63,displayEfficiency:'87.5%',status:'active'
  },{
    id:'B',productionDate:'2026-08-09',employeeId:'M90000',displayEmployeeName:'Lan',department:'Đóng gói',
    orderNo:'OD-9900',productCode:'STYLE-900',processNo:'3',processNameVi:'Kiểm tra',processNameZh:'檢查',
    quantity:300,displayEfficiency:'100.0%',status:'voided'
  }];
  const filter=search=>context.window.PCMSProductionReports.filterRows(rows,{search});
  assert.equal(filter('12345 style-500 12').length,1);
  assert.equal(filter('Hỏa 87.5%')[0].id,'A');
  assert.equal(filter('10/08/2026')[0].id,'A');
  assert.equal(filter('1000 48 63')[0].id,'A');
  assert.equal(filter('檢查 300')[0].id,'B');
  assert.equal(filter('不存在').length,0);
});

test('員工績效依原日期標籤分組並可返回當日生產登記',()=>{
  const html=read('index.html');
  const features=read('js/features.js');
  const records=read('js/production/production-records.js');
  const entry=read('js/production/production-entry.js');
  const attendance=read('js/production/production-attendance.js');
  const style=read('styles/features/production.css');
  assert.match(features,/page:'production-records'[\s\S]*?vi:'Hiệu suất nhân viên',zh:'員工績效'/);
  assert.match(html,/Hiệu suất nhân viên[\s\S]*?員工績效/);
  assert.match(html,/data-ui-table-column="employeeId" data-ui-table-default-visible="false"/);
  for(const status of ['ready','missing-attendance','invalid-attendance','invalid-capacity']){
    assert.match(html,new RegExp(`<option value="${status}">`));
  }
  assert.match(records,/PCMSProductionReports\.loadRange\(current\.from,current\.to,\{activeOnly:true\}\)/);
  assert.match(records,/dates\.map\(date=>window\.PCMSProductionAttendance\.loadDay\(date\)\)/);
  assert.match(records,/PCMSProductionAttendance\.calculateEfficiency\(group\.entries,group\.attendance\)/);
  assert.match(records,/function dateBadgeText\(value\)/);
  assert.match(records,/if\(groupStart\) row\.classList\.add\('production-date-group-start'\)/);
  assert.match(style,/\.production-date-badge \{/);
  assert.match(style,/\.production-records-table tr\.production-date-group-start > td/);
  assert.match(records,/PCMSProductionEntry\?\.setPendingContext\?\.\(\{/);
  assert.match(entry,/function setPendingContext\(context=\{\}\)/);
  assert.match(entry,/function focusSelectedProcessRows\(\)/);
  assert.match(entry,/matches\[0\]\.scrollIntoView/);
  assert.match(entry,/`\$\{hoursText\(total\)\} giờ`/);
  assert.match(entry,/`\$\{hoursText\(total\)\} 小時`/);
  assert.doesNotMatch(entry,/正常 \$\{hoursText\(normal\)\} \+ 加班/);
  assert.doesNotMatch(html,/data-ui-table-column="note"/);
  assert.doesNotMatch(attendance,/function createNoteInput/);
  assert.match(attendance,/note:draft\.note/);
  assert.match(style,/\.production-attendance-table \{[\s\S]*?820px/);
});

test('考勤分頁沿用正式操作面板與表格並位於生產紀錄及員工資料之間',()=>{
  const html=read('index.html');
  const features=read('js/features.js');
  const attendancePage=read('js/production/production-attendance.js');
  assert.ok(html.indexOf('id="pg-production-records"') < html.indexOf('id="pg-production-attendance"'));
  assert.ok(html.indexOf('id="pg-production-attendance"') < html.indexOf('id="pg-production-employees"'));
  assert.match(html,/id="pg-production-attendance"[\s\S]*?ui-operation-panel[\s\S]*?ui-data-section[\s\S]*?id="production-attendance-table"[\s\S]*?data-ui-table-resizable="true"/);
  assert.match(html,/id="production-records-table"[\s\S]*?data-ui-table-column="employeeId"[\s\S]*?data-ui-table-column="employeeName"[\s\S]*?data-ui-table-column="efficiency"/);
  assert.match(features,/page:'production-attendance',feature:'productionAttendance'/);
  assert.match(features,/productionRecords','productionAttendance','productionEmployees'/);
  assert.match(attendancePage,/PCMSProductionAttendance\.saveMany\(inputs\)/);
  assert.match(attendancePage,/production-attendance-batch-normal/);
  assert.match(attendancePage,/production-attendance-batch-overtime/);
});

test('當日表格原表頭由共用控制依主內容可視邊界凍結且不重算欄寬',()=>{
  const html=read('index.html');
  const source=read('js/ui-table.js');
  const style=read('styles/ui-core.css');
  assert.match(html,/id="production-entry-table"[^>]*data-ui-table-sticky="original"/);
  assert.match(source,/STICKY_TABLE_SELECTOR = 'table\[data-ui-table-sticky="original"\]'/);
  assert.match(source,/function refreshStickyHeaders\(contentRect\)/);
  assert.match(source,/const offset = Math\.min\(maximumOffset,Math\.max\(0,contentRect\.top-tableRect\.top\)\)/);
  assert.match(source,/scrollHost\.addEventListener\('scroll',scheduleUpdate,\{passive:true\}\)/);
  assert.match(source,/new ResizeObserver\(scheduleUpdate\)/);
  assert.match(source,/window\.visualViewport\?\.addEventListener\('resize',scheduleUpdate\)/);
  assert.doesNotMatch(source,/cloneNode\(/);
  assert.match(style,/\.ui-table\[data-ui-table-sticky="original"\] thead \{[\s\S]*?transform: translateY\(var\(--ui-table-header-offset\)\);/);
  assert.match(style,/\.ui-table\[data-ui-table-sticky="original"\] thead th \{[\s\S]*?background: var\(--ui-color-table-header\);/);
  assert.match(style,/\.ui-table\[data-ui-table-sticky="original"\]\.is-ui-header-frozen thead \{[\s\S]*?z-index: 8;/);
});
