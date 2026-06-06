// ===== 全域狀態 =====
window.accs = [{user:'admin',pass:'admin123',role:'admin'}];
window.cu   = null;
window.cur  = 'VND';
window.S    = {sal:9413769,ins:1686575,meal:1008000,usd:25400,twd:780,ws:3000,eff:80,mc:null,mh:null};
window.D    = [];
window.impHist = [];
window.cLog    = [];
window.sPage   = 1;
window.dPage   = 1;
window._syncVars = function(){};

// 從 localStorage 載入記錄
try{ const h=localStorage.getItem('impHist'); if(h) window.impHist=JSON.parse(h); }catch(e){}
try{ const c=localStorage.getItem('cLog');    if(c) window.cLog=JSON.parse(c);    }catch(e){}

const IDLE = 30*60;
let idleT = IDLE, idleIv = null;

// ===== 權限判斷 =====
function isAdm(){ return window.cu && window.cu.role==='admin'; }

// ===== 導覽權限 =====
function uNav(){
  const r  = window.cu ? window.cu.role : '';
  const isA   = r==='admin';
  const isMgr = r==='manager';
  const isClk = r==='clerk';
  const perm  = window.permissionSettings || {};

  // 成本設定：只有 admin
  g('nv-settings').className = 'ni'+(isA?'':' locked');

  // 權限管理：只有 admin
  const nvPerm = g('nv-permissions');
  if(nvPerm) nvPerm.className = 'ni'+(isA?'':' locked');

  // 所有可控制功能
  const allFeatures = ['attendance','stats','employees','orders','progress','approval','replog','accounts','export','history','costlog','summary','detail','import','backup'];

  allFeatures.forEach(n=>{
    const el=g('nv-'+n); if(!el) return;
    let show = false;
    if(isA){
      show = true;
    } else if(isMgr){
      show = perm.manager ? (perm.manager[n]===true) : false;
    } else if(isClk){
      show = perm.clerk ? (perm.clerk[n]===true) : false;
    }
    el.className = 'ni'+(show?'':' locked');
  });

  g('upill').className  = 'up'+(isA?' adm':isMgr?' mgr':'');
  g('ulabel').textContent = window.cu.user+' · '+(ROLE_LABEL[r]||r);
}

// ===== Idle 計時 =====
function startIdle(){
  idleT=IDLE; if(idleIv) clearInterval(idleIv);
  idleIv=setInterval(()=>{
    idleT--;
    const p=Math.max(0,(idleT/IDLE)*100);
    g('idleprog').style.width=p+'%';
    const m=Math.floor(idleT/60), s=idleT%60;
    g('idle-info').textContent='Tự động đăng xuất: '+m+':'+(s<10?'0':'')+s;
    if(idleT<=0){ clearInterval(idleIv); doLogout(); }
  },1000);
  ['click','keydown','mousemove'].forEach(e=>document.addEventListener(e,resetIdle,{passive:true}));
}
function resetIdle(){ idleT=IDLE; }

// ===== 登入 =====
function doLogin(){
  const u=g('lu').value.trim(), p=g('lp').value;
  if(!u||!p){ g('lerr').style.display='flex'; return; }

  // 桌機帳號
  const a = window.accs.find(x=>x.user===u && x.pass===p);
  if(a){
    window.cu = a;
    if(DESK_ROLES.includes(a.role)){
      g('ls').style.display='none'; g('ma').classList.remove('hidden');
      uNav(); rAll(); rSum(); rAcc(); startIdle();
      loadPermissions().then(()=>{
        uNav();
        const perm = window.permissionSettings;
        const r = window.cu.role;
        if(r==='admin'){ sp('summary'); return; }
        const order = ['attendance','stats','employees','orders','progress','approval','replog','accounts','export','history','costlog','summary','detail','import','backup'];
        const allowed = order.find(n=> perm[r] && perm[r][n]===true );
        if(allowed){ sp(allowed); } else {
          document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
          document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
          const mn = document.querySelector('.mn .ct');
          if(mn) mn.innerHTML='<div style="text-align:center;padding:60px;color:var(--mu)"><i class="ti ti-lock" style="font-size:48px;display:block;margin-bottom:16px"></i><div style="font-size:15px;font-weight:500">無可用功能 / Không có chức năng khả dụng</div><div style="font-size:12px;margin-top:8px">請聯絡管理員開放權限</div></div>';
        }
      });
      setTimeout(()=>fetchRates(), 1000);
      loadOrderData();
      if(typeof startDeskApvListener==='function') startDeskApvListener();
      if(typeof loadPermissions==='function') loadPermissions().then(()=>{ if(typeof uNav==='function') uNav(); });
    } else if(a.role==='leader'){
      g('ls').style.display='none';
      g('ma').classList.remove('hidden');
      startMobile(a);
    } else {
      g('lerr').style.display='flex';
    }
    return;
  }

  // 員工帳號（手機版）
  const emp = window.allEmployees.find(x=>x.user===u && x.pass===p);
  if(emp){ window.cu=emp; g('ls').style.display='none'; g('ma').classList.remove('hidden'); startMobile(emp); return; }

  g('lerr').style.display='flex';
}

// ===== 登出 =====
function doLogout(){
  clearInterval(idleIv);
  ['click','keydown','mousemove'].forEach(e=>document.removeEventListener(e,resetIdle));
  window.cu=null;
  const appEl = document.querySelector('#ma .app');
  if(appEl) appEl.style.display = '';
  g('ls').style.display=''; g('ma').classList.add('hidden');
  g('mob').style.display='none';
  if(window.mobPendingUnsub){ window.mobPendingUnsub(); window.mobPendingUnsub=null; }
  if(window.deskApvUnsub){ window.deskApvUnsub(); window.deskApvUnsub=null; }
  g('lu').value=''; g('lp').value=''; g('lerr').style.display='none';
}

// ===== 密碼顯示切換 =====
function tpw(id,icon){
  const el=g(id); const show=el.type==='password';
  el.type=show?'text':'password';
  icon.className=show?'ti ti-eye-off pwe':'ti ti-eye pwe';
}

// ===== 幣別切換 =====
function setCur(c){
  window.cur=c;
  ['VND','USD','TWD'].forEach(x=>g('cur-'+x).className='cb'+(x===c?' active':''));
  rSum(); rDet(); rExp();
}

// ===== 頁面切換 =====
function sp(name){
  const adm=['settings','export','history','costlog','accounts'];
  if(adm.includes(name)&&!isAdm()) return;
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
  const pg=g('pg-'+name); if(pg) pg.classList.add('active');
  const nav=g('nv-'+name); if(nav) nav.classList.add('active');
  if(name==='settings')  rAll();
  if(name==='export')    rExp();
  if(name==='accounts')  rAcc();
  if(name==='history')   rHist();
  if(name==='costlog')   rClog();
  if(name==='backup')    rBk();
  if(name==='orders')    renderOrders();
  if(name==='approval')  renderApproval();
  if(name==='progress')  renderProgress();
  if(name==='stats')     renderStats();
  if(name==='employees') renderEmployees();
  if(name==='attendance') renderAttendance();
  if(name==='replog') renderReplog();
}
