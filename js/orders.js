// ===== 訂單系統資料 =====
window.allOrders    = [];
window.allProcesses = [];
window._failedOrderCleanup = null;
let ordersLoadPromise = null;
const processLoadPromises = new Map(); // processLoadPromises（各訂單工序載入工作）
const loadedProcessVersions = new Map(); // loadedProcessVersions（已載入訂單工序版本）
let progressRenderSequence = 0;
let progressRenderTimer = null;
let legacyOrderCostCleanupPromise = null;
const ordersSafeText=value=>window.PCMSSafe.text(value); // ordersSafeText（訂單畫面安全文字）
const ordersSafeAttr=value=>window.PCMSSafe.attribute(value); // ordersSafeAttr（訂單畫面安全屬性）
const ordersInlineArg=value=>window.PCMSSafe.inlineArgument(value); // ordersInlineArg（訂單行內事件安全參數）

function usableOrders(){ return (window.allOrders||[]).filter(isOrderUsable); }
function resetOrderRuntimeCache(){
  processLoadPromises.clear();
  loadedProcessVersions.clear();
  clearTimeout(progressRenderTimer);
  progressRenderSequence++;
}
function setImportProgress(percent,vi,zh){
  g('imp-progress-wrap').style.display='block';
  g('imp-progress-bar').style.width=Math.max(0,Math.min(100,percent))+'%';
  g('imp-progress-text').innerHTML=`<div>${ordersSafeText(vi)}</div><div style="margin-top:4px;color:var(--mu)">${ordersSafeText(zh)}</div>`;
}
function makeOrderProcess(orderId,orderNo,item,op,now){
  return {orderId,orderNo,code:item.code,desc:item.desc,color:item.color,zh:item.zh,sz:item.sz,orderQty:item.qty,
    processNo:op.no,processCategory:op.category||'',processZh:op.zh||'',processVi:op.vi||'',processSec:op.sec||0,quoteSnapshotSec:op.sec||0,
    workStdSec:op.sec||0,slPerHour:Math.round((window.S?.ws||3000)/Math.max(op.sec||1,1)),createdAt:now};
}

// ===== 載入訂單資料 =====
async function loadOrderData(){
  window.lastOrderReadMetrics={
    orderMode:'pending',orderDocuments:0,processDocuments:0,processQueries:0,
    processCacheHits:0,startedAt:Date.now()
  }; // lastOrderReadMetrics（最近一次訂單讀取量）
  await reloadOrders();
  fillOrderSelects();
  return {orders:window.allOrders,processes:window.allProcesses};
}

function orderProcessVersion(order){
  if(!order) return '';
  return String(order.processVersion||`legacy-${order.importCompletedAt||order.createdAt||0}`);
}

function recordOrderRead(metrics={}){
  const previous=window.lastOrderReadMetrics||{
    orderMode:'unknown',orderDocuments:0,processDocuments:0,processQueries:0,
    processCacheHits:0,startedAt:Date.now()
  };
  window.lastOrderReadMetrics=Object.freeze({
    ...previous,...metrics,
    orderDocuments:Number(metrics.orderDocuments??previous.orderDocuments)||0,
    processDocuments:Number(previous.processDocuments||0)+Number(metrics.addProcessDocuments||0),
    processQueries:Number(previous.processQueries||0)+Number(metrics.addProcessQueries||0),
    processCacheHits:Number(previous.processCacheHits||0)+Number(metrics.addProcessCacheHits||0),
    finishedAt:Date.now()
  });
}

function replaceLoadedOrderProcesses(orderId,items,version){
  window.allProcesses=window.PCMSOrderProcessCache.replace(window.allProcesses,orderId,items);
  loadedProcessVersions.set(String(orderId),String(version));
  const order=(window.allOrders||[]).find(item=>item.id===orderId);
  if(order){
    order.processCount=items.length;
    order.productCodes=[...new Set(items.map(item=>String(item.code||'')).filter(Boolean))];
  }
  return items;
}

