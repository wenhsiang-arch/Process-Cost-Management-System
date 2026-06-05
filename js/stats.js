// ===== 員工產量統計 =====
function statsRangeChange(){
  const r=g('stats-range')?.value;
  const sf=g('stats-from'),st=g('stats-to');
  if(sf) sf.style.display=r==='custom'?'inline-block':'none';
  if(st) st.style.display=r==='custom'?'inline-block':'none';
}

function getStatsDateRange(){
  const range=g('stats-range')?.value||'month';
  const now=new Date();
  let fromTs,toTs,fromStr,toStr;
  if(range==='today'){
    const d=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    fromTs=d.getTime(); toTs=Date.now();
    fromStr=toStr=d.toISOString().slice(0,10);
  } else if(range==='month'){
    const d=new Date(now.getFullYear(),now.getMonth(),1);
    fromTs=d.getTime(); toTs=Date.now();
    fromStr=d.toISOString().slice(0,10);
    toStr=now.toISOString().slice(0,10);
  } else {
    const fv=g('stats-from')?.value,tv=g('stats-to')?.value;
    if(!fv||!tv){alert('請選擇日期範圍');return null;}
    fromTs=new Date(fv).getTime(); toTs=new Date(tv).getTime()+86400000;
    if(toTs-fromTs>6*30*24*3600*1000){alert('查詢範圍不能超過6個月');return null;}
    fromStr=fv; toStr=tv;
  }
  return{fromTs,toTs,fromStr,toStr};
}

