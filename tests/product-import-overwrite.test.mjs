import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

test('覆蓋預覽實際產生中央取消文字，取消與關閉均不核准寫入',async()=>{
  const createElement=tagName=>({
    tagName,children:[],className:'',textContent:'',dataset:{},
    classList:{add(){}},setAttribute(){},
    append(...children){ this.children.push(...children); },
    appendChild(child){ this.children.push(child); return child; },
    replaceChildren(...children){ this.children=children; }
  }); // createElement（隔離測試用節點，不開啟正式頁面）
  const document={createElement};
  let dialog;
  const window={PCMSUIComponents:{openDialog:options=>{ dialog=options; }}};
  const context=vm.createContext({window,document,console});
  vm.runInContext(read('js/ui-text.js'),context);
  vm.runInContext(read('js/product-import-impact.js'),context);
  const plan={rows:[],requests:[{}],overwriteCount:1,newCount:0,processChangeCount:0,affectedEntryCount:0,hasBlockingImpact:false};
  const before=JSON.stringify(plan);
  const pending=window.PCMSProductImportImpact.confirmPreview(plan,{fileName:'測試.xlsx'});
  assert.equal(dialog.body.className,'product-import-impact');
  assert.equal(dialog.actions[0].text,'common.cancel');
  const label=window.PCMSUIText.create(dialog.actions[0].text);
  assert.deepEqual(label.children.map(child=>[child.className,child.textContent]),[
    ['ui-text-vi','Hủy'],['ui-text-zh','取消']
  ]);
  assert.equal(dialog.actions[1].text.zh,'確認覆蓋');
  assert.equal(dialog.actions[1].disabled,false);
  dialog.actions[0].onClick();
  assert.equal(await pending,false);
  const closed=window.PCMSProductImportImpact.confirmPreview(plan);
  dialog.onClose();
  assert.equal(await closed,false);
  assert.equal(JSON.stringify(plan),before);
});

function load(counts={}){
  const queries=[];
  const window={
    _collection:name=>({name}),
    _where:(field,operator,value)=>({field,operator,value}),
    _query:(collection,...conditions)=>({collection,conditions}),
    _getCountFromServer:async query=>{
      const processId=query.conditions[0].value;
      queries.push(processId);
      return {data:()=>({count:Number(counts[processId]||0)})};
    }
  };
  const context={window,TextEncoder,console};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  vm.runInContext(read('js/product-import-impact.js'),context);
  return {window,queries};
}

function fixtures(model){
  const productId=model.deterministicLegacyId('product','impact-product');
  const first=model.deterministicLegacyId('process','impact-process-1');
  const second=model.deterministicLegacyId('process','impact-process-2');
  const existing={
    productId,revision:3,code:'P-IMPACT',client:'C1',zh:'舊產品',vi:'Sản phẩm cũ',sz:'M',
    ops:[
      {processId:first,no:'1',sortOrder:1,category:'SX',zh:'舊車縫',vi:'May cũ',sec:60,active:true},
      {processId:second,no:'2',sortOrder:2,category:'QC',zh:'舊檢查',vi:'Kiểm cũ',sec:30,active:true}
    ]
  };
  const incoming={
    code:'P-IMPACT',client:'C2',zh:'新產品',vi:'Sản phẩm mới',sz:'M',
    ops:[
      {no:'3',category:'SX',zh:'新車縫',vi:'May cũ',sec:45},
      {no:'3',category:'DG',zh:'包裝',vi:'Đóng gói',sec:20}
    ]
  };
  return {existing,incoming,first,second};
}

