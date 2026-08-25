import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import vm from 'node:vm';

const testDirectory=dirname(fileURLToPath(import.meta.url));
const root=dirname(testDirectory);
const read=path=>readFileSync(join(root,path),'utf8');

test('主頁提供最上方更新入口並記錄本次使用者功能',()=>{
  const html=read('index.html');
  assert.ok(html.indexOf('id="nv-home-updates"')<html.indexOf('Đơn hàng / 訂單管理'));
  assert.match(html,/datetime="2026-08-25"[\s\S]*?款號顯示與生產紀錄作廢功能更新/);
  assert.match(html,/datetime="2026-08-21"/);
  assert.match(html,/openHomeUpdates/);
  assert.match(html,/Trường mã hàng đã trở lại chỉ hiển thị mã hàng/);
  assert.match(html,/Chức năng hủy bản ghi sản xuất đã hoạt động bình thường/);
  assert.match(html,/款號欄位已恢復只顯示款號/);
  assert.match(html,/生產紀錄作廢功能已恢復正常使用/);
  assert.match(html,/有效工時/);
  assert.match(html,/production-entry-record-search/);
  assert.match(html,/production-records-pagination/);
});

test('側邊欄常駐顯示目前版本狀態並在一般更新時提供雙語提醒',()=>{
  const html=read('index.html');
  const source=read('js/firebase.js');
  const notice=html.indexOf('id="runtime-update-notice"');
  assert.ok(notice>=0);
  assert.match(html,/id="runtime-update-notice" disabled[\s\S]*?id="runtime-update-icon" class="ti ti-loader-2"/);
  assert.match(html,/Đang kiểm tra cập nhật[\s\S]*?正在確認更新/);
  assert.match(source,/Có phiên bản mới[\s\S]*?有新版本/);
  assert.match(source,/current:\{vi:'Đã là phiên bản mới nhất',zh:'已是最新版本',icon:'ti-circle-check'\}/);
  assert.match(source,/available:\{vi:'Có phiên bản mới',zh:'有新版本',icon:'ti-refresh'\}/);
  assert.match(source,/void verifyRuntimeVersion\(\{silent:true\}\)\.catch\(\(\)=>undefined\)/);
  assert.doesNotMatch(html,/Tự động đăng xuất:|自動登出：|data-idle-countdown|idleprog/);
  assert.doesNotMatch(html,/<div class="sb-ft-t">M9<\/div>/);
  assert.doesNotMatch(html,/sidebar-session-meta/);
  assert.doesNotMatch(html,/sidebar-idle-info/);
  assert.match(source,/cancelText:\{vi:'Để sau',zh:'稍後'\}/);
  assert.match(source,/confirmText:\{vi:'Cập nhật ngay',zh:'立即更新'\}/);
  assert.match(source,/if\(confirmed\) window\.location\.reload\(\)/);
  assert.doesNotMatch(source,/requestRuntimeUpdate[\s\S]*?doLogout\(/);
});

test('產能紀錄的有效工時位於生產數量右側並共用每日績效計算來源',()=>{
  const html=read('index.html');
  const quantity=html.indexOf('data-production-column="quantity"');
  const effective=html.indexOf('data-production-column="effectiveHours"');
  const supplement=html.indexOf('data-production-column="supplementHours"');
  assert.ok(quantity>=0&&effective>quantity&&supplement>effective);
  const source=read('js/production/production-entry.js');
  assert.match(source,/PCMSProductionAttendance\.calculateEfficiency\(\[\{\.\.\.item,status:'active'\}\],null\)/);
  assert.match(source,/effectiveHours:effectiveHours\(item\)/);
  assert.match(source,/recordSearchText/);
  assert.match(source,/dateBadge\.vi,dateBadge\.zh/);
  assert.match(source,/employee\?\.department,item\.department/);
  assert.match(source,/hủy bỏ 作廢/);
});

test('每日績效全部員工按週、精確單一員工按月且翻頁只重新顯示目前結果',()=>{
  const source=read('js/production/production-records.js');
  assert.match(source,/const WEEK_PAGE_DAYS = 7/);
  assert.match(source,/shiftDate\(-6\)/);
  assert.match(source,/function performancePeriods\(from,to,singleEmployee=false\)/);
  assert.match(source,/const singleEmployee=Boolean\(current\.employeeId\)/);
  assert.match(source,/singleEmployee\?'Tháng':'Tuần'/);
  const shiftFunction=source.match(/function shiftWeekPage\(offset\)\{([\s\S]*?)\n  \}/)?.[1]||'';
  assert.match(shiftFunction,/render\(\)/);
  assert.doesNotMatch(shiftFunction,/load\(/);
});

test('月績效獎金依金額由高至低穩定排序',()=>{
  const source=read('js/performance-bonus/monthly-bonus-page.js');
  assert.match(source,/Number\(right\.finalBonus\).*Number\(left\.finalBonus\)/);
  assert.match(source,/state\.employees=sortedBonusEmployees\(result\.employees\)/);
});

test('所有共用表格設定依可信任 UID 保存於 IndexedDB',()=>{
  const source=read('js/ui-table-controls.js');
  assert.match(source,/TABLE_PREFERENCE_SCOPE = 'uiTablePreferences'/);
  assert.match(source,/window\.pcmsDataCache\.write\(TABLE_PREFERENCE_SCOPE/);
  assert.match(source,/visibility:Object\.fromEntries/);
  assert.match(source,/widths:Object\.fromEntries/);
  assert.match(source,/tableControls\.forEach\(control=>control\.restorePreference/);
  assert.doesNotMatch(source,/WIDTH_STORAGE_PREFIX/);
  const features=read('js/features.js');
  assert.match(features,/preparePagePreferences\?\.\(pageName\);\s*await runPageHooks\(pageName,'onOpen'\)/);
});

test('全域 Enter 僅處理單行輸入並排除危險按鈕',()=>{
  const source=read('js/ui-runtime.js');
  assert.match(source,/input instanceof HTMLInputElement/);
  assert.match(source,/event\.key !== 'Enter'/);
  assert.match(source,/is-danger/);
  assert.match(source,/danger\|delete\|remove\|destroy\|void\|revoke\|rollback\|reset\|unlock\|cancel\|bd2/);
  assert.match(source,/\(toggle\|dropdown\|picker\|clear\|previous\|next\)/);
  assert.match(source,/input\.form \|\| input\.closest\?\.\('form'\)/);
  assert.doesNotMatch(source,/HTMLTextAreaElement/);
});

test('搜尋輸入按 Enter 會略過下拉開關並執行正式搜尋按鈕',()=>{
  const listeners=new Map();
  let toggleClicks=0;
  let dangerClicks=0;
  let searchClicks=0;
  class HTMLInputElement{}
  const toggle={id:'employee-search-toggle',className:'ui-search-dropdown-toggle',dataset:{},classList:{contains:()=>false},click(){ toggleClicks+=1; }};
  const danger={id:'load-delete-button',className:'ui-button is-danger',dataset:{},classList:{contains:value=>value==='is-danger'},click(){ dangerClicks+=1; }};
  const search={id:'production-record-search-button',className:'ui-button is-primary',dataset:{},classList:{contains:()=>false},click(){ searchClicks+=1; }};
  const host={querySelectorAll:()=>[toggle,danger,search]};
  const input=new HTMLInputElement();
  Object.assign(input,{type:'search',dataset:{},disabled:false,readOnly:false,form:null,blur(){ this.blurred=true; },closest(selector){
    if(selector==='form'||selector.includes('data-ui-enter-action')) return null;
    return host;
  }});
  const document={
    readyState:'complete',documentElement:{dataset:{},setAttribute(){}},
    getElementById:()=>null,querySelector:()=>null,dispatchEvent:()=>true,
    addEventListener(type,listener){ listeners.set(type,listener); }
  };
  const window={};
  const context={window,document,HTMLInputElement,console,globalThis:null,localStorage:{getItem:()=>null,setItem(){}},
    getComputedStyle:()=>({getPropertyValue:()=>''})};
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(read('js/ui-runtime.js'),context);
  let prevented=false;
  listeners.get('keydown')({key:'Enter',target:input,defaultPrevented:false,isComposing:false,repeat:false,
    altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,preventDefault(){ prevented=true; }});
  assert.equal(prevented,true);
  assert.equal(toggleClicks,0);
  assert.equal(dangerClicks,0);
  assert.equal(searchClicks,1);
});
