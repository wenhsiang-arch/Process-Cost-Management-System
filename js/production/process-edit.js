// process-edit（工序修改畫面）：依客人選擇款號、套用已確認群組、修改正式工序並下載歷史版本。
(function(){
  'use strict';

  const state={currentCode:'',selectedClient:'',applyMode:'current',draft:[],selectedTargets:new Set(),groupSelector:null,dirty:false,initialized:false,languageBound:false,orderSyncContext:null};
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
            <label class="process-edit-client-field">
              <span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span>
              <select id="process-edit-client-select"></select>
            </label>
            <label class="process-edit-product-field">
              <span class="ui-dual-copy"><strong>Mã hàng</strong><span>款號</span></span>
              <input type="search" id="process-edit-product-input" list="process-edit-product-options" autocomplete="off" placeholder="Nhập mã hàng / 輸入款號">
              <datalist id="process-edit-product-options"></datalist>
            </label>
            <button type="button" class="ui-button is-primary" id="process-edit-load-button"><i class="ti ti-search"></i><span class="ui-dual-copy"><strong>Mở mã hàng</strong><span>開啟款號</span></span></button>
            <button type="button" class="ui-button" id="process-edit-history-button"><i class="ti ti-history"></i><span class="ui-dual-copy"><strong>Lịch sử phiên bản</strong><span>款號版本歷史</span></span></button>
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
          <section class="process-edit-operations ui-data-section">
            <div class="ui-section-header process-edit-section-header">
              <i class="ti ti-list-numbers"></i><span class="ui-dual-copy"><strong>Công đoạn chính thức</strong><span>目前正式工序</span></span>
              <button type="button" class="ui-button" id="process-edit-add-button"><i class="ti ti-plus"></i><span class="ui-dual-copy"><strong>Thêm công đoạn</strong><span>新增工序</span></span></button>
            </div>
            <div class="ui-table-frame"><div class="ui-table-scroll" data-ui-floating-scroll="only">
              <table class="ui-table process-edit-table" id="process-edit-table" data-ui-table-layout="custom" data-ui-table-sticky="none">
                <thead><tr>
                  <th class="ui-table-center-cell"><span class="ui-dual-copy"><strong>Thứ tự</strong><span>順序</span></span></th>
                  <th><span class="ui-dual-copy"><strong>Phân loại</strong><span>加工分類</span></span></th>
                  <th><span class="ui-dual-copy"><strong>Tên công đoạn Việt</strong><span>工序越文</span></span></th>
                  <th><span class="ui-dual-copy"><strong>Tên công đoạn Trung</strong><span>工序中文</span></span></th>
                  <th class="ui-table-number-cell"><span class="ui-dual-copy"><strong>Giây gốc</strong><span>開發原始秒數</span></span></th>
                  <th class="ui-table-number-cell"><span class="ui-dual-copy"><strong>Giây chính thức</strong><span>目前正式秒數</span></span></th>
                  <th class="ui-table-number-cell"><span class="ui-dual-copy"><strong>SL/giờ</strong><span>每小時產能</span></span></th>
                  <th class="ui-table-center-cell"><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th>
                </tr></thead>
                <tbody id="process-edit-table-body"></tbody>
              </table>
            </div></div>
          </section>
          <section class="process-edit-save-panel ui-operation-panel">
            <div class="process-edit-save-summary" id="process-edit-save-summary"></div>
            <div class="process-edit-save-main">
              <label class="process-edit-reason-field"><span class="ui-dual-copy"><strong>Lý do sửa</strong><span>修改原因</span></span><textarea id="process-edit-reason" maxlength="500" rows="2" placeholder="Ghi rõ lý do xác nhận của IE / 請填寫IE確認修改原因"></textarea></label>
              <div class="process-edit-save-actions">
                <button type="button" class="ui-button" id="process-edit-reset-button"><i class="ti ti-restore"></i><span class="ui-dual-copy"><strong>Khôi phục chưa lưu</strong><span>還原未儲存修改</span></span></button>
                <button type="button" class="ui-button" id="process-edit-order-exception-button"><i class="ti ti-file-settings"></i><span class="ui-dual-copy"><strong>Ngoại lệ một đơn</strong><span>單張訂單例外</span></span></button>
                <button type="button" class="ui-button is-primary" id="process-edit-save-button"><i class="ti ti-device-floppy"></i><span class="ui-dual-copy"><strong>Xác nhận sửa chính thức</strong><span>確認正式修改</span></span></button>
              </div>
            </div>
          </section>
          <section class="process-edit-order-sync ui-data-section" id="process-edit-order-sync" hidden></section>
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
      <div><span class="ui-dual-copy"><strong>Mã hàng hiện tại</strong><span>目前款號</span></span><b>${safe(product.code)}</b></div>
      <div><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><b>${safe(clientName(product)||'—')}</b></div>
      <div><span class="ui-dual-copy"><strong>Tên sản phẩm</strong><span>品名</span></span><b>${safe(product.vi||product.zh||'—')}</b><span>${safe(product.zh||'')}</span></div>
      <div><span class="ui-dual-copy"><strong>Kích thước</strong><span>尺寸</span></span><b>${safe(product.sz||'—')}</b></div>
      <div><span class="ui-dual-copy"><strong>Lần sửa chính thức</strong><span>正式修訂次數</span></span><b>${Number(product.standardRevision)||0}</b></div>`;
  }

  function renderGroup(product){
    const host=document.getElementById('process-edit-group-area');
    if(!host) return;
    state.groupSelector=null;
    const group=store().groupForProduct(product.code);
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
          onChange:controller=>{ state.selectedTargets=new Set(controller.selectedCodes());renderSaveSummary(); }
        });
        host.querySelector('[data-process-group-selector]').appendChild(state.groupSelector.element);
      }
      renderSaveSummary();
      return;
    }
    state.applyMode='current';
    state.selectedTargets=new Set([product.code]);
    host.innerHTML=`<div class="process-edit-no-group"><div class="ui-notice"><i class="ti ti-info-circle"></i><span class="ui-dual-copy"><strong>Mã này chưa thuộc nhóm cùng sản phẩm</strong><span>此款號尚未加入同產品群組</span></span></div>
      <button type="button" class="ui-button" id="process-edit-open-groups"><i class="ti ti-box-multiple"></i><span class="ui-dual-copy"><strong>Mở trang nhóm</strong><span>前往群組分頁</span></span></button></div>`;
    renderSaveSummary();
  }

  function renderSaveSummary(){
    const host=document.getElementById('process-edit-save-summary');
    if(!host||!state.currentCode) return;
    const targets=[...state.selectedTargets];
    host.innerHTML=`<div><span class="ui-dual-copy"><strong>Mã sẽ được sửa</strong><span>本次修改款號</span></span><b>${safe(targets.join('、'))}</b></div>
      <div><span class="ui-dual-copy"><strong>Số công đoạn</strong><span>工序數量</span></span><b>${state.draft.length}</b></div>
      <div><span class="ui-dual-copy"><strong>Đơn đang sản xuất</strong><span>生產中訂單</span></span><b class="ui-bilingual"><span class="ui-text-vi">Chọn đồng bộ sau khi lưu</span><span class="ui-text-zh">正式儲存後另行選擇同步</span></b></div>`;
  }

  function renderOperations(product){
    const body=document.getElementById('process-edit-table-body');
    if(!body) return;
    body.innerHTML=state.draft.map((operation,index)=>`<tr data-process-index="${index}">
      <td class="ui-table-center-cell"><b>${index+1}</b></td>
      <td><select data-process-field="category" ${canEdit()?'':'disabled'}><option value="BL" ${operation.category==='BL'?'selected':''}>BL</option><option value="SX" ${operation.category==='SX'?'selected':''}>SX</option><option value="QC" ${operation.category==='QC'?'selected':''}>QC</option><option value="DG" ${operation.category==='DG'?'selected':''}>DG</option></select></td>
      <td><input type="text" maxlength="200" data-process-field="vi" value="${safe(operation.vi)}" ${canEdit()?'':'disabled'}></td>
      <td><input type="text" maxlength="200" data-process-field="zh" value="${safe(operation.zh)}" ${canEdit()?'':'disabled'}></td>
      <td class="ui-table-number-cell">${safe(developmentSeconds(product,operation.no))}</td>
      <td class="ui-table-number-cell"><input type="number" min="0.01" max="86400" step="0.01" data-process-field="sec" value="${safe(operation.sec)}" ${canEdit()?'':'disabled'}></td>
      <td class="ui-table-number-cell"><b>${hourlyCapacity(operation.sec)}</b></td>
      <td class="ui-table-center-cell"><div class="process-edit-row-actions">
        <button type="button" data-process-action="up" aria-label="Lên / 上移" ${index===0||!canEdit()?'disabled':''}><i class="ti ti-arrow-up"></i></button>
        <button type="button" data-process-action="down" aria-label="Xuống / 下移" ${index===state.draft.length-1||!canEdit()?'disabled':''}><i class="ti ti-arrow-down"></i></button>
        <button type="button" data-process-action="delete" aria-label="Xóa / 刪除" class="is-danger" ${canEdit()?'':'disabled'}><i class="ti ti-trash"></i></button>
      </div></td>
    </tr>`).join('');
    renderSaveSummary();
  }

  function markDirty(){ state.dirty=true; }

  function resetDraft(){
    const product=productByCode(state.currentCode);
    state.draft=(product?.ops||[]).map(window.PCMSProductModel.normalizeOperation);
    state.dirty=false;
    const reason=document.getElementById('process-edit-reason');
    if(reason) reason.value='';
    if(product) renderOperations(product);
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
    state.selectedTargets=new Set([product.code]);
    state.draft=(product.ops||[]).map(window.PCMSProductModel.normalizeOperation);
    state.dirty=false;
    const input=document.getElementById('process-edit-product-input');
    if(input) input.value=product.code;
    document.getElementById('process-edit-empty').hidden=true;
    document.getElementById('process-edit-workspace').hidden=false;
    clearStatus();
    renderSummary(product);
    renderGroup(product);
    renderOperations(product);
    return true;
  }

  function changeRow(index,action){
    if(action==='delete'){
      if(state.draft.length<=1){ setStatus({vi:'Phải giữ lại ít nhất 1 công đoạn.',zh:'至少必須保留1道工序。'},'warning'); return; }
      state.draft.splice(index,1);
    }else{
      const target=action==='up'?index-1:index+1;
      if(target<0||target>=state.draft.length) return;
      [state.draft[index],state.draft[target]]=[state.draft[target],state.draft[index]];
    }
    state.draft.forEach((item,rowIndex)=>{ item.no=String(rowIndex+1); });
    markDirty();
    renderOperations(productByCode(state.currentCode));
  }

  function addOperation(){
    const next=state.draft.length+1;
    if(next>99){ setStatus({vi:'Tối đa 99 công đoạn.',zh:'最多99道工序。'},'warning'); return; }
    state.draft.push({no:String(next),category:'SX',vi:'',zh:'',sec:1});
    markDirty();
    renderOperations(productByCode(state.currentCode));
  }

  async function saveOfficial(){
    if(!canEdit()){ setStatus({vi:'Bạn không có quyền nhạy cảm để sửa tiêu chuẩn chính thức.',zh:'你沒有修改正式工序標準的敏感權限。'},'warning');return; }
    const reason=String(document.getElementById('process-edit-reason')?.value||'').trim();
    const targetCodes=[...state.selectedTargets];
    let operations;
    try{ operations=store().validateOperations(state.draft); }
    catch(error){ setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger'); return; }
    if(reason.length<2){ setStatus({vi:'Vui lòng nhập lý do sửa.',zh:'請填寫修改原因。'},'warning'); return; }
    const confirmed=await ui().confirmDialog({
      title:{vi:'Xác nhận sửa tiêu chuẩn chính thức',zh:'確認修改正式標準'},
      message:{
        vi:`Sẽ cập nhật ${operations.length} công đoạn cho ${targetCodes.length} mã: ${targetCodes.join(', ')}. Tạo phiên bản Excel mới; đơn hàng đang sản xuất sẽ chọn đồng bộ ở bước kế tiếp.`,
        zh:`將把 ${operations.length} 道工序套用到 ${targetCodes.length} 個款號：${targetCodes.join(', ')}。系統會建立新版 Excel 歷史；生產中訂單於下一步另行勾選同步。`
      },
      confirmText:{vi:'Xác nhận sửa',zh:'確認修改'},cancelText:{vi:'Hủy',zh:'取消'},kind:'warning'
    });
    if(!confirmed) return;
    try{
      setStatus({vi:'Đang lưu phiên bản và công đoạn...',zh:'正在儲存版本與工序修改…'},'info');
      const result=await store().saveOfficialProcesses({targetCodes,operations,reason});
      state.dirty=false;
      await selectProduct(state.currentCode,{force:true});
      setStatus(result.logSaved
        ? {vi:'Đã lưu tiêu chuẩn chính thức và phiên bản mới.',zh:'正式標準與新版本已儲存。'}
        : {vi:'Đã lưu tiêu chuẩn, nhưng lịch sử thao tác không lưu được.',zh:'正式標準已儲存，但操作紀錄保存失敗。'},result.logSaved?'success':'warning');
      if(typeof window.renderProcessEditOrderSync==='function') await window.renderProcessEditOrderSync({targetCodes,reason,operations});
    }catch(error){ setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger'); }
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
        ['版本識別碼',snapshot.version.versionId],['資料版本',snapshot.version.productVersion],['建立時間',new Date(snapshot.version.createdAt).toLocaleString('zh-TW')],['修改原因',snapshot.version.reason||'']
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
          Object.assign(document.createElement('small'),{textContent:textApi().visibleText({vi:`${version.productCount||0} mã · ${version.opCount||0} công đoạn · ${version.reason||''}`,zh:`${version.productCount||0} 款 · ${version.opCount||0} 工序 · ${version.reason||''}`})})
        );
        const button=ui().createButton({text:{vi:'Xuất Excel',zh:'匯出 Excel'},icon:'ti-download'});
        button.addEventListener('click',()=>exportVersion(version));
        row.append(copy,button);
        body.appendChild(row);
      });
      ui().openDialog({title:{vi:'Lịch sử phiên bản mã hàng',zh:'款號版本歷史'},body,size:'large',actions:[{text:{vi:'Đóng',zh:'關閉'}}]});
    }catch(error){ setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger'); }
  }

  function orderDate(order){
    const value=Number(order.actualShipDate||order.dueDate);
    return value?new Date(value).toLocaleDateString('zh-TW'):'—';
  }

  async function renderProcessEditOrderSync(context={}){
    const section=document.getElementById('process-edit-order-sync');
    if(!section) return;
    const orders=await store().activeOrdersForProducts(context.targetCodes||[]);
    state.orderSyncContext={...context,orders};
    section.hidden=false;
    if(!orders.length){
      section.innerHTML='<div class="ui-section-header"><i class="ti ti-file-check"></i><span class="ui-dual-copy"><strong>Không có đơn hàng đang sản xuất cần đồng bộ</strong><span>沒有需要同步的生產中訂單</span></span></div>';
      return;
    }
    section.innerHTML=`<div class="ui-section-header"><i class="ti ti-files"></i><span class="ui-dual-copy"><strong>Chọn đơn hàng đang sản xuất cần đồng bộ</strong><span>選擇要同步的生產中訂單</span></span></div>
      <div class="process-edit-order-warning ui-bilingual"><span class="ui-text-vi">Dữ liệu sản lượng đã đăng ký vẫn giữ giây cũ. Chỉ đăng ký mới sau khi đồng bộ dùng giây mới.</span><span class="ui-text-zh">已登記的產能紀錄保留舊秒數；同步完成後的新登記才使用新秒數。</span></div>
      <div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table process-edit-order-table"><thead><tr>
        <th class="ui-table-center-cell"><span class="ui-dual-copy"><strong>Chọn</strong><span>選取</span></span></th>
        <th><span class="ui-dual-copy"><strong>Số đơn hàng</strong><span>訂單號碼</span></span></th>
        <th><span class="ui-dual-copy"><strong>Ngày giao</strong><span>出貨日期</span></span></th>
        <th><span class="ui-dual-copy"><strong>Mã hàng bị ảnh hưởng</strong><span>受影響款號</span></span></th>
        <th><span class="ui-dual-copy"><strong>Trạng thái</strong><span>狀態</span></span></th>
      </tr></thead><tbody>${orders.map(order=>`<tr data-order-sync-row="${safe(order.id)}"><td class="ui-table-center-cell"><input type="checkbox" data-order-sync="${safe(order.id)}"></td><td><b>${safe(order.orderId||order.id)}</b></td><td>${safe(orderDate(order))}</td><td>${safe(order.matchedCodes.join(', '))}</td><td data-order-sync-status>—</td></tr>`).join('')}</tbody></table></div></div>
      <div class="process-edit-order-actions"><button type="button" class="ui-button" id="process-edit-order-skip"><span class="ui-dual-copy"><strong>Không đồng bộ lúc này</strong><span>暫不同步</span></span></button><button type="button" class="ui-button is-primary" id="process-edit-order-sync-button"><i class="ti ti-refresh"></i><span class="ui-dual-copy"><strong>Đồng bộ đơn đã chọn</strong><span>同步所選訂單</span></span></button></div>`;
    section.querySelector('#process-edit-order-skip').addEventListener('click',()=>{ section.hidden=true; });
    section.querySelector('#process-edit-order-sync-button').addEventListener('click',syncSelectedOrders);
    section.scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function syncSelectedOrders(){
    const context=state.orderSyncContext;
    const section=document.getElementById('process-edit-order-sync');
    if(!context||!section) return;
    const selected=Array.from(section.querySelectorAll('[data-order-sync]:checked'),input=>input.dataset.orderSync);
    if(!selected.length){ setStatus({vi:'Vui lòng chọn ít nhất một đơn hàng.',zh:'請至少選擇一張訂單。'},'warning'); return; }
    const button=section.querySelector('#process-edit-order-sync-button');
    button.disabled=true;
    for(const orderId of selected){
      const order=context.orders.find(item=>item.id===orderId);
      const row=section.querySelector(`[data-order-sync-row="${CSS.escape(orderId)}"]`);
      const status=row?.querySelector('[data-order-sync-status]');
      if(status) textApi().set(status,{vi:'Đang đồng bộ...',zh:'同步中…'});
      try{
        await store().syncOrderSnapshot({orderId,targetCodes:order.matchedCodes,operations:context.operations,reason:context.reason,mode:'official'});
        if(status) textApi().set(status,{vi:'Hoàn tất',zh:'已完成'});
        const checkbox=row?.querySelector('[data-order-sync]'); if(checkbox) checkbox.disabled=true;
      }catch(error){
        if(status){
          status.replaceChildren(textApi().create({vi:'Thất bại',zh:'失敗'}));
          if(error.processEditJobId){
            const retry=ui().createButton({text:{vi:'Thử lại',zh:'重試'},icon:'ti-refresh'});
            retry.addEventListener('click',async()=>{
              retry.disabled=true;
              try{ await store().retryOrderSnapshot(error.processEditJobId); textApi().set(status,{vi:'Hoàn tất',zh:'已完成'}); }
              catch(retryError){ retry.disabled=false; setStatus({vi:String(retryError.message||retryError),zh:String(retryError.message||retryError)},'danger'); }
            });
            status.appendChild(retry);
          }
        }
        setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger');
      }
    }
    button.disabled=false;
  }

  function chooseExceptionOrder(orders){
    return new Promise(resolve=>{
      const field=document.createElement('div');
      field.className='ui-dialog-field';
      field.appendChild(textApi().create({vi:'Đơn hàng đang sản xuất',zh:'生產中訂單'},{tagName:'label'}));
      const select=document.createElement('select');
      orders.forEach(order=>{
        const option=document.createElement('option');option.value=order.id;option.textContent=`${order.orderId||order.id} · ${orderDate(order)}`;select.appendChild(option);
      });
      field.appendChild(select);
      let settled=false;
      ui().openDialog({title:{vi:'Ngoại lệ một đơn hàng',zh:'單張訂單例外'},body:field,actions:[
        {text:{vi:'Hủy',zh:'取消'},onClick:()=>{settled=true;resolve(null);}},
        {text:{vi:'Chọn đơn hàng',zh:'選擇訂單'},kind:'primary',onClick:()=>{settled=true;resolve(select.value);}}
      ],onClose:()=>{if(!settled) resolve(null);}});
    });
  }

  async function saveOrderException(){
    if(!canEdit()){ setStatus({vi:'Bạn không có quyền nhạy cảm để sửa tiêu chuẩn chính thức.',zh:'你沒有修改正式工序標準的敏感權限。'},'warning');return; }
    const product=productByCode(state.currentCode);
    if(!product) return;
    let operations;
    try{ operations=store().validateOperations(state.draft); }
    catch(error){ setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger'); return; }
    const reason=String(document.getElementById('process-edit-reason')?.value||'').trim();
    if(reason.length<2){ setStatus({vi:'Vui lòng nhập lý do ngoại lệ.',zh:'請填寫單張訂單例外原因。'},'warning'); return; }
    const orders=await store().activeOrdersForProducts([product.code]);
    if(!orders.length){ setStatus({vi:'Không có đơn hàng đang sản xuất chứa mã này.',zh:'沒有包含此款號的生產中訂單。'},'warning'); return; }
    const orderId=await chooseExceptionOrder(orders);
    if(!orderId) return;
    const order=orders.find(item=>item.id===orderId);
    const confirmed=await ui().confirmDialog({title:{vi:'Xác nhận ngoại lệ đơn hàng',zh:'確認單張訂單例外'},message:{
      vi:`Chỉ cập nhật ${product.code} trong đơn ${order.orderId||order.id}; không sửa tiêu chuẩn mã hàng và không ảnh hưởng đơn khác.`,
      zh:`只修改訂單 ${order.orderId||order.id} 內的 ${product.code}；不修改款號正式標準，也不影響其他訂單。`
    }});
    if(!confirmed) return;
    try{
      setStatus({vi:'Đang cập nhật ngoại lệ đơn hàng...',zh:'正在更新單張訂單例外…'},'info');
      await store().syncOrderSnapshot({orderId,targetCodes:[product.code],operations,reason,mode:'exception'});
      state.dirty=false;
      setStatus({vi:'Đã cập nhật ngoại lệ cho một đơn hàng.',zh:'單張訂單例外已更新。'},'success');
    }catch(error){
      setStatus({vi:String(error.message||error),zh:String(error.message||error)},'danger');
    }
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
    document.getElementById('process-edit-order-exception-button')?.addEventListener('click',saveOrderException);
    document.getElementById('process-edit-save-button')?.addEventListener('click',saveOfficial);
    document.getElementById('process-edit-table-body')?.addEventListener('input',event=>{
      const field=event.target?.dataset?.processField;
      const row=event.target?.closest?.('[data-process-index]');
      if(!field||!row) return;
      const index=Number(row.dataset.processIndex);
      state.draft[index][field]=field==='sec'?Number(event.target.value):event.target.value;
      markDirty();
      if(field==='sec') row.querySelector('td:nth-child(7) b').textContent=String(hourlyCapacity(event.target.value));
    });
    document.getElementById('process-edit-table-body')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-process-action]');
      if(!button) return;
      const index=Number(button.closest('[data-process-index]').dataset.processIndex);
      changeRow(index,button.dataset.processAction);
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
    document.getElementById('process-edit-group-area')?.addEventListener('click',event=>{
      if(event.target.closest('#process-edit-open-groups')) openGroupsPage();
    });
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
    ['process-edit-add-button','process-edit-save-button','process-edit-order-exception-button'].forEach(id=>{ const button=document.getElementById(id);if(button) button.disabled=!editingAllowed; });
    const reason=document.getElementById('process-edit-reason');if(reason) reason.disabled=!editingAllowed;
    const pending=window.PCMSPendingProcessEditContext;
    if(pending?.code){
      await selectProduct(pending.code,{force:true});
      const seconds=Number(pending.recommendedSeconds);
      const operation=state.draft.find(item=>String(item.no)===String(pending.processNo));
      if(operation&&seconds>0){ operation.sec=seconds; markDirty(); renderOperations(productByCode(state.currentCode)); }
      window.PCMSPendingProcessEditContext=null;
    }else if(state.currentCode){
      await selectProduct(state.currentCode,{force:true});
    }
    if(!editingAllowed) setStatus({vi:'Trang đang ở chế độ chỉ xem; quyền nhạy cảm sửa tiêu chuẩn chưa được mở.',zh:'目前為唯讀模式；尚未開啟修改正式標準的敏感權限。'},'warning');
  }

  function productionProcessEditLeave(){
    clearStatus();
    if(state.languageBound){ document.removeEventListener('pcms:languagechange',handleLanguageChange); state.languageBound=false; }
  }

  window.loadProductionProcessEditData=loadProductionProcessEditData;
  window.productionProcessEditInit=productionProcessEditInit;
  window.productionProcessEditLeave=productionProcessEditLeave;
  window.renderProcessEditOrderSync=renderProcessEditOrderSync;
})();
