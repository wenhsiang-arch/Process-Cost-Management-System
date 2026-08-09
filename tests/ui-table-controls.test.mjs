import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/ui-table-controls.js',import.meta.url),'utf8'); // source（共用表格操作程式內容）

function loadApi(){
  const context={window:{},console};
  vm.createContext(context);
  vm.runInContext(source,context);
  return context.window.PCMSUITableControls;
}

test('共用排序依預設、遞增、遞減、預設循環',()=>{
  const api=loadApi();
  const ascending=api.nextSortState({key:'',direction:'none'},'code');
  const descending=api.nextSortState(ascending,'code');
  const cleared=api.nextSortState(descending,'code');
  const switched=api.nextSortState(descending,'client');
  assert.deepEqual({...ascending},{key:'code',direction:'ascending'});
  assert.deepEqual({...descending},{key:'code',direction:'descending'});
  assert.deepEqual({...cleared},{key:'',direction:'none'});
  assert.deepEqual({...switched},{key:'client',direction:'ascending'});
});

test('共用欄位清單只保留功能已判定可用的欄位',()=>{
  const api=loadApi();
  const columns=api.availableColumns([
    {key:'code',label:{vi:'Mã hàng',zh:'款號'}},
    {key:'cost',label:{vi:'Tổng chi phí',zh:'總工價'},available:()=>false},
    {key:'action',label:{vi:'Thao tác',zh:'操作'},available:()=>{ throw new Error('denied'); }}
  ]);
  assert.deepEqual(columns.map(column=>column.key),['code']);
});

test('共用控制只管理介面狀態且保留功能回呼',()=>{
  assert.match(source,/currentAvailableColumns\(\)[\s\S]*?columnIsAvailable/);
  assert.match(source,/function syncMenuToggles\(\)[\s\S]*?input\.checked = visibility\[input\.dataset\.uiTableColumnToggle\] !== false/);
  assert.match(source,/selectAll\.indeterminate = selected > 0 && selected < toggles\.length/);
  assert.match(source,/cell\.classList\.toggle\('is-column-hidden',!visible\)/);
  assert.match(source,/options\.onColumnsChanged\?\.\(/);
  assert.match(source,/options\.onSortChanged\?\.\(sortState\)/);
  assert.doesNotMatch(source,/userAccess|firebase|firestore|UID|canViewCosts|isAdmin/);
});
