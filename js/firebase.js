// ===== Firebase 初始化 =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,doc,getDoc as firestoreGetDoc,getDocFromServer as firestoreGetDocFromServer,
  setDoc as firestoreSetDoc,collection,getDocs as firestoreGetDocs,updateDoc as firestoreUpdateDoc,
  deleteDoc as firestoreDeleteDoc,deleteField,query,where,orderBy,limit,startAfter,documentId,
  increment,serverTimestamp,runTransaction as firestoreRunTransaction,writeBatch as firestoreWriteBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
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

// 以下包裝只記錄呼叫與文件數量，不記錄查詢條件或資料內容。
async function getDoc(reference){
  const snapshot=await firestoreGetDoc(reference);
  window.PCMSUsageMetrics?.recordCloudRead?.({queryCount:1,documentReads:1});
  return snapshot;
}
async function getDocFromServer(reference){
  const snapshot=await firestoreGetDocFromServer(reference);
  window.PCMSUsageMetrics?.recordCloudRead?.({queryCount:1,documentReads:1});
  return snapshot;
}
async function getDocs(reference){
  const snapshot=await firestoreGetDocs(reference);
  window.PCMSUsageMetrics?.recordCloudRead?.({queryCount:1,documentReads:snapshot.size});
  return snapshot;
}
async function setDoc(reference,data,options){
  const result=options===undefined
    ? await firestoreSetDoc(reference,data)
    : await firestoreSetDoc(reference,data,options);
  window.PCMSUsageMetrics?.recordCloudWrite?.({writeRequestCount:1,documentWrites:1});
  return result;
}
async function updateDoc(reference,data){
  const result=await firestoreUpdateDoc(reference,data);
  window.PCMSUsageMetrics?.recordCloudWrite?.({writeRequestCount:1,documentWrites:1});
  return result;
}
async function deleteDoc(reference){
  const result=await firestoreDeleteDoc(reference);
  window.PCMSUsageMetrics?.recordCloudWrite?.({writeRequestCount:1,documentWrites:1});
  return result;
}
function writeBatch(database){
  const raw=firestoreWriteBatch(database);
  let writeCount=0;
  const wrapped={
    set(reference,data,options){ writeCount+=1; if(options) raw.set(reference,data,options); else raw.set(reference,data); return wrapped; },
    update(reference,data){ writeCount+=1; raw.update(reference,data); return wrapped; },
    delete(reference){ writeCount+=1; raw.delete(reference); return wrapped; },
    async commit(){
      const result=await raw.commit();
      if(writeCount>0) window.PCMSUsageMetrics?.recordCloudWrite?.({writeRequestCount:1,documentWrites:writeCount});
      return result;
    }
  };
  return wrapped;
}
async function runTransaction(database,worker){
  let committedWrites=0;
  const result=await firestoreRunTransaction(database,async raw=>{
    let attemptWrites=0;
    const transaction={
      async get(reference){
        const snapshot=await raw.get(reference);
        window.PCMSUsageMetrics?.recordCloudRead?.({queryCount:1,documentReads:1});
        return snapshot;
      },
      set(reference,data,options){ attemptWrites+=1; if(options) raw.set(reference,data,options); else raw.set(reference,data); return transaction; },
      update(reference,data){ attemptWrites+=1; raw.update(reference,data); return transaction; },
      delete(reference){ attemptWrites+=1; raw.delete(reference); return transaction; }
    };
    const value=await worker(transaction);
    committedWrites=attemptWrites;
    return value;
  });
  if(committedWrites>0) window.PCMSUsageMetrics?.recordCloudWrite?.({writeRequestCount:1,documentWrites:committedWrites});
  return result;
}

// dataVersions（資料版本）只保存版本代碼，不保存業務資料。
const DATA_VERSIONS_KEY = 'dataVersions';
const CACHEABLE_COLLECTIONS = new Set([
  'orders','orderProcesses','productionEmployees','productionDepartments','productionEntries'
]); // CACHEABLE_COLLECTIONS（允許使用資料版本快取的集合）
const CACHEABLE_SYSTEM_KEYS = new Set(['operationSettings','costSettings']);
const DATA_VERSION_MEMORY_MS = 15000;
let dataVersionsMemory = null;
let dataVersionsReadAt = 0;
let dataVersionsPromise = null;