function hasOrderProcessesLoaded(orderId){
  const order=(window.allOrders||[]).find(item=>item.id===orderId);
  return loadedProcessVersions.get(String(orderId))===orderProcessVersion(order);
}

async function ensureOrderProcessesLoaded(orderId,options={}){
  const target=String(orderId||'');
  if(!target) return [];
  if(processLoadPromises.has(target)) return processLoadPromises.get(target);
  const promise=(async()=>{
    try{
      const order=(window.allOrders||[]).find(item=>item.id===target);
      const version=orderProcessVersion(order);
      if(options.force!==true&&hasOrderProcessesLoaded(target)){
        recordOrderRead({addProcessCacheHits:1});
        return (window.allProcesses||[]).filter(item=>item.orderId===target);
      }
      if(options.force===true) await window.PCMSOrderProcessCache.remove(target);
      const cached=options.force===true?null:await window.PCMSOrderProcessCache.read(target,version);
      if(cached){
        recordOrderRead({addProcessCacheHits:1});
        return replaceLoadedOrderProcesses(target,cached,version);
      }
      const snap=await window._getDocs(
        window._query(window._collection(COL.processes),window._where('orderId','==',target))
      );
      const rows=snap.docs.map(item=>({id:item.id,...item.data()}));
      await window.PCMSOrderProcessCache.write(target,version,rows);
      recordOrderRead({addProcessQueries:1,addProcessDocuments:snap.size});
      return replaceLoadedOrderProcesses(target,rows,version);
    }catch(e){
      console.error('ensureOrderProcessesLoaded（載入指定訂單工序）失敗：',e);
      throw e;
    }finally{
      processLoadPromises.delete(target);
    }
  })();
  processLoadPromises.set(target,promise);
  return promise;
}

async function reloadProcesses(options={}){
  const orderId=String(options.orderId||g('prog-sel')?.value||'');
  if(!orderId) return window.allProcesses;
  await ensureOrderProcessesLoaded(orderId,options);
  return window.allProcesses;
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
      const readMetrics=window.lastCollectionReadMetrics;
      if(readMetrics?.scope===COL.orders){
        recordOrderRead({orderMode:readMetrics.mode,orderDocuments:readMetrics.documentReads});
      }
      if(isAdm()) await cleanupLegacyOrderCostSnapshots();
      fillOrderSelects();
      return window.allOrders;
    }finally{
      ordersLoadPromise=null;
    }
  })();
  return ordersLoadPromise;
}

