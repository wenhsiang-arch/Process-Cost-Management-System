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

async function syncConfirm(){
  const ordId = g('sync-order').value;
  const procNo = g('sync-proc').value;
  if(!ordId||!procNo){ alert('請先選擇訂單與工序'); return; }
  const inputs = document.querySelectorAll('[id^=sync-inp-]');
  const updates = [];
  inputs.forEach(inp=>{
    const val = parseInt(inp.value);
    if(val>0) updates.push({ procId: inp.dataset.procId, code: inp.dataset.code, newSec: val });
  });
  if(!updates.length){ alert('請至少輸入一筆新秒數 / Vui lòng nhập ít nhất 1 giây mới'); return; }
  if(!confirm(`確認同步 ${updates.length} 筆？此操作將同步更新對應款號的報工記錄。\nXác nhận đồng bộ ${updates.length} mục?`)) return;
  const btn = document.querySelector('#pg-sync .btn.bp');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i> 同步中...'; }
  let errors = [];
  try{
    for(const u of updates){
      const newSlph = Math.round((window.S?.ws||3000)/u.newSec);
      try{
        await window._updateDoc(window._doc(COL.processes, u.procId),{
          workStdSec: u.newSec,
          slPerHour: newSlph
        });
        const repSnap = await window._getDocs(
          window._query(window._collection(COL.reports),
            window._where('orderId','==',ordId),
            window._where('processNo','==',procNo),
            window._where('code','==',u.code)
          )
        );
        for(const rd of repSnap.docs){
          await window._updateDoc(rd.ref,{ slPerHour: newSlph });
        }
      }catch(e){ errors.push(u.code); console.error('syncConfirm error:',e); }
    }
    if(errors.length){
      alert('⚠️ '+errors.length+' 筆更新失敗（'+errors.join('、')+'），請重試');
    } else {
      alert('✅ 同步完成 / Đồng bộ hoàn tất！\n更新 '+updates.length+' 筆工序，報工記錄已同步');
    }
    const procNo2 = procNo;
    await syncLoadProcs();
    g('sync-proc').value = procNo2;
    syncLoadTable();
  }catch(e){
    alert('同步失敗：'+e.message);
  } finally {
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="ti ti-refresh"></i>Xác nhận đồng bộ / 確認同步'; }
  }
}
