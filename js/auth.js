// ===== 全域狀態 =====
window.accs = [];
window.cu   = null;
window.cur  = 'VND';
// S（系統計算設定）：公開程式只保留非敏感預設值；薪資與成本由授權後的雲端資料載入。
window.S    = {sal:0,ins:0,meal:0,usd:25400,twd:780,ws:3000,eff:80,mc:null,mh:null};
window.D    = [];
window.impHist = [];
window.cLog    = [];
window.sPage   = 1;
window.dPage   = 1;
// 從 localStorage 載入記錄
try{ const h=localStorage.getItem('impHist'); if(h) window.impHist=JSON.parse(h); }catch(e){}
// cLog（成本變動記錄）不得放在跨帳號共用的 localStorage（瀏覽器本機儲存空間）。
try{ localStorage.removeItem('cLog'); }catch(e){}

const IDLE = 30*60;
let idleT = IDLE, idleIv = null;

// ===== 權限判斷 =====
function isAdm(){ return window.cu && window.cu.role==='admin'; }
function canViewCosts(){
  if(isAdm()) return true;
  const role=window.cu?.role;
  return (role==='manager'||role==='clerk')
    && window.permissionSettings?.[role]?.costView===true;
}
function isCurrentDeskAccount(){
  return !!(
    window.cu?.authUid
    && DESK_ROLES.includes(window.cu.role)
    && window.firebaseAuthUser?.uid===window.cu.authUid
  );
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
  const allFeatures = ['attendance','stats','employees','progress','approval','replog','accounts','export','costlog','summary','cutting','sync','efficiency'];

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
    if(n==='costlog'&&!canViewCosts()) show=false;
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

// ===== Firebase Authentication（Firebase 身分驗證）登入 =====
let firebaseAuthStateBusy = false;
let firebaseAuthInitialCheckComplete = false;
let googleLoginRequestBusy = false;

function refreshGoogleLoginButton(){
  const btn=g('google-login-btn');
  if(!btn) return;
  const checking=!firebaseAuthInitialCheckComplete;
  const busy=checking||firebaseAuthStateBusy||googleLoginRequestBusy;
  btn.disabled=busy;
  btn.innerHTML=checking
    ? '<i class="ti ti-loader-2" aria-hidden="true"></i><span class="login-btn-copy"><span>Đang kiểm tra trạng thái đăng nhập...</span><span class="login-btn-zh">正在確認登入狀態…</span></span>'
    : busy
      ? '<i class="ti ti-loader-2" aria-hidden="true"></i><span class="login-btn-copy"><span>Đang xác minh...</span><span class="login-btn-zh">驗證中…</span></span>'
      : '<span class="google-login-logo" aria-hidden="true"><img src="google-g.svg" alt=""></span><span class="login-btn-copy"><span>Đăng nhập bằng Google</span><span class="login-btn-zh">使用 Google 登入</span></span>';
}

function setGoogleLoginBusy(busy){
  googleLoginRequestBusy=!!busy;
  refreshGoogleLoginButton();
}

function showLoginMessage(message){
  const box=g('lerr'), text=g('lerr-text');
  if(text) text.textContent=message;
  if(box) box.style.display='flex';
}

function hideLoginMessage(){
  const box=g('lerr');
  if(box) box.style.display='none';
}

function clearSessionUi(){
  clearInterval(idleIv);
  ['click','keydown','mousemove'].forEach(e=>document.removeEventListener(e,resetIdle));
  if(typeof setManagementNavOpen==='function') setManagementNavOpen(false);
  window.cu=null;
  window.accs=[];
  window.allEmployees=[];
  window.allOrders=[];
  window.allProcesses=[];
  window.employeeUserHistory={};
  window.impHist=[];
  window.cLog=[];
  // 登出時立即清除記憶體中的薪資與成本，避免同一分頁換帳號後殘留。
  window.S={sal:0,ins:0,meal:0,usd:25400,twd:780,ws:3000,eff:80,mc:null,mh:null};
  ['ss-sal','ss-ins','ss-meal','ss-tc','ss-hr'].forEach(id=>{
    const field=g(id); if(field) field.value=0;
  });
  window.D=[];
  if(typeof resetPermissionsToDefaults==='function') resetPermissionsToDefaults();
  try{
    localStorage.removeItem('impHist');
    localStorage.removeItem('cLog');
  }catch(e){}
  const appEl=document.querySelector('#ma .app');
  if(appEl) appEl.style.display='';
  g('ls').style.display='';
  g('ma').classList.add('hidden');
  g('mob').style.display='none';
  if(window.mobPendingUnsub){ window.mobPendingUnsub(); window.mobPendingUnsub=null; }
  if(window.deskApvUnsub){ window.deskApvUnsub(); window.deskApvUnsub=null; }
  if(window.mobHistUnsub){ window.mobHistUnsub(); window.mobHistUnsub=null; }
}

async function enterAuthorizedDeskSystem(user,access){
  window.cu={
    authUid:user.uid,
    // accessId（權限文件識別碼）、accessMode（權限文件模式）
    accessId:access.accessId||user.uid,
    accessMode:access.accessMode||'uid',
    email:user.email||'',
    user:access.username||user.email||user.uid,
    name:access.displayName||user.displayName||access.username||user.email||'',
    department:access.department||'',
    role:access.role
  };
  const permissionState=typeof loadPermissions==='function'
    ? await loadPermissions()
    : {manager:false,clerk:false};
  if(window.cu.role!=='admin'&&permissionState?.[window.cu.role]!==true){
    const error=new Error('Role permissions are not ready');
    error.code='role-permissions-not-ready';
    throw error;
  }
  await window.fbInitForAuthorizedUser();
  g('ls').style.display='none';
  g('ma').classList.remove('hidden');
  hideLoginMessage();
  if(typeof setManagementNavOpen==='function') setManagementNavOpen(false);
  uNav(); rAll(); rSum(); rAcc(); startIdle();

  if(window.cu.role==='admin'){
    sp('summary');
  }else{
    const perm=window.permissionSettings;
    const role=window.cu.role;
    const order=['attendance','stats','employees','progress','approval','replog','sync','export','costlog','summary','cutting','efficiency'];
    const allowed=order.find(name=>perm[role]&&perm[role][name]===true);
    if(allowed) sp(allowed);
  }
  if(isAdm()) setTimeout(()=>fetchRates(),1000);
}

window.handleFirebaseAuthState=async function(user){
  if(firebaseAuthStateBusy) return;
  firebaseAuthStateBusy=true;
  refreshGoogleLoginButton();
  try{
    if(!user){
      clearSessionUi();
      return;
    }

    let access=null;
    try{
      access=await window.firebaseLoadUserAccess(user);
    }catch(e){
      if(e?.code!=='permission-denied') console.error('讀取使用者權限失敗：',e);
    }

    if(!access){
      await window.firebaseAuthLogout();
      clearSessionUi();
      showLoginMessage('Tài khoản Google chưa được cấp quyền sử dụng. / Google 帳號尚未開通。');
      return;
    }
    if(access.active!==true){
      await window.firebaseAuthLogout();
      clearSessionUi();
      showLoginMessage('Tài khoản đã bị vô hiệu hóa. / 帳號已停用。');
      return;
    }
    if(!DESK_ROLES.includes(access.role)){
      await window.firebaseAuthLogout();
      clearSessionUi();
      showLoginMessage('Chức năng di động hiện đang tạm dừng. / 手機端功能目前暫停使用。');
      return;
    }

    await enterAuthorizedDeskSystem(user,access);
  }catch(e){
    console.error('Firebase Authentication 登入流程失敗：',e);
    if(e?.code==='role-permissions-not-ready'&&typeof window.firebaseAuthLogout==='function'){
      try{ await window.firebaseAuthLogout(); }catch(logoutError){}
    }
    clearSessionUi();
    showLoginMessage(e?.code==='role-permissions-not-ready'
      ? 'Quyền vai trò chưa được quản trị viên thiết lập. / 管理員尚未設定此角色權限。'
      : 'Không thể tải quyền tài khoản, vui lòng thử lại. / 無法載入帳號權限，請稍後再試。');
  }finally{
    firebaseAuthInitialCheckComplete=true;
    firebaseAuthStateBusy=false;
    refreshGoogleLoginButton();
  }
};

async function doLogin(){
  hideLoginMessage();
  if(!firebaseAuthInitialCheckComplete||firebaseAuthStateBusy||googleLoginRequestBusy){
    refreshGoogleLoginButton();
    return;
  }
  if(typeof window.firebaseGoogleLogin!=='function'){
    showLoginMessage('Dịch vụ xác thực chưa sẵn sàng. / 身分驗證服務尚未就緒。');
    return;
  }
  setGoogleLoginBusy(true);
  try{
    await window.firebaseGoogleLogin();
  }catch(e){
    if(e?.code==='auth/popup-closed-by-user' || e?.code==='auth/cancelled-popup-request'){
      showLoginMessage('Đã hủy đăng nhập. / 已取消登入。');
    }else if(e?.code==='auth/operation-not-allowed'){
      showLoginMessage('Chưa bật đăng nhập Google trong Firebase. / Firebase 尚未啟用 Google 登入。');
    }else if(e?.code==='auth/unauthorized-domain'){
      showLoginMessage('Tên miền này chưa được Firebase cho phép. / 此網域尚未加入 Firebase 授權網域。');
    }else{
      console.error('Google 登入失敗：',e);
      showLoginMessage('Đăng nhập Google thất bại, vui lòng thử lại. / Google 登入失敗，請重試。');
    }
  }finally{
    setGoogleLoginBusy(false);
  }
}

// ===== 登出 =====
async function doLogout(){
  clearSessionUi();
  hideLoginMessage();
  if(typeof window.resetAuthorizedFirebaseInit==='function') window.resetAuthorizedFirebaseInit();
  try{
    if(typeof window.firebaseAuthLogout==='function'&&window.firebaseAuthUser){
      await window.firebaseAuthLogout();
    }
  }catch(e){
    console.error('Firebase 登出失敗：',e);
    showLoginMessage('Đăng xuất chưa hoàn tất, vui lòng tải lại trang. / 登出未完成，請重新整理頁面。');
  }
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

async function ensurePageData(name){
  const tasks=[];
  const add=(task)=>{ if(task&&typeof task.then==='function') tasks.push(task); };

  if(['summary','export'].includes(name)){
    add(window.ensureOperationSettingsLoaded?.());
    if(canViewCosts()) add(window.ensureCostSettingsLoaded?.());
    add(window.ensureImportHistoryLoaded?.());
  }
  if(name==='settings'){
    add(window.ensureOperationSettingsLoaded?.());
    add(window.ensureCostSettingsLoaded?.());
    add(window.ensureCostLogLoaded?.());
  }
  if(name==='costlog'&&canViewCosts()) add(window.ensureCostLogLoaded?.());
  if(['stats','progress','sync','efficiency'].includes(name)) add(window.ensureOperationSettingsLoaded?.());
  if(['employees','stats','attendance','approval','replog','accounts'].includes(name)){
    add(window.ensureEmployeesLoaded?.());
  }
  if(name==='employees') add(window.ensureEmployeeUserHistoryLoaded?.());
  if(name==='progress') add(loadOrderData());
  if(['replog','sync'].includes(name)) add(reloadOrders());

  if(!tasks.length) return;
  window.firebaseShowLoading?.(true);
  try{
    await Promise.all(tasks);
  }finally{
    window.firebaseShowLoading?.(false);
  }
}

// ===== 頁面切換 =====
async function sp(name){
  if(!isCurrentDeskAccount()){ doLogout(); return; }
  if(name!=='approval'&&window.deskApvUnsub){
    window.deskApvUnsub();
    window.deskApvUnsub=null;
    window.deskApvLoaded=false;
  }
  const adminOnly=['settings','accounts','permissions'];
  if(adminOnly.includes(name)&&!isAdm()) return;
  if(!isAdm()){
    const featureByPage={
      attendance:'attendance',stats:'stats',employees:'employees',progress:'progress',
      approval:'approval',replog:'replog',sync:'sync',export:'export',costlog:'costlog',
      summary:'summary',cutting:'cutting',efficiency:'efficiency'
    };
    const feature=featureByPage[name];
    if(feature&&window.permissionSettings?.[window.cu.role]?.[feature]!==true) return;
    if(name==='costlog'&&!canViewCosts()) return;
  }
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
  const pg=g('pg-'+name); if(pg) pg.classList.add('active');
  const nav=g((name==='replog'||name==='sync')?'nv-approval':'nv-'+name); if(nav) nav.classList.add('active');
  try{
    await ensurePageData(name);
    if(['summary','export'].includes(name) && window.ensureProductsLoaded) await ensureProductsLoaded();
  }catch(error){
    console.error(`載入 ${name} 頁面資料失敗：`,error);
    alert('Không thể tải dữ liệu chức năng, vui lòng thử lại. / 無法載入功能資料，請重試。');
    return;
  }
  if(name==='approval'||name==='replog'||name==='sync') updateReportHubTabs();
  if(name==='settings')  rAll();
  if(name==='export')    rExp();
  if(name==='accounts'&&typeof loadAccounts==='function') await loadAccounts();
  if(name==='permissions'&&typeof renderPermissions==='function') renderPermissions();
  if(name==='costlog')   rClog();
  if(name==='approval'){
    if(typeof startDeskApvListener==='function') startDeskApvListener();
    renderApproval();
  }
  if(name==='progress'){ renderProgress(); renderOrders(); }
  if(name==='stats')     renderStats();
  if(name==='employees') renderEmployees();
  if(name==='attendance') renderAttendance();
  if(name==='replog') renderReplog();
  if(name==='sync') syncInit();
  if(name==='efficiency') effInit();
  if(name==='cutting' && typeof cuttingInit==='function') cuttingInit();
}