test('影響預覽只有被移除工序查全部歷史，新工序與秒數變更不重複計數',async()=>{
  const prepared=load();
  const data=fixtures(prepared.window.PCMSProductModel);
  const counts={[data.first]:5,[data.second]:0};
  const {window,queries}=load(counts);
  const plan=window.PCMSProductImportImpact.buildPlan({
    newItems:[],sameItems:[],differentItems:[{existing:data.existing,incoming:data.incoming}]
  });
  const progress=[];
  await window.PCMSProductImportImpact.loadImpactCounts(plan,{concurrency:2,onProgress:item=>progress.push(item.completed)});
  assert.equal(plan.overwriteCount,1);
  assert.equal(plan.processChangeCount,3);
  assert.equal(plan.rows.length,3);
  assert.equal(plan.affectedEntryCount,0);
  assert.equal(plan.hasBlockingImpact,false);
  assert.deepEqual(queries,[data.second]);
  assert.equal(progress.at(-1),1);
});

test('純排序、工序號、中文或款號文字變更不讀取產能',async()=>{
  const {window,queries}=load();
  const data=fixtures(window.PCMSProductModel);
  const incoming={...data.existing,client:'C9',ops:[
    {...data.existing.ops[1],processId:'',no:'1',sortOrder:1,zh:'新檢查'},
    {...data.existing.ops[0],processId:'',no:'2',sortOrder:2,zh:'新車縫'}
  ]};
  const plan=window.PCMSProductImportImpact.buildPlan({newItems:[],sameItems:[],differentItems:[{existing:data.existing,incoming}]});
  await window.PCMSProductImportImpact.loadImpactCounts(plan);
  assert.equal(queries.length,0);
  assert.equal(plan.affectedEntryCount,0);
  assert.equal(plan.rows.some(row=>row.requiresImpactCount),false);
});
test('被移除且確有報工的工序改為保留舊參照，不阻擋匯入',async()=>{
  const prepared=load();
  const data=fixtures(prepared.window.PCMSProductModel);
  const {window}=load({[data.first]:5,[data.second]:2});
  const plan=window.PCMSProductImportImpact.buildPlan({
    newItems:[],sameItems:[],differentItems:[{existing:data.existing,incoming:data.incoming}]
  });
  await window.PCMSProductImportImpact.loadImpactCounts(plan);
  assert.equal(plan.hasBlockingImpact,false);
  assert.equal(plan.blockingRows.length,0);
  assert.equal(plan.retainedProcessCount,1);
  assert.equal(plan.requests[0].legacyProcesses[0].processId,data.second);
});

test('同款號新匯入檔的越文工序名稱正規化後不可重複',()=>{
  const {window}=load();
  const data=fixtures(window.PCMSProductModel);
  const incoming={...data.incoming,ops:[
    {...data.incoming.ops[0],vi:'May cũ'},
    {...data.incoming.ops[1],vi:'  MAY CŨ  '}
  ]};
  assert.throws(()=>window.PCMSProductModel.buildImportReconciliation(data.existing,incoming),/越文名稱重複/);
});

test('匯入只將未凍結且員工月績效真正改變的群組列為產能影響',async()=>{
  const window={S:{ws:3000}};
  const context={window,TextEncoder,console};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  vm.runInContext(read('js/production/efficiency-core.js'),context);
  vm.runInContext(read('js/product-resolver.js'),context);
  const data=fixtures(window.PCMSProductModel);
  const incoming={...data.existing,ops:data.existing.ops.map((item,index)=>index===0?{...item,sec:30}:{...item})};
  window.D=[data.existing];
  window._collection=name=>({name});
  window._where=(field,operator,value)=>({field,operator,value});
  window._orderBy=(field,direction)=>({field,direction});
  window._limit=count=>({limit:count});
  window._query=(collection,...conditions)=>({collection,conditions});
  window._docRef=(collection,id)=>({collection,id});
  window._getDocs=async query=>({docs:query?.collection?.name==='productionEntries'?[{id:'entry-1',data:()=>({
    employeeId:'E001',employeeName:'Nguyễn A',productionDate:'2026-09-10',productId:data.existing.productId,
    processId:data.first,quantity:60,status:'active'
  })}]:query?.collection?.name==='productionMonths'?[{id:'2026-09',data:()=>({month:'2026-09',status:'open'})}]:[]});
  window._getDoc=async reference=>{
    if(reference.collection==='productionMonths') return {exists:()=>true,data:()=>({status:'open'})};
    if(reference.collection==='productionEmployeeMonths') return {exists:()=>true,data:()=>({
      employeeId:'E001',employeeName:'Nguyễn A',month:'2026-09',days:{d10:{normalHours:1,overtimeHours:0,supplementHours:0,
        processes:[{productId:data.existing.productId,processId:data.first,quantity:60}]}}
    })};
    return {exists:()=>false,data:()=>({})};
  };
  vm.runInContext(read('js/product-import-impact.js'),context);
  const plan=window.PCMSProductImportImpact.buildPlan({newItems:[],sameItems:[],differentItems:[{existing:data.existing,incoming}]});
  plan.rows.forEach(row=>{ if(row.processId===data.first) row.impactCount=1; });
  await window.PCMSProductImportImpact.loadPerformanceImpacts(plan);
  assert.equal(plan.performanceDifferenceCount,1);
  assert.equal(plan.performanceImpacts[0].beforePercentage,120);
  assert.equal(plan.performanceImpacts[0].afterPercentage,60);
  assert.equal(Array.from(plan.performanceImpacts[0].entryIds).join(','),'entry-1');
});

