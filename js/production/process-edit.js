// process-edit（工序修改畫面）：依客人選擇款號、套用已確認群組、修改正式工序並下載歷史版本。
(function(){
  'use strict';

  const state={currentCode:'',selectedClient:'',applyMode:'current',editMode:'standardCorrection',draft:[],selectedTargets:new Set(),groupSelector:null,dirty:false,initialized:false,languageBound:false,pendingChecked:false,dragIndex:-1};
  const safe=value=>window.PCMSSafe.text(value);
  const textApi=()=>window.PCMSUIText;
  const ui=()=>window.PCMSUIComponents;
  const store=()=>window.PCMSProcessEditStore;
  const groupUI=()=>window.PCMSProcessGroupUI;
  const productByCode=code=>(window.D||[]).find(item=>String(item.code||'').trim()===String(code||'').trim())||null;
  const canEdit=()=>typeof window.canEditProcessSeconds==='function'&&window.canEditProcessSeconds();

  function setStatus(pair,kind='info'){
    const host=document.getElementById('process-edit-status');
    if(!host) return;
    host.replaceChildren(ui().createNotice({text:pair,kind,long:true}));
    host.hidden=false;
  }

  function clearStatus(){
    const host=document.getElementById('process-edit-status');
    if(host){ host.hidden=true; host.replaceChildren(); }
  }

  function buildRoot(){
    const root=document.getElementById('production-process-edit-root');
    if(!root||root.childElementCount) return;
    root.innerHTML=`
      <div class="production-process-edit-page ui-work-panel">
        <section class="process-edit-toolbar ui-operation-panel">
          <div class="process-edit-command ui-command-row">
            <div class="process-edit-context-grid ui-context-grid">
              <label class="process-edit-client-field ui-context-item">
                <i class="ti ti-users" aria-hidden="true"></i>
                <div>
                  <span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span>
                  <select id="process-edit-client-select"></select>
                </div>
              </label>
              <label class="process-edit-product-field ui-context-item">
                <i class="ti ti-tag" aria-hidden="true"></i>
                <div>
                  <span class="ui-dual-copy"><strong>Mã hàng</strong><span>款號</span></span>
                  <input type="search" id="process-edit-product-input" list="process-edit-product-options" autocomplete="off" placeholder="Nhập mã hàng / 輸入款號">
                  <datalist id="process-edit-product-options"></datalist>
                </div>
              </label>
              <div class="process-edit-toolbar-group ui-context-item is-empty" id="process-edit-toolbar-group" aria-live="polite">
                <i class="ti ti-box-multiple" aria-hidden="true"></i>
                <div><span class="ui-dual-copy"><strong>Nhóm cùng sản phẩm</strong><span>同產品群組</span></span><b class="process-edit-toolbar-group-value">—</b></div>
              </div>
            </div>
            <div class="process-edit-command-actions ui-command-actions">
              <button type="button" class="process-edit-command-action ui-command-action is-primary" id="process-edit-load-button"><i class="ti ti-search"></i><span class="ui-dual-copy"><strong>Mở mã hàng</strong><span>開啟款號</span></span></button>
              <button type="button" class="process-edit-command-action ui-command-action" id="process-edit-history-button"><i class="ti ti-history"></i><span class="ui-dual-copy"><strong>Lịch sử phiên bản</strong><span>款號版本歷史</span></span></button>
              <button type="button" class="process-edit-command-action ui-command-action" id="process-edit-open-groups"><i class="ti ti-box-multiple"></i><span class="ui-dual-copy"><strong>Mở nhóm</strong><span>群組管理</span></span></button>
            </div>
          </div>
        </section>
        <div id="process-edit-status" hidden></div>
        <section class="process-edit-empty ui-empty-state" id="process-edit-empty">
          <i class="ti ti-list-details"></i><span class="ui-dual-copy"><strong>Chọn mã hàng để sửa công đoạn</strong><span>請先選擇要修改工序的款號</span></span>
        </section>
        <div id="process-edit-workspace" hidden>
          <section class="process-edit-product-context ui-data-section">
            <div class="ui-section-header"><i class="ti ti-box"></i><span class="ui-dual-copy"><strong>Mã hàng và nhóm cùng sản phẩm</strong><span>款號與同產品群組</span></span></div>
            <div class="process-edit-current-summary" id="process-edit-current-summary"></div>
            <div class="process-edit-group-area" id="process-edit-group-area"></div>
          </section>
          <section class="process-edit-mode-panel ui-data-section" id="process-edit-mode-panel">
            <div class="ui-section-header"><i class="ti ti-adjustments"></i><span class="ui-dual-copy"><strong>Chế độ sửa chính thức</strong><span>正式修改模式</span></span></div>
            <div class="process-edit-mode-selector">
              <label class="process-edit-mode-option"><input type="radio" name="official-process-edit-mode" value="standardCorrection" checked><span class="ui-dual-copy"><strong>Sửa lỗi tiêu chuẩn</strong><span>標準錯誤訂正</span></span><small class="ui-bilingual"><span class="ui-text-vi">Sửa giây và hiệu suất của bản ghi cũ; vẫn lưu giây trong bảng mã hàng trước khi sửa.</span><span class="ui-text-zh">訂正舊登記秒數與效率，並保留修改前的款號表秒數。</span></small></label>
              <label class="process-edit-mode-option"><input type="radio" name="official-process-edit-mode" value="processOptimization"><span class="ui-dual-copy"><strong>Tối ưu công đoạn</strong><span>工序優化</span></span><small class="ui-bilingual"><span class="ui-text-vi">Giữ nguyên bản ghi cũ; tiêu chuẩn mới dùng từ khi đồng bộ xong.</span><span class="ui-text-zh">舊產能登記完全不變；同步完成後才使用新標準。</span></small></label>
            </div>
            <div class="ui-notice is-info" id="process-edit-mode-structural-note" hidden><i class="ti ti-info-circle"></i><span class="ui-dual-copy"><strong>Thêm, xóa, đổi tên hoặc đổi thứ tự sẽ tự động dùng chế độ tối ưu công đoạn.</strong><span>新增、刪除、改名或調整順序時，系統會自動改用工序優化。</span></span></div>
          </section>
          <section class="process-edit-operations ui-data-section">
            <div class="ui-section-header process-edit-section-header">
              <i class="ti ti-list-numbers"></i><span class="ui-dual-copy"><strong>Công đoạn chính thức</strong><span>目前正式工序</span></span>
              <span class="process-edit-header-actions">
              <button type="button" class="ui-button" id="process-edit-add-button"><i class="ti ti-plus"></i><span class="ui-dual-copy"><strong>Thêm công đoạn</strong><span>新增工序</span></span></button>
              <button type="button" class="ui-button" id="process-edit-reset-button"><i class="ti ti-restore"></i><span class="ui-dual-copy"><strong>Khôi phục chưa lưu</strong><span>還原未儲存修改</span></span></button>
              <button type="button" class="ui-button is-primary" id="process-edit-save-button"><i class="ti ti-device-floppy"></i><span class="ui-dual-copy"><strong>Xác nhận sửa chính thức</strong><span>確認正式修改</span></span></button>
              </span>
            </div>
            <div class="ui-table-frame"><div class="ui-table-scroll" data-ui-floating-scroll="only">
              <table class="ui-table process-edit-table" id="process-edit-table" data-ui-table-layout="custom" data-ui-table-sticky="none" data-ui-table-controls="auto">
                <thead><tr>
                  <th class="ui-table-center-cell" data-ui-table-column="order"><span class="ui-dual-copy"><strong>Thứ tự</strong><span>順序</span></span></th>
                  <th data-ui-table-column="category"><span class="ui-dual-copy"><strong>Phân loại</strong><span>加工分類</span></span></th>
                  <th data-ui-table-column="vi"><span class="ui-dual-copy"><strong>Tên công đoạn Việt</strong><span>工序越文</span></span></th>
                  <th class="is-column-hidden" data-ui-table-column="zh" data-ui-table-default-visible="false"><span class="ui-dual-copy"><strong>Tên công đoạn Trung</strong><span>工序中文</span></span></th>
                  <th class="ui-table-number-cell" data-ui-table-column="development"><span class="ui-dual-copy"><strong>Giây gốc</strong><span>開發原始秒數</span></span></th>
                  <th class="ui-table-number-cell" data-ui-table-column="official"><span class="ui-dual-copy"><strong>Giây chính thức</strong><span>目前正式秒數</span></span></th>
                  <th class="ui-table-number-cell" data-ui-table-column="capacity"><span class="ui-dual-copy"><strong>SL/giờ</strong><span>每小時產能</span></span></th>
                  <th class="ui-table-center-cell" data-ui-table-column="action"><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th>
                </tr></thead>
                <tbody id="process-edit-table-body"></tbody>
              </table>
            </div></div>
          </section>
        </div>
      </div>`;
  }

  function clientName(product){ return String(product?.client||'').trim(); }

  function clientList(){
    return [...new Set((window.D||[]).map(clientName).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'vi',{numeric:true,sensitivity:'base'}));
  }

  function fillClientOptions(){
    const select=document.getElementById('process-edit-client-select');
    if(!select) return;
    const all=document.createElement('option');
    all.value='';
    all.textContent=textApi().visibleText({vi:'Tất cả khách hàng',zh:'全部客人'});
    select.replaceChildren(all,...clientList().map(client=>{
      const option=document.createElement('option');
      option.value=client;
      option.textContent=client;
      return option;
    }));
    if(clientList().includes(state.selectedClient)) select.value=state.selectedClient;
    else{ state.selectedClient=''; select.value=''; }
  }

  function fillProductOptions(){
    const datalist=document.getElementById('process-edit-product-options');
    if(!datalist) return;
    const products=(window.D||[]).filter(item=>!state.selectedClient||clientName(item)===state.selectedClient);
    datalist.replaceChildren(...products.slice().sort((a,b)=>String(a.code).localeCompare(String(b.code))).map(item=>{
      const option=document.createElement('option');
      option.value=String(item.code||'');
      option.label=[item.vi,item.zh,item.sz,clientName(item)].filter(Boolean).join(' · ');
      return option;
    }));
  }

  function fillOperationOptions(product){
    const numberInput=document.getElementById('process-edit-operation-number');
    const nameInput=document.getElementById('process-edit-operation-name');
    const numberList=document.getElementById('process-edit-operation-number-options');
    const nameList=document.getElementById('process-edit-operation-name-options');
    const operations=Array.isArray(product?.ops)?product.ops:[];
    [numberInput,nameInput].forEach(input=>{ if(input){ input.disabled=!product;input.value=''; } });
    if(numberList) numberList.replaceChildren(...operations.map(operation=>{
      const option=document.createElement('option');option.value=String(operation.no||'');option.label=String(operation.vi||'');return option;
    }));
    if(nameList) nameList.replaceChildren(...operations.map(operation=>{
      const option=document.createElement('option');option.value=String(operation.vi||'');option.label=String(operation.no||'');return option;
    }));
  }

  function focusOperation(value,field){
    const query=String(value||'').trim().toLocaleLowerCase();
    if(!query) return;
    const index=state.draft.findIndex(operation=>field==='no'
      ? String(operation.no)===query
      : String(operation.vi||'').trim().toLocaleLowerCase().includes(query));
    if(index<0){ setStatus({vi:'Không tìm thấy công đoạn phù hợp.',zh:'找不到符合的工序。'},'warning'); return; }
    const row=document.querySelector(`#process-edit-table-body [data-process-index="${index}"]`);
    if(!row) return;
    clearStatus();
    row.classList.remove('is-located');
    requestAnimationFrame(()=>{
      row.classList.add('is-located');
      row.scrollIntoView({behavior:'smooth',block:'center'});
      window.setTimeout(()=>row.classList.remove('is-located'),1800);
    });
  }

  function developmentSeconds(product,operationNo){
    const source=Array.isArray(product?.developmentOps)&&product.developmentOps.length?product.developmentOps:product?.ops||[];
    return source.find(item=>String(item.no)===String(operationNo))?.sec??'—';
  }

  function hourlyCapacity(seconds){
    const value=Number(seconds);
    return value>0?Math.round((Number(window.S?.ws)||3000)/value):0;
  }

  function renderSummary(product){
    const host=document.getElementById('process-edit-current-summary');
    if(!host) return;
    host.innerHTML=`
      <div><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><b>${safe(clientName(product)||'—')}</b></div>
      <div><span class="ui-dual-copy"><strong>Mã hàng hiện tại</strong><span>目前款號</span></span><b>${safe(product.code)}</b></div>
      <div><span class="ui-dual-copy"><strong>Tên sản phẩm</strong><span>品名</span></span><b>${safe(product.vi||product.zh||'—')}</b><span>${safe(product.zh||'')}</span></div>
      <div><span class="ui-dual-copy"><strong>Kích thước</strong><span>尺寸</span></span><b>${safe(product.sz||'—')}</b></div>
      <div><span class="ui-dual-copy"><strong>Lần sửa chính thức</strong><span>正式修訂次數</span></span><b>${Number(product.standardRevision)||0}</b></div>`;
  }

  function renderToolbarGroup(product){
    const host=document.getElementById('process-edit-toolbar-group');
    if(!host) return;
    const group=product?store().groupForProduct(product.code):null;
    const value=group
      ? safe(group.name||group.groupId)
      : product
        ? '<span class="ui-bilingual"><span class="ui-text-vi">Chưa có nhóm</span><span class="ui-text-zh">未有群組</span></span>'
        : '—';
    host.classList.toggle('is-empty',!group);
    host.innerHTML=`<i class="ti ti-box-multiple" aria-hidden="true"></i><div><span class="ui-dual-copy"><strong>Nhóm cùng sản phẩm</strong><span>同產品群組</span></span><b class="process-edit-toolbar-group-value">${value}</b></div>`;
  }

  function renderGroup(product){
    const host=document.getElementById('process-edit-group-area');
    if(!host) return;
    state.groupSelector=null;
    const group=store().groupForProduct(product.code);
    renderToolbarGroup(product);
    if(group){
      const members=(group.memberCodes||[]).map(productByCode).filter(Boolean);
      state.selectedTargets.add(product.code);
      host.innerHTML=`<div class="process-edit-group-heading"><span class="ui-dual-copy"><strong>Phạm vi áp dụng</strong><span>修改套用範圍</span></span><b>${safe(group.name||group.groupId)}</b><span class="ui-dual-copy"><strong>${members.length} mã</strong><span>${members.length} 款</span></span></div>
        <div class="process-edit-scope-options">
          <label class="process-edit-scope-option${state.applyMode==='current'?' is-selected':''}"><input type="radio" name="process-edit-apply-mode" value="current" data-process-apply-mode ${state.applyMode==='current'?'checked':''}><span class="ui-dual-copy"><strong>Chỉ sửa mã hiện tại</strong><span>只修改目前款號</span></span><small>${safe(product.code)}</small></label>
          <label class="process-edit-scope-option${state.applyMode==='group'?' is-selected':''}"><input type="radio" name="process-edit-apply-mode" value="group" data-process-apply-mode ${state.applyMode==='group'?'checked':''}><span class="ui-dual-copy"><strong>Áp dụng thêm cho mã trong nhóm</strong><span>同步套用群組款號</span></span><small class="ui-bilingual"><span class="ui-text-vi">Chọn riêng mã cần áp dụng</span><span class="ui-text-zh">再勾選需要套用的款號</span></small></label>
        </div>
        <div class="process-edit-group-targets" ${state.applyMode==='group'?'':'hidden'}>
        <div class="process-edit-group-note ui-bilingual"><span class="ui-text-vi">Mã hiện tại luôn được áp dụng. Chỉ đánh dấu thêm những mã thật sự cần dùng cùng tiêu chuẩn lần này.</span><span class="ui-text-zh">目前款號一定會修改；只需另外勾選本次確定要共用標準的款號。</span></div>
        <div data-process-group-selector></div>
        </div>`;
      if(state.applyMode==='group'){
        state.groupSelector=groupUI().createMemberSelector({
          products:members,currentCode:product.code,activeSize:product.sz,
          selectedCodes:[...state.selectedTargets],requiredCodes:[product.code],selectable:canEdit(),
          onChange:controller=>{ state.selectedTargets=new Set(controller.selectedCodes()); }
        });
        host.querySelector('[data-process-group-selector]').appendChild(state.groupSelector.element);
      }
      return;
    }
    state.applyMode='current';
    state.selectedTargets=new Set([product.code]);
    host.replaceChildren();
  }

  function renderOperations(product){
    const body=document.getElementById('process-edit-table-body');
    if(!body) return;
    body.innerHTML=state.draft.map((operation,index)=>`<tr data-process-index="${index}">
      <td class="ui-table-center-cell" data-ui-table-column="order"><button type="button" class="process-edit-drag-handle" draggable="${canEdit()?'true':'false'}" aria-label="Kéo để đổi thứ tự / 拖曳調整順序" ${canEdit()?'':'disabled'}><i class="ti ti-grip-vertical"></i><b>${index+1}</b></button></td>
      <td data-ui-table-column="category"><select data-process-field="category" ${canEdit()?'':'disabled'}><option value="BL" ${operation.category==='BL'?'selected':''}>BL</option><option value="SX" ${operation.category==='SX'?'selected':''}>SX</option><option value="QC" ${operation.category==='QC'?'selected':''}>QC</option><option value="DG" ${operation.category==='DG'?'selected':''}>DG</option></select></td>
      <td data-ui-table-column="vi"><input type="text" maxlength="200" data-process-field="vi" value="${safe(operation.vi)}" ${canEdit()?'':'disabled'}></td>
      <td class="is-column-hidden" data-ui-table-column="zh"><input type="text" maxlength="200" data-process-field="zh" value="${safe(operation.zh)}" ${canEdit()?'':'disabled'}></td>
      <td class="ui-table-number-cell" data-ui-table-column="development">${safe(developmentSeconds(product,operation.no))}</td>
      <td class="ui-table-number-cell" data-ui-table-column="official"><input type="number" min="1" max="86400" step="1" inputmode="numeric" data-process-field="sec" value="${safe(Math.round(Number(operation.sec)||0))}" ${canEdit()?'':'disabled'}></td>
      <td class="ui-table-number-cell" data-ui-table-column="capacity"><b>${hourlyCapacity(operation.sec)}</b></td>
      <td class="ui-table-center-cell" data-ui-table-column="action"><div class="process-edit-row-actions">
        <button type="button" data-process-action="delete" aria-label="Xóa / 刪除" class="is-danger" ${canEdit()?'':'disabled'}><i class="ti ti-trash"></i></button>
      </div></td>
    </tr>`).join('');
    window.PCMSUITableControls?.refreshPage?.();
  }

  function markDirty(){ state.dirty=true; }

  function resetDraft(){
    const product=productByCode(state.currentCode);
    state.draft=normalizedOperations(product?.ops||[]);
    state.dirty=false;
    state.editMode=store().EDIT_MODES.STANDARD_CORRECTION;
    if(product) renderOperations(product);
    syncModificationMode(false);
  }

  async function selectProduct(code,options={}){
    const product=productByCode(code);
    if(!product){
      setStatus({vi:'Không tìm thấy mã hàng.',zh:'找不到款號。'},'warning');
      return false;
    }
    if(state.selectedClient&&clientName(product)!==state.selectedClient){
      if(options.force===true){
        state.selectedClient=clientName(product);
        fillClientOptions();
        fillProductOptions();
      }else{
        setStatus({vi:'Mã hàng không thuộc khách hàng đã chọn.',zh:'此款號不屬於所選客人。'},'warning');
        return false;
      }
    }
    if(state.dirty&&options.force!==true){
      const discard=await ui().confirmDialog({
        title:{vi:'Bỏ thay đổi chưa lưu?',zh:'放棄未儲存修改？'},
        message:{vi:'Chuyển mã hàng sẽ bỏ nội dung chưa lưu.',zh:'切換款號會放棄尚未儲存的內容。'},
        confirmText:{vi:'Bỏ và chuyển',zh:'放棄並切換'},cancelText:{vi:'Tiếp tục sửa',zh:'繼續修改'}
      });
      if(!discard) return false;
    }
    state.currentCode=product.code;
    state.applyMode='current';
    state.editMode=store().EDIT_MODES.STANDARD_CORRECTION;
    state.selectedTargets=new Set([product.code]);
    state.draft=normalizedOperations(product.ops||[]);
    state.dirty=false;
    const input=document.getElementById('process-edit-product-input');
    if(input) input.value=product.code;
    document.getElementById('process-edit-empty').hidden=true;
    document.getElementById('process-edit-workspace').hidden=false;
    clearStatus();
    renderSummary(product);
    renderGroup(product);
    renderOperations(product);
    syncModificationMode(false);
    return true;
  }

  function changeRow(index,action){
    if(action!=='delete') return;
    if(state.draft.length<=1){ setStatus({vi:'Phải giữ lại ít nhất 1 công đoạn.',zh:'至少必須保留1道工序。'},'warning'); return; }
    state.draft.splice(index,1);
    state.draft.forEach((item,rowIndex)=>{ item.no=String(rowIndex+1); });
    markDirty();
    renderOperations(productByCode(state.currentCode));
    syncModificationMode(true);
  }

  function moveRow(fromIndex,toIndex){
    if(!canEdit()||fromIndex===toIndex||fromIndex<0||toIndex<0||fromIndex>=state.draft.length||toIndex>=state.draft.length) return;
    const [operation]=state.draft.splice(fromIndex,1);
    state.draft.splice(toIndex,0,operation);
    state.draft.forEach((item,index)=>{ item.no=String(index+1); });
    markDirty();
    renderOperations(productByCode(state.currentCode));
    syncModificationMode(true);
  }

  async function addOperation(){
    const next=state.draft.length+1;
    if(next>99){ setStatus({vi:'Tối đa 99 công đoạn.',zh:'最多99道工序。'},'warning'); return; }
    const value=await ui().promptDialog({
      title:{vi:'Chèn công đoạn mới',zh:'插入新工序'},
      label:{vi:`Vị trí chèn (1–${next})`,zh:`插入順序（1～${next}）`},
      type:'number',value:String(next),
      validate:(input,control)=>{
        const position=Number(input);
        const valid=Number.isInteger(position)&&position>=1&&position<=next;
        control.min='1';control.max=String(next);control.step='1';
        control.setCustomValidity(valid?'':'Vị trí phải là số nguyên trong phạm vi. / 順序必須是範圍內的整數。');
        if(!valid) control.reportValidity();
        return valid;
      }
    });
    if(value===null) return;
    const position=Number(value);
    state.draft.splice(position-1,0,{no:String(position),category:'SX',vi:'',zh:'',sec:1});
    state.draft.forEach((item,index)=>{ item.no=String(index+1); });
    markDirty();
    renderOperations(productByCode(state.currentCode));
    syncModificationMode(true);
    requestAnimationFrame(()=>document.querySelector(`#process-edit-table-body [data-process-index="${position-1}"] [data-process-field="vi"]`)?.focus());
  }

  function normalizedOperations(value){
    return (Array.isArray(value)?value:[]).map(window.PCMSProductModel.normalizeOperation)
      .map(item=>({...item,sec:Math.round(Number(item.sec)||0)}));
  }

  function operationsEqual(left,right){
    const before=normalizedOperations(left);
    const after=normalizedOperations(right);
    return before.length===after.length&&before.every((item,index)=>{
      const next=after[index];
      return next&&item.no===next.no&&item.category===next.category&&item.vi===next.vi&&item.zh===next.zh&&item.sec===next.sec;
    });
  }

  function operationChangeLines(beforeValue,afterValue){
    const before=normalizedOperations(beforeValue);
    const after=normalizedOperations(afterValue);
    const lines=[];
    if(after.length>before.length) lines.push(`+ ${after.length-before.length} công đoạn / 新增 ${after.length-before.length} 道工序`);
    if(before.length>after.length) lines.push(`− ${before.length-after.length} công đoạn / 刪除 ${before.length-after.length} 道工序`);
    const beforeOrder=before.map(item=>`${item.category}|${item.vi}|${item.zh}|${item.sec}`);
    const afterOrder=after.map(item=>`${item.category}|${item.vi}|${item.zh}|${item.sec}`);
    if(beforeOrder.length===afterOrder.length
      &&beforeOrder.slice().sort().join('\n')===afterOrder.slice().sort().join('\n')
      &&beforeOrder.join('\n')!==afterOrder.join('\n')) lines.push('Đã đổi thứ tự / 已調整順序');
    const fieldNames={category:'Phân loại / 分類',vi:'Tên Việt / 越文名稱',zh:'Tên Trung / 中文名稱',sec:'Giây / 秒數'};
    for(let index=0;index<Math.min(before.length,after.length);index++){
      ['category','vi','zh','sec'].forEach(field=>{
        if(before[index][field]!==after[index][field]) lines.push(`#${index+1} ${fieldNames[field]}: ${before[index][field]||'—'} → ${after[index][field]||'—'}`);
      });
    }
    return lines;
  }

  function sameOperationStructure(beforeValue,afterValue){
    const before=normalizedOperations(beforeValue);
    const after=normalizedOperations(afterValue);
    return before.length===after.length&&before.every((item,index)=>{
      const next=after[index];
      return next&&item.no===next.no&&item.category===next.category&&item.vi===next.vi&&item.zh===next.zh;
    });
  }

  function syncModificationMode(structuralChangeOverride){
    const product=productByCode(state.currentCode);
    const structuralChange=typeof structuralChangeOverride==='boolean'
      ? structuralChangeOverride
      : Boolean(product&&!sameOperationStructure(product.ops||[],state.draft));
    if(structuralChange) state.editMode=store().EDIT_MODES.PROCESS_OPTIMIZATION;
    const panel=document.getElementById('process-edit-mode-panel');
    const correction=panel?.querySelector('input[value="standardCorrection"]');
    const optimization=panel?.querySelector('input[value="processOptimization"]');
    const note=document.getElementById('process-edit-mode-structural-note');
    if(correction){
      correction.disabled=structuralChange||!canEdit();
      correction.closest('.process-edit-mode-option')?.classList.toggle('is-disabled',correction.disabled);
      correction.checked=state.editMode===store().EDIT_MODES.STANDARD_CORRECTION;
    }
    if(optimization){
      optimization.disabled=!canEdit();
      optimization.checked=state.editMode===store().EDIT_MODES.PROCESS_OPTIMIZATION;
    }
    if(note) note.hidden=!structuralChange;
  }

  function officialChangeSummary(targetCodes,operations,impact,mode){
    const body=document.createElement('div');
    body.className='process-edit-change-summary';
    const correction=mode===store().EDIT_MODES.STANDARD_CORRECTION;
    const orderLabels=impact.orders.map(item=>item.orderId||item.id);
    const productSections=targetCodes.map(code=>{
      const lines=operationChangeLines(productByCode(code)?.ops,operations);
      return `<section><b>${safe(code)}</b><ul>${lines.map(line=>`<li>${safe(line)}</li>`).join('')}</ul></section>`;
    }).join('');
    body.innerHTML=`<div class="ui-notice is-warning"><i class="ti ti-alert-triangle"></i><span class="ui-dual-copy"><strong>Kiểm tra nội dung thay đổi trước khi lưu.</strong><span>儲存前請確認實際修改內容。</span></span></div>
      <div class="process-edit-change-products">${productSections}</div>
      <dl><div><dt><span class="ui-dual-copy"><strong>Chế độ</strong><span>修改模式</span></span></dt><dd><span class="ui-dual-copy"><strong>${correction?'Sửa lỗi tiêu chuẩn':'Tối ưu công đoạn'}</strong><span>${correction?'標準錯誤訂正':'工序優化'}</span></span></dd></div><div><dt><span class="ui-dual-copy"><strong>Mã hàng bị ảnh hưởng</strong><span>受影響款號</span></span></dt><dd>${safe(targetCodes.join('、'))}</dd></div><div><dt><span class="ui-dual-copy"><strong>Đơn đang sản xuất</strong><span>生產中訂單</span></span></dt><dd>${safe(orderLabels.join('、')||'0')}</dd></div><div><dt><span class="ui-dual-copy"><strong>Bản ghi sản xuất cần sửa</strong><span>需訂正產能紀錄</span></span></dt><dd>${correction?(Number(impact.entryCount)||0):0}</dd></div><div><dt><span class="ui-dual-copy"><strong>Dữ liệu lịch sử</strong><span>歷史資料</span></span></dt><dd><span class="ui-dual-copy"><strong>${correction?'Lưu giây bảng mã hàng trước khi sửa':'Giữ nguyên ảnh chụp cũ'}</strong><span>${correction?'保留修改前的款號表秒數並另存訂正結果':'舊快照完全不變'}</span></span></dd></div></dl>`;
    return body;
  }

  function updateModificationProgress(controller,progress){
    const total=Math.max(1,Number(progress?.total)||1);
    const completed=Math.max(0,Number(progress?.completed)||0);
    const entries=progress?.phase==='entries';
    controller?.update({
      value:completed/total*100,
      text:entries
        ?{vi:`Đang sửa bản ghi sản xuất ${completed}/${total}...`,zh:`正在訂正產能紀錄 ${completed}/${total}…`}
        :{vi:`Đang đồng bộ đơn hàng ${completed}/${total}...`,zh:`正在同步訂單 ${completed}/${total}…`},
      detail:progress?.current?{vi:`Đơn hiện tại: ${progress.current}`,zh:`目前訂單：${progress.current}`}:{vi:'Vui lòng không đóng trang trong lúc xử lý.',zh:'處理期間請勿關閉頁面。'}
    });
  }

  async function saveOfficial(){
    if(!canEdit()){ setStatus({vi:'Bạn không có quyền nhạy cảm để sửa tiêu chuẩn chính thức.',zh:'你沒有修改正式工序標準的敏感權限。'},'warning');return; }
    const selectedCodes=[...state.selectedTargets];
    let operations;
    try{ operations=store().validateOperations(state.draft); }
    catch(error){ setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger'); return; }
    const targetCodes=selectedCodes.filter(code=>!operationsEqual(productByCode(code)?.ops,operations));
    if(!targetCodes.length){
      setStatus({vi:'Không có thay đổi; hệ thống không lưu phiên bản và không đồng bộ đơn hàng.',zh:'內容完全相同，未建立版本、未寫入資料，也未同步訂單。'},'info');
      return;
    }
    const structuralChange=targetCodes.some(code=>!sameOperationStructure(productByCode(code)?.ops,operations));
    syncModificationMode(structuralChange);
    const mode=store().normalizeMode(state.editMode);
    let impact;
    try{
      const operationsByCode=Object.fromEntries(targetCodes.map(code=>[code,operations]));
      setStatus({vi:'Đang kiểm tra đơn hàng và dữ liệu bị ảnh hưởng...',zh:'正在檢查受影響訂單與資料…'},'info');
      impact=await store().analyzeImpact({targetCodes,operationsByCode,mode});
    }catch(error){ setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger'); return; }
    const confirmed=await ui().confirmDialog({
      title:{vi:'Xác nhận sửa tiêu chuẩn chính thức',zh:'確認修改正式標準'},
      body:officialChangeSummary(targetCodes,operations,impact,mode),size:'large',
      confirmText:{vi:'Xác nhận sửa',zh:'確認修改'},cancelText:{vi:'Hủy',zh:'取消'},kind:'warning'
    });
    if(!confirmed) return;
    const progress=ui().progressDialog({
      title:{vi:'Tiến độ sửa công đoạn',zh:'工序修改進度'},value:0,
      text:{vi:'Đang lưu tiêu chuẩn mã hàng...',zh:'正在儲存款號標準…'},
      detail:{vi:`Ảnh hưởng ${impact.orderCount} đơn và ${impact.entryCount} bản ghi.`,zh:`影響 ${impact.orderCount} 張訂單與 ${impact.entryCount} 筆產能紀錄。`}
    });
    try{
      setStatus({vi:'Đang lưu phiên bản và công đoạn...',zh:'正在儲存版本與工序修改…'},'info');
      const result=await store().saveOfficialProcesses({
        targetCodes,operations,mode,
        orders:impact.orders,entryCount:impact.entryCount,
        onProgress:item=>updateModificationProgress(progress,item)
      });
      state.dirty=false;
      await selectProduct(state.currentCode,{force:true});
      if(result.sync?.status==='partial'){
        progress.fail({vi:'Một số đơn đồng bộ thất bại; công việc đã được giữ để thử lại.',zh:'部分訂單同步失敗；工作已保留，可稍後重試。'},
          {vi:`Mã công việc: ${result.jobId}`,zh:`工作編號：${result.jobId}`});
        setStatus({vi:`Tiêu chuẩn đã lưu nhưng còn ${result.sync.failures.length} đơn chưa đồng bộ. Mã công việc: ${result.jobId}.`,zh:`標準已儲存，但仍有 ${result.sync.failures.length} 張訂單未同步。工作編號：${result.jobId}。`},'warning');
      }else{
        progress.complete({vi:'Đã hoàn tất toàn bộ thay đổi.',zh:'全部修改已完成。'});
        setStatus(result.logSaved
        ? {vi:`Đã lưu tiêu chuẩn và đồng bộ ${impact.orderCount} đơn đang sản xuất.`,zh:`正式標準已儲存，並同步 ${impact.orderCount} 張生產中訂單。`}
        : {vi:'Đã lưu tiêu chuẩn, nhưng lịch sử thao tác không lưu được.',zh:'正式標準已儲存，但操作紀錄保存失敗。'},result.logSaved?'success':'warning');
      }
      window.setTimeout(()=>progress.close(),1000);
    }catch(error){
      progress.fail({vi:'Không thể hoàn tất thay đổi; trạng thái công việc đã được giữ lại.',zh:'無法完成修改；工作狀態已保留。'},
        {vi:`Mã công việc: ${error.processEditJobId||'—'}`,zh:`工作編號：${error.processEditJobId||'—'}`});
      window.setTimeout(()=>progress.close(),1300);
      setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger');
    }
  }

  function versionActionLabel(action){
    const labels={baseline:['Khởi tạo','初始基準'],import:['Nhập mã mới','匯入新款號'],processEdit:['Sửa công đoạn','工序修改'],delete:['Xóa mã hàng','刪除款號']};
    return labels[action]||[action||'—',action||'—'];
  }

  async function exportVersion(version){
    try{
      const saveHandle=await window.PCMSFileIO.chooseSaveHandle({
        suggestedName:`款號表_${String(version.productVersion||version.versionId).replace(/[^\w.-]+/g,'_')}.xlsx`,
        types:[window.PCMSFileIO.spreadsheetFileType],
        onUnsupported:()=>ui().alertDialog({message:{vi:'Trình duyệt không hỗ trợ chọn vị trí lưu; đã dừng xuất.',zh:'瀏覽器不支援選擇儲存位置，已停止匯出。'},kind:'warning'})
      });
      if(!saveHandle) return;
      setStatus({vi:'Đang đọc phiên bản mã hàng...',zh:'正在讀取款號歷史版本…'},'info');
      await window.PCMSFeatures.ensureSpreadsheetTool();
      const snapshot=await store().loadVersionSnapshot(version.versionId||version.id);
      const rows=[['款號','客人','中文名稱','越文名稱','尺寸','工序號','加工','工序中文','工序越文','秒數']];
      snapshot.items.forEach(item=>(item.ops||[]).forEach(operation=>rows.push([
        item.code,item.client,item.zh,item.vi,item.sz,String(operation.no),operation.category,operation.zh,operation.vi,Number(operation.sec)
      ])));
      const worksheet=window.XLSX.utils.aoa_to_sheet(rows);
      worksheet['!cols']=[{wch:16},{wch:14},{wch:22},{wch:22},{wch:10},{wch:9},{wch:10},{wch:24},{wch:24},{wch:10}];
      worksheet['!autofilter']={ref:'A1:J1'};
      const info=window.XLSX.utils.aoa_to_sheet([
        ['版本識別碼',snapshot.version.versionId],['資料版本',snapshot.version.productVersion],['建立時間',new Date(snapshot.version.createdAt).toLocaleString('zh-TW')]
      ]);
      const workbook=window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook,worksheet,'款號表');
      window.XLSX.utils.book_append_sheet(workbook,info,'版本資訊');
      await window.PCMSFileIO.writeWorkbookToHandle(saveHandle,workbook,window.XLSX);
      await window.saveOperationLogToFB?.({permissionKey:'productionProcessEdit',feature:'productionProcessEdit',action:'productVersionExport',status:'success',itemCount:snapshot.items.length,detailCount:snapshot.version.opCount||0,note:snapshot.version.versionId});
      setStatus({vi:'Đã xuất phiên bản mã hàng.',zh:'款號歷史版本已匯出。'},'success');
    }catch(error){ setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger'); }
  }

  async function openVersionHistory(){
    try{
      const versions=await store().loadVersions(100);
      const body=document.createElement('div');
      body.className='process-edit-version-list';
      if(!versions.length) body.appendChild(textApi().create({vi:'Chưa có phiên bản.',zh:'尚無版本歷史。'}));
      versions.forEach(version=>{
        const row=document.createElement('div');
        row.className='process-edit-version-row';
        const action=versionActionLabel(version.action);
        const copy=document.createElement('div');
        copy.append(
          textApi().create({vi:action[0],zh:action[1]},{tagName:'b'}),
          Object.assign(document.createElement('span'),{textContent:new Date(Number(version.createdAt)||0).toLocaleString('zh-TW')}),
          Object.assign(document.createElement('small'),{textContent:textApi().visibleText({vi:`${version.productCount||0} mã · ${version.opCount||0} công đoạn`,zh:`${version.productCount||0} 款 · ${version.opCount||0} 工序`})})
        );
        const button=ui().createButton({text:{vi:'Xuất Excel',zh:'匯出 Excel'},icon:'ti-download'});
        button.addEventListener('click',()=>exportVersion(version));
        row.append(copy,button);
        body.appendChild(row);
      });
      ui().openDialog({title:{vi:'Lịch sử phiên bản mã hàng',zh:'款號版本歷史'},body,size:'large',actions:[{text:{vi:'Đóng',zh:'關閉'}}]});
    }catch(error){ setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger'); }
  }

  async function openGroupsPage(){
    if(state.dirty){
      const confirmed=await ui().confirmDialog({
        title:{vi:'Rời nội dung chưa lưu?',zh:'離開未儲存內容？'},
        message:{vi:'Mở trang nhóm sẽ rời nội dung công đoạn chưa lưu. Khi quay lại, hệ thống sẽ tải lại tiêu chuẩn chính thức hiện tại.',zh:'前往群組分頁會離開未儲存的工序內容；返回時會重新載入目前正式標準。'},
        confirmText:{vi:'Mở trang nhóm',zh:'前往群組分頁'},cancelText:{vi:'Tiếp tục sửa',zh:'繼續修改'}
      });
      if(!confirmed) return;
    }
    window.PCMSPendingProductGroupContext={code:state.currentCode};
    await window.sp?.('product-groups');
  }

  function handleLanguageChange(){
    fillClientOptions();
    fillProductOptions();
  }

  async function promptPendingModification(){
    if(state.pendingChecked) return;
    state.pendingChecked=true;
    let pending=[];
    try{ pending=await store().loadPendingModificationJobs(10); }
    catch(error){ console.error('Không thể đọc công việc sửa công đoạn đang chờ / 無法讀取待處理工序修改工作',error);return; }
    const job=pending.find(item=>item.phase!=='product');
    if(!job) return;
    const confirmed=await ui().confirmDialog({
      title:{vi:'Có công việc sửa chưa hoàn tất',zh:'有尚未完成的工序修改工作'},
      message:{
        vi:`Công việc ${job.jobId} đang ở bước ${job.phase}. Bạn có muốn tiếp tục ngay không?`,
        zh:`工作 ${job.jobId} 目前停在「${job.phase}」階段，是否現在繼續？`
      },
      confirmText:{vi:'Tiếp tục công việc',zh:'繼續工作'},cancelText:{vi:'Để sau',zh:'稍後處理'}
    });
    if(!confirmed) return;
    const progress=ui().progressDialog({
      title:{vi:'Tiếp tục sửa công đoạn',zh:'繼續工序修改'},value:0,
      text:{vi:'Đang khôi phục trạng thái công việc...',zh:'正在恢復工作狀態…'}
    });
    try{
      const result=await store().resumeModificationJob(job.jobId,{onProgress:item=>updateModificationProgress(progress,item)});
      if(result.status==='ready'){
        progress.complete({vi:'Công việc đã hoàn tất.',zh:'工作已完成。'});
        setStatus({vi:'Đã tiếp tục và hoàn tất công việc sửa trước đó.',zh:'先前的修改工作已繼續並完成。'},'success');
      }else{
        progress.fail({vi:'Vẫn còn đơn hàng đồng bộ thất bại.',zh:'仍有訂單同步失敗。'},
          {vi:`Mã công việc: ${job.jobId}`,zh:`工作編號：${job.jobId}`});
        setStatus({vi:`Công việc ${job.jobId} vẫn chưa hoàn tất.`,zh:`工作 ${job.jobId} 仍未完成。`},'warning');
      }
    }catch(error){
      progress.fail({vi:'Không thể tiếp tục công việc.',zh:'無法繼續工作。'},
        {vi:`Mã công việc: ${job.jobId}`,zh:`工作編號：${job.jobId}`});
      setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger');
    }finally{ window.setTimeout(()=>progress.close(),1200); }
  }

  function bindEvents(){
    document.getElementById('process-edit-load-button')?.addEventListener('click',()=>selectProduct(document.getElementById('process-edit-product-input')?.value));
    document.getElementById('process-edit-product-input')?.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); selectProduct(event.currentTarget.value); } });
    document.getElementById('process-edit-client-select')?.addEventListener('change',event=>{
      state.selectedClient=String(event.currentTarget.value||'');
      const input=document.getElementById('process-edit-product-input');
      const inputProduct=productByCode(input?.value);
      if(input&&inputProduct&&state.selectedClient&&clientName(inputProduct)!==state.selectedClient) input.value='';
      fillProductOptions();
    });
    document.getElementById('process-edit-history-button')?.addEventListener('click',openVersionHistory);
    document.getElementById('process-edit-add-button')?.addEventListener('click',addOperation);
    document.getElementById('process-edit-reset-button')?.addEventListener('click',resetDraft);
    document.getElementById('process-edit-save-button')?.addEventListener('click',saveOfficial);
    document.getElementById('process-edit-table-body')?.addEventListener('input',event=>{
      const field=event.target?.dataset?.processField;
      const row=event.target?.closest?.('[data-process-index]');
      if(!field||!row) return;
      const index=Number(row.dataset.processIndex);
      if(field==='sec'){
        const value=Number(event.target.value);
        if(Number.isFinite(value)&&event.target.value!==''){
          const rounded=Math.max(1,Math.min(86400,Math.round(value)));
          event.target.value=String(rounded);
          state.draft[index][field]=rounded;
        }else state.draft[index][field]=value;
      }else state.draft[index][field]=event.target.value;
      markDirty();
      if(field==='sec') row.querySelector('[data-ui-table-column="capacity"] b').textContent=String(hourlyCapacity(event.target.value));
      syncModificationMode();
    });
    document.getElementById('process-edit-table-body')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-process-action]');
      if(!button) return;
      const index=Number(button.closest('[data-process-index]').dataset.processIndex);
      changeRow(index,button.dataset.processAction);
    });
    document.getElementById('process-edit-table-body')?.addEventListener('dragstart',event=>{
      const handle=event.target.closest('.process-edit-drag-handle');
      if(!handle||!canEdit()){ event.preventDefault();return; }
      state.dragIndex=Number(handle.closest('[data-process-index]').dataset.processIndex);
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain',String(state.dragIndex));
      handle.closest('tr').classList.add('is-dragging');
    });
    document.getElementById('process-edit-table-body')?.addEventListener('dragover',event=>{
      const row=event.target.closest('[data-process-index]');
      if(!row||state.dragIndex<0) return;
      event.preventDefault();event.dataTransfer.dropEffect='move';
      document.querySelectorAll('#process-edit-table-body tr.is-drop-target').forEach(item=>item.classList.remove('is-drop-target'));
      row.classList.add('is-drop-target');
    });
    document.getElementById('process-edit-table-body')?.addEventListener('drop',event=>{
      const row=event.target.closest('[data-process-index]');
      if(!row) return;
      event.preventDefault();
      const from=state.dragIndex;
      const to=Number(row.dataset.processIndex);
      state.dragIndex=-1;
      moveRow(from,to);
    });
    document.getElementById('process-edit-table-body')?.addEventListener('dragend',()=>{
      state.dragIndex=-1;
      document.querySelectorAll('#process-edit-table-body tr.is-dragging,#process-edit-table-body tr.is-drop-target').forEach(item=>item.classList.remove('is-dragging','is-drop-target'));
    });
    document.getElementById('process-edit-group-area')?.addEventListener('change',event=>{
      const mode=event.target?.dataset?.processApplyMode;
      if(mode!==undefined){
        state.applyMode=event.target.value==='group'?'group':'current';
        if(state.applyMode==='current') state.selectedTargets=new Set([state.currentCode]);
        else{
          const group=store().groupForProduct(state.currentCode);
          state.selectedTargets=new Set(group?.memberCodes||[state.currentCode]);
          state.selectedTargets.add(state.currentCode);
        }
        renderGroup(productByCode(state.currentCode));
        return;
      }
    });
    document.getElementById('process-edit-mode-panel')?.addEventListener('change',event=>{
      if(event.target?.name!=='official-process-edit-mode'||event.target.disabled) return;
      state.editMode=store().normalizeMode(event.target.value);
      syncModificationMode();
    });
    document.querySelector('.production-process-edit-page')?.addEventListener('click',event=>{ if(event.target.closest('#process-edit-open-groups')) openGroupsPage(); });
  }

  async function loadProductionProcessEditData(options={}){
    await window.ensureProductsLoaded(options);
    await store().loadGroups(options);
    await window.ensureOperationSettingsLoaded?.(options);
    return {products:window.D,groups:store().listGroups()};
  }

  async function productionProcessEditInit(){
    buildRoot();
    if(!state.initialized){ bindEvents(); state.initialized=true; }
    textApi().setLocalizedAttribute(document.getElementById('process-edit-product-input'),'placeholder',{vi:'Nhập mã hàng',zh:'輸入款號'});
    if(!state.languageBound){ document.addEventListener('pcms:languagechange',handleLanguageChange); state.languageBound=true; }
    fillClientOptions();
    fillProductOptions();
    const editingAllowed=canEdit();
    ['process-edit-add-button','process-edit-save-button','process-edit-reset-button'].forEach(id=>{ const button=document.getElementById(id);if(button) button.disabled=!editingAllowed; });
    const pending=window.PCMSPendingProcessEditContext;
    if(pending?.code){
      await selectProduct(pending.code,{force:true});
      const seconds=Number(pending.recommendedSeconds);
      const operation=state.draft.find(item=>String(item.no)===String(pending.processNo));
      if(operation&&seconds>0){ operation.sec=Math.round(seconds); markDirty(); renderOperations(productByCode(state.currentCode));syncModificationMode(); }
      window.PCMSPendingProcessEditContext=null;
    }else if(state.currentCode){
      await selectProduct(state.currentCode,{force:true});
    }
    if(!editingAllowed) setStatus({vi:'Trang đang ở chế độ chỉ xem; quyền nhạy cảm sửa tiêu chuẩn chưa được mở.',zh:'目前為唯讀模式；尚未開啟修改正式標準的敏感權限。'},'warning');
    else await promptPendingModification();
  }

  function productionProcessEditLeave(){
    clearStatus();
    if(state.languageBound){ document.removeEventListener('pcms:languagechange',handleLanguageChange); state.languageBound=false; }
  }

  window.loadProductionProcessEditData=loadProductionProcessEditData;
  window.productionProcessEditInit=productionProcessEditInit;
  window.productionProcessEditLeave=productionProcessEditLeave;
})();
