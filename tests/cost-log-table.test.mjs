import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）。
const source=fs.readFileSync(new URL('js/cost-log.js',root),'utf8'); // source（成本歷史畫面程式內容）。
const style=fs.readFileSync(new URL('styles/features/cost.css',root),'utf8'); // style（成本功能樣式內容）。
const htmlSource=fs.readFileSync(new URL('index.html',root),'utf8'); // htmlSource（主畫面內容）。

function classList(){
  const values=new Set(); // values（測試元件的樣式名稱）。
  return {
    add:value=>values.add(value),
    remove:value=>values.delete(value),
    contains:value=>values.has(value)
  };
}

function createCostLog(){
  const elements={
    'clog-list':{innerHTML:''},
    'costlog-refresh':{disabled:false,classList:classList()}
  }; // elements（成本歷史測試畫面元件）。
  const context={
    console,
    g:id=>elements[id]||null,
    canOpenPage:()=>true,
    PCMSUIComponents:{alertDialog:async()=>true},
    PCMSSafe:{
      text:value=>String(value??'')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
    }
  };
  context.window=context;
  context.cLog=[];
  vm.createContext(context);
  vm.runInContext(source,context);
  return {context,elements};
}

function completeChanges(){
  return [
    {field:'平均薪資',before:300,after:360,percent:'20.0'},
    {field:'平均保險',before:30,after:30,percent:null},
    {field:'餐費',before:20,after:20,percent:null},
    {field:'每月總成本',before:350,after:410,percent:'17.1'},
    {field:'平均時薪',before:2,after:2,percent:null},
    {field:'匯率USD',before:25000,after:25000,percent:null},
    {field:'匯率TWD',before:780,after:780,percent:null},
    {field:'工作秒數/小時',before:3000,after:3000,percent:null},
    {field:'生產效率(%)',before:80,after:80,percent:null}
  ];
}

test('成本歷史表格顯示全部設定且變動項目只呈現更新後數值與百分比',()=>{
  const {context,elements}=createCostLog();
  context.cLog=[{
    createdAt:new Date('2026-08-09T07:42:18Z').getTime(),
    createdBy:'wenhsiang',
    changes:completeChanges()
  }];

  context.rClog();
  const html=elements['clog-list'].innerHTML; // html（成本歷史表格畫面內容）。
  assert.match(html,/cost-log-table/);
  assert.match(html,/平均薪資/);
  assert.match(html,/每月總成本/);
  assert.match(html,/每小時工作秒數/);
  assert.match(html,/生產效率/);
  assert.match(html,/>360</);
  assert.match(html,/\+20\.0%/);
  assert.doesNotMatch(html,/300\s*(?:→|&rarr;|ti-arrow-right)\s*360/);
  assert.doesNotMatch(html,/is-extra-expanded/);
});

test('工作秒數與生產效率預設隱藏並由表頭箭頭向右展開',()=>{
  const {context,elements}=createCostLog();
  context.cLog=[{createdAt:1,createdBy:'TEST',changes:completeChanges()}];
  context.rClog();
  assert.match(elements['clog-list'].innerHTML,/ti-chevron-right/);
  assert.match(style,/\.cost-log-extra\s*\{[\s\S]*?display:\s*none;/);
  assert.match(style,/\.is-extra-expanded \.cost-log-extra\s*\{[\s\S]*?display:\s*table-cell;/);
  assert.match(style,/\.cost-log-time-cell\s*\{[\s\S]*?position:\s*sticky;/);
  assert.match(style,/\.cost-log-user-cell\s*\{[\s\S]*?position:\s*sticky;/);
  assert.match(style,/\.cost-log-table\s*\{[\s\S]*?min-width:\s*990px;/);
  assert.match(style,/@media \(max-width:\s*1365px\)[\s\S]*?\.cost-log-table\s*\{[\s\S]*?min-width:\s*950px;/);
  assert.match(style,/\.is-extra-expanded \.cost-log-table\s*\{[\s\S]*?min-width:\s*1230px;/);
  assert.match(htmlSource,/成本變動紀錄（最近 50 筆）/);
  assert.match(htmlSource,/id="costlog-refresh"[\s\S]*?Làm mới[\s\S]*?重新整理/);

  context.toggleCostLogExtraColumns();
  assert.match(elements['clog-list'].innerHTML,/is-extra-expanded/);
  assert.match(elements['clog-list'].innerHTML,/ti-chevron-left/);
});

test('舊紀錄沒有保存的成本設定以橫線呈現而不冒用目前設定',()=>{
  const {context,elements}=createCostLog();
  context.cLog=[{
    createdAt:1,
    createdBy:'TEST',
    changes:[{field:'平均薪資',before:300,after:360,percent:'20.0'}]
  }];

  context.rClog();
  const html=elements['clog-list'].innerHTML; // html（舊格式紀錄的相容畫面）。
  assert.match(html,/舊紀錄未保存此數值/);
  assert.match(html,/is-missing/);
  assert.doesNotMatch(html,/>25,000</);
});

test('重新整理只強制重讀成本歷史並保留頁面功能',async()=>{
  const {context,elements}=createCostLog();
  let options=null; // options（重新整理載入選項）。
  context.ensureCostLogLoaded=async value=>{
    options=value;
    context.cLog=[];
  };

  await context.refreshCostLog();
  assert.equal(options.force,true);
  assert.equal(elements['costlog-refresh'].disabled,false);
  assert.equal(elements['costlog-refresh'].classList.contains('is-loading'),false);
});
