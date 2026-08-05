// ===== Firebase 初始化 =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, getDocFromServer, setDoc, addDoc, collection, getDocs, updateDoc, deleteDoc, deleteField, query, where, orderBy, increment, runTransaction, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBBrlo1gVMQmne4gT92lx4KwnRBVt4QSh4",
  authDomain: "process-cost-management-system.firebaseapp.com",
  projectId: "process-cost-management-system",
  storageBucket: "process-cost-management-system.firebasestorage.app",
  messagingSenderId: "162743929598",
  appId: "1:162743929598:web:3170fa1c39a12829c7f3af"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// dataVersions（資料版本）只保存版本代碼，不保存業務資料。
const DATA_VERSIONS_KEY = 'dataVersions';
const CACHEABLE_COLLECTIONS = new Set(['orders','orderProcesses']);
const CACHEABLE_SYSTEM_KEYS = new Set(['operationSettings','costSettings','impHist','cLog']);
const DATA_VERSION_MEMORY_MS = 15000;
let dataVersionsMemory = null;
let dataVersionsReadAt = 0;
let dataVersionsPromise = null;

window.firebaseAuthUser = null;
window.firebaseGoogleLogin = () => signInWithPopup(auth, googleProvider);
window.firebaseAuthLogout = () => signOut(auth);

// normalizeGoogleEmail（標準化 Google 電子信箱）
function normalizeGoogleEmail(value){
  return String(value||'').trim().toLowerCase();
}

// isVerifiedGoogleUser（檢查已驗證的 Google 使用者）
function isVerifiedGoogleUser(user){
  return !!(
    user?.uid
    && user.emailVerified===true
    && normalizeGoogleEmail(user.email)
    && Array.isArray(user.providerData)
    && user.providerData.some(provider=>provider?.providerId==='google.com')
  );
}

window.firebaseLoadUserAccess = async (user) => {
  if(!isVerifiedGoogleUser(user)) return null;
  const uidRef=doc(db,'userAccess',user.uid);
  const uidSnap=await getDoc(uidRef);
  if(uidSnap.exists()){
    return {
      accessId:user.uid,
      accessMode:'uid',
      authUid:user.uid,
      email:normalizeGoogleEmail(user.email),
      googleDisplayName:user.displayName||'',
      ...uidSnap.data()
    };
  }

  const email=normalizeGoogleEmail(user.email);
  const emailRef=doc(db,'userAccess',email);
  const emailSnap=await getDoc(emailRef);
  if(!emailSnap.exists()) return null;
  const access=emailSnap.data();
  const canBind=access.active===true&&window.DESK_ROLES?.includes(access.role);
  const binding={
    authUid:user.uid,
    googleDisplayName:String(user.displayName||'').slice(0,200),
    lastLoginAt:Date.now()
  };
  if(canBind){
    await updateDoc(emailRef,binding);
  }
  return {
    accessId:email,
    accessMode:'email',
    authUid: user.uid,
    email,
    ...access,
    ...(canBind?binding:{})
  };
};
window.firebaseLoadUserAccessList = async () => {
  const snap = await getDocs(collection(db, 'userAccess'));
  return snap.docs.map(item=>({accessId:item.id,...item.data()}));
};
window.firebaseSaveUserAccess = async (accessId,data) => {
  await setDoc(doc(db, 'userAccess', accessId), data);
};
window.firebaseDeleteUserAccess = async (accessId) => {
  await deleteDoc(doc(db, 'userAccess', accessId));
};
// firebaseLoadRolePermissions（讀取角色功能權限）：一般使用者只讀自己的角色。
window.firebaseLoadRolePermissions = async (requestedRoles=[]) => {
  const allowedRoles=window.CONFIGURABLE_ROLES||[]; // allowedRoles（允許讀取的可設定角色）。
  const roles=[...new Set(requestedRoles)].filter(role=>allowedRoles.includes(role));
  const snapshots=await Promise.all(roles.map(role=>getDoc(doc(db,'rolePermissions',role))));
  return Object.fromEntries(roles.map((role,index)=>[
    role,
    snapshots[index].exists()?snapshots[index].data():null
  ]));
};
window.firebaseSaveRolePermissions = async (roleDocuments) => {
  const batch=writeBatch(db);
  (window.CONFIGURABLE_ROLES||[]).forEach(role=>{
    batch.set(doc(db,'rolePermissions',role),roleDocuments[role]);
  });
  await batch.commit();
};