// cleanupLegacyOrderCostSnapshots（清除舊訂單成本快照）：snapshotHr（平均時薪快照）未被功能使用，不應留在一般訂單資料。
async function cleanupLegacyOrderCostSnapshots(){
  if(!isAdm()||legacyOrderCostCleanupPromise) return legacyOrderCostCleanupPromise;
  const legacy=(window.allOrders||[]).filter(order=>order?.id&&Object.prototype.hasOwnProperty.call(order,'snapshotHr'));
  if(!legacy.length) return true;
  legacyOrderCostCleanupPromise=(async()=>{
    for(let offset=0;offset<legacy.length;offset+=400){
      const batch=window._writeBatch();
      legacy.slice(offset,offset+400).forEach(order=>{
        batch.update(window._doc(COL.orders,order.id),{snapshotHr:window._deleteField()});
      });
      await batch.commit();
    }
    legacy.forEach(order=>delete order.snapshotHr);
    return true;
  })();
  try{
    return await legacyOrderCostCleanupPromise;
  }finally{
    legacyOrderCostCleanupPromise=null;
  }
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

async function processImportOrderFile(file,input){
  const ordId=g('imp-ord-id').value.trim();
  const client=g('imp-ord-client')?.value||'';
  const dueDate=g('imp-ord-date').value;
  if(!ordId){ alert('請先填寫訂單編號'); if(input) input.value=''; return; }
  if(!client){ alert('請先選擇客戶 / Vui lòng chọn khách hàng'); if(input) input.value=''; return; }
  if(!dueDate){ alert('請先填寫出貨日期'); if(input) input.value=''; return; }
  try{
    await window.PCMSFeatures.ensureSpreadsheetTool();
  }catch(error){
    alert('Không thể tải công cụ Excel. / 無法載入 Excel（表格檔）工具。');
    if(input) input.value='';
    return;
  }
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
        sm.innerHTML=`<i class="ti ti-alert-triangle"></i> Bỏ qua ${skipped.length} mã hàng (không tìm thấy trong bảng công đoạn) / 跳過 ${skipped.length} 款（工序表找不到）：${ordersSafeText(skipped.slice(0,5).join('、'))}${skipped.length>5?'...':''}`;
      }
      const tb=g('imp-preview-tb'); tb.innerHTML='';
      matched.forEach(m=>{
        const tr=document.createElement('tr');
        tr.innerHTML=`<td><b>${ordersSafeText(m.code)}</b></td><td>${ordersSafeText(m.desc)}</td><td>${ordersSafeText(m.color)}</td><td>${m.qty.toLocaleString()}</td><td>${m.ops.length}</td><td><span class="tg tg2">Có thể nhập<br>可匯入</span></td>`;
        tb.appendChild(tr);
      });
      skipped.forEach(s=>{
        const tr=document.createElement('tr');
        tr.innerHTML=`<td><b>${ordersSafeText(s)}</b></td><td colspan="4">-</td><td><span class="tg tr2">Không tìm thấy công đoạn<br>找不到工序</span></td>`;
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
    const importedProcessCount=d.matched.reduce((sum,item)=>sum+(item.ops||[]).length,0);
    const importedProductCodes=d.matched.map(item=>item.code);
    const importedProcessVersion=newOrderProcessVersion();
    orderRef=await window._addDoc(window._collection(COL.orders),{
      orderId:d.ordId, dueDate:new Date(d.dueDate).getTime(),
      client:g('imp-ord-client')?.value||'',
      actualShipDate:new Date(d.dueDate).getTime(),
      actualShipDateManual:false,
      itemCount:d.matched.length,
      totalQty:d.matched.reduce((a,m)=>a+m.qty,0),
      processCount:importedProcessCount,
      productCodes:importedProductCodes,
      processVersion:`importing-${now}`,
      createdAt:now, createdBy:window.cu.user,
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
    await window._updateDoc(orderRef,{
      importStatus:'ready',importCompletedAt:Date.now(),
      processCount:processRows.length,productCodes:importedProductCodes,
      processVersion:importedProcessVersion
    });
    if(window.saveOperationLogToFB){
      try{
        await saveOperationLogToFB({
          permissionKey:'orderImport',
          feature:'orders',
          action:'orderImport',
          status:'success',
          itemCount:d.matched.length,
          detailCount:processRows.length,
          fileName:g('imp-filename')?.textContent||'',
          note:d.ordId
        });
      }catch(logError){
        console.error('Không thể lưu operationLogs / 無法儲存操作紀錄：',logError);
        alert('Đơn hàng đã nhập, nhưng không thể lưu lịch sử thao tác.\n訂單已匯入，但操作紀錄無法保存。');
      }
    }
    setImportProgress(100,'Nhập đơn hàng hoàn tất.','訂單匯入完成。');
    const dueDate=new Date(d.dueDate).getTime();
    window.allOrders.unshift({
      id:ordId,orderId:d.ordId,client:g('imp-ord-client')?.value||'',dueDate,actualShipDate:dueDate,
      itemCount:d.matched.length,totalQty:d.matched.reduce((a,m)=>a+m.qty,0),
      processCount:processRows.length,productCodes:importedProductCodes,processVersion:importedProcessVersion,
      createdAt:now,importStatus:'ready'
    });
    closeImportOrder();
    await reloadProcesses({orderId:ordId,force:true});
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
  await window.PCMSOrderProcessCache.remove(orderId);
  loadedProcessVersions.delete(String(orderId||''));
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
    const idArg=ordersInlineArg(o.id);
    const orderArg=ordersInlineArg(o.orderId);
    tr.innerHTML=`
      <td><b style="color:var(--navy)">${ordersSafeText(o.orderId)}</b></td>
      <td>${o.itemCount||0}</td>
      <td>${(o.totalQty||0).toLocaleString()}</td>
      <td>${fmtVN(o.dueDate)}</td>
      <td style="min-width:120px">
        <div style="font-size:11px;color:${o.importStatus==='failed'||o.lifecycleStatus==='deleting'?'var(--err)':'var(--mu)'}">${o.lifecycleStatus==='archived'?'Đã xóa (lưu trữ) / 已刪除（封存）':o.lifecycleStatus==='deleting'?'Đang xóa vĩnh viễn / 永久刪除中':o.importStatus==='failed'?'Nhập thất bại / 匯入失敗':o.importStatus==='importing'?'Đang nhập / 匯入中':'Đang sử dụng / 使用中'}</div>
      </td>
      <td><div style="display:flex;gap:4px">
        ${isOrderUsable(o)?`<button class="btn bsm" onclick="viewOrderProgress(${idArg})"><i class="ti ti-chart-bar"></i></button>`:''}
        ${o.importStatus==='failed'&&canManageOrders()?`<button class="btn bsm" onclick="cleanupFailedOrder(${idArg},${orderArg})"><i class="ti ti-broom"></i></button>`:''}
        ${isOrderUsable(o)?`<button class="btn bsm bd2" title="Xóa (Lưu trữ) / 刪除（封存）" onclick="openOrderDeleteWarning('archive',${idArg},${orderArg})"><i class="ti ti-trash"></i></button>`:''}
        ${isOrderUsable(o)&&window.cu?.role==='admin'?`<button class="btn bsm bd2" style="background:var(--errl);color:var(--err)" title="Xóa vĩnh viễn / 永久刪除" onclick="openOrderDeleteWarning('purge',${idArg},${orderArg})"><i class="ti ti-database-off"></i></button>`:''}
        ${o.lifecycleStatus==='archived'&&canManageOrders()?`<button class="btn bsm" onclick="restoreArchivedOrder(${idArg},${orderArg})"><i class="ti ti-restore"></i>Khôi phục / 還原</button>`:''}
        ${(o.lifecycleStatus==='archived'||o.lifecycleStatus==='deleting')&&window.cu?.role==='admin'?`<button class="btn bsm bd2" style="background:var(--errl);color:var(--err)" title="Xóa vĩnh viễn / 永久刪除" onclick="openOrderDeleteWarning('purge',${idArg},${orderArg})"><i class="ti ti-database-off"></i></button>`:''}
      </div></td>`;
    tb.appendChild(tr);
  });
  fillOrderSelects();
}

function viewOrderProgress(id){
  g('prog-sel').value=id; sp('progress'); renderProgress();
}

async function getOrderDeleteData(id,name){
  const [procSnap,adjSnap]=await Promise.all([
    window._getDocs(window._query(window._collection(COL.processes),window._where('orderId','==',id))),
    window._getDocs(window._query(window._collection(COL.orderAdjustments),window._where('orderId','==',id)))
  ]);
  return {id,name,processes:procSnap.docs,adjustments:adjSnap.docs};
}

function openOrderDeleteWarning(mode,id,name){
  if(mode==='purge'&&window.cu?.role!=='admin') return;
  window._orderDeleteRequest={mode,id,name};
  const archive=mode==='archive';
  g('order-delete-warning-title').innerHTML=`<i class="ti ${archive?'ti-trash':'ti-database-off'}"></i> ${archive?'Xóa (Lưu trữ) / 刪除（封存）':'Xóa vĩnh viễn / 永久刪除'}`;
  g('order-delete-warning-text').innerHTML=archive
    ?'<div>Xóa (Lưu trữ) sẽ ẩn đơn hàng, nhưng giữ dữ liệu đơn hàng và công đoạn.</div><div style="margin-top:10px">刪除（封存）會隱藏訂單，但保留訂單與工序資料。</div>'
    :'<div>Xóa vĩnh viễn sẽ xóa đơn hàng, công đoạn và lịch sử điều chỉnh. Không thể khôi phục.</div><div style="margin-top:10px">永久刪除會移除訂單、工序及數量調整紀錄，無法復原。</div>';
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
    g('order-delete-summary').innerHTML=`<div><b>Đơn hàng / 訂單：</b>${ordersSafeText(name)}</div>
      <div><b>Công đoạn / 工序：</b>${data.processes.length}</div>
      <div><b>Lịch sử điều chỉnh / 數量調整紀錄：</b>${data.adjustments.length}</div>`;
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
  g('order-archive-btn').disabled=!matched||data?.mode!=='archive';
  g('order-purge-btn').disabled=!matched||data?.mode!=='purge'||window.cu?.role!=='admin';
}

async function confirmArchiveOrder(){
  const data=window._orderDeleteData;
  if(!data||g('order-delete-confirm').value.trim()!==data.name) return;
  try{
    const ref=window._doc(COL.orders,data.id);
    await window._runTransaction(async t=>{
      const snap=await t.get(ref);
      if(!snap.exists()||!isOrderUsable(snap.data())) throw new Error('Đơn hàng không thể xóa (lưu trữ) / 訂單目前無法刪除（封存）');
      t.update(ref,{lifecycleStatus:'archived',archivedAt:Date.now(),archivedBy:window.cu.user});
    });
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
    const docs=[...fresh.processes,...fresh.adjustments];
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
    await window.PCMSOrderProcessCache.remove(data.id);
    loadedProcessVersions.delete(String(data.id));
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
function scheduleProgressRender(){
  clearTimeout(progressRenderTimer);
  progressRenderTimer=setTimeout(()=>renderProgress(),250);
}

async function loadProcessesForOrderSearch(orders,codeQuery,renderSequence){
  const matchedOrderIds=new Set();
  const legacyOrders=[];
  orders.forEach(order=>{
    if(Array.isArray(order.productCodes)){
      if(order.productCodes.some(code=>String(code||'').toLowerCase().includes(codeQuery))){
        matchedOrderIds.add(order.id);
      }
    }else{
      legacyOrders.push(order);
    }
  });
  for(let offset=0;offset<legacyOrders.length;offset+=5){
    const group=legacyOrders.slice(offset,offset+5);
    const results=await Promise.all(group.map(order=>ensureOrderProcessesLoaded(order.id)));
    if(renderSequence!==progressRenderSequence) return null;
    results.forEach((items,index)=>{
      if(items.some(item=>String(item.code||'').toLowerCase().includes(codeQuery))){
        matchedOrderIds.add(group[index].id);
      }
    });
  }
  return matchedOrderIds;
}

async function renderProgress(){
  const renderSequence=++progressRenderSequence;
  const ordId=g('prog-sel')?.value;
  const codeQuery=(g('prog-code-q')?.value||'').trim().toLowerCase();
  const content=g('prog-content'); if(!content) return;
  content.innerHTML='<div style="padding:20px;text-align:center;color:var(--mu)">載入中...</div>';
  try{
    const now=Date.now();
    const twoMonths=60*24*60*60*1000;
    let orders=usableOrders().filter(order=>{
      const actualShipDate=order.actualShipDate||(order.dueDate||null);
      return !actualShipDate||(actualShipDate+twoMonths)>now;
    });
    if(ordId) orders=orders.filter(order=>order.id===ordId);
    if(ordId) await ensureOrderProcessesLoaded(ordId);
    if(renderSequence!==progressRenderSequence) return;
    if(codeQuery){
      const matchedOrderIds=await loadProcessesForOrderSearch(orders,codeQuery,renderSequence);
      if(!matchedOrderIds||renderSequence!==progressRenderSequence) return;
      orders=orders.filter(order=>matchedOrderIds.has(order.id));
    }
    const allProcs=window.allProcesses||[];
    const progMap={};
    allProcs.forEach(p=>{
      if(!progMap[p.orderId]) progMap[p.orderId]={procs:[]};
      progMap[p.orderId].procs.push(p);
    });
    let list=orders.map(o=>{
      const pm=progMap[o.id]||{procs:[]};
      const actualShipDate=o.actualShipDate||(o.dueDate||null);
      const processCount=Number.isInteger(Number(o.processCount))
        ? Number(o.processCount)
        : (hasOrderProcessesLoaded(o.id)?pm.procs.length:null);
      return{...o,processCount,pm,actualShipDate};
    });
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
    html+=`<th style="${thS};width:100px">Số công đoạn<br><span style="font-size:10px;font-weight:400">工序數</span></th>`;
    html+=`<th style="${thS};width:90px">Theo PO<br><span style="font-size:10px;font-weight:400">出貨日期PO</span></th>`;
    html+=`<th style="${thS};width:120px">Hoàn thành<br><span style="font-size:10px;font-weight:400">實際完成日</span></th>`;
    html+=`<th style="${thS};width:120px">Xuất hàng<br><span style="font-size:10px;font-weight:400">實際出貨日</span></th>`;
    html+=`<th style="${thS}">Ghi chú<br><span style="font-size:10px;font-weight:400">備註</span></th>`;
    html+=`<th style="${thS};width:60px"></th>`;
    html+='</tr></thead><tbody>';
    list.forEach((o,idx)=>{
      const totalQty=o.totalQty||0;
      const actualCompleteDateVal=o.actualCompleteDate?formatLocalDate(o.actualCompleteDate):'';
      const actualShipDateVal=o.actualShipDate?formatLocalDate(o.actualShipDate):(o.dueDate?formatLocalDate(o.dueDate):'');
      const idArg=ordersInlineArg(o.id);
      const orderArg=ordersInlineArg(o.orderId);
      const remarkArg=ordersInlineArg(o.remark||'');
      const safeId=ordersSafeAttr(o.id);
      const remarkVal=ordersSafeAttr(o.remark||'');
      html+=`<tr style="cursor:pointer" onclick="toggleProgDetail(${idArg})">
        <td style="color:var(--mu);padding:6px 8px;font-size:12px">${idx+1}</td>
        <td style="padding:6px 8px;font-size:12px"><b>${ordersSafeText(o.client||'-')}</b></td>
        <td style="font-family:var(--font-mono,monospace);font-size:11px;padding:6px 8px">${ordersSafeText(o.orderId)}</td>
        <td style="padding:6px 8px;font-size:12px">${totalQty.toLocaleString()}</td>
        <td style="padding:6px 8px;font-size:12px">${o.processCount===null?'—':o.processCount.toLocaleString()}</td>
        <td>${fmtVN(o.dueDate)}</td>
        <td onclick="event.stopPropagation()"><input type="date" value="${ordersSafeAttr(actualCompleteDateVal)}" onchange="saveProgField(${idArg},'actualCompleteDate',this.value)" style="border:1px solid var(--bd);border-radius:6px;padding:4px 6px;font-size:12px;width:130px"></td>
        <td onclick="event.stopPropagation()"><input type="date" value="${ordersSafeAttr(actualShipDateVal)}" onchange="saveProgField(${idArg},'actualShipDate',this.value,true)" style="border:1px solid var(--bd);border-radius:6px;padding:4px 6px;font-size:12px;width:130px"></td>
        <td onclick="event.stopPropagation();openRemarkEdit(${idArg},${remarkArg})" title="${remarkVal}" style="cursor:pointer;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 8px;font-size:12px;color:${o.remark?'var(--navy)':'var(--mu)'}">${ordersSafeText(o.remark||'Ghi chú... / 備註...')}</td>
        <td style="padding:6px 8px" onclick="event.stopPropagation()">
          <button class="btn bsm bd2" title="Xóa (Lưu trữ) / 刪除（封存）" onclick="openOrderDeleteWarning('archive',${idArg},${orderArg})"><i class="ti ti-trash"></i></button>
          ${window.cu?.role==='admin'?`<button class="btn bsm bd2" style="background:var(--errl);color:var(--err)" title="Xóa vĩnh viễn / 永久刪除" onclick="openOrderDeleteWarning('purge',${idArg},${orderArg})"><i class="ti ti-database-off"></i></button>`:''}
        </td>
      </tr>
      <tr id="prog-detail-${safeId}" style="display:none">
        <td colspan="10" style="padding:0;background:var(--bg)">
          <div id="prog-detail-body-${safeId}" style="padding:10px 16px"></div>
        </td>
      </tr>`;
    });
    html+='</tbody></table></div>';
    content.innerHTML=html;
    if(codeQuery) list.forEach(o=>toggleProgDetail(o.id));
  }catch(e){
    content.innerHTML='<div style="color:var(--err);padding:20px">Không thể tải / 載入失敗：'+window.PCMSSafe.errorMessage(e)+'</div>';
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

async function toggleProgDetail(ordId){
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
  body.innerHTML='<span style="color:var(--mu);font-size:12px">Đang tải công đoạn / 正在載入工序...</span>';
  try{
    await ensureOrderProcessesLoaded(ordId);
  }catch(error){
    body.innerHTML='<span style="color:var(--err);font-size:12px">Không thể tải / 載入失敗：'+window.PCMSSafe.errorMessage(error)+'</span>';
    return;
  }
  if(row.style.display==='none') return;
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
    const detailId='prog-code-'+ordId+'-'+encodeURIComponent(code).replace(/%/g,'_');
    const ordArg=ordersInlineArg(ordId);
    const codeArg=ordersInlineArg(code);
    const detailArg=ordersInlineArg(detailId);
    html+=`<div style="margin-bottom:10px">
      <div onclick="toggleProgCodeDetail(${ordArg},${codeArg},${detailArg})" style="cursor:pointer;font-size:12px;font-weight:500;color:var(--navy);padding:8px 4px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:8px;white-space:nowrap">
        <i id="${ordersSafeAttr(detailId)}-icon" class="ti ti-chevron-right" style="color:var(--accent)"></i>
        <b>${ordersSafeText(code)}</b><span style="font-size:11px;color:var(--mu);overflow:hidden;text-overflow:ellipsis;min-width:80px;max-width:240px">${ordersSafeText(cp[0].desc||'')} ${ordersSafeText(cp[0].color||'')}</span>
        <span style="margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;color:var(--accent);min-width:0">
          <span>${cp.length} công đoạn / ${cp.length} 道工序 · ${(cp[0].orderQty||0).toLocaleString()} sản phẩm / 件</span>
          ${canManageOrders()?`<button class="btn bsm" title="Điều chỉnh SL / 調整數量" aria-label="Điều chỉnh SL / 調整數量" onclick="event.stopPropagation();openOrderQtyAdjust(${ordArg},${codeArg})"><i class="ti ti-edit"></i></button>`:''}
        </span>
      </div>
      <div id="${ordersSafeAttr(detailId)}" style="display:none"></div>
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
    return`<tr>
      <td style="padding:3px 6px;font-size:12px">${ordersSafeText(p.processNo)}</td>
      <td style="padding:3px 6px;font-size:12px">${ordersSafeText(p.processCategory||'—')} · ${ordersSafeText(processCategoryLabel(p.processCategory))}</td>
      <td style="padding:3px 6px;font-size:12px">${ordersSafeText(p.processVi||p.processZh||'')}</td>
      <td style="padding:3px 6px;text-align:right;font-size:12px">${(p.orderQty||0).toLocaleString()}</td>
      <td style="padding:3px 6px;text-align:right;font-size:12px">${(p.workStdSec||p.processSec||0).toLocaleString()}</td>
      <td style="padding:3px 6px;text-align:right;font-size:12px">${(p.slPerHour||0).toLocaleString()}</td>
    </tr>`;
  }).join('');
  detail.innerHTML=`<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--sf)">
    <th style="padding:4px 6px;text-align:left;width:60px;font-size:11px">Số CĐ<br><span style="font-weight:400;color:var(--mu)">工序號</span></th>
    <th style="padding:4px 6px;text-align:left;width:90px;font-size:11px">Phân loại<br><span style="font-weight:400;color:var(--mu)">加工分類</span></th>
    <th style="padding:4px 6px;text-align:left;font-size:11px">Tên CĐ<br><span style="font-weight:400;color:var(--mu)">工序名稱</span></th>
    <th style="padding:4px 6px;text-align:right;width:70px;font-size:11px">SL đơn<br><span style="font-weight:400;color:var(--mu)">訂單量</span></th>
    <th style="padding:4px 6px;text-align:right;width:80px;font-size:11px">Số giây<br><span style="font-weight:400;color:var(--mu)">工序秒數</span></th>
    <th style="padding:4px 6px;text-align:right;width:90px;font-size:11px">SL tiêu chuẩn/giờ<br><span style="font-weight:400;color:var(--mu)">標準產量/時</span></th>
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
  const minimum=1;
  g('adj-order-id').value=orderId; g('adj-code').value=code;
  g('adj-new-qty').value=current; g('adj-reason').value='';
  g('adj-summary').innerHTML=`<div>Đơn hàng/訂單: <b>${ordersSafeText(order?.orderId||'')}</b></div>
    <div>Mã hàng/款號: <b>${ordersSafeText(code)}</b></div>
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
    const processVersion=newOrderProcessVersion();
    await window._runTransaction(async t=>{
      const orderSnap=await t.get(orderRef);
      const procSnaps=[];
      for(const d of initialProcSnap.docs) procSnaps.push(await t.get(d.ref));
      if(!orderSnap.exists()||!isOrderUsable(orderSnap.data())) throw new Error('Đơn hàng không thể điều chỉnh / 訂單目前不可調整');
      if(procSnaps.some(d=>!d.exists())) throw new Error('Dữ liệu công đoạn đã thay đổi / 工序資料已變更');
      const oldQty=procSnaps[0].data().orderQty||0;
      if(procSnaps.some(d=>(d.data().orderQty||0)!==oldQty)) throw new Error('Số lượng giữa các công đoạn không đồng nhất / 各工序訂單數量不一致');
      if(newQty===oldQty) throw new Error('Số lượng mới không thay đổi / 新數量沒有變更');
      procSnaps.forEach(d=>t.update(d.ref,{orderQty:newQty,qtyAdjustedAt:Date.now()}));
      const order=orderSnap.data();
      t.update(orderRef,{totalQty:(order.totalQty||0)-oldQty+newQty,processVersion});
      t.set(logRef,{orderId,orderNo:order.orderId||'',code,oldQty,newQty,reason,processCount:procSnaps.length,createdAt:Date.now(),createdBy:window.cu.user});
    });
    cm('m-order-qty-adjust');
    await reloadOrders();
    await reloadProcesses({orderId,force:true});
    renderProgress();
    alert('Điều chỉnh số lượng thành công.\n訂單數量調整成功。');
  }catch(e){ alert(`Không thể điều chỉnh số lượng.\n無法調整數量。\n\n${e.message}`); }
}

async function openOrderAdjustmentHistory(){
  if(!canManageOrders()) return;
  const snap=await window._getDocs(window._collection(COL.orderAdjustments));
  const rows=snap.docs.map(d=>d.data()).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  g('order-adjust-history').innerHTML=rows.length?rows.map(r=>`<tr><td>${ordersSafeText(r.orderNo)}</td><td>${ordersSafeText(r.code)}</td><td>${r.oldQty?.toLocaleString()}</td><td>${r.newQty?.toLocaleString()}</td><td>${ordersSafeText(r.reason||'')}</td><td>${ordersSafeText(r.createdBy||'')}<br><span style="font-size:10px;color:var(--mu)">${ordersSafeText(fmtTimeVN(r.createdAt))}</span></td></tr>`).join(''):'<tr><td colspan="6">Chưa có dữ liệu / 尚無資料</td></tr>';
  om('m-order-adjust-history');
}
