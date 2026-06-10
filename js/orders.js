// ===== 訂單系統資料 =====
window.allOrders    = [];
window.allEmployees = [];
window.allProcesses = [];

// ===== 載入訂單資料 =====
async function loadOrderData(){
  try{
    const snap=await window._getDocs(window._collection(COL.orders));
    window.allOrders=snap.docs.map(d=>({id:d.id,...d.data()}));
    window.allOrders.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  }catch(e){ console.error(e); }
  try{
    const snap=await window._getDocs(window._collection(COL.employees));
    window.allEmployees=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){}
  try{
    const snap=await window._getDocs(window._collection(COL.processes));
    window.allProcesses=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){ console.error('loadProcesses error:',e); }
  try{
    const snap=await window._getDocs(window._query(window._collection(COL.reports),window._where('status','==','pending')));
    updateApvBadge(snap.docs.length);
  }catch(e){}
  fillOrderSelects();
}

async function reloadProcesses(){
  try{
    const snap=await window._getDocs(window._collection(COL.processes));
    window.allProcesses=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){ console.error('reloadProcesses error:',e); }
}

function updateApvBadge(n){
  const el=g('badge-apv'); if(!el) return;
  el.textContent=n; el.style.display=n>0?'inline':'none';
}

function fillOrderSelects(){
  ['prog-sel'].forEach(id=>{
    const sel=g(id); if(!sel) return;
    while(sel.options.length>1) sel.remove(1);
    window.allOrders.forEach(o=>{
      const opt=document.createElement('option');
      opt.value=o.id;
      opt.textContent=`${o.orderId} · ${fmtVN(o.dueDate)}`;
      sel.appendChild(opt);
    });
  });
}

