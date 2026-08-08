// ===== 成本計算 =====
// canEditCostSettings（可編輯成本設定）：管理員或已開放成本設定分頁的職務。
function canEditCostSettings(){
  return typeof canOpenPage==='function'&&canOpenPage('settings');
}
function settingsMessage(vi,zh,kind='info'){
  return window.PCMSUIComponents.alertDialog({message:{vi:String(vi||''),zh:String(zh||'')},kind});
}
function setSettingsStatus(element,vi,zh,color){
  if(!element) return;
  element.replaceChildren(window.PCMSUIText.create({vi,zh}));
  if(color) element.style.color=color;
}

function setRateUpdatedStatus(element,timestamp,color){
  if(!element) return;
  const label=window.PCMSUIText.create({vi:'Cập nhật',zh:'更新'}); // label（雙語更新標籤）
  const time=document.createElement('span'); // time（共用更新時間）
  time.className='settings-rate-time';
  time.textContent=`：${String(timestamp||'')}`;
  element.replaceChildren(label,time);
  if(color) element.style.color=color;
}

const SETTINGS_GROUPED_NUMBER_IDS=Object.freeze([
  'ss-sal','ss-ins','ss-meal','ss-tc','ss-hr','ss-usd','ss-twd'
]); // SETTINGS_GROUPED_NUMBER_IDS（使用千分位顯示的設定欄位識別碼）
const SETTINGS_POSITIVE_NUMBER_IDS=Object.freeze([
  'ss-sal','ss-ins','ss-meal','ss-tc','ss-hr','ss-usd','ss-twd','ss-ws','ss-eff'
]); // SETTINGS_POSITIVE_NUMBER_IDS（儲存時必須大於零的設定欄位識別碼）
const SETTINGS_POSITIVE_ERROR=Object.freeze({
  vi:'Giá trị phải là số lớn hơn 0.',
  zh:'數值必須大於 0。'
}); // SETTINGS_POSITIVE_ERROR（設定欄位正數驗證訊息）

function parseSettingNumberValue(value){
  const normalized=String(value??'').replace(/,/g,'').trim(); // normalized（移除千分位後的純數字文字）
  if(!normalized) return Number.NaN;
  return Number(normalized);
}

function sanitizeSettingNumberInput(element){
  if(!element) return;
  element.value=String(element.value||'').replace(/[^0-9]/g,'');
  if(isPositiveSettingNumber(element.value)) clearSettingFieldError(element);
}

function formatSettingNumberValue(value){
  const number=parseSettingNumberValue(value); // number（準備顯示的數值）
  if(!Number.isFinite(number)) return '';
  return Math.round(number).toLocaleString('en-US'); // en-US（使用逗號作為千分位的數字格式）
}

function writeSettingNumberValue(id,value){
  const element=g(id); // element（設定欄位）
  if(!element) return;
  if(SETTINGS_GROUPED_NUMBER_IDS.includes(id)&&document.activeElement!==element){
    element.value=formatSettingNumberValue(value);
    return;
  }
  element.value=String(value??'');
}

function formatSettingGroupedField(element){
  if(!element) return;
  const formatted=formatSettingNumberValue(element.value); // formatted（含千分位的顯示文字）
  if(formatted) element.value=formatted;
}

function formatSettingGroupedFields(){
  SETTINGS_GROUPED_NUMBER_IDS.forEach(id=>{
    const element=g(id); // element（本次要格式化的欄位）
    if(element&&document.activeElement!==element) formatSettingGroupedField(element);
  });
}

function beginSettingNumberEdit(element){
  if(!element) return;
  element.value=String(element.value||'').replace(/,/g,'');
}

function finishSettingNumberEdit(element){
  if(!element) return;
  if(validateSettingNumberField(element,true)) formatSettingGroupedField(element);
}

function isPositiveSettingNumber(value){
  const number=parseSettingNumberValue(value); // number（準備驗證的設定數值）
  return Number.isFinite(number)&&number>0;
}

function clearSettingFieldError(element){
  if(!element) return;
  element.removeAttribute('aria-invalid');
  const host=element.closest('.settings-matrix-value'); // host（設定欄位外框）
  if(!host) return;
  host.classList.remove('is-invalid');
  host.querySelector('.settings-field-error')?.remove();
}

