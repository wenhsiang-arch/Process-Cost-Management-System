import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const source=fs.readFileSync(new URL('js/production-analysis/analysis-calculations.js',root),'utf8');
const context={window:{}};
vm.createContext(context);
vm.runInContext(source,context);
const calc=context.window.PCMSProductionAnalysisCalculations;

function entry(options={}){
  return {
    status:'active',recordType:'standard',productionDate:'2026-08-10',
    employeeId:'M001',employeeName:'An',department:'May',productCode:'P001',
    processNo:'1',processNameVi:'May',processNameZh:'車縫',processSecSnapshot:15,
    hourlyCapacitySnapshot:200,quantity:400,...options
  };
}

function attendance(options={}){
  return {
    attendanceDate:'2026-08-10',employeeId:'M001',employeeName:'An',department:'May',
    normalHours:8,overtimeHours:0,...options
  };
}

test('標準有效工時沿用每小時產能快照',()=>{
  assert.equal(calc.calculationVersion,'production-analysis-v1');
  assert.equal(calc.standardHoursForEntry(entry()),2);
  assert.equal(calc.standardHoursForEntry(entry({recordType:'supplement',processNo:'0',quantity:0})),0);
});

test('扣除補充工時後依標準有效工時比例回推每道工序時間',()=>{
  const entries=[
    entry({processNo:'1',quantity:400}),
    entry({processNo:'2',processSecSnapshot:30,hourlyCapacitySnapshot:100,quantity:300}),
    entry({recordType:'supplement',processNo:'0',quantity:undefined,supplementHours:1})
  ];
  const dataset=calc.buildDataset({entries,attendance:[attendance()]});
  const day=dataset.days[0];
  assert.equal(day.standardHours,5);
  assert.equal(day.availableProductionHours,7);
  assert.equal(Math.round(day.processes[0].inferredHours*100)/100,2.8);
  assert.equal(Math.round(day.processes[1].inferredHours*100)/100,4.2);
  assert.equal(Math.round(day.processes.reduce((sum,item)=>sum+item.inferredHours,0)*10)/10,7);
});

test('工序秒數版本不同時分開統計且建議秒數由回推時間直接計算',()=>{
  const dataset=calc.buildDataset({
    entries:[entry(),entry({productionDate:'2026-08-11',processSecSnapshot:22,hourlyCapacitySnapshot:136,quantity:272})],
    attendance:[attendance(),attendance({attendanceDate:'2026-08-11'})]
  });
  assert.equal(dataset.processStats.length,2);
  assert.equal(dataset.processStats[0].suggestedSeconds>0,true);
});

function ieSample(seconds,index,options={}){
  const capacity=options.capacity??3000/seconds;
  const quantity=options.quantity??100;
  const inferredHours=options.inferredHours??1;
  return {
    key:`P001||1||${seconds}||${capacity}`,productCode:'P001',processNo:'1',
    processNameVi:'May',processNameZh:'車縫',processSecSnapshot:seconds,
    hourlyCapacitySnapshot:capacity,employeeId:`M${String(index+1).padStart(3,'0')}`,
    date:`2026-08-${String(index%28+1).padStart(2,'0')}`,
    standardHours:quantity/capacity,inferredHours,quantity
  };
}

function ieRows(samples,currentSeconds){
  const standards={'P001||1':{
    productCode:'P001',processNo:'1',processNameVi:'May',processNameZh:'車縫',
    processSec:currentSeconds,active:true
  }};
  return calc.ieAnalysisRows({processSamples:samples,analysisIndex:{dayMap:new Map()}},{},standards);
}

test('工序優化後 IE 只統計目前正式秒數，舊版本不影響建議值',()=>{
  const oldSamples=Array.from({length:30},(_,index)=>ieSample(20,index,{inferredHours:2}));
  const currentSamples=Array.from({length:5},(_,index)=>ieSample(18,index,{inferredHours:0.55+index*0.05}));
  const mixed=ieRows([...oldSamples,...currentSamples],18);
  const currentOnly=ieRows(currentSamples,18);
  assert.equal(mixed.length,1);
  assert.equal(mixed[0].currentSeconds,18);
  assert.equal(mixed[0].sampleCount,5);
  assert.equal(mixed[0].suggestedSeconds,currentOnly[0].suggestedSeconds);
  assert.equal(mixed[0].typicalEfficiency,currentOnly[0].typicalEfficiency);
});

test('目前正式秒數沒有有效樣本時 IE 不回退舊版本',()=>{
  const historical=Array.from({length:30},(_,index)=>ieSample(20,index));
  assert.equal(ieRows(historical,18).length,0);
});

