// process-seconds-quick-edit（工序秒數快速修改）：由生產登記與工序分析共用的正式秒數修改視窗。
(function(){
  'use strict';

  const normalize=value=>String(value??'').trim();
  const safe=value=>window.PCMSSafe.text(value);
  const ui=()=>window.PCMSUIComponents;
  const textApi=()=>window.PCMSUIText;
  const store=()=>window.PCMSProcessEditStore;
  const groupUI=()=>window.PCMSProcessGroupUI;
  const productByCode=code=>(window.D||[]).find(item=>normalize(item.code)===normalize(code))||null;
  const QUICK_EDIT_REASON='Điều chỉnh nhanh giây công đoạn / 快速調整工序秒數';

  function allowed(){
    return typeof window.canEditProcessSeconds==='function'&&window.canEditProcessSeconds();
  }

  function selectedSummary(products,processNo,currentSeconds,newSeconds,sizeLabel){
    const body=document.createElement('div');
    body.className='process-seconds-confirm-summary';
    body.innerHTML=`<div class="ui-notice is-warning"><i class="ti ti-alert-triangle"></i><span class="ui-dual-copy"><strong>Lần sửa này sẽ đồng bộ bảng mã hàng hiện tại.</strong><span>此次修改將同步目前的款號表。</span></span></div>
      <dl><div><dt><span class="ui-dual-copy"><strong>Công đoạn</strong><span>工序</span></span></dt><dd>${safe(processNo)}</dd></div><div><dt><span class="ui-dual-copy"><strong>Kích thước</strong><span>尺寸</span></span></dt><dd>${safe(sizeLabel||'—')}</dd></div><div><dt><span class="ui-dual-copy"><strong>Giây hiện tại</strong><span>原本秒數</span></span></dt><dd>${safe(currentSeconds)} s</dd></div><div><dt><span class="ui-dual-copy"><strong>Giây mới</strong><span>修改後秒數</span></span></dt><dd>${safe(newSeconds)} s</dd></div><div><dt><span class="ui-dual-copy"><strong>Mã hàng</strong><span>款號</span></span></dt><dd>${safe(products.map(item=>item.code).join('、'))}</dd></div></dl>
      <div class="process-seconds-history-note ui-bilingual"><span class="ui-text-vi">Phiên bản lịch sử và giây chụp lúc ghi nhận sản xuất trước đây vẫn được giữ nguyên.</span><span class="ui-text-zh">歷史版本及過去生產登記秒數快照均會保留，不會被改寫。</span></div>`;
    return body;
  }

  async function confirmGroupCreation(product,products){
    const body=document.createElement('div');
    body.className='process-seconds-confirm-summary';
    body.innerHTML=`<div class="ui-notice is-warning"><i class="ti ti-box-multiple"></i><span class="ui-dual-copy"><strong>Tạo nhóm mới từ các mã đã chọn?</strong><span>是否以所選款號建立新的同產品群組？</span></span></div><p>${safe(products.map(item=>`${item.code}（${item.sz||'—'}）`).join('、'))}</p>`;
    return ui().confirmDialog({
      title:{vi:'Xác nhận tạo nhóm mới',zh:'確認建立新群組'},body,keepPrevious:true,
      confirmText:{vi:'Tạo nhóm mới',zh:'建立新群組'},cancelText:{vi:'Quay lại',zh:'返回'}
    });
  }

  function groupInformation(group,product,products,isCandidate){
    const host=document.createElement('section');
    host.className='process-seconds-group-information';
    const sizes=groupUI().groupBySize(products);
    host.innerHTML=`<div class="process-seconds-group-facts">
      <div class="is-heading"><i class="ti ti-info-circle"></i><span class="ui-dual-copy"><strong>Thông tin nhóm</strong><span>群組訊息</span></span></div>
      <div><span class="ui-dual-copy"><strong>Tên nhóm</strong><span>群組名稱</span></span><b>${group?safe(group.name||group.groupId):'<span class="ui-dual-copy"><strong>Chưa có nhóm</strong><span>未有群組</span></span>'}</b></div>
      <div><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><b>${safe(product.client||'—')}</b></div>
      <div><span class="ui-dual-copy"><strong>Số kích thước</strong><span>尺寸群組數</span></span><b>${sizes.length}</b></div>
      <div><span class="ui-dual-copy"><strong>Số mã</strong><span>款號數</span></span><b>${products.length}</b></div>
    </div><div class="process-seconds-group-note ui-bilingual"><span class="ui-text-vi">${isCandidate?'Các mã dưới đây do hệ thống tự khớp theo khách hàng, tên sản phẩm và cấu trúc công đoạn; cần người dùng xác nhận.':'Đây là thành viên của nhóm cùng sản phẩm đã được xác nhận.'}</span><span class="ui-text-zh">${isCandidate?'下列款號由系統依客人、產品名稱與工序結構自動匹配，仍須人工確認。':'以下為已確認同產品群組的成員。'}</span></div>`;
    return host;
  }

  async function open(input={}){
    if(!allowed()){
      await ui().alertDialog({message:{vi:'Bạn không có quyền nhạy cảm để sửa giây công đoạn.',zh:'你沒有修改正式工序秒數的敏感權限。'},kind:'warning'});
      return false;
    }
    await window.ensureProductsLoaded?.({requireMeta:true});
    await store().loadGroups();
    const product=productByCode(input.code);
    if(!product){ await ui().alertDialog({message:{vi:'Không tìm thấy mã hàng hiện tại.',zh:'找不到目前款號。'},kind:'danger'});return false; }
    const processNo=normalize(input.processNo);
    const operation=groupUI().operationFor(product,processNo);
    if(!operation){ await ui().alertDialog({message:{vi:'Không tìm thấy công đoạn trong bảng mã hàng hiện tại.',zh:'目前款號表找不到這道工序。'},kind:'danger'});return false; }
    const group=store().groupForProduct(product.code);
    const candidateMode=!group;
    const members=group
      ? (group.memberCodes||[]).map(productByCode).filter(Boolean)
      : [product,...store().findCandidates(product.code)];
    const sizeGroups=groupUI().groupBySize(members);
    const initialSize=groupUI().sizeKey(product);
    const recommended=Number(input.recommendedSeconds);
    const sizeStates=new Map(sizeGroups.map(sizeGroup=>{
      const values=[...new Set(sizeGroup.members.map(item=>Number(groupUI().operationFor(item,processNo)?.sec)).filter(value=>value>0))];
      return [sizeGroup.key,{
        label:sizeGroup.labelPair.vi,
        values,
        currentText:values.length===1?String(values[0]):values.join(' / '),
        proposed:sizeGroup.key===initialSize&&recommended>0?String(recommended):(values.length===1?String(values[0]):'')
      }];
    }));
    let saveNewGroup=false;
    const body=document.createElement('div');
    body.className='process-seconds-quick-edit';
    const initialState=sizeStates.get(initialSize)||{currentText:String(Number(operation.sec)),proposed:String(Number(operation.sec))};
    const displayed=Number(input.displayedSeconds);
    body.innerHTML=`<section class="process-seconds-edit-fields">
      <div><span class="ui-dual-copy"><strong>Số công đoạn</strong><span>工序號</span></span><b>${safe(processNo)}</b></div>
      <div class="is-name"><span class="ui-dual-copy"><strong>Tên công đoạn Việt</strong><span>工序越文名稱</span></span><b>${safe(operation.vi||input.processNameVi||'—')}</b></div>
      <div><span class="ui-dual-copy"><strong>Giây hiện tại</strong><span>原本秒數</span></span><b data-quick-current-seconds>${safe(initialState.currentText)} s</b></div>
      <span class="process-seconds-direction" aria-hidden="true"><i class="ti ti-arrow-right"></i></span>
      <label class="is-seconds"><span class="ui-dual-copy"><strong>Giây sau sửa</strong><span>修改後秒數</span></span><input type="number" min="0.01" max="86400" step="0.01" value="${safe(initialState.proposed)}" data-quick-seconds></label>
      <div class="is-group"><span class="ui-dual-copy"><strong>${group?'Nhóm hiện tại':'Trạng thái nhóm'}</strong><span>${group?'目前群組':'群組狀態'}</span></span><b>${group?safe(group.name||group.groupId):'<span class="ui-dual-copy"><strong>Chưa có nhóm</strong><span>未有群組</span></span>'}</b></div>
      ${candidateMode?'<button type="button" class="ui-button is-compact process-seconds-save-group" data-save-new-group aria-pressed="false"><i class="ti ti-box-multiple"></i><span class="ui-dual-copy"><strong>Lưu thành nhóm</strong><span>儲存全組</span></span></button>':''}
    </section>
    ${displayed>0&&displayed!==Number(operation.sec)?`<div class="ui-notice is-warning"><i class="ti ti-history"></i><span class="ui-dual-copy"><strong>Dòng đã bấm là ảnh chụp ${safe(displayed)} giây; tiêu chuẩn hiện tại là ${safe(Number(operation.sec))} giây.</strong><span>點擊的紀錄為 ${safe(displayed)} 秒歷史快照；目前正式標準為 ${safe(Number(operation.sec))} 秒。</span></span></div>`:''}
    <section class="process-seconds-group-section"><div data-quick-member-selector></div></section>`;
    let shownSize=initialSize;
    let selector;
    function activeSizeGroup(){ return sizeGroups.find(item=>item.key===selector?.activeSize())||sizeGroups[0]||{key:initialSize,labelPair:{vi:'—'},members:[]}; }
    function updateActiveSelectionCount(){
      const active=activeSizeGroup();
      const selected=new Set(selector?.selectedCodes()||[]);
      const count=active.members.filter(item=>selected.has(normalize(item.code))).length;
      const host=body.querySelector('.process-size-selection-count');
      if(host) host.innerHTML=`<strong>${count} đã chọn trong kích thước này</strong><span>此尺寸已選 ${count}</span>`;
    }
    function refreshSizeSeconds(){
      const inputElement=body.querySelector('[data-quick-seconds]');
      const nextSize=selector?.activeSize()||initialSize;
      if(inputElement&&shownSize&&shownSize!==nextSize){
        const previous=sizeStates.get(shownSize);
        if(previous) previous.proposed=inputElement.value;
      }
      shownSize=nextSize;
      const current=sizeStates.get(nextSize)||{currentText:'—',proposed:''};
      const currentHost=body.querySelector('[data-quick-current-seconds]');
      if(currentHost) currentHost.textContent=current.currentText?`${current.currentText} s`:'—';
      if(inputElement) inputElement.value=current.proposed;
      updateActiveSelectionCount();
    }
    selector=groupUI().createMemberSelector({
      products:members,currentCode:product.code,activeSize:product.sz,compact:true,
      selectedCodes:members.map(item=>item.code),requiredCodes:[product.code],selectable:true,
      onChange:refreshSizeSeconds
    });
    body.querySelector('[data-quick-member-selector]').appendChild(selector.element);
    body.querySelector('[data-quick-seconds]')?.addEventListener('input',event=>{
      const current=sizeStates.get(selector.activeSize());
      if(current) current.proposed=event.currentTarget.value;
    });
    refreshSizeSeconds();
    body.appendChild(groupInformation(group,product,members,candidateMode));
    const saveGroupButton=body.querySelector('[data-save-new-group]');
    saveGroupButton?.addEventListener('click',()=>{
      saveNewGroup=!saveNewGroup;
      saveGroupButton.setAttribute('aria-pressed',String(saveNewGroup));
      saveGroupButton.classList.toggle('is-primary',saveNewGroup);
      saveGroupButton.querySelector('i').className=`ti ${saveNewGroup?'ti-checkbox':'ti-box-multiple'}`;
    });
    let saved=false;
    ui().openDialog({
      title:{vi:'Sửa nhanh giây công đoạn chính thức',zh:'快速修改正式工序秒數'},body,size:'xlarge',
      actions:[
        {text:{vi:'Hủy',zh:'取消'}},
        {text:{vi:'Xác nhận và lưu',zh:'確認並儲存'},icon:'ti-device-floppy',kind:'primary',onClick:async()=>{
          const seconds=Number(body.querySelector('[data-quick-seconds]')?.value);
          const active=activeSizeGroup();
          const selectedCodes=new Set(selector.selectedCodes());
          const targetProducts=active.members.filter(item=>selectedCodes.has(normalize(item.code)));
          const groupProducts=selector.selectedProducts();
          const currentState=sizeStates.get(active.key)||{currentText:'—'};
          if(!(seconds>0&&seconds<=86400)){ await ui().alertDialog({message:{vi:'Giây phải lớn hơn 0.',zh:'秒數必須大於0。'},kind:'warning',keepPrevious:true});return false; }
          if(!targetProducts.length){ await ui().alertDialog({message:{vi:'Chưa chọn mã hàng trong kích thước hiện tại.',zh:'目前尺寸尚未選擇要同步的款號。'},kind:'warning',keepPrevious:true});return false; }
          if(saveNewGroup&&groupProducts.length<2){ await ui().alertDialog({message:{vi:'Nhóm mới phải có ít nhất 2 mã.',zh:'新群組至少需要2個款號。'},kind:'warning',keepPrevious:true});return false; }
          if(saveNewGroup&&!(await confirmGroupCreation(product,groupProducts))) return false;
          const syncConfirmed=await ui().confirmDialog({
            title:{vi:'Xác nhận đồng bộ bảng mã hàng',zh:'確認同步目前款號表'},body:selectedSummary(targetProducts,processNo,currentState.currentText,seconds,active.labelPair.vi),keepPrevious:true,
            confirmText:{vi:'Đồng bộ và lưu',zh:'同步並儲存'},cancelText:{vi:'Quay lại',zh:'返回'},kind:'warning'
          });
          if(!syncConfirmed) return false;
          if(saveNewGroup) await store().createGroup({memberCodes:groupProducts.map(item=>item.code),name:product.vi||product.zh||product.code});
          const result=await store().saveOfficialSeconds({targetCodes:targetProducts.map(item=>item.code),processNo,seconds,reason:QUICK_EDIT_REASON});
          saved=true;
          ui().showToast({kind:result.logSaved?'success':'warning',text:result.logSaved
            ?{vi:'Đã cập nhật giây chính thức và bảng mã hàng.',zh:'正式秒數與目前款號表已更新。'}
            :{vi:'Đã cập nhật giây, nhưng nhật ký thao tác lưu thất bại.',zh:'秒數已更新，但操作紀錄保存失敗。'}});
          if(typeof input.onSaved==='function') await input.onSaved(result);
          return true;
        }}
      ],
      onError:error=>ui().alertDialog({message:textApi().errorPair(error),kind:'danger',keepPrevious:true}),
      onClose:()=>{ if(!saved&&typeof input.onClose==='function') input.onClose(); }
    });
    return true;
  }

  function createButton(input={}){
    const button=document.createElement('button');
    button.type='button';
    button.className='process-seconds-edit-button';
    button.disabled=!allowed();
    const value=input.value===undefined||input.value===null?'—':input.value;
    button.innerHTML=`<span>${safe(value)}</span>`;
    textApi().setLocalizedAttribute(button,'title',allowed()?{vi:'Bấm để sửa giây chính thức',zh:'點擊修改正式工序秒數'}:{vi:'Không có quyền sửa giây',zh:'沒有秒數修改權限'});
    if(allowed()) button.addEventListener('click',event=>{ event.preventDefault();event.stopPropagation();open(input); });
    return button;
  }

  window.PCMSQuickProcessSeconds=Object.freeze({open,createButton,allowed});
})();
