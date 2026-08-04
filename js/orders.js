// ===== 訂單系統資料 =====
window.allOrders    = [];
window.allEmployees = [];
window.allProcesses = [];
window._failedOrderCleanup = null;
let ordersLoadPromise = null;
let processesLoadPromise = null;

function usableOrders(){ return (window.allOrders||[]).filter(isOrderUsable); }
function setImportProgress(percent,vi,zh){
  g('imp-progress-wrap').style.display='block';
  g('imp-progress-bar').style.width=Math.max(0,Math.min(100,percent))+'%';
  g('imp-progress-text').innerHTML=`<div>${vi}</div><div style="margin-top:4px;color:var(--mu)">${zh}</div>`;
}
function makeOrderProcess(orderId,orderNo,item,op,now){
  return {orderId,orderNo,code:item.code,desc:item.desc,color:item.color,zh:item.zh,sz:item.sz,orderQty:item.qty,
    processNo:op.no,processCategory:op.category||'',processZh:op.zh||'',processVi:op.vi||'',processSec:op.sec||0,quoteSnapshotSec:op.sec||0,
    workStdSec:op.sec||0,slPerHour:Math.round((window.S?.ws||3000)/Math.max(op.sec||1,1)),
    approvedQty:0,pendingQty:0,createdAt:now};
}

const ORDER_PROCESS_CATEGORIES=[
  {code:'BL',vi:'Bị liệu',zh:'備料'},
  {code:'SX',vi:'Sản xuất',zh:'生產'},
  {code:'QC',vi:'Kiểm phẩm',zh:'品檢'},
  {code:'DG',vi:'Đóng gói',zh:'包裝'}
];
function weightedProcessProgress(procs){
  let completed=0,total=0;
  (procs||[]).forEach(p=>{
    const qty=Math.max(0,Number(p.orderQty)||0);
    const sec=Math.max(0,Number(p.workStdSec||p.processSec)||0);
    const approved=Math.min(qty,Math.max(0,Number(p.approvedQty)||0));
    total+=qty*sec;
    completed+=approved*sec;
  });
  return total>0?Math.min(100,Math.round(completed/total*100)):0;
}
function renderCategoryProgress(procs){
  return ORDER_PROCESS_CATEGORIES.map(category=>{
    const matched=procs.filter(p=>p.processCategory===category.code);
    const pct=weightedProcessProgress(matched);
    const value=matched.length?`${pct}%`:'—';
    return`<div style="width:86px;min-width:72px;flex:0 1 86px">
      <div style="font-size:9px;color:var(--mu);margin-bottom:2px;white-space:nowrap">${category.code} ${category.zh}</div>
      <div style="position:relative;height:11px;background:var(--bd);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${matched.length?pct:0}%;background:linear-gradient(90deg,#bfdbfe,#60a5fa)"></div>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9px;color:#1e3a5f">${value}</div>
      </div>
    </div>`;
  }).join('');
}

// ===== 載入訂單資料 =====
async function loadOrderData(){
  await Promise.all([reloadOrders(),reloadProcesses()]);
  fillOrderSelects();
  return {orders:window.allOrders,processes:window.allProcesses};
}

async function reloadProcesses(options={}){
  if(processesLoadPromise) return processesLoadPromise;
  processesLoadPromise=(async()=>{
    try{
      if(typeof window.firebaseLoadCachedCollection==='function'){
        window.allProcesses=await window.firebaseLoadCachedCollection(COL.processes,COL.processes,options);
      }else{
        const snap=await window._getDocs(window._collection(COL.processes));
        window.allProcesses=snap.docs.map(d=>({id:d.id,...d.data()}));
      }
      return window.allProcesses;
    }catch(e){
      console.error('reloadProcesses（重新載入工序）失敗：',e);
      throw e;
    }finally{
      processesLoadPromise=null;
    }
  })();
  return processesLoadPromise;
}

function updateApvBadge(n){
  const el=g('badge-apv'); if(!el) return;
  el.textContent=n; el.style.display=n>0?'inline':'none';
}

function fillOrderSelects(){
  ['prog-sel'].forEach(id=>{
    const sel=g(id); if(!sel) return;
    while(sel.options.length>1) sel.remove(1);
    usableOrders().forEach(o=>{
      const opt=document.createElement('option');
      opt.value=o.id;
      opt.textContent=`${o.orderId} · ${fmtVN(o.dueDate)}`;
      sel.appendChild(opt);
    });
  });
}

// ===== 匯入訂單 =====
async function openImportOrder(){
  if(!canManageOrders()) return;
  if(window.ensureProductsLoaded){
    const ok=await ensureProductsLoaded({requireMeta:true});
    if(!ok){ alert(window.lastProductSyncError || 'Không thể tải bảng công đoạn / 無法載入工序表'); return; }
  }
  g('imp-ord-id').value=''; g('imp-ord-date').value='';
  g('imp-file').value=''; g('imp-filename').textContent='';
  g('imp-step1').style.display='block'; g('imp-step2').style.display='none';
  g('imp-skip-msg').style.display='none';
  g('imp-progress-wrap').style.display='none';
  g('imp-cleanup-btn').style.display='none';
  window._impData=null;
  const clientSel=g('imp-ord-client');
  if(clientSel){
    clientSel.innerHTML='<option value="">-- 選擇客戶 --</option>';
    const clients=[...new Set((window.D||[]).map(p=>p.client).filter(Boolean))].sort();
    clients.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; clientSel.appendChild(o); });
  }
  om('m-import-order');
}

async function reloadOrders(options={}){
  if(ordersLoadPromise) return ordersLoadPromise;
  ordersLoadPromise=(async()=>{
    try{
      if(typeof window.firebaseLoadCachedCollection==='function'){
        window.allOrders=await window.firebaseLoadCachedCollection(COL.orders,COL.orders,options);
      }else{
        const snap=await window._getDocs(window._collection(COL.orders));
        window.allOrders=snap.docs.map(d=>({id:d.id,...d.data()}));
      }
      window.allOrders.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      fillOrderSelects();
      return window.allOrders;
    }finally{
      ordersLoadPromise=null;
    }
  })();
  return ordersLoadPromise;
}

function closeImportOrder(){
  window._impData=null;
  g('imp-file').value='';
  cm('m-import-order');
}

function handleImportFile(input){
  const file=input.files[0]; if(!file) return;
  processImportOrderFile(file,input);
}

