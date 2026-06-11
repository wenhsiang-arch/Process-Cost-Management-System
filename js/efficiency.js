// ===== 效率報表 =====

let _effWorkH=0, _effProdH=0;

function effInit(){
  effRangeChange();
  effLoadLogs();
}

function effRangeChange(){
  const v=g('eff-range')?.value;
  const wrap=g('eff-custom-wrap');
  if(wrap) wrap.style.display=v==='custom'?'block':'none';
  if(v&&v!=='custom') effCalc();
}

function effCustomCheck(){
  const f=g('eff-from')?.value, t=g('eff-to')?.value;
  if(f&&t&&f<=t) effCalc();
}

async function effCalc(){
  const range=g('eff-range')?.value||'month';
  const now=new Date();
  let fromStr,toStr;
  if(range==='today'){
    fromStr=toStr=formatLocalDate(now);
  } else if(range==='week'){
    const d=new Date(now); d.setDate(d.getDate()-d.getDay()+1);
    fromStr=formatLocalDate(d);
    toStr=formatLocalDate(now);
  } else if(range==='month'){
    fromStr=formatLocalDate(new Date(now.getFullYear(),now.getMonth(),1));
    toStr=formatLocalDate(now);
  } else {
    fromStr=g('eff-from')?.value; toStr=g('eff-to')?.value;
    if(!fromStr||!toStr) return;
  }
  const fromTs=new Date(fromStr).getTime();
  const toTs=new Date(toStr).getTime()+86400000;

  try{
    const [repSnap,attSnap]=await Promise.all([
      window._getDocs(window._query(
        window._collection(COL.reports),
        window._where('reportDate','>=',fromStr),
        window._where('reportDate','<=',toStr)
      )),
      window._getDocs(window._query(window._collection(COL.attendance),window._where('date','>=',fromStr),window._where('date','<=',toStr)))
    ]);

    const prodH=repSnap.docs.reduce((s,d)=>{
      const r=d.data();
      if(r.status!=='approved') return s;
      const slph=r.slPerHour||(r.processSec?Math.round((window.S?.ws||3000)/r.processSec):0);
      return s+(slph>0?(r.qty||0)/slph:0);
    },0);

    const workH=attSnap.docs.reduce((s,d)=>s+(d.data().totalHours||0),0);

    _effWorkH=workH; _effProdH=prodH;

    const eff=workH>0?(prodH/workH*100):0;
    const coef=eff>0?(100/eff*100):0;
    const base=125;
    const diff=coef-base;

    g('eff-work-h').textContent=workH.toFixed(1)+' h';
    g('eff-prod-h').textContent=prodH.toFixed(1)+' h';
    g('eff-pct').textContent=workH>0?eff.toFixed(1)+'%':'-';
    g('eff-coef').textContent=workH>0?coef.toFixed(1)+'%':'-';

    const diffEl=g('eff-diff');
    if(workH>0){
      if(diff<-0.05){
        diffEl.textContent=diff.toFixed(1)+'%（節省）';
        diffEl.style.color='var(--ok)';
      } else if(diff>0.05){
        diffEl.textContent='+'+diff.toFixed(1)+'%（超支）';
        diffEl.style.color='var(--err)';
      } else {
        diffEl.textContent='0.0%（持平）';
        diffEl.style.color='var(--mu)';
      }
    } else {
      diffEl.textContent='-';
      diffEl.style.color='var(--mu)';
    }
  }catch(e){ console.error('effCalc error',e); }
}