function showSettingFieldError(element){
  if(!element) return;
  const host=element.closest('.settings-matrix-value'); // host（設定欄位外框）
  if(!host) return;
  element.setAttribute('aria-invalid','true');
  host.classList.add('is-invalid');
  let error=host.querySelector('.settings-field-error'); // error（欄位驗證訊息）
  if(!error){
    error=document.createElement('div');
    error.className='settings-field-error';
    error.appendChild(window.PCMSUIText.create(SETTINGS_POSITIVE_ERROR));
    host.appendChild(error);
  }
}

function validateSettingNumberField(element,showError=false){
  const valid=isPositiveSettingNumber(element?.value); // valid（欄位是否為有效正數）
  if(valid) clearSettingFieldError(element);
  else if(showError) showSettingFieldError(element);
  return valid;
}

function validateAllSettingNumbers(){
  let firstInvalid=null; // firstInvalid（第一個無效設定欄位）
  SETTINGS_POSITIVE_NUMBER_IDS.forEach(id=>{
    const element=g(id); // element（目前驗證的設定欄位）
    if(element&&!validateSettingNumberField(element,true)&&!firstInvalid) firstInvalid=element;
  });
  firstInvalid?.focus();
  return !firstInvalid;
}

function readPositiveSettingNumber(id){
  const element=g(id); // element（正數設定欄位）
  const value=parseSettingNumberValue(element?.value); // value（欄位目前數值）
  return Number.isFinite(value)&&value>0?value:null;
}

function aCC(){
  const values=['ss-sal','ss-ins','ss-meal'].map(readPositiveSettingNumber); // values（人事成本欄位數值）
  if(values.some(value=>value===null)) return;
  const t=values.reduce((sum,value)=>sum+value,0); // t（每月人事總成本）
  if(!window.S.mc&&document.activeElement!==g('ss-tc')) writeSettingNumberValue('ss-tc',Math.round(t));
  if(!window.S.mh&&document.activeElement!==g('ss-hr')) writeSettingNumberValue('ss-hr',Math.round(t/208));
}

function onMC(){
  const v=readPositiveSettingNumber('ss-tc');
  if(v===null) return;
  window.S.mc=v;
  const tg=g('ct-tag'); tg.className=v?'mt':'at'; tg.innerHTML=v?'Thủ công<br>手動':'Tự động<br>自動';
  if(!window.S.mh&&v) writeSettingNumberValue('ss-hr',Math.round(v/208));
  rAll();
}

function onMH(){
  const v=readPositiveSettingNumber('ss-hr');
  if(v===null) return;
  window.S.mh=v;
  const tg=g('ht-tag'); tg.className=v?'mt':'at'; tg.innerHTML=v?'Thủ công<br>手動':'Tự động<br>自動';
  rAll();
}

function uEff(){
  rAll();
}

function updateEfficiencySummary(){
  const efficiency=readPositiveSettingNumber('ss-eff'); // efficiency（實際生產效率）
  const workSeconds=readPositiveSettingNumber('ss-ws'); // workSeconds（每小時實際工作秒數）
  const efficiencyText=efficiency===null?'—':`${Number(efficiency.toFixed(2))}%`; // efficiencyText（效率摘要文字）
  const multiplier=efficiency===null?null:100/efficiency; // multiplier（報價成本倍數）
  const effectiveMinutes=efficiency===null||workSeconds===null?null:(workSeconds*(efficiency/100))/60; // effectiveMinutes（每小時預估有效生產分鐘）
  g('e-in').textContent=efficiencyText;
  g('e-mu').textContent=multiplier===null?'—':`${(multiplier*100).toFixed(2)}%`;
  g('e-time').textContent=effectiveMinutes===null?'—':effectiveMinutes.toFixed(1);
}

function rAll(){
  // 沒有成本設定分頁權限時，不得從隱藏欄位覆蓋已授權載入的 S（系統計算設定）。
  if(!canEditCostSettings()){
    rSum(); rDet(); rExp(); rBk();
    return;
  }
  const fields={sal:'ss-sal',ins:'ss-ins',meal:'ss-meal',usd:'ss-usd',twd:'ss-twd',ws:'ss-ws',eff:'ss-eff'}; // fields（畫面欄位與成本設定對應）
  Object.entries(fields).forEach(([key,id])=>{
    const value=readPositiveSettingNumber(id); // value（目前有效設定值）
    if(value!==null){
      window.S[key]=value;
      clearSettingFieldError(g(id));
    }
  });
  aCC();
  formatSettingGroupedFields();
  updateEfficiencySummary();
  rSum(); rDet(); rExp(); rBk();
}

