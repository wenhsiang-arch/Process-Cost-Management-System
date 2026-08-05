import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

test('登入首頁只預載核心程式且不包含大型表格工具',()=>{
  const html=read('index.html');
  const coreScripts=[...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1].split('?')[0]);
  assert.deepEqual(coreScripts,[
    'js/safe-dom.js','js/utils.js','js/data-cache.js','js/features.js','js/auth.js','js/firebase.js'
  ]);
  assert.match(html,/id="pg-home"/);
  assert.doesNotMatch(html,/JSZip|jszip|xlsx\.bundle\.js/);
});

test('中央功能清單涵蓋全部頁面及目前全部角色',()=>{
  const source=read('js/features.js');
  const context={
    window:{},
    CONFIGURABLE_ROLES:['manager','clerk','productionDevelopment','productionControl','sales']
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  const feature=context.window.PCMSFeatures;
  const pages=feature.modules.flatMap(module=>module.pages.map(page=>page.page));
  assert.equal(new Set(pages).size,pages.length);
  assert.deepEqual(Array.from(pages).sort(),[
    'accounts','costlog','cutting','export','permissions','progress','settings','summary','sync'
  ]);
  assert.match(read('index.html'),/value="productionDevelopment">Phát triển \/ 開發/);
  assert.match(read('index.html'),/value="sales">Kinh doanh \/ 業務/);
  assert.match(read('js/utils.js'),/productionDevelopment:'Phát triển \/ 開發'/);
  assert.match(read('js/utils.js'),/sales:'Kinh doanh \/ 業務'/);
  assert.doesNotMatch(read('index.html'),/生產開發/);
  assert.doesNotMatch(read('js/utils.js'),/生產開發/);
  for(const role of context.CONFIGURABLE_ROLES){
    assert.equal(Object.values(feature.defaultPermissions[role]).every(value=>value===false),true);
  }
});

test('裁帶模板識別碼使用共用安全行內參數',()=>{
  const source=read('js/cutting.js');
  assert.match(source,/cuttingDownloadTemplate\(\$\{inlineArg\(t\.id\)\}, this\)/);
  assert.match(source,/cuttingDeleteTemplate\(\$\{inlineArg\(t\.id\)\}\)/);
  assert.doesNotMatch(source,/cuttingDownloadTemplate\('\$\{esc\(t\.id\)\}'/);
});

test('訂單開頁不再完整讀取全部訂單工序',()=>{
  const source=read('js/orders.js');
  const loadBody=source.match(/async function loadOrderData\(\)\{([\s\S]*?)\n\}/)?.[1]||'';
  assert.match(loadBody,/reloadOrders\(\)/);
  assert.doesNotMatch(loadBody,/reloadProcesses\(/);
  assert.doesNotMatch(source,/_getDocs\(window\._collection\(COL\.processes\)\)/);
  assert.match(source,/where\('orderId','==',target\)/);
});

test('款號寫入使用交易並建立增量變更',()=>{
  const source=read('js/firebase.js');
  assert.match(source,/runTransaction\(db,async transaction=>/);
  assert.match(source,/PRODUCT_CHANGES_COL/);
  assert.match(source,/changedCodes/);
  assert.match(source,/deletedCodes/);
});
