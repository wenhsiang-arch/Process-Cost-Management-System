import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('..',import.meta.url);

function read(path){ return fs.readFileSync(new URL(path,root),'utf8'); }

function loadProductModules(){
  const context={window:{},TextEncoder};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  vm.runInContext(read('js/product-version-store.js'),context);
  return context.window;
}

function loadProcessEditStoreForImpact(){
  const product={code:'P-001',client:'C',zh:'產品',vi:'Sản phẩm',sz:'S',ops:[
    {no:'1',category:'SX',zh:'車身',vi:'May thân',sec:48}
  ]};
  const queries=[];
  const countQueries=[];
  const window={D:[product],S:{ws:3000},firebaseAuthUser:{uid:'test-user'}};
  Object.assign(window,{
    _collection:name=>({name}),
    _where:(field,operator,value)=>({type:'where',field,operator,value}),
    _orderBy:(field,direction)=>({type:'orderBy',field,direction}),
    _limit:value=>({type:'limit',value}),
    _startAfter:value=>({type:'startAfter',value}),
    _query:(collection,...constraints)=>({collection:collection.name,constraints}),
    _docRef:(collection,id)=>({collection,id}),
    _getDoc:async reference=>reference.collection==='productionMonths'
      ? {exists:()=>true,data:()=>({month:reference.id,status:'open',summaryReady:true,revision:1,
          entriesVersion:'E1',attendanceVersion:'A1',summaryVersion:'S1',schemaVersion:2})}
      : {exists:()=>false,data:()=>undefined},
    _getDocs:async query=>{
      queries.push(query);
      if(query.collection==='productionMonths') return {size:1,docs:[
        {id:'2026-08',data:()=>({month:'2026-08',status:'open',summaryReady:true})}
      ]};
      if(query.collection==='orders') return {size:2,docs:[
        {id:'ORDER-A',data:()=>({orderId:'A',productCodes:['P-001'],importStatus:'ready',lifecycleStatus:'active',createdAt:2})},
        {id:'ORDER-DONE',data:()=>({orderId:'DONE',productCodes:['P-001'],importStatus:'ready',lifecycleStatus:'done',createdAt:1})}
      ]};
      return {size:0,docs:[]};
    },
    _getCountFromServer:async query=>{
      countQueries.push(query);
      return {data:()=>({count:1})};
    }
  });
  const context={window,console,TextEncoder};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  vm.runInContext(read('js/production/production-guard-store.js'),context);
  vm.runInContext(read('js/production/process-edit-store.js'),context);
  return {store:window.PCMSProcessEditStore,queries,countQueries};
}

test('款號匯入會分成新增、相同與有差異三類',()=>{
  const {PCMSProductModel:model}=loadProductModules();
  const existing=[
    {code:'A',client:'C',zh:'產品',vi:'SP',sz:'S',ops:[{no:'1',category:'SX',zh:'車',vi:'May',sec:15}]},
    {code:'B',client:'C',zh:'產品',vi:'SP',sz:'M',ops:[{no:'1',category:'SX',zh:'車',vi:'May',sec:15}]}
  ];
  const incoming=[
    structuredClone(existing[0]),
    {...structuredClone(existing[1]),ops:[{no:'1',category:'SX',zh:'車',vi:'May',sec:18}]},
    {code:'C',client:'C',zh:'新品',vi:'Mới',sz:'L',ops:[{no:'1',category:'SX',zh:'做',vi:'Làm',sec:20}]}
  ];
  const result=model.classifyImport(existing,incoming);
  assert.equal(Array.from(result.newItems,item=>item.code).join(','),'C');
  assert.equal(Array.from(result.sameItems,item=>item.code).join(','),'A');
  assert.equal(result.differentItems[0].code,'B');
  assert.equal(result.differentItems[0].differences[0].field,'sec');
});

