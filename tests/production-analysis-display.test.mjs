import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

test('工序分析分頁使用新名稱且主表分開款號與工序',()=>{
  const shell=read('js/production-analysis/production-analysis.js');
  const process=read('js/production-analysis/ie-analysis.js');
  assert.match(shell,/dual\('Phân tích công đoạn','工序分析'\)/);
  assert.doesNotMatch(shell,/dual\('Phân tích IE','IE 分析'\)/);
  assert.match(process,/data-ui-table-column="product"[^\n]+dual\('Mã hàng','款號'\)/);
  assert.match(process,/data-ui-table-column="process"[^\n]+dual\('Công đoạn','工序'\)/);
  assert.match(process,/ui\.createCell\(row\.productCode\|\|'—'\)/);
  assert.match(process,/ui\.createCell\(\[row\.processNo,row\.processNameVi\]/);
  assert.match(process,/cell\.colSpan=13/);
});

test('員工分析使用合併搜尋且明細只顯示越文工序名稱',()=>{
  const employee=read('js/production-analysis/employee-analysis.js');
  assert.match(employee,/data-filter="search"/);
  assert.doesNotMatch(employee,/data-filter="employee"/);
  assert.doesNotMatch(employee,/data-filter="process"/);
  assert.match(employee,/const employeeMatches=!current\.search\|\|employeeText\.includes\(current\.search\)/);
  assert.match(employee,/ui\.createCell\(\[row\.productCode,row\.processNo,row\.processNameVi\]/);
  assert.doesNotMatch(employee,/ui\.createCell\(\[row\.productCode,row\.processNo,row\.processNameZh\|\|row\.processNameVi\]/);
});

test('員工分析五個篩選欄位固定為桌機單列',()=>{
  const style=read('styles/features/production-analysis.css');
  assert.match(style,/\.employee-analysis-filter-grid \{\s*grid-template-columns: minmax\(135px,\.85fr\) minmax\(135px,\.85fr\) minmax\(260px,1\.5fr\) minmax\(140px,\.9fr\) minmax\(140px,\.9fr\);\s*\}/);
  assert.doesNotMatch(style,/\.employee-analysis-filter-grid \{\s*grid-template-columns: repeat\(3/);
});
