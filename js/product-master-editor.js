// product-master-editor（完整款號編輯介面）：只顯示單一款號；正式欄位修改改由共用群組快速修改面板處理。
(function(){
  'use strict';

  const CATEGORIES=Object.freeze(['BL','SX','QC','DG']);

  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function safe(value){ return window.PCMSSafe?.text?.(value)??String(value??''); }
  function safeAttribute(value){ return window.PCMSSafe?.attribute?.(value)??safe(value); }
  function ui(){
    if(!window.PCMSUIComponents) throw new Error('Thiếu thành phần giao diện chung. / 缺少共用介面元件。');
    return window.PCMSUIComponents;
  }
  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }
  function quick(){
    if(!window.PCMSProductQuickEdit) throw new Error('Thiếu quy trình cập nhật nhóm. / 缺少群組修改流程。');
    return window.PCMSProductQuickEdit;
  }
  function allowed(){ return window.cu?.role==='admin'||window.cu?.features?.productionProcessEdit===true; }
  function secondsAllowed(){ return window.cu?.role==='admin'||window.cu?.features?.processSecondsEdit===true; }
  function dualLabel(vi,zh){ return `<span class="ui-dual-copy"><strong>${safe(vi)}</strong><span>${safe(zh)}</span></span>`; }
  function categoryOptions(selected){
    return CATEGORIES.map(category=>`<option value="${category}"${category===selected?' selected':''}>${category}</option>`).join('');
  }
  function capacity(seconds){
    const value=Number(seconds)||0;
    const workSeconds=Number(window.S?.ws)||3000;
    return window.PCMSProductionEfficiencyCore?.hourlyCapacity?.(value,workSeconds)
      ??(value>0?Math.round(workSeconds/value):0);
  }

  function newOperationRow(operation){
    const row=document.createElement('tr');
    row.dataset.processId=operation.processId;
    row.dataset.newProcess='true';
    row.draggable=true;
    row.innerHTML=`
      <td class="product-master-drag-cell"><button type="button" class="product-master-drag-handle" tabindex="-1" title="Kéo để đổi vị trí / 拖曳調整位置"><i class="ti ti-grip-vertical"></i></button></td>
      <td class="ui-table-center-cell"><b data-process-no-display>${safe(operation.no)}</b></td>
      <td><select data-field="category">${categoryOptions(operation.category)}</select></td>
      <td><input type="text" maxlength="200" data-field="zh" value="${safeAttribute(operation.zh)}"></td>
      <td><input type="text" maxlength="200" data-field="vi" value="${safeAttribute(operation.vi)}"></td>
      <td><input type="number" min="1" max="86400" step="1" inputmode="numeric" data-field="sec" value="${safeAttribute(operation.sec)}"${secondsAllowed()?'':' disabled'}></td>
      <td class="product-master-capacity" data-capacity></td>`;
    return row;
  }

  function existingOperationRow(operation,createQuickTrigger){
    const row=document.createElement('tr');
    row.dataset.processId=operation.processId;
    row.dataset.newProcess='false';
    row.draggable=true;
    row._operation=clone(operation);
    row.innerHTML=`
      <td class="product-master-drag-cell"><button type="button" class="product-master-drag-handle" tabindex="-1" title="Kéo để đổi vị trí / 拖曳調整位置"><i class="ti ti-grip-vertical"></i></button></td>
      <td class="ui-table-center-cell" data-existing-field="processNo"></td>
      <td data-existing-field="processCategory"></td>
      <td data-existing-field="processNameZh"></td>
      <td data-existing-field="processNameVi"></td>
      <td class="ui-table-number-cell" data-existing-field="processSeconds"></td>
      <td class="product-master-capacity" data-capacity>${safe(capacity(operation.sec)||'—')}</td>`;
    const values={processNo:operation.no,processCategory:operation.category,processNameZh:operation.zh,
      processNameVi:operation.vi,processSeconds:operation.sec};
    Object.entries(values).forEach(([field,value])=>{
      row.querySelector(`[data-existing-field="${field}"]`)?.appendChild(createQuickTrigger(field,value,operation.processId));
    });
    return row;
  }

  function operationFromRow(row,index=0){
    const no=String(index+1);
    if(row.dataset.newProcess!=='true'){
      return {...clone(row._operation),no,sortOrder:Number(no),active:row._operation?.active!==false};
    }
    const value=field=>row.querySelector(`[data-field="${field}"]`)?.value;
    return {
      processId:row.dataset.processId,no,sortOrder:Number(no),category:value('category'),
      zh:value('zh'),vi:value('vi'),sec:Number(value('sec')),active:true
    };
  }

  function updateCapacity(row){
    if(row.dataset.newProcess!=='true') return;
    const host=row.querySelector('[data-capacity]');
    const value=capacity(row.querySelector('[data-field="sec"]')?.value);
    if(host) host.textContent=value>0?String(value):'—';
  }

  function renumberRows(processBody){
    [...processBody.querySelectorAll('tr')].forEach((row,index)=>{
      row.dataset.currentNo=String(index+1);
      const display=row.querySelector('[data-process-no-display]');
      if(display) display.textContent=String(index+1);
      updateCapacity(row);
    });
  }

  async function open(productInput,options={}){
    if(!allowed()){
      await ui().alertDialog({message:{vi:'Bạn không có quyền sửa mã hàng.',zh:'你沒有修改款號的權限。'},kind:'warning'});
      return false;
    }
    let base=clone(productInput);
    const body=document.createElement('div');
    body.className='product-master-editor';
    body.innerHTML=`
      <div class="ui-notice is-info product-master-edit-note"><i class="ti ti-click"></i>${dualLabel('Nhấn vào trường cần sửa để mở bảng sửa theo nhóm; mã hàng chỉ được xem.','點擊要修改的欄位會開啟群組修改面板；款號僅供查看。')}</div>
      <section class="product-master-fields" data-product-fields></section>
      <section class="product-master-processes">
        <header><div>${dualLabel('Toàn bộ công đoạn','完整工序')}</div><button type="button" class="ui-button is-compact" data-add-process><i class="ti ti-plus"></i>${dualLabel('Thêm công đoạn','新增工序')}</button></header>
        <div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table"><thead><tr>
          <th class="product-master-drag-column"></th><th class="ui-table-center-cell">${dualLabel('Số CĐ','工序號')}</th><th>${dualLabel('Phân loại','分類')}</th>
          <th>${dualLabel('Tên Trung','工序中文')}</th><th>${dualLabel('Tên Việt','工序越文')}</th><th class="ui-table-number-cell">${dualLabel('Giây','標準秒數')}</th>
          <th class="ui-table-number-cell">${dualLabel('SL/giờ','每小時產能')}</th>
        </tr></thead><tbody data-process-body></tbody></table></div></div>
      </section>`;
    const fieldsHost=body.querySelector('[data-product-fields]');
    const processBody=body.querySelector('[data-process-body]');

    function structuralChanged(){
      const rows=[...processBody.querySelectorAll('tr')];
      if(rows.length!==(base.ops||[]).length) return true;
      return rows.some((row,index)=>row.dataset.newProcess==='true'||row.dataset.processId!==base.ops?.[index]?.processId);
    }

    async function beforeQuickOpen(){
      if(!structuralChanged()) return true;
      await ui().alertDialog({
        message:{vi:'Hãy lưu hoặc hủy thay đổi vị trí / công đoạn mới trước khi sửa theo nhóm.',zh:'請先儲存或取消工序移動／新增，再進行群組修改。'},
        kind:'warning',keepPrevious:true
      });
      return false;
    }

    function latestGroup(){
      return window.PCMSProductGroupRuntime?.groupForProduct?.(base.productId)||options.group||null;
    }

    function savedCurrent(result){
      return result?.successes?.find(item=>item.product?.productId===base.productId)?.product
        ||result?.results?.find(item=>item.ok&&item.product?.productId===base.productId)?.product
        ||(Array.isArray(window.D)?window.D.find(item=>item.productId===base.productId):null);
    }

    function quickInput(field,value,processId=''){
      return {
        field,value,sourceProductId:base.productId,sourceProcessId:processId,
        products:Array.isArray(window.D)?window.D:[base],group:latestGroup(),keepPrevious:true,beforeOpen:beforeQuickOpen,
        onSaved:async result=>{
          const current=savedCurrent(result);
          if(current){ base=clone(current);render(); }
          await options.onSaved?.(result);
        }
      };
    }

    function createQuickTrigger(field,value,processId=''){
      return quick().createTrigger(quickInput(field,value,processId));
    }

    function renderProductFields(){
      fieldsHost.replaceChildren();
      const definitions=[
        {field:'code',vi:'Mã hàng',zh:'款號代碼',readonly:true},
        {field:'client',vi:'Khách hàng',zh:'款號客戶'},
        {field:'zh',vi:'Tên tiếng Trung',zh:'中文品名'},
        {field:'vi',vi:'Tên tiếng Việt',zh:'越文品名'},
        {field:'sz',vi:'Kích thước',zh:'尺寸'}
      ];
      definitions.forEach(item=>{
        const field=document.createElement('div');
        field.className='product-master-field';
        field.innerHTML=dualLabel(item.vi,item.zh);
        if(item.readonly){
          const value=document.createElement('div');
          value.className='product-master-readonly-value';
          value.innerHTML=`<i class="ti ti-lock" aria-hidden="true"></i><b>${safe(base[item.field]||'—')}</b>`;
          field.appendChild(value);
        }else{
          const trigger=createQuickTrigger(item.field,base[item.field]);
          trigger.classList.add('product-master-field-trigger');
          field.appendChild(trigger);
        }
        fieldsHost.appendChild(field);
      });
    }

    function renderProcesses(){
      processBody.replaceChildren();
      (base.ops||[]).forEach(operation=>processBody.appendChild(existingOperationRow(operation,createQuickTrigger)));
      renumberRows(processBody);
    }

    function render(){
      renderProductFields();
      renderProcesses();
    }

    let dragged=null;
    processBody.addEventListener('dragstart',event=>{
      dragged=event.target.closest('tr');
      if(!dragged){ event.preventDefault();return; }
      dragged.classList.add('is-dragging');
      event.dataTransfer.effectAllowed='move';
    });
    processBody.addEventListener('dragover',event=>{
      if(!dragged) return;
      event.preventDefault();
      const target=event.target.closest('tr');
      if(!target||target===dragged) return;
      const box=target.getBoundingClientRect();
      processBody.insertBefore(dragged,event.clientY<box.top+box.height/2?target:target.nextSibling);
    });
    processBody.addEventListener('drop',event=>{ if(dragged){event.preventDefault();renumberRows(processBody);} });
    processBody.addEventListener('dragend',()=>{
      dragged?.classList.remove('is-dragging');dragged=null;renumberRows(processBody);
    });
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
      const row=newOperationRow(operation);
      processBody.appendChild(row);renumberRows(processBody);
      row.querySelector('[data-field="vi"]')?.focus();
    });
    render();

    ui().openDialog({
      title:{vi:'Chỉnh sửa đầy đủ mã hàng',zh:'完整編輯款號'},body,size:'xlarge',
      actions:[
        {text:{vi:'Hủy',zh:'取消'}},
        {text:{vi:'Xem trước thay đổi',zh:'預覽修改內容'},icon:'ti-eye-check',kind:'primary',onClick:async()=>{
          renumberRows(processBody);
          const draft={...clone(base),ops:[...processBody.querySelectorAll('tr')].map(operationFromRow)};
          const result=await quick().saveWithWorkflow([
            {base:clone(base),draft,action:'productFullEdit'}
          ],{previewTitle:{vi:'Xem trước chỉnh sửa đầy đủ',zh:'預覽完整編輯內容'},onSaved:options.onSaved,keepPrevious:true});
          return result.cancelled?false:true;
        }}
      ],
      onError:error=>ui().alertDialog({message:window.PCMSUIText?.errorPair?.(error)||{vi:String(error.message||error),zh:String(error.message||error)},kind:'danger',keepPrevious:true}),
      onClose:()=>options.onClose?.()
    });
    return true;
  }

  function createButton(product,options={}){
    const button=document.createElement('button');
    button.type='button';button.className='product-master-full-edit-button';button.disabled=!allowed();
    button.innerHTML=`<i class="ti ti-edit"></i>${dualLabel('Sửa','編輯')}`;
    if(!button.disabled) button.addEventListener('click',event=>{ event.stopPropagation();void open(product,options); });
    return button;
  }

  window.PCMSProductMasterEditor=Object.freeze({open,createButton,allowed,operationFromRow});
})();
