// ===== 考勤工時管理 =====

function renderAttendance(){
  const dateEl=g('att-date');
  if(dateEl&&!dateEl.value){
    const today=new Date();
    dateEl.value=today.toISOString().slice(0,10);
  }
  attUpdateBatchTotal();
  buildAttendanceTable();
}

function attUpdateBatchTotal(){
  const reg=+(g('att-batch-reg')?.value||0);
  const ot=+(g('att-batch-ot')?.value||0);
  const tot=g('att-batch-total');
  if(tot) tot.textContent=(reg+ot).toFixed(1);
}

function attFillAll(){
  const reg=g('att-batch-reg')?.value;
  const ot=g('att-batch-ot')?.value;
  document.querySelectorAll('#att-tb tr[data-emp-id]').forEach(tr=>{
    if(reg!==''&&reg!==null){
      const inp=tr.querySelector('.att-reg');
      if(inp){ inp.value=reg; inp.dispatchEvent(new Event('input')); }
    }
    if(ot!==''&&ot!==null){
      const inp=tr.querySelector('.att-ot');
      if(inp){ inp.value=ot; inp.dispatchEvent(new Event('input')); }
    }
  });
}

function attFilterEmps(){
  const q=(g('att-emp-q')?.value||'').trim().toLowerCase();
  document.querySelectorAll('#att-tb tr[data-emp-id]').forEach(tr=>{
    const empId=tr.dataset.empId;
    const emp=(window.allEmployees||[]).find(e=>e.id===empId);
    const match=!q||(emp&&((emp.user||'').toLowerCase().includes(q)||(emp.name||'').toLowerCase().includes(q)));
    tr.style.display=match?'':'none';
    const detTr=g('att-hist-'+empId);
    if(detTr) detTr.style.display='none';
  });
}

function buildAttendanceTable(){
  const tb=g('att-tb'); if(!tb) return;
  const emps=(window.allEmployees||[]).filter(e=>!DESK_ROLES.includes(e.role));
  if(!emps.length){
    tb.innerHTML='<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--hi)">尚無員工資料 / Chưa có nhân viên</td></tr>';
    return;
  }
  tb.innerHTML='';
  emps.forEach(e=>{
    // 主行
    const tr=document.createElement('tr');
    tr.dataset.empId=e.id;
    tr.innerHTML=`
      <td>${e.user||'-'}</td>
      <td><b>${e.name||'-'}</b></td>
      <td>${e.dept?(e.dept+' / '+(DEPTS[e.dept]||'')):'-'}</td>
      <td><input type="number" class="att-reg" min="0" max="24" step="0.5" value="8"
        style="width:68px;padding:5px 7px;border:1px solid var(--bd);border-radius:7px;font-size:13px;text-align:center"></td>
      <td><input type="number" class="att-ot" min="0" max="24" step="0.5" value="0"
        style="width:68px;padding:5px 7px;border:1px solid var(--bd);border-radius:7px;font-size:13px;text-align:center"></td>
      <td class="att-total" style="font-weight:600;color:var(--navy)">8</td>
      <td><button class="btn bsm" onclick="toggleAttHist(this,'${e.id}')"><i class="ti ti-chevron-down"></i></button></td>`;
    tb.appendChild(tr);

    const reg=tr.querySelector('.att-reg');
    const ot=tr.querySelector('.att-ot');
    const tot=tr.querySelector('.att-total');
    const upd=()=>{ tot.textContent=((+reg.value||0)+(+ot.value||0)).toFixed(1); };
    reg.addEventListener('input',upd);
    ot.addEventListener('input',upd);

    // 展開行
    const detTr=document.createElement('tr');
    detTr.id='att-hist-'+e.id;
    detTr.style.display='none';
    detTr.innerHTML=`<td colspan="7" style="padding:0;background:var(--bg)">
      <div style="padding:10px 16px">
        <div id="att-hist-body-${e.id}" style="color:var(--mu);font-size:12px">載入中...</div>
      </div>
    </td>`;
    tb.appendChild(detTr);
  });
}

async function toggleAttHist(btn, empId){
  const detTr=g('att-hist-'+empId);
  if(!detTr) return;
  const isOpen=detTr.style.display!=='none';
  if(isOpen){
    detTr.style.display='none';
    btn.innerHTML='<i class="ti ti-chevron-down"></i>';
    return;
  }
  detTr.style.display='';
  btn.innerHTML='<i class="ti ti-chevron-up"></i>';
  await loadAttHist(empId);
}

async function loadAttHist(empId){
  const body=g('att-hist-body-'+empId); if(!body) return;
  body.innerHTML='<span style="color:var(--mu)">載入中...</span>';
  try{
    const d40=new Date(); d40.setDate(d40.getDate()-40);
    const fromStr=d40.toISOString().slice(0,10);
    const snap=await window._getDocs(
      window._query(window._collection(COL.attendance),
        window._where('empId','==',empId),
        window._where('date','>=',fromStr)
      )
    );
    const records=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.date.localeCompare(a.date));
    if(!records.length){
      body.innerHTML='<span style="color:var(--mu);font-size:12px">近 40 天無考勤記錄</span>';
      return;
    }
    renderAttHistTable(empId, records);
  }catch(e){
    body.innerHTML='<span style="color:var(--err);font-size:12px">載入失敗：'+e.message+'</span>';
  }
}

