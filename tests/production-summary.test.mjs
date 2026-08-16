import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('js/production/summary-store.js',root),'utf8');
const migrationSource=fs.readFileSync(new URL('js/production/summary-migration.js',root),'utf8');
const processStatsSource=fs.readFileSync(new URL('js/production-analysis/process-stats-store.js',root),'utf8');
const analysisSource=fs.readFileSync(new URL('js/production-analysis/analysis-calculations.js',root),'utf8');

function loadStore(){
  const window={
    firebaseAuthUser:{uid:'admin-user'},cu:{role:'admin',user:'管理員'},
    _docRef:(collection,id)=>({collection,id})
  };
  const context={window,console,Object,Array,String,Number,Math,Date,Error,RegExp,Map,Set};
  vm.createContext(context);
  vm.runInContext(source,context);
  vm.runInContext(migrationSource,context);
  vm.runInContext(processStatsSource,context);
  vm.runInContext(analysisSource,context);
  return Object.assign({},window.PCMSProductionSummaries,{migration:window.PCMSProductionSummaryMigration,
    processStats:window.PCMSProductionProcessStats,analysis:window.PCMSProductionAnalysisCalculations});
}

const actor={updatedAt:1000,updatedByUid:'clerk-user',updatedBy:'Văn thư / 文員'};

test('日摘要同時保留考勤、正常有效工時與補充工時',()=>{
  const store=loadStore();
  let day=store.emptyDay({
    productionDate:'2026-08-15',employeeId:'M00001',employeeName:'Nguyễn An',department:'May',
    attendance:{normalHours:8,overtimeHours:0},actor
  });
  day=store.applyEntry(day,{
    id:'entry-1',recordType:'standard',productionDate:'2026-08-15',employeeId:'M00001',employeeName:'Nguyễn An',
    department:'May',quantity:120,hourlyCapacitySnapshot:60
  },1,actor);
  day=store.applyEntry(day,{
    id:'entry-2',recordType:'supplement',productionDate:'2026-08-15',employeeId:'M00001',employeeName:'Nguyễn An',
    department:'May',processNo:'0',supplementHours:4
  },1,actor);
  assert.equal(day.attendanceHours,8);
  assert.equal(day.standardHours,2);
  assert.equal(day.activeSupplementHours,4);
  assert.equal(day.effectiveHours,6);
  assert.equal(day.efficiencyPercentage,75);
  assert.equal(day.activeEntryCount,2);
});

test('作廢只退回對應紀錄，不重算整月',()=>{
  const store=loadStore();
  let day=store.emptyDay({
    productionDate:'2026-08-15',employeeId:'M00001',attendance:{normalHours:8,overtimeHours:0},actor
  });
  const entry={id:'entry-1',recordType:'standard',productionDate:'2026-08-15',employeeId:'M00001',quantity:120,hourlyCapacitySnapshot:60};
  day=store.applyEntry(day,entry,1,actor);
  day=store.applyEntry(day,{...entry,mutation:'void'},-1,actor);
  assert.equal(day.activeEntryCount,0);
  assert.equal(day.standardHours,0);
  assert.equal(day.lastMutation,'void');
});

test('考勤異動只更新當日計算結果',()=>{
  const store=loadStore();
  let day=store.emptyDay({
    productionDate:'2026-08-15',employeeId:'M00001',attendance:{normalHours:8,overtimeHours:0},actor
  });
  day=store.applyEntry(day,{id:'entry-1',recordType:'standard',productionDate:'2026-08-15',employeeId:'M00001',quantity:480,hourlyCapacitySnapshot:60},1,actor);
  const changed=store.applyAttendance(day,{attendanceDate:'2026-08-15',employeeId:'M00001',normalHours:8,overtimeHours:2},actor);
  assert.equal(changed.standardHours,8);
  assert.equal(changed.attendanceHours,10);
  assert.equal(changed.efficiencyPercentage,80);
  assert.equal(changed.lastMutation,'attendance');
});

