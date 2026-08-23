// product-master-editor（完整款號編輯介面）：以單一款號作編輯範本，套用至使用者選取的同產品群組成員。
(function(){
  'use strict';

  const CATEGORIES=Object.freeze(['BL','SX','QC','DG']);
  const PRODUCT_FIELDS=Object.freeze(['code','client','zh','vi','sz']);
  const PROCESS_FIELDS=Object.freeze(['category','zh','vi','sec']);

  function text(value){ return String(value??'').trim(); }
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
  function groupUI(){
    if(!window.PCMSProcessGroupUI) throw new Error('Thiếu giao diện chọn nhóm theo kích thước. / 缺少尺寸群組選擇介面。');
    return window.PCMSProcessGroupUI;
  }
  function allowed(){ return window.cu?.role==='admin'||window.cu?.features?.productionProcessEdit===true; }
  function secondsAllowed(){ return window.cu?.role==='admin'||window.cu?.features?.processSecondsEdit===true; }
  function dualLabel(vi,zh){ return `<span class="ui-dual-copy"><strong>${safe(vi)}</strong><span>${safe(zh)}</span></span>`; }
  function categoryOptions(selected){
    return CATEGORIES.map(category=>`<option value="${category}"${category===selected?' selected':''}>${category}</option>`).join('');
  }

  function operationRow(operation){
    const row=document.createElement('tr');
    row.dataset.processId=operation.processId;
    row.dataset.active=operation.active===false?'false':'true';
    row.draggable=true;
    row.innerHTML=`
      <td class="product-master-drag-cell"><button type="button" class="product-master-drag-handle" tabindex="-1" title="Kéo để đổi vị trí / 拖曳調整位置"><i class="ti ti-grip-vertical"></i></button></td>
      <td><input type="number" min="1" max="99" step="1" data-field="no" value="${safeAttribute(operation.no)}"></td>
      <td><select data-field="category">${categoryOptions(operation.category)}</select></td>
      <td><input type="text" maxlength="200" data-field="zh" value="${safeAttribute(operation.zh)}"></td>
      <td><input type="text" maxlength="200" data-field="vi" value="${safeAttribute(operation.vi)}"></td>
      <td><input type="number" min="1" max="86400" step="1" inputmode="numeric" data-field="sec" value="${safeAttribute(operation.sec)}"${secondsAllowed()?'':' disabled'}></td>
      <td class="product-master-capacity" data-capacity></td>`;
    return row;
  }

  function operationFromRow(row){
    const value=field=>row.querySelector(`[data-field="${field}"]`)?.value;
    const no=String(Number.parseInt(value('no'),10)||1);
    return {
      processId:row.dataset.processId,no,sortOrder:Number(no),
      category:value('category'),zh:value('zh'),vi:value('vi'),sec:Number(value('sec')),
      active:row.dataset.active!=='false'
    };
  }

  function updateCapacity(row){
    const seconds=Number(row.querySelector('[data-field="sec"]')?.value);
    const workSeconds=Number(window.S?.ws)||3000;
    const capacity=window.PCMSProductionEfficiencyCore?.hourlyCapacity?.(seconds,workSeconds)
      ??(seconds>0?Math.round(workSeconds/seconds):0);
    const host=row.querySelector('[data-capacity]');
    if(host) host.textContent=capacity>0?String(capacity):'—';
  }

  function renumberRows(processBody){
    [...processBody.querySelectorAll('tr')].forEach((row,index)=>{
      const input=row.querySelector('[data-field="no"]');
      if(input) input.value=String(index+1);
      updateCapacity(row);
    });
  }

  function moveRow(processBody,row,position){
    const rows=[...processBody.querySelectorAll('tr')];
    const target=Math.max(1,Math.min(rows.length,Number.parseInt(String(position??''),10)||1));
    const reference=rows.filter(item=>item!==row)[target-1]||null;
    if(reference) processBody.insertBefore(row,reference);
    else processBody.appendChild(row);
    renumberRows(processBody);
  }

  function groupMembers(base,options={}){
    const products=Array.isArray(options.products)?options.products:(Array.isArray(window.D)?window.D:[]);
    const group=options.group||window.PCMSProductGroupRuntime?.groupForProduct?.(base.productId)||null;
    const ids=new Set((group?.memberProductIds||[base.productId]).map(item=>model().fixedId(item,'product')).filter(Boolean));
    ids.add(base.productId);
    return {group,members:products.filter(item=>ids.has(model().fixedId(item?.productId,'product')))};
  }

  function changedProductFields(base,draft){
    return PRODUCT_FIELDS.filter(field=>JSON.stringify(base?.[field])!==JSON.stringify(draft?.[field]));
  }

  function changedOperationFields(baseOperation,draftOperation){
    return PROCESS_FIELDS.filter(field=>JSON.stringify(baseOperation?.[field])!==JSON.stringify(draftOperation?.[field]));
  }

  function sameOrder(base,draft){
    return (base.ops||[]).map(item=>item.processId).join('|')===(draft.ops||[]).filter(item=>(base.ops||[]).some(old=>old.processId===item.processId)).map(item=>item.processId).join('|')
      &&(draft.ops||[]).length===(base.ops||[]).length;
  }

  // applyTemplate（將完整編輯差異套至群組成員）：相同原工序號才自動承接，描述不同不阻擋。
  function applyTemplate(baseSource,sourceDraft,target){
    if(target.productId===baseSource.productId) return {draft:clone(sourceDraft),warnings:[]};
    const draft=clone(target);
    const warnings=[];
    changedProductFields(baseSource,sourceDraft).forEach(field=>{
      // code（款號代碼）每個款號必須唯一，不把來源款號代碼複製到其他成員。
      if(field!=='code') draft[field]=clone(sourceDraft[field]);
    });
    const baseById=new Map((baseSource.ops||[]).map(item=>[item.processId,item]));
    const targetByOriginalNo=new Map((target.ops||[]).map(item=>[String(item.no),clone(item)]));
    const structural=!sameOrder(baseSource,sourceDraft);
    const used=new Set();
    const transformed=[];
    (sourceDraft.ops||[]).forEach(sourceOperation=>{
      const sourceBefore=baseById.get(sourceOperation.processId);
      if(!sourceBefore){
        transformed.push({...clone(sourceOperation),processId:model().createPermanentId('process')});
        return;
      }
      const targetOperation=targetByOriginalNo.get(String(sourceBefore.no));
      if(!targetOperation){
        warnings.push({vi:`Không có công đoạn ${sourceBefore.no} để áp dụng.`,zh:`沒有工序 ${sourceBefore.no} 可套用。`});
        return;
      }
      used.add(targetOperation.processId);
      const next=clone(targetOperation);
      changedOperationFields(sourceBefore,sourceOperation).forEach(field=>{ next[field]=clone(sourceOperation[field]); });
      transformed.push(next);
    });
    // 同一款號只要有既有工序無法唯一對應，就整筆不套用，避免只改到一半。
    if(warnings.length) return {draft:clone(target),warnings};
    if(structural){
      (target.ops||[]).filter(item=>!used.has(item.processId)).forEach(item=>transformed.push(clone(item)));
      draft.ops=model().renumberOperations(transformed);
    }else{
      const byId=new Map((draft.ops||[]).map(item=>[item.processId,item]));
      transformed.forEach(item=>{ if(byId.has(item.processId)) byId.set(item.processId,item); });
      draft.ops=[...byId.values()];
    }
    return {draft,warnings};
  }

  function buildRequests(base,sourceDraft,selectedProducts){
    const requests=[];
    const skipped=[];
    selectedProducts.forEach(product=>{
      const applied=applyTemplate(base,sourceDraft,product);
      const differences=model().compareProducts(product,applied.draft);
      if(!differences.length){
        if(applied.warnings.length) skipped.push({product,reason:applied.warnings[0]});
        return;
      }
      requests.push({base:clone(product),draft:applied.draft,action:'productFullGroupEdit',warnings:applied.warnings});
    });
    return {requests,skipped};
  }

  async function open(productInput,options={}){
    if(!allowed()){
      await ui().alertDialog({message:{vi:'Bạn không có quyền sửa mã hàng.',zh:'你沒有修改款號的權限。'},kind:'warning'});
      return false;
    }
    const base=clone(productInput);
    const grouped=groupMembers(base,options);
    const body=document.createElement('div');
    body.className='product-master-editor';
    body.innerHTML=`
      <section class="product-master-fields">
        <label>${dualLabel('Mã hàng','款號代碼')}<input type="text" maxlength="80" data-product-field="code" value="${safeAttribute(base.code)}"></label>
        <label>${dualLabel('Khách hàng','款號客戶')}<input type="text" maxlength="200" data-product-field="client" value="${safeAttribute(base.client)}"></label>
        <label>${dualLabel('Tên tiếng Trung','中文品名')}<input type="text" maxlength="200" data-product-field="zh" value="${safeAttribute(base.zh)}"></label>
        <label>${dualLabel('Tên tiếng Việt','越文品名')}<input type="text" maxlength="200" data-product-field="vi" value="${safeAttribute(base.vi)}"></label>
        <label>${dualLabel('Kích thước','尺寸')}<input type="text" maxlength="200" data-product-field="sz" value="${safeAttribute(base.sz)}"></label>
      </section>
      <section class="product-master-group-selection">
        <header>${dualLabel(grouped.group?.name||base.vi||base.code,'套用群組款號')}</header>
        <div class="ui-notice is-info"><i class="ti ti-checkbox"></i>${dualLabel('Chọn mã hàng cần áp dụng; khác biệt công đoạn chỉ để nhắc.','選擇要套用的款號；工序差異只作提醒。')}</div>
        <div data-group-selector></div>
      </section>
      <section class="product-master-processes">
        <header><div>${dualLabel('Toàn bộ công đoạn','完整工序')}</div><button type="button" class="ui-button is-compact" data-add-process><i class="ti ti-plus"></i>${dualLabel('Thêm công đoạn','新增工序')}</button></header>
        <div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table"><thead><tr>
          <th class="product-master-drag-column"></th><th>${dualLabel('Số CĐ','工序號')}</th><th>${dualLabel('Phân loại','分類')}</th>
          <th>${dualLabel('Tên Trung','工序中文')}</th><th>${dualLabel('Tên Việt','工序越文')}</th><th>${dualLabel('Giây','標準秒數')}</th>
          <th>${dualLabel('SL/giờ','每小時產能')}</th>
        </tr></thead><tbody data-process-body></tbody></table></div></div>
      </section>`;
    const selector=groupUI().createMemberSelector({
      products:grouped.members.length?grouped.members:[base],currentCode:base.code,activeSize:base.sz,
      selectedCodes:(grouped.members.length?grouped.members:[base]).map(item=>item.code),selectable:true,
      consistency:true,expandable:true,compact:true
    });
    body.querySelector('[data-group-selector]').appendChild(selector.element);
    const processBody=body.querySelector('[data-process-body]');
    (base.ops||[]).forEach(operation=>processBody.appendChild(operationRow(operation)));
    renumberRows(processBody);
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
    processBody.addEventListener('change',event=>{
      if(event.target?.matches?.('[data-field="no"]')) moveRow(processBody,event.target.closest('tr'),event.target.value);
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
      processBody.appendChild(row);renumberRows(processBody);
      row.querySelector('[data-field="vi"]')?.focus();
    });
    ui().openDialog({
      title:{vi:'Chỉnh sửa đầy đủ mã hàng',zh:'完整編輯款號'},body,size:'xlarge',
      actions:[
        {text:{vi:'Hủy',zh:'取消'}},
        {text:{vi:'Xem trước thay đổi',zh:'預覽修改內容'},icon:'ti-eye-check',kind:'primary',onClick:async()=>{
          const sourceDraft={...clone(base)};
          PRODUCT_FIELDS.forEach(field=>{ sourceDraft[field]=text(body.querySelector(`[data-product-field="${field}"]`)?.value); });
          renumberRows(processBody);
          sourceDraft.ops=[...processBody.querySelectorAll('tr')].map(operationFromRow);
          const selected=selector.selectedProducts();
          if(!selected.length){
            await ui().alertDialog({message:{vi:'Chưa chọn mã hàng cần sửa.',zh:'尚未選擇要修改的款號。'},kind:'warning',keepPrevious:true});
            return false;
          }
          const plan=buildRequests(base,sourceDraft,selected);
          const result=await quick().saveWithWorkflow(plan.requests,{skipped:plan.skipped,
            previewTitle:{vi:'Xem trước chỉnh sửa đầy đủ',zh:'預覽完整編輯內容'},onSaved:options.onSaved});
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

  window.PCMSProductMasterEditor=Object.freeze({open,createButton,allowed,operationFromRow,applyTemplate,buildRequests});
})();