window.firebaseAuthUser = null;
window.firebaseGoogleLogin = () => signInWithPopup(auth, googleProvider);
// 產能、考勤與分析快取依 UID（使用者識別碼）隔離並保留，登出不再清除大量日常資料。
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
  const email=normalizeGoogleEmail(user.email);
  const uidRef=doc(db,'userAccess',user.uid);
  const emailRef=doc(db,'userAccess',email);
  // migrateEmailApprovalToUid（把電子信箱核准資料自動轉成 UID 權限資料）
  return runTransaction(db,async transaction=>{
    const uidSnap=await transaction.get(uidRef);
    if(uidSnap.exists()){
      return {
        ...uidSnap.data(),
        accessId:user.uid,
        accessMode:'uid',
        authUid:user.uid,
        email
      };
    }

    const emailSnap=await transaction.get(emailRef);
    if(!emailSnap.exists()) return null;
    const access=emailSnap.data();
    const approvedRole=window.DESK_ROLES?.includes(access.role);
    const existingUid=String(access.authUid||'');
    if(access.active!==true||!approvedRole||(existingUid&&existingUid!==user.uid)) return null;

    const migratedAccess={
      ...access,
      email,
      authUid:user.uid,
      googleDisplayName:String(user.displayName||'').slice(0,200),
      lastLoginAt:Date.now()
    }; // migratedAccess（完成轉換後的 UID 權限資料）
    transaction.set(uidRef,migratedAccess);
    transaction.delete(emailRef);
    return {
      ...migratedAccess,
      accessId:user.uid,
      accessMode:'uid'
    };
  });
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
const PRODUCT_CHANGES_COL = 'productChanges';
const PRODUCTS_SCHEMA_VERSION = 2;
const PRODUCTS_MAX_BATCH_ITEMS = 498;
const PRODUCT_CHANGE_PAGE_SIZE = 100;
const PRODUCT_QUERY_CHUNK_SIZE = 30;
const PRODUCT_META_MEMORY_MS = 15000;
let productsLoadPromise=null;
let runtimeProductsVersion='';
let runtimeProductsSequence=0;
let productsMetaMemory=null;
let productsMetaReadAt=0;

function newProductReadMetrics(){
  return {mode:'pending',metaReads:0,changeLogReads:0,productReads:0,totalReads:0,startedAt:Date.now()};
}

function publishProductReadMetrics(metrics,meta){
  const result={
    ...metrics,
    totalReads:(metrics.metaReads||0)+(metrics.changeLogReads||0)+(metrics.productReads||0),
    productCount:Number(meta?.productCount)||window.D?.length||0,
    finishedAt:Date.now()
  };
  window.lastProductReadMetrics=Object.freeze(result); // lastProductReadMetrics（最近一次款號讀取量）
  return result;
}