function renderAttHistTable(empId, records){
  const body=g('att-hist-body-'+empId); if(!body) return;
  const rows=records.map(r=>`
    <tr id="att-row-${r.id}" style="border-top:1px solid var(--bd)">
      <td style="padding:6px 10px;font-size:12px">${r.date}</td>
      <td style="padding:6px 10px;font-size:12px;text-align:center">
        <input type="number" id="att-edit-reg-${r.id}" value="${r.regularHours}" min="0" max="24" step="0.5"
          style="width:60px;padding:4px 6px;border:1px solid var(--bd);border-radius:6px;font-size:12px;text-align:center">
      </td>
      <td style="padding:6px 10px;font-size:12px;text-align:center">
        <input type="number" id="att-edit-ot-${r.id}" value="${r.overtimeHours}" min="0" max="24" step="0.5"
          style="width:60px;padding:4px 6px;border:1px solid var(--bd);border-radius:6px;font-size:12px;text-align:center">
      </td>
      <td id="att-edit-tot-${r.id}" style="padding:6px 10px;font-size:12px;text-align:center;font-weight:600;color:var(--navy)">${r.totalHours}</td>
      <td style="padding:6px 10px">
        <div style="display:flex;gap:4px">
          <button class="btn bsm" onclick="saveAttRecord('${r.id}','${empId}')"><i class="ti ti-check"></i></button>
          <button class="btn bsm bd2" onclick="delAttRecord('${r.id}','${empId}')"><i class="ti ti-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');

  body.innerHTML=`
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:var(--sf)">
        <th style="padding:6px 10px;font-size:11px;text-align:left">Ngày<br><span style="color:var(--mu);font-weight:400">日期</span></th>
        <th style="padding:6px 10px;font-size:11px;text-align:center">Ca thường<br><span style="color:var(--mu);font-weight:400">正常班</span></th>
        <th style="padding:6px 10px;font-size:11px;text-align:center">Tăng ca<br><span style="color:var(--mu);font-weight:400">加班</span></th>
        <th style="padding:6px 10px;font-size:11px;text-align:center">Tổng<br><span style="color:var(--mu);font-weight:400">合計</span></th>
        <th style="padding:6px 10px;font-size:11px">Thao tác<br><span style="color:var(--mu);font-weight:400">操作</span></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  // 合計自動計算
  records.forEach(r=>{
    const regEl=g('att-edit-reg-'+r.id);
    const otEl=g('att-edit-ot-'+r.id);
    const totEl=g('att-edit-tot-'+r.id);
    if(regEl&&otEl&&totEl){
      const upd=()=>{ totEl.textContent=((+regEl.value||0)+(+otEl.value||0)).toFixed(1); };
      regEl.addEventListener('input',upd);
      otEl.addEventListener('input',upd);
    }
  });
}

async function saveAttRecord(docId, empId){
  const reg=+(g('att-edit-reg-'+docId)?.value||0);
  const ot=+(g('att-edit-ot-'+docId)?.value||0);
  const total=reg+ot;
  try{
    await window._updateDoc(window._doc(COL.attendance,docId),{regularHours:reg,overtimeHours:ot,totalHours:total});
    g('att-edit-tot-'+docId).textContent=total.toFixed(1);
    alert('✅ 已更新');
  }catch(e){
    alert('更新失敗：'+e.message);
  }
}

async function delAttRecord(docId, empId){
  if(!confirm('確定刪除此筆考勤記錄？')) return;
  try{
    await window._deleteDoc(window._doc(COL.attendance,docId));
    const row=g('att-row-'+docId);
    if(row) row.remove();
  }catch(e){
    alert('刪除失敗：'+e.message);
  }
}

function openAttApply(){
  const date=new Date().toISOString().slice(0,10);
  g('att-apply-date').value=date;
  const count=(window.allEmployees||[]).filter(e=>!DESK_ROLES.includes(e.role)).length;
  g('att-apply-count').textContent=count;
  om('m-attendance');
}

async function confirmAttendance(){
  const date=g('att-apply-date')?.value;
  if(!date){ alert('請填寫日期 / Vui lòng nhập ngày'); return; }
  const rows=[];
  document.querySelectorAll('#att-tb tr[data-emp-id]').forEach(tr=>{
    const empId=tr.dataset.empId;
    const emp=(window.allEmployees||[]).find(e=>e.id===empId);
    if(!emp) return;
    const reg=+(tr.querySelector('.att-reg')?.value||0);
    const ot=+(tr.querySelector('.att-ot')?.value||0);
    rows.push({empId,empName:emp.name||'',empDept:emp.dept||'',user:emp.user||'',regularHours:reg,overtimeHours:ot,totalHours:reg+ot});
  });
  if(!rows.length){ alert('無員工資料'); return; }
  const msg=`套用日期：${date}\n人數：${rows.length} 位\n若該日已有資料，將直接覆蓋同員工記錄。\n\nNgày: ${date} / ${rows.length} nhân viên\nDữ liệu cũ sẽ bị ghi đè.\n\n確認套用？`;
  if(!confirm(msg)) return;
  try{
    const now=Date.now();
    await Promise.all(rows.map(r=>{
      const docId=date+'_'+r.empId;
      return window._setDoc(window._doc(COL.attendance,docId),{...r,date,createdAt:now,updatedAt:now},{merge:false});
    }));
    cm('m-attendance');
    alert(`✅ 已儲存 ${rows.length} 筆考勤\nĐã lưu ${rows.length} bản ghi chấm công`);
  }catch(e){
    console.error('confirmAttendance error:',e);
    alert('儲存失敗：'+e.message);
  }
}
