// product-groups（同產品群組畫面）：集中建立、搜尋與查看全部人工確認群組。
(function(){
  'use strict';

  const state={initialized:false,languageBound:false,createClient:'',listClient:'',sourceCode:'',listQuery:'',selectedGroupId:''};
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
    root.innerHTML=`
      <div class="product-groups-page ui-work-panel">
        <div id="product-groups-status" hidden></div>
        <section class="product-groups-create ui-data-section">
          <div class="ui-section-header"><i class="ti ti-box-multiple"></i><span class="ui-dual-copy"><strong>Tạo nhóm cùng sản phẩm</strong><span>建立同產品群組</span></span></div>
          <div class="product-groups-create-toolbar ui-toolbar">
            <label class="product-groups-field"><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><select id="product-groups-create-client"></select></label>
            <label class="product-groups-field is-product"><span class="ui-dual-copy"><strong>Mã hàng gốc</strong><span>來源款號</span></span><input type="search" id="product-groups-source-input" list="product-groups-source-options" autocomplete="off"><datalist id="product-groups-source-options"></datalist></label>
            <button type="button" class="ui-button is-primary" id="product-groups-check-button"><i class="ti ti-search"></i><span class="ui-dual-copy"><strong>Kiểm tra mã hàng</strong><span>檢查款號</span></span></button>
          </div>
          <div class="product-groups-rule ui-bilingual"><span class="ui-text-vi">Chỉ những mã có cùng khách hàng, tên sản phẩm và cấu trúc công đoạn mới được đề xuất. Kích thước và giây không dùng để phân nhóm; người dùng phải xác nhận.</span><span class="ui-text-zh">系統只建議客人、品名及工序結構相同的款號；尺寸與秒數不參與判定，仍必須由使用者確認。</span></div>
          <div class="product-groups-candidate-area" id="product-groups-candidate-area" hidden></div>
        </section>
        <section class="product-groups-list ui-data-section">
          <div class="ui-section-header product-groups-list-header"><i class="ti ti-list-details"></i><span class="ui-dual-copy"><strong>Danh sách tất cả nhóm</strong><span>全部群組清單</span></span><b id="product-groups-total">0</b></div>
          <div class="product-groups-filter-row ui-toolbar">
            <label class="product-groups-field"><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><select id="product-groups-list-client"></select></label>
            <label class="product-groups-field is-search"><span class="ui-dual-copy"><strong>Tìm nhóm hoặc mã hàng</strong><span>搜尋群組或款號</span></span><input type="search" id="product-groups-search-input"></label>
          </div>
          <div class="ui-table-frame"><div class="ui-table-scroll product-groups-table-scroll">
            <table class="ui-table product-groups-table">
              <thead><tr>
                <th><span class="ui-dual-copy"><strong>Tên nhóm</strong><span>群組名稱</span></span></th>
                <th><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span></th>
                <th class="ui-table-number-cell"><span class="ui-dual-copy"><strong>Số mã</strong><span>款號數</span></span></th>
                <th><span class="ui-dual-copy"><strong>Mã hàng</strong><span>款號</span></span></th>
                <th><span class="ui-dual-copy"><strong>Kích thước</strong><span>尺寸</span></span></th>
                <th class="ui-table-center-cell"><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th>
              </tr></thead>
              <tbody id="product-groups-table-body"></tbody>
            </table>
          </div></div>
          <div class="product-groups-empty ui-empty-state" id="product-groups-empty" hidden><i class="ti ti-box-off"></i><span class="ui-dual-copy"><strong>Không tìm thấy nhóm phù hợp</strong><span>找不到符合條件的群組</span></span></div>
          <div class="product-groups-detail" id="product-groups-detail" hidden></div>
        </section>
      </div>`;
  }

  function clients(){
    return [...new Set(products().map(clientName).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'vi',{numeric:true,sensitivity:'base'}));
  }

  function fillClientSelect(id,value){
    const select=document.getElementById(id);
    if(!select) return '';
    const all=document.createElement('option');
    all.value='';
    all.textContent=textApi().visibleText({vi:'Tất cả khách hàng',zh:'全部客人'});
    const names=clients();
    select.replaceChildren(all,...names.map(name=>{
      const option=document.createElement('option');
      option.value=name;
      option.textContent=name;
      return option;
    }));
    const selected=names.includes(value)?value:'';
    select.value=selected;
    return selected;
  }

  function fillSourceOptions(){
    const datalist=document.getElementById('product-groups-source-options');
    if(!datalist) return;
    const rows=products().filter(product=>!state.createClient||clientName(product)===state.createClient);
    datalist.replaceChildren(...rows.slice().sort((a,b)=>normalize(a.code).localeCompare(normalize(b.code),undefined,{numeric:true})).map(product=>{
      const option=document.createElement('option');
      option.value=normalize(product.code);
      option.label=[product.vi,product.zh,product.sz].filter(Boolean).join(' · ');
      return option;
    }));
  }

  function groupMembers(group){
    return (group?.memberCodes||[]).map(code=>productByCode(code)||{code,client:'',sz:''});
  }

  function groupClient(group){
    return clientName(groupMembers(group).find(item=>clientName(item)))||'—';
  }

  function visibleGroups(){
    const query=state.listQuery.toLocaleLowerCase();
    return store().listGroups().filter(group=>{
      if(state.listClient&&groupClient(group)!==state.listClient) return false;
      if(!query) return true;
      const members=groupMembers(group);
      const search=[group.name,group.groupId,groupClient(group),...members.flatMap(item=>[item.code,item.sz,item.vi,item.zh])]
        .map(normalize).join(' ').toLocaleLowerCase();
      return search.includes(query);
    }).sort((a,b)=>{
      const byClient=groupClient(a).localeCompare(groupClient(b),'vi',{numeric:true,sensitivity:'base'});
      if(byClient) return byClient;
      return normalize(a.name||a.groupId).localeCompare(normalize(b.name||b.groupId),'vi',{numeric:true,sensitivity:'base'});
    });
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
      return `<tr class="${group.groupId===state.selectedGroupId?'is-selected':''}">
        <td><b>${safe(group.name||group.groupId)}</b></td>
        <td>${safe(groupClient(group))}</td>
        <td class="ui-table-number-cell"><b>${members.length}</b></td>
        <td>${safe(compactValues(members.map(item=>item.code)))}</td>
        <td>${safe(compactValues(members.map(item=>item.sz)))}</td>
        <td class="ui-table-center-cell"><button type="button" class="ui-button is-compact" data-product-group-view="${safe(group.groupId)}"><i class="ti ti-eye"></i><span class="ui-dual-copy"><strong>Xem thành viên</strong><span>查看成員</span></span></button></td>
      </tr>`;
    }).join('');
    empty.hidden=groups.length>0;
    if(state.selectedGroupId&&!groups.some(group=>group.groupId===state.selectedGroupId)){
      state.selectedGroupId='';
      renderGroupDetail();
    }
  }

  function renderGroupDetail(){
    const host=document.getElementById('product-groups-detail');
    if(!host) return;
    const group=store().listGroups().find(item=>item.groupId===state.selectedGroupId);
    if(!group){ host.hidden=true; host.replaceChildren(); return; }
    const members=groupMembers(group);
    host.innerHTML=`<div class="product-groups-detail-header"><span class="ui-dual-copy"><strong>Thành viên nhóm</strong><span>群組成員</span></span><b>${safe(group.name||group.groupId)}</b><span>${members.length} mã / 款</span></div>
      <div class="product-groups-member-grid">${members.map(member=>`<div class="product-groups-member-card"><div><b>${safe(member.code)}</b><span>${safe(member.sz||'—')}</span></div><button type="button" class="ui-button is-compact" data-product-group-edit="${safe(member.code)}"><span class="ui-dual-copy"><strong>Sửa công đoạn</strong><span>修改工序</span></span></button></div>`).join('')}</div>`;
    host.hidden=false;
  }

  function renderSource(product){
    const host=document.getElementById('product-groups-candidate-area');
    if(!host) return;
    if(!product){ host.hidden=true; host.replaceChildren(); return; }
    const existing=store().groupForProduct(product.code);
    if(existing){
      host.innerHTML=`<div class="product-groups-source-summary"><div><span class="ui-dual-copy"><strong>Mã hàng</strong><span>款號</span></span><b>${safe(product.code)}</b></div><div><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><b>${safe(clientName(product)||'—')}</b></div><div><span class="ui-dual-copy"><strong>Kích thước</strong><span>尺寸</span></span><b>${safe(product.sz||'—')}</b></div></div>
        <div class="ui-notice"><i class="ti ti-circle-check"></i><span class="ui-dual-copy"><strong>Mã này đã thuộc một nhóm</strong><span>此款號已經屬於群組</span></span></div>
        <button type="button" class="ui-button" data-product-group-show-existing="${safe(existing.groupId)}"><span class="ui-dual-copy"><strong>Xem nhóm hiện tại</strong><span>查看目前群組</span></span></button>`;
      host.hidden=false;
      return;
    }
    const candidates=store().findCandidates(product.code);
    host.innerHTML=`<div class="product-groups-source-summary"><div><span class="ui-dual-copy"><strong>Mã hàng gốc</strong><span>來源款號</span></span><b>${safe(product.code)}</b></div><div><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><b>${safe(clientName(product)||'—')}</b></div><div><span class="ui-dual-copy"><strong>Tên sản phẩm</strong><span>品名</span></span><b>${safe(product.vi||product.zh||'—')}</b></div><div><span class="ui-dual-copy"><strong>Kích thước</strong><span>尺寸</span></span><b>${safe(product.sz||'—')}</b></div></div>
      ${candidates.length?`<div class="product-groups-candidate-heading"><span class="ui-dual-copy"><strong>Chọn mã xác nhận cùng nhóm</strong><span>選擇要確認為同群組的款號</span></span><b id="product-groups-create-count"></b></div>
        <div class="product-groups-candidate-grid"><label class="is-source"><input type="checkbox" checked disabled><b>${safe(product.code)}</b><span>${safe(product.sz||'—')}</span></label>${candidates.map(item=>`<label><input type="checkbox" data-product-group-candidate="${safe(item.code)}" checked><b>${safe(item.code)}</b><span>${safe(item.sz||'—')}</span></label>`).join('')}</div>
        <button type="button" class="ui-button is-primary" id="product-groups-create-button"><i class="ti ti-link"></i><span class="ui-dual-copy"><strong>Xác nhận tạo nhóm</strong><span>確認建立群組</span></span></button>`
        :'<div class="ui-notice"><i class="ti ti-info-circle"></i><span class="ui-dual-copy"><strong>Không tìm thấy mã cùng cấu trúc để lập nhóm</strong><span>找不到結構相同、可建立群組的其他款號</span></span></div>'}`;
    host.hidden=false;
    updateCreateCount();
  }

  function updateCreateCount(){
    const count=document.getElementById('product-groups-create-count');
    if(!count) return;
    const selected=document.querySelectorAll('[data-product-group-candidate]:checked').length+1;
    count.textContent=textApi().visibleText({vi:`Sẽ tạo ${selected} mã`,zh:`將建立 ${selected} 款`});
  }

  function inspectSource(){
    const input=document.getElementById('product-groups-source-input');
    const product=productByCode(input?.value);
    if(!product){
      state.sourceCode='';
      renderSource(null);
      setStatus({vi:'Không tìm thấy mã hàng.',zh:'找不到款號。'},'warning');
      return;
    }
    if(state.createClient&&clientName(product)!==state.createClient){
      setStatus({vi:'Mã hàng không thuộc khách hàng đã chọn.',zh:'此款號不屬於所選客人。'},'warning');
      return;
    }
    clearStatus();
    state.sourceCode=normalize(product.code);
    renderSource(product);
  }

  async function createGroup(){
    const product=productByCode(state.sourceCode);
    if(!product) return;
    const memberCodes=[product.code,...Array.from(document.querySelectorAll('[data-product-group-candidate]:checked'),input=>input.dataset.productGroupCandidate)];
    if(memberCodes.length<2){ setStatus({vi:'Phải chọn ít nhất 2 mã hàng.',zh:'至少必須選擇2個款號。'},'warning'); return; }
    const confirmed=await ui().confirmDialog({
      title:{vi:'Xác nhận tạo nhóm cùng sản phẩm',zh:'確認建立同產品群組'},
      message:{vi:`Sẽ tạo 1 nhóm gồm ${memberCodes.length} mã: ${memberCodes.join(', ')}.`,zh:`將建立1個群組，共 ${memberCodes.length} 個款號：${memberCodes.join(', ')}。`},
      confirmText:{vi:'Tạo nhóm',zh:'建立群組'},cancelText:{vi:'Hủy',zh:'取消'}
    });
    if(!confirmed) return;
    try{
      const group=await store().createGroup({memberCodes,name:product.vi||product.zh||product.code});
      state.selectedGroupId=group.groupId;
      setStatus({vi:'Đã tạo nhóm cùng sản phẩm.',zh:'同產品群組已建立。'},'success');
      renderSource(product);
      renderGroupList();
      renderGroupDetail();
    }catch(error){ setStatus(textApi().errorPair(error),'danger'); }
  }

  async function openProcessEdit(code){
    window.PCMSPendingProcessEditContext={code:normalize(code)};
    await window.sp?.('production-process-edit');
  }

  function selectGroup(groupId){
    state.selectedGroupId=normalize(groupId);
    renderGroupList();
    renderGroupDetail();
    document.getElementById('product-groups-detail')?.scrollIntoView?.({block:'nearest'});
  }

  function handleLanguageChange(){
    state.createClient=fillClientSelect('product-groups-create-client',state.createClient);
    state.listClient=fillClientSelect('product-groups-list-client',state.listClient);
    fillSourceOptions();
    renderGroupList();
    renderGroupDetail();
    if(state.sourceCode) renderSource(productByCode(state.sourceCode));
  }

  function bindEvents(){
    document.getElementById('product-groups-create-client')?.addEventListener('change',event=>{
      state.createClient=normalize(event.currentTarget.value);
      state.sourceCode='';
      const input=document.getElementById('product-groups-source-input');
      if(input) input.value='';
      fillSourceOptions();
      renderSource(null);
    });
    document.getElementById('product-groups-source-input')?.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); inspectSource(); } });
    document.getElementById('product-groups-check-button')?.addEventListener('click',inspectSource);
    document.getElementById('product-groups-list-client')?.addEventListener('change',event=>{ state.listClient=normalize(event.currentTarget.value); renderGroupList(); });
    document.getElementById('product-groups-search-input')?.addEventListener('input',event=>{ state.listQuery=normalize(event.currentTarget.value); renderGroupList(); });
    document.getElementById('product-groups-candidate-area')?.addEventListener('change',event=>{ if(event.target.matches('[data-product-group-candidate]')) updateCreateCount(); });
    document.getElementById('product-groups-candidate-area')?.addEventListener('click',event=>{
      if(event.target.closest('#product-groups-create-button')){ createGroup(); return; }
      const existing=event.target.closest('[data-product-group-show-existing]');
      if(existing) selectGroup(existing.dataset.productGroupShowExisting);
    });
    document.getElementById('product-groups-table-body')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-product-group-view]');
      if(button) selectGroup(button.dataset.productGroupView);
    });
    document.getElementById('product-groups-detail')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-product-group-edit]');
      if(button) openProcessEdit(button.dataset.productGroupEdit);
    });
  }

  async function loadProductionProductGroupsData(options={}){
    await window.ensureProductsLoaded(options);
    await store().loadGroups(options);
    return {products:window.D,groups:store().listGroups()};
  }

  async function productionProductGroupsInit(){
    buildRoot();
    if(!state.initialized){ bindEvents(); state.initialized=true; }
    textApi().setLocalizedAttribute(document.getElementById('product-groups-source-input'),'placeholder',{vi:'Nhập mã hàng',zh:'輸入款號'});
    textApi().setLocalizedAttribute(document.getElementById('product-groups-search-input'),'placeholder',{vi:'Nhập tên nhóm, mã hàng hoặc kích thước',zh:'輸入群組名稱、款號或尺寸'});
    if(!state.languageBound){ document.addEventListener('pcms:languagechange',handleLanguageChange); state.languageBound=true; }
    state.createClient=fillClientSelect('product-groups-create-client',state.createClient);
    state.listClient=fillClientSelect('product-groups-list-client',state.listClient);
    fillSourceOptions();
    renderGroupList();
    renderGroupDetail();
    const pending=window.PCMSPendingProductGroupContext;
    if(pending?.code){
      const product=productByCode(pending.code);
      if(product){
        state.sourceCode=normalize(product.code);
        const input=document.getElementById('product-groups-source-input');
        if(input) input.value=state.sourceCode;
        renderSource(product);
      }
      window.PCMSPendingProductGroupContext=null;
    }else if(state.sourceCode) renderSource(productByCode(state.sourceCode));
  }

  function productionProductGroupsLeave(){
    clearStatus();
    if(state.languageBound){ document.removeEventListener('pcms:languagechange',handleLanguageChange); state.languageBound=false; }
  }

  window.loadProductionProductGroupsData=loadProductionProductGroupsData;
  window.productionProductGroupsInit=productionProductGroupsInit;
  window.productionProductGroupsLeave=productionProductGroupsLeave;
})();
