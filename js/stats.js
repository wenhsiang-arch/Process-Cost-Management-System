// ===== 員工產量統計 =====
let statsSearchTimer=null;

function statsSearchDebounce(){
  clearTimeout(statsSearchTimer);
  statsSearchTimer=setTimeout(()=>{ renderStats(); },300);
}

function statsRangeChange(){
  const r=g('stats-range')?.value;
  const sf=g('stats-from'),st=g('stats-to');
  if(sf) sf.style.display=r==='custom'?'inline-block':'none';
  if(st) st.style.display=r==='custom'?'inline-block':'none';
  if(r!=='custom') renderStats();
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
      window._getDocs(window._query(window._collection(COL.reports),window._where('status','==','approved'))),
      window._getDocs(window._query(window._collection(COL.attendance),window._where('date','>=',fromStr),window._where('date','<=',toStr)))
    ]);

    const reports_all=repSnap.docs.map(d=>({id:d.id,...d.data()}));
    const reports=reports_all.filter(r=>{
      const ts=r.workDate?new Date(r.workDate).getTime():r.createdAt;
      return ts>=fromTs&&ts<=toTs;
    });
    const attMap={};
    attSnap.docs.forEach(d=>{
      const a=d.data();
      if(!attMap[a.empId]) attMap[a.empId]={totalHours:0};
      attMap[a.empId].totalHours+=(a.totalHours||0);
    });

    // 建立員工對照表（同時支援 Firebase id 和工號查詢）
    const empLookup={};
    (window.allEmployees||[]).forEach(e=>{
      if(e.id) empLookup[e.id]=e;
      if(e.user) empLookup[e.user]=e;
    });

    // 以 empId 為 key 整合報工
    const empMap={};
    reports.forEach(r=>{
      if(!empMap[r.empId]){
        const found=empLookup[r.empId]||{};
        empMap[r.empId]={empId:r.empId,empName:found.name||r.empName||'',empUser:found.user||r.empId,empDept:found.dept||r.empDept||'',empRole:found.role||'user',reports:[]};
      }
      empMap[r.empId].reports.push(r);
    });

    // 決定員工清單
    let emps=[];
    if(scope==='all'){
      const seen=new Set();
      (window.allEmployees||[]).forEach(e=>{
        const seenKey=e.id||e.user;
        if(seen.has(seenKey)||seen.has(e.user)) return;
        seen.add(seenKey);
        if(e.user) seen.add(e.user);
        if(!empMap[e.id]&&!empMap[e.user]){
          empMap[e.id]={empId:e.id,empName:e.name||'',empUser:e.user||'',empDept:e.dept||'',empRole:e.role||'user',reports:[]};
        }
        const key=empMap[e.id]?e.id:e.user;
        empMap[key].empUser=e.user||'';
        empMap[key].empRole=e.role||'user';
        emps.push(empMap[key]);
      });
    } else {
      emps=Object.values(empMap).map(e=>{
        const found=empLookup[e.empId];
        if(found){ e.empUser=found.user||e.empId; e.empName=found.name||e.empName; e.empRole=found.role||e.empRole; }
        return e;
      });
    }

    // 部門篩選
    if(dept) emps=emps.filter(e=>e.empDept===dept);
    const empQ=(g('stats-emp-q')?.value||'').trim().toLowerCase();
    if(empQ) emps=emps.filter(e=>(e.empUser||'').toLowerCase().includes(empQ)||(e.empName||'').toLowerCase().includes(empQ));

    // 填入部門選單
    const ds=g('stats-dept');
    if(ds&&ds.options.length===1){
      Object.keys(DEPTS).forEach(d=>{const o=document.createElement('option');o.value=d;o.textContent=d+' / '+DEPTS[d];ds.appendChild(o);});
    }

    tb.innerHTML='';
    if(!emps.length){
      tb.innerHTML='<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--hi)">無資料 / Không có dữ liệu</td></tr>';
      return;
    }

    emps.forEach(e=>{
      const att=attMap[e.empId];
      const capHours=e.reports.reduce((s,r)=>{
        const slph=r.slPerHour||(r.processSec?Math.round((window.S?.ws||3000)/r.processSec):0);
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
        <td><span class="tg ${e.empRole==='leader'?'tb2':'ta'}">${ROLE_LABEL[e.empRole]||'員工'}</span></td>
        <td>${e.empDept?(e.empDept+' / '+(DEPTS[e.empDept]||'')):'-'}</td>
        <td>${workHours!=null?workHours.toFixed(1)+' h':'-'}</td>
        <td>${hasRep?capHours.toFixed(2)+' h':'0'}</td>
        <td style="font-weight:600;color:${effColor}">${effStr}</td>`;
      tb.appendChild(tr);

      // 展開明細列
      const detTr=document.createElement('tr');
      detTr.style.display='none';
      detTr.innerHTML=`<td colspan="7" style="padding:0">
        <table style="width:100%;border-collapse:collapse;background:var(--bg)">
          <thead><tr style="background:var(--sf)">
            <th style="padding:6px 10px;font-size:11px;text-align:left">Ngày<br><span style="color:var(--mu);font-weight:400">日期</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:left">Đơn hàng<br><span style="color:var(--mu);font-weight:400">訂單</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:left">Mã hàng<br><span style="color:var(--mu);font-weight:400">款號</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:left">Số CĐ<br><span style="color:var(--mu);font-weight:400">工序號</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:left">Công đoạn<br><span style="color:var(--mu);font-weight:400">工序</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:right">SL hoàn thành<br><span style="color:var(--mu);font-weight:400">完成數量</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:right">Giây CĐ<br><span style="color:var(--mu);font-weight:400">工序秒數</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:right">SL chuẩn/giờ<br><span style="color:var(--mu);font-weight:400">標準產量/時</span></th>
            <th style="padding:6px 10px;font-size:11px;text-align:right">Giờ năng suất<br><span style="color:var(--mu);font-weight:400">產能時數</span></th>
          </tr></thead>
          <tbody>${e.reports.length?e.reports.map(r=>{
            const slph=r.slPerHour||(r.processSec?Math.round((window.S?.ws||3000)/r.processSec):0);
            const gh=slph>0?((r.qty||0)/slph).toFixed(2):'-';
            return`<tr style="border-top:1px solid var(--bd)">
              <td style="padding:6px 10px;font-size:12px">${r.workDate||fmtVN(r.createdAt)}</td>
              <td style="padding:6px 10px;font-size:12px">${r.orderNo||'-'}</td>
              <td style="padding:6px 10px;font-size:12px">${r.code||'-'}</td>
              <td style="padding:6px 10px;font-size:12px">${r.processNo||'-'}</td>
              <td style="padding:6px 10px;font-size:12px">${r.processVi||r.processZh||'-'}</td>
              <td style="padding:6px 10px;font-size:12px;text-align:right"><b>${(r.qty||0).toLocaleString()}</b></td>
              <td style="padding:6px 10px;font-size:12px;text-align:right">${slph>0?Math.round((window.S?.ws||3000)/slph):'-'}</td>
              <td style="padding:6px 10px;font-size:12px;text-align:right">${slph}</td>
              <td style="padding:6px 10px;font-size:12px;text-align:right">${gh}</td>
            </tr>`;
          }).join(''):'<tr><td colspan="8" style="padding:10px;text-align:center;color:var(--mu);font-size:12px">無報工記錄</td></tr>'}</tbody>
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
    tr.innerHTML=`<td><b>${e.name||'-'}</b></td><td>${e.user}</td><td>${e.dept?e.dept+' / '+(DEPTS[e.dept]||''):'-'}</td><td><span class="tg ${e.role==='leader'?'tb2':'ta'}">${ROLE_LABEL[e.role||'user']||e.role}</span></td><td><div style="display:flex;gap:4px"><button class="btn bsm" onclick="editEmployee('${e.id}')"><i class="ti ti-edit"></i></button><button class="btn bsm bd2" onclick="delEmployee('${e.id}')"><i class="ti ti-trash"></i></button>${isAdm()?`<button class="btn bsm bd2" style="background:var(--errl);font-weight:700" onclick="openAdminPurgeEmployee('${e.id}')" title="徹底刪除測試資料"><i class="ti ti-database-off"></i></button>`:''}</div></td>`;
    tb.appendChild(tr);
  });
}

function openAddEmployee(){
  g('emp-edit-id').value=''; g('emp-name').value=''; g('emp-user').value='';
  g('emp-dept').value=''; g('emp-role').value='user';
  g('emp-modal-title').textContent='新增員工';
  om('m-employee');
}

function editEmployee(id){
  const e=window.allEmployees.find(x=>x.id===id); if(!e) return;
  g('emp-edit-id').value=id; g('emp-name').value=e.name||'';
  g('emp-user').value=e.user;
  g('emp-dept').value=e.dept||''; g('emp-role').value=e.role||'user';
  g('emp-modal-title').textContent='編輯員工';
  om('m-employee');
}

async function saveEmployee(){
  const id=g('emp-edit-id').value;
  const name=g('emp-name').value.trim();
  const user=g('emp-user').value.trim();
  const pass='';
  const dept=g('emp-dept').value;
  const role=g('emp-role').value;
  if(!name||!user){alert('請填寫姓名和帳號');return;}
  if(!id&&(window.allEmployees.find(e=>e.user===user)||window.accs.find(a=>a.user===user))){alert('帳號已存在');return;}
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
  const emp=window.allEmployees.find(e=>e.id===id); if(!emp) return;
  try{
    const [repSnap,attSnap]=await Promise.all([
      window._getDocs(window._query(window._collection(COL.reports),window._where('empId','==',id))),
      window._getDocs(window._query(window._collection(COL.attendance),window._where('empId','==',id)))
    ]);
    const repCount=repSnap.docs.length;
    const attCount=attSnap.docs.length;
    const keepHistoryMsg=`確認刪除員工帳號「${emp.user}」？\n\n- 報工記錄：${repCount} 筆（保留）\n- 考勤記錄：${attCount} 筆（保留）\n\n只刪除員工帳號，報工與考勤歷史資料將完整保留。`;
    if(!confirm(keepHistoryMsg)) return;
    await window._deleteDoc(window._doc(COL.employees,id));
    window.allEmployees=window.allEmployees.filter(e=>e.id!==id);
    renderEmployees();
  }catch(e){ alert('刪除失敗：'+e.message); }
}

window._purgeEmployeePlan=null;

async function openAdminPurgeEmployee(id){
  if(!isAdm()){ alert('僅管理員可使用徹底刪除'); return; }
  const emp=window.allEmployees.find(e=>e.id===id); if(!emp) return;
  try{
    const [repSnap,attSnap]=await Promise.all([
      window._getDocs(window._query(window._collection(COL.reports),window._where('empId','==',id))),
      window._getDocs(window._query(window._collection(COL.attendance),window._where('empId','==',id)))
    ]);
    const reports=repSnap.docs.map(d=>({ref:d.ref,id:d.id,...d.data()}));
    const active=reports.filter(r=>r.status==='pending'||r.status==='approved');
    if(active.some(r=>(r.qty||0)<=0)) throw new Error('存在數量異常的待審／已審報工，已停止徹底刪除');
    const procMap=new Map();
    const orphanKeys=new Set();
    const orphanOrderIds=new Set();
    for(const r of active){
      const key=reportProcessKey(r);
      if(procMap.has(key)||orphanKeys.has(key)) continue;
      try{
        const resolved=await resolveReportProcess(r);
        procMap.set(key,{ref:resolved.ref,data:resolved.data,pending:0,approved:0});
      }catch(resolveError){
        const orderSnap=await window._getDoc(window._doc(COL.orders,r.orderId));
        if(orderSnap.exists()) throw new Error(`訂單仍存在但無法安全找到工序：${r.orderNo||r.orderId} / ${r.code} / 工序 ${r.processNo}；${resolveError.message}`);
        orphanKeys.add(key);
        orphanOrderIds.add(r.orderId);
      }
    }
    active.forEach(r=>{
      const proc=procMap.get(reportProcessKey(r));
      if(!proc) return;
      if(r.status==='pending') proc.pending+=(r.qty||0);
      if(r.status==='approved') proc.approved+=(r.qty||0);
    });
    for(const proc of procMap.values()){
      if((proc.data.pendingQty||0)<proc.pending) throw new Error('工序待審數量不足，已停止徹底刪除');
      if((proc.data.approvedQty||0)<proc.approved) throw new Error('工序已審數量不足，已停止徹底刪除');
    }
    const writeCount=reports.length+attSnap.docs.length+procMap.size+1;
    if(writeCount>490) throw new Error(`相關資料共需 ${writeCount} 次寫入，超過單次安全刪除上限，請分批處理`);
    const counts={pending:0,approved:0,rejected:0,voided:0};
    reports.forEach(r=>{ if(counts[r.status]!==undefined) counts[r.status]++; });
    const pendingQty=reports.filter(r=>r.status==='pending'&&!orphanKeys.has(reportProcessKey(r))).reduce((s,r)=>s+(r.qty||0),0);
    const approvedQty=reports.filter(r=>r.status==='approved'&&!orphanKeys.has(reportProcessKey(r))).reduce((s,r)=>s+(r.qty||0),0);
    window._purgeEmployeePlan={emp,reports,attendance:attSnap.docs,procMap,orphanKeys,orphanOrderIds};
    g('purge-emp-id').value=id;
    g('purge-emp-input').value='';
    g('purge-emp-name').textContent=`${emp.user} / ${emp.name||''}`;
    g('purge-emp-summary').innerHTML=`
      <div>報工總數：<b>${reports.length}</b> 筆</div>
      <div>待審批：${counts.pending} 筆，回沖 <b>${pendingQty}</b> 件</div>
      <div>已審批：${counts.approved} 筆，回沖 <b>${approvedQty}</b> 件</div>
      <div>退回／作廢：${counts.rejected+counts.voided} 筆</div>
      <div>孤兒報工：<b>${reports.filter(r=>orphanKeys.has(reportProcessKey(r))).length}</b> 筆（訂單已不存在，直接刪除）</div>
      <div>考勤：<b>${attSnap.docs.length}</b> 筆</div>`;
    om('m-purge-employee');
  }catch(e){
    window._purgeEmployeePlan=null;
    alert('無法徹底刪除：'+e.message);
  }
}

async function confirmAdminPurgeEmployee(){
  if(!isAdm()){ alert('僅管理員可使用徹底刪除'); return; }
  const plan=window._purgeEmployeePlan;
  if(!plan||g('purge-emp-id').value!==plan.emp.id){ alert('刪除資料已失效，請重新操作'); return; }
  if(g('purge-emp-input').value.trim()!==plan.emp.user){ alert('員工工號輸入不符合'); return; }
  try{
    await window._runTransaction(async t=>{
      const empRef=window._doc(COL.employees,plan.emp.id);
      const reportSnaps=[];
      for(const r of plan.reports) reportSnaps.push(await t.get(r.ref));
      const procEntries=[...plan.procMap.entries()];
      const procSnaps=[];
      for(const [,p] of procEntries) procSnaps.push(await t.get(p.ref));
      const procSnapByKey=new Map(procEntries.map(([key],i)=>[key,procSnaps[i]]));
      const orphanOrderSnaps=[];
      for(const orderId of plan.orphanOrderIds) orphanOrderSnaps.push(await t.get(window._doc(COL.orders,orderId)));
      if(orphanOrderSnaps.some(s=>s.exists())) throw new Error('孤兒報工的訂單已重新建立，請重新操作');
      const decrements=new Map();
      reportSnaps.forEach((snap,i)=>{
        if(!snap.exists()) throw new Error('部分報工已變更，請重新操作');
        const r=snap.data();
        if(r.empId!==plan.emp.id) throw new Error('報工員工資料已變更');
        if(r.status!=='pending'&&r.status!=='approved') return;
        const key=reportProcessKey(r);
        if(plan.orphanKeys.has(key)) return;
        if(!plan.procMap.has(key)) throw new Error('報工狀態已變更，請重新操作');
        const processSnap=procSnapByKey.get(key);
        if(!processSnap?.exists()||!reportProcessMatches(r,processSnap.data())) throw new Error('報工與工序資料不符合，請重新操作');
        if(!decrements.has(key)) decrements.set(key,{pending:0,approved:0});
        const d=decrements.get(key);
        if(r.status==='pending') d.pending+=(r.qty||0);
        if(r.status==='approved') d.approved+=(r.qty||0);
      });
      procEntries.forEach(([key,p],i)=>{
        const snap=procSnaps[i];
        if(!snap.exists()) throw new Error('對應工序不存在');
        const d=decrements.get(key)||{pending:0,approved:0};
        if((snap.data().pendingQty||0)<d.pending||(snap.data().approvedQty||0)<d.approved) throw new Error('工序數量已變更，請重新操作');
        if(d.pending||d.approved) t.update(p.ref,{
          pendingQty:window._increment(-d.pending),
          approvedQty:window._increment(-d.approved)
        });
      });
      plan.reports.forEach(r=>t.delete(r.ref));
      plan.attendance.forEach(a=>t.delete(a.ref));
      t.delete(empRef);
    });
    window.allEmployees=window.allEmployees.filter(e=>e.id!==plan.emp.id);
    window._purgeEmployeePlan=null;
    cm('m-purge-employee');
    renderEmployees();
    alert('徹底刪除完成：員工帳號、報工與考勤已刪除，工序數量已回沖。');
  }catch(e){ alert('徹底刪除失敗，未執行任何刪除：'+e.message); }
}