async function renderStats(){
  const dr=getStatsDateRange(); if(!dr) return;
  const {fromTs,toTs,fromStr,toStr}=dr;
  const dept=g('stats-dept')?.value||'';
  const scope=g('stats-scope')?.value||'all';
  const tb=g('stats-tb'); if(!tb) return;
  tb.innerHTML='<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--hi)">載入中... / Đang tải...</td></tr>';

  try{
    // 查詢報工與考勤
    const [repSnap,attSnap]=await Promise.all([
      window._getDocs(window._query(window._collection(COL.reports),window._where('status','==','approved'),window._where('createdAt','>=',fromTs),window._where('createdAt','<=',toTs))),
      window._getDocs(window._query(window._collection(COL.attendance),window._where('date','>=',fromStr),window._where('date','<=',toStr)))
    ]);

    const reports=repSnap.docs.map(d=>({id:d.id,...d.data()}));
    const attMap={};
    attSnap.docs.forEach(d=>{
      const a=d.data();
      if(!attMap[a.empId]) attMap[a.empId]={totalHours:0};
      attMap[a.empId].totalHours+=(a.totalHours||0);
    });

    // 以 empId 為 key 整合報工
    const empMap={};
    reports.forEach(r=>{
      if(!empMap[r.empId]) empMap[r.empId]={empId:r.empId,empName:r.empName||'',empUser:r.empId,empDept:r.empDept||'',reports:[]};
      empMap[r.empId].reports.push(r);
    });

    // 決定員工清單
    let emps=[];
    if(scope==='all'){
      (window.allEmployees||[]).forEach(e=>{
        if(!empMap[e.id]) empMap[e.id]={empId:e.id,empName:e.name||'',empUser:e.user||'',empDept:e.dept||'',reports:[]};
        else{ empMap[e.id].empUser=e.user||''; }
        emps.push(empMap[e.id]);
      });
    } else {
      emps=Object.values(empMap).map(e=>{
        const found=(window.allEmployees||[]).find(x=>x.id===e.empId);
        if(found){ e.empUser=found.user||e.empId; e.empName=found.name||e.empName; }
        return e;
      });
    }

    // 部門篩選
    if(dept) emps=emps.filter(e=>e.empDept===dept);

    // 填入部門選單
    const ds=g('stats-dept');
    if(ds&&ds.options.length===1){
      Object.keys(DEPTS).forEach(d=>{const o=document.createElement('option');o.value=d;o.textContent=d+' / '+DEPTS[d];ds.appendChild(o);});
    }

    tb.innerHTML='';
    if(!emps.length){
      tb.innerHTML='<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--hi)">無資料 / Không có dữ liệu</td></tr>';
      return;
    }

    emps.forEach(e=>{
      const att=attMap[e.empId];
      const capHours=e.reports.reduce((s,r)=>{
        const slph=r.slPerHour||(r.processSec?Math.round(3600/r.processSec):0);
        return s+(slph>0?(r.qty||0)/slph:0);
      },0);
      const workHours=att?att.totalHours:null;
      const effStr=workHours&&workHours>0?Math.round(capHours/workHours*100)+'%':'-';
      const effColor=workHours&&workHours>0?(capHours/workHours>=1?'var(--ok)':capHours/workHours>=0.8?'var(--warn)':'var(--err)'):'var(--mu)';
      const hasRep=e.reports.length>0;

      const tr=document.createElement('tr');
      tr.style.cursor='pointer';
      tr.innerHTML=`
        <td><i class="ti ti-chevron-right" style="font-size:12px;color:var(--mu);transition:transform .2s"></i></td>
        <td>${e.empUser||e.empId}</td>
        <td><b>${e.empName||'-'}</b></td>
        <td>${e.empDept?(e.empDept+' / '+(DEPTS[e.empDept]||'')):'-'}</td>
        <td>${workHours!=null?workHours.toFixed(1)+' h':'-'}</td>
        <td>${hasRep?capHours.toFixed(2)+' h':'0'}</td>
        <td style="font-weight:600;color:${effColor}">${effStr}</td>`;
      tb.appendChild(tr);

      // 展開明細列
      const detTr=document.createElement('tr');
      detTr.style.display='none';
      detTr.innerHTML=`<td colspan="6" style="padding:0">
        <table style="width:100%;border-collapse:collapse;background:var(--bg)">
          <thead><tr style="background:var(--sf)">
            <th style="padding:6px 10px;font-size:11px;text-align:left">Ngày<br><span style="color:var(--mu);font-weight:400">日期</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:left">Đơn hàng<br><span style="color:var(--mu);font-weight:400">訂單</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:left">Mã hàng<br><span style="color:var(--mu);font-weight:400">款號</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:left">Công đoạn<br><span style="color:var(--mu);font-weight:400">工序</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:right">SL hoàn thành<br><span style="color:var(--mu);font-weight:400">完成數量</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:right">SL chuẩn/giờ<br><span style="color:var(--mu);font-weight:400">標準產量/時</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:right">Giờ năng suất<br><span style="color:var(--mu);font-weight:400">產能時數</span></th>
          </tr></thead>
          <tbody>${e.reports.length?e.reports.map(r=>{
            const slph=r.slPerHour||(r.processSec?Math.round(3600/r.processSec):0);
            const gh=slph>0?((r.qty||0)/slph).toFixed(2):'-';
            return`<tr style="border-top:1px solid var(--bd)">
              <td style="padding:6px 10px;font-size:12px">${fmtVN(r.createdAt)}</td>
              <td style="padding:6px 10px;font-size:12px">${r.orderNo||'-'}</td>
              <td style="padding:6px 10px;font-size:12px">${r.code||'-'}</td>
              <td style="padding:6px 10px;font-size:12px">${r.processVi||r.processNo||'-'}</td>
              <td style="padding:6px 10px;font-size:12px;text-align:right"><b>${(r.qty||0).toLocaleString()}</b></td>
              <td style="padding:6px 10px;font-size:12px;text-align:right">${slph}</td>
              <td style="padding:6px 10px;font-size:12px;text-align:right">${gh}</td>
            </tr>`;
          }).join(''):'<tr><td colspan="7" style="padding:10px;text-align:center;color:var(--mu);font-size:12px">無報工記錄</td></tr>'}</tbody>
        </table></td>`;
      tb.appendChild(detTr);

      // 點擊展開/收起
      tr.addEventListener('click',()=>{
        const open=detTr.style.display!=='none'?false:true;
        detTr.style.display=open?'':'none';
        const icon=tr.querySelector('.ti-chevron-right');
        if(icon) icon.style.transform=open?'rotate(90deg)':'';
      });
    });

  }catch(e){
    console.error('renderStats error',e);
    tb.innerHTML='<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--err)">載入失敗：'+e.message+'</td></tr>';
  }
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
  if(!name||!user){alert('請填寫姓名和帳號');return;}
  if(!id&&!pass){alert('新增員工請填寫密碼');return;}
  if(!id&&window.allEmployees.find(e=>e.user===user)){alert('帳號已存在');return;}
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
  }catch(e){alert('儲存失敗：'+e.message);}
}

async function delEmployee(id){
  if(!confirm('確定刪除此員工帳號？')) return;
  try{
    await window._deleteDoc(window._doc(COL.employees,id));
    window.allEmployees=window.allEmployees.filter(e=>e.id!==id);
    renderEmployees();
  }catch(e){}
}
