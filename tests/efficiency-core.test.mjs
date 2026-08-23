import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('js/production/efficiency-core.js',root),'utf8');
const context={window:{}};
vm.createContext(context);
vm.runInContext(source,context);
const core=context.window.PCMSProductionEfficiencyCore;

test('每小時產能沿用正式工作秒數除以標準秒數的現行公式',()=>{
  assert.equal(core.hourlyCapacity(60,3000),50);
  assert.equal(core.hourlyCapacity(18,3000),167);
  assert.equal(core.hourlyCapacity(0,3000),0);
  assert.equal(core.standardHours(334,18,3000),2);
});

test('產能貢獻只使用 Resolver 提供的目前工序秒數',()=>{
  const entry={status:'active',recordType:'standard',productId:'P',processId:'R',quantity:120,processSecSnapshot:60};
  const contribution=core.contributionForEntry(entry,{sec:50},3000);
  assert.equal(contribution.standardSeconds,50);
  assert.equal(contribution.hourlyCapacity,60);
  assert.equal(contribution.standardHours,2);
});

test('日績效統一使用標準有效工時加補充工時除以考勤工時',()=>{
  const result=core.day({
    normalHours:8,overtimeHours:0,
    contributions:[
      {standardHours:4,supplementHours:0,valid:true},
      {standardHours:0,supplementHours:2,valid:true}
    ]
  });
  assert.equal(result.attendanceHours,8);
  assert.equal(result.standardHours,4);
  assert.equal(result.effectiveHours,6);
  assert.equal(result.efficiencyPercentage,75);
  assert.equal(result.calculationStatus,'ready');
});

test('月績效由同一套日結果彙總，缺少目前正式工序時不產生假效率',()=>{
  const ready=core.day({normalHours:8,contributions:[{standardHours:8,valid:true}]});
  const invalid=core.day({normalHours:8,contributions:[{standardHours:0,valid:false}]});
  const result=core.month([ready,invalid]);
  assert.equal(result.attendanceHours,16);
  assert.equal(result.standardHours,8);
  assert.equal(result.invalidContributionCount,1);
  assert.equal(result.efficiencyPercentage,null);
  assert.equal(result.calculationStatus,'invalid-standard');
});
