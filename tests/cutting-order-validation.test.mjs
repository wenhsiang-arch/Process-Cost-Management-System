import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const cuttingSource=fs.readFileSync(new URL('js/cutting.js',root),'utf8'); // cuttingSource（裁帶功能程式內容）

// loadValidation（載入訂單檢查介面）：只執行函式登記，不啟動畫面或讀取正式資料。
function loadValidation(){
  const context={window:{},console}; // context（隔離測試環境）
  vm.createContext(context);
  vm.runInContext(cuttingSource,context);
  return context.window.PCMSCuttingOrderValidation;
}

test('PCS 表頭與完整正整數訂單可以通過',()=>{
  const validation=loadValidation(); // validation（訂單檢查介面）
  const result=validation.parseRows([
    ['MÃ HÀNG','PCS'],
    ['UI-1001',240],
    ['UI-1002','80']
  ],'Đơn hàng'); // result（訂單檢查結果）
  assert.equal(result.errors.length,0);
  assert.equal(result.codeCount,2);
  assert.deepEqual(Array.from(result.items,item=>({...item})),[
    {code:'UI-1001',qty:240},
    {code:'UI-1002',qty:80}
  ]);
});

test('公式總數量列會略過並核對明細加總',()=>{
  const validation=loadValidation(); // validation（訂單檢查介面）
  const result=validation.parseRows([
    ['ITEM NO','QTY'],
    ['UI-1101',240],
    ['UI-1102',80],
    ['',320]
  ],'Order',{
    formulaRows:[[],[],[],['','SUM(B2:B3)']]
  }); // result（含公式總數量列的檢查結果）
  assert.equal(result.errors.length,0);
  assert.equal(result.totalQuantity,320);
  assert.equal(result.codeCount,2);
  assert.deepEqual(Array.from(result.items,item=>({...item})),[
    {code:'UI-1101',qty:240},
    {code:'UI-1102',qty:80}
  ]);
});

test('款號空白且有總計文字的總數量列可以通過',()=>{
  const validation=loadValidation(); // validation（訂單檢查介面）
  const result=validation.parseRows([
    ['ITEM NO','DESCRIPTION','QTY'],
    ['UI-1201','Product A',100],
    ['UI-1202','Product B',200],
    ['','TOTAL',300]
  ],'Order'); // result（有總計文字的訂單檢查結果）
  assert.equal(result.errors.length,0);
  assert.equal(result.totalQuantity,300);
  assert.equal(result.codeCount,2);
});

test('總數量與款號明細加總不同時列為訂單錯誤',()=>{
  const validation=loadValidation(); // validation（訂單檢查介面）
  const result=validation.parseRows([
    ['ITEM NO','QTY'],
    ['UI-1301',100],
    ['UI-1302',200],
    ['',299]
  ],'Order',{
    formulaRows:[[],[],[],['','SUM(B2:B3)']]
  }); // result（總數量不一致的檢查結果）
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].reasonZh,/總數量為 299/);
  assert.match(result.errors[0].reasonZh,/款號明細加總為 300/);
});

test('總數量列後仍有訂單資料時列為錯誤',()=>{
  const validation=loadValidation(); // validation（訂單檢查介面）
  const result=validation.parseRows([
    ['ITEM NO','QTY'],
    ['UI-1401',100],
    ['',100],
    ['UI-1402',50]
  ],'Order',{
    formulaRows:[[],[],['','SUM(B2:B2)'],[]]
  }); // result（總數量後仍有明細的檢查結果）
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].reasonZh,/總數量列後面仍有訂單資料/);
});

test('PDF 預設檔名使用訂單號碼與日月年日期',()=>{
  const validation=loadValidation(); // validation（訂單檢查介面）
  const date=new Date(2026,7,10); // date（測試日期）：2026 年 8 月 10 日。
  assert.equal(validation.buildPdfName('2026-117767',date),'2026-117767_10_8_2026.pdf');
  assert.equal(validation.buildPdfName('PO#2026/117767',date),'2026_117767_10_8_2026.pdf');
  assert.equal(validation.buildPdfName('',date),'cutting_multi_PDF_10_8_2026.pdf');
  assert.match(cuttingSource,/state\.detectedOrderNumber = uniqueDetectedOrderNumber\(detectedOrderNumbers\)/);
  assert.match(cuttingSource,/localMergedPdfName\(state\.detectedOrderNumber\)/);
});

test('不完整款號與無效數量全部列為訂單錯誤',()=>{
  const validation=loadValidation(); // validation（訂單檢查介面）
  const result=validation.parseRows([
    ['ITEM NO','QTY'],
    ['',20],
    ['UI-2001',''],
    ['UI-2002',0],
    ['UI-2003',-2],
    ['UI-2004',10.5],
    ['UI-2005','240 PCS']
  ],'Order'); // result（訂單檢查結果）
  assert.equal(result.items.length,0);
  assert.equal(result.errors.length,6);
  assert.match(result.errors[0].reasonZh,/款號空白/);
  assert.match(result.errors[1].reasonZh,/訂單數量空白/);
  assert.match(result.errors[2].reasonZh,/訂單數量為 0/);
  assert.match(result.errors[3].reasonZh,/負數/);
  assert.match(result.errors[4].reasonZh,/小數/);
  assert.match(result.errors[5].reasonZh,/內容無效/);
});

test('同一款號重複時禁止自動合併數量',()=>{
  const validation=loadValidation(); // validation（訂單檢查介面）
  const result=validation.parseRows([
    ['STYLE','QUANTITY'],
    ['ui-3001',100],
    ['UI-3001',200],
    ['UI-3002',50]
  ],'Order'); // result（訂單檢查結果）
  assert.deepEqual(Array.from(result.items,item=>({...item})),[{code:'UI-3002',qty:50}]);
  assert.equal(result.errors.length,1);
  assert.equal(result.errors[0].code,'UI-3001');
  assert.match(result.errors[0].reasonZh,/第 2, 3 列/);
});

test('找不到明確表頭時不得依資料外觀猜測',()=>{
  const validation=loadValidation(); // validation（訂單檢查介面）
  const result=validation.parseRows([
    ['流水號','件數資料'],
    ['UI-4001',120],
    ['UI-4002',80]
  ],'Order'); // result（訂單檢查結果）
  assert.equal(result.items.length,0);
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].reasonZh,/找不到款號與訂單數量表頭/);
});

test('缺少模板維持獨立分類且不轉成訂單錯誤',()=>{
  assert.match(cuttingSource,/missing\.push\(\{code:item\.code,[\s\S]*?status:'missing'/);
  assert.match(cuttingSource,/state\.results = \[\.\.\.state\.orderErrors, \.\.\.passed, \.\.\.missing\]/);
  assert.doesNotMatch(cuttingSource,/missing\.push\([^\n]*status:'error'/);
  assert.equal((cuttingSource.match(/status:'error'/g)||[]).length,1);
});

test('即使款號總數為零也會優先顯示訂單錯誤提示',()=>{
  const errorBranch=cuttingSource.indexOf('if(errors.length){'); // errorBranch（訂單錯誤提示判斷位置）
  const emptyBranch=cuttingSource.indexOf('} else if(!total){',errorBranch); // emptyBranch（無款號提示判斷位置）
  assert.ok(errorBranch >= 0);
  assert.ok(emptyBranch > errorBranch);
});