test('標準錯誤訂正後只納入已改為目前秒數的 open 月份樣本',()=>{
  const corrected=Array.from({length:8},(_,index)=>ieSample(18,index));
  const lockedHistorical=Array.from({length:2},(_,index)=>ieSample(20,index+8));
  const rows=ieRows([...corrected,...lockedHistorical],18);
  assert.equal(rows.length,1);
  assert.equal(rows[0].currentSeconds,18);
  assert.equal(rows[0].sampleCount,8);
});

test('多個歷史秒數只保留目前版本且相同秒數的異常產能快照不拆列',()=>{
  const rows=ieRows([
    ieSample(15,0),ieSample(20,1),ieSample(18,2,{capacity:166}),ieSample(18,3,{capacity:167})
  ],18);
  assert.equal(rows.length,1);
  assert.equal(rows[0].key,'P001||1');
  assert.equal(rows[0].currentSeconds,18);
  assert.equal(rows[0].sampleCount,2);
});

test('IE 目前版本篩選不改變員工與部門歷史分析',()=>{
  const dataset=calc.buildDataset({
    entries:[
      entry({employeeId:'M001',productionDate:'2026-08-09',processSecSnapshot:15,hourlyCapacitySnapshot:200}),
      entry({employeeId:'M001',productionDate:'2026-08-10',processSecSnapshot:20,hourlyCapacitySnapshot:150}),
      entry({employeeId:'M002',productionDate:'2026-08-10',processSecSnapshot:18,hourlyCapacitySnapshot:167})
    ],
    attendance:[attendance({employeeId:'M001',attendanceDate:'2026-08-09'}),
      attendance({employeeId:'M001'}),attendance({employeeId:'M002'})]
  });
  const employeeBefore=rounded(calc.employeeAnalysisRows(dataset));
  const departmentBefore=rounded(calc.departmentAnalysisRows(dataset));
  const historicalCount=dataset.processStats.length;
  const rows=ieRows(dataset.processSamples,18);
  assert.equal(rows.length,1);
  assert.equal(dataset.processStats.length,historicalCount);
  assert.deepEqual(rounded(calc.employeeAnalysisRows(dataset)),employeeBefore);
  assert.deepEqual(rounded(calc.departmentAnalysisRows(dataset)),departmentBefore);
});

test('十人以上排除最高與最低各百分之二十後使用中間六成',()=>{
  const samples=Array.from({length:10},(_,index)=>({
    key:'P001||1||15||200',productCode:'P001',processNo:'1',processNameVi:'May',processNameZh:'車縫',
    processSecSnapshot:15,hourlyCapacitySnapshot:200,employeeId:`M${index}`,
    date:`2026-08-${String(index+1).padStart(2,'0')}`,standardHours:index+1,inferredHours:1,quantity:200
  }));
  const result=calc.aggregateProcess(samples);
  assert.equal(result.method,'trimmed-middle-60');
  assert.equal(result.typicalEmployeeIds.length,6);
  assert.equal(result.typicalEmployeeIds.includes('M0'),false);
  assert.equal(result.typicalEmployeeIds.includes('M9'),false);
});

test('員工高低位置直接比較同工序全線常規效率',()=>{
  assert.equal(calc.relativeLevel(80,100),'low');
  assert.equal(calc.relativeLevel(100,100),'middle');
  assert.equal(calc.relativeLevel(120,100),'high');
});

test('員工分析以員工每日分組並保留展開用工序明細',()=>{
  const dataset=calc.buildDataset({
    entries:[
      entry({productionDate:'2026-08-09',quantity:400}),
      entry({productionDate:'2026-08-10',quantity:800})
    ],
    attendance:[
      attendance({attendanceDate:'2026-08-09'}),
      attendance({attendanceDate:'2026-08-10'})
    ]
  });
  const rows=calc.employeeAnalysisRows(dataset,{fromDate:'2026-08-10',toDate:'2026-08-10'});
  const groups=calc.employeeDailyAnalysisGroups(rows);
  assert.equal(groups.length,1);
  assert.equal(groups[0].status,'ready');
  assert.equal(groups[0].comparison,'above');
  assert.equal(groups[0].processes.length,1);
  assert.equal(groups[0].processes[0].quantity,800);
});

