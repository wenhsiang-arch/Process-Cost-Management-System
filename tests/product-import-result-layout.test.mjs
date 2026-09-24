import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

test('款號匯入結果使用分區統計與待確認提示，不再串成長句',()=>{
  const source=read('js/data.js');
  const styles=read('styles/features/products.css');
  assert.match(source,/function createProductImportResultBody\(summary=\{\}\)/);
  assert.match(source,/Tóm tắt/);
  assert.match(source,/處理摘要/);
  assert.match(source,/Mã hàng đã ghi đè/);
  assert.match(source,/已覆蓋款號/);
  assert.match(source,/Cần kiểm tra/);
  assert.match(source,/需要確認/);
  assert.match(source,/Nhật ký thay đổi mã hàng → Ảnh hưởng sản xuất/);
  assert.match(source,/款號修改流水帳 → 產能影響/);
  assert.match(source,/performanceDifferenceCount\)\{[\s\S]*?product-import-result-notice/);
  assert.match(source,/alertDialog\(\{body:resultBody,kind:'success',size:'large'\}\)/);
  assert.doesNotMatch(source,/let msgVi=`Đã xử lý/);
  assert.match(styles,/\.product-import-result-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles,/\.product-import-result-notice\{[\s\S]*?ui-color-warning-background/);
});
