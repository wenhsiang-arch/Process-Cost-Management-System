import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/safe-dom.js',import.meta.url),'utf8'); // source（安全顯示程式內容）
const context={window:{}}; // context（測試用瀏覽器環境）
vm.createContext(context);
vm.runInContext(source,context);
const safe=context.window.PCMSSafe; // safe（安全顯示工具）

test('text（文字處理）會阻止網頁標籤與事件屬性執行',()=>{
  const result=safe.text('<img src=x onerror="alert(1)">');
  assert.equal(result,'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(result.includes('<img'),false);
});

test('highlight（搜尋高亮）只加入系統自己的高亮標籤',()=>{
  const result=safe.highlight('<script>alert(1)</script>','alert');
  assert.equal(result,'&lt;script&gt;<span class="hl">alert</span>(1)&lt;/script&gt;');
});

test('inlineArgument（行內事件參數）會保護引號與網頁屬性',()=>{
  const result=safe.inlineArgument('\");alert(1);//');
  assert.equal(result.includes('"'),false);
  assert.equal(result.includes('&quot;'),true);
});

test('errorMessage（錯誤訊息）會限制長度並安全顯示',()=>{
  const result=safe.errorMessage(new Error('<b>abcdef</b>'),5);
  assert.equal(result,'&lt;b&gt;ab');
});