test('缺少考勤、產能或標準產能時提供原因而不是可比較的零效率',()=>{
  function statusFor(input){
    const dataset=calc.buildDataset(input);
    return calc.employeeDailyAnalysisGroups(calc.employeeAnalysisRows(dataset))[0];
  }
  const noAttendance=statusFor({entries:[entry()],attendance:[]});
  const noProduction=statusFor({entries:[],attendance:[attendance()]});
  const noCapacity=statusFor({entries:[entry({hourlyCapacitySnapshot:0})],attendance:[attendance()]});
  const invalidAttendance=statusFor({entries:[entry()],attendance:[attendance({normalHours:0})]});
  assert.equal(noAttendance.status,'attendance-missing');
  assert.equal(noProduction.status,'production-missing');
  assert.equal(noCapacity.status,'capacity-missing');
  assert.equal(invalidAttendance.status,'attendance-invalid');
  [noAttendance,noProduction,noCapacity,invalidAttendance].forEach(group=>assert.equal(group.comparison,'unknown'));
});

test('零考勤且零產能視為未出勤並排除，有產能才判定考勤異常',()=>{
  const absentDataset=calc.buildDataset({
    entries:[],attendance:[attendance({normalHours:0,overtimeHours:0})]
  });
  const absentGroups=calc.employeeDailyAnalysisGroups(calc.employeeAnalysisRows(absentDataset));
  assert.equal(absentGroups.length,0);

  const invalidDataset=calc.buildDataset({
    entries:[entry()],attendance:[attendance({normalHours:0,overtimeHours:0})]
  });
  const invalidGroups=calc.employeeDailyAnalysisGroups(calc.employeeAnalysisRows(invalidDataset));
  assert.equal(invalidGroups.length,1);
  assert.equal(invalidGroups[0].status,'attendance-invalid');
});

test('員工分析畫面移除部門並以每日主列展開完整工序明細',()=>{
  const employeeSource=fs.readFileSync(new URL('js/production-analysis/employee-analysis.js',root),'utf8');
  const styleSource=fs.readFileSync(new URL('styles/features/production-analysis.css',root),'utf8');
  assert.doesNotMatch(employeeSource,/data-filter="department"|data-ui-table-column="department"/);
  assert.match(employeeSource,/employeeDailyAnalysisGroups/);
  assert.match(employeeSource,/employee-analysis-expand-button/);
  assert.match(employeeSource,/當日沒有工序產能明細/);
  assert.match(employeeSource,/rows:exportRowsData\(\)/);
  assert.match(styleSource,/\.employee-analysis-detail-row/);
  assert.match(styleSource,/\.employee-analysis-process-table/);
});

