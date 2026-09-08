import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

test('中央清晰閱讀標準固定字級、字重與可讀對比色',()=>{
  const core=read('styles/ui-core.css');
  const theme=read('styles/themes/default.css');
  const specification=read('UI設計規範與參照/介面設計規範.md');
  for(const [token,value] of [
    ['section-vi','15px'],['section-zh','13px'],['control-vi','14px'],['control-zh','12px'],
    ['label-vi','14px'],['label-zh','12px'],['table-header-vi','13px'],['table-header-zh','12px'],
    ['body','14px'],['helper','12px']
  ]){
    assert.match(core,new RegExp(`--ui-font-size-${token}:\\s*${value}`));
  }
  assert.match(core,/--ui-font-weight-primary:\s*600/);
  assert.match(core,/--ui-font-weight-secondary:\s*400/);
  assert.match(core,/\.ui-legibility-standard\s*\{/);
  assert.match(theme,/--ui-color-text-readable-muted:\s*#475569/);
  assert.match(theme,/--ui-color-text-readable-subtle:\s*#64748b/);
  assert.match(specification,/不使用 500、650 等可能由瀏覽器合成而發虛的非標準字重/);
  assert.match(specification,/不使用 `transform（變形）`、`zoom（縮放）`或其他整頁等比例縮小方式/);
});

test('產能五頁與裁片全部分頁使用同一清晰閱讀入口',()=>{
  const html=read('index.html');
  for(const page of ['production-entry','production-records','production-bonus','production-attendance','production-employees','piece-cutting']){
    assert.match(html,new RegExp(`<div class="[^"]*\\bui-legibility-standard\\b[^"]*" id="pg-${page}"`),`${page} 未套用清晰閱讀標準`);
  }
  assert.match(html,/styles\/ui-core\.css\?v=20260908-1/);
  assert.match(html,/styles\/themes\/default\.css\?v=20260908-1/);
  assert.match(html,/js\/features\.js\?v=20260908-2&amp;pc=20260908-2/);
});

test('產能與裁片在高縮放時換排而不縮小整頁',()=>{
  const production=read('styles/features/production.css');
  const bonus=read('styles/features/performance-bonus.css');
  const piece=read('styles/features/piece-cutting.css');
  const processEdit=read('styles/features/production-process-edit.css');
  assert.match(production,/production-legibility-standard/);
  assert.match(production,/@media \(max-width: 1100px\)[\s\S]*?production-entry-fields[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(production,/#pg-production-records\.ui-legibility-standard \.production-filter-grid[\s\S]*?520px/);
  assert.match(bonus,/#pg-production-bonus\.ui-legibility-standard \.performance-bonus-settings-grid/);
  assert.match(processEdit,/\.ui-dialog:has\(\.product-groups-wizard,\.product-quick-edit/);
  assert.match(piece,/piece-cutting-legibility-standard/);
  assert.match(piece,/#pg-piece-cutting\.ui-legibility-standard \.pc-tool-status\{max-height:none/);
  assert.match(piece,/@media \(max-width:1100px\)[\s\S]*?\.pc-command-row\{grid-template-columns:minmax\(0,1fr\)\}/);
  for(const source of [
    production.slice(production.indexOf('production-legibility-standard')),
    bonus.slice(bonus.indexOf('產能月績效頁')),
    piece.slice(piece.indexOf('piece-cutting-legibility-standard')),
    processEdit.slice(processEdit.indexOf('生產頁開啟的款號'))
  ]){
    assert.doesNotMatch(source,/font-weight:\s*(?:500|650)\b/);
    assert.doesNotMatch(source,/(?:transform:\s*scale|zoom\s*:)/);
  }
});

test('清晰度調整維持零額外雲端用量並同步功能文件',()=>{
  const productionDoc=read('產能登記.md');
  const pieceDoc=read('裁片出單.md');
  assert.match(productionDoc,/五個分頁清晰閱讀與桌機換排標準/);
  assert.match(productionDoc,/Reads（文件讀取）0、Writes（寫入）0、Deletes（刪除）0/);
  assert.match(pieceDoc,/全部分頁清晰閱讀與桌機換排標準/);
  assert.match(pieceDoc,/額外用量全部為 0/);
});