const PRODUCT_SYNC_MESSAGES = {
  tooMany: 'Số mã hàng nhập một lần vượt quá giới hạn an toàn 498 mã. Vui lòng chia nhỏ file Excel để nhập.\n一次匯入款號數超過安全限制 498 款。請分批拆分 Excel（表格檔）後匯入。',
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

function createDataVersionChange(scopes){
  const unique=[...new Set((scopes||[]).filter(scope=>CACHEABLE_COLLECTIONS.has(scope)||CACHEABLE_SYSTEM_KEYS.has(scope)))];
  const updates={updatedAt:Date.now(),updatedBy:window.firebaseAuthUser?.uid||''};
  unique.forEach(scope=>{ updates[scope]=dataVersionToken(); });
  return {scopes:unique,updates};
}

function appendDataVersionWrite(writer,scopes){
  const change=createDataVersionChange(scopes); // change（本次資料版本異動）
  if(change.scopes.length){
    writer.set(doc(db,'system',DATA_VERSIONS_KEY),change.updates,{merge:true});
  }
  return change;
}

async function finishDataVersionChange(change){
  if(!change?.scopes?.length) return change?.updates||{};
  dataVersionsMemory={...(dataVersionsMemory||{}),...change.updates};
  dataVersionsReadAt=Date.now();
  window.PCMSFeatures?.invalidateDataScopes?.(change.scopes);
  const results=await Promise.allSettled(change.scopes.map(scope=>window.pcmsDataCache?.remove(scope)));
  results.forEach(result=>{
    if(result.status==='rejected') console.warn('清除 data-cache（資料快取）失敗：',result.reason);
  });
  return change.updates;
}

async function touchDataVersions(scopes){
  const change=createDataVersionChange(scopes); // change（獨立資料版本異動）
  if(!change.scopes.length) return {};
  try{
    await setDoc(doc(db,'system',DATA_VERSIONS_KEY),change.updates,{merge:true});
  }catch(error){
    dataVersionsMemory=null;
    dataVersionsReadAt=0;
    console.error('更新 dataVersions（資料版本）失敗：',error);
    throw error;
  }
  return finishDataVersionChange(change);
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
  if(cached.data!==null&&Array.isArray(cached.data)){
    window.lastCollectionReadMetrics=Object.freeze({scope,mode:'indexeddb',documentReads:0,finishedAt:Date.now()});
    return cached.data;
  }
  const snap=await getDocs(collection(db,collectionName));
  const rows=snap.docs.map(item=>({id:item.id,...item.data()}));
  window.PCMSUsageMetrics?.recordFullLoad?.({scope,documentReads:snap.size});
  const latest=await readDataVersions(true);
  const version=String(latest.data?.[scope]||cached.expectedVersion||'0');
  await window.pcmsDataCache?.write(scope,version,rows);
  window.lastCollectionReadMetrics=Object.freeze({scope,mode:'full',documentReads:snap.size,finishedAt:Date.now()});
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
    const batch=writeBatch(db); // batch（資料與版本的同一批次寫入）
    batch.set(doc(db,'system',key),{data:JSON.stringify(data)});
    const versionChange=appendDataVersionWrite(batch,[key]); // versionChange（同批資料版本異動）
    await batch.commit();
    const versions=await finishDataVersionChange(versionChange);
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

async function loadProductsMeta(metrics=null,forceServer=false){
  const now=Date.now();
  if(!forceServer&&productsMetaMemory&&now-productsMetaReadAt<PRODUCT_META_MEMORY_MS){
    return productsMetaMemory;
  }
  try{
    const snap=await getDocFromServer(doc(db,'system',PRODUCTS_META_KEY));
    if(metrics) metrics.metaReads++;
    productsMetaMemory=snap.exists()?JSON.parse(snap.data().data||'{}'):null;
    productsMetaReadAt=Date.now();
    return productsMetaMemory;
  }catch(e){ console.error('讀取款號版本資料失敗：', e); }
  return null;
}

async function loadProductsCache(){
  if(!window.PCMSProductCache) return null;
  return window.PCMSProductCache.read();
}

async function saveProductsCache(items, meta){
  if(!window.PCMSProductCache) return false;
  return window.PCMSProductCache.write(items,meta);
}

function normalizeProductsList(items){
  return (Array.isArray(items)?items:[])
    .map(item=>normalizeProductDoc(item,item?.code))
    .filter(item=>item.code)
    .sort((a,b)=>a.code.localeCompare(b.code));
}

function getProductsBase(){
  return normalizeProductsList(Array.isArray(window.D)?window.D:[]);
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

function buildProductsMeta(items,lastAction,previousMeta={}){
  const counts=countProductOps(items);
  return {
    version:currentProductsVersion(),
    updatedAt:Date.now(),
    updatedBy:window.cu?.user||'',
    productCount:counts.productCount,
    opCount:counts.opCount,
    schemaVersion:PRODUCTS_SCHEMA_VERSION,
    changeSequence:(Number(previousMeta?.changeSequence)||0)+1,
    lastAction
  };
}

function localProductsVersion(){
  return String(runtimeProductsVersion||'');
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
  const meta=await loadProductsMeta(null,true);
  verifyProductsMetaVersion(meta);
  verifyProductsMetaCounts(meta,getProductsBase());
  return true;
}

// verifyProductsVersionBeforeWrite（寫入前版本重驗）：使用同一份 productsMeta（款號版本資料）檢查版本、款號數與工序數。
async function verifyProductsVersionBeforeWrite(base){
  const meta=await loadProductsMeta(null,true);
  verifyProductsMetaVersion(meta);
  verifyProductsMetaCounts(meta,base);
  return meta;
}

async function loadProductsData(metrics=null){
  const items=[];
  const snap=await getDocs(collection(db, PRODUCTS_COL));
  if(metrics) metrics.productReads+=snap.size;
  snap.docs.forEach(d=>{
    const data=d.data();
    const code=String(data.code||d.id||'').trim();
    if(!code) return;
    if(data.deleted) return;
    items.push(normalizeProductDoc(data,code));
  });
  return items.sort((a,b)=>a.code.localeCompare(b.code));
}

async function loadProductChangesAfter(sequence,targetSequence,metrics){
  const rows=[];
  let cursor=null; // cursor（款號變更紀錄分頁游標）
  while(rows.length<1000){
    const conditions=[
      where('sequence','>',sequence),
      orderBy('sequence','asc')
    ];
    if(cursor) conditions.push(startAfter(cursor));
    conditions.push(limit(PRODUCT_CHANGE_PAGE_SIZE));
    const snapshot=await getDocs(query(collection(db,PRODUCT_CHANGES_COL),...conditions));
    metrics.changeLogReads+=snapshot.size;
    if(snapshot.empty) break;
    snapshot.docs.forEach(item=>rows.push({id:item.id,...item.data()}));
    cursor=snapshot.docs[snapshot.docs.length-1];
    if(Number(rows[rows.length-1]?.sequence)>=targetSequence||snapshot.size<PRODUCT_CHANGE_PAGE_SIZE) break;
  }
  return rows.filter(row=>Number(row.sequence)<=targetSequence);
}

async function loadChangedProducts(codes,metrics){
  const normalized=[...new Set((codes||[]).map(code=>String(code||'').trim()).filter(Boolean))];
  const items=[];
  for(let offset=0;offset<normalized.length;offset+=PRODUCT_QUERY_CHUNK_SIZE){
    const ids=normalized.slice(offset,offset+PRODUCT_QUERY_CHUNK_SIZE).map(productDocId);
    const snapshot=await getDocs(query(
      collection(db,PRODUCTS_COL),
      where(documentId(),'in',ids)
    ));
    metrics.productReads+=snapshot.size;
    snapshot.docs.forEach(item=>items.push(normalizeProductDoc(item.data(),item.id)));
  }
  return items;
}

async function applyProductChanges(cache,meta,metrics){
  if(!window.PCMSProductCache) return null;
  const startSequence=Number(cache?.sequence)||0;
  const targetSequence=Number(meta?.changeSequence)||0;
  if(targetSequence<=startSequence) return null;
  const logs=await loadProductChangesAfter(startSequence,targetSequence,metrics);
  const plan=window.PCMSProductCache.planChanges(logs,startSequence); // plan（款號增量合併計畫）
  if(!plan.valid||plan.sequence!==targetSequence) return null;
  const changedItems=await loadChangedProducts(plan.changedCodes,metrics);
  const returnedCodes=new Set(changedItems.map(item=>item.code));
  const missingChangedCodes=plan.changedCodes.filter(code=>!returnedCodes.has(code));
  const merged=window.PCMSProductCache.merge(
    cache.items,
    changedItems,
    [...plan.deletedCodes,...missingChangedCodes]
  );
  verifyProductsMetaCounts(meta,merged);
  await saveProductsCache(merged,meta);
  return merged;
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
  await ensureProductsLoaded({force:true});
  return window.D;
}

async function ensureProductsLoaded(options=false){
  const opts=typeof options==='object'&&options!==null ? options : {force:!!options};
  const force=!!opts.force;
  const requireMeta=!!opts.requireMeta;
  if(productsLoadPromise) return productsLoadPromise;
  productsLoadPromise=(async()=>{
    const metrics=newProductReadMetrics();
    let activeMeta=null;
    try{
      if(!window.PCMSProductCache) throw new Error('Thiếu chương trình bộ nhớ đệm mã hàng / 缺少款號快取程式');
      if(force) await window.PCMSProductCache.remove();
      const [cache,meta]=await Promise.all([loadProductsCache(),loadProductsMeta(metrics,force)]);
      activeMeta=meta;
      if(!force && meta?.version && runtimeProductsVersion===String(meta.version) && Array.isArray(window.D)){
        metrics.mode='runtime';
        renderProductViews();
        publishProductReadMetrics(metrics,meta);
        return true;
      }
      if(!force && cache && meta?.version && cache.version===String(meta.version)){
        runtimeProductsVersion=String(meta.version);
        runtimeProductsSequence=Number(meta.changeSequence)||Number(cache.sequence)||0;
        replaceRuntimeProducts(cache.items);
        metrics.mode='indexeddb';
        renderProductViews();
        publishProductReadMetrics(metrics,meta);
        return true;
      }
      if(!force&&cache&&meta?.version&&Number(meta.changeSequence)>Number(cache.sequence||0)){
        const changed=await applyProductChanges(cache,meta,metrics);
        if(changed){
          runtimeProductsVersion=String(meta.version);
          runtimeProductsSequence=Number(meta.changeSequence)||0;
          replaceRuntimeProducts(changed);
          metrics.mode='delta';
          renderProductViews();
          publishProductReadMetrics(metrics,meta);
          return true;
        }
      }
      let saved=await loadProductsData(metrics);
      let latestMeta=await loadProductsMeta(metrics,true);
      if(meta?.version&&latestMeta?.version&&String(meta.version)!==String(latestMeta.version)){
        saved=await loadProductsData(metrics);
        latestMeta=await loadProductsMeta(metrics,true);
      }
      activeMeta=latestMeta||meta;
      replaceRuntimeProducts(saved);
      if(activeMeta?.version){
        verifyProductsMetaCounts(activeMeta,saved);
        await saveProductsCache(saved,activeMeta);
        runtimeProductsVersion=String(activeMeta.version);
        runtimeProductsSequence=Number(activeMeta.changeSequence)||0;
      } else {
        runtimeProductsVersion='';
        runtimeProductsSequence=0;
        if(requireMeta){
          setProductSyncError(PRODUCT_SYNC_MESSAGES.missingMeta);
          renderProductViews();
          metrics.mode='missing-meta';
          publishProductReadMetrics(metrics,activeMeta);
          return false;
        }
      }
      metrics.mode='full';
      renderProductViews();
      publishProductReadMetrics(metrics,activeMeta);
      return true;
    }catch(e){
      console.error('載入款號資料失敗：', e);
      setSyncState('failed');
      showSyncError();
      metrics.mode='failed';
      publishProductReadMetrics(metrics,activeMeta);
      return false;
    }finally{
      productsLoadPromise=null;
    }
  })();
  return productsLoadPromise;
}

async function saveProductItemsToCollection(items){
  const rows=[...new Map((Array.isArray(items)?items:[])
    .filter(item=>String(item?.code||'').trim())
    .map(item=>[String(item.code).trim(),item])).values()];
  if(!rows.length) return true;
  window.lastProductSyncError = '';
  setSyncState('syncing');
  try{
    if(rows.length>PRODUCTS_MAX_BATCH_ITEMS) throw new Error(PRODUCT_SYNC_MESSAGES.tooMany);
    const currentUserUid=String(auth.currentUser?.uid||'');
    if(!currentUserUid) throw new Error('Vui lòng đăng nhập lại / 請重新登入');
    const base=getProductsBase();
    const merged=mergeProducts(base,rows);
    const metaRef=doc(db,'system',PRODUCTS_META_KEY);
    const changeRef=doc(collection(db,PRODUCT_CHANGES_COL));
    let meta=null;
    await runTransaction(db,async transaction=>{
      const metaSnapshot=await transaction.get(metaRef);
      const currentMeta=metaSnapshot.exists()
        ? JSON.parse(metaSnapshot.data().data||'{}')
        : null;
      verifyProductsMetaVersion(currentMeta);
      verifyProductsMetaCounts(currentMeta,base);
      meta=buildProductsMeta(merged,'import',currentMeta);
      const changedAt=Date.now();
      rows.forEach(item=>{
        const code=String(item.code).trim();
        transaction.set(doc(db,PRODUCTS_COL,productDocId(code)),{
          ...item,
          code,
          ops:Array.isArray(item.ops)?item.ops:[],
          updatedAt:changedAt,
          updatedBy:window.cu?.user||''
        },{merge:false});
      });
      transaction.set(changeRef,{
        sequence:meta.changeSequence,
        fromVersion:String(currentMeta.version),
        toVersion:String(meta.version),
        changedCodes:rows.map(item=>String(item.code).trim()),
        deletedCodes:[],
        createdAt:changedAt,
        createdByUid:currentUserUid,
        createdBy:window.cu?.user||auth.currentUser?.displayName||currentUserUid
      });
      transaction.set(metaRef,{data:JSON.stringify(meta)});
    });
    await saveProductsCache(merged,meta);
    runtimeProductsVersion=String(meta.version);
    runtimeProductsSequence=Number(meta.changeSequence)||0;
    productsMetaMemory=meta;
    productsMetaReadAt=Date.now();
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
    const currentUserUid=String(auth.currentUser?.uid||'');
    if(!currentUserUid) throw new Error('Vui lòng đăng nhập lại / 請重新登入');
    const normalizedCode=String(code||'').trim();
    if(!normalizedCode) throw new Error('Thiếu mã hàng / 缺少款號');
    const base=getProductsBase();
    const kept=removeProductFromList(base,normalizedCode);
    const metaRef=doc(db,'system',PRODUCTS_META_KEY);
    const changeRef=doc(collection(db,PRODUCT_CHANGES_COL));
    let meta=null;
    await runTransaction(db,async transaction=>{
      const metaSnapshot=await transaction.get(metaRef);
      const currentMeta=metaSnapshot.exists()
        ? JSON.parse(metaSnapshot.data().data||'{}')
        : null;
      verifyProductsMetaVersion(currentMeta);
      verifyProductsMetaCounts(currentMeta,base);
      meta=buildProductsMeta(kept,'delete',currentMeta);
      const changedAt=Date.now();
      transaction.delete(doc(db,PRODUCTS_COL,productDocId(normalizedCode)));
      transaction.set(changeRef,{
        sequence:meta.changeSequence,
        fromVersion:String(currentMeta.version),
        toVersion:String(meta.version),
        changedCodes:[],
        deletedCodes:[normalizedCode],
        createdAt:changedAt,
        createdByUid:currentUserUid,
        createdBy:window.cu?.user||auth.currentUser?.displayName||currentUserUid
      });
      transaction.set(metaRef,{data:JSON.stringify(meta)});
    });
    await saveProductsCache(kept,meta);
    runtimeProductsVersion=String(meta.version);
    runtimeProductsSequence=Number(meta.changeSequence)||0;
    productsMetaMemory=meta;
    productsMetaReadAt=Date.now();
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
    const versionChange=appendDataVersionWrite(batch,['operationSettings','costSettings']); // versionChange（設定資料版本異動）
    await batch.commit();
    const versions=await finishDataVersionChange(versionChange);
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

window.ensureSettingsLoaded=ensureSettingsLoaded;
window.ensureOperationSettingsLoaded=ensureOperationSettingsLoaded;
window.ensureCostSettingsLoaded=ensureCostSettingsLoaded;
window.firebaseLoadCachedCollection=loadCollectionWithCache;
window.firebaseTouchDataVersions=touchDataVersions;
window.firebaseReadDataVersions=readDataVersions;
window.firebaseShowLoading=showLoading;

window._db         = db;
window._getDocs    = (q)           => getDocs(q);
window._addDoc     = async (colRef,data) => {
  const reference=doc(colRef); // reference（預先建立的新文件位置）
  const scope=cacheScopeForReference(reference); // scope（對應資料快取範圍）
  if(!scope){
    await setDoc(reference,data);
    return reference;
  }
  const batch=writeBatch(db); // batch（資料與版本的同一批次寫入）
  batch.set(reference,data);
  const versionChange=appendDataVersionWrite(batch,[scope]);
  await batch.commit();
  await finishDataVersionChange(versionChange);
  return reference;
};
window._updateDoc  = async (ref,data) => {
  const scope=cacheScopeForReference(ref); // scope（對應資料快取範圍）
  if(!scope) return updateDoc(ref,data);
  const batch=writeBatch(db);
  batch.update(ref,data);
  const versionChange=appendDataVersionWrite(batch,[scope]);
  await batch.commit();
  await finishDataVersionChange(versionChange);
};
window._deleteDoc  = async (ref) => {
  const scope=cacheScopeForReference(ref); // scope（對應資料快取範圍）
  if(!scope) return deleteDoc(ref);
  const batch=writeBatch(db);
  batch.delete(ref);
  const versionChange=appendDataVersionWrite(batch,[scope]);
  await batch.commit();
  await finishDataVersionChange(versionChange);
};
window._doc        = (colName,id)  => doc(db, colName, id);
window._collection = (colName)     => collection(db, colName);
window._query      = (...args)     => query(...args);
window._where      = (...args)     => where(...args);
window._orderBy    = (...args)     => orderBy(...args);
window._limit      = (count)       => limit(count);
window._startAfter = (snapshot)    => startAfter(snapshot);
window._getDoc     = (ref)         => getDoc(ref);
window._setDoc     = async (ref,data,opts) => {
  const scope=cacheScopeForReference(ref); // scope（對應資料快取範圍）
  if(!scope) return setDoc(ref,data,opts||{});
  const batch=writeBatch(db);
  if(opts) batch.set(ref,data,opts); else batch.set(ref,data);
  const versionChange=appendDataVersionWrite(batch,[scope]);
  await batch.commit();
  await finishDataVersionChange(versionChange);
};
window._increment  = (n)           => increment(n);
window._serverTimestamp = ()        => serverTimestamp();
window._deleteField = ()            => deleteField();
window._runTransaction = async (fn) => {
  let committedVersionChange=createDataVersionChange([]); // committedVersionChange（最後成功交易的資料版本異動）
  const result=await runTransaction(db,async rawTransaction=>{
    const scopes=new Set();
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
    const transactionResult=await fn(trackedTransaction); // transactionResult（功能交易回傳結果）
    committedVersionChange=appendDataVersionWrite(rawTransaction,[...scopes]);
    return transactionResult;
  });
  await finishDataVersionChange(committedVersionChange);
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
      const versionChange=appendDataVersionWrite(rawBatch,[...scopes]); // versionChange（同批資料版本異動）
      await rawBatch.commit();
      await finishDataVersionChange(versionChange);
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
      window.pcmsDataCache?.remove('employeeUserHistory'),
      window.pcmsDataCache?.remove('impHist'),
      window.pcmsDataCache?.remove('cLog')
    ]);
    try{
      localStorage.removeItem('impHist');
      localStorage.removeItem('cLog');
    }catch(e){}
    try{ localStorage.removeItem('mob_rej_read'); }catch(e){}
    if(!canLoadCostSettings()) await window.pcmsDataCache?.remove('costSettings');
    const role=window.cu?.role;
    const permissions=window.permissionSettings?.[role]; // permissions（目前角色權限）。
    if(!isAdm()&&(permissions?.costMain!==true||permissions?.costlog!==true)){
      window.cLog=[];
      await window.pcmsDataCache?.remove('cLog');
    }
    const canReadProductionEmployees = ['production-entry','production-records','production-employees','production-analysis']
      .some(pageName=>window.canOpenPage?.(pageName) === true); // canReadProductionEmployees（目前帳號可讀取產能員工）
    if(!canReadProductionEmployees) await window.pcmsDataCache?.remove('productionEmployees');
    if(window.canOpenPage?.('production-employees') !== true){
      await window.pcmsDataCache?.remove('productionDepartments');
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
  productsLoadPromise=null;
  runtimeProductsVersion='';
  runtimeProductsSequence=0;
  productsMetaMemory=null;
  productsMetaReadAt=0;
  window.lastProductReadMetrics=null;
};

onAuthStateChanged(auth, async(user)=>{
  window.firebaseAuthUser = user || null;
  if(typeof window.handleFirebaseAuthState === 'function'){
    await window.handleFirebaseAuthState(user || null);
  }
});
