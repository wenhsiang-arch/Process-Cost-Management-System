window.mobPendingUnsub = null;

function startMobPendingListener(){
  if(window.mobPendingUnsub) return;
  window.mobPendingUnsub = window._onSnapshot(
    window._query(window._collection(COL.reports), window._where('status','==','pending')),
    (snap) => {
      mobPending = snap.docs.map(d=>({id:d.id,...d.data()}));
      mobPending.sort((a,b)=>b.createdAt-a.createdAt);
      const bdg = mG('mob-apv-badge'), n = mobPending.length;
      if(bdg){ bdg.textContent=n; bdg.style.display=n>0?'flex':'none'; }
      const apvPg = mG('mob-pg-apv');
      if(apvPg && apvPg.style.display!=='none') mobRenderApv();
    },
    (e) => { console.error('mobPendingListener error:', e); mobToast('❌ 監聽失敗：'+e.message); }
  );
}

// ===== 手機版資料 =====
let myReports=[], mobPending=[], procList=[], mobHistFilter='all', currentProcId=null;

// ===== 啟動手機版 =====
function startMobile(user){
  const mob=g('mob');
  mob.style.display='flex';
  const appEl = document.querySelector('#ma .app');
  if(appEl) appEl.style.display = 'none';
  const initials=(user.name||user.user).split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  g('mob-av').textContent=initials;
  g('mob-name').textContent=user.name||user.user;
  g('mob-info').textContent='Bộ phận: '+(DEPTS[user.dept||'']||user.dept||'')+'  ·  Chức vụ: '+(user.role==='leader'?'Tổ trưởng':'Nhân viên');
  if(user.role==='leader'){
    const t=g('mob-tab-apv'); if(t) t.style.display='flex';
  }
  mobLoadOrders();
  mobLoadMyReports();
  if(user.role==='leader') startMobPendingListener();
}

// ===== 頁面切換 =====
function mobPage(pid){
  ['mob-pg-report','mob-pg-hist','mob-pg-apv'].forEach(id=>{
    const el=mG(id); if(el) el.style.display='none';
  });
  const pg=mG(pid); if(pg) pg.style.display='block';
  const tabs={'mob-pg-report':'mob-tab-report','mob-pg-hist':'mob-tab-hist','mob-pg-apv':'mob-tab-apv'};
  Object.entries(tabs).forEach(([p,tab])=>{
    const t=mG(tab); if(!t) return;
    const active=pid===p;
    const icon=t.querySelector('i'), label=t.querySelector('span');
    if(icon) icon.style.color=active?'var(--navy)':'var(--hi)';
    if(label){ label.style.color=active?'var(--navy)':'var(--hi)'; label.style.fontWeight=active?'600':'400'; }
  });
  if(pid==='mob-pg-hist') mobRenderHist();
  if(pid==='mob-pg-apv') mobLoadPending();
}

function mobSaveHours(){
  localStorage.setItem('wh_'+new Date().toDateString(), mG('mob-hours').value);
}

// ===== 載入訂單 =====
async function mobLoadOrders(){
  try{
    const snap=await window._getDocs(window._collection(COL.orders));
    const orders=snap.docs.map(d=>({id:d.id,...d.data()}));
    orders.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    const sel=mG('mob-sel-order');
    sel.innerHTML='<option value="">-- Chọn đơn hàng --</option>';
    orders.forEach(o=>{
      const opt=document.createElement('option');
      opt.value=o.id;
      opt.textContent=o.orderId+' · '+fmtVN(o.dueDate);
      sel.appendChild(opt);
    });
  }catch(e){
    console.error('mobile error:',e);
    mobToast('❌ '+(e.message||'操作失敗，請重試'));
  }
}

