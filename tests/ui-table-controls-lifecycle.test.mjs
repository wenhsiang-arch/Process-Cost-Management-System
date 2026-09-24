import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

test('動態表格重建會銷毀舊欄位控制並清除同表格殘留圖示',()=>{
  const source=read('js/ui-table-controls.js');
  const features=read('js/features.js');
  assert.match(source,/function destroyAutoRuntime\(table\)\{[\s\S]*?runtime\.control\?\.destroy\?\.\(\);[\s\S]*?runtime\.settings\?\.remove\?\.\(\);[\s\S]*?runtime\.empty\?\.remove\?\.\(\);[\s\S]*?autoRuntimes\.delete\(table\);/);
  assert.match(source,/activeAutoTables\.forEach\(table=>\{[\s\S]*?if\(latest\.has\(table\)\) return;[\s\S]*?destroyAutoRuntime\(table\);/);
  assert.match(source,/target\.querySelectorAll\?\.\('\[data-ui-table-auto-settings\]'\)[\s\S]*?existing\.dataset\?\.uiTableAutoSettings === id[\s\S]*?existing\.remove\?\.\(\)/);
  assert.match(source,/if\(current\)\{\s*destroyAutoRuntime\(table\);/);
  assert.match(features,/uiTableControls:'js\/ui-table-controls\.js\?v=20260923-4'\+'&rev=table-lifecycle1'/);
});

test('共用修正涵蓋目前所有自動欄位控制表格',()=>{
  const sources=['index.html',...fs.readdirSync(new URL('../js/',import.meta.url),{recursive:true})
    .filter(path=>String(path).endsWith('.js')).map(path=>`js/${String(path).replaceAll('\\','/')}`)];
  const count=sources.reduce((total,path)=>total+(read(path).match(/data-ui-table-controls="auto"/g)||[]).length,0);
  assert.ok(count>=18,`預期至少涵蓋 18 個共用表格，實際 ${count} 個`);
});