async function saveSt(){
  if(!canEditCostSettings()){
    await settingsMessage('Không có quyền cài đặt chi phí.','沒有成本設定權限。','warning');
    return false;
  }
  if(!validateAllSettingNumbers()) return false;
  const prevS={...window.S};
  const prevClog=Array.isArray(window.cLog)?window.cLog.map(log=>({...log})):[];
  const prev={sal:prevS.sal,ins:prevS.ins,meal:prevS.meal,usd:prevS.usd,twd:prevS.twd,ws:prevS.ws,eff:prevS.eff,hr:Math.round(getH())};
  rAll();
  const next={sal:window.S.sal,ins:window.S.ins,meal:window.S.meal,usd:window.S.usd,twd:window.S.twd,ws:window.S.ws,eff:window.S.eff,hr:Math.round(getH())};
  const nextS={...window.S};
  const lbs={sal:'平均薪資',ins:'平均保險',meal:'餐費',usd:'匯率USD',twd:'匯率TWD',ws:'工作秒數/小時',eff:'生產效率(%)',hr:'平均時薪'};
  const ch=[];
  Object.keys(lbs).forEach(k=>{
    if(prev[k]!==next[k]){
      const p=prev[k]?((next[k]-prev[k])/prev[k]*100).toFixed(1):null;
      ch.push({f:lbs[k],b:prev[k],a:next[k],p});
    }
  });
  try{
    window.S=nextS;
    if(window.saveSettingsToFB){
      const okSettings=await saveSettingsToFB();
      if(!okSettings) throw new Error('settings');
    }
    let savedLog=null;
    if(ch.length>0&&window.saveCostLogToFB){
      try{
        savedLog=await saveCostLogToFB({changes:ch});
      }catch(logError){
        console.error('Không thể lưu operationLogs / 無法儲存操作紀錄：',logError);
      }
    }
    window.cLog=savedLog?[savedLog,...prevClog].slice(0,50):prevClog;
    if(ch.length>0){
      rClog();
    }
    rAll();
    window.PCMSUIComponents.showToast({kind:'success',text:{vi:'Đã lưu cài đặt.',zh:'設定已儲存。'}});
    if(ch.length>0&&!savedLog){
      await settingsMessage('Đã lưu cài đặt, nhưng không thể lưu lịch sử thao tác.','設定已儲存，但操作紀錄無法保存。','warning');
    }
  }catch(e){
    window.S=prevS;
    window.cLog=prevClog;
    rAll(); rClog();
    await settingsMessage('Lưu cài đặt thất bại, vui lòng kiểm tra mạng rồi thử lại.','儲存設定失敗，請確認網路後再試一次。','danger');
  }
}

// ===== 自動抓取匯率 =====
async function fetchRates(){
  if(!canEditCostSettings()) return;
  const btn=g('btn-fetchrate'), info=g('rate-updated');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i>'; }
  setSettingsStatus(info,'Đang tải...','抓取中...','var(--hi)');
  try{
    const res=await fetch('https://open.er-api.com/v6/latest/USD');
    if(!res.ok) throw new Error('API 錯誤');
    const data=await res.json();
    if(data.result!=='success') throw new Error('資料錯誤');
    const vndPerUsd=Math.round(data.rates.VND);
    const twdPerUsd=data.rates.TWD;
    const vndPerTwd=Math.round(vndPerUsd/twdPerUsd);
    writeSettingNumberValue('ss-usd',vndPerUsd);
    writeSettingNumberValue('ss-twd',vndPerTwd);
    rAll();
    const now=new Date().toLocaleString('zh-TW',{hour12:false});
    setRateUpdatedStatus(info,now,'var(--ok)');
  }catch(e){
    setSettingsStatus(info,'Lỗi cập nhật; giữ giá trị hiện tại.','更新失敗，保留目前數值。','var(--warn)');
    console.error('fetchRates error:', e);
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="ti ti-refresh"></i>'; }
  }
}