// ===== 同步狀態 =====
window.syncState = 'idle';

function setSyncState(state) {
  window.syncState = state;
  const el = document.getElementById('sync-status');
  if(!el) return;
  const map = {
    idle:    {text:''},
    syncing: {text:'🟡 雲端同步中... / Đang đồng bộ...'},
    success: {text:'🟢 雲端已同步 / Đã đồng bộ · '+new Date().toLocaleTimeString('zh-TW')},
    failed:  {text:'🔴 Đồng bộ thất bại / 同步失敗，正式資料未更新'}
  };
  const m = map[state]||map.idle;
  el.textContent = m.text;
  el.style.color = state==='failed'?'#dc2626':state==='success'?'#16a34a':state==='syncing'?'#f59e0b':'#94a3b8';
  el.style.display = state==='idle'?'none':'block';
}

function showSyncError(message){
  let el = document.getElementById('sync-err-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'sync-err-toast';
    el.style.cssText = 'position:fixed;bottom:60px;right:16px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:10px;padding:12px 16px;font-size:13px;z-index:999;max-width:280px;box-shadow:0 4px 12px rgba(0,0,0,0.1)';
    document.body.appendChild(el);
  }
  const detail = message
    ? String(message).split('\n').map(escapeHtml).join('<br>')
    : 'Dữ liệu chính thức chưa cập nhật, vui lòng kiểm tra mạng rồi nhập lại file Excel<br>正式資料未更新，請確認網路後重新匯入 Excel（表格檔）';
  el.innerHTML = `<b>⚠️ Đồng bộ thất bại / 同步失敗</b><br><span style="font-size:12px;color:#b91c1c">${detail}</span>`;
  el.style.display = 'block';
  clearTimeout(window._syncErrTimer);
  window._syncErrTimer = setTimeout(()=>{ el.style.display='none'; }, 6000);
}

