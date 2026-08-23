// product-master-editor（完整款號編輯介面）：編輯 Product-owned 欄位並交由唯一主檔服務儲存。
(function(){
  'use strict';

  const CATEGORIES=Object.freeze(['BL','SX','QC','DG']);

  function text(value){ return String(value??'').trim(); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function safe(value){
    if(window.PCMSSafe?.text) return window.PCMSSafe.text(value);
    return String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  }
  function ui(){
    if(!window.PCMSUIComponents) throw new Error('Thiếu thành phần giao diện chung. / 缺少共用介面元件。');
    return window.PCMSUIComponents;
  }
  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }
  function service(){
    if(!window.PCMSProductMasterService) throw new Error('Dịch vụ mã hàng chưa sẵn sàng. / 款號主檔服務尚未載入。');
    return window.PCMSProductMasterService;
  }
  function allowed(){
    return window.cu?.role==='admin'||window.cu?.features?.productionProcessEdit===true;
  }
  function secondsAllowed(){ return window.cu?.role==='admin'||window.cu?.features?.processSecondsEdit===true; }

  function dualLabel(vi,zh){ return `<span class="ui-dual-copy"><strong>${safe(vi)}</strong><span>${safe(zh)}</span></span>`; }
  function categoryOptions(selected){
    return CATEGORIES.map(category=>`<option value="${category}"${category===selected?' selected':''}>${category}</option>`).join('');
  }

  function operationRow(operation){
    const row=document.createElement('tr');
    row.dataset.processId=operation.processId;
    row.dataset.active=operation.active===false?'false':'true';
    row.innerHTML=`
      <td><input type="number" min="1" max="99" step="1" data-field="no" value="${safe(operation.no)}"></td>
      <td><input type="number" min="1" max="999" step="1" data-field="sortOrder" value="${safe(operation.sortOrder)}"></td>
      <td><select data-field="category">${categoryOptions(operation.category)}</select></td>
      <td><input type="text" maxlength="200" data-field="zh" value="${safe(operation.zh)}"></td>
      <td><input type="text" maxlength="200" data-field="vi" value="${safe(operation.vi)}"></td>
      <td><input type="number" min="1" max="86400" step="1" inputmode="numeric" data-field="sec" value="${safe(operation.sec)}"${secondsAllowed()?'':' disabled'}></td>
      <td class="product-master-capacity" data-capacity></td>`;
    return row;
  }

  function operationFromRow(row){
    const value=field=>row.querySelector(`[data-field="${field}"]`)?.value;
    return {
      processId:row.dataset.processId,no:value('no'),sortOrder:Number(value('sortOrder')),
      category:value('category'),zh:value('zh'),vi:value('vi'),sec:Number(value('sec')),
      active:row.dataset.active!=='false'
    };
  }

  function updateCapacity(row){
    const seconds=Number(row.querySelector('[data-field="sec"]')?.value);
    const workSeconds=Number(window.S?.ws)||3000;
    const capacity=window.PCMSProductionEfficiencyCore?.hourlyCapacity(seconds,workSeconds)
      ??(seconds>0?Math.round(workSeconds/seconds):0);
    const host=row.querySelector('[data-capacity]');
    if(host) host.textContent=capacity>0?String(capacity):'—';
  }

  function conflictBody(error){
    const body=document.createElement('div');
    body.className='product-master-conflict-list';
    const notice=document.createElement('div');
    notice.className='ui-notice is-warning';
    notice.innerHTML=`<i class="ti ti-alert-triangle"></i>${dualLabel('Dữ liệu cùng trường đã được sửa. Nội dung bạn nhập vẫn được giữ trong cửa sổ.','相同欄位已被修改；你尚未送出的內容仍保留在視窗中。')}`;
    body.appendChild(notice);
    (error?.conflicts||[]).forEach(conflict=>{
      const section=document.createElement('section');
      section.innerHTML=`<b>${safe(conflict.path)}</b><dl><div><dt>${dualLabel('Giá trị hiện tại','目前雲端值')}</dt><dd>${safe(conflict.currentValue??'—')}</dd></div><div><dt>${dualLabel('Giá trị của bạn','你的修改值')}</dt><dd>${safe(conflict.draftValue??'—')}</dd></div></dl>`;
      body.appendChild(section);
    });
    return body;
  }

  async function open(productInput,options={}){
    if(!allowed()){
      await ui().alertDialog({message:{vi:'Bạn không có quyền sửa mã hàng.',zh:'你沒有修改款號的權限。'},kind:'warning'});
      return false;
    }
    const base=clone(productInput);
    const body=document.createElement('div');
    body.className='product-master-editor';
    body.innerHTML=`
      <section class="product-master-fields">
        <label>${dualLabel('Mã hàng','款號代碼')}<input type="text" maxlength="80" data-product-field="code" value="${safe(base.code)}"></label>
        <label>${dualLabel('Khách hàng','款號客戶')}<input type="text" maxlength="200" data-product-field="client" value="${safe(base.client)}"></label>
        <label>${dualLabel('Tên tiếng Trung','中文品名')}<input type="text" maxlength="200" data-product-field="zh" value="${safe(base.zh)}"></label>
        <label>${dualLabel('Tên tiếng Việt','越文品名')}<input type="text" maxlength="200" data-product-field="vi" value="${safe(base.vi)}"></label>
        <label>${dualLabel('Kích thước','尺寸')}<input type="text" maxlength="200" data-product-field="sz" value="${safe(base.sz)}"></label>
      </section>
      <section class="product-master-processes">
        <header><div>${dualLabel('Toàn bộ công đoạn','完整工序')}</div><button type="button" class="ui-button is-compact" data-add-process><i class="ti ti-plus"></i>${dualLabel('Thêm công đoạn','新增工序')}</button></header>
        <div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table"><thead><tr>
          <th>${dualLabel('Số CĐ','工序號')}</th><th>${dualLabel('Thứ tự','排序')}</th><th>${dualLabel('Phân loại','分類')}</th>
          <th>${dualLabel('Tên Trung','工序中文')}</th><th>${dualLabel('Tên Việt','工序越文')}</th><th>${dualLabel('Giây','標準秒數')}</th>
          <th>${dualLabel('SL/giờ','每小時產能')}</th>
        </tr></thead><tbody data-process-body></tbody></table></div></div>
      </section>`;
    const processBody=body.querySelector('[data-process-body]');
    (base.ops||[]).forEach(operation=>processBody.appendChild(operationRow(operation)));
    processBody.querySelectorAll('tr').forEach(updateCapacity);
    processBody.addEventListener('input',event=>{
      if(event.target?.matches?.('[data-field="sec"]')) updateCapacity(event.target.closest('tr'));
    });
    const addProcessButton=body.querySelector('[data-add-process]');
    if(addProcessButton&&!secondsAllowed()) addProcessButton.disabled=true;
    addProcessButton?.addEventListener('click',()=>{
      const rows=[...processBody.querySelectorAll('tr')];
      const operation={
        processId:model().createPermanentId('process'),no:String(Math.min(99,rows.length+1)),sortOrder:rows.length+1,
        category:'SX',zh:'',vi:'',sec:1,active:true
      };
      const row=operationRow(operation);
      processBody.appendChild(row);
      updateCapacity(row);
      row.querySelector('[data-field="no"]')?.focus();
    });
    let saved=false;
    ui().openDialog({
      title:{vi:'Chỉnh sửa đầy đủ mã hàng',zh:'完整編輯款號'},body,size:'xlarge',
      actions:[
        {text:{vi:'Hủy',zh:'取消'}},
        {text:{vi:'Lưu thay đổi',zh:'儲存修改'},icon:'ti-device-floppy',kind:'primary',onClick:async()=>{
          const draft={...clone(base)};
          ['code','client','zh','vi','sz'].forEach(field=>{ draft[field]=text(body.querySelector(`[data-product-field="${field}"]`)?.value); });
          draft.ops=[...processBody.querySelectorAll('tr')].map(operationFromRow);
          try{
            const result=await service().saveDraft({base,draft,action:'productFullEdit'});
            saved=true;
            await options.onSaved?.(result);
            ui().showToast?.({kind:'success',text:{vi:'Đã cập nhật mã hàng.',zh:'款號已更新。'}});
            return true;
          }catch(error){
            if(error?.code==='product-field-conflict'){
              await ui().alertDialog({body:conflictBody(error),kind:'warning',keepPrevious:true});
              return false;
            }
            throw error;
          }
        }}
      ],
      onError:error=>ui().alertDialog({message:window.PCMSUIText?.errorPair?.(error)||{vi:String(error.message||error),zh:String(error.message||error)},kind:'danger',keepPrevious:true}),
      onClose:()=>{ if(!saved) options.onClose?.(); }
    });
    return true;
  }

  function createButton(product,options={}){
    const button=document.createElement('button');
    button.type='button';
    button.className='product-master-full-edit-button';
    button.disabled=!allowed();
    button.innerHTML=`<i class="ti ti-edit"></i>${dualLabel('Sửa','編輯')}`;
    if(!button.disabled) button.addEventListener('click',event=>{ event.stopPropagation();void open(product,options); });
    return button;
  }

  window.PCMSProductMasterEditor=Object.freeze({open,createButton,allowed,operationFromRow});
})();