// ===== 匯入訂單 =====
function openImportOrder(){
  g('imp-ord-id').value=''; g('imp-ord-date').value='';
  g('imp-file').value=''; g('imp-filename').textContent='';
  g('imp-step1').style.display='block'; g('imp-step2').style.display='none';
  g('imp-skip-msg').style.display='none';
  window._impData=null;
  const clientSel=g('imp-ord-client');
  if(clientSel){
    clientSel.innerHTML='<option value="">-- 選擇客戶 --</option>';
    const clients=[...new Set((window.D||[]).map(p=>p.client).filter(Boolean))].sort();
    clients.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; clientSel.appendChild(o); });
  }
  om('m-import-order');
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
      const matched=[], skipped=[];
      rows.slice(hRow+1).filter(r=>r[iItem]).forEach(r=>{
        const code=String(r[iItem]||'').trim();
        const qty=parseInt(r[iQty]||0);
        if(!code||!qty) return;
        const prod=window.D.find(p=>p.code===code);
        if(prod){
          const procErrors=validateProcessNumbers(prod.ops||[],code);
          if(procErrors.length){
            skipped.push(`${code}（${procErrors.join('；')}）`);
            return;
          }
          matched.push({code,desc:String(r[iDesc]||'').trim(),color:String(r[iColor]||'').trim(),qty,ops:prod.ops||[],zh:prod.zh||'',sz:prod.sz||''});
        } else { skipped.push(code); }
      });
      window._impData={ordId,dueDate,matched,skipped};
      g('imp-step2').style.display='block';
      const _ioMsg=document.getElementById('imp-order-ok');
      if(_ioMsg) _ioMsg.innerHTML=`<i class="ti ti-check"></i> Tìm thấy <b>${matched.length}</b> mã hàng / 找到 <b>${matched.length}</b> 個款號，共 <b>${matched.reduce((a,m)=>a+m.ops.length,0)}</b> công đoạn / 道工序`;
      if(skipped.length>0){
        const sm=g('imp-skip-msg'); sm.style.display='flex';
        sm.innerHTML=`<i class="ti ti-alert-triangle"></i> Bỏ qua ${skipped.length} mã hàng (không tìm thấy trong bảng công đoạn) / 跳過 ${skipped.length} 款（工序表找不到）：${skipped.slice(0,5).join('、')}${skipped.length>5?'...':''}`;
      }
      const tb=g('imp-preview-tb'); tb.innerHTML='';
      matched.forEach(m=>{
        const tr=document.createElement('tr');
        tr.innerHTML=`<td><b>${m.code}</b></td><td>${m.desc}</td><td>${m.color}</td><td>${m.qty.toLocaleString()}</td><td>${m.ops.length}</td><td><span class="tg tg2">✓ 可匯入</span></td>`;
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
  d.ordId = g('imp-ord-id').value.trim();
  if(window.allOrders.find(o=>o.orderId===d.ordId)){
    alert(`⚠️ Số đơn hàng "${d.ordId}" đã tồn tại! / 訂單編號「${d.ordId}」已存在，請勿重複匯入。`);
    return;
  }
  const btn=g('imp-confirm-btn');
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i> 匯入中...';
  try{
    const now=Date.now();
    const ref=await window._addDoc(window._collection(COL.orders),{
      orderId:d.ordId, dueDate:new Date(d.dueDate).getTime(),
      client:g('imp-ord-client')?.value||'',
      actualShipDate:new Date(d.dueDate).getTime(),
      actualShipDateManual:false,
      itemCount:d.matched.length,
      totalQty:d.matched.reduce((a,m)=>a+m.qty,0),
      createdAt:now, createdBy:window.cu.user,
      snapshotHr:getH(),
      snapshotWs:window.S?.ws||3000
    });
    const ordId=ref.id;
    for(const item of d.matched){
      for(const op of item.ops){
        await window._addDoc(window._collection(COL.processes),{
          orderId: ordId, orderNo:d.ordId,
          code:item.code, desc:item.desc, color:item.color,
          zh:item.zh, sz:item.sz, orderQty:item.qty,
          processNo:op.no, processZh:op.zh, processVi:op.vi||'',
          processSec:op.sec||0,
          quoteSnapshotSec:op.sec||0,
          workStdSec:op.sec||0,
          slPerHour:Math.round((window.S?.ws||3000)/Math.max(op.sec||1,1)),
          approvedQty:0, pendingQty:0, createdAt:now
        });
      }
    }
    const dueDate=new Date(d.dueDate).getTime();
    window.allOrders.unshift({id:ordId,orderId:d.ordId,client:g('imp-ord-client')?.value||'',dueDate,actualShipDate:dueDate,itemCount:d.matched.length,totalQty:d.matched.reduce((a,m)=>a+m.qty,0),createdAt:now});
    closeImportOrder();
    await reloadProcesses();
    renderOrders(); renderProgress();
    alert(`✅ Nhập thành công! / 匯入成功！\nĐơn hàng / 訂單：${d.ordId}\nMã hàng / 款號：${d.matched.length} cái / 個\nCông đoạn / 工序：${d.matched.reduce((a,m)=>a+m.ops.length,0)} quy trình / 道`);
  }catch(err){ alert('匯入失敗：'+err.message); }
  finally{ btn.disabled=false; btn.innerHTML='<i class="ti ti-check"></i>確認匯入'; }
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
  const tb=g('ord-tb'); if(!tb) return;
  const empty=g('ord-empty');
  tb.innerHTML='';
  const list=window.allOrders.filter(o=>!q||o.orderId.toLowerCase().includes(q));
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
        <div style="font-size:11px;color:var(--mu);margin-top:3px">統計中...</div>
      </td>
      <td><div style="display:flex;gap:4px">
        <button class="btn bsm" onclick="viewOrderProgress('${o.id}')"><i class="ti ti-chart-bar"></i></button>
        <button class="btn bsm bd2" onclick="deleteOrder('${o.id}','${o.orderId}')"><i class="ti ti-trash"></i></button>
      </div></td>`;
    tb.appendChild(tr);
  });
  fillOrderSelects();
}

function viewOrderProgress(id){
  g('prog-sel').value=id; sp('progress'); renderProgress();
}

async function deleteOrder(id,name){
  try{
    const procSnap=await window._getDocs(
      window._query(window._collection(COL.processes),window._where('orderId','==',id))
    );
    const procCount=procSnap.docs.length;
    const repSnap=await window._getDocs(
      window._query(window._collection(COL.reports),window._where('orderId','==',id),window._where('status','in',['approved','pending']))
    );
    if(repSnap.docs.length>0){
      alert(`⚠️ Không thể xóa / 無法刪除！\n\nĐơn hàng「${name}」có ${repSnap.docs.length} báo công chưa hủy / 訂單「${name}」有 ${repSnap.docs.length} 筆報工記錄尚未作廢。\nVui lòng hủy tất cả báo công trước khi xóa đơn hàng.\n請先作廢所有報工記錄再刪除訂單。`);
      return;
    }
    const msg=`Xác nhận xóa đơn hàng「${name}」?\n確定刪除訂單「${name}」？\n\n- Công đoạn / 工序記錄：${procCount} 筆將一併刪除\n\nDữ liệu sẽ không thể khôi phục.\n刪除後無法復原。`;
    if(!confirm(msg)) return;
    await Promise.all([
      window._deleteDoc(window._doc(COL.orders,id)),
      ...procSnap.docs.map(d=>window._deleteDoc(d.ref))
    ]);
    window.allOrders=window.allOrders.filter(o=>o.id!==id);
    window.allProcesses=window.allProcesses.filter(p=>p.orderId!==id);
    renderOrders();
    const pg=document.getElementById('pg-progress');
    if(pg&&pg.classList.contains('active')) renderProgress();
  }catch(e){ alert('刪除失敗：'+e.message); }
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
      if(!progMap[p.orderId]) progMap[p.orderId]={totalQty:0,approvedQty:0,procs:[]};
      progMap[p.orderId].totalQty+=(p.orderQty||0);
      progMap[p.orderId].approvedQty+=(p.approvedQty||0);
      progMap[p.orderId].procs.push(p);
    });
    let orders=window.allOrders;
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
      const pm=progMap[o.id]||{totalQty:0,approvedQty:0,procs:[]};
      const pct=pm.totalQty>0?Math.round(pm.approvedQty/pm.totalQty*100):0;
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
      const totalQty=o.pm.totalQty;
      const actualCompleteDateVal=o.actualCompleteDate?new Date(o.actualCompleteDate).toISOString().slice(0,10):'';
      const actualShipDateVal=o.actualShipDate?new Date(o.actualShipDate).toISOString().slice(0,10):(o.dueDate?new Date(o.dueDate).toISOString().slice(0,10):'');
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
          <button class="btn bsm bd2" onclick="deleteOrder('${o.id}','${o.orderId}')"><i class="ti ti-trash"></i></button>
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
    const cApv=cp.reduce((a,p)=>a+(p.approvedQty||0),0);
    const cQty=cp[0].orderQty||0;
    const cProg=cQty>0?Math.round(cApv/cQty*100):0;
    const procRows=cp.sort((a,b)=>String(a.processNo).localeCompare(String(b.processNo))).map(p=>{
      const rem=Math.max(0,(p.orderQty||0)-(p.approvedQty||0)-(p.pendingQty||0));
      const pg=p.orderQty>0?Math.round((p.approvedQty||0)/p.orderQty*100):0;
      return`<tr>
        <td style="padding:3px 6px;font-size:12px">${p.processNo}</td>
        <td style="padding:3px 6px;font-size:12px">${p.processVi||p.processZh||''}</td>
        <td style="padding:3px 6px;text-align:right;font-size:12px">${(p.orderQty||0).toLocaleString()}</td>
        <td style="padding:3px 6px;text-align:right;color:var(--ok);font-weight:500;font-size:12px">${(p.approvedQty||0).toLocaleString()}</td>
        <td style="padding:3px 6px;text-align:right;color:var(--warn);font-size:12px">${(p.pendingQty||0).toLocaleString()}</td>
        <td style="padding:3px 6px;text-align:right;color:var(--accent);font-size:12px">${rem.toLocaleString()}</td>
        <td style="padding:3px 6px;width:100px">
          <div style="position:relative;height:16px;background:var(--bd);border-radius:4px;overflow:hidden">
            <div style="position:absolute;left:0;top:0;height:100%;width:${Math.min(pg,100)}%;background:linear-gradient(90deg,#93c5fd,#3b82f6)"></div>
            <div style="position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;color:#1e3a5f">${pg}%</div>
          </div>
        </td>
      </tr>`;
    }).join('');
    html+=`<div style="margin-bottom:10px">
      <div style="font-size:12px;font-weight:500;color:var(--navy);margin-bottom:6px;padding:4px 0;border-bottom:1px solid var(--bd)">
        <b>${code}</b><span style="font-size:11px;color:var(--mu);margin-left:8px">${cp[0].desc||''} ${cp[0].color||''}</span>
        <span style="float:right;color:var(--accent)">${cProg}% · ${cApv.toLocaleString()}/${cQty.toLocaleString()}</span>
      </div>
      <div style="overflow-x:auto"><table style="width:100%;min-width:600px;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--sf)">
          <th style="padding:4px 6px;text-align:left;width:60px;font-size:11px">Số CĐ<br><span style="font-weight:400;color:var(--mu)">工序號</span></th>
          <th style="padding:4px 6px;text-align:left;font-size:11px">Tên CĐ<br><span style="font-weight:400;color:var(--mu)">工序名稱</span></th>
          <th style="padding:4px 6px;text-align:right;width:70px;font-size:11px">SL đơn<br><span style="font-weight:400;color:var(--mu)">訂單量</span></th>
          <th style="padding:4px 6px;text-align:right;width:70px;font-size:11px">Đã duyệt<br><span style="font-weight:400;color:var(--mu)">已通過</span></th>
          <th style="padding:4px 6px;text-align:right;width:70px;font-size:11px">Chờ duyệt<br><span style="font-weight:400;color:var(--mu)">待審批</span></th>
          <th style="padding:4px 6px;text-align:right;width:70px;font-size:11px">Còn lại<br><span style="font-weight:400;color:var(--mu)">剩餘</span></th>
          <th style="padding:4px 6px;width:100px;font-size:11px">Tiến độ<br><span style="font-weight:400;color:var(--mu)">進度</span></th>
        </tr></thead>
        <tbody>${procRows}</tbody>
      </table></div>
    </div>`;
  });
  body.innerHTML=html||'<span style="color:var(--mu);font-size:12px">無工序資料</span>';
}
