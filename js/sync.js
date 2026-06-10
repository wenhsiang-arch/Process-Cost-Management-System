// ===== 工序秒數同步工具 =====

function syncInit(){
  const sel = g('sync-order');
  if(!sel) return;
  sel.innerHTML = '<option value="">-- Chọn đơn hàng / 選擇訂單 --</option>';
  (window.allOrders||[]).filter(isOrderUsable).forEach(o=>{
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.orderId + ' · ' + fmtVN(o.dueDate);
    sel.appendChild(opt);
  });
  g('sync-proc').innerHTML = '<option value="">-- Chọn công đoạn / 選擇工序 --</option>';
  g('sync-table-wrap').style.display = 'none';
  g('sync-tb').innerHTML = '';
  const pending=(window.allOrders||[]).find(o=>o.lifecycleStatus==='syncingSeconds'&&o.secondSyncJobId);
  if(pending){
    window._secondSyncRetryJobId=pending.secondSyncJobId;
    setSecondSyncProgress(0,`Đơn hàng ${pending.orderId} có đồng bộ chưa hoàn tất.`,`訂單 ${pending.orderId} 有尚未完成的秒數同步。`,true);
  }
}

async function syncLoadProcs(){
  const ordId = g('sync-order').value;
  const procSel = g('sync-proc');
  procSel.innerHTML = '<option value="">-- Chọn công đoạn / 選擇工序 --</option>';
  g('sync-table-wrap').style.display = 'none';
  g('sync-tb').innerHTML = '';
  if(!ordId) return;
  try{
    const orderSnap=await window._getDoc(window._doc(COL.orders,ordId));
    if(!orderSnap.exists()||!isOrderUsable(orderSnap.data())) throw new Error('Đơn hàng chưa sẵn sàng / 訂單尚未完成匯入');
    const snap = await window._getDocs(
      window._query(window._collection(COL.processes), window._where('orderId','==',ordId))
    );
    const procs = snap.docs.map(d=>({id:d.id,...d.data()}));
    const procNos = [...new Map(procs.map(p=>[String(p.processNo), p])).values()];
    procNos.sort((a,b)=>compareProcessNo(a.processNo,b.processNo));
    procNos.forEach(p=>{
      const opt = document.createElement('option');
      opt.value = String(p.processNo);
      opt.textContent = p.processNo + ' · ' + (p.processVi||p.processZh||'');
      procSel.appendChild(opt);
    });
    window._syncProcs = procs;
  }catch(e){ alert('載入失敗：'+e.message); }
}

function syncLoadTable(){
  const procNo = g('sync-proc').value;
  const wrap = g('sync-table-wrap');
  const tb = g('sync-tb');
  if(!procNo){ wrap.style.display='none'; return; }
  const rows = (window._syncProcs||[]).filter(p=>String(p.processNo)===String(procNo));
  if(!rows.length){ wrap.style.display='none'; return; }
  tb.innerHTML = rows.map((p,i)=>`
    <tr style="border-bottom:1px solid var(--bd)">
      <td style="padding:8px 10px;font-size:13px"><b>${p.code}</b></td>
      <td style="padding:8px 10px;font-size:13px">${p.color||'-'}</td>
      <td style="padding:8px 10px;font-size:13px">${p.sz||'-'}</td>
      <td style="padding:8px 10px;text-align:right;font-size:13px">${p.workStdSec||p.processSec||0} 秒</td>
      <td style="padding:8px 10px;text-align:right;font-size:13px">${p.slPerHour||0} 件/時</td>
      <td style="padding:8px 10px;text-align:center">
        <input type="number" min="1" max="999" placeholder="秒" id="sync-inp-${i}"
          data-proc-id="${p.id}" data-code="${p.code}" data-old-sec="${p.workStdSec||p.processSec||0}"
          style="width:80px;padding:5px 8px;border:1px solid var(--bd);border-radius:8px;font-size:13px;text-align:center"
          oninput="syncUpdatePreview(${i})">
      </td>
      <td id="sync-prev-${i}" style="padding:8px 10px;text-align:right;font-size:13px;color:var(--mu)">-</td>
    </tr>`).join('');
  wrap.style.display = 'block';
  syncUpdateCount();
}

function syncUpdatePreview(i){
  const inp = g('sync-inp-'+i);
  const prev = g('sync-prev-'+i);
  const val = parseInt(inp.value);
  const oldSec = parseInt(inp.dataset.oldSec)||0;
  if(val>0){
    const newSlph = Math.round((window.S?.ws||3000)/val);
    prev.textContent = newSlph + ' 件/時';
    prev.style.color = val<oldSec?'var(--ok)':val>oldSec?'var(--err)':'var(--accent)';
  } else {
    prev.textContent = '-';
    prev.style.color = 'var(--mu)';
  }
  syncUpdateCount();
}

function syncUpdateCount(){
  const inputs = document.querySelectorAll('[id^=sync-inp-]');
  let n = 0;
  inputs.forEach(inp=>{ if(parseInt(inp.value)>0) n++; });
  const el = g('sync-count');
  if(el) el.textContent = n>0 ? '將更新 '+n+' 筆 / Sẽ cập nhật '+n+' mục' : '尚未輸入新秒數 / Chưa nhập giây mới';
}

