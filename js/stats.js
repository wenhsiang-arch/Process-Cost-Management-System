// ===== 員工產量統計 =====
function statsRangeChange(){
  const r=g('stats-range')?.value;
  const sf=g('stats-from'), st=g('stats-to');
  if(sf) sf.style.display=r==='custom'?'inline-block':'none';
  if(st) st.style.display=r==='custom'?'inline-block':'none';
}

async function renderStats(){
  const range=g('stats-range')?.value||'month';
  const dept=g('stats-dept')?.value||'';
  const now=new Date();
  let from, to;
  if(range==='today'){
    from=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
    to=Date.now();
  } else if(range==='month'){
    from=new Date(now.getFullYear(),now.getMonth(),1).getTime();
    to=Date.now();
  } else {
    const fv=g('stats-from')?.value, tv=g('stats-to')?.value;
    if(!fv||!tv){ alert('請選擇日期範圍'); return; }
    from=new Date(fv).getTime(); to=new Date(tv).getTime()+86400000;
    if(to-from>6*30*24*3600*1000){ alert('查詢範圍不能超過6個月'); return; }
  }
  const tb=g('stats-tb'); if(!tb) return;
  tb.innerHTML='<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--hi)">載入中...</td></tr>';
  try{
    const snap=await window._getDocs(window._query(window._collection(COL.reports),window._where('status','==','approved')));
    let list=snap.docs.map(d=>({id:d.id,...d.data()}));
    list=list.filter(r=>r.createdAt>=from && r.createdAt<=to);
    if(dept) list=list.filter(r=>r.empDept===dept);
    list.sort((a,b)=>(a.empName||'').localeCompare(b.empName||''));
    tb.innerHTML='';
    if(!list.length){ tb.innerHTML='<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--hi)">無資料</td></tr>'; return; }
    list.forEach(r=>{
      const slPH=r.slPerHour||(r.processSec?Math.round(3600/r.processSec):0);
      const wh=r.workHours||8;
      const actPH=wh>0?Math.round((r.qty||0)/wh):0;
      const eff=slPH>0?Math.round(actPH/slPH*100):0;
      const c=eff>=100?'var(--ok)':eff>=80?'var(--warn)':'var(--err)';
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${r.empName||r.empId}</td><td>${r.empDept||'-'}</td><td>${r.orderNo||''}</td><td>${r.code||''}</td><td>${r.processNo} ${r.processVi||''}</td><td><b>${(r.qty||0).toLocaleString()}</b></td><td>${slPH}</td><td style="font-weight:600;color:${c}">${eff}%</td>`;
      tb.appendChild(tr);
    });
    const ds=g('stats-dept');
    if(ds&&ds.options.length===1){
      Object.keys(DEPTS).forEach(d=>{ const o=document.createElement('option'); o.value=d; o.textContent=`${d} / ${DEPTS[d]}`; ds.appendChild(o); });
    }
  }catch(e){ tb.innerHTML='<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--err)">載入失敗</td></tr>'; }
}

// ===== 員工管理 =====
function renderEmployees(){
  const tb=g('emp-tb'); if(!tb) return;
  tb.innerHTML='';
  if(!window.allEmployees.length){
    tb.innerHTML='<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--hi)">尚無員工</td></tr>';
    return;
  }
  window.allEmployees.forEach(e=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><b>${e.name||'-'}</b></td><td>${e.user}</td><td>${e.dept?e.dept+' / '+(DEPTS[e.dept]||''):'-'}</td><td><span class="tg ${e.role==='leader'?'tb2':'ta'}">${ROLE_LABEL[e.role||'user']||e.role}</span></td><td><div style="display:flex;gap:4px"><button class="btn bsm" onclick="editEmployee('${e.id}')"><i class="ti ti-edit"></i></button><button class="btn bsm bd2" onclick="delEmployee('${e.id}')"><i class="ti ti-trash"></i></button></div></td>`;
    tb.appendChild(tr);
  });
}

function openAddEmployee(){
  g('emp-edit-id').value=''; g('emp-name').value=''; g('emp-user').value='';
  g('emp-pass').value=''; g('emp-dept').value=''; g('emp-role').value='user';
  g('emp-modal-title').textContent='新增員工';
  om('m-employee');
}

function editEmployee(id){
  const e=window.allEmployees.find(x=>x.id===id); if(!e) return;
  g('emp-edit-id').value=id; g('emp-name').value=e.name||'';
  g('emp-user').value=e.user; g('emp-pass').value='';
  g('emp-dept').value=e.dept||''; g('emp-role').value=e.role||'user';
  g('emp-modal-title').textContent='編輯員工';
  om('m-employee');
}

async function saveEmployee(){
  const id=g('emp-edit-id').value;
  const name=g('emp-name').value.trim();
  const user=g('emp-user').value.trim();
  const pass=g('emp-pass').value;
  const dept=g('emp-dept').value;
  const role=g('emp-role').value;
  if(!name||!user){ alert('請填寫姓名和帳號'); return; }
  if(!id&&!pass){ alert('新增員工請填寫密碼'); return; }
  if(!id&&window.allEmployees.find(e=>e.user===user)){ alert('帳號已存在'); return; }
  const data={name,user,dept,role,updatedAt:Date.now()};
  if(pass) data.pass=pass;
  try{
    if(id){
      await window._updateDoc(window._doc(COL.employees,id),data);
      const i=window.allEmployees.findIndex(e=>e.id===id);
      if(i>=0) window.allEmployees[i]={...window.allEmployees[i],...data};
    } else {
      data.createdAt=Date.now();
      const ref=await window._addDoc(window._collection(COL.employees),data);
      window.allEmployees.push({id:ref.id,...data});
    }
    cm('m-employee'); renderEmployees();
  }catch(e){ alert('儲存失敗：'+e.message); }
}

async function delEmployee(id){
  if(!confirm('確定刪除此員工帳號？')) return;
  try{
    await window._deleteDoc(window._doc(COL.employees,id));
    window.allEmployees=window.allEmployees.filter(e=>e.id!==id);
    renderEmployees();
  }catch(e){}
}