test('產品群組候選忽略尺寸、秒數、加工分類及中文名稱，但保留越文與工序結構',()=>{
  const {PCMSProductModel:model}=loadProductModules();
  const base={code:'A',client:'C',zh:'產品',vi:'SP',sz:'S',ops:[{no:'1',category:'SX',zh:'車',vi:'May',sec:15}]};
  assert.equal(model.groupSignature(base),model.groupSignature({...base,code:'B',sz:'XL',ops:[{...base.ops[0],sec:22}]}));
  assert.equal(model.groupSignature(base),model.groupSignature({...base,code:'B',zh:'其他產品',ops:[{...base.ops[0],zh:'其他工序'}]}));
  const signature=JSON.parse(model.groupSignature(base));
  assert.equal('zh' in signature,false);
  assert.equal('zh' in signature.operations[0],false);
  assert.equal('category' in signature.operations[0],false);
  assert.notEqual(model.groupSignature(base),model.groupSignature({...base,code:'C',vi:'Khác'}));
  assert.notEqual(model.groupSignature(base),model.groupSignature({...base,code:'C',ops:[{...base.ops[0],vi:'Khác'}]}));
  assert.equal(model.groupSignature(base),model.groupSignature({...base,code:'C',ops:[{...base.ops[0],category:'QC'}]}));
  const legacySignature=JSON.stringify({
    client:'c',zh:'產品',vi:'sp',operations:[{no:'1',category:'SX',zh:'車',vi:'may'}]
  });
  assert.equal(model.matchesGroupSignature(base,legacySignature),true);
});

test('完整款號版本會切成可還原的安全資料區塊',()=>{
  const {PCMSProductVersionStore:store}=loadProductModules();
  const items=Array.from({length:120},(_,index)=>({
    code:`P${index}`,
    client:'Khách hàng',zh:'產品',vi:'Sản phẩm',sz:String(index),
    ops:[{no:'1',category:'SX',zh:'工序',vi:'Công đoạn',sec:15}]
  }));
  const snapshot=store.buildSnapshot('version-1',items,{sequence:1,productVersion:'v1',action:'import'});
  assert.equal(snapshot.record.productCount,120);
  assert.equal(snapshot.record.opCount,120);
  assert.equal(snapshot.record.chunkCount,snapshot.chunks.length);
  const restored=snapshot.chunks.flatMap(chunk=>JSON.parse(chunk.data));
  assert.equal(restored.length,120);
  assert.equal(restored.some(item=>item.code==='P119'),true);
});

test('首次基準版本碰到同時建立時會重讀已完成版本',()=>{
  const store=read('js/product-version-store.js');
  assert.match(store,/catch\(error\)[\s\S]*concurrent=await window\._getDoc\(reference\)/);
  assert.match(store,/if\(concurrent\.exists\(\)\) return/);
});

test('舊款號覆蓋入口已移除，匯入只送出新款號',()=>{
  const html=read('index.html');
  const data=read('js/data.js');
  const firebase=read('js/firebase.js');
  assert.doesNotMatch(html,/cImp\('ov'\)|全部覆蓋/);
  assert.match(html,/id="dup-import-new-btn"/);
  assert.match(data,/const changedItems=classification\.newItems/);
  assert.match(firebase,/allowExisting!==true/);
});

