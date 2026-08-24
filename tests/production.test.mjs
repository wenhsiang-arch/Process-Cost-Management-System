import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

function createProductionContext(){
  const employeeDocuments=[
    {id:'M91234',data:()=>({employeeId:'M91234',name:'Nguyễn An',department:'May',active:true})},
    {id:'A55678',data:()=>({employeeId:'A55678',name:'Trần Bình',department:'Đóng gói',active:true})},
    {id:'M05713',data:()=>({employeeId:'M05713',name:'TRẦN THỊ CÚC',department:'May',active:true})},
    {id:'M09999',data:()=>({employeeId:'M09999',name:'ĐỖ THỊ HOA',department:'May',active:true})}
  ]; // employeeDocuments（員工測試資料）
  const window={
    firebaseAuthUser:{uid:'clerk-user'},
    cu:{user:'文員測試'},
    _collection:name=>name,
    _docRef:(collection,id)=>({collection,id}),
    _getDocs:async()=>({docs:employeeDocuments}),
    firebaseLoadCachedCollection:async()=>employeeDocuments.map(item=>({id:item.id,...item.data()}))
  };
  const context={window,console,Map,Object,Array,String,Number,Math,Date,Error,RegExp};
  vm.createContext(context);
  vm.runInContext(read('js/ui-search-dropdown.js'),context);
  vm.runInContext(read('js/production/employee-store.js'),context);
  return window;
}

