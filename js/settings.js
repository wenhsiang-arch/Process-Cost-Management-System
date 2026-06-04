// ===== 成本計算 =====
function aCC(){
  if(window.S.mc) return;
  const t=((+g('ss-sal').value)||0)+((+g('ss-ins').value)||0)+((+g('ss-meal').value)||0);
  g('ss-tc').value=Math.round(t);
  if(!window.S.mh) g('ss-hr').value=Math.round(t/208);
}

function onMC(){
  const v=+g('ss-tc').value; window.S.mc=v||null;
  const tg=g('ct-tag'); tg.className=v?'mt':'at'; tg.textContent=v?'手動':'自動';
  if(!window.S.mh&&v) g('ss-hr').value=Math.round(v/208);
  rAll();
}

function onMH(){
  const v=+g('ss-hr').value; window.S.mh=v||null;
  const tg=g('ht-tag'); tg.className=v?'mt':'at'; tg.textContent=v?'手動':'自動';
  rAll();
}

function uEff(){
  window.S.eff=+g('ss-eff').value||80;
  const m=(1/(window.S.eff/100))*100, i=m-100;
  g('e-in').textContent=window.S.eff+'%';
  g('e-mu').textContent=m.toFixed(2)+'%';
  g('e-ic').textContent='+'+i.toFixed(2)+'%';
  g('e-fo').textContent='1 ÷ '+window.S.eff+'% = '+m.toFixed(2)+'%';
  rAll();
}

function rAll(){
  window.S.sal  = +g('ss-sal').value||9413769;
  window.S.ins  = +g('ss-ins').value||1686575;
  window.S.meal = +g('ss-meal').value||1008000;
  window.S.usd  = +g('ss-usd').value||25400;
  window.S.twd  = +g('ss-twd').value||780;
  window.S.ws   = +g('ss-ws').value||3000;
  aCC(); rSum(); rDet(); rExp(); rBk();
}

async function saveSt(){
  const prev={sal:window.S.sal,ins:window.S.ins,meal:window.S.meal,usd:window.S.usd,twd:window.S.twd,ws:window.S.ws,eff:window.S.eff,hr:Math.round(getH())};
  rAll(); uEff();
  const next={sal:window.S.sal,ins:window.S.ins,meal:window.S.meal,usd:window.S.usd,twd:window.S.twd,ws:window.S.ws,eff:window.S.eff,hr:Math.round(getH())};
  const lbs={sal:'平均薪資',ins:'平均保險',meal:'餐費',usd:'匯率USD',twd:'匯率TWD',ws:'工作秒數/小時',eff:'生產效率(%)',hr:'平均時薪'};
  const ch=[];
  Object.keys(lbs).forEach(k=>{
    if(prev[k]!==next[k]){
      const p=prev[k]?((next[k]-prev[k])/prev[k]*100).toFixed(1):null;
      ch.push({f:lbs[k],b:prev[k],a:next[k],p});
    }
  });
  if(ch.length>0){
    window.cLog.push({t:new Date().toLocaleString('zh-TW'),u:window.cu.user,ch});
    rClog();
    try{ localStorage.setItem('cLog',JSON.stringify(window.cLog)); }catch(e){}
    if(window.saveCostLogToFB) await saveCostLogToFB();
  }
  const n=g('st-ok'); n.style.display='flex'; setTimeout(()=>n.style.display='none',3000);
  if(window.saveSettingsToFB) await saveSettingsToFB();
}

// ===== 自動抓取匯率 =====
async function fetchRates(){
  const btn=g('btn-fetchrate'), info=g('rate-updated');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i>'; }
  if(info){ info.textContent='抓取中... / Đang tải...'; info.style.color='var(--hi)'; }
  try{
    const res=await fetch('https://open.er-api.com/v6/latest/USD');
    if(!res.ok) throw new Error('API 錯誤');
    const data=await res.json();
    if(data.result!=='success') throw new Error('資料錯誤');
    const vndPerUsd=Math.round(data.rates.VND);
    const twdPerUsd=data.rates.TWD;
    const vndPerTwd=Math.round(vndPerUsd/twdPerUsd);
    const usdEl=g('ss-usd'), twdEl=g('ss-twd');
    if(usdEl) usdEl.value=vndPerUsd;
    if(twdEl) twdEl.value=vndPerTwd;
    rAll();
    const now=new Date().toLocaleString('zh-TW');
    if(info){ info.textContent='✓ 更新於 '+now; info.style.color='var(--ok)'; }
    const infoTwd=g('rate-updated-twd');
    if(infoTwd){ infoTwd.textContent='✓ 更新於 '+now; infoTwd.style.color='var(--ok)'; }
  }catch(e){
    if(info){ info.textContent='⚠ 抓取失敗，使用手動值 / Lấy tỷ giá thất bại'; info.style.color='var(--warn)'; }
    console.error('fetchRates error:', e);
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="ti ti-refresh"></i>'; }
  }
}
