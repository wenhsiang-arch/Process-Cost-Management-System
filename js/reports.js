// ===== 報工審批資料 =====
let pendingList = [];

// ===== 桌機版審批 =====
async function renderApproval(){
  const dept=g('apv-dept')?.value||'';
  const tb=g('apv-tb'); if(!tb) return;
  const empty=g('apv-empty');
  tb.innerHTML='<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--hi)">載入中...</td></tr>';
  try{
    const snap=await window._getDocs(window._query(window._collection(COL.reports),window._where('status','==','pending')));
    pendingList=snap.docs.map(d=>({id:d.id,...d.data()}));
    let list=[...pendingList];
    if(dept) list=list.filter(r=>r.empDept===dept);
    const empQ=(g('apv-emp-q')?.value||'').trim().toLowerCase();
    if(empQ) list=list.filter(r=>(r.empName||'').toLowerCase().includes(empQ)||(r.empId||'').toLowerCase().includes(empQ));
    updateApvBadge(pendingList.length);
    if(!list.length){ tb.innerHTML=''; if(empty) empty.style.display='block'; return; }
    if(empty) empty.style.display='none';
    tb.innerHTML='';
    list.forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td><input type="checkbox" class="apv-chk" value="${r.id}"></td>
        <td><b>${r.empName||r.empId}</b></td>
        <td>${r.empDept||'-'}</td>
        <td>${r.orderNo||''}</td>
        <td>${r.code||''}</td>
        <td>${r.processNo} ${r.processVi||''}</td>
        <td><b>${(r.qty||0).toLocaleString()}</b></td>
        <td>${fmtTimeVN(r.createdAt)}</td>
        <td><div style="display:flex;gap:4px">
          <button class="btn bsm" style="background:var(--okl);color:var(--ok)" onclick="passOne('${r.id}')"><i class="ti ti-check"></i></button>
          <button class="btn bsm bd2" onclick="rejectOne('${r.id}')"><i class="ti ti-x"></i></button>
        </div></td>`;
      tb.appendChild(tr);
    });
    const deptSel=g('apv-dept');
    if(deptSel&&deptSel.options.length===1){
      Object.keys(DEPTS).forEach(d=>{
        const opt=document.createElement('option');
        opt.value=d; opt.textContent=`${d} / ${DEPTS[d]}`;
        deptSel.appendChild(opt);
      });
    }
  }catch(e){ tb.innerHTML='<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--err)">載入失敗</td></tr>'; }
}

function approvalToggleAll(chk){
  document.querySelectorAll('.apv-chk').forEach(c=>c.checked=chk.checked);
}
function getApvChecked(){ return [...document.querySelectorAll('.apv-chk:checked')].map(c=>c.value); }

async function passOne(id){ await passReports([id]); renderApproval(); }
function rejectOne(id){
  g('rej-target-ids').value=JSON.stringify([id]);
  g('rej-reason-text').value='';
  om('m-reject-reason');
}
async function approvalBatchPass(){
  const ids=getApvChecked();
  if(!ids.length){ alert('請先勾選'); return; }
  if(!confirm(`確認通過 ${ids.length} 筆？`)) return;
  await passReports(ids); renderApproval();
}
function approvalBatchReject(){
  const ids=getApvChecked();
  if(!ids.length){ alert('請先勾選'); return; }
  g('rej-target-ids').value=JSON.stringify(ids);
  g('rej-reason-text').value='';
  om('m-reject-reason');
}

async function passReports(ids){
  const errors=[];
  for(const id of ids){
    const r=pendingList.find(x=>x.id===id); if(!r) continue;
    try{
      const repRef=window._doc(COL.reports,id);
      const ps=await window._getDocs(window._query(window._collection(COL.processes),window._where('orderId','==',r.orderId),window._where('code','==',r.code),window._where('processNo','==',r.processNo)));
      if(ps.empty){ errors.push(r.empName||r.empId); continue; }
      const procRef=ps.docs[0].ref;
      await window._runTransaction(async(t)=>{
        const repSnap=await t.get(repRef);
        const procSnap=await t.get(procRef);
        if(!repSnap.exists()) throw new Error('報工不存在');
        if(repSnap.data().status!=='pending') throw new Error('非待審狀態');
        const repQty=repSnap.data().qty||0;
        const curPending=procSnap.data().pendingQty||0;
        if(curPending<repQty) throw new Error('待審數量不足');
        t.update(repRef,{status:'approved',approvedAt:Date.now(),approvedBy:window.cu.user});
        t.update(procRef,{
          approvedQty:window._increment(repQty),
          pendingQty:window._increment(-repQty)
        });
      });
    }catch(e){ errors.push(r.empName||r.empId); }
  }
  if(errors.length) alert(`⚠️ ${errors.length} 筆審批失敗：${errors.join('、')}\n請重試`);
}

async function doReject(){
  const ids=JSON.parse(g('rej-target-ids').value||'[]');
  const reason=g('rej-reason-text').value.trim();
  for(const id of ids){
    const r=pendingList.find(x=>x.id===id); if(!r) continue;
    try{
      const repRef=window._doc(COL.reports,id);
      const ps=await window._getDocs(window._query(window._collection(COL.processes),window._where('orderId','==',r.orderId),window._where('code','==',r.code),window._where('processNo','==',r.processNo)));
      if(ps.empty){ continue; }
      const procRef=ps.docs[0].ref;
      await window._runTransaction(async(t)=>{
        const repSnap=await t.get(repRef);
        const procSnap=await t.get(procRef);
        if(!repSnap.exists()) throw new Error('報工不存在');
        if(repSnap.data().status!=='pending') throw new Error('非待審狀態');
        const repQty=repSnap.data().qty||0;
        const curPending=procSnap.data().pendingQty||0;
        if(curPending<repQty) throw new Error('待審數量不足');
        t.update(repRef,{status:'rejected',rejectedAt:Date.now(),rejectedBy:window.cu.user,rejectReason:reason});
        t.update(procRef,{pendingQty:window._increment(-repQty)});
      });
    }catch(e){}
  }
  cm('m-reject-reason'); renderApproval();
}

// ===== 報工紀錄 =====
window.replogList=[];

async function renderReplog(){
  const dept=g('replog-dept')?.value||'';
  const empQ=(g('replog-emp-q')?.value||'').trim().toLowerCase();
  const tb=g('replog-tb'); if(!tb) return;
  tb.innerHTML='<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--hi)">載入中...</td></tr>';
  try{
    const snap=await window._getDocs(
      window._query(window._collection(COL.reports),window._where('status','==','approved'))
    );
    let list=snap.docs.map(d=>({id:d.id,...d.data()}));
    if(dept) list=list.filter(r=>r.empDept===dept);
    if(empQ) list=list.filter(r=>(r.empName||'').toLowerCase().includes(empQ)||(r.empId||'').toLowerCase().includes(empQ));
    list.sort((a,b)=>b.createdAt-a.createdAt);
    window.replogList=list;

    const deptSel=g('replog-dept');
    if(deptSel&&deptSel.options.length===1){
      Object.keys(DEPTS).forEach(d=>{
        const o=document.createElement('option');
        o.value=d; o.textContent=d+' / '+DEPTS[d];
        deptSel.appendChild(o);
      });
    }

    tb.innerHTML='';
    if(!list.length){
      tb.innerHTML='<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--hi)">無資料 / Không có dữ liệu</td></tr>';
      return;
    }
    const fmt=typeof fmtTimeVN==='function'?fmtTimeVN:ts=>new Date(ts).toLocaleString('vi-VN');
    list.forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td><b>${r.empName||r.empId}</b></td>
        <td>${r.empDept||'-'}</td>
        <td>${r.orderNo||'-'}</td>
        <td>${r.code||'-'}</td>
        <td>${r.processVi||r.processNo||'-'}</td>
        <td><b>${(r.qty||0).toLocaleString()}</b></td>
        <td>${fmt(r.approvedAt||r.createdAt)}</td>
        <td><button class="btn bsm bd2" onclick="openVoid('${r.id}')"><i class="ti ti-ban"></i>作廢</button></td>`;
      tb.appendChild(tr);
    });
  }catch(e){
    tb.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--err)">載入失敗：${e.message}</td></tr>`;
  }
}

