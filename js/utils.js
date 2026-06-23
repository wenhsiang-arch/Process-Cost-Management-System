// ===== 共用常數 =====
const COL = {orders:'orders', processes:'orderProcesses', employees:'employees', reports:'reports', attendance:'attendance', orderAdjustments:'orderAdjustments', orderLocks:'orderLocks', secondSyncLogs:'secondSyncLogs'};
const DEPTS = {'備料':'Bị liệu','普工':'Phổ thông','電腦針車':'May điện tử','平車':'May bằng','品檢':'QC','包裝':'Đóng gói'};
const DESK_ROLES = ['admin','manager','clerk'];
const ROLE_LABEL = {admin:'Quản trị viên / 管理員',manager:'Trưởng bộ phận / 課長',clerk:'Nhân viên văn phòng / 文員',leader:'班長',user:'員工'};

// ===== DOM 工具 =====
function g(id){ return document.getElementById(id); }
function om(id){ g(id).classList.add('open'); }
function cm(id){ g(id).classList.remove('open'); }
function mG(id){ return document.getElementById(id); }
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
function reportProcessMatches(report,process){
  return !!report&&!!process
    && String(process.orderId)===String(report.orderId)
    && String(process.code)===String(report.code)
    && String(process.processNo)===String(report.processNo);
}
function reportProcessKey(report){
  return report.processId?`id|${report.processId}`:`legacy|${report.orderId}|${report.code}|${report.processNo}`;
}
async function resolveReportProcess(report){
  if(report.processId){
    const snap=await window._getDoc(window._doc(COL.processes,report.processId));
    if(!snap.exists()) throw new Error('報工對應工序不存在');
    if(!reportProcessMatches(report,snap.data())) throw new Error('報工 processId 與工序資料不符合');
    return {id:snap.id,ref:snap.ref,data:snap.data()};
  }
  const snap=await window._getDocs(window._query(
    window._collection(COL.processes),
    window._where('orderId','==',report.orderId),
    window._where('code','==',report.code),
    window._where('processNo','==',report.processNo)
  ));
  if(snap.docs.length!==1) throw new Error(`舊報工無法安全找到唯一工序，找到 ${snap.docs.length} 筆`);
  return {id:snap.docs[0].id,ref:snap.docs[0].ref,data:snap.docs[0].data()};
}
function canManageOrders(){
  const role=window.cu?.role;
  return role==='admin'||window.permissionSettings?.[role]?.orderImport===true;
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
  if(!seconds||!workSeconds||!efficiency||!hourCost) return {qty:0,vnd:0};
  const q=workSeconds/seconds;
  if(!Number.isFinite(q)||q<=0) return {qty:0,vnd:0};
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

// ===== Toast（手機版）=====
function mobToast(msg, dur=2500){
  const t=mG('mob-toast');
  t.textContent=msg; t.style.display='block';
  clearTimeout(window._mt); window._mt=setTimeout(()=>t.style.display='none',dur);
}
