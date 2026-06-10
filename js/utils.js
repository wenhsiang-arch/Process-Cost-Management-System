// ===== 共用常數 =====
const COL = {orders:'orders', processes:'orderProcesses', employees:'employees', reports:'reports', attendance:'attendance', orderAdjustments:'orderAdjustments', orderLocks:'orderLocks'};
const DEPTS = {'備料':'Bị liệu','普工':'Phổ thông','電腦針車':'May điện tử','平車':'May bằng','品檢':'QC','包裝':'Đóng gói'};
const DESK_ROLES = ['admin','manager','clerk'];
const ROLE_LABEL = {admin:'管理員',manager:'課長',clerk:'文員',leader:'班長',user:'員工'};

// ===== DOM 工具 =====
function g(id){ return document.getElementById(id); }
function om(id){ g(id).classList.add('open'); }
function cm(id){ g(id).classList.remove('open'); }
function mG(id){ return document.getElementById(id); }
function isOrderUsable(o){
  return !!o
    && (!o.importStatus||o.importStatus==='ready')
    && (!o.lifecycleStatus||o.lifecycleStatus==='active');
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
function fV(v){ return '₫'+Math.round(v).toLocaleString(); }
function fU(v){ return '$'+(Math.round(v/window.S.usd*100)/100).toFixed(2); }
function fT(v){ return 'NT$'+(Math.round(v/window.S.twd*10)/10).toFixed(1); }
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
  if(window.S.mh) return window.S.mh;
  return (window.S.mc||(window.S.sal+window.S.ins+window.S.meal))/208;
}
function calc(sec){
  if(!sec||isNaN(sec)||sec<=0) return {qty:0,vnd:0};
  const h=getH(), m=1/(window.S.eff/100), q=window.S.ws/sec;
  return {qty:Math.round(q), vnd:(h/q)*m};
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
