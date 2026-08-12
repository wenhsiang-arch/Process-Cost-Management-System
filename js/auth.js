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
// impHist（匯入紀錄）與 cLog（成本變動紀錄）改為依帳號即時查詢獨立操作紀錄，不使用跨帳號本機儲存。
try{ localStorage.removeItem('impHist'); }catch(e){}
try{ localStorage.removeItem('cLog'); }catch(e){}

const IDLE = 30*60;
let idleT = IDLE, idleIv = null;

// ===== 權限判斷 =====
function isAdm(){ return window.cu && window.cu.role==='admin'; }
function canViewCosts(){
  if(isAdm()) return true;
  const role=window.cu?.role;
  const permissions=window.permissionSettings?.[role]; // permissions（目前角色權限）。
  return CONFIGURABLE_ROLES.includes(role)
    && permissions?.productsMain===true
    && permissions?.summary===true
    && permissions?.costView===true;
}
// canLoadCostSettings（可讀取成本設定）：敏感工價子開關或成本設定／匯出分頁任一開放即可。
function canLoadCostSettings(){
  if(isAdm()) return true;
  const role=window.cu?.role;
  const permissions=window.permissionSettings?.[role];
  return canViewCosts()||(
    permissions?.costMain===true
    && (permissions?.settings===true||permissions?.export===true)
  );
}
// canEditProcessSeconds（可修改正式工序標準）：敏感權限必須連同款號管理及工序修改頁權限一起開啟。
function canEditProcessSeconds(){
  if(isAdm()) return true;
  const role=window.cu?.role;
  const permissions=window.permissionSettings?.[role];
  return CONFIGURABLE_ROLES.includes(role)
    && permissions?.productsMain===true
    && permissions?.productionProcessEdit===true
    && permissions?.processSecondsEdit===true;
}
function isCurrentDeskAccount(){
  return !!(
    window.cu?.authUid
    && DESK_ROLES.includes(window.cu.role)
    && window.firebaseAuthUser?.uid===window.cu.authUid
  );
}

// canOpenPage（檢查頁面權限）：功能卡隱藏與實際頁面切換共用同一項判斷。
function canOpenPage(name){
  if(!isCurrentDeskAccount()) return false;
  const pageConfig=window.PCMSFeatures?.getPage(name);
  if(!pageConfig) return false;
  if(isAdm()) return true;
  const moduleConfig=window.PCMSFeatures?.getModule(pageConfig.moduleId); // moduleConfig（頁面所屬主功能）
  if(moduleConfig?.adminOnly||pageConfig.adminOnly) return false;
  const moduleFeature=moduleConfig?.mainKey; // moduleFeature（主功能權限）
  if(moduleFeature&&window.permissionSettings?.[window.cu.role]?.[moduleFeature]!==true) return false;
  const feature=pageConfig.feature;
  if(!feature) return false;
  if(window.permissionSettings?.[window.cu.role]?.[feature]!==true) return false;
  return true;
}

// openModule（開啟模組）：依目前角色選擇第一個有權限的內頁。
function openModule(moduleName){
  if(!isCurrentDeskAccount()){ doLogout(); return; }
  const moduleConfig=window.PCMSFeatures?.getModule(moduleName); // moduleConfig（要開啟的主功能）
  const page=moduleConfig?.pages.find(item=>canOpenPage(item.page));
  if(page) sp(page.page);
}

// renderModuleTabs（顯示功能抬頭）：只呈現目前角色可以使用的頁面；單頁功能也保留一格。
function renderModuleTabs(name){
  const host=g('module-tabs-host');
  if(!host) return;
  const pageConfig=window.PCMSFeatures?.getPage(name); // pageConfig（目前頁面設定）
  const moduleConfig=pageConfig?window.PCMSFeatures?.getModule(pageConfig.moduleId):null; // moduleConfig（目前主功能設定）
  const pages=moduleConfig?moduleConfig.pages.filter(item=>canOpenPage(item.page)):[];
  if(!pages.length||moduleConfig?.usesInternalTabs===true){
    host.hidden=true;
    host.innerHTML='';
    return;
  }
  host.innerHTML=pages.map(item=>`
    <button type="button" class="module-tab ui-tab${item.page===name?' active':''}" onclick="sp('${item.page}')">
      <span class="module-tab-copy ui-dual-copy"><strong>${item.vi}</strong><span>${item.zh}</span></span>
    </button>`).join('');
  host.hidden=false;
}

