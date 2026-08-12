// product-groups（同產品群組畫面）：清單優先，建立群組使用客人、來源款號、人工確認三步驟視窗。
(function(){
  'use strict';

  const state={initialized:false,languageBound:false,listClient:'',listQuery:'',selectedGroupId:'',dialog:null};
  const safe=value=>window.PCMSSafe.text(value);
  const textApi=()=>window.PCMSUIText;
  const ui=()=>window.PCMSUIComponents;
  const store=()=>window.PCMSProcessEditStore;
  const products=()=>Array.isArray(window.D)?window.D:[];
  const normalize=value=>String(value||'').trim();
  const productByCode=code=>products().find(item=>normalize(item.code)===normalize(code))||null;
  const clientName=product=>normalize(product?.client);

  function setStatus(pair,kind='info'){
    const host=document.getElementById('product-groups-status');
    if(!host) return;
    host.replaceChildren(ui().createNotice({text:pair,kind,long:true}));
    host.hidden=false;
  }

  function clearStatus(){
    const host=document.getElementById('product-groups-status');
    if(host){ host.hidden=true; host.replaceChildren(); }
  }

  function buildRoot(){
    const root=document.getElementById('product-groups-root');
    if(!root||root.childElementCount) return;
    root.innerHTML=`<div class="product-groups-page ui-work-panel">
      <div id="product-groups-status" hidden></div>
      <section class="product-groups-list ui-data-section">
        <div class="ui-section-header product-groups-list-header"><i class="ti ti-list-details"></i><span class="ui-dual-copy"><strong>Danh sách tất cả nhóm</strong><span>全部群組清單</span></span><b id="product-groups-total">0</b><button type="button" class="ui-button is-primary" id="product-groups-new-button"><i class="ti ti-plus"></i><span class="ui-dual-copy"><strong>Tạo nhóm mới</strong><span>建立新群組</span></span></button></div>
        <div class="product-groups-filter-row ui-toolbar">
          <label class="product-groups-field"><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><select id="product-groups-list-client"></select></label>
          <label class="product-groups-field is-search"><span class="ui-dual-copy"><strong>Tìm nhóm hoặc mã hàng</strong><span>搜尋群組或款號</span></span><input type="search" id="product-groups-search-input"></label>
        </div>
        <div class="ui-table-frame"><div class="ui-table-scroll product-groups-table-scroll"><table class="ui-table product-groups-table">
          <thead><tr><th><span class="ui-dual-copy"><strong>Tên nhóm</strong><span>群組名稱</span></span></th><th><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span></th><th class="ui-table-number-cell"><span class="ui-dual-copy"><strong>Số mã</strong><span>款號數</span></span></th><th><span class="ui-dual-copy"><strong>Mã hàng</strong><span>款號</span></span></th><th><span class="ui-dual-copy"><strong>Kích thước</strong><span>尺寸</span></span></th><th class="ui-table-center-cell"><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th></tr></thead>
          <tbody id="product-groups-table-body"></tbody>
        </table></div></div>
        <div class="product-groups-empty ui-empty-state" id="product-groups-empty" hidden><i class="ti ti-box-off"></i><span class="ui-dual-copy"><strong>Không tìm thấy nhóm phù hợp</strong><span>找不到符合條件的群組</span></span></div>
        <div class="product-groups-detail" id="product-groups-detail" hidden></div>
      </section>
    </div>`;
  }

  function clients(){
    return [...new Set(products().map(clientName).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'vi',{numeric:true,sensitivity:'base'}));
  }

  function fillClientSelect(select,value,{requireClient=false}={}){
    if(!select) return '';
    const names=clients();
    const options=[];
    const first=document.createElement('option');
    first.value='';
    first.textContent=textApi().visibleText(requireClient?{vi:'Chọn khách hàng',zh:'請選擇客人'}:{vi:'Tất cả khách hàng',zh:'全部客人'});
    options.push(first,...names.map(name=>{
      const option=document.createElement('option');
      option.value=name;
      option.textContent=name;
      return option;
    }));
    select.replaceChildren(...options);
    const selected=names.includes(value)?value:'';
    select.value=selected;
    return selected;
  }

  function groupMembers(group){ return (group?.memberCodes||[]).map(code=>productByCode(code)||{code,client:'',sz:''}); }
  function groupClient(group){ return clientName(groupMembers(group).find(item=>clientName(item)))||'—'; }

  function visibleGroups(){
    const query=state.listQuery.toLocaleLowerCase();
    return store().listGroups().filter(group=>{
      if(state.listClient&&groupClient(group)!==state.listClient) return false;
      if(!query) return true;
      const members=groupMembers(group);
      return [group.name,group.groupId,groupClient(group),...members.flatMap(item=>[item.code,item.sz,item.vi,item.zh])]
        .map(normalize).join(' ').toLocaleLowerCase().includes(query);
    }).sort((a,b)=>groupClient(a).localeCompare(groupClient(b),'vi',{numeric:true,sensitivity:'base'})
      ||normalize(a.name||a.groupId).localeCompare(normalize(b.name||b.groupId),'vi',{numeric:true,sensitivity:'base'}));
  }

  function compactValues(values,limit=6){
    const rows=[...new Set(values.map(normalize).filter(Boolean))];
    const visible=rows.slice(0,limit).join('、');
    return rows.length>limit?`${visible} +${rows.length-limit}`:(visible||'—');
  }

  function renderGroupList(){
    const body=document.getElementById('product-groups-table-body');
    const empty=document.getElementById('product-groups-empty');
    const total=document.getElementById('product-groups-total');
    if(!body||!empty||!total) return;
    const groups=visibleGroups();
    const allCount=store().listGroups().length;
    total.textContent=groups.length===allCount
      ? textApi().visibleText({vi:`${allCount} nhóm`,zh:`${allCount} 組`})
      : textApi().visibleText({vi:`Hiển thị ${groups.length} / ${allCount} nhóm`,zh:`顯示 ${groups.length}／共 ${allCount} 組`});
    body.innerHTML=groups.map(group=>{
      const members=groupMembers(group);
      return `<tr data-product-group-row="${safe(group.groupId)}" class="${group.groupId===state.selectedGroupId?'is-selected':''}"><td><b>${safe(group.name||group.groupId)}</b></td><td>${safe(groupClient(group))}</td><td class="ui-table-number-cell"><b>${members.length}</b></td><td>${safe(compactValues(members.map(item=>item.code)))}</td><td>${safe(compactValues(members.map(item=>item.sz)))}</td><td class="ui-table-center-cell"><button type="button" class="ui-button is-compact" data-product-group-view="${safe(group.groupId)}"><i class="ti ti-chevron-down"></i><span class="ui-dual-copy"><strong>Xem thành viên</strong><span>查看成員</span></span></button></td></tr>`;
    }).join('');
    empty.hidden=groups.length>0;
    if(state.selectedGroupId&&!groups.some(group=>group.groupId===state.selectedGroupId)){ state.selectedGroupId=''; renderGroupDetail(); }
  }

  function renderGroupDetail(){
    const host=document.getElementById('product-groups-detail');
    if(!host) return;
    const group=store().listGroups().find(item=>item.groupId===state.selectedGroupId);
    if(!group){ host.hidden=true; host.replaceChildren(); return; }
    const members=groupMembers(group);
    host.innerHTML=`<div class="product-groups-detail-header"><span class="ui-dual-copy"><strong>Thành viên nhóm</strong><span>群組成員</span></span><b>${safe(group.name||group.groupId)}</b><span>${members.length} mã / 款</span></div><div class="product-groups-member-grid">${members.map(member=>`<div class="product-groups-member-card"><div><b>${safe(member.code)}</b><span>${safe(member.sz||'—')}</span></div><button type="button" class="ui-button is-compact" data-product-group-edit="${safe(member.code)}"><span class="ui-dual-copy"><strong>Sửa công đoạn</strong><span>修改工序</span></span></button></div>`).join('')}</div>`;
    host.hidden=false;
  }

  function selectGroup(groupId){
    state.selectedGroupId=normalize(groupId);
    renderGroupList();
    renderGroupDetail();
    document.getElementById('product-groups-detail')?.scrollIntoView?.({block:'nearest'});
  }

  function setWizardStep(host,step){
    host.querySelectorAll('[data-product-groups-step]').forEach(item=>item.classList.toggle('is-active',Number(item.dataset.productGroupsStep)===step));
    host.querySelectorAll('[data-product-groups-panel]').forEach(item=>{ item.hidden=Number(item.dataset.productGroupsPanel)!==step; });
  }

  function wizardSourceOptions(host,client){
    const datalist=host.querySelector('#product-groups-wizard-options');
    if(!datalist) return;
    datalist.replaceChildren(...products().filter(item=>clientName(item)===client).sort((a,b)=>normalize(a.code).localeCompare(normalize(b.code),undefined,{numeric:true})).map(product=>{
      const option=document.createElement('option');
      option.value=normalize(product.code);
      option.label=[product.vi,product.zh,product.sz].filter(Boolean).join(' · ');
      return option;
    }));
  }

  function renderWizardCandidates(host,product){
    const panel=host.querySelector('[data-product-groups-panel="3"]');
    const candidates=store().findCandidates(product.code);
    panel.innerHTML=`<div class="product-groups-wizard-source"><span class="ui-dual-copy"><strong>Mã hàng gốc</strong><span>來源款號</span></span><b>${safe(product.code)}</b><span>${safe(product.sz||'—')}</span></div>
      ${candidates.length?`<div class="product-groups-wizard-note ui-bilingual"><span class="ui-text-vi">Mã gốc luôn có trong nhóm. Bỏ dấu chọn ở những mã không muốn ghép chung.</span><span class="ui-text-zh">來源款號一定會加入；不需要同群組的候選請取消勾選。</span></div><div class="product-groups-candidate-grid"><label class="is-source"><input type="checkbox" checked disabled><b>${safe(product.code)}</b><span>${safe(product.sz||'—')}</span></label>${candidates.map(item=>`<label><input type="checkbox" data-product-group-candidate="${safe(item.code)}" checked><b>${safe(item.code)}</b><span>${safe(item.sz||'—')}</span></label>`).join('')}</div><div class="product-groups-wizard-final"><b id="product-groups-create-count"></b><button type="button" class="ui-button is-primary" id="product-groups-create-button"><i class="ti ti-check"></i><span class="ui-dual-copy"><strong>Xác nhận tạo 1 nhóm</strong><span>確認建立1個群組</span></span></button></div>`
      :'<div class="ui-notice"><i class="ti ti-info-circle"></i><span class="ui-dual-copy"><strong>Không tìm thấy mã cùng cấu trúc để lập nhóm</strong><span>找不到結構相同、可建立群組的其他款號</span></span></div>'}`;
    updateCreateCount(host);
    setWizardStep(host,3);
  }

  function updateCreateCount(host){
    const count=host.querySelector('#product-groups-create-count');
    if(!count) return;
    const selected=host.querySelectorAll('[data-product-group-candidate]:checked').length+1;
    count.textContent=textApi().visibleText({vi:`Nhóm mới có ${selected} mã`,zh:`新群組共 ${selected} 個款號`});
  }

  function openCreateWizard(prefillCode=''){
    const body=document.createElement('div');
    body.className='product-groups-wizard';
    body.innerHTML=`<div class="product-groups-wizard-steps"><div data-product-groups-step="1"><b>1</b><span class="ui-dual-copy"><strong>Chọn khách hàng</strong><span>選擇客人</span></span></div><div data-product-groups-step="2"><b>2</b><span class="ui-dual-copy"><strong>Chọn mã gốc</strong><span>選擇來源款號</span></span></div><div data-product-groups-step="3"><b>3</b><span class="ui-dual-copy"><strong>Xác nhận thành viên</strong><span>確認群組成員</span></span></div></div><div id="product-groups-wizard-status" hidden></div>
      <section data-product-groups-panel="1" class="product-groups-wizard-panel"><label class="product-groups-field"><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><select id="product-groups-wizard-client"></select></label><button type="button" class="ui-button is-primary" id="product-groups-client-next"><span class="ui-dual-copy"><strong>Tiếp tục chọn mã hàng</strong><span>下一步選擇款號</span></span><i class="ti ti-arrow-right"></i></button></section>
      <section data-product-groups-panel="2" class="product-groups-wizard-panel" hidden><div class="product-groups-wizard-selected-client"></div><label class="product-groups-field is-product"><span class="ui-dual-copy"><strong>Mã hàng gốc</strong><span>來源款號</span></span><input type="search" id="product-groups-wizard-source" list="product-groups-wizard-options" autocomplete="off"><datalist id="product-groups-wizard-options"></datalist></label><div class="product-groups-wizard-actions"><button type="button" class="ui-button" data-product-groups-back="1"><i class="ti ti-arrow-left"></i><span class="ui-dual-copy"><strong>Quay lại</strong><span>上一步</span></span></button><button type="button" class="ui-button is-primary" id="product-groups-source-next"><span class="ui-dual-copy"><strong>Tìm mã cùng sản phẩm</strong><span>尋找同產品款號</span></span><i class="ti ti-arrow-right"></i></button></div></section>
      <section data-product-groups-panel="3" class="product-groups-wizard-panel" hidden></section>`;
    const dialog=ui().openDialog({title:{vi:'Tạo nhóm cùng sản phẩm mới',zh:'建立新的同產品群組'},body,size:'large',actions:[{text:{vi:'Đóng',zh:'關閉'},onClick:()=>true}]});
    state.dialog=dialog;
    const clientSelect=body.querySelector('#product-groups-wizard-client');
    fillClientSelect(clientSelect,'',{requireClient:true});
    textApi().setLocalizedAttribute(body.querySelector('#product-groups-wizard-source'),'placeholder',{vi:'Nhập mã hàng',zh:'輸入款號'});
    const prefillProduct=productByCode(prefillCode);
    if(prefillProduct){ clientSelect.value=clientName(prefillProduct); }
    body.addEventListener('click',async event=>{
      if(event.target.closest('#product-groups-client-next')){
        const client=normalize(clientSelect.value);
        if(!client){ setWizardStatus(body,{vi:'Vui lòng chọn khách hàng trước.',zh:'請先選擇客人。'},'warning'); return; }
        clearWizardStatus(body);
        body.querySelector('.product-groups-wizard-selected-client').innerHTML=`<span class="ui-dual-copy"><strong>Khách hàng đã chọn</strong><span>已選客人</span></span><b>${safe(client)}</b>`;
        wizardSourceOptions(body,client);
        const source=body.querySelector('#product-groups-wizard-source');
        if(prefillProduct&&clientName(prefillProduct)===client) source.value=prefillProduct.code;
        setWizardStep(body,2);
        source.focus();
        return;
      }
      const back=event.target.closest('[data-product-groups-back]');
      if(back){ setWizardStep(body,Number(back.dataset.productGroupsBack)); return; }
      if(event.target.closest('#product-groups-source-next')){
        const product=productByCode(body.querySelector('#product-groups-wizard-source').value);
        if(!product||clientName(product)!==normalize(clientSelect.value)){ setWizardStatus(body,{vi:'Không tìm thấy mã hàng của khách đã chọn.',zh:'找不到所選客人的款號。'},'warning'); return; }
        const existing=store().groupForProduct(product.code);
        if(existing){ dialog.close('existing'); selectGroup(existing.groupId); setStatus({vi:'Mã này đã có nhóm; đã mở nhóm hiện tại.',zh:'此款號已有群組，已開啟目前群組。'},'info'); return; }
        clearWizardStatus(body);
        body.dataset.sourceCode=product.code;
        renderWizardCandidates(body,product);
        return;
      }
      if(event.target.closest('#product-groups-create-button')) await createGroupFromWizard(body,dialog);
    });
    body.addEventListener('change',event=>{ if(event.target.matches('[data-product-group-candidate]')) updateCreateCount(body); });
    setWizardStep(body,1);
    if(prefillProduct) body.querySelector('#product-groups-client-next').click();
  }

  function setWizardStatus(host,pair,kind='warning'){
    const status=host.querySelector('#product-groups-wizard-status');
    if(!status) return;
    status.replaceChildren(ui().createNotice({text:pair,kind,long:true}));
    status.hidden=false;
  }

  function clearWizardStatus(host){
    const status=host.querySelector('#product-groups-wizard-status');
    if(status){ status.hidden=true; status.replaceChildren(); }
  }

  async function createGroupFromWizard(host,dialog){
    const product=productByCode(host.dataset.sourceCode);
    if(!product) return;
    const memberCodes=[product.code,...Array.from(host.querySelectorAll('[data-product-group-candidate]:checked'),input=>input.dataset.productGroupCandidate)];
    if(memberCodes.length<2){ setWizardStatus(host,{vi:'Phải chọn ít nhất 2 mã hàng.',zh:'至少必須選擇2個款號。'},'warning'); return; }
    clearWizardStatus(host);
    try{
      const button=host.querySelector('#product-groups-create-button');
      if(button) button.disabled=true;
      const group=await store().createGroup({memberCodes,name:product.vi||product.zh||product.code});
      dialog.close('created');
      state.selectedGroupId=group.groupId;
      renderGroupList();
      renderGroupDetail();
      setStatus({vi:'Đã tạo nhóm cùng sản phẩm.',zh:'同產品群組已建立。'},'success');
    }catch(error){
      const button=host.querySelector('#product-groups-create-button');
      if(button) button.disabled=false;
      setWizardStatus(host,textApi().errorPair(error),'danger');
    }
  }

  async function openProcessEdit(code){ window.PCMSPendingProcessEditContext={code:normalize(code)}; await window.sp?.('production-process-edit'); }

  function handleLanguageChange(){
    state.listClient=fillClientSelect(document.getElementById('product-groups-list-client'),state.listClient);
    renderGroupList();
    renderGroupDetail();
  }

  function bindEvents(){
    document.getElementById('product-groups-new-button')?.addEventListener('click',()=>openCreateWizard());
    document.getElementById('product-groups-list-client')?.addEventListener('change',event=>{ state.listClient=normalize(event.currentTarget.value); renderGroupList(); });
    document.getElementById('product-groups-search-input')?.addEventListener('input',event=>{ state.listQuery=normalize(event.currentTarget.value); renderGroupList(); });
    document.getElementById('product-groups-table-body')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-product-group-view]');
      const row=event.target.closest('[data-product-group-row]');
      if(button||row) selectGroup((button?.dataset.productGroupView)||(row?.dataset.productGroupRow));
    });
    document.getElementById('product-groups-detail')?.addEventListener('click',event=>{ const button=event.target.closest('[data-product-group-edit]'); if(button) openProcessEdit(button.dataset.productGroupEdit); });
  }

  async function loadProductionProductGroupsData(options={}){
    await window.ensureProductsLoaded(options);
    await store().loadGroups(options);
    return {products:window.D,groups:store().listGroups()};
  }

  async function productionProductGroupsInit(){
    buildRoot();
    if(!state.initialized){ bindEvents(); state.initialized=true; }
    textApi().setLocalizedAttribute(document.getElementById('product-groups-search-input'),'placeholder',{vi:'Nhập tên nhóm, mã hàng hoặc kích thước',zh:'輸入群組名稱、款號或尺寸'});
    if(!state.languageBound){ document.addEventListener('pcms:languagechange',handleLanguageChange); state.languageBound=true; }
    state.listClient=fillClientSelect(document.getElementById('product-groups-list-client'),state.listClient);
    renderGroupList();
    renderGroupDetail();
    const pending=window.PCMSPendingProductGroupContext;
    if(pending?.code){ window.PCMSPendingProductGroupContext=null; openCreateWizard(pending.code); }
  }

  function productionProductGroupsLeave(){
    clearStatus();
    state.dialog?.close?.('leave');
    state.dialog=null;
    if(state.languageBound){ document.removeEventListener('pcms:languagechange',handleLanguageChange); state.languageBound=false; }
  }

  window.loadProductionProductGroupsData=loadProductionProductGroupsData;
  window.productionProductGroupsInit=productionProductGroupsInit;
  window.productionProductGroupsLeave=productionProductGroupsLeave;
})();
