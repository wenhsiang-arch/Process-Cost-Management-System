// ===== 訂單系統資料 =====
window.allOrders    = [];
window.allEmployees = [];

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
    const snap=await window._getDocs(window._query(window._collection(COL.reports),window._where('status','==','pending')));
    updateApvBadge(snap.docs.length);
  }catch(e){}
  fillOrderSelects();
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
  om('m-import-order');
}

function handleImportFile(input){
  const file=input.files[0]; if(!file) return;
  const ordId=g('imp-ord-id').value.trim();
  const dueDate=g('imp-ord-date').value;
  if(!ordId){ alert('請先填寫訂單編號'); input.value=''; return; }
  if(!dueDate){ alert('請先填寫出貨日期'); input.value=''; return; }
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
          matched.push({code,desc:String(r[iDesc]||'').trim(),color:String(r[iColor]||'').trim(),qty,ops:prod.ops||[],zh:prod.zh||'',sz:prod.sz||''});
        } else { skipped.push(code); }
      });
      window._impData={ordId,dueDate,matched,skipped};
      g('imp-step2').style.display='block';
      const _ioMsg=document.getElementById('imp-order-ok');
      if(_ioMsg) _ioMsg.innerHTML=`<i class="ti ti-check"></i> 找到 <b>${matched.length}</b> 個款號，共 <b>${matched.reduce((a,m)=>a+m.ops.length,0)}</b> 道工序`;
      if(skipped.length>0){
        const sm=g('imp-skip-msg'); sm.style.display='flex';
        sm.innerHTML=`<i class="ti ti-alert-triangle"></i> 跳過 ${skipped.length} 款（工序表找不到）：${skipped.slice(0,5).join('、')}${skipped.length>5?'...':''}`;
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
  const btn=g('imp-confirm-btn');
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i> 匯入中...';
  try{
    const now=Date.now();
    const ref=await window._addDoc(window._collection(COL.orders),{
      orderId:d.ordId, dueDate:new Date(d.dueDate).getTime(),
      itemCount:d.matched.length,
      totalQty:d.matched.reduce((a,m)=>a+m.qty,0),
      createdAt:now, createdBy:window.cu.user
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
          slPerHour:op.qty||Math.round(3600/Math.max(op.sec||1,1)),
          approvedQty:0, pendingQty:0, createdAt:now
        });
      }
    }
    window.allOrders.unshift({id:ordId,orderId:d.ordId,dueDate:new Date(d.dueDate).getTime(),itemCount:d.matched.length,totalQty:d.matched.reduce((a,m)=>a+m.qty,0),createdAt:now});
    cm('m-import-order'); renderOrders();
    alert(`✅ 匯入成功！\n訂單：${d.ordId}\n款號：${d.matched.length} 個\n工序：${d.matched.reduce((a,m)=>a+m.ops.length,0)} 道`);
  }catch(err){ alert('匯入失敗：'+err.message); }
  finally{ btn.disabled=false; btn.innerHTML='<i class="ti ti-check"></i>確認匯入'; }
}

// ===== 訂單列表 =====
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
  if(!confirm(`確定刪除訂單 ${name}？`)) return;
  try{
    await window._deleteDoc(window._doc(COL.orders,id));
    window.allOrders=window.allOrders.filter(o=>o.id!==id);
    renderOrders();
  }catch(e){ alert('刪除失敗：'+e.message); }
}

// ===== 訂單進度 =====
async function renderProgress(){
  const ordId=g('prog-sel')?.value;
  const content=g('prog-content'); if(!content) return;
  content.innerHTML='';
  if(!ordId){ content.innerHTML='<div style="padding:20px;text-align:center;color:var(--hi)">請先選擇訂單</div>'; return; }
  const order=window.allOrders.find(o=>o.id===ordId); if(!order) return;
  try{
    const snap=await window._getDocs(window._query(window._collection(COL.processes),window._where('orderId','==',ordId)));
    const procs=snap.docs.map(d=>({id:d.id,...d.data()}));
    const totalApv=procs.reduce((a,p)=>a+(p.approvedQty||0),0);
    const totalQty=procs.reduce((a,p)=>a+(p.orderQty||0),0);
    const overall=totalQty>0?Math.round(totalApv/totalQty*100):0;
    const byCode={};
    procs.forEach(p=>{ if(!byCode[p.code]) byCode[p.code]=[]; byCode[p.code].push(p); });
    let html=`<div class="card" style="margin-bottom:12px">
      <div style="font-size:15px;font-weight:600;color:var(--navy);margin-bottom:8px">${order.orderId} · 出貨 ${fmtVN(order.dueDate)}</div>
      <div style="font-size:12px;color:var(--mu);margin-bottom:6px">整體進度：<b style="color:var(--accent)">${overall}%</b>（已通過 ${totalApv.toLocaleString()} / 總量 ${totalQty.toLocaleString()}）</div>
      <div style="background:#e2e8f0;border-radius:99px;height:10px"><div style="height:10px;border-radius:99px;background:${overall>=100?'#22c55e':'var(--accent)'};width:${Math.min(overall,100)}%"></div></div>
    </div>`;
    Object.entries(byCode).forEach(([code,cp])=>{
      const cApv=cp.reduce((a,p)=>a+(p.approvedQty||0),0);
      const cQty=cp[0].orderQty||0;
      const cProg=cQty>0?Math.round(cApv/cQty*100):0;
      const procRows=cp.sort((a,b)=>String(a.processNo).localeCompare(String(b.processNo))).map(p=>{
        const rem=Math.max(0,(p.orderQty||0)-(p.approvedQty||0)-(p.pendingQty||0));
        const pg=p.orderQty>0?Math.round((p.approvedQty||0)/p.orderQty*100):0;
        return`<tr><td>${p.processNo}</td><td>${p.processVi||p.processZh}</td>
          <td>${(p.orderQty||0).toLocaleString()}</td>
          <td style="color:var(--ok);font-weight:500">${(p.approvedQty||0).toLocaleString()}</td>
          <td style="color:var(--warn)">${(p.pendingQty||0).toLocaleString()}</td>
          <td style="color:var(--accent)">${rem.toLocaleString()}</td>
          <td><div style="background:#e2e8f0;border-radius:99px;height:6px"><div style="height:6px;border-radius:99px;background:${pg>=100?'#22c55e':'var(--accent)'};width:${Math.min(pg,100)}%"></div></div><div style="font-size:10px;color:var(--mu)">${pg}%</div></td></tr>`;
      }).join('');
      html+=`<div class="card" style="margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
          <div><b style="color:var(--navy)">${code}</b><span style="font-size:12px;color:var(--mu);margin-left:8px">${cp[0].desc||''} ${cp[0].color||''}</span></div>
          <span style="font-size:13px;color:var(--accent);font-weight:500">${cProg}% · ${cApv.toLocaleString()}/${cQty.toLocaleString()}</span>
        </div>
        <div style="display:none;margin-top:10px">
          <div class="to"><table><thead><tr><th>Số CĐ / 工序號</th><th>Tên CĐ / 工序名稱</th><th>SL đơn / 訂單量</th><th>Đã duyệt / 已通過</th><th>Chờ duyệt / 待審批</th><th>Còn lại / 剩餘</th><th>Tiến độ / 進度</th></tr></thead><tbody>${procRows}</tbody></table></div>
        </div>
      </div>`;
    });
    content.innerHTML=html;
  }catch(e){ content.innerHTML='<div style="color:var(--err);padding:20px">載入失敗</div>'; }
}