async function mobSelectOrder(){
  const ordId=mG('mob-sel-order').value;
  mG('mob-sel-code').innerHTML='<option value="">-- Chọn mã hàng --</option>';
  mG('mob-sel-proc').innerHTML='<option value="">-- Chọn công đoạn --</option>';
  mG('mob-proc-info').style.display='none';
  currentProcId=null;
  if(!ordId) return;
  try{
    const snap=await window._getDocs(window._query(window._collection(COL.processes),window._where('orderId','==',ordId)));
    procList=snap.docs.map(d=>({id:d.id,...d.data()}));
    const codes=[...new Set(procList.map(p=>p.code))].sort();
    const sel=mG('mob-sel-code');
    codes.forEach(c=>{
      const p=procList.find(x=>x.code===c);
      const opt=document.createElement('option'); opt.value=c;
      opt.textContent=c+(p&&p.color?' · '+p.color:'')+(p&&p.sz?' · '+p.sz:'');
      sel.appendChild(opt);
    });
  }catch(e){
    console.error('mobile error:',e);
    mobToast('❌ '+(e.message||'操作失敗，請重試'));
  }
}

function mobSelectCode(){
  const code=mG('mob-sel-code').value;
  mG('mob-sel-proc').innerHTML='<option value="">-- Chọn công đoạn --</option>';
  mG('mob-proc-info').style.display='none';
  currentProcId=null;
  if(!code) return;
  const procs=procList.filter(p=>p.code===code);
  procs.sort((a,b)=>String(a.processNo).localeCompare(String(b.processNo)));
  const sel=mG('mob-sel-proc');
  procs.forEach(p=>{
    const opt=document.createElement('option'); opt.value=p.id;
    opt.textContent=p.processNo+' · '+(p.processVi||p.processZh);
    sel.appendChild(opt);
  });
}

function mobSelectProc(){
  const id=mG('mob-sel-proc').value;
  mG('mob-proc-info').style.display='none';
  currentProcId=null;
  if(!id) return;
  currentProcId=id;
  const p=procList.find(x=>x.id===id); if(!p) return;
  const apv=p.approvedQty||0, pnd=p.pendingQty||0, qty=p.orderQty||0;
  const prog=qty>0?Math.min(Math.round(apv/qty*100),100):0;
  mG('mob-info-qty').textContent=qty.toLocaleString();
  mG('mob-info-prog').style.width=prog+'%';
  mG('mob-info-prog-text').textContent='Đã hoàn thành '+apv.toLocaleString()+' / Còn '+Math.max(0,qty-apv-pnd).toLocaleString();
  mG('mob-info-pending').textContent=(pnd).toLocaleString();
  mG('mob-info-approved').textContent='Đã duyệt：'+apv.toLocaleString();
  mG('mob-proc-info').style.display='block';
  mG('mob-qty').value='';
}

// ===== 送出報工 =====
async function mobSubmitReport(){
  const qty=parseInt(mG('mob-qty').value);
  if(!currentProcId){ mobToast('⚠️ Vui lòng chọn công đoạn / 請選擇工序'); return; }
  if(!qty||qty<=0){ mobToast('⚠️ Vui lòng nhập số lượng / 請輸入數量'); return; }
  const p=procList.find(x=>x.id===currentProcId); if(!p) return;
  const remain=(p.orderQty||0)-(p.approvedQty||0)-(p.pendingQty||0);
  if(qty>remain){
    mobToast(`⚠️ Chỉ còn ${remain} SP / 此工序剩餘可報 ${remain} 件，本次 ${qty} 件超過`);
    return;
  }
  try{
    const procRef=window._docRef(COL.processes,currentProcId);
    const newRepRef=window._docRef(COL.reports,Date.now()+'_'+(window.cu.id||window.cu.user));
    await window._runTransaction(async(t)=>{
      const procSnap=await t.get(procRef);
      if(!procSnap.exists()) throw new Error('工序不存在');
      const pd=procSnap.data();
      const realRemain=(pd.orderQty||0)-(pd.approvedQty||0)-(pd.pendingQty||0);
      if(qty>realRemain) throw new Error(`Vui lòng báo tối đa ${realRemain} SP / 剩餘可報 ${realRemain} 件，本次 ${qty} 件超過訂單數量`);
      t.set(newRepRef,{
        empId:window.cu.id||window.cu.user, empName:window.cu.name||window.cu.user, empDept:window.cu.dept||'',
        orderId:p.orderId, orderNo:p.orderNo||'', code:p.code,
        processNo:p.processNo, processVi:p.processVi||p.processZh,
        processSec:p.processSec||0, slPerHour:p.slPerHour||0,
        qty, status:'pending', createdAt:Date.now()
      });
      t.update(procRef,{pendingQty:window._increment(qty)});
    });
    p.pendingQty=(p.pendingQty||0)+qty;
    mobSelectProc();
    mG('mob-qty').value='';
    const now=new Date();
    const last=mG('mob-last-submit');
    if(last){
      last.style.display='block';
      last.textContent='Gửi lần cuối：'+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    }
    mobToast('✅ Báo công thành công / 報工成功');
  }catch(e){
    mobToast('❌ '+(e.message||'報工失敗，請重試'));
  }
}

