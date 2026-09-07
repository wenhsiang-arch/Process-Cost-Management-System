import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const index=read('index.html');
const cutting=read('js/cutting.js');
const piece=read('js/piece-cutting.js');
const pieceStyle=read('styles/features/piece-cutting.css');
const cuttingServer=read('local-cutting-server.ps1');
const pieceServer=read('local-piece-cutting-server.ps1');

test('裁帶只保留 A4 300 DPI 高品質',()=>{
  assert.doesNotMatch(index,/id="cut-pdf-quality"/);
  assert.doesNotMatch(cutting,/PDF_QUALITY_STORAGE_KEY|getSelectedPdfQuality|restorePdfQualitySelection/);
  assert.match(cutting,/payload\.pdfQuality = 'high'/);
  assert.match(cuttingServer,/mode = 'high'; width = 2480; height = 3508; jpegQuality = 100; isHighQuality = \$true/);
  assert.doesNotMatch(cuttingServer,/mode = 'standard'|width = 1240; height = 1754/);
});

test('裁片固定使用 A4 橫式 300 DPI 高品質',()=>{
  assert.match(pieceServer,/\[Drawing\.Bitmap\]::new\(3508,2480\)/);
  assert.match(pieceServer,/\.ScaleTransform\(\[single\]2\.0,\[single\]2\.0\)/);
  assert.match(pieceServer,/實際輸出解析度為 300 DPI/);
  assert.match(pieceServer,/\[Drawing\.Imaging\.Encoder\]::Quality,\[long\]100/);
});

test('裁片無資料時保留兩張共用表格與操作能力',()=>{
  assert.doesNotMatch(piece,/id="pc-order-files-wrap"[^>]*hidden/);
  assert.doesNotMatch(piece,/id="pc-order-items-wrap"[^>]*hidden/);
  assert.match(piece,/id="pc-order-files-table"[^>]+data-ui-table-controls="auto"[^>]+data-ui-table-resizable="true"/);
  assert.match(piece,/id="pc-order-items-table"[^>]+data-ui-table-controls="auto"[^>]+data-ui-table-resizable="true"/);
  assert.match(piece,/g\('pc-order-files-wrap'\)\.hidden=false/);
  assert.match(piece,/g\('pc-order-items-wrap'\)\.hidden=false/);
  assert.match(piece,/colspan="6" class="pc-empty"/);
  assert.match(piece,/colspan="7" class="pc-empty"/);
});

test('裁片錯誤直接顯示位置與具體問題',()=>{
  assert.match(piece,/function shortOrderErrorLocation\(/);
  assert.match(piece,/class="pc-error-message"/);
  assert.doesNotMatch(piece,/class="pc-error-details"/);
  assert.match(pieceStyle,/\.pc-error-message\{/);
  assert.doesNotMatch(pieceStyle,/\.pc-error-details\{/);
});