// showFeatureHome（顯示功能首頁）：登入後不自動載入任何業務功能程式或資料。
function showFeatureHome(){
  window.PCMSFeatures?.resetActivePage?.();
  window.PCMSUsageMetrics?.setPage?.('home');
  document.querySelectorAll('.pg').forEach(page=>page.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(item=>item.classList.remove('active'));
  const home=g('pg-home');
  if(home) home.classList.add('active');
  const host=g('module-tabs-host');
  if(host){ host.hidden=true; host.innerHTML=''; }
}
// ===== 導覽權限 =====
function uNav(){
  const r  = window.cu ? window.cu.role : '';
  const isA   = r==='admin';
  const isMgr = r==='manager';

  // 款號總表幣別切換：跟隨「顯示產品工價」權限，避免與角色固定限制衝突。
  const cgEl = g('summary-currency');
  if(cgEl) cgEl.style.display = canViewCosts() ? '' : 'none';

  // 所有導覽入口都使用中央功能清單判斷，避免新增功能時漏改選單。
  const modules=window.PCMSFeatures?.getModules?.()||[]; // modules（中央主功能清單）
  modules.forEach(module=>{
    const el=g('nv-'+module.navId); if(!el) return;
    el.className='ni'+(module.pages.some(item=>canOpenPage(item.page))?'':' locked');
  });
  const hasManagementAccess=modules.filter(module=>module.navGroup==='management').some(module=>{ // hasManagementAccess（具有管理分類功能）
    const item=g('nv-'+module.navId);
    return item&&!item.classList.contains('locked');
  });
  const managementToggle=g('management-toggle'); // managementToggle（管理分類開關）。
  const managementNav=g('management-nav'); // managementNav（管理分類內容）。
  if(managementToggle) managementToggle.style.display=hasManagementAccess?'':'none';
  if(managementNav) managementNav.style.display=hasManagementAccess?'':'none';
  if(!hasManagementAccess&&typeof setManagementNavOpen==='function') setManagementNavOpen(false);
  document.querySelectorAll('[data-order-manage]').forEach(el=>{
    el.style.display=canManageOrders()?'':'none';
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
    if(idleT<=0){ clearInterval(idleIv); doLogout('idle'); }
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
  window.PCMSFeatures?.resetActivePage?.();
  window.PCMSFeatures?.resetPageDataStates?.();
  window.PCMSHistory?.clearSession?.();
  window.PCMSUIRuntime?.resetLanguageMode?.();
  if(typeof setManagementNavOpen==='function') setManagementNavOpen(false);
  window.cu=null;
  window.accs=[];
  if(typeof resetOrderRuntimeCache==='function') resetOrderRuntimeCache();
  window.allOrders=[];
  window.allProcesses=[];
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
    : Object.fromEntries(CONFIGURABLE_ROLES.map(role=>[role,false]));
  if(window.cu.role!=='admin'&&permissionState?.[window.cu.role]!==true){
    const error=new Error('Role permissions are not ready');
    error.code='role-permissions-not-ready';
    throw error;
  }
  const entryOrder=window.PCMSFeatures?.getEntryOrder?.()||[]; // entryOrder（登入後首頁候選順序）：由中央功能清單提供。
  const allowedPage=window.cu.role==='admin'?'summary':entryOrder.find(name=>canOpenPage(name));
  if(!allowedPage){
    const error=new Error('Role has no available functions');
    error.code='role-no-functions';
    throw error;
  }
  await window.PCMSUIRuntime?.loadLanguagePreference?.();
  await window.PCMSUsageMetrics?.startSession?.({
    uid:user.uid,username:window.cu.user,role:window.cu.role
  });
  await window.fbInitForAuthorizedUser();
  g('ls').style.display='none';
  g('ma').classList.remove('hidden');
  hideLoginMessage();
  if(typeof setManagementNavOpen==='function') setManagementNavOpen(false);
  uNav();
  startIdle();
  showFeatureHome();
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
    if(['role-permissions-not-ready','role-no-functions'].includes(e?.code)&&typeof window.firebaseAuthLogout==='function'){
      try{ await window.firebaseAuthLogout(); }catch(logoutError){}
    }
    clearSessionUi();
    showLoginMessage(
      e?.code==='role-permissions-not-ready'
        ? 'Quyền vai trò chưa được quản trị viên thiết lập. / 管理員尚未設定此角色權限。'
        : e?.code==='role-no-functions'
          ? 'Vai trò này chưa được mở chức năng nào. / 此角色尚未開放任何功能。'
          : 'Không thể tải quyền tài khoản, vui lòng thử lại. / 無法載入帳號權限，請稍後再試。'
    );
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
async function doLogout(reason='manual'){
  const shouldEndSession=!!window.firebaseAuthUser&&!!window.cu;
  clearSessionUi();
  hideLoginMessage();
  if(typeof window.resetAuthorizedFirebaseInit==='function') window.resetAuthorizedFirebaseInit();
  try{
    if(shouldEndSession) await window.PCMSUsageMetrics?.endSession?.(reason);
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
  if(typeof window.rSum==='function') window.rSum();
  if(typeof window.rDet==='function') window.rDet();
  if(typeof window.rExp==='function') window.rExp();
}

function openDetailImport(){
  const input=g('fi');
  if(input) input.click();
}

async function ensurePageData(name,options={}){
  if(!window.PCMSFeatures?.ensurePageData){
    throw new Error('Chức năng tải dữ liệu chưa sẵn sàng / 資料載入功能尚未就緒');
  }
  return window.PCMSFeatures.ensurePageData(name,options);
}

// showFeatureDataWarnings（顯示附屬資料警告）：使用非阻擋提示，主功能仍可繼續工作。
function showFeatureDataWarnings(warnings){
  const rows=Array.isArray(warnings)?warnings:[];
  if(!rows.length) return;
  let toast=g('feature-data-warning'); // toast（附屬資料警告框）
  if(!toast){
    toast=document.createElement('div');
    toast.id='feature-data-warning';
    toast.style.cssText='position:fixed;right:18px;bottom:18px;z-index:10020;max-width:390px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:12px;padding:12px 14px;box-shadow:0 8px 24px rgba(15,23,42,.18);font-size:13px;line-height:1.55';
    document.body.appendChild(toast);
  }
  const labels=[...new Map(rows.map(row=>[`${row.vi}|${row.zh}`,{vi:String(row.vi||''),zh:String(row.zh||'')}])).values()];
  toast.replaceChildren();
  const title=document.createElement('strong');
  window.PCMSUIText.set(title,{vi:'Một số dữ liệu phụ chưa tải được',zh:'部分附屬資料暫時無法載入'});
  const detail=window.PCMSUIComponents.createLanguageSections({
    vi:labels.map(label=>label.vi).filter(Boolean).join('、'),
    zh:labels.map(label=>label.zh).filter(Boolean).join('、')
  });
  const note=document.createElement('div');
  window.PCMSUIText.set(note,{vi:'Chức năng chính vẫn có thể sử dụng.',zh:'主功能仍可正常使用。'});
  note.style.marginTop='4px';
  toast.append(title,detail,note);
  toast.style.display='block';
  clearTimeout(window._featureDataWarningTimer); // _featureDataWarningTimer（附屬資料警告計時器）
  window._featureDataWarningTimer=setTimeout(()=>{ toast.style.display='none'; },8000);
}

// featureLoadErrorMessage（功能載入錯誤訊息）：依常見雲端錯誤提供可操作提示。
function featureLoadErrorMessage(error){
  const code=String(error?.code||'');
  const message=String(error?.message||'');
  if(code==='failed-precondition'&&/index/i.test(message)){
    return 'Thiếu chỉ mục dữ liệu cần thiết, vui lòng liên hệ quản trị viên. / 缺少必要的資料索引，請聯絡管理員。';
  }
  if(code==='permission-denied'){
    return 'Tài khoản không có quyền đọc dữ liệu chức năng này. / 此帳號沒有讀取這項功能資料的權限。';
  }
  if(code==='unavailable'){
    return 'Không thể kết nối dữ liệu đám mây, vui lòng kiểm tra mạng rồi thử lại. / 無法連接雲端資料，請檢查網路後重試。';
  }
  return 'Không thể tải dữ liệu chức năng, vui lòng thử lại. / 無法載入功能資料，請重試。';
}

// ===== 頁面切換 =====
async function sp(name){
  if(!isCurrentDeskAccount()){ doLogout(); return; }
  if(!canOpenPage(name)) return false;
  const pageDataReady=window.PCMSFeatures?.isPageDataReady?.(name)===true; // pageDataReady（此頁是否已有工作階段資料）
  const blockingLoad=!pageDataReady; // blockingLoad（是否需要第一次阻擋載入）
  window.PCMSUsageMetrics?.setPage?.(name);
  if(blockingLoad) window.firebaseShowLoading?.(true);
  try{
    const pageConfig=await window.PCMSFeatures.ensurePageScripts(name); // pageConfig（已載入程式的頁面設定）
    const dataWarnings=await ensurePageData(name); // dataWarnings（附屬資料警告）
    document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
    const pg=g('pg-'+name); if(pg) pg.classList.add('active');
    const moduleConfig=window.PCMSFeatures.getModule(pageConfig.moduleId); // moduleConfig（頁面所屬主功能）
    const nav=g('nv-'+(moduleConfig?.navId||name)); if(nav) nav.classList.add('active');
    renderModuleTabs(name);
    await window.PCMSFeatures.enterPage(name);
    showFeatureDataWarnings(dataWarnings);
    if(pageDataReady){
      void window.PCMSFeatures.refreshPageDataInBackground(name)
        .then(result=>showFeatureDataWarnings(result?.warnings||[]))
        .catch(error=>{
          console.warn(`Không thể làm mới dữ liệu nền ${name} / 無法背景更新 ${name} 頁面資料：`,error);
          showFeatureDataWarnings([{
            vi:pageConfig.vi||'Dữ liệu chức năng',
            zh:pageConfig.zh||'功能資料',
            error
          }]);
        });
    }
    return true;
  }catch(error){
    console.error(`載入 ${name} 頁面資料失敗：`,error);
    await window.PCMSUIComponents.alertDialog({kind:'danger',message:window.PCMSUIText.errorPair(featureLoadErrorMessage(error))});
    return false;
  }finally{
    if(blockingLoad) window.firebaseShowLoading?.(false);
  }
}