test('新增工序在績效預覽前先取得固定身分，確認後沿用同一識別碼',async()=>{
  const window={S:{ws:3000}};
  const context={window,TextEncoder,console};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  vm.runInContext(read('js/production/efficiency-core.js'),context);
  vm.runInContext(read('js/product-resolver.js'),context);
  const data=fixtures(window.PCMSProductModel);
  const incoming={...data.existing,ops:[
    {...data.existing.ops[0],processId:'',sec:30},
    {...data.existing.ops[1],processId:''},
    {no:'10',category:'BL',zh:'剪耳朵*2',vi:'Cắt tai *2',sec:6}
  ]};
  window.D=[data.existing];
  window._collection=name=>({name});
  window._where=(field,operator,value)=>({field,operator,value});
  window._orderBy=(field,direction)=>({field,direction});
  window._limit=count=>({limit:count});
  window._query=(collection,...conditions)=>({collection,conditions});
  window._docRef=(collection,id)=>({collection,id});
  window._getDocs=async query=>({docs:query?.collection?.name==='productionEntries'?[{id:'entry-1',data:()=>(
    {employeeId:'E001',employeeName:'Nguyễn A',productionDate:'2026-09-10',productId:data.existing.productId,
      processId:data.first,quantity:60,status:'active'}
  )}]:query?.collection?.name==='productionMonths'?[{id:'2026-09',data:()=>({month:'2026-09',status:'open'})}]:[]});
  window._getDoc=async reference=>reference.collection==='productionEmployeeMonths'
    ?{exists:()=>true,data:()=>({employeeId:'E001',employeeName:'Nguyễn A',month:'2026-09',days:{d10:{normalHours:1,
      overtimeHours:0,supplementHours:0,processes:[{productId:data.existing.productId,processId:data.first,quantity:60}]}}})}
    :{exists:()=>false,data:()=>({})};
  vm.runInContext(read('js/product-import-impact.js'),context);
  const plan=window.PCMSProductImportImpact.buildPlan({
    newItems:[],sameItems:[],differentItems:[{existing:data.existing,incoming}]
  });
  const addedRow=plan.rows.find(row=>row.kind==='added'&&row.after?.vi==='Cắt tai *2');
  const plannedOperation=plan.requests[0].incoming.ops.find(operation=>operation.vi==='Cắt tai *2');
  assert.match(addedRow.processId,/^prc_[a-z0-9_-]{12,80}$/);
  assert.equal(plannedOperation.processId,addedRow.processId);
  await window.PCMSProductImportImpact.loadPerformanceImpacts(plan);
  assert.equal(plan.performanceDifferenceCount,1);
  assert.equal(plan.replacements[0].replacement.ops.find(operation=>operation.vi==='Cắt tai *2').processId,addedRow.processId);
});

