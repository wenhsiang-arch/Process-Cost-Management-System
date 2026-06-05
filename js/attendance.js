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

function buildAttendanceTable(){
  const tb=g('att-tb'); if(!tb) return;
  const emps=(window.allEmployees||[]).filter(e=>DESK_ROLES.indexOf(e.role)===-1);
  if(!emps.length){
    tb.innerHTML='<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--hi)">尚無員工資料 / Chưa có nhân viên</td></tr>';
    return;
  }
  tb.innerHTML='';
  emps.forEach(e=>{
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
      <td class="att-total" style="font-weight:600;color:var(--navy)">8</td>`;
    tb.appendChild(tr);
    const reg=tr.querySelector('.att-reg');
    const ot=tr.querySelector('.att-ot');
    const tot=tr.querySelector('.att-total');
    const upd=()=>{ tot.textContent=((+reg.value||0)+(+ot.value||0)).toFixed(1); };
    reg.addEventListener('input',upd);
    ot.addEventListener('input',upd);
  });
}

function openAttApply(){
  const date=new Date().toISOString().slice(0,10);
  g('att-apply-date').value=date;
  const count=(window.allEmployees||[]).filter(e=>DESK_ROLES.indexOf(e.role)===-1).length;
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

  try{
    const snap=await window._getDocs(
      window._query(window._collection(COL.attendance),window._where('date','==',date))
    );
    if(!snap.empty){
      const msg=`${date} 已有 ${snap.docs.length} 筆考勤記錄\n確定要覆蓋？\n\nNgày ${date} đã có ${snap.docs.length} bản ghi. Xác nhận ghi đè?`;
      if(!confirm(msg)){ return; }
      await Promise.all(snap.docs.map(d=>window._deleteDoc(window._doc(COL.attendance,d.id))));
    }
  }catch(e){
    alert('查詢失敗：'+e.message); return;
  }

  try{
    const now=Date.now();
    await Promise.all(rows.map(r=>window._addDoc(window._collection(COL.attendance),{...r,date,createdAt:now})));
    cm('m-attendance');
    alert(`✅ 已儲存 ${rows.length} 筆考勤\nĐã lưu ${rows.length} bản ghi chấm công`);
  }catch(e){
    alert('儲存失敗：'+e.message);
  }
}