test('月摘要以每日結果取代單日，不會重複累加',()=>{
  const store=loadStore();
  let day=store.emptyDay({productionDate:'2026-08-15',employeeId:'M00001',attendance:{normalHours:8,overtimeHours:0},actor});
  day=store.applyEntry(day,{id:'entry-1',recordType:'standard',productionDate:'2026-08-15',employeeId:'M00001',quantity:480,hourlyCapacitySnapshot:60},1,actor);
  let month=store.applyDayToMonth(null,null,day,actor,{complete:true});
  const corrected=store.applyAttendance(day,{attendanceDate:'2026-08-15',employeeId:'M00001',normalHours:8,overtimeHours:2},actor);
  month=store.applyDayToMonth(month,day,corrected,actor,{complete:true});
  assert.equal(Object.keys(month.days).length,1);
  assert.equal(month.attendanceHours,10);
  assert.equal(month.standardHours,8);
  assert.equal(month.efficiencyPercentage,80);
});

test('每日摘要按工序累加並用當日可用工時回推建議秒數',()=>{
  const store=loadStore();
  let day=store.emptyDay({productionDate:'2026-08-15',employeeId:'M00001',attendance:{normalHours:8,overtimeHours:0},actor});
  const first={id:'e1',recordType:'standard',productionDate:'2026-08-15',employeeId:'M00001',productCode:'P1',processNo:'1',
    processNameVi:'May',processNameZh:'車縫',processSecSnapshot:60,hourlyCapacitySnapshot:50,quantity:100};
  const second={id:'e2',recordType:'standard',productionDate:'2026-08-15',employeeId:'M00001',productCode:'P1',processNo:'2',
    processNameVi:'Kiểm',processNameZh:'檢查',processSecSnapshot:90,hourlyCapacitySnapshot:25,quantity:75};
  day=store.applyEntry(day,first,1,actor);
  day=store.applyEntry(day,second,1,actor);
  assert.equal(day.processes.length,2);
  assert.equal(day.standardHours,5);
  assert.equal(Math.round(day.processes[0].inferredHours*10)/10,3.2);
  assert.equal(Math.round(day.processes[1].inferredHours*10)/10,4.8);
  day=store.applyEntry(day,{...first,mutation:'void'},-1,actor);
  assert.equal(day.processes.length,1);
  assert.equal(day.processes[0].processNo,'2');
});

test('工序統計只保存秒數差異並可供前二十名排序',()=>{
  const store=loadStore();
  const stat=store.processStats.buildStat(null,{key:'P1||1||60||50',productCode:'P1',processNo:'1',
    processNameVi:'May',processNameZh:'車縫',processSecSnapshot:60,hourlyCapacitySnapshot:50},{
      M1:{standardHours:2,inferredHours:4,quantity:100,sampleCount:1},
      M2:{standardHours:3,inferredHours:6,quantity:150,sampleCount:1}
    },actor);
  assert.equal(stat.participantCount,2);
  assert.equal(stat.suggestedSeconds,120);
  assert.equal(stat.absoluteDifferenceSeconds,60);
});