function processImportOrderFile(file,input){
  const ordId=g('imp-ord-id').value.trim();
  const client=g('imp-ord-client')?.value||'';
  const dueDate=g('imp-ord-date').value;
  if(!ordId){ alert('請先填寫訂單編號'); if(input) input.value=''; return; }
  if(!client){ alert('請先選擇客戶 / Vui lòng chọn khách hàng'); if(input) input.value=''; return; }
  if(!dueDate){ alert('請先填寫出貨日期'); if(input) input.value=''; return; }
  g('imp-filename').textContent=file.name;
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const wb=XLSX.read(e.target.result,{type:'binary'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      let hRow=-1;
      for(let i=0;i<Math.min(10,rows.length);i++){
        const r=rows[i].map(c=>String(c).toUpperCase());
        if(r.some(c=>c.includes('ITEM')||c.includes('款號'))){ hRow=i; break; }
      }
      if(hRow<0){ alert('找不到標題列（需含 ITEM NO. 欄位）'); return; }
      const headers=rows[hRow].map(c=>String(c).toUpperCase().trim());
      const iItem=headers.findIndex(h=>h.includes('ITEM'));
      const iDesc=headers.findIndex(h=>h.includes('DESC'));
      const iColor=headers.findIndex(h=>h.includes('COLOR')||h.includes('顏色'));
      const iQty=headers.findIndex(h=>h.includes("Q'TY")||h.includes('QTY')||h.includes('數量'));
      const matched=[], skipped=[], errors=[], seenCodes=new Map();
      rows.slice(hRow+1).forEach((r,rowIndex)=>{
        const code=String(r[iItem]||'').trim();
        if(!code) return;
        const excelRow=hRow+2+rowIndex;
        const rawQty=String(r[iQty]??'').trim(), qty=Number(rawQty);
        if(seenCodes.has(code)){ errors.push(`Dòng ${excelRow}: mã hàng ${code} bị trùng / 第 ${excelRow} 列：款號 ${code} 重複`); return; }
        seenCodes.set(code,excelRow);
        if(!Number.isInteger(qty)||qty<=0){ errors.push(`Dòng ${excelRow}: số lượng không hợp lệ / 第 ${excelRow} 列：數量必須為正整數`); return; }
        const prod=window.D.find(p=>p.code===code);
        if(prod){
          matched.push({code,desc:String(r[iDesc]||'').trim(),color:String(r[iColor]||'').trim(),qty,ops:prod.ops||[],zh:prod.zh||'',sz:prod.sz||''});
        } else { errors.push(`Không tìm thấy mã hàng ${code} trong bảng công đoạn / 工序總表找不到款號 ${code}`); }
      });
      if(errors.length){ alert(errors.slice(0,15).join('\n')); window._impData=null; return; }
      window._impData={ordId,dueDate,matched,skipped};
      g('imp-step2').style.display='block';
      const _ioMsg=document.getElementById('imp-order-ok');
      if(_ioMsg) _ioMsg.innerHTML=`<div><i class="ti ti-check"></i> Tìm thấy <b>${matched.length}</b> mã hàng, tổng cộng <b>${matched.reduce((a,m)=>a+m.ops.length,0)}</b> công đoạn.</div><div style="margin-top:4px">找到 <b>${matched.length}</b> 個款號，共 <b>${matched.reduce((a,m)=>a+m.ops.length,0)}</b> 道工序。</div>`;
      if(skipped.length>0){
        const sm=g('imp-skip-msg'); sm.style.display='flex';
        sm.innerHTML=`<i class="ti ti-alert-triangle"></i> Bỏ qua ${skipped.length} mã hàng (không tìm thấy trong bảng công đoạn) / 跳過 ${skipped.length} 款（工序表找不到）：${skipped.slice(0,5).join('、')}${skipped.length>5?'...':''}`;
      }
      const tb=g('imp-preview-tb'); tb.innerHTML='';
      matched.forEach(m=>{
        const tr=document.createElement('tr');
        tr.innerHTML=`<td><b>${m.code}</b></td><td>${m.desc}</td><td>${m.color}</td><td>${m.qty.toLocaleString()}</td><td>${m.ops.length}</td><td><span class="tg tg2">Có thể nhập<br>可匯入</span></td>`;
        tb.appendChild(tr);
      });
      skipped.forEach(s=>{
        const tr=document.createElement('tr');
        tr.innerHTML=`<td><b>${s}</b></td><td colspan="4">-</td><td><span class="tg tr2">找不到工序</span></td>`;
        tb.appendChild(tr);
      });
    }catch(err){ alert('讀取失敗：'+err.message); }
  };
  reader.readAsBinaryString(file);
}

