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

  function allowed(){
    return typeof window.canEditProcessSeconds==='function'&&window.canEditProcessSeconds();
  }

  function selectedSummary(products,processNo,currentSeconds,newSeconds,sizeLabel,mode,impact){
    const body=document.createElement('div');
    body.className='process-seconds-confirm-summary';
    const correction=mode===store().EDIT_MODES.STANDARD_CORRECTION;
    body.innerHTML=`<div class="ui-notice is-warning"><i class="ti ti-alert-triangle"></i><span class="ui-dual-copy"><strong>Lần sửa này sẽ đồng bộ bảng mã hàng hiện tại.</strong><span>此次修改將同步目前的款號表。</span></span></div>
      <dl><div><dt><span class="ui-dual-copy"><strong>Chế độ</strong><span>修改模式</span></span></dt><dd><span class="ui-dual-copy"><strong>${correction?'Sửa lỗi tiêu chuẩn':'Tối ưu công đoạn'}</strong><span>${correction?'標準錯誤訂正':'工序優化'}</span></span></dd></div><div><dt><span class="ui-dual-copy"><strong>Công đoạn</strong><span>工序</span></span></dt><dd>${safe(processNo)}</dd></div><div><dt><span class="ui-dual-copy"><strong>Kích thước</strong><span>尺寸</span></span></dt><dd>${safe(sizeLabel||'—')}</dd></div><div><dt><span class="ui-dual-copy"><strong>Giây bảng mã hàng</strong><span>款號表秒數</span></span></dt><dd>${safe(currentSeconds)} s</dd></div><div><dt><span class="ui-dual-copy"><strong>Giây mới</strong><span>修改後秒數</span></span></dt><dd>${safe(newSeconds)} s</dd></div><div><dt><span class="ui-dual-copy"><strong>Mã hàng</strong><span>款號</span></span></dt><dd>${safe(products.map(item=>item.code).join('、'))}</dd></div><div><dt><span class="ui-dual-copy"><strong>Đơn đang sản xuất</strong><span>生產中訂單</span></span></dt><dd>${Number(impact?.orderCount)||0}</dd></div><div><dt><span class="ui-dual-copy"><strong>Bản ghi sản xuất cần sửa</strong><span>需訂正產能紀錄</span></span></dt><dd>${correction?(Number(impact?.entryCount)||0):0}</dd></div></dl>
      <div class="process-seconds-history-note ui-bilingual"><span class="ui-text-vi">${correction?'Bản ghi cũ sẽ lưu giây trong bảng mã hàng trước khi sửa và thêm kết quả sửa để tính lại hiệu suất.':'Bản ghi cũ giữ nguyên; chỉ lần ghi nhận sau khi đồng bộ hoàn tất mới dùng giây mới.'}</span><span class="ui-text-zh">${correction?'舊紀錄會保留修改前的款號表秒數，另存訂正結果並重新計算效率。':'舊紀錄完全不變；同步完成後的新登記才使用新秒數。'}</span></div>`;
    return body;
  }

  function previewOperations(product,processNo,seconds){
    return (product.ops||[]).map(item=>{
      const operation=window.PCMSProductModel.normalizeOperation(item);
      return String(operation.no)===String(processNo)?{...operation,sec:seconds}:operation;
    });
  }

  function progressText(progress){
    if(progress?.phase==='entries') return {
      vi:`Đang sửa bản ghi sản xuất ${progress.completed}/${progress.total}...`,
      zh:`正在訂正產能紀錄 ${progress.completed}/${progress.total}…`
    };
    if(progress?.phase==='complete') return {vi:'Đã hoàn tất toàn bộ thay đổi.',zh:'全部修改已完成。'};
    return {
      vi:`Đang đồng bộ đơn hàng ${progress?.completed||0}/${progress?.total||0}...`,
      zh:`正在同步訂單 ${progress?.completed||0}/${progress?.total||0}…`
    };
  }

  // openGroupCreation（開啟群組建立頁）：獨立選擇、確認並儲存群組，不讀寫工序秒數。
  function openGroupCreation(product,products,selectedCodes){
    return new Promise(resolve=>{
      let settled=false;
      const body=document.createElement('div');
      body.className='process-seconds-group-create product-group-detail-dialog';
      const heading=document.createElement('div');
      heading.className='ui-notice is-info';
      heading.innerHTML='<i class="ti ti-box-multiple"></i><span class="ui-dual-copy"><strong>Chọn mã hàng để lưu thành một nhóm độc lập.</strong><span>選擇款號後獨立儲存群組，不會修改工序秒數。</span></span>';
      const selector=groupUI().createMemberSelector({
        products,currentCode:product.code,activeSize:product.sz,compact:true,
        selectedCodes,requiredCodes:[product.code],selectable:true
      });
      body.append(heading,selector.element);
      ui().openDialog({
        title:{vi:'Thiết lập nhóm mã hàng',zh:'設定款號群組'},body,size:'large',keepPrevious:true,
        actions:[
          {text:{vi:'Hủy',zh:'取消'},onClick:()=>{ settled=true;resolve(null); }},
          {text:{vi:'Xác nhận lưu nhóm',zh:'確認儲存群組'},icon:'ti-device-floppy',kind:'primary',onClick:async()=>{
            const memberCodes=selector.selectedCodes();
            if(memberCodes.length<2){
              await ui().alertDialog({message:{vi:'Nhóm mới phải có ít nhất 2 mã hàng.',zh:'新群組至少需要2個款號。'},kind:'warning',keepPrevious:true});
              return false;
            }
            const created=await store().createGroup({memberCodes,name:product.vi||product.zh||product.code});
            settled=true;
            resolve(created);
            ui().showToast({kind:'success',text:{vi:'Đã lưu nhóm mã hàng.',zh:'款號群組已儲存。'}});
            return true;
          }}
        ],
        onError:error=>ui().alertDialog({message:textApi().errorPair(error),kind:'danger',keepPrevious:true}),
        onClose:()=>{ if(!settled) resolve(null); }
      });
    });
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
    let currentGroup=store().groupForProduct(product.code);
    const candidateMode=!currentGroup;
    const members=currentGroup
      ? (currentGroup.memberCodes||[]).map(productByCode).filter(Boolean)
      : [product,...store().findCandidates(product.code)];
    const sizeGroups=groupUI().groupBySize(members);
    const initialSize=groupUI().sizeKey(product);
    const recommended=Math.round(Number(input.recommendedSeconds)||0);
    const sizeStates=new Map(sizeGroups.map(sizeGroup=>{
      const values=[...new Set(sizeGroup.members.map(item=>Math.round(Number(groupUI().operationFor(item,processNo)?.sec)||0)).filter(value=>value>0))];
      return [sizeGroup.key,{
        label:sizeGroup.labelPair.vi,
        values,
        currentText:values.length===1?String(values[0]):values.join(' / '),
        proposed:sizeGroup.key===initialSize&&recommended>0?String(recommended):(values.length===1?String(values[0]):'')
      }];
    }));
    const body=document.createElement('div');
    body.className='process-seconds-quick-edit';
    const officialSeconds=Math.round(Number(operation.sec)||0);
    const initialState=sizeStates.get(initialSize)||{currentText:String(officialSeconds),proposed:String(officialSeconds)};
    const displayed=Math.round(Number(input.displayedSeconds)||0);
    body.innerHTML=`<section class="process-seconds-edit-fields">
      <div><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><b>${safe(product.client||'—')}</b></div>
      <div><span class="ui-dual-copy"><strong>Số công đoạn</strong><span>工序號</span></span><b>${safe(processNo)}</b></div>
      <div class="is-name"><span class="ui-dual-copy"><strong>Tên công đoạn Việt</strong><span>工序越文名稱</span></span><b>${safe(operation.vi||input.processNameVi||'—')}</b></div>
      <div><span class="ui-dual-copy"><strong>Giây bảng mã hàng</strong><span>款號表秒數</span></span><b data-quick-current-seconds>${safe(initialState.currentText)} s</b></div>
      <span class="process-seconds-direction" aria-hidden="true"><i class="ti ti-arrow-right"></i></span>
      <label class="is-seconds"><span class="ui-dual-copy"><strong>Giây sau sửa</strong><span>修改後秒數</span></span><input type="number" min="1" max="86400" step="1" inputmode="numeric" value="${safe(initialState.proposed)}" data-quick-seconds></label>
      <div class="is-group"><span class="ui-dual-copy" data-quick-group-label><strong>${currentGroup?'Nhóm hiện tại':'Trạng thái nhóm'}</strong><span>${currentGroup?'目前群組':'群組狀態'}</span></span><b data-quick-group-value>${currentGroup?safe(currentGroup.name||currentGroup.groupId):'<span class="ui-dual-copy"><strong>Chưa có nhóm</strong><span>未有群組</span></span>'}</b></div>
      ${candidateMode?'<button type="button" class="ui-button is-compact process-seconds-save-group" data-save-new-group><i class="ti ti-box-multiple"></i><span class="ui-dual-copy"><strong>Lưu thành nhóm</strong><span>儲存全組</span></span></button>':''}
    </section>
    <section class="process-edit-mode-selector" data-quick-mode-selector>
      <label class="process-edit-mode-option"><input type="radio" name="quick-process-edit-mode" value="standardCorrection" checked><span class="ui-dual-copy"><strong>Sửa lỗi tiêu chuẩn</strong><span>標準錯誤訂正</span></span><small class="ui-bilingual"><span class="ui-text-vi">Sửa lại giây và hiệu suất của bản ghi cũ; vẫn lưu giây trong bảng mã hàng trước khi sửa.</span><span class="ui-text-zh">訂正舊登記秒數與效率，並保留修改前的款號表秒數。</span></small></label>
      <label class="process-edit-mode-option"><input type="radio" name="quick-process-edit-mode" value="processOptimization"><span class="ui-dual-copy"><strong>Tối ưu công đoạn</strong><span>工序優化</span></span><small class="ui-bilingual"><span class="ui-text-vi">Giữ nguyên toàn bộ bản ghi cũ; giây mới dùng từ khi đồng bộ xong.</span><span class="ui-text-zh">舊登記完全不變；同步完成後才使用新秒數。</span></small></label>
    </section>
    ${displayed>0&&displayed!==officialSeconds?`<div class="ui-notice is-warning"><i class="ti ti-history"></i><span class="ui-dual-copy"><strong>Dòng đã bấm là ảnh chụp ${safe(displayed)} giây; tiêu chuẩn hiện tại là ${safe(officialSeconds)} giây.</strong><span>點擊的紀錄為 ${safe(displayed)} 秒歷史快照；目前正式標準為 ${safe(officialSeconds)} 秒。</span></span></div>`:''}
    <section class="process-seconds-group-section"><div data-quick-member-selector></div></section>`;
    let shownSize=initialSize;
    let selector;
    function activeSizeGroup(){ return sizeGroups.find(item=>item.key===selector?.activeSize())||sizeGroups[0]||{key:initialSize,labelPair:{vi:'—'},members:[]}; }
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
    }
    selector=groupUI().createMemberSelector({
      products:members,currentCode:product.code,activeSize:product.sz,compact:true,
      selectedCodes:members.map(item=>item.code),requiredCodes:[product.code],selectable:true,
      onChange:refreshSizeSeconds
    });
    body.querySelector('[data-quick-member-selector]').appendChild(selector.element);
    body.querySelector('[data-quick-seconds]')?.addEventListener('input',event=>{
      const value=Number(event.currentTarget.value);
      if(Number.isFinite(value)&&event.currentTarget.value!=='') event.currentTarget.value=String(Math.max(1,Math.min(86400,Math.round(value))));
      const current=sizeStates.get(selector.activeSize());
      if(current) current.proposed=event.currentTarget.value;
    });
    refreshSizeSeconds();
    const saveGroupButton=body.querySelector('[data-save-new-group]');
    function renderGroupStatus(){
      if(!currentGroup) return;
      const label=body.querySelector('[data-quick-group-label]');
      const value=body.querySelector('[data-quick-group-value]');
      if(label) label.innerHTML='<strong>Nhóm hiện tại</strong><span>目前群組</span>';
      if(value) value.textContent=currentGroup.name||currentGroup.groupId;
      if(saveGroupButton) saveGroupButton.hidden=true;
    }
    async function createIndependentGroup(){
      if(currentGroup) return currentGroup;
      const created=await openGroupCreation(product,members,selector.selectedCodes());
      if(!created) return null;
      currentGroup=created;
      selector.setSelectedCodes(created.memberCodes||[]);
      renderGroupStatus();
      return created;
    }
    saveGroupButton?.addEventListener('click',()=>{ void createIndependentGroup(); });
    let saved=false;
    ui().openDialog({
      title:{vi:'Sửa nhanh giây công đoạn chính thức',zh:'快速修改正式工序秒數'},body,size:'large',
      actions:[
        {text:{vi:'Hủy',zh:'取消'}},
        {text:{vi:'Xác nhận và lưu',zh:'確認並儲存'},icon:'ti-device-floppy',kind:'primary',onClick:async()=>{
          const seconds=Math.round(Number(body.querySelector('[data-quick-seconds]')?.value)||0);
          const active=activeSizeGroup();
          const selectedCodes=new Set(selector.selectedCodes());
          const selectedProducts=active.members.filter(item=>selectedCodes.has(normalize(item.code)));
          const targetProducts=selectedProducts.filter(item=>Math.round(Number(groupUI().operationFor(item,processNo)?.sec)||0)!==seconds);
          const currentState=sizeStates.get(active.key)||{currentText:'—'};
          if(!(seconds>0&&seconds<=86400)){ await ui().alertDialog({message:{vi:'Giây phải lớn hơn 0.',zh:'秒數必須大於0。'},kind:'warning',keepPrevious:true});return false; }
          if(!selectedProducts.length){ await ui().alertDialog({message:{vi:'Chưa chọn mã hàng trong kích thước hiện tại.',zh:'目前尺寸尚未選擇要同步的款號。'},kind:'warning',keepPrevious:true});return false; }
          if(!targetProducts.length){ await ui().alertDialog({message:{vi:'Giây mới giống dữ liệu hiện tại; hệ thống không ghi dữ liệu.',zh:'新秒數與目前資料相同，系統不會寫入資料。'},kind:'info',keepPrevious:true});return false; }
          if(!currentGroup){
            const setupGroup=await ui().confirmDialog({
              title:{vi:'Mã hàng chưa có nhóm',zh:'款號尚未建立群組'},
              body:{vi:'Mã hàng này chưa có nhóm. Bạn có muốn thiết lập ngay không? Chọn Bỏ qua để chỉ lưu giây.',zh:'該款號沒有群組，是否現在設定？選擇略過只會儲存秒數。'},
              keepPrevious:true,
              confirmText:{vi:'Thiết lập nhóm',zh:'設定群組'},
              cancelText:{vi:'Bỏ qua',zh:'略過'}
            });
            if(setupGroup&&!(await createIndependentGroup())) return false;
          }
           const mode=store().normalizeMode(body.querySelector('input[name="quick-process-edit-mode"]:checked')?.value);
           const operationsByCode=Object.fromEntries(targetProducts.map(item=>[item.code,previewOperations(item,processNo,seconds)]));
           const impact=await store().analyzeImpact({targetCodes:targetProducts.map(item=>item.code),operationsByCode,mode});
           const syncConfirmed=await ui().confirmDialog({
             title:{vi:'Xác nhận đồng bộ bảng mã hàng',zh:'確認同步目前款號表'},body:selectedSummary(targetProducts,processNo,currentState.currentText,seconds,active.labelPair.vi,mode,impact),keepPrevious:true,
             confirmText:{vi:'Đồng bộ và lưu',zh:'同步並儲存'},cancelText:{vi:'Quay lại',zh:'返回'},kind:'warning'
           });
           if(!syncConfirmed) return false;
           saved=true;
           const progress=ui().progressDialog({
             title:{vi:'Tiến độ sửa giây công đoạn',zh:'工序秒數修改進度'},value:0,
             text:{vi:'Đang lưu tiêu chuẩn mã hàng...',zh:'正在儲存款號標準…'},
             detail:{vi:`Ảnh hưởng ${impact.orderCount} đơn và ${impact.entryCount} bản ghi.`,zh:`影響 ${impact.orderCount} 張訂單與 ${impact.entryCount} 筆產能紀錄。`}
           });
           let result;
           try{
             result=await store().saveOfficialSeconds({
               targetCodes:targetProducts.map(item=>item.code),processNo,seconds,mode,
               orders:impact.orders,entryCount:impact.entryCount,
               onProgress:item=>progress.update({value:item.total?item.completed/item.total*100:0,text:progressText(item)})
             });
           }catch(error){
             progress.fail({vi:'Không thể hoàn tất thay đổi; trạng thái công việc đã được giữ lại.',zh:'無法完成修改；工作狀態已保留。'},
               {vi:`Mã công việc: ${error.processEditJobId||'—'}`,zh:`工作編號：${error.processEditJobId||'—'}`});
             window.setTimeout(()=>progress.close(),1200);
             throw error;
           }
           if(result.sync?.status==='partial'){
             progress.fail({vi:'Một số đơn đồng bộ thất bại; công việc đã được giữ để thử lại.',zh:'部分訂單同步失敗；工作已保留，可稍後重試。'},
               {vi:`Mã công việc: ${result.jobId}`,zh:`工作編號：${result.jobId}`});
             window.setTimeout(()=>progress.close(),1200);
             ui().showToast({kind:'warning',text:{vi:'Chưa hoàn tất toàn bộ thay đổi.',zh:'修改尚未全部完成。'}});
           }else{
             progress.complete({vi:'Đã hoàn tất sửa giây công đoạn.',zh:'工序秒數修改已全部完成。'});
             window.setTimeout(()=>progress.close(),800);
             ui().showToast({kind:result.logSaved?'success':'warning',text:result.logSaved
               ?{vi:'Đã cập nhật giây, đơn hàng và dữ liệu theo chế độ đã chọn.',zh:'秒數、訂單與資料已依所選模式完成更新。'}
               :{vi:'Đã cập nhật dữ liệu, nhưng nhật ký thao tác lưu thất bại.',zh:'資料已更新，但操作紀錄保存失敗。'}});
           }
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
