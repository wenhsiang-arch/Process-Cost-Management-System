import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import vm from 'node:vm';

const testDirectory=dirname(fileURLToPath(import.meta.url));
const root=dirname(testDirectory);
const read=path=>readFileSync(join(root,path),'utf8');

test('主頁提供最上方更新入口並記錄月績效獎金調整方式',()=>{
  const html=read('index.html');
  assert.ok(html.indexOf('id="nv-home-updates"')<html.indexOf('Đơn hàng / 訂單管理'));
  assert.match(html,/datetime="2026-09-28"[\s\S]*?優化月績效獎金調整/);
  assert.match(html,/openHomeUpdates/);
  assert.match(html,/綠色金額框代表增加獎金/);
  assert.match(html,/紅色金額框代表減少獎金/);
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

test('月績效獎金標題同時顯示人數與當月最終獎金總和',()=>{
  const source=read('js/performance-bonus/monthly-bonus-page.js');
  const style=read('styles/features/performance-bonus.css');
  assert.match(source,/id="performance-bonus-count">0<\/span><span class="ui-text-vi">người<\/span>/);
  assert.doesNotMatch(source,/performance-bonus-count-zh/);
  assert.match(source,/Tổng thưởng/);
  assert.match(source,/獎金總和/);
  assert.match(source,/reduce\(\(total,employee\)=>total\+\(Number\(employee\.finalBonus\)\|\|0\),0\)/);
  assert.match(source,/performance-bonus-total/);
  assert.doesNotMatch(source,/performance-bonus-total-zh/);
  assert.match(source,/performance-bonus-count ui-bilingual/);
  assert.doesNotMatch(style,/\.performance-bonus-count\{[^}]*background:/);
  assert.doesNotMatch(style,/\.performance-bonus-count\{[^}]*border:/);
  assert.match(style,/\.performance-bonus-count\{[^}]*flex-direction:row;[^}]*flex-wrap:nowrap;/);
  assert.match(style,/\.performance-bonus-total\{[\s\S]*?min-width:150px[\s\S]*?padding:8px 12px[\s\S]*?background:var\(--ui-color-primary-soft\)[\s\S]*?font-size:var\(--ui-font-size-metric\)/);
  assert.match(style,/data-ui-language-mode[^\n]*performance-bonus-language-divider/);
});

test('月績效人工調整以獨立欄位顯示金額，原因與編輯使用小圖示',()=>{
  const page=read('js/performance-bonus/monthly-bonus-page.js');
  const store=read('js/performance-bonus/bonus-store.js');
  assert.match(page,/data-ui-table-column="bonus"[\s\S]*?data-ui-table-column="adjustment"/);
  assert.match(page,/createCell\(row,''[^\n]*'adjustment'\)/);
  assert.match(page,/performance-bonus-adjustment-badge/);
  assert.match(page,/is-increase':'is-decrease/);
  assert.match(page,/money\(Math\.abs\(adjustment\)\)/);
  assert.doesNotMatch(page,/ti-trending-up|ti-trending-down|performance-bonus-adjustment-note/);
  assert.match(page,/ti-message-circle/);
  assert.match(page,/ti-edit/);
  assert.match(page,/Xem lý do điều chỉnh[\s\S]*?查看調整原因/);
  assert.match(page,/Chỉnh sửa điều chỉnh thưởng[\s\S]*?編輯人工調整/);
  assert.match(page,/function viewAdjustmentReason\(employee\)/);
  assert.match(page,/Lý do điều chỉnh[\s\S]*?調整原因/);
  assert.match(page,/clearsAdjustment=allowZero\|\|\(rawText!==''&&raw===0\)/);
  assert.match(page,/clearsAdjustment\?\{amount:0,note:''\}:\{amount:sign\*raw,note:reason\}/);
  assert.match(page,/amount\.min='0'/);
  assert.match(page,/finalBonus\)>0\|\|Number\(item\.adjustmentAmount\)!==0/);
  assert.match(store,/const reason=adjustment===0\?'':String\(note\|\|''\)\.trim\(\)\.slice\(0,200\)/);
  assert.match(store,/if\(adjustment!==0&&!reason\)/);
  assert.match(store,/batch\.set\(adjustmentRef\(normalized,employeeId\),\{/);
  assert.doesNotMatch(store,/employee\.adjustmentAmount\)\|\|0\)\+adjustment/);
  assert.match(store,/adjustmentNote:reason/);
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