// ===== 我的報工記錄 =====
async function mobLoadMyReports(){
  try{
    const d45=new Date(); d45.setDate(d45.getDate()-45);
    const from45=d45.getTime();
    const snap=await window._getDocs(window._query(window._collection(COL.reports),window._where('empId','==',window.cu.id||window.cu.user),window._where('createdAt','>=',from45)));
    myReports=snap.docs.map(d=>({id:d.id,...d.data()}));
    myReports.sort((a,b)=>b.createdAt-a.createdAt);
    const rej=myReports.filter(r=>r.status==='rejected').length;
    const alert=mG('mob-reject-alert'), bell=mG('mob-bell'), at=mG('mob-reject-alert-text');
    if(rej>0){
      if(alert){ alert.style.display='flex'; if(at) at.textContent=rej+' báo công bị từ chối / '+rej+'筆報工被退回'; }
      if(bell){ bell.textContent=rej; bell.style.display='flex'; }
    } else {
      if(alert) alert.style.display='none';
      if(bell) bell.style.display='none';
    }
    mobRenderHist();
  }catch(e){ console.error('mobLoadMyReports',e); }
}

function mobBellClick(){
  mobPage('mob-pg-hist');
  mobFilterHist('rejected');
  const bell=mG('mob-bell');
  if(bell){ bell.style.display='none'; }
  const alert=mG('mob-reject-alert');
  if(alert){ alert.style.display='none'; }
}

function mobFilterHist(f){
  mobHistFilter=f;
  ['all','approved','pending','rejected','voided'].forEach(x=>{
    const el=mG('mob-flt-'+x); if(!el) return;
    const active=x===f;
    el.style.background=active?'var(--navy)':'transparent';
    el.style.color=active?'#fff':'var(--mu)';
    el.style.fontWeight=active?'600':'400';
  });
  mobRenderHist();
}

function mobRenderHist(){
  const list=mG('mob-hist-list'); if(!list) return;
  let data=[...myReports];
  if(mobHistFilter!=='all') data=data.filter(r=>r.status===mobHistFilter);
  if(!data.length){
    list.innerHTML='<div style="text-align:center;padding:40px;color:var(--hi)"><i class="ti ti-clipboard-off" style="font-size:32px;display:block;margin-bottom:8px"></i>尚無記錄</div>';
    return;
  }
  const barColor={approved:'#22c55e',pending:'#f59e0b',rejected:'#ef4444',voided:'#9ca3af'};
  const bdgStyle={approved:'background:var(--okl);color:var(--ok)',pending:'background:var(--warnl);color:var(--warn)',rejected:'background:var(--errl);color:var(--err)',voided:'background:#f3f4f6;color:#6b7280'};
  const bdgText={approved:'Đã duyệt',pending:'Chờ duyệt',rejected:'Từ chối',voided:'Đã hủy'};
  list.innerHTML=data.map(r=>{
    const rb=r.status==='rejected'&&r.rejectReason?`<div style="background:var(--errl);border-radius:8px;padding:7px 10px;margin-top:7px;display:flex;gap:6px"><i class="ti ti-info-circle" style="color:var(--err);font-size:13px;flex-shrink:0"></i><span style="font-size:11px;color:#7f1d1d;line-height:1.4">Lý do: ${r.rejectReason}</span></div>`:'';
    const mb=r.isManualEntry?`<div style="margin-top:5px"><span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:99px;background:#ede9fe;color:#7c3aed">Bổ sung</span></div>`:'';
    return`<div style="background:var(--sf);border-radius:12px;margin-bottom:7px;overflow:hidden;display:flex;border:1px solid var(--bd)">
      <div style="width:4px;flex-shrink:0;background:${barColor[r.status]||'#94a3b8'}"></div>
      <div style="flex:1;padding:10px 11px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px">
          <div>
            <div style="font-size:13px;color:var(--tx);font-weight:600">${r.processNo} · ${r.processVi||''}</div>
            <div style="font-size:11px;color:var(--hi);margin-top:3px;line-height:1.5">${r.code} · ${r.orderNo||''}<br>${fmtTimeVN(r.createdAt)} · ${(r.qty||0).toLocaleString()} PCS</div>
          </div>
          <span style="display:inline-flex;padding:3px 8px;border-radius:99px;font-size:10px;font-weight:600;white-space:nowrap;flex-shrink:0;${bdgStyle[r.status]||''}">${bdgText[r.status]||r.status}</span>
        </div>
        ${rb}${mb}
      </div>
      <i class="ti ti-chevron-right" style="color:var(--bd);font-size:14px;align-self:center;margin-right:10px;flex-shrink:0"></i>
    </div>`;
  }).join('');
}

