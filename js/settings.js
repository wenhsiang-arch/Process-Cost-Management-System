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

function parseSettingNumberValue(value){
  const normalized=String(value??'').replace(/,/g,'').trim(); // normalized（移除千分位後的純數字文字）
  if(!normalized) return Number.NaN;
  return Number(normalized);
}

function sanitizeSettingNumberInput(element){
  if(!element) return;
  element.value=String(element.value||'').replace(/[^0-9]/g,'');
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
  formatSettingGroupedField(element);
}

function readSettingNumber(id,fallback,min=0,max=null,writeBack=false){
  const el=g(id);
  let v=parseSettingNumberValue(el?.value);
  if(!Number.isFinite(v)||v<min) v=fallback;
  if(max!==null&&v>max) v=max;
  if(writeBack&&el) writeSettingNumberValue(id,v);
  return v;
}
function aCC(){  if(window.S.mc) return;
  const t=(parseSettingNumberValue(g('ss-sal').value)||0)+(parseSettingNumberValue(g('ss-ins').value)||0)+(parseSettingNumberValue(g('ss-meal').value)||0);
  writeSettingNumberValue('ss-tc',Math.round(t));
  if(!window.S.mh) writeSettingNumberValue('ss-hr',Math.round(t/208));
}

function onMC(){
  const v=parseSettingNumberValue(g('ss-tc').value); window.S.mc=v||null;
  const tg=g('ct-tag'); tg.className=v?'mt':'at'; tg.innerHTML=v?'Thủ công<br>手動':'Tự động<br>自動';
  if(!window.S.mh&&v) writeSettingNumberValue('ss-hr',Math.round(v/208));
  rAll();
}

function onMH(){
  const v=parseSettingNumberValue(g('ss-hr').value); window.S.mh=v||null;
  const tg=g('ht-tag'); tg.className=v?'mt':'at'; tg.innerHTML=v?'Thủ công<br>手動':'Tự động<br>自動';
  rAll();
}

function uEff(){
  window.S.eff=readSettingNumber('ss-eff',80,1,100,true);
  const m=(1/(window.S.eff/100))*100, i=m-100;
  g('e-in').textContent=window.S.eff+'%';
  g('e-mu').textContent=m.toFixed(2)+'%';
  g('e-ic').textContent='+'+i.toFixed(2)+'%';
  g('e-fo').textContent='1 ÷ '+window.S.eff+'% = '+m.toFixed(2)+'%';
  rAll();
}

function rAll(){
  // 沒有成本設定分頁權限時，不得從隱藏欄位覆蓋已授權載入的 S（系統計算設定）。
  if(!canEditCostSettings()){
    rSum(); rDet(); rExp(); rBk();
    return;
  }
  window.S.sal  = readSettingNumber('ss-sal',0,0,null,false);
  window.S.ins  = readSettingNumber('ss-ins',0,0,null,false);
  window.S.meal = readSettingNumber('ss-meal',0,0,null,false);
  window.S.usd  = readSettingNumber('ss-usd',window.S.usd||25400,1,null,true);
  window.S.twd  = readSettingNumber('ss-twd',window.S.twd||780,1,null,true);
  window.S.ws   = readSettingNumber('ss-ws',window.S.ws||3000,1,null,true);
  aCC(); formatSettingGroupedFields(); rSum(); rDet(); rExp(); rBk();
}

async function saveSt(){
  if(!canEditCostSettings()){
    await settingsMessage('Không có quyền cài đặt chi phí.','沒有成本設定權限。','warning');
    return false;
  }
  const prevS={...window.S};
  const prevClog=Array.isArray(window.cLog)?window.cLog.map(log=>({...log})):[];
  const prev={sal:prevS.sal,ins:prevS.ins,meal:prevS.meal,usd:prevS.usd,twd:prevS.twd,ws:prevS.ws,eff:prevS.eff,hr:Math.round(getH())};
  rAll(); uEff();
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
    rAll(); uEff();
    const n=g('st-ok'); n.style.display='flex'; setTimeout(()=>n.style.display='none',3000);
    if(ch.length>0&&!savedLog){
      await settingsMessage('Đã lưu cài đặt, nhưng không thể lưu lịch sử thao tác.','設定已儲存，但操作紀錄無法保存。','warning');
    }
  }catch(e){
    window.S=prevS;
    window.cLog=prevClog;
    rAll(); uEff(); rClog();
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