async function effSaveLog(){
  if(!_effWorkH&&!_effProdH){ alert('請先查詢數據再建立記錄'); return; }
  const range=g('eff-range')?.value||'month';
  const now=new Date();
  let fromStr,toStr;
  if(range==='today'){
    fromStr=toStr=formatLocalDate(now);
  } else if(range==='week'){
    const d=new Date(now); d.setDate(d.getDate()-d.getDay()+1);
    fromStr=formatLocalDate(d); toStr=formatLocalDate(now);
  } else if(range==='month'){
    fromStr=formatLocalDate(new Date(now.getFullYear(),now.getMonth(),1));
    toStr=formatLocalDate(now);
  } else {
    fromStr=g('eff-from')?.value; toStr=g('eff-to')?.value;
  }
  const eff=_effWorkH>0?(_effProdH/_effWorkH*100):0;
  const coef=eff>0?(100/eff*100):0;
  const diff=coef-125;
  if(!confirm(`確認建立記錄？\n區間：${fromStr} ~ ${toStr}\n效率：${eff.toFixed(1)}%\n差異：${diff>0?'+':''}${diff.toFixed(1)}%`)) return;
  try{
    await window._addDoc(window._collection('efficiencyLogs'),{
      fromDate:fromStr, toDate:toStr,
      totalWorkHours:_effWorkH, totalProdHours:_effProdH,
      efficiency:parseFloat(eff.toFixed(2)),
      costCoef:parseFloat(coef.toFixed(2)),
      baseCoef:125,
      diffRate:parseFloat(diff.toFixed(2)),
      createdBy:window.cu.user,
      createdAt:Date.now()
    });
    alert('✅ 記錄已建立');
    effLoadLogs();
  }catch(e){ alert('建立失敗：'+e.message); }
}

async function effLoadLogs(){
  const tb=g('eff-log-tb'); if(!tb) return;
  try{
    const snap=await window._getDocs(
      window._query(window._collection('efficiencyLogs'),
        window._where('createdBy','==',window.cu.user),
        window._orderBy('createdAt','desc')
      )
    );
    if(snap.empty){ tb.innerHTML='<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--mu);font-size:13px">尚無記錄 / Chưa có lịch sử</td></tr>'; return; }
    tb.innerHTML=snap.docs.map(d=>{
      const r={id:d.id,...d.data()};
      const diff=r.diffRate||0;
      let diffBadge;
      if(diff<-0.05) diffBadge=`<span style="background:#EAF3DE;color:#27500A;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:500">${diff.toFixed(1)}%（節省）</span>`;
      else if(diff>0.05) diffBadge=`<span style="background:#FCEBEB;color:#791F1F;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:500">+${diff.toFixed(1)}%（超支）</span>`;
      else diffBadge=`<span style="background:var(--sf);color:var(--mu);padding:3px 10px;border-radius:6px;font-size:12px;font-weight:500">0.0%（持平）</span>`;
      return`<tr style="border-bottom:1px solid var(--bd)">
        <td style="padding:8px 10px;font-size:13px">${r.fromDate} ~ ${r.toDate}</td>
        <td style="padding:8px 10px;font-size:13px;text-align:right">${(r.totalWorkHours||0).toFixed(1)} h</td>
        <td style="padding:8px 10px;font-size:13px;text-align:right">${(r.totalProdHours||0).toFixed(1)} h</td>
        <td style="padding:8px 10px;font-size:13px;text-align:right">${(r.efficiency||0).toFixed(1)}%</td>
        <td style="padding:8px 10px;font-size:13px;text-align:right">${(r.costCoef||0).toFixed(1)}%</td>
        <td style="padding:8px 10px;font-size:13px;text-align:right">${(r.baseCoef||125).toFixed(1)}%</td>
        <td style="padding:8px 10px;text-align:center">${diffBadge}</td>
        <td style="padding:8px 10px;text-align:center"><button class="btn bsm bd2" onclick="effDelLog('${r.id}')"><i class="ti ti-trash"></i></button></td>
      </tr>`;
    }).join('');
  }catch(e){ console.error('effLoadLogs error',e); }
}

async function effDelLog(id){
  if(!confirm('確認刪除此記錄？')) return;
  try{
    await window._deleteDoc(window._doc('efficiencyLogs',id));
    effLoadLogs();
  }catch(e){ alert('刪除失敗：'+e.message); }
}
