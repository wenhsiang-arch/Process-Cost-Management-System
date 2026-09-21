// shipped-orders（已出貨訂單）：只分類訂單顯示位置，不改變訂單使用中狀態。
(function(){
  'use strict';

  let busy=false;
  const safe=value=>window.PCMSSafe.text(value);
  const pair=(vi,zh)=>`<span class="ui-bilingual"><span class="ui-text-vi">${safe(vi)}</span><span class="ui-text-zh">${safe(zh)}</span></span>`;
  const shipped=order=>order?.shipmentStatus==='shipped';
  const usable=order=>window.isOrderUsable(order)&&shipped(order);
  const canManageShipment=()=>typeof window.canOpenPage==='function'&&window.canOpenPage('progress');

  function setLocalizedLabel(button,label){
    window.PCMSUIText?.setLocalizedAttribute?.(button,'title',label);
    window.PCMSUIText?.setLocalizedAttribute?.(button,'aria-label',label);
  }

  function iconButton(icon,label,className='btn bsm'){
    const button=document.createElement('button');
    button.type='button';
    button.className=className;
    button.innerHTML=`<i class="ti ${icon}" aria-hidden="true"></i>`;
    button.disabled=busy;
    setLocalizedLabel(button,label);
    return button;
  }

  async function cancelShipment(order){
    if(busy||!canManageShipment()) return;
    const confirmed=await window.ordersConfirm('Hủy xác nhận xuất hàng','取消確認出貨',
      `Chuyển đơn ${order.orderId} về danh sách đơn đang sử dụng?`,
      `將訂單 ${order.orderId} 移回使用中訂單清單？`);
    if(!confirmed) return;
    busy=true;render();
    try{
      const saved=await window.PCMSOrderService.setShipmentStatus(order.id,'pending',{note:order.orderId});
      Object.assign(order,saved);
      window.fillOrderSelects();
      window.renderProgress?.();
      await window.ordersMessage('Đã hủy xác nhận xuất hàng.','已取消確認出貨。','success');
    }catch(error){
      console.error('Không thể hủy xác nhận xuất hàng / 無法取消確認出貨：',error);
      await window.ordersMessage('Không thể hủy xác nhận xuất hàng.','無法取消確認出貨。','danger');
    }finally{busy=false;render();}
  }

  async function updateShipmentDate(order,value){
    if(busy||!canManageShipment()) return;
    if(!value){
      await window.ordersMessage('Ngày xuất hàng không được để trống.','實際出貨日不能空白。','warning');
      render();return;
    }
    busy=true;render();
    try{
      const saved=await window.PCMSOrderService.setShipmentStatus(order.id,'shipped',{actualShipDate:value,note:order.orderId});
      Object.assign(order,saved);
      await window.ordersMessage('Đã cập nhật ngày xuất hàng.','已更新實際出貨日。','success');
    }catch(error){
      console.error('Không thể cập nhật ngày xuất hàng / 無法更新實際出貨日：',error);
      await window.ordersMessage('Không thể cập nhật ngày xuất hàng.','無法更新實際出貨日。','danger');
    }finally{busy=false;render();}
  }

  async function refresh(){
    if(busy)return;
    busy=true;render();
    try{await window.reloadOrders({force:true});}
    catch(error){
      console.error('Không thể làm mới đơn đã xuất / 無法重新整理已出貨訂單：',error);
      await window.ordersMessage('Không thể làm mới danh sách.','無法重新整理清單。','danger');
    }finally{busy=false;render();}
  }

  function render(){
    const root=document.getElementById('shipped-orders-root');
    if(!root)return;
    const previousSearch=root.querySelector('[data-shipped-search]')?.value||'';
    root.replaceChildren();

    const toolbar=document.createElement('div');toolbar.className='shipped-orders-toolbar';
    const label=document.createElement('label');label.innerHTML=pair('Tìm đơn hàng','搜尋訂單');
    const input=document.createElement('input');input.type='search';input.dataset.shippedSearch='';input.value=previousSearch;
    input.disabled=busy;input.placeholder='Số đơn hàng / 訂單號碼';
    label.append(input);toolbar.append(label);
    const refreshButton=document.createElement('button');refreshButton.type='button';refreshButton.className='btn bsm';refreshButton.disabled=busy;
    refreshButton.innerHTML=`<i class="ti ti-refresh" aria-hidden="true"></i>${pair('Làm mới','重新整理')}`;
    refreshButton.addEventListener('click',()=>void refresh());toolbar.append(refreshButton);root.append(toolbar);

    if(busy){
      const status=document.createElement('div');status.className='shipped-orders-status ui-notice is-info';status.setAttribute('role','status');
      status.innerHTML=`<i class="ti ti-loader-2" aria-hidden="true"></i><div>${pair('Đang xử lý, vui lòng chờ.','正在處理，請稍候。')}</div>`;
      root.append(status);
    }

    const host=document.createElement('div');root.append(host);
    function fill(){
      host.replaceChildren();
      const query=input.value.trim().toLowerCase();
      const orders=(window.allOrders||[]).filter(usable)
        .filter(order=>`${order.orderId||''} ${order.client||''}`.toLowerCase().includes(query))
        .sort((a,b)=>(Number(b.actualShipDate)||0)-(Number(a.actualShipDate)||0)||(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0));
      if(!orders.length){
        const empty=document.createElement('div');empty.className='ui-empty-state';
        empty.innerHTML='<i class="ti ti-truck-delivery" aria-hidden="true"></i><div>Chưa có đơn hàng đã xuất.</div><div>尚無已出貨訂單。</div>';
        host.append(empty);return;
      }
      const wrap=document.createElement('div');wrap.className='shipped-orders-table-wrap ui-table-scroll';wrap.dataset.uiFloatingScroll='only';
      const table=document.createElement('table');table.className='shipped-orders-table ui-table';table.dataset.uiTableLayout='special';table.dataset.uiTableSticky='original';
      table.innerHTML=`<thead><tr>
        <th data-shipped-column="index">#</th>
        <th data-shipped-column="client">${pair('Khách hàng','客人')}</th>
        <th data-shipped-column="orderId">${pair('Số đơn hàng','訂單號碼')}</th>
        <th data-shipped-column="quantity" class="ui-table-number-cell">${pair('Số lượng','數量')}</th>
        <th data-shipped-column="dueDate">${pair('Theo PO','出貨日期PO')}</th>
        <th data-shipped-column="shipDate">${pair('Xuất hàng','實際出貨日')}</th>
        <th data-shipped-column="remark">${pair('Ghi chú','備註')}</th>
        <th data-shipped-column="action">${pair('Thao tác','操作')}</th>
      </tr></thead>`;
      const body=document.createElement('tbody');
      orders.forEach((order,index)=>{
        const row=document.createElement('tr');
        row.innerHTML=`<td>${index+1}</td><td><b>${safe(order.client||'-')}</b></td><td class="orders-order-id">${safe(order.orderId||'-')}</td>
          <td class="ui-table-number-cell">${Number(order.totalQty||0).toLocaleString()}</td><td>${safe(window.fmtVN(order.dueDate))}</td>
          <td></td><td class="shipped-orders-remark">${safe(order.remark||'—')}</td><td></td>`;
        const dateInput=document.createElement('input');dateInput.type='date';dateInput.className='orders-date-input';
        dateInput.value=window.formatLocalDate(order.actualShipDate);dateInput.disabled=busy||!canManageShipment();
        dateInput.addEventListener('change',()=>void updateShipmentDate(order,dateInput.value));row.children[5].append(dateInput);
        const actions=document.createElement('div');actions.className='shipped-orders-actions';
        if(canManageShipment()){
          const cancel=iconButton('ti-arrow-back-up',{vi:'Hủy xác nhận xuất hàng',zh:'取消確認出貨'});
          cancel.addEventListener('click',()=>void cancelShipment(order));actions.append(cancel);
        }
        if(String(order.client||'').trim().toUpperCase()==='HUNTER'){
          const report=iconButton('ti-file-spreadsheet',{vi:'Xuất báo cáo kiểm tra',zh:'匯出檢驗報告'},'btn bsm bd2');
          report.addEventListener('click',()=>void window.exportInspectionReportFromOrder(order.id,report));actions.append(report);
        }
        row.children[7].append(actions);body.append(row);
      });
      table.append(body);wrap.append(table);host.append(wrap);
    }
    input.addEventListener('input',fill);fill();
  }

  window.renderShippedOrders=render;
})();