test('同月份同日期範圍的新版摘要分析與舊工序統計顯示結果一致',()=>{
  const store=loadStore();
  const round=(value,digits=6)=>Math.round((Number(value)+Number.EPSILON)*10**digits)/10**digits;
  const monthRows=[];
  for(let employeeIndex=1;employeeIndex<=12;employeeIndex+=1){
    const employeeId=`M${String(employeeIndex).padStart(3,'0')}`;
    const days={};
    for(let dayIndex=1;dayIndex<=10;dayIndex+=1){
      const productionDate=`2026-08-${String(dayIndex).padStart(2,'0')}`;
      const processes=[];
      for(let processIndex=1;processIndex<=4;processIndex+=1){
        const currentSeconds=15+processIndex*3;
        const capacity=3000/currentSeconds;
        const quantity=120+employeeIndex*2+dayIndex+processIndex;
        const standardHours=round(quantity/capacity);
        const inferredHours=round(1.65+(employeeIndex%5)*0.07+processIndex*0.03);
        processes.push({
          key:`P${processIndex}||${processIndex}||${currentSeconds}||${capacity}`,
          productCode:`P${processIndex}`,processNo:String(processIndex),processNameVi:`Cong doan ${processIndex}`,
          processNameZh:`工序${processIndex}`,processSecSnapshot:currentSeconds,hourlyCapacitySnapshot:capacity,
          quantity,standardHours,inferredHours,suggestedSeconds:round(inferredHours*3000/quantity,4)
        });
      }
      days[String(dayIndex).padStart(2,'0')]={productionDate,attendanceHours:8,
        standardHours:round(processes.reduce((sum,item)=>sum+item.standardHours,0)),supplementHours:0,
        invalidCapacityCount:0,processes};
    }
    monthRows.push({month:'2026-08',employeeId,employeeName:`Nhan vien ${employeeIndex}`,
      department:`D${employeeIndex%3}`,summaryComplete:true,days});
  }
  const current=store.analysis.buildDatasetFromMonthSummaries(monthRows,{fromDate:'2026-08-01',toDate:'2026-08-10'});
  const currentByKey=new Map(current.processStats.map(item=>[item.key,item]));
  const grouped=new Map();
  monthRows.forEach(employee=>Object.values(employee.days).forEach(day=>day.processes.forEach(process=>{
    if(!grouped.has(process.key)) grouped.set(process.key,{source:process,employeeTotals:{}});
    const group=grouped.get(process.key);
    const totals=group.employeeTotals[employee.employeeId]||(group.employeeTotals[employee.employeeId]={
      standardHours:0,inferredHours:0,quantity:0,sampleCount:0
    });
    totals.standardHours=round(totals.standardHours+process.standardHours);
    totals.inferredHours=round(totals.inferredHours+process.inferredHours);
    totals.quantity+=process.quantity;
    totals.sampleCount+=process.inferredHours>0&&process.quantity>0?1:0;
  })));
  const numericFields=['suggestedSeconds','differenceSeconds','absoluteDifferenceSeconds','differencePercent',
    'typicalEfficiency','rawEfficiency','rawSuggestedSeconds','cumulativeStandardHours','totalInferredHours'];
  let maximumInternalDifference=0;
  grouped.forEach(group=>{
    const legacy=store.processStats.buildStat(null,group.source,group.employeeTotals,{});
    const next=currentByKey.get(group.source.key);
    assert.equal(next.method,legacy.method);
    assert.equal(next.participantCount,legacy.participantCount);
    assert.equal(next.sampleCount,legacy.sampleCount);
    numericFields.forEach(field=>{
      const difference=Math.abs(Number(next[field]||0)-Number(legacy[field]||0));
      maximumInternalDifference=Math.max(maximumInternalDifference,difference);
      assert.equal(Number(next[field]||0).toFixed(2),Number(legacy[field]||0).toFixed(2),field);
    });
  });
  assert.ok(maximumInternalDifference<0.0003,`內部四捨五入差距 ${maximumInternalDifference}`);
});

test('既有原始資料可建立可對照的完整日與月摘要',()=>{
  const store=loadStore();
  const result=store.buildEmployeeMonth({
    month:'2026-08',employeeId:'M00001',employeeName:'Nguyễn An',department:'May',actor,
    attendanceRows:[
      {attendanceDate:'2026-08-14',employeeId:'M00001',normalHours:8,overtimeHours:0},
      {attendanceDate:'2026-08-15',employeeId:'M00001',normalHours:8,overtimeHours:2}
    ],
    entries:[
      {id:'e1',status:'active',recordType:'standard',productionDate:'2026-08-14',employeeId:'M00001',quantity:240,hourlyCapacitySnapshot:60},
      {id:'e2',status:'active',recordType:'supplement',productionDate:'2026-08-15',employeeId:'M00001',processNo:'0',supplementHours:4},
      {id:'e3',status:'voided',recordType:'standard',productionDate:'2026-08-15',employeeId:'M00001',quantity:999,hourlyCapacitySnapshot:1}
    ]
  });
  assert.equal(result.dayDocuments.length,2);
  assert.equal(result.monthDocument.attendanceHours,18);
  assert.equal(result.monthDocument.standardHours,4);
  assert.equal(result.monthDocument.supplementHours,4);
  assert.equal(result.monthDocument.summaryComplete,true);
});