function syncClear(){
  document.querySelectorAll('[id^=sync-inp-]').forEach(inp=>{ inp.value=''; });
  document.querySelectorAll('[id^=sync-prev-]').forEach(el=>{ el.textContent='-'; el.style.color='var(--mu)'; });
  syncUpdateCount();
}

function setSecondSyncProgress(percent,vi,zh,retry=false){
  g('sync-table-wrap').style.display='block';
  g('sync-progress-wrap').style.display='block';
  g('sync-progress-bar').style.width=Math.max(0,Math.min(100,percent))+'%';
  g('sync-progress-text').innerHTML=`<div>${vi}</div><div style="margin-top:3px;color:var(--mu)">${zh}</div>`;
  g('sync-retry-btn').style.display=retry?'':'none';
}

async function createSecondSyncJob(ordId,procNo,updates){
  const orderRef=window._doc(COL.orders,ordId);
  const jobRef=window._newDocRef(COL.secondSyncLogs);
  const order=(window.allOrders||[]).find(o=>o.id===ordId);
  await window._runTransaction(async t=>{
    const orderSnap=await t.get(orderRef);
    if(!orderSnap.exists()||!isOrderUsable(orderSnap.data())) throw new Error('Đơn hàng hiện không thể đồng bộ / 訂單目前無法同步');
    const now=Date.now();
    t.update(orderRef,{lifecycleStatus:'syncingSeconds',secondSyncJobId:jobRef.id,secondSyncStartedAt:now,secondSyncBy:window.cu.user});
    t.set(jobRef,{orderId:ordId,orderNo:order?.orderId||'',processNo:procNo,updates,status:'syncing',createdAt:now,createdBy:window.cu.user,completedWrites:0});
  });
  const local=(window.allOrders||[]).find(o=>o.id===ordId);
  if(local){ local.lifecycleStatus='syncingSeconds'; local.secondSyncJobId=jobRef.id; }
  return jobRef.id;
}

async function loadSecondSyncWrites(job){
  const [procSnap,repSnap]=await Promise.all([
    window._getDocs(window._query(window._collection(COL.processes),window._where('orderId','==',job.orderId))),
    window._getDocs(window._query(window._collection(COL.reports),window._where('orderId','==',job.orderId)))
  ]);
  const updateMap=new Map(job.updates.map(u=>[String(u.code),u.newSec]));
  const matches=d=>String(d.processNo)===String(job.processNo)&&updateMap.has(String(d.code));
  const writes=[];
  procSnap.docs.forEach(d=>{
    const data=d.data();
    if(!matches(data)) return;
    const sec=updateMap.get(String(data.code));
    writes.push({ref:d.ref,data:{workStdSec:sec,processSec:sec,quoteSnapshotSec:sec,slPerHour:Math.round((window.S?.ws||3000)/sec),secondSyncedAt:Date.now(),secondSyncedBy:window.cu.user}});
  });
  repSnap.docs.forEach(d=>{
    const data=d.data();
    if(!matches(data)) return;
    const sec=updateMap.get(String(data.code));
    writes.push({ref:d.ref,data:{processSec:sec,slPerHour:Math.round((window.S?.ws||3000)/sec),secondSyncedAt:Date.now(),secondSyncedBy:window.cu.user}});
  });
  return {writes,processCount:procSnap.docs.filter(d=>matches(d.data())).length,reportCount:repSnap.docs.filter(d=>matches(d.data())).length};
}

