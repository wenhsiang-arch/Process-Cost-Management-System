import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('js/performance-bonus/bonus-calculations.js',root),'utf8');
const context={window:{}};
vm.createContext(context);
vm.runInContext(source,context);
const bonus=context.window.PCMSPerformanceBonusCalculations;
const settings={unitPrice:400,companyShare:50,efficiencyCap:120};
const storeSource=fs.readFileSync(new URL('js/performance-bonus/bonus-store.js',root),'utf8');
const summarySource=fs.readFileSync(new URL('js/production/summary-store.js',root),'utf8');

test('績效效率無條件捨去後才計算員工獎金',()=>{
  assert.equal(bonus.wholeEfficiency(81.9),81);
  assert.equal(bonus.calculateDay({workedHours:8,percentage:85.9},settings).bonus,8000);
  assert.equal(bonus.calculateDay({workedHours:8,percentage:100},settings).bonus,32000);
  assert.equal(bonus.calculateDay({workedHours:11.5,percentage:100},settings).bonus,46000);
});

test('未滿八小時不給員工獎金但仍計算公司效率損益',()=>{
  const above=bonus.calculateDay({workedHours:4,percentage:100},settings);
  const below=bonus.calculateDay({workedHours:4,percentage:79.9},settings);
  assert.equal(above.bonus,0);
  assert.equal(above.grossExtra,32000);
  assert.equal(below.bonus,0);
  assert.equal(below.efficiencyLoss,1600);
});

test('員工獎金套用效率上限，公司損益仍使用實際整數效率',()=>{
  const result=bonus.calculateDay({workedHours:8,percentage:150.8},settings);
  assert.equal(result.rewardEfficiency,120);
  assert.equal(result.bonus,64000);
  assert.equal(result.grossExtra,224000);
});

test('人工扣款不會讓員工月獎金低於零',()=>{
  const result=bonus.calculateEmployee({
    employeeId:'M001',employeeName:'TEST',days:[{productionDate:'2026-08-01',workedHours:8,percentage:100}]
  },settings,-50000);
  assert.equal(result.baseBonus,32000);
  assert.equal(result.adjustmentAmount,-32000);
  assert.equal(result.finalBonus,0);
});

test('公開獎金對照表由固定80%延伸到設定上限',()=>{
  const rows=bonus.referenceRows(settings);
  assert.equal(rows.length,41);
  assert.deepEqual({...rows[0]},{efficiency:80,hours8:0,hours115:0});
  assert.deepEqual({...rows.at(-1)},{efficiency:120,hours8:64000,hours115:92000});
});

test('公開月頁只用公開每點每小時金額也能得到相同員工獎金',()=>{
  const table={efficiencyCap:120,employeePointHourAmount:200};
  const privateResult=bonus.calculateDay({workedHours:11.5,percentage:100},settings);
  const publicResult=bonus.calculatePublicDay({workedHours:11.5,percentage:100},table);
  assert.equal(publicResult.bonus,privateResult.bonus);
  assert.equal(publicResult.rewardEfficiency,100);
});

test('獎金設定與對照表只用工作階段記憶，不讀寫持久快取或 dataVersions',()=>{
  assert.match(storeSource,/directRead\('performanceBonusSettings'/);
  assert.match(storeSource,/directRead\('performanceBonusTable'/);
  assert.doesNotMatch(storeSource,/pcmsDataCache|firebaseReadDataVersions|firebaseTouchDataVersions/);
});

test('獎金試算沿用 productionEmployeeMonths 月摘要持久快取，不重讀同月份摘要',async()=>{
  const monthRows=[{
    month:'2026-08',employeeId:'M00001',employeeName:'An',department:'May',summaryComplete:true,schemaVersion:2,
    days:{d01:{productionDate:'2026-08-01',attendanceHours:8,standardHours:8,supplementHours:0,
      activeEntryCount:1,efficiencyPercentage:100,calculationStatus:'ready'}}
  }];
  const cacheEntries=new Map();
  let summaryDocumentReads=0;
  let controlReads=0;
  const appWindow={
    firebaseAuthUser:{uid:'manager-user'},cu:{user:'課長測試'},
    _docRef:(collection,id)=>({collection,id}),_collection:collection=>({collection}),
    _where:(field,operator,value)=>({field,operator,value}),_query:(...parts)=>({parts}),
    _getDoc:async reference=>{
      if(reference.collection==='productionMonths'){
        controlReads+=1;
        return {id:reference.id,exists:()=>true,data:()=>({month:reference.id,status:'open',revision:1,
          entriesVersion:'E1',attendanceVersion:'A1',summaryVersion:'S1',summaryReady:true})};
      }
      return {id:reference.id,exists:()=>false,data:()=>({})};
    },
    _getDocs:async query=>{
      const collection=query.parts?.[0]?.collection;
      if(collection==='productionEmployeeMonths'){
        summaryDocumentReads+=monthRows.length;
        return {docs:monthRows.map((row,index)=>({id:`row-${index+1}`,data:()=>row}))};
      }
      return {docs:[]};
    },
    pcmsDataCache:{
      async read(scope,version){
        const entry=cacheEntries.get(scope);
        return entry&&entry.version===String(version)?entry.data:null;
      },
      async write(scope,version,data){ cacheEntries.set(scope,{version:String(version),data}); }
    }
  };
  const appContext={window:appWindow,console,Object,Array,String,Number,Math,Date,Error,RegExp,Map,Set,JSON};
  vm.createContext(appContext);
  vm.runInContext(summarySource,appContext);
  vm.runInContext(source,appContext);
  vm.runInContext(storeSource,appContext);
  await appWindow.PCMSProductionSummaries.loadEmployeeMonths('2026-08',{version:'S1'});
  assert.equal(summaryDocumentReads,1);
  const table={version:1,baseEfficiency:80,minAttendanceHours:8,efficiencyCap:120,employeePointHourAmount:200,rows:[]};
  const result=await appWindow.PCMSPerformanceBonusStore.loadMonth('2026-08',{table});
  assert.equal(summaryDocumentReads,1);
  assert.equal(controlReads,2);
  assert.equal(result.employees.length,1);
  assert.equal(result.employees[0].baseBonus,32000);
});
