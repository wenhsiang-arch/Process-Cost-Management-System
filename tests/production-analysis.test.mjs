import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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

test('可信度只依累積有效工時插值並保留低中高分級',()=>{
  assert.deepEqual({...calc.confidenceForHours(3)},{hours:3,level:'low',percent:null,displayPercent:'<58%'});
  assert.equal(calc.confidenceForHours(15).percent,75);
  assert.equal(calc.confidenceForHours(30).level,'medium');
  assert.equal(calc.confidenceForHours(50).level,'high');
  assert.equal(calc.confidenceForHours(250).percent,99);
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
