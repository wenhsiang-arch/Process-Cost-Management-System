// ===== Firebase 初始化 =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, collection, getDocs, updateDoc, deleteDoc, query, where, onSnapshot, increment, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
    failed:  {text:'🔴 同步失敗，資料暫存本機 / Đồng bộ thất bại'}
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
  el.innerHTML = `<b>⚠️ 雲端同步失敗 / Đồng bộ thất bại</b><br><span style="font-size:12px;color:#b91c1c">資料已暫存本機，請確認網路連線<br>Dữ liệu đã lưu tạm, kiểm tra kết nối mạng</span>`;
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

// ===== 掛到 window =====
window.saveProductsToFB  = () => fbSaveWithStatus("products",  window.D);
window.saveAccsToFB      = () => fbSaveWithStatus("accounts",  window.accs);
window.savePermissionsToFB = () => fbSave("permissions", window.permissionSettings);
window.saveSettingsToFB  = () => fbSaveWithStatus("settings",  window.S);
window.saveHistoryToFB   = () => fbSaveWithStatus("impHist",   window.impHist);
window.saveCostLogToFB   = () => fbSaveWithStatus("cLog",      window.cLog);

window._db         = db;
window._getDocs    = (q)           => getDocs(q);
window._addDoc     = (colRef,data) => addDoc(colRef, data);
window._updateDoc  = (ref,data)    => updateDoc(ref, data);
window._deleteDoc  = (ref)         => deleteDoc(ref);
window._doc        = (colName,id)  => doc(db, colName, id);
window._collection = (colName)     => collection(db, colName);
window._query      = (...args)     => query(...args);
window._where      = (...args)     => where(...args);
window._getDoc     = (ref)         => getDoc(ref);
window._setDoc     = (ref,data,opts) => setDoc(ref, data, opts||{});
window._increment  = (n)           => increment(n);
window._runTransaction = (fn)      => runTransaction(db, fn);
window._docRef     = (colName, id) => doc(db, colName, id);
window._onSnapshot = (...args)     => onSnapshot(...args);

// ===== 初始化 =====
async function fbInit(){
  showLoading(true);
  const [savedD, savedAccs, savedS] = await Promise.all([
    fbLoad("products"),
    fbLoad("accounts"),
    fbLoad("settings")
  ]);
  if(savedD){
    if(typeof D !== 'undefined'){ D.length=0; savedD.forEach(item=>D.push(item)); }
    window.D = savedD;
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
  if(typeof window._syncVars==='function') window._syncVars();

  // 載入記錄
  const [savedHist, savedClog] = await Promise.all([fbLoad("impHist"), fbLoad("cLog")]);
  if(savedHist&&savedHist.length>0){ window.impHist=savedHist; try{localStorage.setItem('impHist',JSON.stringify(window.impHist));}catch(e){} }
  if(savedClog&&savedClog.length>0){ window.cLog=savedClog; try{localStorage.setItem('cLog',JSON.stringify(window.cLog));}catch(e){} }

  try{
    const empSnap = await window._getDocs(window._collection('employees'));
    window.allEmployees = empSnap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){ console.error('載入員工資料失敗：', e); }

  // 即時監聽
  onSnapshot(window._doc("system","products"),(snap)=>{
    if(snap.exists()){
      try{
        const newD=JSON.parse(snap.data().data);
        if(typeof D!=='undefined'){ D.length=0; newD.forEach(item=>D.push(item)); }
        window.D=newD;
        if(typeof rSum==='function'){ rSum(); rDet(); rExp(); rBk(); }
      }catch(e){ console.error(e); }
    }
  });

}

window.addEventListener('load', ()=>setTimeout(fbInit, 300));