test('員工月摘要可共用已取得的 summaryVersion 並正確命中或失效持久快取',async()=>{
  const monthRows=Array.from({length:40},(_,index)=>({
    month:'2026-08',employeeId:`M${String(index+1).padStart(5,'0')}`,
    summaryComplete:true,schemaVersion:2,days:{}
  }));
  const cacheEntries=new Map();
  let controlReads=0;
  let summaryReads=0;
  const window={
    _docRef:(collection,id)=>({collection,id}),
    _getDoc:async()=>{ controlReads+=1; return {exists:()=>true,data:()=>({summaryVersion:'S1'})}; },
    _collection:collection=>({collection}),_where:(...parts)=>parts,_query:(...parts)=>({parts}),
    _getDocs:async()=>{
      summaryReads+=monthRows.length;
      return {docs:monthRows.map((row,index)=>({id:`row-${index+1}`,data:()=>row}))};
    },
    pcmsDataCache:{
      async read(scope,version){
        const entry=cacheEntries.get(scope);
        return entry&&entry.version===String(version)?entry.data:null;
      },
      async write(scope,version,data){ cacheEntries.set(scope,{version:String(version),data}); }
    }
  };
  const context={window,console,Object,Array,String,Number,Math,Date,Error,RegExp,Map,Set};
  vm.createContext(context);
  vm.runInContext(source,context);
  let metrics;
  await window.PCMSProductionSummaries.loadEmployeeMonths('2026-08',{version:'S1',onMetrics:value=>{metrics=value;}});
  assert.equal(controlReads,0);
  assert.equal(summaryReads,40);
  assert.equal(metrics.source,'cloud');
  await window.PCMSProductionSummaries.loadEmployeeMonths('2026-08',{version:'S1',onMetrics:value=>{metrics=value;}});
  assert.equal(summaryReads,40);
  assert.equal(metrics.source,'indexeddb');
  assert.equal(metrics.documentReadCount,0);
  await window.PCMSProductionSummaries.loadEmployeeMonths('2026-08',{version:'S2'});
  assert.equal(summaryReads,80);
});

test('轉換計畫只新增摘要且可先試算讀取量',()=>{
  const store=loadStore();
  const plan=store.migration.buildPlan('2026-08',{
    attendanceRows:[{attendanceDate:'2026-08-15',employeeId:'M00001',employeeName:'Nguyễn An',department:'May',normalHours:8,overtimeHours:0}],
    entries:[{id:'e1',status:'active',recordType:'standard',productionDate:'2026-08-15',employeeId:'M00001',employeeName:'Nguyễn An',department:'May',quantity:240,hourlyCapacitySnapshot:60}]
  },[]);
  assert.equal(plan.sourceEntryCount,1);
  assert.equal(plan.sourceAttendanceCount,1);
  assert.equal(plan.estimatedReads,2);
  assert.equal(plan.dayDocuments.length,1);
  assert.equal(plan.monthDocuments.length,1);
});

test('舊月份轉換只在管理員確認後寫入且月獎金頁提供一次性入口',()=>{
  const page=fs.readFileSync(new URL('js/performance-bonus/monthly-bonus-page.js',root),'utf8');
  const bonus=fs.readFileSync(new URL('js/performance-bonus/bonus-store.js',root),'utf8');
  assert.match(page,/id="performance-bonus-migrate"/);
  assert.match(page,/PCMSProductionSummaryMigration\.migrateMonth/);
  assert.match(page,/migrationSource\.entries/);
  assert.doesNotMatch(bonus,/PCMSProductionPerformance\.loadPerformanceRange/);
});

test('每日一千筆報工只形成四十份員工日摘要與四十份月摘要',()=>{
  const store=loadStore();
  const rawEntryCount=1000;
  const employeeCount=40;
  const entriesPerEmployee=rawEntryCount/employeeCount;
  const days=[];
  const months=[];
  for(let employeeIndex=0;employeeIndex<employeeCount;employeeIndex+=1){
    const employeeId=`M${String(employeeIndex+1).padStart(5,'0')}`;
    let day=store.emptyDay({
      productionDate:'2026-08-15',employeeId,employeeName:`員工${employeeIndex+1}`,
      department:'生產部',attendance:{normalHours:8,overtimeHours:2},actor
    });
    for(let entryIndex=0;entryIndex<entriesPerEmployee;entryIndex+=1){
      day=store.applyEntry(day,{
        id:`${employeeId}-${entryIndex+1}`,recordType:'standard',productionDate:'2026-08-15',
        employeeId,employeeName:`員工${employeeIndex+1}`,department:'生產部',quantity:10,
        productCode:`P${String(entryIndex+1).padStart(3,'0')}`,processNo:String(entryIndex+1),
        processSecSnapshot:60,hourlyCapacitySnapshot:60
      },1,actor);
    }
    days.push(day);
    months.push(store.applyDayToMonth(null,null,day,actor,{complete:true}));
  }
  assert.equal(days.length,40);
  assert.equal(months.length,40);
  assert.equal(days.reduce((sum,item)=>sum+item.activeEntryCount,0),rawEntryCount);
  assert.equal(days.reduce((sum,item)=>sum+item.processes.length,0),rawEntryCount);
  assert.equal(rawEntryCount/days.length,25);
  assert.ok(days.length/rawEntryCount<=0.04);
});
