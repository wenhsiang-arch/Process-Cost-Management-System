// order-archive（已封存訂單畫面）：管理員自行判斷關聯；不提供自動無關聯保證。
(function(){
  'use strict';
  let busy=false;
  const expanded=new Map();
  const pair=(vi,zh)=>ordersPairHtml(vi,zh);
  const safe=value=>window.PCMSSafe.text(value);
  const isAdmin=()=>window.cu?.role==='admin';
  function button(vi,zh,action,disabled=false){
    const node=document.createElement('button');node.type='button';node.className='btn bsm';
    node.innerHTML=pair(vi,zh);node.disabled=disabled||busy;node.addEventListener('click',action);return node;
  }
  async function detail(order){
    if(expanded.has(order.id)){expanded.delete(order.id);render();return;}
    try{
      const rows=await window.PCMSOrderService.loadOrderItems(order.id);
      expanded.set(order.id,rows);render();
    }catch(error){await window.ordersMessage('Không thể tải chi tiết.','無法載入明細。','danger');}
  }
  async function restore(order){
    if(busy)return;
    busy=true;render();
    try{
      if(await window.ordersConfirm('Khôi phục đơn hàng','還原訂單',`Khôi phục ${order.orderId}?`,`還原 ${order.orderId}？`)){
        Object.assign(order,await window.PCMSOrderService.setLifecycle(order.id,'active'));
        window.fillOrderSelects();
      }
    }catch(error){await window.ordersMessage('Không thể khôi phục đơn hàng.','無法還原訂單。','danger');}
    finally{busy=false;expanded.delete(order.id);render();}
  }
  async function purge(order){
    if(!isAdmin()||busy)return;
    const confirmed=await window.ordersConfirm('Xóa vĩnh viễn đơn hàng','永久刪除訂單',
      `Đơn: ${order.orderId}\nKhách hàng: ${order.client}\nSố dòng ban đầu: ${order.itemCount}\nXóa đơn, chi tiết và giải phóng số đơn; không thể hoàn tác. Giữ nhật ký thao tác. Quan hệ dữ liệu do quản trị viên tự xác nhận.`,
      `訂單：${order.orderId}\n客戶：${order.client}\n原始明細：${order.itemCount} 筆\n刪除訂單與明細並釋放單號，無法復原；保留操作紀錄。資料關聯由管理員自行確認。`,
      {kind:'danger',confirmText:{vi:'Xác nhận xóa vĩnh viễn',zh:'確認永久刪除'}});
    if(!confirmed)return;
    busy=true;render();
    try{
      await window.PCMSOrderService.purgeOrder(order.id,{onProgress:progress=>{
        const status=document.getElementById('order-archive-status');
        if(status)status.innerHTML=pair(`Đã xóa ${progress.deletedThisRun} dòng trong lần này.`,`本次已刪除 ${progress.deletedThisRun} 筆明細。`);
      }});
      window.allOrders=window.allOrders.filter(row=>row.id!==order.id);
      window.allProcesses=window.allProcesses.filter(row=>row.orderId!==order.id);
      window.resetOrderRuntimeCache();window.fillOrderSelects();
      await window.ordersMessage('Đã xóa đơn và giải phóng số đơn.','已刪除訂單並釋放單號。','success');
    }catch(error){
      try{const snapshot=await window._getDoc(window._docRef('orders',order.id));
        if(snapshot.exists())Object.assign(order,snapshot.data());
      }catch(ignored){}
      await window.ordersMessage('Chưa xác nhận hoàn tất xóa. Tải lại danh sách rồi tiếp tục; không nhập lại đơn trước khi hoàn tất.',
        '尚未確認刪除完成，請重新整理清單後接續；完成前不要重匯此訂單。','danger');
    }finally{busy=false;expanded.delete(order.id);render();}
  }
  function render(){
    const root=document.getElementById('order-archive-root');if(!root)return;
    const search=root.querySelector('input')?.value||'';
    root.replaceChildren();
    const toolbar=document.createElement('div');toolbar.className='order-archive-toolbar';
    const label=document.createElement('label');label.innerHTML=pair('Tìm đơn hàng','搜尋訂單');
    const input=document.createElement('input');input.type='search';input.value=search;input.disabled=busy;
    label.append(input);toolbar.append(label);
    toolbar.append(button('Làm mới','重新整理',async()=>{
      busy=true;render();
      try{await window.reloadOrders({force:true});expanded.clear();}
      catch(error){await window.ordersMessage('Không thể làm mới danh sách.','無法重新整理清單。','danger');}
      finally{busy=false;render();}
    }));root.append(toolbar);
    if(busy){const status=document.createElement('p');status.id='order-archive-status';status.setAttribute('role','status');status.innerHTML=pair('Đang xử lý, vui lòng chờ.','正在處理，請稍候。');root.append(status);}
    const list=document.createElement('div');root.append(list);
    function fill(){
      list.replaceChildren();
      const query=input.value.toLowerCase();
      const orders=(window.allOrders||[]).filter(order=>['archived','deleting'].includes(order.lifecycleStatus)
        && `${order.orderId} ${order.client}`.toLowerCase().includes(query));
      for(const order of orders){
        const section=document.createElement('section');section.className='order-archive-row';
        const info=document.createElement('div');info.innerHTML=`<strong>${safe(order.orderId)}</strong><span>${safe(order.client)}</span>`;
        info.append(document.createTextNode(` · ${Number(order.itemCount)||0} `));
        const units=document.createElement('span');units.innerHTML=pair('dòng','筆明細');info.append(units);
        section.append(info);
        const actions=document.createElement('div');actions.className='order-archive-actions';
        actions.append(button('Chi tiết','明細',()=>detail(order),order.lifecycleStatus==='deleting'));
        if(order.lifecycleStatus==='archived')actions.append(button('Khôi phục','還原',()=>restore(order)));
        if(isAdmin())actions.append(button(order.lifecycleStatus==='deleting'?'Tiếp tục xóa':'Xóa vĩnh viễn',
          order.lifecycleStatus==='deleting'?'接續刪除':'永久刪除',()=>purge(order)));
        section.append(actions);
        if(order.lifecycleStatus==='deleting'){
          const status=document.createElement('p');status.innerHTML=pair('Đang xóa; không thể khôi phục.','刪除中，不能還原。');section.append(status);
        }
        if(expanded.has(order.id)){
          const table=document.createElement('table');table.className='order-archive-details';
          table.innerHTML=`<thead><tr>${[['Dòng','列號'],['Mô tả','品名'],['Màu','顏色'],['Số lượng','數量']].map(p=>`<th>${pair(...p)}</th>`).join('')}</tr></thead>`;
          const body=document.createElement('tbody');
          expanded.get(order.id).forEach(item=>{const tr=document.createElement('tr');
            [item.lineNumber,item.description,item.color,item.quantity].forEach(value=>{const td=document.createElement('td');td.textContent=String(value??'');tr.append(td);});body.append(tr);});
          table.append(body);section.append(table);
        }
        list.append(section);
      }
      if(!orders.length){const empty=document.createElement('p');empty.className='ui-empty-state';empty.innerHTML=pair('Không có đơn đã lưu trữ.','沒有已封存訂單。');list.append(empty);}
    }
    input.addEventListener('input',fill);fill();
  }
  window.renderOrderArchive=render;
})();