async function confirmImportOrder(){
  const d=window._impData;
  if(!d||!d.matched.length){ alert('請先上傳 Excel'); return; }
  if(!canManageOrders()) return;
  d.ordId = g('imp-ord-id').value.trim();
  const btn=g('imp-confirm-btn');
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i> Đang nhập / 匯入中';
  let orderRef=null, lockRef=null;
  try{
    if(!window.verifyProductsVersionForOrderImport) throw new Error('Không thể kiểm tra phiên bản mã hàng, vui lòng tải lại rồi thao tác.\n無法檢查款號版本，請重新載入後再操作。');
    await window.verifyProductsVersionForOrderImport();
    const duplicateOrders=await window._getDocs(window._query(window._collection(COL.orders),window._where('orderId','==',d.ordId)));
    const orphanProcs=await window._getDocs(window._query(window._collection(COL.processes),window._where('orderNo','==',d.ordId)));
    lockRef=window._doc(COL.orderLocks,orderLockId(d.ordId));
    const existingLock=await window._getDoc(lockRef);
    if(existingLock.exists()){
      if(existingLock.data().status!=='ready'){
        window._failedOrderCleanup={id:existingLock.data().orderId||duplicateOrders.docs[0]?.id||null,orderNo:d.ordId};
        g('imp-cleanup-btn').style.display='';
        throw new Error(`Số đơn hàng ${d.ordId} đang bị khóa bởi lần nhập trước.\n訂單號 ${d.ordId} 被先前的匯入鎖定，請確認後清理。`);
      }
      throw new Error(`Số đơn hàng ${d.ordId} đã tồn tại.\n訂單號 ${d.ordId} 已存在。`);
    }
    if(duplicateOrders.empty&&!orphanProcs.empty){
      window._failedOrderCleanup={id:null,orderNo:d.ordId};
      g('imp-cleanup-btn').style.display='';
      throw new Error(`Số đơn hàng ${d.ordId} còn dữ liệu công đoạn chưa dọn.\n訂單號 ${d.ordId} 仍有殘留工序資料，請先清理。`);
    }
    const incompleteOrder=duplicateOrders.docs.find(x=>x.data().importStatus&&x.data().importStatus!=='ready');
    if(incompleteOrder){
      window._failedOrderCleanup={id:incompleteOrder.id,orderNo:d.ordId};
      g('imp-cleanup-btn').style.display='';
      throw new Error(`Số đơn hàng ${d.ordId} có lần nhập chưa hoàn tất.\n訂單號 ${d.ordId} 存在未完成匯入，請先清理。`);
    }
    if(!duplicateOrders.empty) throw new Error(`Số đơn hàng ${d.ordId} đã tồn tại.\n訂單號 ${d.ordId} 已存在。`);
    await window._runTransaction(async t=>{
      const lockSnap=await t.get(lockRef);
      if(lockSnap.exists()) throw new Error(`Số đơn hàng ${d.ordId} đang được nhập hoặc đã tồn tại.\n訂單號 ${d.ordId} 正在匯入或已存在。`);
      t.set(lockRef,{orderNo:d.ordId,status:'importing',createdAt:Date.now(),createdBy:window.cu.user});
    });
    const now=Date.now();
    orderRef=await window._addDoc(window._collection(COL.orders),{
      orderId:d.ordId, dueDate:new Date(d.dueDate).getTime(),
      client:g('imp-ord-client')?.value||'',
      actualShipDate:new Date(d.dueDate).getTime(),
      actualShipDateManual:false,
      itemCount:d.matched.length,
      totalQty:d.matched.reduce((a,m)=>a+m.qty,0),
      createdAt:now, createdBy:window.cu.user,
      snapshotHr:getH(),
      snapshotWs:window.S?.ws||3000,
      importStatus:'importing'
    });
    const ordId=orderRef.id, processRows=[];
    d.matched.forEach(item=>(item.ops||[]).forEach(op=>processRows.push(makeOrderProcess(ordId,d.ordId,item,op,now))));
    const totalBatches=Math.max(1,Math.ceil(processRows.length/450));
    for(let offset=0,batchNo=1;offset<processRows.length;offset+=450,batchNo++){
      setImportProgress(Math.round(offset/processRows.length*100),
        `Đang nhập đợt ${batchNo}/${totalBatches}. Tổng cộng ${processRows.length} công đoạn.`,
        `正在匯入第 ${batchNo}/${totalBatches} 批，共 ${processRows.length} 道工序。`);
      const batch=window._writeBatch();
      processRows.slice(offset,offset+450).forEach(row=>batch.set(window._newDocRef(COL.processes),row));
      await batch.commit();
    }
    await window._updateDoc(lockRef,{status:'ready',orderId:ordId,completedAt:Date.now()});
    await window._updateDoc(orderRef,{importStatus:'ready',importCompletedAt:Date.now()});
    setImportProgress(100,'Nhập đơn hàng hoàn tất.','訂單匯入完成。');
    const dueDate=new Date(d.dueDate).getTime();
    window.allOrders.unshift({id:ordId,orderId:d.ordId,client:g('imp-ord-client')?.value||'',dueDate,actualShipDate:dueDate,itemCount:d.matched.length,totalQty:d.matched.reduce((a,m)=>a+m.qty,0),createdAt:now,importStatus:'ready'});
    closeImportOrder();
    await reloadProcesses();
    renderOrders(); renderProgress();
    alert(`Nhập đơn hàng thành công!\nĐơn hàng: ${d.ordId}\nMã hàng: ${d.matched.length}\nCông đoạn: ${d.matched.reduce((a,m)=>a+m.ops.length,0)}\n\n訂單匯入成功！\n訂單：${d.ordId}\n款號：${d.matched.length}\n工序：${d.matched.reduce((a,m)=>a+m.ops.length,0)}`);
  }catch(err){
    let cleaned=!orderRef;
    if(!orderRef&&lockRef){
      try{ await window._deleteDoc(lockRef); }
      catch(e){
        cleaned=false;
        window._failedOrderCleanup={id:null,orderNo:d.ordId};
        g('imp-cleanup-btn').style.display='';
      }
    }
    if(orderRef){
      try{ await cleanupFailedOrder(orderRef.id,d.ordId,true); cleaned=true; }
      catch(cleanErr){
        try{ await window._updateDoc(orderRef,{importStatus:'failed',importError:err.message}); }catch(e){}
        window._failedOrderCleanup={id:orderRef.id,orderNo:d.ordId};
        window.allOrders.unshift({id:orderRef.id,orderId:d.ordId,importStatus:'failed',createdAt:Date.now()});
        renderOrders();
        g('imp-cleanup-btn').style.display='';
      }
    }
    alert(`Nhập đơn hàng thất bại.${cleaned?' Không lưu dữ liệu đơn hàng.':' Vui lòng dọn dữ liệu thất bại trước khi nhập lại.'}\n訂單匯入失敗。${cleaned?'未保留任何訂單資料。':'請先清理失敗資料後再重新匯入。'}\n\n${err.message}`);
  }
  finally{ btn.disabled=false; btn.innerHTML='<i class="ti ti-check"></i>確認匯入'; }
}

async function cleanupFailedOrder(orderId,orderNo,silent=false){
  if(!canManageOrders()) return;
  if(!silent&&!confirm(`Dọn toàn bộ dữ liệu nhập chưa hoàn tất của đơn ${orderNo}?\n確定清理訂單 ${orderNo} 的所有未完成匯入資料？`)) return;
  const procQuery=orderId
    ?window._query(window._collection(COL.processes),window._where('orderId','==',orderId))
    :window._query(window._collection(COL.processes),window._where('orderNo','==',orderNo));
  const snap=await window._getDocs(procQuery);
  for(let i=0;i<snap.docs.length;i+=450){
    const batch=window._writeBatch();
    snap.docs.slice(i,i+450).forEach(d=>batch.delete(d.ref));
    await batch.commit();
  }
  if(orderId){
    await window._deleteDoc(window._doc(COL.orders,orderId));
  }
  await window._deleteDoc(window._doc(COL.orderLocks,orderLockId(orderNo)));
  window.allOrders=window.allOrders.filter(o=>o.id!==orderId);
  window.allProcesses=window.allProcesses.filter(p=>p.orderId!==orderId);
  window._failedOrderCleanup=null;
  g('imp-cleanup-btn').style.display='none';
  if(!silent) alert(`Đã dọn dữ liệu nhập thất bại của đơn ${orderNo}.\n已清理訂單 ${orderNo} 的匯入失敗資料。`);
}
function retryFailedImportCleanup(){
  const x=window._failedOrderCleanup;
  if(x) cleanupFailedOrder(x.id,x.orderNo);
}