function showLoading(show){
  let el = document.getElementById('fb-loading');
  if(!el){
    el = document.createElement('div');
    el.id = 'fb-loading';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(26,58,92,0.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px';
    el.innerHTML = '<div style="width:48px;height:48px;border:4px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite"></div><div style="color:#fff;font-size:15px">正在連接雲端 / Đang kết nối...</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(el);
  }
  el.style.display = show ? 'flex' : 'none';
}

// ===== Firebase 讀寫 =====
const PRODUCTS_COL = 'products';
const PRODUCTS_META_KEY = 'productsMeta';
const PRODUCTS_CACHE_KEY = 'pcmsProductsCache';
const PRODUCTS_CACHE_VERSION_KEY = 'pcmsProductsCacheVersion';
const PRODUCTS_SCHEMA_VERSION = 1;
const PRODUCTS_MAX_BATCH_ITEMS = 499;
let productsLoadPromise=null;
let runtimeProductsVersion='';

const PRODUCT_SYNC_MESSAGES = {
  tooMany: 'Số mã hàng nhập một lần vượt quá giới hạn an toàn 499 mã. Vui lòng chia nhỏ file Excel để nhập.\n一次匯入款號數超過安全限制 499 款。請分批拆分 Excel（表格檔）後匯入。',
  versionChanged: 'Dữ liệu mã hàng đã được máy khác cập nhật, vui lòng nhấn F5 hoặc mở lại trang rồi thao tác.\n款號資料已被其他電腦更新，請按 F5（重新整理）或重新打開頁面後再操作。',
  missingMeta: 'Thiếu dữ liệu phiên bản mã hàng, vui lòng liên hệ quản trị viên khởi tạo.\n缺少款號版本資料，請聯絡管理員初始化後再操作。',
  localDataMismatch: 'Dữ liệu mã hàng trên máy này không khớp dữ liệu phiên bản, vui lòng nhấn F5 hoặc mở lại trang rồi thao tác.\n本機款號資料與版本資料不一致，請按 F5（重新整理）或重新打開頁面後再操作。'
};

function dataVersionToken(){
  const uid=window.firebaseAuthUser?.uid||'user';
  return `${Date.now()}-${uid.slice(0,12)}-${Math.random().toString(36).slice(2,8)}`;
}

function cacheScopeForReference(reference){
  const parts=String(reference?.path||'').split('/').filter(Boolean);
  if(parts[0]==='system'&&CACHEABLE_SYSTEM_KEYS.has(parts[1])) return parts[1];
  return CACHEABLE_COLLECTIONS.has(parts[0])?parts[0]:'';
}

async function readDataVersions(force=false){
  const now=Date.now();
  if(!force&&dataVersionsMemory&&now-dataVersionsReadAt<DATA_VERSION_MEMORY_MS){
    return {online:true,data:dataVersionsMemory};
  }
  if(dataVersionsPromise) return dataVersionsPromise;
  dataVersionsPromise=(async()=>{
    try{
      const snap=await getDocFromServer(doc(db,'system',DATA_VERSIONS_KEY));
      dataVersionsMemory=snap.exists()?snap.data():{};
      dataVersionsReadAt=Date.now();
      return {online:true,data:dataVersionsMemory};
    }catch(error){
      console.warn('dataVersions（資料版本）無法從雲端讀取：',error);
      return {
        online:false,
        allowOfflineCache:error?.code==='unavailable',
        data:dataVersionsMemory||{}
      };
    }finally{
      dataVersionsPromise=null;
    }
  })();
  return dataVersionsPromise;
}

async function touchDataVersions(scopes){
  const unique=[...new Set((scopes||[]).filter(scope=>CACHEABLE_COLLECTIONS.has(scope)||CACHEABLE_SYSTEM_KEYS.has(scope)))];
  if(!unique.length) return {};
  const updates={updatedAt:Date.now(),updatedBy:window.firebaseAuthUser?.uid||''};
  unique.forEach(scope=>{ updates[scope]=dataVersionToken(); });
  try{
    await setDoc(doc(db,'system',DATA_VERSIONS_KEY),updates,{merge:true});
    dataVersionsMemory={...(dataVersionsMemory||{}),...updates};
    dataVersionsReadAt=Date.now();
  }catch(error){
    dataVersionsMemory=null;
    dataVersionsReadAt=0;
    console.warn('更新 dataVersions（資料版本）失敗：',error);
  }
  await Promise.all(unique.map(scope=>window.pcmsDataCache?.remove(scope)));
  return updates;
}

async function readCachedScope(scope){
  const versionState=await readDataVersions();
  const expectedVersion=versionState.online?String(versionState.data?.[scope]||'0'):undefined;
  const mayUseCache=versionState.online||versionState.allowOfflineCache===true;
  const data=mayUseCache?await window.pcmsDataCache?.read(scope,expectedVersion):null;
  return {data,expectedVersion,online:versionState.online};
}

async function loadCollectionWithCache(scope,collectionName,options={}){
  if(!CACHEABLE_COLLECTIONS.has(scope)||scope!==collectionName) throw new Error(`不允許的 data-cache（資料快取）集合：${scope}`);
  if(options.force===true) await window.pcmsDataCache?.remove(scope);
  const cached=await readCachedScope(scope);
  if(cached.data!==null&&Array.isArray(cached.data)) return cached.data;
  const snap=await getDocs(collection(db,collectionName));
  const rows=snap.docs.map(item=>({id:item.id,...item.data()}));
  const latest=await readDataVersions(true);
  const version=String(latest.data?.[scope]||cached.expectedVersion||'0');
  await window.pcmsDataCache?.write(scope,version,rows);
  return rows;
}

async function loadSystemWithCache(key,options={}){
  if(!CACHEABLE_SYSTEM_KEYS.has(key)) throw new Error(`不允許的 system data-cache（系統資料快取）：${key}`);
  if(options.force===true) await window.pcmsDataCache?.remove(key);
  const cached=await readCachedScope(key);
  if(cached.data!==null&&cached.data!==undefined) return cached.data;
  const snap=await getDoc(doc(db,'system',key));
  const value=snap.exists()?JSON.parse(snap.data().data):null;
  const latest=await readDataVersions(true);
  const version=String(latest.data?.[key]||cached.expectedVersion||'0');
  await window.pcmsDataCache?.write(key,version,value);
  return value;
}

async function fbLoad(key){
  try{
    const snap = await window._getDoc(window._doc("system", key));
    if(snap.exists()) return JSON.parse(snap.data().data);
  }catch(e){ console.error("Firebase load error:", e); }
  return null;
}

async function fbSave(key, data){
  try{
    await setDoc(window._doc("system", key), { data: JSON.stringify(data) });
    const versions=await touchDataVersions([key]);
    if(CACHEABLE_SYSTEM_KEYS.has(key)){
      await window.pcmsDataCache?.write(key,String(versions[key]||'0'),data);
    }
    return true;
  }catch(e){
    console.error("Firebase save error:", e);
    return false;
  }
}

async function fbSaveWithStatus(key, data){
  setSyncState('syncing');
  const ok = await fbSave(key, data);
  if(ok){ setSyncState('success'); }
  else{ setSyncState('failed'); showSyncError(); }
  return ok;
}

function normalizeProductDoc(data,id){
  const item={...data};
  item.code=String(item.code||id||'').trim();
  item.ops=Array.isArray(item.ops)?item.ops:[];
  return item;
}

function productDocId(code){
  return encodeURIComponent(String(code||'').trim());
}

function currentProductsVersion(){
  return String(Date.now())+'-'+Math.random().toString(36).slice(2,8);
}

function escapeHtml(text){
  return String(text||'').replace(/[&<>"']/g, ch=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[ch]));
}

function setProductSyncError(message){
  window.lastProductSyncError = message || '';
  setSyncState('failed');
  showSyncError(message);
}

async function loadProductsMeta(){
  try{
    const snap=await window._getDoc(window._doc('system', PRODUCTS_META_KEY));
    if(snap.exists()) return JSON.parse(snap.data().data||'{}');
  }catch(e){ console.error('讀取款號版本資料失敗：', e); }
  return null;
}

function loadProductsCache(){
  try{
    const raw=localStorage.getItem(PRODUCTS_CACHE_KEY);
    const version=localStorage.getItem(PRODUCTS_CACHE_VERSION_KEY)||'';
    if(!raw||!version) return null;
    const data=JSON.parse(raw);
    if(!Array.isArray(data)) return null;
    return {data,version};
  }catch(e){
    console.error('讀取款號快取失敗：', e);
    return null;
  }
}

function saveProductsCache(items, version){
  try{
    localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(items||[]));
    localStorage.setItem(PRODUCTS_CACHE_VERSION_KEY, String(version||''));
    return true;
  }catch(e){
    console.error('儲存款號快取失敗：', e);
    return false;
  }
}

function normalizeProductsList(items){
  return (Array.isArray(items)?items:[])
    .map(item=>normalizeProductDoc(item,item?.code))
    .filter(item=>item.code)
    .sort((a,b)=>a.code.localeCompare(b.code));
}

function getProductsBase(){
  const runtime=Array.isArray(window.D)&&window.D.length>0?window.D:null;
  if(runtime) return normalizeProductsList(runtime);
  const cache=loadProductsCache();
  return normalizeProductsList(cache?.data||[]);
}

function mergeProducts(base, rows){
  const merged=new Map(normalizeProductsList(base).map(item=>[String(item.code||'').trim(),item]));
  normalizeProductsList(rows).forEach(item=>merged.set(String(item.code||'').trim(),item));
  return normalizeProductsList([...merged.values()]);
}

function removeProductFromList(base, code){
  const target=String(code||'').trim();
  return normalizeProductsList(base).filter(item=>String(item.code||'').trim()!==target);
}

function countProductOps(items){
  const list=normalizeProductsList(items);
  return {
    productCount:list.length,
    opCount:list.reduce((sum,item)=>sum+(Array.isArray(item.ops)?item.ops.length:0),0)
  };
}

function buildProductsMeta(items,lastAction){
  const counts=countProductOps(items);
  return {
    version:currentProductsVersion(),
    updatedAt:Date.now(),
    updatedBy:window.cu?.user||'',
    productCount:counts.productCount,
    opCount:counts.opCount,
    schemaVersion:PRODUCTS_SCHEMA_VERSION,
    lastAction
  };
}

function localProductsVersion(){
  return String(runtimeProductsVersion || localStorage.getItem(PRODUCTS_CACHE_VERSION_KEY) || '');
}

// verifyProductsMetaVersion（檢查款號版本號）：只檢查 productsMeta（款號版本資料）的 version（版本號）。
function verifyProductsMetaVersion(meta){
  if(!meta?.version) throw new Error(PRODUCT_SYNC_MESSAGES.missingMeta);
  const localVersion=localProductsVersion();
  if(!localVersion || String(meta.version)!==localVersion) throw new Error(PRODUCT_SYNC_MESSAGES.versionChanged);
}

// verifyProductsMetaCounts（檢查款號與工序數）：確認本機資料與 productsMeta（款號版本資料）一致。
function verifyProductsMetaCounts(meta, base){
  const counts=countProductOps(base);
  const metaProductCount=Number(meta.productCount);
  const metaOpCount=Number(meta.opCount);
  if(!Number.isFinite(metaProductCount) || !Number.isFinite(metaOpCount) || metaProductCount!==counts.productCount || metaOpCount!==counts.opCount){
    throw new Error(PRODUCT_SYNC_MESSAGES.localDataMismatch);
  }
}

// verifyProductsVersionForOrderImport（訂單匯入前版本重驗）：只讀 system/productsMeta（款號版本資料）一份文件。
async function verifyProductsVersionForOrderImport(){
  const meta=await loadProductsMeta();
  verifyProductsMetaVersion(meta);
  verifyProductsMetaCounts(meta,getProductsBase());
  return true;
}

// verifyProductsVersionBeforeWrite（寫入前版本重驗）：使用同一份 productsMeta（款號版本資料）檢查版本、款號數與工序數。
async function verifyProductsVersionBeforeWrite(base){
  const meta=await loadProductsMeta();
  verifyProductsMetaVersion(meta);
  verifyProductsMetaCounts(meta,base);
  return meta;
}

async function loadProductsData(){
  const items=[];
  const snap=await getDocs(collection(db, PRODUCTS_COL));
  snap.docs.forEach(d=>{
    const data=d.data();
    const code=String(data.code||d.id||'').trim();
    if(!code) return;
    if(data.deleted) return;
    items.push(normalizeProductDoc(data,code));
  });
  return items.sort((a,b)=>a.code.localeCompare(b.code));
}

function replaceRuntimeProducts(items){
  const saved=Array.isArray(items)?items:[];
  if(typeof D !== 'undefined'){
    D.length=0;
    saved.forEach(item=>D.push(item));
  }
  window.D=saved;
}

function renderProductViews(){
  ['rSum','rDet','rExp','rBk'].forEach(name=>{
    if(typeof window[name]==='function') window[name]();
  });
}

async function refreshProductsFromCloud(){
  const saved=await loadProductsData();
  const meta=await loadProductsMeta();
  if(meta?.version){
    saveProductsCache(saved, meta.version);
    runtimeProductsVersion=String(meta.version);
  } else {
    runtimeProductsVersion='';
  }
  replaceRuntimeProducts(saved);
  renderProductViews();
  return saved;
}

async function ensureProductsLoaded(options=false){
  const opts=typeof options==='object'&&options!==null ? options : {force:!!options};
  const force=!!opts.force;
  const requireMeta=!!opts.requireMeta;
  if(productsLoadPromise) return productsLoadPromise;
  productsLoadPromise=(async()=>{
    try{
      const cache=loadProductsCache();
      const meta=await loadProductsMeta();
      if(!force && meta?.version && runtimeProductsVersion===String(meta.version) && Array.isArray(window.D) && window.D.length>0){
        renderProductViews();
        return true;
      }
      if(!force && cache && meta?.version && cache.version===String(meta.version)){
        runtimeProductsVersion=String(meta.version);
        replaceRuntimeProducts(cache.data);
        renderProductViews();
        return true;
      }
      const saved=await loadProductsData();
      replaceRuntimeProducts(saved);
      if(meta?.version){
        saveProductsCache(saved, meta.version);
        runtimeProductsVersion=String(meta.version);
      } else {
        runtimeProductsVersion='';
        if(requireMeta){
          setProductSyncError(PRODUCT_SYNC_MESSAGES.missingMeta);
          renderProductViews();
          return false;
        }
      }
      renderProductViews();
      return true;
    }catch(e){
      console.error('載入款號資料失敗：', e);
      setSyncState('failed');
      showSyncError();
      return false;
    }finally{
      productsLoadPromise=null;
    }
  })();
  return productsLoadPromise;
}

async function saveProductItemsToCollection(items){
  const rows=(Array.isArray(items)?items:[]).filter(x=>String(x?.code||'').trim());
  if(!rows.length) return true;
  window.lastProductSyncError = '';
  setSyncState('syncing');
  try{
    if(rows.length>PRODUCTS_MAX_BATCH_ITEMS) throw new Error(PRODUCT_SYNC_MESSAGES.tooMany);
    const base=getProductsBase();
    await verifyProductsVersionBeforeWrite(base);
    const merged=mergeProducts(base,rows);
    const meta=buildProductsMeta(merged,'import');
    const batch=writeBatch(db);
    rows.forEach(item=>{
      const code=String(item.code).trim();
      batch.set(doc(db, PRODUCTS_COL, productDocId(code)), {
        ...item,
        code,
        ops:Array.isArray(item.ops)?item.ops:[],
        updatedAt:Date.now(),
        updatedBy:window.cu?.user||''
      }, {merge:false});
    });
    batch.set(doc(db, 'system', PRODUCTS_META_KEY), {data:JSON.stringify(meta)});
    await batch.commit();
    saveProductsCache(merged, meta.version);
    runtimeProductsVersion=String(meta.version);
    replaceRuntimeProducts(merged);
    setSyncState('success');
    return true;
  }catch(e){
    console.error('Firebase product item save error:', e);
    setProductSyncError(e.message||'Đồng bộ mã hàng thất bại / 款號同步失敗');
    return false;
  }
}

async function deleteProductDoc(code){
  window.lastProductSyncError = '';
  setSyncState('syncing');
  try{
    const base=getProductsBase();
    await verifyProductsVersionBeforeWrite(base);
    const kept=removeProductFromList(base,code);
    const meta=buildProductsMeta(kept,'delete');
    const batch=writeBatch(db);
    batch.delete(doc(db, PRODUCTS_COL, productDocId(code)));
    batch.set(doc(db, 'system', PRODUCTS_META_KEY), {data:JSON.stringify(meta)});
    await batch.commit();
    saveProductsCache(kept, meta.version);
    runtimeProductsVersion=String(meta.version);
    replaceRuntimeProducts(kept);
    setSyncState('success');
    return true;
  }catch(e){
    console.error('刪除款號雲端文件失敗：', e);
    setProductSyncError(e.message||'Xóa mã hàng thất bại / 刪除款號失敗');
    return false;
  }
}

// ===== 掛到 window =====
window.loadProductsData = loadProductsData;
window.refreshProductsFromCloud = refreshProductsFromCloud;
window.ensureProductsLoaded = ensureProductsLoaded;
window.verifyProductsVersionForOrderImport = verifyProductsVersionForOrderImport;
window.saveProductItemsToFB = saveProductItemsToCollection;
window.deleteProductFromFB = deleteProductDoc;
const OPERATION_SETTING_KEYS = ['usd','twd','ws','eff']; // OPERATION_SETTING_KEYS（一般運算設定欄位）。
const COST_SETTING_KEYS = ['sal','ins','meal','mc','mh']; // COST_SETTING_KEYS（成本設定欄位）。

function pickSettingFields(source,keys){
  const picked={};
  keys.forEach(key=>{
    if(source&&Object.prototype.hasOwnProperty.call(source,key)) picked[key]=source[key];
  });
  return picked;
}

async function saveSplitSettingsToFB(){
  setSyncState('syncing');
  try{
    const operationSettings=pickSettingFields(window.S,OPERATION_SETTING_KEYS);
    const costSettings=pickSettingFields(window.S,COST_SETTING_KEYS);
    const batch=writeBatch(db);
    batch.set(doc(db,'system','operationSettings'),{data:JSON.stringify(operationSettings)});
    batch.set(doc(db,'system','costSettings'),{data:JSON.stringify(costSettings)});
    await batch.commit();
    const versions=await touchDataVersions(['operationSettings','costSettings']);
    await Promise.all([
      window.pcmsDataCache?.write('operationSettings',String(versions.operationSettings||'0'),operationSettings),
      window.pcmsDataCache?.write('costSettings',String(versions.costSettings||'0'),costSettings)
    ]);
    setSyncState('success');
    return true;
  }catch(error){
    console.error('儲存拆分設定失敗：',error);
    setSyncState('failed');
    showSyncError();
    return false;
  }
}

window.saveSettingsToFB  = saveSplitSettingsToFB;
window.saveHistoryToFB   = () => fbSaveWithStatus("impHist",   window.impHist);
window.saveCostLogToFB   = () => fbSaveWithStatus("cLog",      window.cLog);
function applySettings(savedSettings,allowedKeys){
  if(!savedSettings||typeof savedSettings!=='object') return;
  const safeSettings=pickSettingFields(savedSettings,allowedKeys);
  if(typeof S!=='undefined') Object.assign(S,safeSettings);
  window.S={...window.S,...safeSettings};
  const fields={
    'ss-sal':window.S.sal,'ss-ins':window.S.ins,'ss-meal':window.S.meal,
    'ss-usd':window.S.usd,'ss-twd':window.S.twd,'ss-ws':window.S.ws,'ss-eff':window.S.eff
  };
  Object.entries(fields).forEach(([id,value])=>{
    const element=document.getElementById(id);
    if(element) element.value=value;
  });
  if(window.S.mc){ const element=document.getElementById('ss-tc'); if(element) element.value=window.S.mc; }
  if(window.S.mh){ const element=document.getElementById('ss-hr'); if(element) element.value=window.S.mh; }
}

let legacySettingsPromise=null;
async function loadLegacySettingsForAdmin(){
  if(!isAdm()) return null;
  if(!legacySettingsPromise) legacySettingsPromise=fbLoad('settings');
  return legacySettingsPromise;
}

async function ensureOperationSettingsLoaded(options={}){
  let saved=null;
  try{
    saved=await loadSystemWithCache('operationSettings',options);
  }catch(error){
    // 新安全規則尚未發布時，暫時從 settings（舊合併設定）讀取一般運算欄位。
    saved=await fbLoad('settings');
  }
  if(!saved&&isAdm()) saved=await loadLegacySettingsForAdmin();
  applySettings(saved,OPERATION_SETTING_KEYS);
  return pickSettingFields(window.S,OPERATION_SETTING_KEYS);
}

async function ensureCostSettingsLoaded(options={}){
  if(!canLoadCostSettings()){
    window.S={...window.S,sal:0,ins:0,meal:0,mc:null,mh:null};
    await window.pcmsDataCache?.remove('costSettings');
    return pickSettingFields(window.S,COST_SETTING_KEYS);
  }
  let saved=null;
  try{
    saved=await loadSystemWithCache('costSettings',options);
  }catch(error){
    // 過渡期間只有原本已能查看工價的角色會嘗試讀取 settings（舊合併設定）。
    saved=await fbLoad('settings');
  }
  if(!saved&&isAdm()) saved=await loadLegacySettingsForAdmin();
  applySettings(saved,COST_SETTING_KEYS);
  return pickSettingFields(window.S,COST_SETTING_KEYS);
}

async function ensureSettingsLoaded(options={}){
  await ensureOperationSettingsLoaded(options);
  if(canLoadCostSettings()) await ensureCostSettingsLoaded(options);
  return window.S;
}

async function ensureImportHistoryLoaded(options={}){
  const saved=await loadSystemWithCache('impHist',options);
  window.impHist=Array.isArray(saved)?saved:[];
  try{ localStorage.setItem('impHist',JSON.stringify(window.impHist)); }catch(e){}
  return window.impHist;
}

async function ensureCostLogLoaded(options={}){
  const role=window.cu?.role;
  const permissions=window.permissionSettings?.[role]; // permissions（目前角色權限）。
  if(!isAdm()&&(permissions?.costMain!==true||permissions?.costlog!==true)){
    window.cLog=[];
    await window.pcmsDataCache?.remove('cLog');
    return window.cLog;
  }
  const saved=await loadSystemWithCache('cLog',options);
  window.cLog=Array.isArray(saved)?saved:[];
  return window.cLog;
}

window.ensureSettingsLoaded=ensureSettingsLoaded;
window.ensureOperationSettingsLoaded=ensureOperationSettingsLoaded;
window.ensureCostSettingsLoaded=ensureCostSettingsLoaded;
window.ensureImportHistoryLoaded=ensureImportHistoryLoaded;
window.ensureCostLogLoaded=ensureCostLogLoaded;
window.firebaseLoadCachedCollection=loadCollectionWithCache;
window.firebaseTouchDataVersions=touchDataVersions;
window.firebaseShowLoading=showLoading;

window._db         = db;
window._getDocs    = (q)           => getDocs(q);
window._addDoc     = async (colRef,data) => {
  const reference=await addDoc(colRef,data);
  await touchDataVersions([cacheScopeForReference(reference)]);
  return reference;
};
window._updateDoc  = async (ref,data) => {
  await updateDoc(ref,data);
  await touchDataVersions([cacheScopeForReference(ref)]);
};
window._deleteDoc  = async (ref) => {
  await deleteDoc(ref);
  await touchDataVersions([cacheScopeForReference(ref)]);
};
window._doc        = (colName,id)  => doc(db, colName, id);
window._collection = (colName)     => collection(db, colName);
window._query      = (...args)     => query(...args);
window._where      = (...args)     => where(...args);
window._orderBy    = (...args)     => orderBy(...args);
window._getDoc     = (ref)         => getDoc(ref);
window._setDoc     = async (ref,data,opts) => {
  await setDoc(ref,data,opts||{});
  await touchDataVersions([cacheScopeForReference(ref)]);
};
window._increment  = (n)           => increment(n);
window._deleteField = ()            => deleteField();
window._runTransaction = async (fn) => {
  const scopes=new Set();
  const result=await runTransaction(db,rawTransaction=>{
    const trackedTransaction={
      get:(reference)=>rawTransaction.get(reference),
      set:(reference,data,options)=>{
        const scope=cacheScopeForReference(reference); if(scope) scopes.add(scope);
        if(options) rawTransaction.set(reference,data,options); else rawTransaction.set(reference,data);
        return trackedTransaction;
      },
      update:(reference,data)=>{
        const scope=cacheScopeForReference(reference); if(scope) scopes.add(scope);
        rawTransaction.update(reference,data);
        return trackedTransaction;
      },
      delete:(reference)=>{
        const scope=cacheScopeForReference(reference); if(scope) scopes.add(scope);
        rawTransaction.delete(reference);
        return trackedTransaction;
      }
    };
    return fn(trackedTransaction);
  });
  await touchDataVersions([...scopes]);
  return result;
};
window._writeBatch = () => {
  const rawBatch=writeBatch(db);
  const scopes=new Set();
  const trackedBatch={
    set:(reference,data,options)=>{
      const scope=cacheScopeForReference(reference); if(scope) scopes.add(scope);
      if(options) rawBatch.set(reference,data,options); else rawBatch.set(reference,data);
      return trackedBatch;
    },
    update:(reference,data)=>{
      const scope=cacheScopeForReference(reference); if(scope) scopes.add(scope);
      rawBatch.update(reference,data);
      return trackedBatch;
    },
    delete:(reference)=>{
      const scope=cacheScopeForReference(reference); if(scope) scopes.add(scope);
      rawBatch.delete(reference);
      return trackedBatch;
    },
    commit:async()=>{
      await rawBatch.commit();
      await touchDataVersions([...scopes]);
    }
  };
  return trackedBatch;
};
window._docRef     = (colName, id) => doc(db, colName, id);
window._newDocRef  = (colName)     => doc(collection(db, colName));
// ===== 驗證成功後初始化 =====
let authorizedInitPromise = null;

async function fbInitForAuthorizedUser(){
  if(authorizedInitPromise) return authorizedInitPromise;
  authorizedInitPromise = (async()=>{
    await window.pcmsDataCache?.requestPersistentStorage();
    // settings（舊合併設定）可能包含薪資，登入後一律清除舊快取。
    await window.pcmsDataCache?.remove('settings');
    // 清除已淘汰的員工、報工、考勤與員工帳號歷史快取。
    await Promise.all([
      window.pcmsDataCache?.remove('employees'),
      window.pcmsDataCache?.remove('reports'),
      window.pcmsDataCache?.remove('attendance'),
      window.pcmsDataCache?.remove('employeeUserHistory')
    ]);
    try{ localStorage.removeItem('mob_rej_read'); }catch(e){}
    if(!canLoadCostSettings()) await window.pcmsDataCache?.remove('costSettings');
    const role=window.cu?.role;
    const permissions=window.permissionSettings?.[role]; // permissions（目前角色權限）。
    if(!isAdm()&&(permissions?.costMain!==true||permissions?.costlog!==true)){
      window.cLog=[];
      await window.pcmsDataCache?.remove('cLog');
    }
    return true;
  })();
  try{
    return await authorizedInitPromise;
  }catch(e){
    authorizedInitPromise = null;
    throw e;
  }
}

window.fbInitForAuthorizedUser = fbInitForAuthorizedUser;
window.resetAuthorizedFirebaseInit = () => {
  authorizedInitPromise=null;
  legacySettingsPromise=null;
  dataVersionsMemory=null;
  dataVersionsReadAt=0;
  dataVersionsPromise=null;
};

onAuthStateChanged(auth, async(user)=>{
  window.firebaseAuthUser = user || null;
  if(typeof window.handleFirebaseAuthState === 'function'){
    await window.handleFirebaseAuthState(user || null);
  }
});