function createEmployeeMutationContext(options={}){
  const employeeRow={employeeId:'M91234',name:'Nguyễn An',department:'May',active:true,createdAt:1,createdByUid:'admin-user',createdBy:'管理員',updatedAt:1,updatedByUid:'admin-user',updatedBy:'管理員',schemaVersion:1};
  const documents=new Map([
    ...(!options.omitEmployee?[['productionEmployees/M91234',employeeRow]]:[]),
    ['productionDepartments/may',{departmentId:'may',name:'May',active:true}],
    ['productionDepartments/%C4%91%C3%B3ng%20g%C3%B3i',{departmentId:'%C4%91%C3%B3ng%20g%C3%B3i',name:'Đóng gói',active:true}],
    ...(options.history||[]).map(({collection,id,data})=>[`${collection}/${id}`,data])
  ]); // documents（員工異動測試資料）
  const keyOf=reference=>`${reference.collection}/${reference.id}`; // keyOf（測試文件位置）
  let logSequence=0;
  const collectionRows=collectionName=>[...documents.entries()]
    .filter(([key])=>key.startsWith(`${collectionName}/`))
    .map(([key,data])=>({id:key.slice(collectionName.length+1),data:()=>({...data})}));
  const window={
    firebaseAuthUser:{uid:'clerk-user'},
    cu:{role:options.role||'admin',user:'管理員測試'},
    _collection:collection=>collection,
    _docRef:(collection,id)=>({collection,id}),
    _newDocRef:collection=>({collection,id:`log-${++logSequence}`}),
    _where:(field,operator,value)=>({field,operator,value}),
    _limit:value=>({limit:value}),
    _query:(collection,...constraints)=>({collection,constraints}),
    _getDocs:async queryReference=>{
      if(options.denyHistoryReads) throw new Error('permission-denied');
      const rows=collectionRows(queryReference.collection);
      const whereConstraint=queryReference.constraints.find(item=>item.field);
      const limitConstraint=queryReference.constraints.find(item=>item.limit);
      const filtered=whereConstraint
        ? rows.filter(item=>item.data()[whereConstraint.field]===whereConstraint.value)
        : rows;
      const docs=filtered.slice(0,limitConstraint?.limit||filtered.length);
      return {size:docs.length,docs};
    },
    firebaseLoadCachedCollection:async collectionName=>collectionRows(collectionName).map(item=>({id:item.id,...item.data()})),
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

function createAttendanceBatchContext(options={}){
  const employees=new Map(Array.from({length:22},(_,index)=>{
    const employeeId=`M${String(index+1).padStart(5,'0')}`;
    return [employeeId,{employeeId,name:`Nhân viên ${index+1}`,department:'May',active:true}];
  })); // employees（批次考勤員工測試資料）
  const documents=new Map();
  documents.set('productionMonths/2026-08',{
    month:'2026-08',status:'open',summaryReady:true,entriesVersion:'E1',attendanceVersion:'A1',
    summaryVersion:'S1',revision:1,updatedAt:1,updatedByUid:'admin',updatedBy:'Admin',schemaVersion:2
  });
  const failedTransactions=new Set(options.failedTransactions||[]);
  const transactionAttendanceCounts=[];
  const markerCalls=[];
  let transactionCount=0;
  let logSequence=0;
  const keyOf=reference=>`${reference.collection}/${reference.id}`;
  const snapshotFor=reference=>{
    const data=reference.collection==='productionEmployees'
      ? employees.get(reference.id)
      : documents.get(keyOf(reference));
    return {exists:()=>!!data,data:()=>data?{...data}:undefined};
  };
  const window={
    firebaseAuthUser:{uid:'clerk-user'},
    cu:{user:'文員測試'},
    PCMSProductionEmployees:{normalizeEmployeeId:value=>String(value||'').trim().toUpperCase()},
    PCMSProductionChanges:{markSafely:async rows=>{ markerCalls.push(rows.map(item=>item.employeeId)); return true; }},
    PCMSFeatures:{invalidateDataScopes:()=>{}},
    pcmsDataCache:{remove:async()=>{}},
    _increment:value=>({__increment:Number(value)}),
    _docRef:(collection,id)=>({collection,id}),
    _newDocRef:collection=>({collection,id:`log-${++logSequence}`}),
    _runTransaction:async task=>{
      transactionCount += 1;
      const currentTransaction=transactionCount;
      const writes=[];
      const transaction={
        get:async reference=>snapshotFor(reference),
        set:(reference,data,settings)=>writes.push({reference,data:{...data},settings})
      };
      const result=await task(transaction);
      transactionAttendanceCounts.push(writes.filter(item=>item.reference.collection==='productionAttendance').length);
      if(failedTransactions.has(currentTransaction)){
        failedTransactions.delete(currentTransaction);
        const error=new Error('Missing or insufficient permissions.');
        error.code='permission-denied';
        throw error;
      }
      writes.forEach(item=>{
        const previous=documents.get(keyOf(item.reference))||{};
        const next=item.settings?.merge?{...previous,...item.data}:{...item.data};
        Object.entries(next).forEach(([field,value])=>{
          if(value&&typeof value==='object'&&Number.isFinite(value.__increment)){
            next[field]=(Number(previous[field])||0)+value.__increment;
          }
        });
        documents.set(keyOf(item.reference),next);
      });
      return result;
    }
  };
  const context={window,console,Map,Object,Array,String,Number,Math,Date,Error,RegExp,Set,Promise};
  vm.createContext(context);
  vm.runInContext(read('js/production/efficiency-core.js'),context);
  vm.runInContext(read('js/production/linked-summary-store.js'),context);
  vm.runInContext(read('js/production/production-guard-store.js'),context);
  vm.runInContext(read('js/production/attendance-store.js'),context);
  const inputs=[...employees.values()].map(employee=>({
    attendanceDate:'2026-08-13',employeeId:employee.employeeId,normalHours:8,overtimeHours:3.5,note:''
  }));
  return {
    window,inputs,documents,markerCalls,transactionAttendanceCounts,
    transactionCount:()=>transactionCount
  };
}

function createStableContextRuntime(monthStates){
  const states=monthStates.map(item=>({...item}));
  const stats={monthReads:0,attendanceLoads:[],entryLoads:[]};
  const window={
    _docRef:(collection,id)=>({collection,id}),
    _getDoc:async reference=>{
      assert.equal(reference.collection,'productionMonths');
      const state=states[Math.min(stats.monthReads,states.length-1)]||{};
      stats.monthReads+=1;
      return {exists:()=>true,data:()=>({...state})};
    },
    PCMSProductionAttendance:{
      loadOne:async (employeeId,productionDate,options)=>{
        stats.attendanceLoads.push({employeeId,productionDate,...options});
        return {employeeId,attendanceDate:productionDate,normalHours:Number(String(options.version).replace(/\D/g,''))||8,overtimeHours:0};
      }
    },
    PCMSProductionReports:{
      loadEmployeeRange:async (employeeId,from,to,options)=>{
        stats.entryLoads.push({employeeId,from,to,...options});
        return [{id:`entry-${options.version}`,employeeId,productionDate:to,status:'active'}];
      }
    }
  };
  const context={
    window,document:{getElementById:()=>null},console,Map,Set,Object,Array,String,Number,Math,Date,Error,RegExp,Promise,
    setTimeout,clearTimeout,requestAnimationFrame:callback=>callback()
  };
  vm.createContext(context);
  vm.runInContext(read('js/production/production-entry.js'),context);
  return {window,stats};
}

test('員工情境共用月份前後核對，且只重讀實際變動的來源',async()=>{
  const base={employeeId:'M91234',productionDate:'2026-08-16',from:'2026-08-01',to:'2026-08-31'};
  {
    const {window,stats}=createStableContextRuntime([
      {entriesVersion:'E1',attendanceVersion:'A1'},
      {entriesVersion:'E1',attendanceVersion:'A2'},
      {entriesVersion:'E1',attendanceVersion:'A2'}
    ]);
    const result=await window.PCMSProductionEntry.loadStableContext(base);
    assert.equal(result.attempts,2);
    assert.equal(result.attendanceLoads,2);
    assert.equal(result.entryLoads,1);
    assert.equal(stats.monthReads,3);
    assert.deepEqual(stats.attendanceLoads.map(item=>item.version),['A1','A2']);
    assert.deepEqual(stats.entryLoads.map(item=>item.version),['2026-08:E1']);
  }
  {
    const {window,stats}=createStableContextRuntime([
      {entriesVersion:'E1',attendanceVersion:'A1'},
      {entriesVersion:'E2',attendanceVersion:'A1'},
      {entriesVersion:'E2',attendanceVersion:'A1'}
    ]);
    const result=await window.PCMSProductionEntry.loadStableContext(base);
    assert.equal(result.attendanceLoads,1);
    assert.equal(result.entryLoads,2);
    assert.equal(stats.monthReads,3);
    assert.deepEqual(stats.attendanceLoads.map(item=>item.version),['A1']);
    assert.deepEqual(stats.entryLoads.map(item=>item.version),['2026-08:E1','2026-08:E2']);
  }
  {
    const {window,stats}=createStableContextRuntime([
      {entriesVersion:'E1',attendanceVersion:'A1'},
      {entriesVersion:'E2',attendanceVersion:'A2'},
      {entriesVersion:'E2',attendanceVersion:'A2'}
    ]);
    const result=await window.PCMSProductionEntry.loadStableContext(base);
    assert.equal(result.attendanceLoads,2);
    assert.equal(result.entryLoads,2);
    assert.equal(stats.monthReads,3);
  }
});

test('員工情境月份連續變動時最多重試兩次，不形成無限讀取',async()=>{
  const {window,stats}=createStableContextRuntime([
    {entriesVersion:'E1',attendanceVersion:'A1'},
    {entriesVersion:'E2',attendanceVersion:'A2'},
    {entriesVersion:'E3',attendanceVersion:'A3'},
    {entriesVersion:'E4',attendanceVersion:'A4'}
  ]);
  await assert.rejects(
    window.PCMSProductionEntry.loadStableContext({
      employeeId:'M91234',productionDate:'2026-08-16',from:'2026-08-01',to:'2026-08-31'
    }),
    /Dữ liệu sản xuất|產能資料/
  );
  assert.equal(stats.monthReads,4);
  assert.equal(stats.attendanceLoads.length,3);
  assert.equal(stats.entryLoads.length,3);
});

test('員工工號、姓名及部門可用整段任意文字搜尋',async()=>{
  const window=createProductionContext();
  await window.PCMSProductionEmployees.load();
  const employees=window.PCMSProductionEmployees.list({activeOnly:true});
  const match=query=>window.PCMSUISearchDropdown.matchItems(employees,query,{
    fields:[
      {value:item=>item.employeeId,mode:'code'},
      {value:item=>item.name,mode:'text'},
      {value:item=>item.department,mode:'text'}
    ]
  }).items;
  assert.equal(match('1234')[0].employeeId,'M91234');
  assert.equal(match('uyễn')[0].employeeId,'M91234');
  assert.equal(match('gói')[0].employeeId,'A55678');
  assert.equal(match('CUC')[0].employeeId,'M05713');
  assert.equal(match('tran thi cuc')[0].employeeId,'M05713');
  assert.equal(match('do thi hoa')[0].employeeId,'M09999');
  assert.equal(window.PCMSProductionEmployees.validateEmployee({employeeId:'m91234',name:'A',department:'B'}).employeeId,'M91234');
});

test('每日績效姓名優先顯示員工主資料並保留歷史快照備援',()=>{
  const recordsPage=read('js/production/production-records.js'); // recordsPage（生產紀錄頁程式內容）
  assert.match(recordsPage,/function employeeInfo\(employeeId,entries=\[\],attendance=null\)[\s\S]*?PCMSProductionEmployees\?\.find\?\.\(employeeId\)/);
  assert.match(recordsPage,/employee\?\.name \|\| snapshot\.employeeName/);
  assert.match(recordsPage,/addTextCell\(row,item\.employeeId/);
  assert.match(recordsPage,/addEmployeeCell\(row,item\)/);
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

test('員工有任一歷史業務資料只能停用，工號永久不得重新分配',async()=>{
  const historyCollections=[
    'productionEntries','productionAttendance','productionDaySummaries','productionEmployeeMonths'
  ];
  for(const collection of historyCollections){
    const {window,documents}=createEmployeeMutationContext({
      history:[{collection,id:`history-${collection}`,data:{employeeId:'M91234'}}]
    });
    await window.PCMSProductionEmployees.load();
    await assert.rejects(window.PCMSProductionEmployees.deleteEmployee('M91234'),/只能停用，不得永久刪除/);
    assert.equal(documents.get('productionEmployees/M91234').active,false);
  }

  const reused=createEmployeeMutationContext({
    omitEmployee:true,
    history:[{collection:'productionAttendance',id:'2026-08-16__M91234',data:{employeeId:'M91234'}}]
  });
  await assert.rejects(
    reused.window.PCMSProductionEmployees.createEmployee({employeeId:'M91234',name:'另一位員工',department:'May'}),
    /永久不得重新分配/
  );
  assert.equal(reused.documents.has('productionEmployees/M91234'),false);
});

test('只有已停用且完全沒有歷史資料的錯誤員工可以永久刪除',async()=>{
  const {window,documents}=createEmployeeMutationContext();
  await window.PCMSProductionEmployees.load();
  await window.PCMSProductionEmployees.deleteEmployee('M91234');
  assert.equal(documents.has('productionEmployees/M91234'),false);
  const logs=[...documents.entries()].filter(([key])=>key.startsWith('operationLogs/'));
  assert.equal(logs.length,1);
  assert.equal(logs[0][1].action,'productionEmployeeDelete');
});

test('非管理員員工管理角色新增員工時不會取得無權限的歷史業務資料',async()=>{
  const {window,documents}=createEmployeeMutationContext({role:'clerk',denyHistoryReads:true});
  const saved=await window.PCMSProductionEmployees.createEmployee({
    employeeId:'M93333',name:'New Employee',department:'May'
  });
  assert.equal(saved.employeeId,'M93333');
  assert.equal(documents.get('productionEmployees/M93333').active,true);
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
    {recordType:'standard',status:'active',quantity:500,hourlyCapacity:500},
    {recordType:'supplement',status:'active',processNo:'0',supplementHours:2}
  ];
  const result=attendance.calculateEfficiency(entries,{normalHours:8,overtimeHours:2});
  assert.equal(result.standardHours,3);
  assert.equal(result.workedHours,10);
  assert.equal(result.percentage,30);
  assert.equal(attendance.calculateEfficiency(entries,null).status,'missing-attendance');
  assert.equal(attendance.calculateEfficiency(entries,{normalHours:0,overtimeHours:0}).status,'invalid-attendance');
  const absent=attendance.calculateEfficiency([],{normalHours:0,overtimeHours:0});
  assert.equal(absent.status,'absent');
  assert.equal(absent.percentage,null);
  assert.match(attendanceStore,/const CACHE_SCOPE = 'productionAttendance'/);
  assert.match(attendanceStore,/const CACHE_DAY_PREFIX = 'productionAttendanceDay:'/);
  assert.match(attendanceStore,/_docRef\('productionMonths',month\)/);
  assert.match(attendanceStore,/pcmsDataCache\.read\(dayCacheScope\(attendanceDate\),version\)/);
  assert.doesNotMatch(attendanceStore,/MAX_CACHED_DAYS|MAX_CACHED_RECORDS/);
  assert.doesNotMatch(attendanceStore,/PCMSProductionChanges|productionDayChanges|processQueue/);
  assert.match(attendanceStore,/snapshot\.data\(\)\?\.attendanceVersion/);
  assert.doesNotMatch(attendanceStore,/firebaseReadDataVersions|system','dataVersions/);
  assert.doesNotMatch(attendanceStore,/productionAttendance:dataVersionToken\(\)/);
});

test('考勤連同日月摘要每兩位分批，失敗只重試未完成員工',async()=>{
  const complete=createAttendanceBatchContext();
  const progress=[];
  const saved=await complete.window.PCMSProductionAttendance.saveMany(complete.inputs,{
    onProgress:item=>progress.push(item.completed)
  });
  assert.equal(saved.length,22);
  assert.equal(complete.transactionCount(),11);
  assert.deepEqual(complete.transactionAttendanceCounts,[2,2,2,2,2,2,2,2,2,2,2]);
  assert.deepEqual(progress,[2,4,6,8,10,12,14,16,18,20,22]);
  assert.equal(complete.markerCalls.flat().length,0);

  const partial=createAttendanceBatchContext({failedTransactions:[2]});
  let partialError=null;
  await assert.rejects(
    partial.window.PCMSProductionAttendance.saveMany(partial.inputs),
    error=>{
      partialError=error;
      assert.equal(error.code,'permission-denied');
      assert.equal(error.savedCount,2);
      assert.equal(error.remainingCount,20);
      assert.equal(error.savedRows.length,2);
      assert.equal(error.pendingInputs.length,20);
      return true;
    }
  );
  assert.equal(partial.markerCalls.flat().length,0);
  const retried=await partial.window.PCMSProductionAttendance.saveMany(partialError.pendingInputs);
  assert.equal(retried.length,20);
  assert.equal(partial.transactionCount(),12);
  assert.deepEqual(partial.transactionAttendanceCounts,[2,2,2,2,2,2,2,2,2,2,2,2]);
  assert.equal(partial.documents.size>0,true);

  const attendancePage=read('js/production/production-attendance.js');
  assert.match(attendancePage,/confirmDialog\(\{[\s\S]*?Lưu thay đổi chấm công[\s\S]*?儲存考勤修改/);
  assert.match(attendancePage,/progressDialog\(\{[\s\S]*?Tiến độ lưu chấm công[\s\S]*?考勤儲存進度/);
  assert.match(attendancePage,/applySavedRows\(error\?\.savedRows\)/);
  assert.match(attendancePage,/尚有 \$\{remainingCount\} 位未儲存/);
});

test('產能與考勤快取依日期或查詢條件保存且不再每次強制重讀',()=>{
  const reportStore=read('js/production/report-store.js');
  const attendancePage=read('js/production/production-attendance.js');
  const featureSource=read('js/features.js');
  const currentSources=[
    read('js/production/linked-entry-store.js'),read('js/production/attendance-store.js'),
    read('js/production/linked-summary-store.js')
  ].join('\n');
  assert.match(reportStore,/const CACHE_PREFIX = 'productionEntriesQuery:'/);
  assert.match(reportStore,/const MONTH_COLLECTION_NAME = 'productionMonths'/);
  assert.match(reportStore,/snapshot\.data\(\)\?\.entriesVersion/);
  assert.match(reportStore,/pcmsDataCache\.read\(scope,version\)/);
  assert.match(reportStore,/exactCache\.has\(promiseKey\)/);
  assert.doesNotMatch(attendancePage,/loadDay\([\s\S]{0,120}force\s*:\s*true/);
  assert.doesNotMatch(currentSources,/PCMSProductionChanges|productionDayChanges|processQueueReference|processQueueData|productionProcessAnalysisQueue/);
  const featureContext={window:{},CONFIGURABLE_ROLES:['manager','clerk','productionDevelopment','productionControl','sales']};
  vm.createContext(featureContext);
  vm.runInContext(featureSource,featureContext);
  assert.equal(featureContext.window.PCMSFeatures.modules.flatMap(module=>module.pages)
    .some(page=>Array.from(page.scripts||[]).includes('productionChangeStore')),false);
});

test('產能登記選取員工後預設本月、可指定日期並以有效作為預設狀態',()=>{
  const html=read('index.html');
  const entryPage=read('js/production/production-entry.js');
  const reportStore=read('js/production/report-store.js');
  const style=read('styles/features/production.css');
  const pageStart=html.indexOf('id="pg-production-entry"');
  const pageEnd=html.indexOf('<div class="pg',pageStart+1);
  const markup=html.slice(pageStart,pageEnd);
  assert.match(markup,/id="production-record-date-filter-button"[\s\S]*?Tháng này[\s\S]*?本月/);
  assert.match(markup,/type="date"[^>]*id="production-record-date-filter-input"/);
  assert.match(markup,/id="production-entry-record-status-filter"[\s\S]*?<option value="active">Hiệu lực \/ 有效<\/option>[\s\S]*?<option value="voided">Đã hủy \/ 已作廢<\/option>[\s\S]*?<option value="all">Tất cả \/ 全部<\/option>/);
  assert.match(entryPage,/recordStatusFilter:'active'/);
  assert.match(entryPage,/function currentMonthRange\(\)[\s\S]*?`\$\{current\.slice\(0,7\)\}-01`[\s\S]*?to:current/);
  assert.match(entryPage,/PCMSProductionReports\.loadEmployeeRange\([\s\S]*?range\.from,[\s\S]*?range\.to,[\s\S]*?\{activeOnly:false\}/);
  assert.match(entryPage,/state\.recordStatusFilter === 'all'[\s\S]*?item\.status === state\.recordStatusFilter/);
  assert.match(entryPage,/state\.recordDateFilter = [^\n]*test\(pending\.productionDate/);
  assert.match(entryPage,/const RECORD_PAGE_SIZE = 50/);
  assert.match(entryPage,/ALL_EMPLOYEES_OPTION = Object\.freeze\(\{allEmployees:true,employeeId:'Tất cả \/ 全部'/);
  assert.match(entryPage,/const employeeIdItems=\(\)=>\[ALL_EMPLOYEES_OPTION,\.\.\.employeeItems\(\)\]/);
  assert.match(entryPage,/state\.allEmployees[\s\S]*?PCMSProductionReports\.loadRange\(range\.from,range\.to,\{activeOnly:false\}\)/);
  assert.match(entryPage,/if\(state\.allEmployees\)[\s\S]*?新增產能前請先選擇一位員工/);
  assert.match(entryPage,/\{key:'date',label:\{vi:'Ngày',zh:'日期'\},minimum:90,preferred:96,maximum:112\}/);
  assert.match(entryPage,/function appendDateCell\(row,value,showBadge\)/);
  assert.match(entryPage,/production-date-group-start/);
  assert.match(style,/#pg-production-entry \{[\s\S]*?overflow-x: clip;/);
  assert.match(reportStore,/async function loadEmployeeRange\(employeeId,fromValue,toValue,options=\{\}\)/);
  assert.match(reportStore,/_where\('employeeId','==',normalizedEmployeeId\)[\s\S]*?_where\('productionDate','>=',from\)[\s\S]*?_where\('productionDate','<=',to\)[\s\S]*?_orderBy\('productionDate','desc'\)/);
  assert.match(style,/\.production-entry-table-header \{[\s\S]*?min-height: 44px;[\s\S]*?flex-wrap: nowrap;/);
  assert.match(style,/\.production-entry-table-filters \{[\s\S]*?display: flex;/);
});

test('管理員測試刪除保留在各來源功能並同步處理關聯資料',()=>{
  const employeeStore=read('js/production/employee-store.js'); // employeeStore（員工資料存取程式內容）
  const entryStore=read('js/production/linked-entry-store.js'); // entryStore（生產資料存取程式內容）
  const employeePage=read('js/production/production-employees.js'); // employeePage（員工資料頁程式內容）
  const entryPage=read('js/production/production-entry.js'); // entryPage（生產登記頁程式內容）
  const attendanceStore=read('js/production/attendance-store.js'); // attendanceStore（考勤資料存取程式內容）
  const attendancePage=read('js/production/production-attendance.js'); // attendancePage（考勤頁程式內容）
  const recordsPage=read('js/production/production-records.js'); // recordsPage（每日績效頁程式內容）

  assert.match(employeeStore,/window\.cu\?\.role !== 'admin'/);
  assert.match(employeeStore,/_where\('employeeId','==',normalized\)/);
  assert.match(employeeStore,/transaction\.delete\(reference\)/);
  assert.match(entryStore,/window\.cu\?\.role!=='admin'/);
  assert.match(entryStore,/return mutateEntry\(entryId,'','delete'\)/);
  assert.match(entryStore,/transaction\.delete\(entryReference\)/);
  assert.match(entryStore,/mutation==='delete'\?'productionEntryDelete'/);
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
  assert.match(employeePage,/function openEmployeeEditor\(employee\)/);
  assert.match(employeePage,/updateEmployee\(employee\.employeeId,\{/);
  assert.match(employeePage,/createEmployee\(input\)/);
  assert.match(employeePage,/active:true/);
  assert.doesNotMatch(employeePage,/state\.editingId|function startEdit/);
  assert.doesNotMatch(employeePage,/production-employee-active/);
  assert.match(html,/<select id="production-employee-department-input">/);
  assert.match(html,/<option value="__manage__">Chỉnh sửa bộ phận \/ 編輯部門<\/option>/);
  assert.match(employeePage,/Chỉnh sửa bộ phận \/ 編輯部門/);
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
  assert.match(html,/id="production-entry-employee-name-input"[\s\S]*?id="production-employee-name-toggle"[\s\S]*?id="production-employee-name-options"/);
  assert.match(entryPage,/function initializeSearchDropdowns\(\)/);
  assert.match(entryPage,/PCMSUISearchDropdown\.create\(\{/);
  assert.match(entryPage,/registerDropdown\('production-employee-options'/);
  assert.match(entryPage,/registerDropdown\('production-employee-name-options'/);
  assert.match(entryPage,/registerDropdown\('production-order-options'/);
  assert.match(entryPage,/registerDropdown\('production-product-options'/);
  assert.match(entryPage,/registerDropdown\('production-process-options'/);
  assert.match(entryPage,/PCMSProductionEmployees\.list\(\{activeOnly:true\}\)/);
  assert.match(entryPage,/PCMSProductionEntryStore\.listOrders\(\)/);
  assert.match(entryPage,/PCMSProductionEntryStore\.productsForOrder\(state\.order\.id\)/);
  assert.doesNotMatch(entryPage,/addEventListener\('mouseleave'|function renderDropdown|function toggleDropdown/);
  assert.match(entryPage,/function confirmOrderInput\(options=\{\}\)/);
  assert.match(entryPage,/function confirmProductInput\(options=\{\}\)/);
  assert.match(entryPage,/const reverseShortcut=event\.code === 'Backquote'/);
  assert.match(entryPage,/if\(event\.key !== 'Tab' && !reverseShortcut\) return/);
  assert.match(entryPage,/const movingBackward=event\.shiftKey \|\| reverseShortcut/);
  assert.match(entryPage,/const offset = movingBackward \? -1 : 1/);
});

test('產能搜尋下拉緊貼輸入框且沒有滑鼠移動斷層',()=>{
  const style=read('styles/ui-core.css'); // style（共用搜尋下拉樣式）
  const features=read('js/features.js'); // features（中央功能載入設定）
  assert.match(style,/\.ui-search-dropdown-options \{[\s\S]*?top: calc\(100% - 1px\);/);
  assert.match(style,/\.ui-search-dropdown-options \{[\s\S]*?border-radius: 0 0 var\(--ui-radius-control\) var\(--ui-radius-control\);/);
  assert.doesNotMatch(style,/\.ui-search-dropdown-options \{[\s\S]*?top: calc\(100% \+ 4px\);/);
  assert.match(features,/uiSearchDropdown:'js\/ui-search-dropdown\.js\?v=20260814-3'/);
  assert.match(features,/production:'styles\/features\/production\.css\?v=/);
});

test('生產登記分開員工資訊與登記區且表格欄位可以按需顯示',()=>{
  const html=read('index.html');
  const source=read('js/production/production-entry.js');
  const entryStore=read('js/production/linked-entry-store.js');
  const records=read('js/production/production-records.js');
  const style=read('styles/features/production.css');
  const core=read('styles/ui-core.css');
  const controls=read('js/ui-table-controls.js');
  const searchDropdown=read('js/ui-search-dropdown.js');
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
  assert.match(markup,/Bản ghi của nhân viên trong tháng[\s\S]*?id="production-quantity-progress"[\s\S]*?Đã đăng ký \/ Giới hạn đơn hàng[\s\S]*?已登記數量 \/ 訂單數量上限/);
  assert.match(markup,/id="production-entry-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.doesNotMatch(markup,/id="production-entry-status"[^>]*ui-notice/);
  assert.match(markup,/tabindex="-1"[^>]*id="production-column-settings-button"[^>]*aria-expanded="false"/);
  assert.match(markup,/id="production-column-settings-menu"[^>]*data-ui-table-columns-menu[^>]*hidden/);
  for(const key of ['date','employeeId','employeeName','order','product','processNo','processName','quantity','supplementHours','orderQuantity','processSeconds','hourlyCapacity','status','action']){
    assert.match(source,new RegExp(`key:'${key}'`));
    if(key !== 'action') assert.match(markup,new RegExp(`data-production-column="${key}"`));
  }
  assert.match(markup,/id="production-columns-empty"[^>]*hidden/);
  assert.match(source,/PCMSUITableControls\.create\(\{[\s\S]*?columns:PRODUCTION_TABLE_COLUMNS/);
  assert.match(markup,/id="production-entry-table"[^>]*data-ui-table-resizable="true"/);
  assert.match(html,/id="production-records-table"[^>]*data-ui-table-resizable="true"/);
  assert.match(source,/const ENTRY_TABLE_COLUMN_MINIMUMS = Object\.freeze\(Object\.fromEntries\(/);
  for(const key of ['date','employeeId','employeeName','order','product','processNo','processName','quantity','supplementHours','orderQuantity','processSeconds','hourlyCapacity','status','action']){
    assert.match(source,new RegExp(`key:'${key}'[^\\n]*minimum:[^\\n]*preferred:[^\\n]*maximum:`));
  }
  assert.match(controls,/ui-table-column-settings-heading/);
  assert.match(controls,/selectAll\.indeterminate = selected > 0 && selected < toggles\.length/);
  assert.match(controls,/resetColumns\(\)/);
  assert.match(source,/const ENTRY_INPUT_IDS = Object\.freeze\(\[/);
  assert.match(source,/function confirmProcessInput\(options=\{\}\)/);
  assert.match(source,/function handleEntryTab\(event,currentId\)/);
  assert.match(source,/currentId === 'production-process-input'[\s\S]*?confirmProcessInput\(\{focusNext:true\}\)/);
  assert.match(read('js/ui-search-dropdown.js'),/event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
  assert.match(source,/selectProcess\(exact,\{focusQuantity:options\.focusNext===true\}\)/);
  assert.match(source,/production-quantity-input'\)\.addEventListener\('keydown'[\s\S]*?void saveEntry\(\)/);
  assert.match(source,/const quantityInput = element\('production-quantity-input'\)[\s\S]*?controls:supplement \? \[reasonInput,quantityInput\] : \[quantityInput\]/);
  assert.match(source,/function setSupplementMode\(enabled,options=\{\}\)/);
  assert.match(source,/processNo:supplement \? '0' : state\.process\?\.processNo/);
  assert.match(source,/supplementHours:supplement \? quantityInput\.value : undefined/);
  assert.match(source,/function hourlyCapacityText\(value\)/);
  assert.match(source,/hourlyCapacityText\(item\.hourlyCapacity\)/);
  assert.doesNotMatch(source,/hourlyCapacityText\([^)]*processSecSnapshot/);
  assert.match(source,/item\.productCode \|\| '—','production-product-code-cell','product'/);
  assert.match(source,/production-supplement-help-button'\)\.addEventListener\('click'/);
  assert.match(source,/production-supplement-dialog-backdrop/);
  assert.match(source,/new ResizeObserver\(updatePosition\)/);
  assert.match(source,/document\.querySelector\('#ma > \.mn'\)/);
  assert.doesNotMatch(source,/editDailyRecord|updateQuantity|updateSupplementHours|ti-edit/);
  assert.doesNotMatch(entryStore,/updateQuantity|updateSupplementHours|productionEntryUpdate/);
  assert.match(source,/voidEntry\(item\.id,reason\)/);
  assert.match(source,/loadEmployeeRange\([\s\S]*?\{activeOnly:false\}/);
  assert.doesNotMatch(records,/updateSupplementHours|voidEntry|deleteEntry/);
  assert.match(source,/loadProcessTotal\(process\?\.id,\{/);
  assert.match(source,/const PROCESS_TOTAL_TTL_MS = 30000/);
  assert.match(source,/addEventListener\?\.\('focus',refreshProcessTotalOnFocus\)/);
  assert.match(source,/loadQuantityProgress\(state\.process,\{force:true\}\)/);
  assert.match(entryStore,/applyProcessTotalDelta\(result\.processTotalId,result\.quantity,/);
  assert.match(source,/preview\?\.exceededQuantity > 0/);
  assert.match(source,/value\.textContent = `\$\{numberText\(summary\.registeredQuantity\)\} \/ \$\{numberText\(summary\.orderQuantity\)\}`/);
  assert.match(source,/function employeeIdOptionCopy\(item\)\{[\s\S]*?primary:item\.employeeId/);
  assert.match(source,/function employeeNameOptionCopy\(item\)\{[\s\S]*?primary:item\.name\|\|item\.employeeId/);
  assert.match(source,/function confirmEmployeeInput\(optionsId\)[\s\S]*?matches\.length===1[\s\S]*?selectEmployee\(matches\[0\]\)/);
  assert.match(searchDropdown,/normalize\('NFD'\)/);
  assert.match(searchDropdown,/toLocaleLowerCase\(\)/);
  assert.match(source,/employeeOptionsId[\s\S]*?confirmEmployeeInput\(employeeOptionsId\)/);
  assert.match(source,/function setProcessName\(process\)/);
  assert.match(source,/async function loadSelectedProcessRows\(\)/);
  assert.match(source,/PCMSProductionReports\.loadProcess\(processId,\{activeOnly:true\}\)/);
  assert.match(source,/async function toggleSelectedProcessRows\(\)/);
  assert.doesNotMatch(source,/matches\[0\]\.scrollIntoView/);
  assert.match(source,/row\.dataset\.processTotalId/);
  assert.doesNotMatch(source,/setPendingFilters|PCMSProductionRecords/);
  assert.match(source,/date\.max = maximum/);
  assert.match(records,/function dateBadgeText\(value\)/);
  assert.match(records,/production-date-group-start/);
  assert.doesNotMatch(records,/setPendingFilters/);
  assert.match(records,/PCMSProductionEntry\?\.setPendingContext/);
  assert.match(source,/window\.PCMSProductionEntry = Object\.freeze\(\{setPendingContext,loadStableContext:loadStableEmployeeContext\}\)/);
  assert.match(source,/dataset\.productionColumn/);
  assert.match(searchDropdown,/event\.key === 'Escape'/);
  assert.match(style,/\.production-entry-fields \{[\s\S]*?display: flex;[\s\S]*?width: 100%;[\s\S]*?flex-wrap: nowrap;[\s\S]*?gap: clamp\(5px, \.65vw, 10px\);/);
  assert.match(style,/\.production-process-field \.ui-search-dropdown-control \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/);
  assert.match(style,/\.production-registration-header \{[\s\S]*?width: 100%;[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?background: var\(--ui-color-table-header\);/);
  assert.match(style,/\.production-employee-inline-panel \{[\s\S]*?grid-template-columns: minmax\(210px, 1\.05fr\) minmax\(220px, 1\.15fr\)[\s\S]*?minmax\(68px, 86px\);[\s\S]*?background: var\(--ui-color-table-header\);/);
  assert.match(style,/\.production-employee-inline-field \.ui-search-dropdown-control \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/);
  assert.match(style,/\.production-quantity-progress \{[\s\S]*?width: clamp\(210px, 31%, 390px\);[\s\S]*?min-width: 0;[\s\S]*?background: var\(--ui-color-primary-soft\);/);
  assert.match(style,/#production-quantity-progress-value \{[\s\S]*?font-size: 20px;[\s\S]*?font-variant-numeric: tabular-nums;/);
  assert.match(style,/\.production-quantity-progress\.is-over \{[\s\S]*?var\(--ui-color-danger-background\)[\s\S]*?var\(--ui-color-danger-text\)/);
  assert.match(style,/\.production-entry-table th\.production-number-cell,[\s\S]*?\.production-entry-table td\.production-number-cell \{[\s\S]*?text-align: right;/);
  assert.match(style,/\.production-entry-table th\.production-number-cell > \.ui-dual-copy \{[\s\S]*?align-items: flex-end;/);
  assert.match(style,/\.production-entry-table \{[\s\S]*?width: 100%;[\s\S]*?min-width: max\(100%, var\(--ui-table-visible-min-width, 1100px\)\);[\s\S]*?table-layout: fixed;/);
  assert.match(style,/\.production-entry-table th,[\s\S]*?\.production-entry-table td \{[\s\S]*?padding: 4px 6px;/);
  assert.match(style,/data-production-column="order"\] \{[\s\S]*?width: 116px;/);
  assert.match(style,/data-production-column="product"\] \{[\s\S]*?width: 96px;/);
  assert.match(style,/data-production-column="orderQuantity"\] \{[\s\S]*?width: 104px;/);
  assert.match(style,/data-production-column="processNo"\] \{[\s\S]*?width: 72px;/);
  assert.match(style,/data-production-column="processName"\] \{[\s\S]*?width: auto;/);
  assert.match(style,/data-production-column="supplementHours"\]/);
  assert.match(style,/data-production-column="quantity"\],[\s\S]*?data-production-column="supplementHours"\] \{[\s\S]*?width: 106px;/);
  assert.match(style,/data-production-column="processSeconds"\] \{[\s\S]*?width: 82px;/);
  assert.match(style,/data-production-column="hourlyCapacity"\] \{[\s\S]*?width: 92px;/);
  assert.match(source,/key:'orderQuantity'[^\n]*headerLabel:\{vi:'SL đơn hàng',zh:'訂單數量'\}/);
  assert.match(source,/key:'processNo'[^\n]*headerLabel:\{vi:'Số CĐ',zh:'工序號'\}/);
  assert.match(source,/key:'quantity'[^\n]*headerLabel:\{vi:'SL sản xuất',zh:'生產數量'\}/);
  assert.match(source,/key:'processSeconds'[^\n]*headerLabel:\{vi:'Giây',zh:'工序秒數'\}/);
  assert.match(source,/key:'hourlyCapacity'[^\n]*headerLabel:\{vi:'SL\/giờ',zh:'每小時數量'\}/);
  assert.match(style,/\.production-value-badge \{[\s\S]*?display: inline-flex;[\s\S]*?min-height: 24px;[\s\S]*?padding: 2px 7px;[\s\S]*?background: var\(--ui-color-primary-soft\);/);
  assert.match(style,/\.production-entry-table td\.production-product-code-cell \{[\s\S]*?font-weight: 700;/);
  assert.match(style,/data-production-column="processNo"\],[\s\S]*?data-production-column="processNo"\] \{[\s\S]*?text-align: center;/);
  assert.match(style,/\.production-entry-table td\.production-row-actions \{[\s\S]*?display: table-cell;[\s\S]*?text-align: center;/);
  assert.match(html,/data-production-column="product"[\s\S]*?data-production-column="orderQuantity"[\s\S]*?data-production-column="processNo"/);
  assert.match(source,/\{key:'product'[\s\S]*?\{key:'orderQuantity'[\s\S]*?\{key:'processNo'/);
  assert.match(source,/appendCell\(row,item\.productCode[\s\S]*?appendCell\(row,supplement \? '—' : numberText\(item\.orderQuantity\)[\s\S]*?appendCell\(row,item\.processNo/);
  assert.match(style,/\.production-records-table \.production-date-cell,[\s\S]*?\.production-entry-table \.production-date-cell \{/);
  assert.match(style,/\.production-data-section \.ui-table-scroll \{[\s\S]*?overflow-x: auto;/);
  assert.match(style,/\.production-records-table,[\s\S]*?\.production-performance-table \{[\s\S]*?width: 100%;[\s\S]*?min-width: max\(100%, var\(--ui-table-visible-min-width, 1100px\)\);[\s\S]*?table-layout: fixed;/);
  assert.match(style,/\.production-records-table td\.production-row-actions \{[\s\S]*?display: table-cell;/);
  assert.match(style,/\.production-supplement-dialog-backdrop \.ui-dialog \{[\s\S]*?--production-dialog-center-x/);
  assert.match(core,/\.ui-table-column-settings-menu \{[\s\S]*?position: absolute;/);
  assert.doesNotMatch(features,/productionChangeStore:/);
  assert.match(features,/productionEmployeeStore:'js\/production\/employee-store\.js\?v=20260816-1'/);
  assert.match(features,/productionSummaryStore:'js\/production\/linked-summary-store\.js\?v=/);
  assert.match(features,/productionEntryStore:'js\/production\/linked-entry-store\.js\?v=/);
  assert.match(features,/productionReportStore:'js\/production\/report-store\.js\?v=\d{8}-\d+'/);
  assert.match(features,/productionAttendanceStore:'js\/production\/attendance-store\.js\?v=\d{8}-\d+'/);
  assert.match(features,/productionEntry:'js\/production\/production-entry\.js\?v=/);
  assert.match(features,/productionRecords:'js\/production\/production-records\.js\?v=/);
  assert.doesNotMatch(features,/productionAnomalyFilter:/);
  assert.match(features,/productionAttendance:'js\/production\/production-attendance\.js\?v=20260814-1'/);
  assert.match(features,/productionEmployees:'js\/production\/production-employees\.js\?v=20260816-1'/);
  assert.match(features,/production:'styles\/features\/production\.css\?v=/);
  assert.match(html,/js\/features\.js\?v=/);
});

test('生產登記款號輸入只顯示款號並保留重複訂單項目的固定身分',()=>{
  const source=read('js/production/production-entry.js');
  const inputValueSource=source.slice(source.indexOf('function productInputValue'),source.indexOf('function processOptionCopy'));
  assert.match(source,/function productInputValue\(item\)\{\s*return String\(item\?\.code\|\|''\);\s*\}/);
  assert.match(source,/const selected=state\.product\?\.orderItemId[\s\S]*?item\.orderItemId\|\|''\)===String\(state\.product\.orderItemId\)/);
  assert.match(source,/if\(selected&&window\.PCMSUISearchDropdown\.isExact\(value,selected\.code\)\) return selected;/);
  assert.match(source,/return byCode\.length===1\?byCode\[0\]:null;/);
  assert.doesNotMatch(inputValueSource,/lineNumber|item\.po|item\.color|join\(' · '\)/);
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
  assert.match(records,/search:element\('production-record-search'\)\.value/);
  assert.match(records,/PCMSUISearchDropdown\.create\(\{/);
  assert.match(records,/onInput:\(\)=>\{[\s\S]*?state\.selectedEmployeeId='';[\s\S]*?render\(\);[\s\S]*?savePreferences\(\);/);
  assert.match(records,/\{key:'employeeId',mode:'code',weight:0\}/);
  assert.match(records,/\{key:'name',mode:'text',weight:10\}/);
  assert.match(records,/\{key:'department',mode:'text',weight:20\}/);
  assert.match(reportStore,/async function loadRange\(fromValue,toValue,options=\{\}\)/);
  assert.match(reportStore,/async function loadProcess\(processTotalId,options=\{\}\)/);
  assert.match(style,/\.production-filter-grid \{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?align-items: end;/);
  assert.doesNotMatch(style,/\.production-filter-actions \{[\s\S]*?grid-column:/);
  assert.match(style,/\.production-filter-actions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(style,/\.production-attendance-fields \{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?align-items: end;/);
  assert.match(style,/\.production-employee-fields \{[\s\S]*?grid-template-columns:[^;]+;[\s\S]*?align-items: end;/);
  assert.match(style,/\.production-date-stepper \{[\s\S]*?width: 16px;[\s\S]*?height: 28px;/);
  assert.match(html,/id="production-record-from-calendar"[\s\S]*?id="production-record-from-previous"[\s\S]*?id="production-record-from-next"/);
  assert.match(html,/id="production-record-to-calendar"[\s\S]*?id="production-record-to-previous"[\s\S]*?id="production-record-to-next"/);
  assert.match(html,/id="production-attendance-calendar"[\s\S]*?id="production-attendance-previous"[\s\S]*?id="production-attendance-next"/);
  assert.match(style,/\.production-employee-form-actions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(92px, 1fr\)\);/);
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
    quantity:500,orderQuantity:1000,processSeconds:48,hourlyCapacity:63,displayEfficiency:'87.5%',status:'active'
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

test('員工績效依日期分組，姓名正常顯示且效率與異常狀態可跳轉',()=>{
  const html=read('index.html');
  const features=read('js/features.js');
  const records=read('js/production/production-records.js');
  const entry=read('js/production/production-entry.js');
  const attendance=read('js/production/production-attendance.js');
  const style=read('styles/features/production.css');
  const performanceMarkup=html.slice(html.indexOf('id="production-records-table"'),html.indexOf('id="production-records-table-body"'));
  assert.match(features,/page:'production-records'[\s\S]*?vi:'Hiệu suất nhân viên',zh:'員工績效'/);
  assert.match(html,/Hiệu suất nhân viên[\s\S]*?員工績效/);
  assert.match(html,/data-ui-table-column="employeeId" data-ui-table-default-visible="false"/);
  assert.match(html,/data-ui-table-column="department" data-ui-table-default-visible="false"/);
  for(const status of ['ready','missing-attendance','invalid-attendance','invalid-capacity']){
    assert.match(html,new RegExp(`<option value="${status}">`));
  }
  assert.match(records,/PCMSProductionReports\.loadRange\(current\.from,current\.to,\{activeOnly:true\}\)/);
  assert.match(records,/dates\.map\(date=>window\.PCMSProductionAttendance\.loadDay\(date\)\)/);
  assert.match(records,/PCMSProductionAttendance\.calculateEfficiency\(group\.entries,group\.attendance\)/);
  assert.match(records,/function dateBadgeText\(value\)/);
  assert.match(records,/if\(groupStart\) row\.classList\.add\('production-date-group-start'\)/);
  assert.match(records,/function addDateCell\([\s\S]*?document\.createElement\('span'\)[\s\S]*?production-date-badge/);
  assert.doesNotMatch(records,/openRegistrationDate/);
  assert.match(style,/\.production-date-badge \{/);
  assert.match(style,/\.production-date-badge \{[^}]*border: 1px solid var\(--ui-color-border\)/);
  assert.doesNotMatch(style,/\.production-date-badge \{[^}]*cursor: pointer/);
  assert.match(records,/function addEmployeeCell\([\s\S]*?cell\.textContent = String\(item\.employeeName/);
  assert.doesNotMatch(records,/production-employee-detail-button/);
  assert.doesNotMatch(style,/\.production-employee-detail-button/);
  assert.match(records,/function addEfficiencyCell\([\s\S]*?production-efficiency-badge[\s\S]*?openEmployeeRegistration\(item,\{targetProcess:false\}\)/);
  assert.match(records,/function openAbnormalDetail\(item\)\{[\s\S]*?item\.status==='invalid-capacity'\) return openEmployeeRegistration\(item,\{targetProcess:true\}\)[\s\S]*?canOpenPage\('production-attendance'\)/);
  assert.match(style,/\.production-records-table tr\.production-date-group-start > td/);
  assert.match(style,/border-top: 2px solid var\(--ui-color-primary\)/);
  assert.match(records,/const context=\{[\s\S]*?employeeId:item\.employeeId,[\s\S]*?productionDate:item\.productionDate[\s\S]*?\};/);
  assert.match(records,/PCMSProductionEntry\?\.setPendingContext\?\.\(context\)/);
  assert.match(records,/loadRequest/);
  assert.match(records,/request !== state\.loadRequest/);
  assert.match(records,/production-record-from'\)\.addEventListener\('change',[\s\S]*?void load\(\)/);
  assert.match(entry,/function setPendingContext\(context=\{\}\)/);
  assert.match(entry,/if\(!pending\.employeeId\)\{[\s\S]*?production-employee-input[\s\S]*?return true/);
  assert.match(performanceMarkup,/data-ui-table-column="bonus"/);
  assert.doesNotMatch(performanceMarkup,/data-ui-table-column="action"/);
  assert.match(html,/id="production-entry-empty"[^>]*hidden/);
  assert.match(entry,/async function loadSelectedProcessRows\(\)/);
  assert.match(entry,/setAttendanceSummary\(hoursText\(total\),''\)/);
  assert.doesNotMatch(entry,/`\$\{hoursText\(total\)\} giờ`/);
  assert.doesNotMatch(entry,/`\$\{hoursText\(total\)\} 小時`/);
  assert.doesNotMatch(entry,/正常 \$\{hoursText\(normal\)\} \+ 加班/);
  assert.doesNotMatch(html,/data-ui-table-column="note"/);
  assert.doesNotMatch(attendance,/function createNoteInput/);
  assert.match(attendance,/note:draft\.note/);
  assert.match(style,/\.production-attendance-table \{[\s\S]*?width: 100%;[\s\S]*?min-width: 100%;/);
  assert.match(style,/\.production-attendance-table td\.production-row-actions \{[\s\S]*?display: table-cell;[\s\S]*?vertical-align: middle;/);
  assert.match(style,/\.production-performance-table\[data-ui-table-controls="auto"\] \{[\s\S]*?width: 100%;[\s\S]*?--ui-table-resized-min-width/);
  assert.match(style,/\.production-employee-edit-form \{/);
  assert.match(records,/Number\.isFinite\(Number\(item\.bonusAmount\)\)\?`\$\{Math\.round\(Number\(item\.bonusAmount\)\)\.toLocaleString\('vi-VN'\)\} VND`:'—'/);
  assert.match(records,/PCMSPerformanceBonusStore\.loadDailyBonuses\(month,state\.rows\)/);
});

test('當日效率數值依三段範圍顯示紅藍綠底框且空值不套色',()=>{
  const records=read('js/production/production-records.js');
  const style=read('styles/features/production.css');
  assert.match(records,/percentage<70\?'is-low':percentage<=100\?'is-standard':'is-high'/);
  assert.match(records,/else cell\.textContent='—'/);
  assert.match(style,/\.production-efficiency-badge\.is-low/);
  assert.match(style,/\.production-efficiency-badge\.is-standard/);
  assert.match(style,/\.production-efficiency-badge\.is-high/);
});

test('生產登記不再於開頁自動掃描整月異常',()=>{
  const html=read('index.html');
  const features=read('js/features.js');
  assert.doesNotMatch(html,/id="production-anomaly-filter-button"/);
  assert.doesNotMatch(html,/id="production-anomaly-panel"/);
  assert.doesNotMatch(features,/productionAnomalyFilter/);
  assert.doesNotMatch(features,/productionAnomalyFilterInit|productionAnomalyFilterLeave/);
});

test('產能新增作廢與刪除後只局部更新目前表格',()=>{
  const entry=read('js/production/production-entry.js');
  assert.match(entry,/function patchDailyRow\(item,\{remove=false\}=\{\}\)/);
  assert.match(entry,/const voided = await window\.PCMSProductionEntryStore\.voidEntry[\s\S]*?patchDailyRow\(voided\)/);
  assert.match(entry,/const deleted = await window\.PCMSProductionEntryStore\.deleteEntry[\s\S]*?patchDailyRow\(deleted,\{remove:true\}\)/);
  assert.match(entry,/const saved = await window\.PCMSProductionEntryStore\.createEntry[\s\S]*?patchDailyRow\(saved\)/);
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
  assert.match(attendancePage,/PCMSProductionAttendance\.saveMany\(inputs,\{\s*onProgress/);
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

test('正式工序秒數修改完成後立即刷新舊產能與目前工序',()=>{
  const source=read('js/production/production-entry.js');
  const features=read('js/features.js');
  assert.match(source,/function refreshAfterProcessSecondsSaved\(result=\{\}\)/);
  assert.match(source,/loadProcesses\(state\.order\.id,\{force:true\}\)/);
  assert.match(source,/onSaved:refreshAfterProcessSecondsSaved/);
  assert.match(source,/await loadDailyRows\(\)/);
  assert.match(features,/productionEntry:'js\/production\/production-entry\.js\?v=\d{8}-\d+'/);
});
