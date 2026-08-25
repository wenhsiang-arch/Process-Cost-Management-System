import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'js','summary.js'),'utf8');

test('款號總覽的總數不跟隨搜尋或客戶篩選變動',()=>{
  assert.match(source,/const allProducts=sortD\(\)/);
  assert.match(source,/const totalProcessCount=allProducts\.reduce\(/);
  assert.match(source,/let fd=allProducts\.map\(/);
  assert.match(source,/g\('m-total'\)\.textContent=allProducts\.length/);
  assert.match(source,/g\('m-rows'\)\.textContent=totalProcessCount/);
  assert.doesNotMatch(source,/g\('m-total'\)\.textContent=fd\.length/);
});
