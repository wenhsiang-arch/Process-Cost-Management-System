import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

function searchApi(){
  const window={};
  const context={window,console,String,Number,Array,Object,Set,Map,RegExp};
  vm.createContext(context);
  vm.runInContext(read('js/ui-search-dropdown.js'),context);
  return window.PCMSUISearchDropdown;
}

test('共用搜尋忽略越文聲調、大小寫與代碼符號',()=>{
  const api=searchApi();
  assert.equal(api.normalizeSearchText(' TRẦN THỊ CÚC '),'tran thi cuc');
  assert.equal(api.compactSearchText('BLU-11/20'),'blu1120');
  assert.equal(api.isExact('cuc','CÚC'),true);
});

test('代碼智慧搜尋支援連續數字及依序字元並維持符合度排序',()=>{
  const api=searchApi();
  const rows=[
    {code:'BLU-21-10'},
    {code:'BLU-11-20'},
    {code:'B20'}
  ];
  const match=query=>api.matchItems(rows,query,{
    fields:[{value:item=>item.code,mode:'code'}],limit:20
  }).items.map(item=>item.code);
  assert.deepEqual(Array.from(match('1120')),['BLU-11-20']);
  assert.deepEqual(Array.from(match('B20')),['B20','BLU-11-20','BLU-21-10']);
});

test('文字與數字欄位不使用過度模糊的代碼比對',()=>{
  const api=searchApi();
  const names=[{name:'TRẦN THỊ CÚC'},{name:'TRẦN THỊ BÍCH'}];
  const nameResult=api.matchItems(names,'cuc',{fields:[{value:item=>item.name,mode:'text'}]}).items;
  assert.deepEqual(Array.from(nameResult,item=>item.name),['TRẦN THỊ CÚC']);
  const processes=[{processNo:'1'},{processNo:'10'},{processNo:'21'}];
  const processResult=api.matchItems(processes,'1',{fields:[{value:item=>item.processNo,mode:'numeric'}]}).items;
  assert.deepEqual(Array.from(processResult,item=>item.processNo),['1','10']);
  assert.equal(api.matchItems(processes,'12',{fields:[{value:item=>item.processNo,mode:'numeric'}]}).items.length,0);
});

test('共用控制器只在選取、外部點擊或 Esc 關閉，不使用滑鼠離開',()=>{
  const source=read('js/ui-search-dropdown.js');
  assert.match(source,/listen\(input,'focus',handleFocus\)/);
  assert.match(source,/listen\(toggle,'click',handleToggle\)/);
  assert.match(source,/function handleToggle\(\)\{[\s\S]*?const wasOpen = list\.hidden === false;[\s\S]*?input\.focus\(\{preventScroll:true\}\);[\s\S]*?if\(wasOpen\)\{ close\(\); return; \}/);
  assert.match(source,/if\(!root\.contains\(event\.target\)\) close\(\)/);
  assert.match(source,/event\.key === 'Escape'/);
  assert.doesNotMatch(source,/mouseleave|mouseout/);
  assert.match(source,/if\(text\(input\.value\)\) render\(\)/);
  assert.match(source,/render\(\{showAll:!text\(input\.value\)\}\)/);
});