// ===== 班長審批（手機版）=====
async function mobLoadPending(){
  try{
    const snap=await window._getDocs(window._query(window._collection(COL.reports),window._where('status','==','pending')));
    mobPending=snap.docs.map(d=>({id:d.id,...d.data()}));
    mobPending.sort((a,b)=>b.createdAt-a.createdAt);
    mobRenderApv();
    const bdg=mG('mob-apv-badge'), n=mobPending.length;
    if(bdg){ bdg.textContent=n; bdg.style.display=n>0?'flex':'none'; }
  }catch(e){
    console.error('mobile error:',e);
    mobToast('❌ '+(e.message||'操作失敗，請重試'));
  }
}

function mobRenderApv(){
  const list=mG('mob-apv-list'); if(!list) return;
  if(!mobPending.length){
    list.innerHTML='<div style="text-align:center;padding:40px;color:var(--hi)"><i class="ti ti-check-circle" style="font-size:32px;display:block;margin-bottom:8px"></i>沒有待審批</div>';
    return;
  }
  list.innerHTML=mobPending.map(r=>`
    <div style="background:var(--sf);border-radius:12px;margin-bottom:7px;border:1px solid var(--bd);overflow:hidden">
      <div style="padding:10px 12px;display:flex;align-items:flex-start;gap:10px">
        <div id="mchk-${r.id}" onclick="mobToggleChk('${r.id}')" style="width:20px;height:20px;border-radius:5px;border:1.5px solid var(--bd);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center"></div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--tx)">${r.empName||r.empId} <span style="font-size:11px;color:var(--hi)">· ${DEPTS[r.empDept||'']||r.empDept||''}</span></div>
          <div style="font-size:11px;color:var(--hi);margin-top:3px;line-height:1.5">${r.orderNo||''} · ${r.code||''}<br>${r.processNo} · ${r.processVi||''}<br>${fmtTimeVN(r.createdAt)}</div>
        </div>
        <div style="font-size:15px;font-weight:700;color:var(--navy);white-space:nowrap">${(r.qty||0).toLocaleString()} PCS</div>
      </div>
      <div style="padding:8px 12px;border-top:1px solid var(--bd);display:flex;gap:6px">
        <button onclick="mobPassOne('${r.id}')" style="flex:1;padding:8px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:var(--okl);color:var(--ok);display:flex;align-items:center;justify-content:center;gap:4px"><i class="ti ti-check"></i> Duyệt</button>
        <button onclick="mobRejectOne('${r.id}')" style="flex:1;padding:8px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:var(--errl);color:var(--err);display:flex;align-items:center;justify-content:center;gap:4px"><i class="ti ti-x"></i> Từ chối</button>
      </div>
    </div>`).join('');
}