// ===== 訂單列表 =====
function toggleOrderManager(){
  const panel=g('order-manager-panel');
  if(!panel) return;
  const open=panel.classList.toggle('open');
  const button=panel.querySelector('.order-manager-toggle');
  if(button) button.setAttribute('aria-expanded',open?'true':'false');
  if(open) renderOrders();
}

function renderOrders(){
  const q=(g('ord-q')?.value||'').toLowerCase();
  const statusFilter=(g('ord-status-filter')?.value||'active');
  const tb=g('ord-tb'); if(!tb) return;
  const empty=g('ord-empty');
  tb.innerHTML='';
  const list=window.allOrders.filter(o=>{
    const life=o.lifecycleStatus||'active';
    const statusMatch=statusFilter==='all'
      ||(statusFilter==='archived'&&(life==='archived'||life==='deleting'))
      ||(statusFilter==='active'&&life==='active');
    return statusMatch&&(!q||o.orderId.toLowerCase().includes(q));
  });
  if(!list.length){ if(empty) empty.style.display='block'; return; }
  if(empty) empty.style.display='none';
  list.forEach(o=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td><b style="color:var(--navy)">${o.orderId}</b></td>
      <td>${o.itemCount||0}</td>
      <td>${(o.totalQty||0).toLocaleString()}</td>
      <td>${fmtVN(o.dueDate)}</td>
      <td style="min-width:120px">
        <div style="background:#e2e8f0;border-radius:99px;height:8px;overflow:hidden"><div style="height:100%;background:var(--accent);width:0%"></div></div>
        <div style="font-size:11px;color:${o.importStatus==='failed'||o.lifecycleStatus==='deleting'?'var(--err)':'var(--mu)'};margin-top:3px">${o.lifecycleStatus==='archived'?'Đã xóa (lưu trữ) / 已刪除（封存）':o.lifecycleStatus==='deleting'?'Đang xóa vĩnh viễn / 永久刪除中':o.importStatus==='failed'?'Nhập thất bại / 匯入失敗':o.importStatus==='importing'?'Đang nhập / 匯入中':'統計中...'}</div>
      </td>
      <td><div style="display:flex;gap:4px">
        ${isOrderUsable(o)?`<button class="btn bsm" onclick="viewOrderProgress('${o.id}')"><i class="ti ti-chart-bar"></i></button>`:''}
        ${o.importStatus==='failed'&&canManageOrders()?`<button class="btn bsm" onclick="cleanupFailedOrder('${o.id}','${o.orderId}')"><i class="ti ti-broom"></i></button>`:''}
        ${isOrderUsable(o)?`<button class="btn bsm bd2" title="Xóa (Lưu trữ) / 刪除（封存）" onclick="openOrderDeleteWarning('archive','${o.id}','${o.orderId}')"><i class="ti ti-trash"></i></button>`:''}
        ${isOrderUsable(o)&&window.cu?.role==='admin'?`<button class="btn bsm bd2" style="background:var(--errl);color:var(--err)" title="Xóa vĩnh viễn / 永久刪除" onclick="openOrderDeleteWarning('purge','${o.id}','${o.orderId}')"><i class="ti ti-database-off"></i></button>`:''}
        ${o.lifecycleStatus==='archived'&&canManageOrders()?`<button class="btn bsm" onclick="restoreArchivedOrder('${o.id}','${o.orderId}')"><i class="ti ti-restore"></i>Khôi phục / 還原</button>`:''}
        ${(o.lifecycleStatus==='archived'||o.lifecycleStatus==='deleting')&&window.cu?.role==='admin'?`<button class="btn bsm bd2" style="background:var(--errl);color:var(--err)" title="Xóa vĩnh viễn / 永久刪除" onclick="openOrderDeleteWarning('purge','${o.id}','${o.orderId}')"><i class="ti ti-database-off"></i></button>`:''}
      </div></td>`;
    tb.appendChild(tr);
  });
  fillOrderSelects();
}

function viewOrderProgress(id){
  g('prog-sel').value=id; sp('progress'); renderProgress();
}

async function getOrderDeleteData(id,name){
  const [procSnap,repSnap,adjSnap]=await Promise.all([
    window._getDocs(window._query(window._collection(COL.processes),window._where('orderId','==',id))),
    window._getDocs(window._query(window._collection(COL.reports),window._where('orderId','==',id))),
    window._getDocs(window._query(window._collection(COL.orderAdjustments),window._where('orderId','==',id)))
  ]);
  const reports=repSnap.docs.map(d=>({...d.data(),ref:d.ref}));
  const counts={pending:0,approved:0,rejected:0,voided:0};
  reports.forEach(r=>{ if(counts[r.status]!==undefined) counts[r.status]++; });
  return {id,name,processes:procSnap.docs,reports,adjustments:adjSnap.docs,counts};
}

function openOrderDeleteWarning(mode,id,name){
  if(mode==='purge'&&window.cu?.role!=='admin') return;
  window._orderDeleteRequest={mode,id,name};
  const archive=mode==='archive';
  g('order-delete-warning-title').innerHTML=`<i class="ti ${archive?'ti-trash':'ti-database-off'}"></i> ${archive?'Xóa (Lưu trữ) / 刪除（封存）':'Xóa vĩnh viễn / 永久刪除'}`;
  g('order-delete-warning-text').innerHTML=archive
    ?'<div>Xóa (Lưu trữ) sẽ ẩn đơn hàng và ngừng báo công, nhưng giữ toàn bộ dữ liệu lịch sử.</div><div style="margin-top:10px">刪除（封存）會隱藏訂單並停止報工，但保留全部歷史資料。</div>'
    :'<div>Xóa vĩnh viễn sẽ xóa đơn hàng, công đoạn, toàn bộ báo công và lịch sử điều chỉnh. Không thể khôi phục.</div><div style="margin-top:10px">永久刪除會移除訂單、工序、全部報工及數量調整紀錄，無法復原。</div>';
  om('m-order-delete-warning');
}

function closeOrderDeleteWarning(){
  window._orderDeleteRequest=null;
  cm('m-order-delete-warning');
}

function continueOrderDelete(){
  const request=window._orderDeleteRequest;
  if(!request) return;
  cm('m-order-delete-warning');
  openOrderDelete(request.mode,request.id,request.name);
}

async function openOrderDelete(mode,id,name){
  try{
    const data=await getOrderDeleteData(id,name);
    data.mode=mode;
    window._orderDeleteData=data;
    window._orderDeleteRequest=null;
    g('order-delete-id').value=id;
    g('order-delete-name').value=name;
    g('order-delete-confirm').value='';
    const archive=mode==='archive';
    g('order-delete-title').innerHTML=`<i class="ti ${archive?'ti-trash':'ti-database-off'}"></i> ${archive?'Xóa (Lưu trữ) / 刪除（封存）':'Xóa vĩnh viễn / 永久刪除'}`;
    g('order-delete-summary').innerHTML=`<div><b>Đơn hàng / 訂單：</b>${name}</div>
      <div><b>Công đoạn / 工序：</b>${data.processes.length}</div>
      <div><b>Báo công chờ duyệt / 待審報工：</b>${data.counts.pending}</div>
      <div><b>Báo công đã duyệt / 已通過報工：</b>${data.counts.approved}</div>
      <div><b>Báo công trả lại / 退回報工：</b>${data.counts.rejected}</div>
      <div><b>Báo công đã hủy / 作廢報工：</b>${data.counts.voided}</div>
      <div><b>Lịch sử điều chỉnh / 數量調整紀錄：</b>${data.adjustments.length}</div>
      ${archive&&data.counts.pending?'<div style="color:var(--err);margin-top:10px">Còn báo công chờ duyệt, không thể xóa (lưu trữ).<br>仍有待審報工，無法刪除（封存）。</div>':''}`;
    g('order-archive-btn').style.display=archive?'':'none';
    g('order-purge-btn').style.display=archive?'none':'';
    updateOrderDeleteButtons();
    om('m-order-delete');
  }catch(e){ alert('載入刪除資料失敗：'+e.message); }
}

function closeOrderDeleteModal(){
  window._orderDeleteData=null;
  cm('m-order-delete');
}

function updateOrderDeleteButtons(){
  const data=window._orderDeleteData;
  const matched=!!data&&g('order-delete-confirm').value.trim()===data.name;
  g('order-archive-btn').disabled=!matched||data?.mode!=='archive'||data?.counts.pending>0;
  g('order-purge-btn').disabled=!matched||data?.mode!=='purge'||window.cu?.role!=='admin';
}

async function confirmArchiveOrder(){
  const data=window._orderDeleteData;
  if(!data||g('order-delete-confirm').value.trim()!==data.name||data.counts.pending>0) return;
  try{
    const ref=window._doc(COL.orders,data.id);
    await window._runTransaction(async t=>{
      const snap=await t.get(ref);
      if(!snap.exists()||!isOrderUsable(snap.data())) throw new Error('Đơn hàng không thể xóa (lưu trữ) / 訂單目前無法刪除（封存）');
      t.update(ref,{lifecycleStatus:'archived',archivedAt:Date.now(),archivedBy:window.cu.user});
    });
    const pending=await window._getDocs(window._query(window._collection(COL.reports),window._where('orderId','==',data.id),window._where('status','==','pending')));
    if(!pending.empty){
      await window._updateDoc(ref,{lifecycleStatus:'active',restoredAt:Date.now(),restoredBy:window.cu.user});
      throw new Error('Có báo công chờ duyệt mới phát sinh. Đơn hàng đã được khôi phục. / 發現新待審報工，訂單已自動還原。');
    }
    const o=window.allOrders.find(x=>x.id===data.id);
    if(o){ o.lifecycleStatus='archived'; o.archivedAt=Date.now(); o.archivedBy=window.cu.user; }
    closeOrderDeleteModal();
    fillOrderSelects(); renderOrders(); renderProgress();
    alert('Đã xóa (lưu trữ) đơn hàng. Toàn bộ lịch sử vẫn được giữ lại.\n訂單已刪除（封存），全部歷史資料均保留。');
  }catch(e){ alert('刪除（封存）失敗：'+e.message); }
}

async function restoreArchivedOrder(id,name){
  if(!canManageOrders()||!confirm(`Khôi phục đơn hàng「${name}」?\n還原訂單「${name}」？`)) return;
  try{
    const ref=window._doc(COL.orders,id);
    await window._runTransaction(async t=>{
      const snap=await t.get(ref);
      if(!snap.exists()||snap.data().lifecycleStatus!=='archived') throw new Error('訂單不是封存狀態');
      t.update(ref,{lifecycleStatus:'active',restoredAt:Date.now(),restoredBy:window.cu.user});
    });
    const o=window.allOrders.find(x=>x.id===id);
    if(o) o.lifecycleStatus='active';
    fillOrderSelects(); renderOrders(); renderProgress();
  }catch(e){ alert('還原失敗：'+e.message); }
}

async function deleteDocsInBatches(docs){
  for(let i=0;i<docs.length;i+=450){
    const batch=window._writeBatch();
    docs.slice(i,i+450).forEach(d=>batch.delete(d.ref));
    await batch.commit();
  }
}

async function confirmPurgeOrder(){
  const data=window._orderDeleteData;
  if(window.cu?.role!=='admin'||!data||g('order-delete-confirm').value.trim()!==data.name) return;
  try{
    const orderRef=window._doc(COL.orders,data.id);
    const lockRef=window._doc(COL.orderLocks,orderLockId(data.name));
    await window._runTransaction(async t=>{
      const snap=await t.get(orderRef);
      if(!snap.exists()) throw new Error('訂單不存在');
      if(snap.data().lifecycleStatus!=='deleting'){
        t.update(orderRef,{lifecycleStatus:'deleting',deletingAt:Date.now(),deletingBy:window.cu.user});
      }
    });
    const fresh=await getOrderDeleteData(data.id,data.name);
    const docs=[...fresh.processes,...fresh.reports,...fresh.adjustments];
    if(docs.length+2<=450){
      const batch=window._writeBatch();
      docs.forEach(d=>batch.delete(d.ref));
      batch.delete(lockRef);
      batch.delete(orderRef);
      await batch.commit();
    }else{
      await deleteDocsInBatches(docs);
      const finalBatch=window._writeBatch();
      finalBatch.delete(lockRef);
      finalBatch.delete(orderRef);
      await finalBatch.commit();
    }
    window.allOrders=window.allOrders.filter(o=>o.id!==data.id);
    window.allProcesses=window.allProcesses.filter(p=>p.orderId!==data.id);
    closeOrderDeleteModal();
    fillOrderSelects(); renderOrders(); renderProgress();
    alert('Đã xóa vĩnh viễn dữ liệu thử nghiệm.\n已永久刪除測試資料。');
  }catch(e){
    alert('永久刪除失敗，可再次執行以繼續清理：'+e.message);
    closeOrderDeleteModal();
    await reloadOrders(); await reloadProcesses(); renderOrders(); renderProgress();
  }
}

// ===== 訂單進度 =====
async function renderProgress(){
  const ordId=g('prog-sel')?.value;
  const codeQuery=(g('prog-code-q')?.value||'').trim().toLowerCase();
  const filter=g('prog-filter')?.value||'active';
  const content=g('prog-content'); if(!content) return;
  content.innerHTML='<div style="padding:20px;text-align:center;color:var(--mu)">載入中...</div>';
  try{
    const now=Date.now();
    const twoMonths=60*24*60*60*1000;
    const allProcs=window.allProcesses||[];
    const progMap={};
    allProcs.forEach(p=>{
      if(!progMap[p.orderId]) progMap[p.orderId]={procs:[]};
      progMap[p.orderId].procs.push(p);
    });
    let orders=usableOrders();
    if(ordId) orders=orders.filter(o=>o.id===ordId);
    if(codeQuery){
      const matchingOrderIds=new Set(
        allProcs
          .filter(p=>String(p.code||'').toLowerCase().includes(codeQuery))
          .map(p=>p.orderId)
      );
      orders=orders.filter(o=>matchingOrderIds.has(o.id));
    }
    let list=orders.map(o=>{
      const pm=progMap[o.id]||{procs:[]};
      const pct=weightedProcessProgress(pm.procs);
      const actualShipDate=o.actualShipDate||(o.dueDate||null);
      return{...o,pct,pm,actualShipDate};
    });
    list=list.filter(o=>{
      const asd=o.actualShipDate;
      if(!asd) return true;
      return (asd+twoMonths)>now;
    });
    if(filter==='active') list=list.filter(o=>o.pct<100);
    else if(filter==='done') list=list.filter(o=>o.pct>=100);
    list.sort((a,b)=>(a.actualShipDate||0)-(b.actualShipDate||0));
    if(!list.length){
      content.innerHTML='<div style="text-align:center;padding:40px;color:var(--mu)"><i class="ti ti-inbox" style="font-size:32px;display:block;margin-bottom:8px"></i>Không có đơn hàng / 尚無訂單</div>';
      return;
    }
    const thS='padding:6px 8px;text-align:left;background:var(--sf);position:sticky;top:0;z-index:1;border-bottom:1px solid var(--bd);white-space:nowrap;font-size:11px;font-weight:500;color:var(--mu)';
    let html='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>';
    html+=`<th style="${thS};width:36px">No</th>`;
    html+=`<th style="${thS};width:80px">Khách hàng<br><span style="font-size:10px;font-weight:400">客人</span></th>`;
    html+=`<th style="${thS};width:110px">Số đơn hàng<br><span style="font-size:10px;font-weight:400">訂單號碼</span></th>`;
    html+=`<th style="${thS};width:70px">Số lượng<br><span style="font-size:10px;font-weight:400">數量</span></th>`;
    html+=`<th style="${thS};width:120px">Tiến độ<br><span style="font-size:10px;font-weight:400">生產進度%</span></th>`;
    html+=`<th style="${thS};width:90px">Theo PO<br><span style="font-size:10px;font-weight:400">出貨日期PO</span></th>`;
    html+=`<th style="${thS};width:120px">Hoàn thành<br><span style="font-size:10px;font-weight:400">實際完成日</span></th>`;
    html+=`<th style="${thS};width:120px">Xuất hàng<br><span style="font-size:10px;font-weight:400">實際出貨日</span></th>`;
    html+=`<th style="${thS}">Ghi chú<br><span style="font-size:10px;font-weight:400">備註</span></th>`;
    html+=`<th style="${thS};width:60px"></th>`;
    html+='</tr></thead><tbody>';
    list.forEach((o,idx)=>{
      const pct=o.pct;
      const totalQty=o.totalQty||0;
      const actualCompleteDateVal=o.actualCompleteDate?formatLocalDate(o.actualCompleteDate):'';
      const actualShipDateVal=o.actualShipDate?formatLocalDate(o.actualShipDate):(o.dueDate?formatLocalDate(o.dueDate):'');
      const remarkVal=(o.remark||'').replace(/"/g,'&quot;');
      html+=`<tr style="cursor:pointer" onclick="toggleProgDetail('${o.id}')">
        <td style="color:var(--mu);padding:6px 8px;font-size:12px">${idx+1}</td>
        <td style="padding:6px 8px;font-size:12px"><b>${o.client||'-'}</b></td>
        <td style="font-family:var(--font-mono,monospace);font-size:11px;padding:6px 8px">${o.orderId}</td>
        <td style="padding:6px 8px;font-size:12px">${totalQty.toLocaleString()}</td>
        <td>
          <div style="position:relative;height:20px;background:var(--bd);border-radius:4px;overflow:hidden">
            <div style="position:absolute;left:0;top:0;height:100%;width:${Math.min(pct,100)}%;background:linear-gradient(90deg,#93c5fd,#3b82f6)"></div>
            <div style="position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:#1e3a5f">${pct}%</div>
          </div>
        </td>
        <td>${fmtVN(o.dueDate)}</td>
        <td onclick="event.stopPropagation()"><input type="date" value="${actualCompleteDateVal}" onchange="saveProgField('${o.id}','actualCompleteDate',this.value)" style="border:1px solid var(--bd);border-radius:6px;padding:4px 6px;font-size:12px;width:130px"></td>
        <td onclick="event.stopPropagation()"><input type="date" value="${actualShipDateVal}" onchange="saveProgField('${o.id}','actualShipDate',this.value,true)" style="border:1px solid var(--bd);border-radius:6px;padding:4px 6px;font-size:12px;width:130px"></td>
        <td onclick="event.stopPropagation();openRemarkEdit('${o.id}','${remarkVal}')" title="${remarkVal}" style="cursor:pointer;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 8px;font-size:12px;color:${o.remark?'var(--navy)':'var(--mu)'}">${o.remark||'備註...'}</td>
        <td style="padding:6px 8px" onclick="event.stopPropagation()">
          <button class="btn bsm bd2" title="Xóa (Lưu trữ) / 刪除（封存）" onclick="openOrderDeleteWarning('archive','${o.id}','${o.orderId}')"><i class="ti ti-trash"></i></button>
          ${window.cu?.role==='admin'?`<button class="btn bsm bd2" style="background:var(--errl);color:var(--err)" title="Xóa vĩnh viễn / 永久刪除" onclick="openOrderDeleteWarning('purge','${o.id}','${o.orderId}')"><i class="ti ti-database-off"></i></button>`:''}
        </td>
      </tr>
      <tr id="prog-detail-${o.id}" style="display:none">
        <td colspan="10" style="padding:0;background:var(--bg)">
          <div id="prog-detail-body-${o.id}" style="padding:10px 16px"></div>
        </td>
      </tr>`;
    });
    html+='</tbody></table></div>';
    content.innerHTML=html;
    if(codeQuery) list.forEach(o=>toggleProgDetail(o.id));
  }catch(e){
    content.innerHTML='<div style="color:var(--err);padding:20px">載入失敗：'+e.message+'</div>';
    console.error('renderProgress error:',e);
  }
}

async function saveProgField(ordId, field, value, isShipDate=false){
  try{
    const update={[field]: (field==='remark')?value:(value?new Date(value).getTime():null)};
    if(isShipDate) update.actualShipDateManual=true;
    await window._updateDoc(window._doc(COL.orders,ordId),update);
    const o=window.allOrders.find(x=>x.id===ordId);
    if(o){ o[field]=update[field]; if(isShipDate) o.actualShipDateManual=true; }
  }catch(e){ alert('儲存失敗：'+e.message); }
}

function openRemarkEdit(ordId, current){
  const val=prompt('Ghi chú / 備註：', current||'');
  if(val===null) return;
  saveProgField(ordId,'remark',val).then(()=>renderProgress());
}

function toggleProgDetail(ordId){
  const row=document.getElementById('prog-detail-'+ordId);
  const btn=document.getElementById('prog-btn-'+ordId);
  if(!row) return;
  const isOpen=row.style.display!=='none';
  if(isOpen){
    row.style.display='none';
    if(btn) btn.innerHTML='<i class="ti ti-chevron-down"></i>';
    return;
  }
  row.style.display='';
  if(btn) btn.innerHTML='<i class="ti ti-chevron-up"></i>';
  const body=document.getElementById('prog-detail-body-'+ordId);
  if(!body) return;
  const codeQuery=(g('prog-code-q')?.value||'').trim().toLowerCase();
  const procs=(window.allProcesses||[]).filter(p=>p.orderId===ordId);
  const byCode={};
  procs.forEach(p=>{
    if(codeQuery&&!String(p.code||'').toLowerCase().includes(codeQuery)) return;
    if(!byCode[p.code]) byCode[p.code]=[];
    byCode[p.code].push(p);
  });
  let html='';
  Object.entries(byCode).forEach(([code,cp])=>{
    const cDone=cp.length?Math.min(...cp.map(p=>p.approvedQty||0)):0;
    const safeCode=String(code).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const detailId='prog-code-'+ordId+'-'+encodeURIComponent(code).replace(/%/g,'_');
    html+=`<div style="margin-bottom:10px">
      <div onclick="toggleProgCodeDetail('${ordId}','${safeCode}','${detailId}')" style="cursor:pointer;font-size:12px;font-weight:500;color:var(--navy);padding:8px 4px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:8px;white-space:nowrap">
        <i id="${detailId}-icon" class="ti ti-chevron-right" style="color:var(--accent)"></i>
        <b>${code}</b><span style="font-size:11px;color:var(--mu);overflow:hidden;text-overflow:ellipsis;min-width:80px;max-width:240px">${cp[0].desc||''} ${cp[0].color||''}</span>
        <span style="margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;color:var(--accent);min-width:0">
          <span style="display:flex;align-items:center;justify-content:flex-end;gap:6px;min-width:0">${renderCategoryProgress(cp)}</span>
          <span>${cDone.toLocaleString()}/${(cp[0].orderQty||0).toLocaleString()}</span>
          ${canManageOrders()?`<button class="btn bsm" title="Điều chỉnh SL / 調整數量" aria-label="Điều chỉnh SL / 調整數量" onclick="event.stopPropagation();openOrderQtyAdjust('${ordId}','${code}')"><i class="ti ti-edit"></i></button>`:''}
        </span>
      </div>
      <div id="${detailId}" style="display:none"></div>
    </div>`;
  });
  body.innerHTML=html||'<span style="color:var(--mu);font-size:12px">無工序資料</span>';
}

function toggleProgCodeDetail(ordId,code,detailId){
  const detail=document.getElementById(detailId), icon=document.getElementById(detailId+'-icon');
  if(!detail) return;
  if(detail.style.display!=='none'){
    detail.style.display='none';
    if(icon) icon.className='ti ti-chevron-right';
    return;
  }
  const cp=(window.allProcesses||[]).filter(p=>p.orderId===ordId&&p.code===code);
  const procRows=cp.sort((a,b)=>compareProcessNo(a.processNo,b.processNo)).map(p=>{
    const rem=Math.max(0,(p.orderQty||0)-(p.approvedQty||0)-(p.pendingQty||0));
    const pg=p.orderQty>0?Math.round((p.approvedQty||0)/p.orderQty*100):0;
    return`<tr>
      <td style="padding:3px 6px;font-size:12px">${p.processNo}</td>
      <td style="padding:3px 6px;font-size:12px">${p.processCategory||'—'} · ${processCategoryLabel(p.processCategory)}</td>
      <td style="padding:3px 6px;font-size:12px">${p.processVi||p.processZh||''}</td>
      <td style="padding:3px 6px;text-align:right;font-size:12px">${(p.orderQty||0).toLocaleString()}</td>
      <td style="padding:3px 6px;text-align:right;color:var(--ok);font-weight:500;font-size:12px">${(p.approvedQty||0).toLocaleString()}</td>
      <td style="padding:3px 6px;text-align:right;color:var(--warn);font-size:12px">${(p.pendingQty||0).toLocaleString()}</td>
      <td style="padding:3px 6px;text-align:right;color:var(--accent);font-size:12px">${rem.toLocaleString()}</td>
      <td style="padding:3px 6px;width:100px"><div style="position:relative;height:16px;background:var(--bd);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.min(pg,100)}%;background:linear-gradient(90deg,#93c5fd,#3b82f6)"></div><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#1e3a5f">${pg}%</div></div></td>
    </tr>`;
  }).join('');
  detail.innerHTML=`<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--sf)">
    <th style="padding:4px 6px;text-align:left;width:60px;font-size:11px">Số CĐ<br><span style="font-weight:400;color:var(--mu)">工序號</span></th>
    <th style="padding:4px 6px;text-align:left;width:90px;font-size:11px">Phân loại<br><span style="font-weight:400;color:var(--mu)">加工分類</span></th>
    <th style="padding:4px 6px;text-align:left;font-size:11px">Tên CĐ<br><span style="font-weight:400;color:var(--mu)">工序名稱</span></th>
    <th style="padding:4px 6px;text-align:right;width:70px;font-size:11px">SL đơn<br><span style="font-weight:400;color:var(--mu)">訂單量</span></th>
    <th style="padding:4px 6px;text-align:right;width:70px;font-size:11px">Đã duyệt<br><span style="font-weight:400;color:var(--mu)">已通過</span></th>
    <th style="padding:4px 6px;text-align:right;width:70px;font-size:11px">Chờ duyệt<br><span style="font-weight:400;color:var(--mu)">待審批</span></th>
    <th style="padding:4px 6px;text-align:right;width:70px;font-size:11px">Còn lại<br><span style="font-weight:400;color:var(--mu)">剩餘</span></th>
    <th style="padding:4px 6px;width:100px;font-size:11px">Tiến độ<br><span style="font-weight:400;color:var(--mu)">進度</span></th>
  </tr></thead><tbody>${procRows}</tbody></table>`;
  detail.style.display='';
  if(icon) icon.className='ti ti-chevron-down';
}

async function openOrderQtyAdjust(orderId,code){
  if(!canManageOrders()) return;
  const procs=(window.allProcesses||[]).filter(p=>p.orderId===orderId&&p.code===code);
  if(!procs.length) return;
  const order=window.allOrders.find(o=>o.id===orderId);
  const current=procs[0].orderQty||0;
  const minimum=Math.max(...procs.map(p=>(p.approvedQty||0)+(p.pendingQty||0)));
  g('adj-order-id').value=orderId; g('adj-code').value=code;
  g('adj-new-qty').value=current; g('adj-reason').value='';
  g('adj-summary').innerHTML=`<div>Đơn hàng/訂單: <b>${order?.orderId||''}</b></div>
    <div>Mã hàng/款號: <b>${code}</b></div>
    <div>Số lượng hiện tại/目前數量: <b>${current.toLocaleString()}</b></div>
    <div>Số lượng tối thiểu/最低可調整數量: <b>${minimum.toLocaleString()}</b></div>
    <div>Công đoạn bị ảnh hưởng/影響工序: <b>${procs.length}</b></div>`;
  om('m-order-qty-adjust');
}

async function confirmOrderQtyAdjust(){
  if(!canManageOrders()) return;
  const orderId=g('adj-order-id').value, code=g('adj-code').value;
  const newQty=Number(g('adj-new-qty').value), reason=g('adj-reason').value.trim();
  if(!Number.isInteger(newQty)||newQty<=0||!reason){ alert('Vui lòng nhập số lượng nguyên dương và lý do.\n請輸入正整數數量與調整原因。'); return; }
  try{
    const orderRef=window._doc(COL.orders,orderId);
    const procQuery=window._query(window._collection(COL.processes),window._where('orderId','==',orderId),window._where('code','==',code));
    const initialProcSnap=await window._getDocs(procQuery);
    if(initialProcSnap.empty) throw new Error('Không tìm thấy công đoạn / 找不到工序');
    const logRef=window._newDocRef(COL.orderAdjustments);
    await window._runTransaction(async t=>{
      const orderSnap=await t.get(orderRef);
      const procSnaps=[];
      for(const d of initialProcSnap.docs) procSnaps.push(await t.get(d.ref));
      if(!orderSnap.exists()||!isOrderUsable(orderSnap.data())) throw new Error('Đơn hàng không thể điều chỉnh / 訂單目前不可調整');
      if(procSnaps.some(d=>!d.exists())) throw new Error('Dữ liệu công đoạn đã thay đổi / 工序資料已變更');
      const oldQty=procSnaps[0].data().orderQty||0;
      if(procSnaps.some(d=>(d.data().orderQty||0)!==oldQty)) throw new Error('Số lượng giữa các công đoạn không đồng nhất / 各工序訂單數量不一致');
      if(newQty===oldQty) throw new Error('Số lượng mới không thay đổi / 新數量沒有變更');
      procSnaps.forEach(d=>{
        const p=d.data(), minimum=(p.approvedQty||0)+(p.pendingQty||0);
        if(newQty<minimum) throw new Error(`${p.processNo}: tối thiểu ${minimum} / 最低 ${minimum}`);
      });
      procSnaps.forEach(d=>t.update(d.ref,{orderQty:newQty,qtyAdjustedAt:Date.now()}));
      const order=orderSnap.data();
      t.update(orderRef,{totalQty:(order.totalQty||0)-oldQty+newQty});
      t.set(logRef,{orderId,orderNo:order.orderId||'',code,oldQty,newQty,reason,processCount:procSnaps.length,createdAt:Date.now(),createdBy:window.cu.user});
    });
    cm('m-order-qty-adjust'); await loadOrderData(); renderProgress();
    alert('Điều chỉnh số lượng thành công.\n訂單數量調整成功。');
  }catch(e){ alert(`Không thể điều chỉnh số lượng.\n無法調整數量。\n\n${e.message}`); }
}

async function openOrderAdjustmentHistory(){
  if(!canManageOrders()) return;
  const snap=await window._getDocs(window._collection(COL.orderAdjustments));
  const rows=snap.docs.map(d=>d.data()).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  g('order-adjust-history').innerHTML=rows.length?rows.map(r=>`<tr><td>${r.orderNo}</td><td>${r.code}</td><td>${r.oldQty?.toLocaleString()}</td><td>${r.newQty?.toLocaleString()}</td><td>${r.reason||''}</td><td>${r.createdBy||''}<br><span style="font-size:10px;color:var(--mu)">${fmtTimeVN(r.createdAt)}</span></td></tr>`).join(''):'<tr><td colspan="6">Chưa có dữ liệu / 尚無資料</td></tr>';
  om('m-order-adjust-history');
}