test('績效差異只查最早未凍結月份之後的產能',async()=>{
  const window={S:{ws:3000}},queries=[];
  const context={window,TextEncoder,console};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  vm.runInContext(read('js/production/efficiency-core.js'),context);
  vm.runInContext(read('js/product-resolver.js'),context);
  const data=fixtures(window.PCMSProductModel);
  const incoming={...data.existing,ops:data.existing.ops.map((item,index)=>index===0?{...item,sec:30}:{...item})};
  window.D=[data.existing];
  window._collection=name=>({name});
  window._where=(field,operator,value)=>({field,operator,value});
  window._orderBy=(field,direction)=>({field,direction});
  window._limit=count=>({limit:count});
  window._query=(collection,...conditions)=>({collection,conditions});
  window._docRef=(collection,id)=>({collection,id});
  window._getDocs=async query=>{
    if(query?.collection?.name==='productionMonths') return {docs:[
      {id:'2026-09',data:()=>({month:'2026-09',status:'open'})}
    ]};
    queries.push(query);
    return {docs:[{id:'entry-open',data:()=>({employeeId:'E001',employeeName:'Nguyễn A',productionDate:'2026-09-10',
      productId:data.existing.productId,processId:data.first,quantity:60,status:'active'})}]};
  };
  window._getDoc=async reference=>reference.collection==='productionEmployeeMonths'
    ?{exists:()=>true,data:()=>({employeeId:'E001',month:'2026-09',days:{d10:{normalHours:1,overtimeHours:0,supplementHours:0,
      processes:[{productId:data.existing.productId,processId:data.first,quantity:60}]}}})}
    :{exists:()=>false,data:()=>({})};
  vm.runInContext(read('js/product-import-impact.js'),context);
  const plan=window.PCMSProductImportImpact.buildPlan({newItems:[],sameItems:[],differentItems:[{existing:data.existing,incoming}]});
  plan.rows.forEach(row=>{ if(row.processId===data.first) row.impactCount=1; });
  await window.PCMSProductImportImpact.loadPerformanceImpacts(plan);
  const dateFloor=queries[0].conditions.find(item=>item.field==='productionDate'&&item.operator==='>=');
  assert.equal(dateFloor.value,'2026-09-01');
  assert.equal(plan.performanceDifferenceCount,1);
});

test('月份狀態無法安全判定時回退完整產能查詢',async()=>{
  const window={S:{ws:3000}},queries=[];
  const context={window,TextEncoder,console};vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);vm.runInContext(read('js/production/efficiency-core.js'),context);
  vm.runInContext(read('js/product-resolver.js'),context);
  const data=fixtures(window.PCMSProductModel);
  const incoming={...data.existing,ops:data.existing.ops.map((item,index)=>index===0?{...item,sec:30}:{...item})};
  window.D=[data.existing];window._collection=name=>({name});window._where=(field,operator,value)=>({field,operator,value});
  window._orderBy=(field,direction)=>({field,direction});window._query=(collection,...conditions)=>({collection,conditions});
  window._limit=count=>({limit:count});
  window._docRef=(collection,id)=>({collection,id});
  window._getDocs=async query=>{
    if(query?.collection?.name==='productionMonths') return {docs:[{id:'bad-month',data:()=>({status:'open'})}]};
    queries.push(query);return {docs:[]};
  };
  window._getDoc=async()=>({exists:()=>false,data:()=>({})});
  vm.runInContext(read('js/product-import-impact.js'),context);
  const plan=window.PCMSProductImportImpact.buildPlan({newItems:[],sameItems:[],differentItems:[{existing:data.existing,incoming}]});
  plan.rows.forEach(row=>{ if(row.processId===data.first) row.impactCount=1; });
  await window.PCMSProductImportImpact.loadPerformanceImpacts(plan);
  assert.equal(queries[0].conditions.some(item=>item.field==='productionDate'&&item.operator==='>='),false);
});

