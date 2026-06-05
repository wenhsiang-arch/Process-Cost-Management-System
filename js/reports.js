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
      await window._updateDoc(window._doc(COL.reports,id),{status:'approved',approvedAt:Date.now(),approvedBy:window.cu.user});
      const ps=await window._getDocs(window._query(window._collection(COL.processes),window._where('orderId','==',r.orderId),window._where('code','==',r.code),window._where('processNo','==',r.processNo)));
      if(!ps.empty){
        const c=ps.docs[0].data();
        await window._updateDoc(ps.docs[0].ref,{
          approvedQty:window._increment(r.qty),
          pendingQty:window._increment(-r.qty)
        });
      }
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
      await window._updateDoc(window._doc(COL.reports,id),{status:'rejected',rejectedAt:Date.now(),rejectedBy:window.cu.user,rejectReason:reason});
      const ps=await window._getDocs(window._query(window._collection(COL.processes),window._where('orderId','==',r.orderId),window._where('code','==',r.code),window._where('processNo','==',r.processNo)));
      if(!ps.empty){
        const c=ps.docs[0].data();
        await window._updateDoc(ps.docs[0].ref,{pendingQty:Math.max(0,(c.pendingQty||0)-r.qty)});
      }
    }catch(e){}
  }
  cm('m-reject-reason'); renderApproval();
}