function mobToggleChk(id){
  const el=mG('mchk-'+id); if(!el) return;
  el.classList.toggle('checked');
  if(el.classList.contains('checked')){ el.style.background='var(--navy)'; el.style.borderColor='var(--navy)'; el.style.color='#fff'; el.innerHTML='<i class="ti ti-check" style="font-size:12px"></i>'; }
  else { el.style.background=''; el.style.borderColor='var(--bd)'; el.innerHTML=''; }
}
function mobGetChecked(){ return mobPending.filter(r=>mG('mchk-'+r.id)?.classList.contains('checked')).map(r=>r.id); }

async function mobPassOne(id){ await mobDoPass([id]); }
function mobRejectOne(id){ mG('mob-rej-ids').value=JSON.stringify([id]); mG('mob-rej-reason').value=''; mG('mob-rej-modal').style.display='flex'; }
function mobBatchPass(){ const ids=mobGetChecked(); if(!ids.length){ mobToast('Vui lòng chọn'); return; } mobDoPass(ids); }
function mobBatchReject(){ const ids=mobGetChecked(); if(!ids.length){ mobToast('Vui lòng chọn'); return; } mG('mob-rej-ids').value=JSON.stringify(ids); mG('mob-rej-reason').value=''; mG('mob-rej-modal').style.display='flex'; }

async function mobDoPass(ids){
  let errors=[];
  for(const id of ids){
    const r=mobPending.find(x=>x.id===id); if(!r) continue;
    try{
      const repRef=window._doc(COL.reports,id);
      const ps=await window._getDocs(
        window._query(window._collection(COL.processes),
          window._where('orderId','==',r.orderId),
          window._where('code','==',r.code),
          window._where('processNo','==',r.processNo)
        )
      );
      if(ps.empty){ errors.push(r.empName||r.empId); continue; }
      const procRef=ps.docs[0].ref;
      await window._runTransaction(async(t)=>{
        const repSnap=await t.get(repRef);
        const procSnap=await t.get(procRef);
        if(!repSnap.exists()) throw new Error('報工不存在');
        if(repSnap.data().status!=='pending') throw new Error('非待審狀態');
        const repQty=repSnap.data().qty||0;
        if((procSnap.data().pendingQty||0)<repQty) throw new Error('待審數量不足');
        t.update(repRef,{status:'approved',approvedAt:Date.now(),approvedBy:window.cu.user});
        t.update(procRef,{
          approvedQty:window._increment(repQty),
          pendingQty:window._increment(-repQty)
        });
      });
    }catch(e){
      errors.push(r.empName||r.empId);
      console.error('mobDoPass error:',e);
    }
  }
  if(errors.length) mobToast('❌ '+errors.length+'筆審批失敗：'+errors.join('、'));
  await mobLoadPending();
}

async function mobDoReject(){
  const ids=JSON.parse(mG('mob-rej-ids')?.value||'[]');
  const reason=mG('mob-rej-reason')?.value?.trim()||'';
  if(!reason){ mobToast('⚠️ 請填寫退回原因'); return; }
  let errors=[];
  for(const id of ids){
    const r=mobPending.find(x=>x.id===id); if(!r) continue;
    try{
      const repRef=window._doc(COL.reports,id);
      const ps=await window._getDocs(
        window._query(window._collection(COL.processes),
          window._where('orderId','==',r.orderId),
          window._where('code','==',r.code),
          window._where('processNo','==',r.processNo)
        )
      );
      if(ps.empty){ errors.push(r.empName||r.empId); continue; }
      const procRef=ps.docs[0].ref;
      await window._runTransaction(async(t)=>{
        const repSnap=await t.get(repRef);
        const procSnap=await t.get(procRef);
        if(!repSnap.exists()) throw new Error('報工不存在');
        if(repSnap.data().status!=='pending') throw new Error('非待審狀態');
        const repQty=repSnap.data().qty||0;
        if((procSnap.data().pendingQty||0)<repQty) throw new Error('待審數量不足');
        t.update(repRef,{status:'rejected',rejectedAt:Date.now(),rejectedBy:window.cu.user,rejectReason:reason});
        t.update(procRef,{pendingQty:window._increment(-repQty)});
      });
    }catch(e){
      errors.push(r.empName||r.empId);
      console.error('mobDoReject error:',e);
    }
  }
  if(errors.length) mobToast('❌ '+errors.length+'筆退回失敗：'+errors.join('、'));
  await mobLoadPending();
}