test('多道工序合併查詢且只讀 open 月份，凍結年份不增加月份讀取',async()=>{
  const window={S:{ws:3000},queries:[]};
  const context={window,TextEncoder,console};vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);vm.runInContext(read('js/production/efficiency-core.js'),context);
  vm.runInContext(read('js/product-resolver.js'),context);
  const data=fixtures(window.PCMSProductModel);
  const incoming={...data.existing,ops:data.existing.ops.map(item=>({...item,sec:item.sec+5}))};
  window.D=[data.existing];window._collection=name=>({name});window._where=(field,operator,value)=>({field,operator,value});
  window._orderBy=(field,direction)=>({field,direction});window._limit=count=>({limit:count});
  window._query=(collection,...conditions)=>({collection,conditions});window._docRef=(collection,id)=>({collection,id});
  window._getDocs=async query=>{
    window.queries.push(query);
    if(query?.collection?.name==='productionMonths') return {docs:[{id:'2026-09',data:()=>({month:'2026-09',status:'open'})}]};
    return {docs:[]};
  };
  window._getDoc=async()=>({exists:()=>false,data:()=>({})});
  vm.runInContext(read('js/product-import-impact.js'),context);
  const plan=window.PCMSProductImportImpact.buildPlan({newItems:[],sameItems:[],differentItems:[{existing:data.existing,incoming}]});
  await window.PCMSProductImportImpact.loadImpactCounts(plan);
  await window.PCMSProductImportImpact.loadPerformanceImpacts(plan);
  const monthQueries=window.queries.filter(query=>query?.collection?.name==='productionMonths');
  const entryQueries=window.queries.filter(query=>query?.collection?.name==='productionEntries');
  assert.equal(monthQueries.length,1);
  assert.equal(monthQueries[0].conditions.some(item=>item.field==='status'&&item.value==='open'),true);
  assert.equal(entryQueries.length,1);
  const processFilter=entryQueries[0].conditions.find(item=>item.field==='processId');
  assert.equal(processFilter.operator,'in');
  assert.deepEqual(new Set(processFilter.value),new Set([data.first,data.second]));
});

test('全部月份已凍結時只做一筆存在確認，不查產能明細',async()=>{
  const window={S:{ws:3000},queries:[]};
  const context={window,TextEncoder,console};vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);vm.runInContext(read('js/production/efficiency-core.js'),context);
  vm.runInContext(read('js/product-resolver.js'),context);
  const data=fixtures(window.PCMSProductModel);
  const incoming={...data.existing,ops:data.existing.ops.map((item,index)=>index===0?{...item,sec:30}:{...item})};
  window.D=[data.existing];window._collection=name=>({name});window._where=(field,operator,value)=>({field,operator,value});
  window._orderBy=(field,direction)=>({field,direction});window._limit=count=>({limit:count});
  window._query=(collection,...conditions)=>({collection,conditions});window._docRef=(collection,id)=>({collection,id});
  let monthCalls=0;
  window._getDocs=async query=>{
    window.queries.push(query);
    if(query?.collection?.name==='productionMonths'){
      monthCalls+=1;
      return monthCalls===1?{docs:[]}:{docs:[{id:'2025-01',data:()=>({month:'2025-01',status:'locked'})}]};
    }
    return {docs:[]};
  };
  window._getDoc=async()=>({exists:()=>false,data:()=>({})});
  vm.runInContext(read('js/product-import-impact.js'),context);
  const plan=window.PCMSProductImportImpact.buildPlan({newItems:[],sameItems:[],differentItems:[{existing:data.existing,incoming}]});
  await window.PCMSProductImportImpact.loadPerformanceImpacts(plan);
  assert.equal(window.queries.filter(query=>query?.collection?.name==='productionMonths').length,2);
  assert.equal(window.queries.some(query=>query?.collection?.name==='productionEntries'),false);
  assert.equal(plan.performanceDifferenceCount,0);
});
