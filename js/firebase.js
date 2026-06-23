// ===== Firebase 初始化 =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, collection, getDocs, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, increment, runTransaction, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

function showSyncError(){
  let el = document.getElementById('sync-err-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'sync-err-toast';
    el.style.cssText = 'position:fixed;bottom:60px;right:16px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:10px;padding:12px 16px;font-size:13px;z-index:999;max-width:280px;box-shadow:0 4px 12px rgba(0,0,0,0.1)';
    document.body.appendChild(el);
  }
  el.innerHTML = `<b>⚠️ Đồng bộ thất bại / 同步失敗</b><br><span style="font-size:12px;color:#b91c1c">Dữ liệu chính thức chưa cập nhật, dữ liệu chờ đồng bộ đã được giữ lại<br>正式資料未更新，已保留待同步資料</span>`;
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
let productsUnsubscribe=null;
let productsSnapshotTimer=null;

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

function productsSnapshotToItems(snap){
  const items=[];
  snap.docs.forEach(d=>{
    const data=d.data();
    const code=String(data.code||d.id||'').trim();
    if(!code) return;
    if(data.deleted) return;
    items.push(normalizeProductDoc(data,code));
  });
  return items.sort((a,b)=>a.code.localeCompare(b.code));
}

async function refreshProductsFromCloud(){
  const saved=await loadProductsData();
  replaceRuntimeProducts(saved);
  renderProductViews();
  return saved;
}

function startProductsListener(){
  if(productsUnsubscribe) return;
  productsUnsubscribe=onSnapshot(collection(db, PRODUCTS_COL), snap=>{
    if(loadPendingProductsSnapshot()){
      setSyncState('failed');
      showSyncError();
      return;
    }
    clearTimeout(productsSnapshotTimer);
    productsSnapshotTimer=setTimeout(()=>{
      replaceRuntimeProducts(productsSnapshotToItems(snap));
      renderProductViews();
    }, 600);
  }, e=>{
    console.error('款號即時同步失敗：', e);
    setSyncState('failed');
    showSyncError();
  });
}

async function saveProductItemsToCollection(items){
  const rows=(Array.isArray(items)?items:[]).filter(x=>String(x?.code||'').trim());
  if(!rows.length) return true;
  setSyncState('syncing');
  try{
    for(let i=0;i<rows.length;i+=400){
      const batch=writeBatch(db);
      rows.slice(i,i+400).forEach(item=>{
        const code=String(item.code).trim();
        batch.set(doc(db, PRODUCTS_COL, productDocId(code)), {
          ...item,
          code,
          ops:Array.isArray(item.ops)?item.ops:[],
          updatedAt:Date.now(),
          updatedBy:window.cu?.user||''
        }, {merge:false});
      });
      await batch.commit();
    }
    setSyncState('success');
    clearPendingProductsSnapshot();
    return true;
  }catch(e){
    console.error('Firebase product item save error:', e);
    setSyncState('failed');
    showSyncError();
    savePendingProductsSnapshot(rows);
    return false;
  }
}

async function deleteProductDoc(code){
  setSyncState('syncing');
  try{
    await deleteDoc(doc(db, PRODUCTS_COL, productDocId(code)));
    setSyncState('success');
    return true;
  }catch(e){
    console.error('刪除款號雲端文件失敗：', e);
    setSyncState('failed');
    showSyncError();
    return false;
  }
}

const PENDING_PRODUCTS_KEY = 'pcmsProductsPending';
const PENDING_PRODUCTS_AT_KEY = 'pcmsProductsPendingAt';

function savePendingProductsSnapshot(items){
  try{
    localStorage.setItem(PENDING_PRODUCTS_KEY, JSON.stringify(items||window.D||[]));
    localStorage.setItem(PENDING_PRODUCTS_AT_KEY, String(Date.now()));
    return true;
  }catch(e){
    console.error('save pending products error:', e);
    return false;
  }
}

function clearPendingProductsSnapshot(){
  try{
    localStorage.removeItem(PENDING_PRODUCTS_KEY);
    localStorage.removeItem(PENDING_PRODUCTS_AT_KEY);
  }catch(e){ console.error('clear pending products error:', e); }
}

function loadPendingProductsSnapshot(){
  try{
    const raw=localStorage.getItem(PENDING_PRODUCTS_KEY);
    if(!raw) return null;
    const data=JSON.parse(raw);
    if(!Array.isArray(data)) return null;
    return {data, savedAt:Number(localStorage.getItem(PENDING_PRODUCTS_AT_KEY)||0)};
  }catch(e){
    console.error('load pending products error:', e);
    return null;
  }
}

async function retryPendingProductsSync(){
  const pending=loadPendingProductsSnapshot();
  if(!pending) return true;
  const ok=await saveProductItemsToCollection(pending.data);
  if(!ok) return false;
  clearPendingProductsSnapshot();
  try{
    await refreshProductsFromCloud();
    return true;
  }catch(e){
    console.error('重傳後重新載入款號失敗：', e);
    setSyncState('failed');
    showSyncError();
    return false;
  }
}

// ===== 掛到 window =====
window.savePendingProductsSnapshot = savePendingProductsSnapshot;
window.clearPendingProductsSnapshot = clearPendingProductsSnapshot;
window.retryPendingProductsSync = retryPendingProductsSync;
window.loadProductsData = loadProductsData;
window.refreshProductsFromCloud = refreshProductsFromCloud;
window.saveProductItemsToFB = saveProductItemsToCollection;
window.deleteProductFromFB = deleteProductDoc;
window.saveAccsToFB      = () => fbSaveWithStatus("accounts",  window.accs);
window.savePermissionsToFB = () => fbSave("permissions", window.permissionSettings);
window.saveSettingsToFB  = () => fbSaveWithStatus("settings",  window.S);
window.saveHistoryToFB   = () => fbSaveWithStatus("impHist",   window.impHist);
window.saveCostLogToFB   = () => fbSaveWithStatus("cLog",      window.cLog);
window.employeeUserHistory = {};

window._db         = db;
window._getDocs    = (q)           => getDocs(q);
window._addDoc     = (colRef,data) => addDoc(colRef, data);
window._updateDoc  = (ref,data)    => updateDoc(ref, data);
window._deleteDoc  = (ref)         => deleteDoc(ref);
window._doc        = (colName,id)  => doc(db, colName, id);
window._collection = (colName)     => collection(db, colName);
window._query      = (...args)     => query(...args);
window._where      = (...args)     => where(...args);
window._orderBy    = (...args)     => orderBy(...args);
window._getDoc     = (ref)         => getDoc(ref);
window._setDoc     = (ref,data,opts) => setDoc(ref, data, opts||{});
window._increment  = (n)           => increment(n);
window._runTransaction = (fn)      => runTransaction(db, fn);
window._writeBatch     = ()        => writeBatch(db);
window._docRef     = (colName, id) => doc(db, colName, id);
window._newDocRef  = (colName)     => doc(collection(db, colName));
window._onSnapshot = (...args)     => onSnapshot(...args);

// ===== 初始化 =====
async function fbInit(){
  showLoading(true);
  const [savedD, savedAccs, savedS, savedEmployeeUserHistory] = await Promise.all([
    loadProductsData(),
    fbLoad("accounts"),
    fbLoad("settings"),
    fbLoad("employeeUserHistory")
  ]);
  window.employeeUserHistory=savedEmployeeUserHistory&&typeof savedEmployeeUserHistory==='object'&&!Array.isArray(savedEmployeeUserHistory)
    ? savedEmployeeUserHistory
    : Object.fromEntries((Array.isArray(savedEmployeeUserHistory)?savedEmployeeUserHistory:[]).map(user=>[user,true]));
  if(savedD) replaceRuntimeProducts(savedD);
  const pendingProducts=loadPendingProductsSnapshot();
  if(pendingProducts){
    setSyncState('failed');
    showSyncError();
    console.warn('偵測到待同步款號資料，未自動套用為正式資料。');
  }
  if(savedAccs){
    if(typeof accs !== 'undefined'){ accs.length=0; savedAccs.forEach(item=>accs.push(item)); }
    window.accs = savedAccs;
  }
  if(savedS){
    if(typeof S !== 'undefined') Object.assign(S, savedS);
    window.S = {...window.S, ...savedS};
    const fields = {
      'ss-sal':window.S.sal,'ss-ins':window.S.ins,'ss-meal':window.S.meal,
      'ss-usd':window.S.usd,'ss-twd':window.S.twd,'ss-ws':window.S.ws,'ss-eff':window.S.eff
    };
    Object.entries(fields).forEach(([id,val])=>{ const el=document.getElementById(id); if(el) el.value=val; });
    if(window.S.mc){ const el=document.getElementById('ss-tc'); if(el) el.value=window.S.mc; }
    if(window.S.mh){ const el=document.getElementById('ss-hr'); if(el) el.value=window.S.mh; }
  }
  showLoading(false);
  // 載入記錄
  const [savedHist, savedClog] = await Promise.all([fbLoad("impHist"), fbLoad("cLog")]);
  if(savedHist&&savedHist.length>0){ window.impHist=savedHist; try{localStorage.setItem('impHist',JSON.stringify(window.impHist));}catch(e){} }
  if(savedClog&&savedClog.length>0){ window.cLog=savedClog; try{localStorage.setItem('cLog',JSON.stringify(window.cLog));}catch(e){} }

  try{
    const empSnap = await window._getDocs(window._collection('employees'));
    window.allEmployees = empSnap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){ console.error('載入員工資料失敗：', e); }

  // 新架構只讀寫 products collection，避免舊整包款號資料影響正式畫面。
  startProductsListener();

}

window.addEventListener('load', ()=>setTimeout(fbInit, 300));