function openVoid(repId){
  g('void-target-id').value=repId;
  g('void-reason-text').value='';
  om('m-void-reason');
}

async function confirmVoid(){
  const repId=g('void-target-id').value;
  const reason=g('void-reason-text').value.trim();
  if(!reason){ alert('請填寫作廢原因 / Vui lòng nhập lý do'); return; }
  const rep=window.replogList.find(x=>x.id===repId);
  if(!rep){ alert('找不到此筆報工'); return; }
  try{
    const repRef=window._doc(COL.reports,repId);
    const ps=await window._getDocs(
      window._query(window._collection(COL.processes),
        window._where('orderId','==',rep.orderId),
        window._where('code','==',rep.code),
        window._where('processNo','==',rep.processNo)
      )
    );
    if(ps.empty){ alert('找不到對應工序，無法作廢'); return; }
    const procRef=ps.docs[0].ref;
    await window._runTransaction(async(t)=>{
      const repSnap=await t.get(repRef);
      const procSnap=await t.get(procRef);
      if(!repSnap.exists()) throw new Error('報工記錄不存在');
      if(repSnap.data().status!=='approved') throw new Error('此報工非已審批狀態');
      const repQty=repSnap.data().qty||0;
      if(repQty<=0) throw new Error('報工數量異常');
      if(!procSnap.exists()) throw new Error('工序不存在');
      if((procSnap.data().approvedQty||0)<repQty) throw new Error('已審批數量不足，無法作廢');
      t.update(repRef,{
        status:'voided',
        voidedAt:Date.now(),
        voidedBy:window.cu.user,
        voidReason:reason
      });
      t.update(procRef,{approvedQty:window._increment(-repQty)});
    });
    cm('m-void-reason');
    alert('✅ 已作廢此筆報工\nĐã hủy báo công thành công');
    renderReplog();
  }catch(e){
    alert('作廢失敗：'+e.message);
  }
}
