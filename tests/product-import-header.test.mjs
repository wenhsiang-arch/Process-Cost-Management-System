import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const source=fs.readFileSync(new URL('js/data.js',root),'utf8');

function parser(){
  const window={};
  const context=vm.createContext({window,console,setTimeout,clearTimeout});
  vm.runInContext(source,context,{filename:'js/data.js'});
  return window.PCMSProductImportParser;
}

const bilingualHeader=[
  '款號\nMÃ HÀNG','客人\nKHÁCH HÀNG','中文名稱\nTÊN TIẾNG TRUNG','越文名稱\nTÊN TIẾNG VIỆT','尺寸\nQUY CÁCH',
  '工序號\nSỐ CÔNG ĐOẠN','加工\nBỘ PHẬN','工序中文\nCÔNG ĐOẠN TIẾNG TRUNG','工序越文\nCÔNG ĐOẠN TIẾNG VIỆT',
  '秒數\nTHỜI GIAN\n','數量/1小時\nSỐ LƯỢNG/1 GIỜ'
];
const dataRow=['A-001','SYLS','產品','Sản phẩm','15MM',1,'SX','車縫','May',30,120];

test('辨識實際雙語換行表頭並忽略每小時數量',()=>{
  const result=parser().resolveRows([bilingualHeader,dataRow]);
  assert.equal(result.headerRow,1);
  assert.equal(result.ignoredHourlyCapacity,true);
  assert.deepEqual(Array.from(result.rows[0]),dataRow.slice(0,10));
  assert.equal(result.rows[0]._excelRow,2);
});

test('忽略表頭前說明列並依名稱重排欄位',()=>{
  const reordered=['備註','秒數','款號','加工分類','客人','工序號','越文名稱','尺寸','工序越文','中文名稱','工序中文'];
  const row=['忽略',45,'B-002','QC','KH',2,'Tên Việt','25MM','Kiểm tra','中文','品檢'];
  const result=parser().resolveRows([['款號工序資料'],['更新日期'],reordered,row]);
  assert.equal(result.headerRow,3);
  assert.deepEqual(Array.from(result.rows[0]),['B-002','KH','中文','Tên Việt','25MM',2,'QC','品檢','Kiểm tra',45]);
  assert.equal(result.rows[0]._excelRow,4);
});

test('缺少必要表頭時停止且指出缺少欄位',()=>{
  const incomplete=bilingualHeader.filter(value=>!String(value).includes('THỜI GIAN'));
  assert.throws(()=>parser().resolveRows([incomplete,dataRow]),/Thời gian|秒數/);
});

test('必要表頭重複時停止且指出重複欄位',()=>{
  const duplicate=[...bilingualHeader,'款號'];
  assert.throws(()=>parser().resolveRows([duplicate,[...dataRow,'A-001']]),/Trùng: Mã hàng|重複：款號/);
});
