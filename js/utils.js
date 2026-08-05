// ===== 共用常數 =====
const COL = {orders:'orders', processes:'orderProcesses', orderAdjustments:'orderAdjustments', orderLocks:'orderLocks', secondSyncLogs:'secondSyncLogs'};
// CONFIGURABLE_ROLES（可設定權限角色）、DESK_ROLES（桌機系統角色）。
const CONFIGURABLE_ROLES = ['manager','clerk','productionDevelopment','productionControl'];
const DESK_ROLES = ['admin',...CONFIGURABLE_ROLES];
// ROLE_LABEL（角色雙語名稱）、ROLE_ORDER（角色顯示順序）、ROLE_TAG_CLASS（角色標籤樣式）。
const ROLE_LABEL = {
  admin:'Quản trị viên / 管理員',
  manager:'Trưởng bộ phận / 課長',
  clerk:'Nhân viên văn phòng / 文員',
  productionDevelopment:'Phát triển sản xuất / 開發',
  productionControl:'Quản lý sản xuất / 生管'
};
const ROLE_ORDER = {admin:0,manager:1,clerk:2,productionDevelopment:3,productionControl:4};
const ROLE_TAG_CLASS = {admin:'tg2',manager:'tb2',clerk:'ta',productionDevelopment:'ta',productionControl:'tb2'};
window.CONFIGURABLE_ROLES=CONFIGURABLE_ROLES;
window.DESK_ROLES=DESK_ROLES;

// ===== DOM 工具 =====
function g(id){ return document.getElementById(id); }
function om(id){ g(id).classList.add('open'); }
function cm(id){ g(id).classList.remove('open'); }
function formatLocalDate(date=new Date()){
  const d=date instanceof Date?date:new Date(date);
  if(Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isOrderUsable(o){
  return !!o
    && (!o.importStatus||o.importStatus==='ready')
    && (!o.lifecycleStatus||o.lifecycleStatus==='active');
}
function isOrderMutationLocked(o){ return !!o&&(o.lifecycleStatus==='syncingSeconds'||o.lifecycleStatus==='deleting'); }
function canManageOrders(){
  const role=window.cu?.role;
  if(role==='admin') return true;
  const permissions=window.permissionSettings?.[role]; // permissions（目前角色權限）。
  return permissions?.progress===true&&permissions?.orderImport===true;
}
function orderLockId(orderNo){ return encodeURIComponent(String(orderNo||'').trim().toUpperCase()); }
function normalizeProcessNo(value){
  const raw=String(value??'').trim();
  return /^[1-9]\d?$/.test(raw)?String(Number(raw)):'';
}
function compareProcessNo(a,b){
  const av=Number(a), bv=Number(b);
  if(Number.isFinite(av)&&Number.isFinite(bv)&&av!==bv) return av-bv;
  return String(a??'').localeCompare(String(b??''),undefined,{numeric:true});
}

// ===== 日期格式 =====
function fmtVN(ts){
  if(!ts) return '-';
  const d = new Date(ts);
  return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
}
function fmtTimeVN(ts){
  if(!ts) return '';
  const d=new Date(ts), now=new Date(), diff=now-d;
  const hm = String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  if(diff<86400000) return 'Hôm nay '+hm;
  if(diff<172800000) return 'Hôm qua '+hm;
  return fmtVN(ts)+' '+hm;
}

// ===== 貨幣格式 =====
function safePositiveNumber(value,fallback=0){
  const n=Number(value);
  return Number.isFinite(n)&&n>0?n:fallback;
}
function safeMoneyNumber(value){
  const n=Number(value);
  return Number.isFinite(n)?n:0;
}
function fV(v){ return '₫'+Math.round(safeMoneyNumber(v)).toLocaleString(); }
function fU(v){
  const usd=safePositiveNumber(window.S?.usd,25400);
  return '$'+(Math.round(safeMoneyNumber(v)/usd*100)/100).toFixed(2);
}
function fT(v){
  const twd=safePositiveNumber(window.S?.twd,780);
  return 'NT$'+(Math.round(safeMoneyNumber(v)/twd*10)/10).toFixed(1);
}
function fm(v){
  if(window.cur==='VND') return fV(v);
  if(window.cur==='USD') return fU(v);
  return fT(v);
}

// ===== 搜尋高亮 =====
function hl(t,q){
  if(!q||!t) return String(t||'');
  return String(t).replace(new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'),'<span class="hl">$1</span>');
}

// ===== 成本計算 =====
function getH(){
  const manualHour=safePositiveNumber(window.S?.mh,0);
  if(manualHour) return manualHour;
  const manualMonth=safePositiveNumber(window.S?.mc,0);
  if(manualMonth) return manualMonth/208;
  const sal=safePositiveNumber(window.S?.sal,0);
  const ins=safePositiveNumber(window.S?.ins,0);
  const meal=safePositiveNumber(window.S?.meal,0);
  return (sal+ins+meal)/208;
}
function calc(sec){
  const seconds=safePositiveNumber(sec,0);
  const workSeconds=safePositiveNumber(window.S?.ws,3000);
  const efficiency=safePositiveNumber(window.S?.eff,80);
  const hourCost=safePositiveNumber(getH(),0);
  // qty（標準產量）不依賴工價權限；未載入成本時只讓 vnd（越盾工價）為 0。
  if(!seconds||!workSeconds) return {qty:0,vnd:0};
  const q=workSeconds/seconds;
  if(!Number.isFinite(q)||q<=0) return {qty:0,vnd:0};
  if(!efficiency||!hourCost) return {qty:Math.round(q),vnd:0};
  const vnd=(hourCost/q)*(100/efficiency);
  return {qty:Math.round(q), vnd:Number.isFinite(vnd)?vnd:0};
}

// ===== 分頁 =====
function mkPager(cid,page,total,pp,cb){
  const el=g(cid); if(!el) return;
  const pages=Math.ceil(total/pp); if(pages<=1){ el.innerHTML=''; return; }
  let h=`<span class="pgi">共 ${total} 筆 / Tổng ${total}</span>`;
  h+=`<button class="pgb" ${page<=1?'disabled':''} onclick="${cb}(${page-1})">‹</button>`;
  for(let i=1;i<=pages;i++){
    if(i===1||i===pages||Math.abs(i-page)<=1)
      h+=`<button class="pgb${i===page?' active':''}" onclick="${cb}(${i})">${i}</button>`;
    else if(Math.abs(i-page)===2)
      h+='<span style="color:var(--hi);padding:0 4px">…</span>';
  }
  h+=`<button class="pgb" ${page>=pages?'disabled':''} onclick="${cb}(${page+1})">›</button>`;
  el.innerHTML=h;
}
function goSP(p){ window.sPage=p; rSum(); }
function goDP(p){ window.dPage=p; rDet(); }

// ===== 客人選單 =====
function rcf(){
  const cl=[...new Set(window.D.map(d=>d.client))];
  ['s-client','d-client','ex-cl','bk-client'].forEach(id=>{
    const el=g(id); if(!el) return;
    const cv=el.value;
    el.innerHTML=id==='ex-cl'||id==='bk-client'?'<option value="">Tất cả / 全部</option>':'<option value="">Tất cả KH / 全部客人</option>';
    cl.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; el.appendChild(o); });
    if(cl.includes(cv)) el.value=cv;
  });
}
