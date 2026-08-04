// ===== 全域狀態 =====
window.accs = [];
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

function setGoogleLoginBusy(busy){
  const btn=g('google-login-btn');
  if(!btn) return;
  btn.disabled=!!busy;
  btn.innerHTML=busy
    ? '<i class="ti ti-loader-2"></i> Đang xác minh / 驗證中...'
    : '<i class="ti ti-brand-google"></i> Đăng nhập bằng Google / 使用 Google 登入';
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
  window.cu=null;
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
    email:user.email||'',
    user:access.username||user.email||user.uid,
    name:access.displayName||user.displayName||access.username||user.email||'',
    department:access.department||'',
    role:access.role
  };
  await window.fbInitForAuthorizedUser();
  g('ls').style.display='none';
  g('ma').classList.remove('hidden');
  hideLoginMessage();
  uNav(); rAll(); rSum(); rAcc(); startIdle();

  if(window.cu.role==='admin'){
    sp('summary');
  }else if(typeof loadPermissions==='function'){
    await loadPermissions();
    uNav();
    const perm=window.permissionSettings;
    const role=window.cu.role;
    const order=['attendance','stats','employees','progress','approval','replog','sync','accounts','export','costlog','summary','cutting'];
    const allowed=order.find(name=>perm[role]&&perm[role][name]===true);
    if(allowed) sp(allowed);
  }
  setTimeout(()=>fetchRates(),1000);
  loadOrderData();
  if(typeof startDeskApvListener==='function') startDeskApvListener();
}

window.handleFirebaseAuthState=async function(user){
  if(firebaseAuthStateBusy) return;
  firebaseAuthStateBusy=true;
  setGoogleLoginBusy(true);
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
    clearSessionUi();
    showLoginMessage('Không thể tải quyền tài khoản, vui lòng thử lại. / 無法載入帳號權限，請稍後再試。');
  }finally{
    firebaseAuthStateBusy=false;
    setGoogleLoginBusy(false);
  }
};

async function doLogin(){
  hideLoginMessage();
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
  if(name==='cutting' && typeof cuttingInit==='function') cuttingInit();
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
      if(acc){
        const oldPass=acc.pass;
        acc.pass=hashed;
        const ok=window.saveAccsToFB?await saveAccsToFB():false;
        if(!ok){
          acc.pass=oldPass;
          throw new Error('Không thể lưu mật khẩu, vui lòng kiểm tra mạng rồi thử lại.\n無法保存密碼，請確認網路後再試一次。');
        }
      } else {
        throw new Error('Không tìm thấy tài khoản cần cập nhật.\n找不到需要更新的帳號。');
      } // 更新桌機帳號密碼
    }
    cm('m-setpass');
    alert('✅ 密碼設定成功');
    if(isCurrentDeskAccount()){
      g('ls').style.display='none'; g('ma').classList.remove('hidden');
      uNav(); rAll(); rSum(); rAcc(); startIdle();
      loadPermissions().then(()=>{ uNav(); const perm=window.permissionSettings; const r=cu.role; if(r==='admin'){ sp('summary'); return; } const order=['attendance','stats','employees','progress','approval','replog','sync','accounts','export','costlog','summary','cutting']; const allowed=order.find(n=>perm[r]&&perm[r][n]===true); if(allowed){ sp(allowed); } });
      setTimeout(()=>fetchRates(),1000); loadOrderData();
      if(typeof startDeskApvListener==='function') startDeskApvListener();
    } else if(isCurrentEmployee()) {
      g('ls').style.display='none'; g('ma').classList.remove('hidden');
      startMobile(cu);
    } else {
      doLogout();
    }
  }catch(e){ alert('Cài đặt mật khẩu thất bại.\n設定密碼失敗。\n\n'+e.message); }
}