async function runSecondSyncJob(jobId){
  const jobRef=window._doc(COL.secondSyncLogs,jobId);
  const jobSnap=await window._getDoc(jobRef);
  if(!jobSnap.exists()) throw new Error('找不到秒數同步紀錄');
  const job=jobSnap.data();
  await window._updateDoc(jobRef,{status:'syncing',lastAttemptAt:Date.now(),lastError:null});
  const orderRef=window._doc(COL.orders,job.orderId);
  const orderSnap=await window._getDoc(orderRef);
  if(!orderSnap.exists()||orderSnap.data().lifecycleStatus!=='syncingSeconds'||orderSnap.data().secondSyncJobId!==jobId) throw new Error('訂單不在此秒數同步流程中');
  const loaded=await loadSecondSyncWrites(job);
  if(loaded.processCount!==job.updates.length) throw new Error(`工序資料不一致：預期 ${job.updates.length} 筆，實際找到 ${loaded.processCount} 筆`);
  const writes=loaded.writes;
  await window._updateDoc(jobRef,{totalWrites:writes.length,processCount:loaded.processCount,reportCount:loaded.reportCount,status:'syncing',lastAttemptAt:Date.now()});
  if(writes.length<=398){
    setSecondSyncProgress(30,`Đang cập nhật ${loaded.processCount} công đoạn và ${loaded.reportCount} báo công.`,`正在更新 ${loaded.processCount} 筆工序與 ${loaded.reportCount} 筆報工。`);
    const batch=window._writeBatch();
    writes.forEach(w=>batch.update(w.ref,w.data));
    batch.update(jobRef,{status:'completed',completedWrites:writes.length,completedAt:Date.now()});
    batch.update(orderRef,{lifecycleStatus:'active',secondSyncJobId:null,secondSyncCompletedAt:Date.now()});
    await batch.commit();
  }else{
    const totalBatches=Math.ceil(writes.length/400);
    for(let i=0;i<writes.length;i+=400){
      const batchNo=Math.floor(i/400)+1;
      setSecondSyncProgress(Math.round(i/writes.length*100),`Đang đồng bộ đợt ${batchNo}/${totalBatches}.`,`正在同步第 ${batchNo}/${totalBatches} 批。`);
      const batch=window._writeBatch();
      writes.slice(i,i+400).forEach(w=>batch.update(w.ref,w.data));
      await batch.commit();
      await window._updateDoc(jobRef,{completedWrites:Math.min(i+400,writes.length),lastBatchCompletedAt:Date.now()});
    }
    const finalBatch=window._writeBatch();
    finalBatch.update(jobRef,{status:'completed',completedWrites:writes.length,completedAt:Date.now()});
    finalBatch.update(orderRef,{lifecycleStatus:'active',secondSyncJobId:null,secondSyncCompletedAt:Date.now()});
    await finalBatch.commit();
  }
  const local=(window.allOrders||[]).find(o=>o.id===job.orderId);
  if(local){ local.lifecycleStatus='active'; local.secondSyncJobId=null; }
  window._secondSyncRetryJobId=null;
  setSecondSyncProgress(100,`Đã cập nhật ${loaded.processCount} công đoạn và ${loaded.reportCount} báo công.`,`已更新 ${loaded.processCount} 筆工序與 ${loaded.reportCount} 筆報工。`);
}

async function syncRetry(){
  if(!window._secondSyncRetryJobId) return;
  try{
    g('sync-retry-btn').style.display='none';
    await runSecondSyncJob(window._secondSyncRetryJobId);
    await reloadProcesses();
    syncInit();
    alert('✅ Đồng bộ hoàn tất / 同步完成');
  }catch(e){
    try{ await window._updateDoc(window._doc(COL.secondSyncLogs,window._secondSyncRetryJobId),{status:'failed',lastError:e.message,failedAt:Date.now()}); }catch(_){}
    setSecondSyncProgress(0,'Đồng bộ chưa hoàn tất. Vui lòng tiếp tục.','同步尚未完成，請繼續同步。',true);
    alert('同步失敗：'+e.message);
  }
}

async function syncConfirm(){
  const ordId=g('sync-order').value, procNo=g('sync-proc').value;
  if(!ordId||!procNo){ alert('請先選擇訂單與工序'); return; }
  const updates=[];
  document.querySelectorAll('[id^=sync-inp-]').forEach(inp=>{
    const newSec=parseInt(inp.value);
    if(newSec>0) updates.push({procId:inp.dataset.procId,code:inp.dataset.code,oldSec:parseInt(inp.dataset.oldSec)||0,newSec});
  });
  if(!updates.length){ alert('請至少輸入一筆新秒數 / Vui lòng nhập ít nhất 1 giây mới'); return; }
  let reportCount=0;
  try{
    const reportSnap=await window._getDocs(window._query(window._collection(COL.reports),window._where('orderId','==',ordId)));
    const codes=new Set(updates.map(u=>String(u.code)));
    reportCount=reportSnap.docs.filter(d=>{
      const r=d.data();
      return String(r.processNo)===String(procNo)&&codes.has(String(r.code));
    }).length;
  }catch(e){
    alert('無法確認同步影響範圍：'+e.message);
    return;
  }
  if(!confirm(`Phạm vi ảnh hưởng: ${updates.length} công đoạn, ${reportCount} báo công.\nXác nhận đồng bộ đơn hàng + công đoạn này?\n\n影響範圍：${updates.length} 筆工序、${reportCount} 筆報工。\n確認同步此訂單＋工序號？`)) return;
  const btn=document.querySelector('#pg-sync .btn.bp');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i> 同步中...'; }
  try{
    window._secondSyncRetryJobId=null;
    setSecondSyncProgress(5,'Đang khóa đơn hàng để đồng bộ.','正在鎖定訂單進行同步。');
    const jobId=await createSecondSyncJob(ordId,procNo,updates);
    window._secondSyncRetryJobId=jobId;
    await runSecondSyncJob(jobId);
    await reloadProcesses();
    syncInit();
    alert('✅ Đồng bộ hoàn tất / 同步完成');
  }catch(e){
    if(window._secondSyncRetryJobId){
      try{ await window._updateDoc(window._doc(COL.secondSyncLogs,window._secondSyncRetryJobId),{status:'failed',lastError:e.message,failedAt:Date.now()}); }catch(_){}
    }
    setSecondSyncProgress(0,'Đồng bộ chưa hoàn tất. Vui lòng tiếp tục.','同步尚未完成，請繼續同步。',!!window._secondSyncRetryJobId);
    alert('同步失敗：'+e.message);
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="ti ti-refresh"></i>Xác nhận đồng bộ / 確認同步'; }
  }
}