test('工序修改是款號管理的獨立分頁並保留三種語言結構',()=>{
  const features=read('js/features.js');
  const html=read('index.html');
  const page=read('js/production/process-edit.js');
  const style=read('styles/features/production-process-edit.css');
  assert.match(features,/page:'production-process-edit',feature:'productionProcessEdit'/);
  assert.match(features,/normalized\.productionProcessEdit===true/);
  assert.match(html,/id="pg-production-process-edit"/);
  assert.match(page,/Chỉnh sửa|Công đoạn|Mã hàng/);
  assert.match(page,/工序|款號|版本歷史/);
  assert.match(page,/ui-dual-copy/);
  assert.match(page,/process-edit-context-grid ui-context-grid/);
  assert.match(page,/process-edit-command-actions ui-command-actions/);
  assert.match(page,/process-edit-command-action ui-command-action is-primary" id="process-edit-load-button"/);
  assert.match(page,/process-edit-command-action ui-command-action" id="process-edit-history-button"/);
  assert.match(page,/process-edit-command-action ui-command-action" id="process-edit-open-groups"/);
  assert.doesNotMatch(page,/class="ui-button[^"]*" id="process-edit-(?:load-button|history-button|open-groups)"/);
  assert.doesNotMatch(style,/\.process-edit-command\{display:grid/);
  assert.doesNotMatch(style,/\.process-edit-toolbar-group\{display:flex/);
});

test('群組候選仍需人工建立且工序正式修改會保存開發原始工序',()=>{
  const store=read('js/production/process-edit-store.js');
  const page=read('js/production/process-edit.js');
  const groups=read('js/production/product-groups.js');
  assert.match(store,/signatures\.size!==1/);
  assert.match(store,/developmentOps:Array\.isArray/);
  assert.match(store,/allowExisting:true/);
  assert.match(page,/createMemberSelector/);
  assert.match(groups,/createMemberSelector/);
  assert.match(groups,/Xác nhận tạo 1 nhóm/);
});

test('純秒數修改不掃描訂單，結構修改與標準訂正各自處理必要資料',()=>{
  const store=read('js/production/process-edit-store.js');
  const entryStore=read('js/production/entry-store.js');
  const firebase=read('js/firebase.js');
  const page=read('js/production/process-edit.js');
  assert.match(store,/STANDARD_CORRECTION:'standardCorrection'/);
  assert.match(store,/PROCESS_OPTIMIZATION:'processOptimization'/);
  assert.match(store,/function requiresOrderStructureSync/);
  assert.match(store,/const orders=orderSyncRequired\?await activeOrdersForProducts/);
  assert.match(store,/processStandardUpdates:standardUpdates/);
  assert.match(store,/const needsJob=orderSyncRequired\|\|mode===EDIT_MODES\.STANDARD_CORRECTION/);
  assert.doesNotMatch(store,/loadOrders\(|orderRows/);
  assert.match(store,/jobType:'master'/);
  assert.match(store,/jobType:'order',masterJobId:master\.jobId/);
  assert.match(store,/processEditJobId/);
  assert.match(store,/active:false/);
  assert.match(store,/quoteSnapshotSec:operation\.sec/);
  assert.match(store,/saved\.createdByUid!==currentUserId\(\)/);
  assert.match(store,/status:'syncing',phase:'orders'/);
  assert.match(store,/liveOrder\.processEditJobId!==saved\.jobId/);
  assert.match(store,/const missingCodes=targetCodes\.filter/);
  assert.match(store,/找不到款號的原始訂單工序/);
  assert.match(store,/ENTRY_COLLECTION='productionEntries'/);
  assert.match(store,/standardCorrectionJobId:master\.jobId/);
  assert.match(store,/originalProcessSecSnapshot:Number\(row\.originalProcessSecSnapshot\)\|\|Number\(row\.processSecSnapshot\)/);
  assert.match(store,/calculationVersion:'hourly-capacity-v2-standard-correction'/);
  assert.match(store,/typeof window\.saveOperationLogToFB!=='function'/);
  assert.match(store,/if\(logResult===false\)/);
  assert.match(entryStore,/processSecSnapshot:processSeconds/);
  assert.match(entryStore,/processVersionSnapshot:orderVersion\(orderSnapshot\.data\(\),normalized\.orderId\)/);
  assert.match(entryStore,/`legacy-\$\{normalizedText\(orderId\|\|order\?\.id\)\}`/);
  assert.match(entryStore,/liveProcess\.active===false/);
  assert.match(entryStore,/transaction\.set\(monthReference,guards\.entriesMonthSourceVersionData/);
  assert.doesNotMatch(entryStore,/productionMonthControls|productionMonthVersions/);
  assert.match(store,/summaries\.applyEntry\(nextDay,\{\.\.\.row,mutation:'standard-correction'\},-1,actor\)/);
  assert.match(store,/revision:\(Number\(beforeDay\.revision\)\|\|0\)\+1/);
  assert.match(store,/const rows=await queryProductionEntries\(corrections,openMonths\)/);
  assert.doesNotMatch(store,/queryProductionEntries\(corrections,openMonths,\{collect:false,onPage/);
  assert.match(store,/window\._getCountFromServer/);
  assert.match(firebase,/getCountFromServer as firestoreGetCountFromServer/);
  assert.match(firebase,/window\._getCountFromServer/);
  assert.match(store,/window\._where\('recordType','==','standard'\)/);
  assert.match(store,/window\._where\('status','==','active'\)/);
  assert.match(store,/window\._where\('productionDate','>=',range\.from\)/);
  assert.match(store,/window\._where\('productionDate','<',range\.to\)/);
  assert.doesNotMatch(store,/window\._orderBy\('createdAt','asc'\)/);
  assert.doesNotMatch(store,/summaries\.processQueueReference\(productionDate,employeeId\)/);
  assert.match(page,/新報工立即使用新標準/);
  assert.match(page,/store\(\)\.analyzeImpact/);
  assert.match(page,/store\(\)\.resumeModificationJob/);
  assert.doesNotMatch(page,/Ngoại lệ một đơn|單張訂單例外|saveOrderException/);
  assert.match(page,/state\.selectedTargets/);
  assert.match(page,/Không tải dữ liệu tháng đã khóa/);
  assert.match(page,/鎖定月份資料不下載/);
});

test('影響分析依模式分開計算歷史訂正，結構變更不能冒用標準錯誤訂正',async()=>{
  const {store,queries,countQueries}=loadProcessEditStoreForImpact();
  const correctedOperations={'P-001':[{no:'1',category:'SX',zh:'車身',vi:'May thân',sec:30}]};
  const correction=await store.analyzeImpact({
    targetCodes:['P-001'],operationsByCode:correctedOperations,mode:store.EDIT_MODES.STANDARD_CORRECTION
  });
  assert.equal(correction.orderCount,0);
  assert.equal(correction.entryCount,1);
  assert.equal(correction.corrections['P-001']['1'].seconds,30);
  assert.equal(correction.corrections['P-001']['1'].hourlyCapacity,100);
  assert.equal(queries.some(item=>item.collection==='productionMonths'),true);
  assert.equal(queries.some(item=>item.collection==='productionEntries'),false);
  assert.equal(queries.some(item=>item.collection==='orders'),false);
  assert.equal(countQueries.length,1);
  assert.deepEqual(countQueries[0].constraints.filter(item=>item.type==='where').map(item=>[item.field,item.operator,item.value]),[
    ['productCode','==','P-001'],
    ['processNo','==','1'],
    ['recordType','==','standard'],
    ['status','==','active'],
    ['productionDate','>=','2026-08-01'],
    ['productionDate','<','2026-09-01']
  ]);

  queries.length=0;
  countQueries.length=0;
  const optimization=await store.analyzeImpact({
    targetCodes:['P-001'],operationsByCode:{'P-001':[
      ...correctedOperations['P-001'],{no:'2',category:'QC',zh:'檢查',vi:'Kiểm tra',sec:20}
    ]},mode:store.EDIT_MODES.PROCESS_OPTIMIZATION
  });
  assert.equal(optimization.entryCount,0);
  assert.equal(optimization.orderCount,1);
  assert.equal(optimization.orderSyncRequired,true);
  assert.equal(queries.some(item=>item.collection==='productionEntries'),false);
  assert.equal(queries.some(item=>item.collection==='orders'),true);
  assert.equal(countQueries.length,0);

  queries.length=0;
  countQueries.length=0;
  const secondsOnly=await store.analyzeImpact({
    targetCodes:['P-001'],operationsByCode:correctedOperations,mode:store.EDIT_MODES.PROCESS_OPTIMIZATION
  });
  assert.equal(secondsOnly.orderCount,0);
  assert.equal(secondsOnly.orderSyncRequired,false);
  assert.equal(queries.length,0);
  assert.equal(countQueries.length,0);
  await assert.rejects(
    store.analyzeImpact({
      targetCodes:['P-001'],operationsByCode:{'P-001':[
        ...correctedOperations['P-001'],{no:'2',category:'QC',zh:'檢查',vi:'Kiểm tra',sec:20}
      ]},mode:store.EDIT_MODES.STANDARD_CORRECTION
    }),
    /只有純秒數變更可使用標準錯誤訂正/
  );
});

test('工序建議會開啟共用快速修改視窗，但不會由分析頁直接寫入標準秒數',()=>{
  const ie=read('js/production-analysis/ie-analysis.js');
  const quick=read('js/production/process-seconds-quick-edit.js');
  const groupUi=read('js/production/process-group-ui.js');
  const style=read('styles/features/production-process-edit.css');
  assert.match(ie,/PCMSQuickProcessSeconds\.open/);
  assert.doesNotMatch(ie,/saveProductItemsToFB/);
  assert.doesNotMatch(ie,/IE 分析使用說明|Danh sách IE|IE 異常分析|IE 產線查核表/);
  assert.match(quick,/recommendedSeconds/);
  assert.match(quick,/saveOfficialSeconds/);
  assert.doesNotMatch(quick,/QUICK_EDIT_REASON/);
  assert.match(quick,/compact:true/);
  assert.doesNotMatch(quick,/data-quick-reason/);
  assert.match(quick,/standardCorrection/);
  assert.match(quick,/processOptimization/);
  assert.match(quick,/function chooseEditMode\(options=\{\}\)/);
  assert.doesNotMatch(quick,/value="standardCorrection" checked/);
  assert.match(quick,/kind:'primary',disabled:true/);
  assert.match(quick,/const mode=await chooseEditMode\(\{keepPrevious:true\}\)/);
  assert.match(quick,/Giây bảng mã hàng/);
  assert.match(quick,/款號表秒數/);
  assert.match(quick,/store\(\)\.analyzeImpact/);
  assert.match(quick,/ui\(\)\.progressDialog/);
  assert.match(groupUi,/data-process-select-all/);
  assert.match(groupUi,/\$\{safe\(group\.labelPair\.vi\)\}\/\$\{group\.members\.length\}/);
  assert.match(style,/\.process-seconds-quick-edit \.process-size-tabs\{grid-template-columns:repeat\(auto-fit,minmax\(62px,1fr\)\)/);
  assert.match(style,/\.process-seconds-quick-edit \.ui-table-scroll\{[^}]*max-height:none;overflow:visible/);
  assert.match(style,/\.process-seconds-quick-edit \.process-size-member-table\{[^}]*table-layout:fixed/);
});

test('正式工序頁與快速修改都在儲存後要求選擇模式且不預選',()=>{
  const page=read('js/production/process-edit.js');
  const quick=read('js/production/process-seconds-quick-edit.js');
  const features=read('js/features.js');
  const store=read('js/production/process-edit-store.js');
  assert.doesNotMatch(page,/id="process-edit-mode-panel"|official-process-edit-mode|syncModificationMode/);
  assert.match(page,/chooseEditMode\(\{structuralChange\}\)/);
  assert.match(quick,/name="process-edit-save-mode" value="standardCorrection"/);
  assert.match(quick,/name="process-edit-save-mode" value="processOptimization"/);
  assert.match(quick,/structuralChange\?'disabled':''/);
  assert.match(quick,/if\(!selectedMode\) return false/);
  assert.match(features,/productionProcessGroupUi','productionProcessSecondsQuickEdit','productionProcessEdit'/);
  assert.doesNotMatch(page,/data-process-edit-reason|openModificationSettings/);
  assert.match(store,/function modificationReason\(mode\)/);
  assert.doesNotMatch(store,/reason\.length<2/);
});

test('群組獨立儲存且秒數儲存只在缺少群組時提供接續設定',()=>{
  const quick=read('js/production/process-seconds-quick-edit.js');
  const groupPage=quick.indexOf('function openGroupCreation(product,products,selectedCodes)');
  const missingGroupPrompt=quick.indexOf("title:{vi:'Mã hàng chưa có nhóm'");
  const syncConfirmation=quick.indexOf("title:{vi:'Xác nhận lưu giây mới'");
  assert.ok(groupPage>0);
  assert.ok(missingGroupPrompt>groupPage);
  assert.ok(syncConfirmation>missingGroupPrompt);
  assert.match(quick,/Xác nhận lưu nhóm/);
  assert.match(quick,/const created=await store\(\)\.createGroup/);
  assert.match(quick,/if\(setupGroup&&!\(await createIndependentGroup\(\)\)\) return false/);
  assert.match(quick,/Chọn Bỏ qua để chỉ lưu giây/);
  assert.match(quick,/selectedCodes:members\.map/);
  assert.match(quick,/data-save-new-group/);
  assert.doesNotMatch(quick,/aria-pressed="false"[^\n]*data-save-new-group|saveNewGroup=!saveNewGroup/);
  assert.match(quick,/此次修改將同步目前的款號表/);
  assert.match(quick,/舊產能登記完全不變；新報工立即使用新標準，不掃描訂單/);
  assert.match(quick,/訂正舊登記秒數與效率，並保留修改前的款號表秒數/);
});

test('尺寸卡依數字及常規英文尺寸由左至右排序',()=>{
  const context={window:{PCMSSafe:{text:value=>String(value??''),attribute:value=>String(value??'')}}};
  vm.createContext(context);
  vm.runInContext(read('js/production/process-group-ui.js'),context);
  const sizes=['XL','10','S','XXS','2','M','XXXL','XS','L','1','XXL','其他',''];
  const products=sizes.map((sz,index)=>({code:`P${index}`,sz}));
  assert.deepEqual(
    Array.from(context.window.PCMSProcessGroupUI.groupBySize(products),group=>group.label),
    ['1','2','10','XXS','XS','S','M','L','XL','XXL','XXXL','其他','—']
  );
});

test('快速秒數切換尺寸會載入該尺寸秒數且只儲存目前尺寸款號',()=>{
  const quick=read('js/production/process-seconds-quick-edit.js');
  assert.match(quick,/const sizeStates=new Map/);
  assert.match(quick,/function refreshSizeSeconds/);
  assert.match(quick,/selector\.activeSize\(\)/);
  assert.match(quick,/selectedProducts=active\.members\.filter/);
  assert.match(quick,/targetProducts=selectedProducts\.filter/);
  assert.match(quick,/selectedSummary\(targetProducts,processNo,currentState\.currentText,seconds,active\.labelPair\.vi,mode,impact\)/);
  assert.doesNotMatch(quick,/const targetProducts=selector\.selectedProducts\(\)/);
});

test('正式工序與快速秒數只接受整數，內容相同時不寫入',()=>{
  const store=read('js/production/process-edit-store.js');
  const page=read('js/production/process-edit.js');
  const quick=read('js/production/process-seconds-quick-edit.js');
  assert.match(store,/Number\.isInteger\(operation\.sec\)/);
  assert.match(store,/Number\.isInteger\(seconds\)/);
  assert.match(page,/step="1" inputmode="numeric"/);
  assert.match(page,/Không có thay đổi; hệ thống không ghi dữ liệu/);
  assert.match(quick,/Math\.round\(Number\(input\.recommendedSeconds\)\|\|0\)/);
  assert.match(quick,/Giây mới giống dữ liệu hiện tại; hệ thống không ghi dữ liệu/);
});