test('員工主表保留凍結表頭且展開工序子表不凍結',()=>{
  const employeeSource=fs.readFileSync(new URL('js/production-analysis/employee-analysis.js',root),'utf8');
  const styleSource=fs.readFileSync(new URL('styles/features/production-analysis.css',root),'utf8');
  assert.match(employeeSource,/employee-analysis-table" data-ui-table-controls="auto" data-ui-table-sticky="original"/);
  assert.match(employeeSource,/table\.className='ui-table employee-analysis-process-table'/);
  assert.match(styleSource,/\.employee-analysis-table\[data-ui-table-sticky="original"\] \.employee-analysis-process-table > thead \{[\s\S]*?position: static;[\s\S]*?top: auto;[\s\S]*?z-index: auto;[\s\S]*?transform: none;/);
});

test('三個分析分頁把公式集中到使用說明並移除表格算法欄',()=>{
  const sources=[
    fs.readFileSync(new URL('js/production-analysis/employee-analysis.js',root),'utf8'),
    fs.readFileSync(new URL('js/production-analysis/ie-analysis.js',root),'utf8'),
    fs.readFileSync(new URL('js/production-analysis/department-analysis.js',root),'utf8')
  ];
  sources.forEach(source=>{
    assert.doesNotMatch(source,/data-ui-table-column="explanation"|Xem cách tính|查看算法|production-analysis-formula-button/);
    assert.match(source,/function explanationAppendix\(\)/);
    assert.match(source,/formulaZh:explanationAppendix\(\)/);
  });
  const styleSource=fs.readFileSync(new URL('styles/features/production-analysis.css',root),'utf8');
  const featuresSource=fs.readFileSync(new URL('js/features.js',root),'utf8');
  assert.doesNotMatch(styleSource,/\.production-analysis-formula-button|\.production-analysis-explanation/);
  assert.match(styleSource,/\.production-analysis-dual-value \{[\s\S]*?display: inline-flex;[\s\S]*?width: fit-content;/);
  assert.match(featuresSource,/productionEmployeeAnalysis:'js\/production-analysis\/employee-analysis\.js\?v=20260815-/);
  assert.match(featuresSource,/productionIeAnalysis:'js\/production-analysis\/ie-analysis\.js\?v=20260816-/);
  assert.match(featuresSource,/productionDepartmentAnalysis:'js\/production-analysis\/department-analysis\.js\?v=20260815-/);
  assert.match(featuresSource,/productionAnalysis:'styles\/features\/production-analysis\.css\?v=20260813-1'/);
});

test('員工異常狀態依權限跳到指定日期與工號',()=>{
  const employeeSource=fs.readFileSync(new URL('js/production-analysis/employee-analysis.js',root),'utf8');
  const attendanceSource=fs.readFileSync(new URL('js/production/production-attendance.js',root),'utf8');
  assert.match(employeeSource,/status==='attendance-invalid'\) return 'production-attendance'/);
  assert.match(employeeSource,/status==='production-missing'\) return 'production-entry'/);
  assert.match(employeeSource,/canOpenPage\(pageName\)===true/);
  assert.match(employeeSource,/PCMSProductionAttendancePage\.setPendingContext\(\{employeeId:group\.employeeId,attendanceDate:group\.date\}\)/);
  assert.match(employeeSource,/PCMSProductionEntry\.setPendingContext\(\{employeeId:group\.employeeId,productionDate:group\.date\}\)/);
  assert.match(attendanceSource,/function setPendingContext\(context=\{\}\)/);
  assert.match(attendanceSource,/row\.dataset\.employeeId = draft\.employee\.employeeId/);
  assert.match(attendanceSource,/row\.scrollIntoView\(\{block:'center'\}\)/);
  assert.match(attendanceSource,/PCMSProductionAttendancePage = Object\.freeze\(\{setPendingContext\}\)/);
});

test('三個分析頁都以所選日期範圍直接計算且工序只顯示差異前二十筆',()=>{
  const commonSource=fs.readFileSync(new URL('js/production-analysis/production-analysis.js',root),'utf8');
  const styleSource=fs.readFileSync(new URL('styles/features/production-analysis.css',root),'utf8');
  const pages={
    employee:fs.readFileSync(new URL('js/production-analysis/employee-analysis.js',root),'utf8'),
    ie:fs.readFileSync(new URL('js/production-analysis/ie-analysis.js',root),'utf8'),
    department:fs.readFileSync(new URL('js/production-analysis/department-analysis.js',root),'utf8')
  };
  Object.entries(pages).forEach(([scope,source])=>{
    assert.match(source,new RegExp(`ui\\.dateField\\('${scope}','from'`));
    assert.match(source,new RegExp(`ui\\.dateField\\('${scope}','to'`));
    assert.match(source,/ui\.bindDateControls\(root\)/);
    assert.match(source,/dateControls\.sync\(\)/);
  });
  assert.match(pages.ie,/const DISPLAY_LIMIT=20/);
  assert.match(pages.ie,/calc\.ieAnalysisRows\(dataset,filters\(\),standards\)/);
  assert.match(pages.ie,/absoluteDifferenceSeconds/);
  assert.match(commonSource,/data-analysis-date-calendar/);
  assert.match(commonSource,/data-analysis-date-step="previous"/);
  assert.match(commonSource,/data-analysis-date-step="next"/);
  assert.match(commonSource,/input\.max=maximum/);
  assert.match(commonSource,/if\(days>0&&nextValue>maximum\) return/);
  assert.match(commonSource,/showPicker/);
  assert.match(commonSource,/new Event\('input',\{bubbles:true\}\)/);
  assert.match(styleSource,/\.production-analysis-calendar-button/);
  assert.match(styleSource,/\.production-analysis-date-stepper \{[\s\S]*?width: 16px;[\s\S]*?height: 28px;/);
  assert.match(styleSource,/\.production-analysis-date-control input::-webkit-calendar-picker-indicator/);
});

test('分析日期按鈕實際切換一天並阻止超過今天',()=>{
  const source=fs.readFileSync(new URL('js/production-analysis/production-analysis.js',root),'utf8');
  class TestEvent{constructor(type,options={}){this.type=type;this.bubbles=options.bubbles===true;}}
  function eventTarget(extra={}){
    const listeners=new Map();
    return Object.assign({
      addEventListener(type,listener){
        if(!listeners.has(type)) listeners.set(type,[]);
        listeners.get(type).push(listener);
      },
      dispatchEvent(event){(listeners.get(event.type)||[]).forEach(listener=>listener(event));},
      click(){this.dispatchEvent(new TestEvent('click'));}
    },extra);
  }
  const input=eventTarget({value:'2026-08-11',max:'',pickerOpened:false,focus(){},showPicker(){this.pickerOpened=true;}});
  const calendar=eventTarget();
  const previous=eventTarget();
  const next=eventTarget({disabled:false});
  const field={querySelector(selector){
    return {
      '[data-analysis-date-input]':input,
      '[data-analysis-date-calendar]':calendar,
      '[data-analysis-date-step="previous"]':previous,
      '[data-analysis-date-step="next"]':next
    }[selector]||null;
  }};
  const context={window:{},document:{querySelectorAll(){return[];}},console,Event:TestEvent,Date,Number,String,Object,Map,Set,RegExp};
  vm.createContext(context);
  vm.runInContext(source,context);
  const controls=context.window.PCMSProductionAnalysisUI.bindDateControls({querySelectorAll(){return [field];}});
  let filterEvents=0;
  input.addEventListener('input',()=>{filterEvents+=1;});
  previous.click();
  assert.equal(input.value,'2026-08-10');
  assert.equal(filterEvents,1);
  calendar.click();
  assert.equal(input.pickerOpened,true);
  const today=new Date();
  input.value=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  controls.sync();
  assert.equal(next.disabled,true);
  next.click();
  assert.equal(input.value,input.max);
});

test('部門效率以總有效工時除以總考勤工時而非平均個人百分比',()=>{
  const dataset=calc.buildDataset({
    entries:[entry({employeeId:'M001',quantity:400}),entry({employeeId:'M002',quantity:400})],
    attendance:[attendance({employeeId:'M001',normalHours:4}),attendance({employeeId:'M002',normalHours:8})]
  });
  const row=calc.departmentAnalysisRows(dataset,{fromDate:'2026-08-10',toDate:'2026-08-10'})[0];
  assert.equal(Math.round(row.efficiency*100)/100,33.33);
  assert.equal(row.employeeCount,2);
  assert.equal(row.attendanceHours,12);
});

test('生產分析只讀所選月份摘要並在瀏覽器計算工序，不啟動雲端待辦或統計',()=>{
  const store=fs.readFileSync(new URL('js/production-analysis/analysis-store.js',root),'utf8');
  assert.match(store,/PCMSProductionSummaries/);
  assert.match(store,/loadEmployeeMonths\(month/);
  assert.match(store,/productionMonths/);
  assert.match(store,/summaryVersion/);
  assert.doesNotMatch(store,/productionAnalysisSummaries|production-analysis-summaries|readEntry|saveCache/);
  assert.doesNotMatch(store,/productionMonthControls|productionMonthVersions/);
  assert.doesNotMatch(store,/productionEntries|productionAttendance/);
  assert.doesNotMatch(store,/PCMSProductionProcessStats|productionProcessAnalysisQueue|productionProcessAnalysisStats/);
  assert.match(store,/buildDatasetFromMonthSummaries\(rows,\{fromDate:request\.fromDate,toDate:request\.toDate\}\)/);
  assert.match(store,/firestoreWriteCount:0/);
});

test('月份摘要可直接建立員工日與工序分析結果',()=>{
  const monthRows=[{
    month:'2026-08',employeeId:'M001',employeeName:'An',department:'May',days:{
      '15':{productionDate:'2026-08-15',attendanceHours:8,standardHours:9,supplementHours:0,
        effectiveHours:9,activeEntryCount:1,invalidCapacityCount:0,efficiencyPercentage:112.5,
        calculationStatus:'ready',processes:[{key:'P001||1||48||63',productCode:'P001',processNo:'1',
          processNameVi:'May',processNameZh:'車縫',processSecSnapshot:48,hourlyCapacitySnapshot:63,
          quantity:100,standardHours:1.587302,inferredHours:1.410935,suggestedSeconds:42.32805}]}
    }
  }];
  const dataset=calc.buildDatasetFromMonthSummaries(monthRows,{fromDate:'2026-08-01',toDate:'2026-08-31'});
  assert.equal(dataset.days.length,1);
  assert.equal(dataset.days[0].employeeId,'M001');
  assert.equal(dataset.processStats.length,1);
  assert.equal(Math.round(dataset.processStats[0].absoluteDifferenceSeconds*100000)/100000,5.67195);
});

function monthRowsFromDataset(dataset,month='2026-08'){
  const rows=new Map();
  dataset.days.forEach(day=>{
    if(!rows.has(day.employeeId)) rows.set(day.employeeId,{
      month,employeeId:day.employeeId,employeeName:day.employeeName,department:day.department,
      summaryComplete:true,days:{}
    });
    rows.get(day.employeeId).days[day.date.slice(-2)]={
      productionDate:day.date,attendanceHours:day.attendanceHours,standardHours:day.standardHours,
      supplementHours:day.supplementHours,invalidCapacityCount:day.invalidCapacity?1:0,
      processes:day.processes.map(process=>({...process}))
    };
  });
  return [...rows.values()];
}

function rounded(value){
  return JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='number'&&Number.isFinite(item)
    ? Math.round(item*1000000)/1000000:item));
}

function currentStandardsFor(dataset){
  return Object.fromEntries(dataset.processSamples.map(item=>[
    `${item.productCode}||${item.processNo}`,
    {productCode:item.productCode,processNo:item.processNo,processNameVi:item.processNameVi,
      processNameZh:item.processNameZh,processSec:item.processSecSnapshot,active:true}
  ]));
}

test('同一批原始資料與月份摘要的員工、工序及部門分析結果一致',()=>{
  const entries=[];
  const attendanceRows=[];
  const employees=[];
  for(let employeeIndex=1;employeeIndex<=12;employeeIndex+=1){
    const employeeId=`M${String(employeeIndex).padStart(3,'0')}`;
    const department=employeeIndex%2?'May':'Dong goi';
    employees.push({employeeId,name:`Nhan vien ${employeeIndex}`,department});
    for(let day=1;day<=10;day+=1){
      const date=`2026-08-${String(day).padStart(2,'0')}`;
      attendanceRows.push(attendance({attendanceDate:date,employeeId,employeeName:`Nhan vien ${employeeIndex}`,department}));
      for(let processIndex=1;processIndex<=4;processIndex+=1){
        entries.push(entry({productionDate:date,employeeId,employeeName:`Nhan vien ${employeeIndex}`,department,
          productCode:`P00${processIndex}`,processNo:String(processIndex),processSecSnapshot:12+processIndex,
          hourlyCapacitySnapshot:180-processIndex*10,quantity:180+employeeIndex*3+day+processIndex}));
      }
    }
  }
  const raw=calc.buildDataset({entries,attendance:attendanceRows,employees});
  const filters={fromDate:'2026-08-01',toDate:'2026-08-10'};
  const summary=calc.buildDatasetFromMonthSummaries(monthRowsFromDataset(raw),filters);
  const standards=currentStandardsFor(raw);
  assert.deepEqual(rounded(calc.employeeAnalysisRows(summary,filters)),rounded(calc.employeeAnalysisRows(raw,filters)));
  assert.deepEqual(rounded(calc.ieAnalysisRows(summary,filters,standards)),rounded(calc.ieAnalysisRows(raw,filters,standards)));
  assert.deepEqual(rounded(calc.departmentAnalysisRows(summary,filters)),rounded(calc.departmentAnalysisRows(raw,filters)));
});

function syntheticMonthRows(employeeCount,dayCount=31,processCount=6){
  return Array.from({length:employeeCount},(_,employeeIndex)=>{
    const employeeId=`M${String(employeeIndex+1).padStart(3,'0')}`;
    const days={};
    for(let day=1;day<=dayCount;day+=1){
      const date=`2026-08-${String(day).padStart(2,'0')}`;
      const processes=Array.from({length:processCount},(_,processIndex)=>{
        const currentSeconds=18+processIndex*3;
        const capacity=3000/currentSeconds;
        const quantity=120+employeeIndex%11+day+processIndex*4;
        const standardHours=quantity/capacity;
        const inferredHours=8/processCount*(0.9+(employeeIndex%7)*0.025);
        return {
          key:`P${String(processIndex+1).padStart(3,'0')}||${processIndex+1}||${currentSeconds}||${capacity}`,
          productCode:`P${String(processIndex+1).padStart(3,'0')}`,processNo:String(processIndex+1),
          processNameVi:`Cong doan ${processIndex+1}`,processNameZh:`工序${processIndex+1}`,
          processSecSnapshot:currentSeconds,hourlyCapacitySnapshot:capacity,quantity,standardHours,inferredHours,
          suggestedSeconds:inferredHours*3000/quantity
        };
      });
      days[String(day).padStart(2,'0')]={productionDate:date,attendanceHours:8,
        standardHours:processes.reduce((sum,item)=>sum+item.standardHours,0),supplementHours:0,
        invalidCapacityCount:0,processes};
    }
    return {month:'2026-08',employeeId,employeeName:`Nhan vien ${employeeIndex+1}`,
      department:`D${employeeIndex%5+1}`,summaryComplete:true,days};
  });
}

function benchmarkAnalysis(employeeCount){
  const started=performance.now();
  const filters={fromDate:'2026-08-01',toDate:'2026-08-31'};
  const dataset=calc.buildDatasetFromMonthSummaries(syntheticMonthRows(employeeCount),filters);
  const employeeRows=calc.employeeAnalysisRows(dataset,filters);
  const dailyRows=calc.employeeDailyAnalysisGroups(employeeRows);
  const processRows=calc.ieAnalysisRows(dataset,filters,currentStandardsFor(dataset));
  const departmentRows=calc.departmentAnalysisRows(dataset,filters);
  return {milliseconds:performance.now()-started,employeeRows:dailyRows.length,processRows:processRows.length,
    departmentRows:departmentRows.length};
}

test('純瀏覽器分析支援 40、50、100 與 150 人的 31 天資料量',()=>{
  const results=[40,50,100,150].map(employeeCount=>({employeeCount,...benchmarkAnalysis(employeeCount)}));
  console.log('production-analysis-benchmark',JSON.stringify(results));
  assert.equal(results[0].employeeRows,40*31);
  assert.equal(results[2].employeeRows,100*31);
  assert.equal(results[3].employeeRows,150*31);
  assert.ok(results[0].milliseconds<1000,`40 人耗時 ${results[0].milliseconds.toFixed(2)} ms`);
  assert.ok(results[2].milliseconds<3000,`100 人耗時 ${results[2].milliseconds.toFixed(2)} ms`);
  assert.ok(results[3].milliseconds<6000,`150 人耗時 ${results[3].milliseconds.toFixed(2)} ms`);
});

test('40 人月份分析冷讀 41 Reads、快取重開 1 Read，兩者皆為 0 Firestore Writes',async()=>{
  const calculationSource=fs.readFileSync(new URL('js/production-analysis/analysis-calculations.js',root),'utf8');
  const summarySource=fs.readFileSync(new URL('js/production/summary-store.js',root),'utf8');
  const storeSource=fs.readFileSync(new URL('js/production-analysis/analysis-store.js',root),'utf8');
  const cloudRows=syntheticMonthRows(40,31,4);
  const cacheEntries=new Map();
  const context={window:{},console,Date,setTimeout,clearTimeout};
  context.window._docRef=(collection,id)=>({collection,id});
  context.window._collection=collection=>({collection});
  context.window._where=(field,operator,value)=>({field,operator,value});
  context.window._query=(...parts)=>({parts});
  context.window._getDoc=async reference=>({
    exists:()=>true,
    data:()=>({month:reference.id,status:'open',revision:1,summaryReady:true,summaryVersion:'S1'})
  });
  context.window._getDocs=async()=>({docs:cloudRows.map((row,index)=>({id:`row-${index+1}`,data:()=>row}))});
  context.window.pcmsDataCache={
    async read(scope,version){
      const entry=cacheEntries.get(scope);
      return entry&&entry.version===String(version)?entry.data:null;
    },
    async write(scope,version,data){ cacheEntries.set(scope,{version:String(version),data}); }
  };
  vm.createContext(context);
  vm.runInContext(summarySource,context);
  vm.runInContext(calculationSource,context);
  vm.runInContext(storeSource,context);
  const filters={fromDate:'2026-08-01',toDate:'2026-08-31'};
  await context.window.PCMSProductionAnalysisStore.load(filters);
  assert.equal(context.window.lastProductionAnalysisReadMetrics.firestoreReadCount,41);
  assert.equal(context.window.lastProductionAnalysisReadMetrics.firestoreWriteCount,0);
  assert.equal(context.window.lastProductionAnalysisReadMetrics.employeeMonthReadCount,40);
  context.window.PCMSProductionAnalysisStore.resetMemory();
  await context.window.PCMSProductionAnalysisStore.load(filters);
  assert.equal(context.window.lastProductionAnalysisReadMetrics.firestoreReadCount,1);
  assert.equal(context.window.lastProductionAnalysisReadMetrics.firestoreWriteCount,0);
  assert.equal(context.window.lastProductionAnalysisReadMetrics.employeeMonthReadCount,0);
});

async function runCurrentStandardScenario(keyCount,scenario){
  const storeSource=fs.readFileSync(new URL('js/production-analysis/analysis-store.js',root),'utf8');
  const productModelSource=fs.readFileSync(new URL('js/product-model.js',root),'utf8');
  const products=Array.from({length:keyCount},(_,index)=>({
    code:`P${String(index+1).padStart(4,'0')}`,
    ops:[{no:'1',category:'SX',vi:`Cong doan ${index+1}`,zh:`工序${index+1}`,sec:18+index%7}]
  }));
  const dataset={processSamples:products.map(item=>({
    productCode:item.code,processNo:'1',processSecSnapshot:item.ops[0].sec,hourlyCapacitySnapshot:3000/item.ops[0].sec
  }))};
  let queryCount=0;
  let metaCalls=0;
  let cacheCalls=0;
  const fullProducts=scenario!=='analysis-only';
  const context={window:{},console,Date,setTimeout,clearTimeout,performance};
  context.window.cu={role:fullProducts?'manager':'sales',authUid:'analysis-user'};
  context.window.firebaseAuthUser={uid:'analysis-user'};
  context.window.permissionSettings={
    manager:{summary:true,productsMain:true},sales:{productionAnalysis:true}
  };
  context.window.D=scenario==='runtime'?products:[];
  context.window.lastProductReadMetrics=scenario==='runtime'?{mode:'indexeddb',finishedAt:Date.now()}:null;
  context.window.PCMSProductCache={async read(){cacheCalls+=1;return {version:'CACHE-1',items:products};}};
  context.window.getProductsMetaForFeature=async()=>{
    metaCalls+=1;
    return {version:scenario==='indexeddb'?'CACHE-1':'CACHE-2'};
  };
  context.window._collection=collection=>({collection});
  context.window._where=(field,operator,value)=>({field,operator,value});
  context.window._query=(...parts)=>({parts});
  context.window._getDocs=async request=>{
    queryCount+=1;
    const ids=request.parts.find(item=>item?.field==='standardId')?.value||[];
    const docs=ids.map(id=>{
      const [encodedCode,encodedNo]=id.split('__');
      const productCode=decodeURIComponent(encodedCode);
      const processNo=decodeURIComponent(encodedNo);
      const product=products.find(item=>item.code===productCode);
      return {id,data:()=>({
        standardId:id,productCode,processNo,processSec:product.ops[0].sec,
        processNameVi:product.ops[0].vi,processNameZh:product.ops[0].zh,active:true
      })};
    });
    return {size:docs.length,docs};
  };
  vm.createContext(context);
  vm.runInContext(productModelSource,context);
  vm.runInContext(storeSource,context);
  const started=performance.now();
  const result=await context.window.PCMSProductionAnalysisStore.loadCurrentStandards({dataset});
  return {scenario,keyCount,elapsedMs:performance.now()-started,queryCount,metaCalls,cacheCalls,
    standardCount:result.standards.size,metrics:context.window.lastProductionIEStandardReadMetrics};
}

test('IE 目前正式標準依 runtime、有效快取、過期快取及分析專用權限選擇最低 Reads',async()=>{
  const keyCounts=[20,100,500,1000];
  const results=[];
  for(const keyCount of keyCounts){
    for(const scenario of ['runtime','indexeddb','stale-cache','analysis-only']){
      const result=await runCurrentStandardScenario(keyCount,scenario);
      results.push({...result,metrics:{...result.metrics}});
      const chunks=Math.ceil(keyCount/30);
      assert.equal(result.standardCount,keyCount);
      if(scenario==='runtime'){
        assert.equal(result.metrics.clientReadCount,0);
        assert.equal(result.queryCount,0);
        assert.equal(result.cacheCalls,0);
      }else if(scenario==='indexeddb'){
        assert.equal(result.metrics.clientReadCount,1);
        assert.equal(result.metrics.rulesDependentReadCount,2);
        assert.equal(result.queryCount,0);
      }else if(scenario==='stale-cache'){
        assert.equal(result.metrics.clientReadCount,keyCount+1);
        assert.equal(result.metrics.rulesDependentReadCount,(chunks+1)*2);
        assert.equal(result.queryCount,chunks);
      }else{
        assert.equal(result.metrics.clientReadCount,keyCount);
        assert.equal(result.metrics.rulesDependentReadCount,chunks*2);
        assert.equal(result.queryCount,chunks);
        assert.equal(result.metaCalls,0);
        assert.equal(result.cacheCalls,0);
      }
      assert.equal(result.metrics.fullProductReadCount,0);
    }
  }
  console.log('production-ie-standard-read-benchmark',JSON.stringify(results.map(item=>({
    scenario:item.scenario,keyCount:item.keyCount,clientReads:item.metrics.clientReadCount,
    rulesDependentReads:item.metrics.rulesDependentReadCount,queryCount:item.queryCount,
    elapsedMs:Number(item.elapsedMs.toFixed(3))
  }))));
});
