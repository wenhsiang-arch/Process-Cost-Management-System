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
// 從 localStorage 載入記錄
try{ const h=localStorage.getItem('impHist'); if(h) window.impHist=JSON.parse(h); }catch(e){}
try{ const c=localStorage.getItem('cLog');    if(c) window.cLog=JSON.parse(c);    }catch(e){}

const IDLE = 30*60;
let idleT = IDLE, idleIv = null;

function getBcrypt(){
  const lib=window.bcrypt||(window.dcodeIO&&window.dcodeIO.bcrypt);
  if(lib) return lib;
  alert('密碼驗證元件載入失敗，請重新整理頁面後再試。 / Không thể tải thành phần xác thực mật khẩu. Vui lòng tải lại trang.');
  throw new Error('bcrypt library is not loaded');
}

// ===== 權限判斷 =====
function isAdm(){ return window.cu && window.cu.role==='admin'; }
function isCurrentDeskAccount(){
  return !!(window.cu&&!window.cu.id&&DESK_ROLES.includes(window.cu.role)&&(window.accs||[]).some(a=>a.user===window.cu.user));
}
function isCurrentEmployee(){
  return !!(window.cu&&window.cu.id&&(window.allEmployees||[]).some(e=>e.id===window.cu.id&&e.user===window.cu.user));
}

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

  // 幣別切換：只有 admin 顯示
  const cgEl = document.querySelector('.cg');
  if(cgEl) cgEl.style.display = isA ? '' : 'none';

  // 所有可控制功能
  const allFeatures = ['attendance','stats','employees','progress','approval','replog','accounts','export','costlog','summary','sync','efficiency'];

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
  document.querySelectorAll('[data-order-manage]').forEach(el=>{
    el.style.display=canManageOrders()?'':'none';
  });
  const reportNav=g('nv-approval');
  if(reportNav&&!isA){
    const rp=perm[r]||{};
    reportNav.className='ni'+((rp.approval===true||rp.replog===true||rp.sync===true)?'':' locked');
  }

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
async function doLogin(){
  const u=g('lu').value.trim(), p=g('lp').value;
  if(!u){ g('lerr').style.display='flex'; return; }

  // 桌機帳號
  const a = window.accs.find(x=>x.user===u);
  if(a){
    if(DESK_ROLES.includes(a.role)){
      if(!a.pass){ window.cu=a; om('m-setpass'); return; }
      const isHashA = a.pass.startsWith('$2a$') || a.pass.startsWith('$2b$'); // 判斷是否已經是 hash
      const passOkA = isHashA ? await getBcrypt().compare(p, a.pass) : (a.pass===p); // hash 比對或明文比對
      if(!passOkA){ g('lerr').style.display='flex'; return; }
      if(!isHashA){ // 舊明文密碼，登入成功後自動轉換成 hash
        const hashed=await getBcrypt().hash(a.pass,10);
        a.pass=hashed;
        if(window.saveAccsToFB) await saveAccsToFB();
      }
      window.cu = a;
      g('ls').style.display='none'; g('ma').classList.remove('hidden');
      uNav(); rAll(); rSum(); rAcc(); startIdle();
      loadPermissions().then(()=>{
        uNav();
        const perm = window.permissionSettings;
        const r = window.cu.role;
        if(r==='admin'){ sp('summary'); return; }
        const order = ['attendance','stats','employees','progress','approval','replog','sync','accounts','export','costlog','summary'];
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
    } else {
      g('lerr').style.display='flex';
      window.cu=null;
    }
    return;
  }

  // 員工帳號（手機版）
  const emp = window.allEmployees.find(x=>x.user===u);
  if(emp){
    if(!emp.pass){ window.cu=emp; om('m-setpass'); return; }
    const isHashE = emp.pass.startsWith('$2a$') || emp.pass.startsWith('$2b$'); // 判斷是否已經是 hash
    const passOkE = isHashE ? await getBcrypt().compare(p, emp.pass) : (emp.pass===p); // hash 比對或明文比對
    if(!passOkE){ g('lerr').style.display='flex'; return; }
    if(!isHashE){ // 舊明文密碼，登入成功後自動轉換成 hash
      const hashed=await getBcrypt().hash(emp.pass,10);
      emp.pass=hashed;
      await window._updateDoc(window._doc(COL.employees,emp.id),{pass:hashed});
    }
    window.cu=emp;
    g('ls').style.display='none'; g('ma').classList.remove('hidden');
    startMobile(emp); return; }

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
  if(window.mobHistUnsub){ window.mobHistUnsub(); window.mobHistUnsub=null; }
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

function openDetailImport(){
  const input=g('fi');
  if(input) input.click();
}

// ===== 頁面切換 =====
async function sp(name){
  if(!isCurrentDeskAccount()){ doLogout(); return; }
  const adm=['settings','export','costlog','accounts'];
  if(adm.includes(name)&&!isAdm()) return;
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
  const pg=g('pg-'+name); if(pg) pg.classList.add('active');
  const nav=g((name==='replog'||name==='sync')?'nv-approval':'nv-'+name); if(nav) nav.classList.add('active');
  if(['summary','export'].includes(name) && window.ensureProductsLoaded) await ensureProductsLoaded();
  if(name==='approval'||name==='replog'||name==='sync') updateReportHubTabs();
  if(name==='settings')  rAll();
  if(name==='export')    rExp();
  if(name==='accounts')  rAcc();
  if(name==='costlog')   rClog();
  if(name==='approval')  renderApproval();
  if(name==='progress'){ reloadProcesses().then(()=>{ renderProgress(); renderOrders(); }); }
  if(name==='stats')     renderStats();
  if(name==='employees') renderEmployees();
  if(name==='attendance') renderAttendance();
  if(name==='replog') renderReplog();
  if(name==='sync') syncInit();
  if(name==='efficiency') effInit();
}

function closeSetPass(){
  if(window.cu && !window.cu.pass){ doLogout(); return; }
  cm('m-setpass');
}

async function saveSetPass(){
  const p1=g('sp-p1')?.value, p2=g('sp-p2')?.value;
  if(!p1||p1.length<4){ alert('密碼至少需要4個字元'); return; }
  if(p1!==p2){ alert('兩次密碼不一致'); return; }
  try{
    const cu=window.cu;
    const hashed=await getBcrypt().hash(p1,10); // 儲存前將密碼 hash
    if(cu.id){
      await window._updateDoc(window._doc(COL.employees,cu.id),{pass:hashed}); // 更新員工密碼
      cu.pass=hashed;
    } else {
      const acc=window.accs.find(a=>a.user===cu.user);
      if(acc){ acc.pass=hashed; await saveAccsToFB(); } // 更新桌機帳號密碼
    }
    cm('m-setpass');
    alert('✅ 密碼設定成功');
    if(isCurrentDeskAccount()){
      g('ls').style.display='none'; g('ma').classList.remove('hidden');
      uNav(); rAll(); rSum(); rAcc(); startIdle();
      loadPermissions().then(()=>{ uNav(); const perm=window.permissionSettings; const r=cu.role; if(r==='admin'){ sp('summary'); return; } const order=['attendance','stats','employees','progress','approval','replog','sync','accounts','export','costlog','summary']; const allowed=order.find(n=>perm[r]&&perm[r][n]===true); if(allowed){ sp(allowed); } });
      setTimeout(()=>fetchRates(),1000); loadOrderData();
      if(typeof startDeskApvListener==='function') startDeskApvListener();
    } else if(isCurrentEmployee()) {
      g('ls').style.display='none'; g('ma').classList.remove('hidden');
      startMobile(cu);
    } else {
      doLogout();
    }
  }catch(e){ alert('設定失敗：'+e.message); }
}
