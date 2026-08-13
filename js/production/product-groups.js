// product-groups（同產品群組畫面）：清單優先，建立群組使用客人、來源款號、人工確認三步驟視窗。
(function(){
  'use strict';

  const state={initialized:false,languageBound:false,listClient:'',listQuery:'',selectedGroupId:'',dialog:null};
  const safe=value=>window.PCMSSafe.text(value);
  const textApi=()=>window.PCMSUIText;
  const ui=()=>window.PCMSUIComponents;
  const store=()=>window.PCMSProcessEditStore;
  const groupUI=()=>window.PCMSProcessGroupUI;
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
          <thead><tr><th><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span></th><th><span class="ui-dual-copy"><strong>Tên nhóm</strong><span>群組名稱</span></span></th><th class="ui-table-number-cell"><span class="ui-dual-copy"><strong>Số kích thước</strong><span>尺寸群組數</span></span></th><th class="ui-table-number-cell"><span class="ui-dual-copy"><strong>Số mã</strong><span>款號數</span></span></th><th class="ui-table-center-cell"><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th></tr></thead>
          <tbody id="product-groups-table-body"></tbody>
        </table></div></div>
        <div class="product-groups-empty ui-empty-state" id="product-groups-empty" hidden><i class="ti ti-box-off"></i><span class="ui-dual-copy"><strong>Không tìm thấy nhóm phù hợp</strong><span>找不到符合條件的群組</span></span></div>
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
      const sizeCount=groupUI().groupBySize(members).length;
      return `<tr data-product-group-row="${safe(group.groupId)}" class="${group.groupId===state.selectedGroupId?'is-selected':''}"><td>${safe(groupClient(group))}</td><td><button type="button" class="product-group-name-button" data-product-group-view="${safe(group.groupId)}"><i class="ti ti-box-multiple"></i><b>${safe(group.name||group.groupId)}</b></button></td><td class="ui-table-number-cell"><b>${sizeCount}</b></td><td class="ui-table-number-cell"><b>${members.length}</b></td><td class="ui-table-center-cell"><button type="button" class="ui-button is-compact is-danger product-group-delete-button" data-product-group-delete="${safe(group.groupId)}"><i class="ti ti-trash"></i><span class="ui-dual-copy"><strong>Xóa</strong><span>刪除</span></span></button></td></tr>`;
    }).join('');
    empty.hidden=groups.length>0;
    if(state.selectedGroupId&&!groups.some(group=>group.groupId===state.selectedGroupId)) state.selectedGroupId='';
  }

  function changeList(productsToShow){
    return productsToShow.length
      ? productsToShow.map(item=>`${item.code}（${item.sz||'—'}）`).join('、')
      : '—';
  }

  function groupChangeSummary(group,beforeProducts,afterProducts){
    const body=document.createElement('div');
    body.className='product-group-change-summary';
    const beforeCodes=new Set(beforeProducts.map(item=>normalize(item.code)));
    const afterCodes=new Set(afterProducts.map(item=>normalize(item.code)));
    const added=afterProducts.filter(item=>!beforeCodes.has(normalize(item.code)));
    const removed=beforeProducts.filter(item=>!afterCodes.has(normalize(item.code)));
    const affectedSizes=[...new Set([...added,...removed].map(item=>normalize(item.sz)||'—'))]
      .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
    body.innerHTML=`<div class="ui-notice is-warning"><i class="ti ti-alert-triangle"></i><span class="ui-dual-copy"><strong>Chỉ lưu sau khi xác nhận các thay đổi dưới đây.</strong><span>確認以下變更後才會修改群組。</span></span></div>
      <dl><div><dt><span class="ui-dual-copy"><strong>Tên nhóm</strong><span>群組名稱</span></span></dt><dd>${safe(group.name||group.groupId)}</dd></div><div><dt><span class="ui-dual-copy"><strong>Số mã sau sửa</strong><span>修改後款號數</span></span></dt><dd>${afterProducts.length}</dd></div><div><dt><span class="ui-dual-copy"><strong>Mã thêm mới</strong><span>新增款號</span></span></dt><dd>${safe(changeList(added))}</dd></div><div><dt><span class="ui-dual-copy"><strong>Mã bị xóa</strong><span>移除款號</span></span></dt><dd>${safe(changeList(removed))}</dd></div><div><dt><span class="ui-dual-copy"><strong>Kích thước bị ảnh hưởng</strong><span>受影響尺寸</span></span></dt><dd>${safe(affectedSizes.join('、')||'—')}</dd></div></dl>`;
    return {body,added,removed};
  }

  async function deleteGroup(groupId){
    const group=store().listGroups().find(item=>item.groupId===normalize(groupId));
    if(!group) return;
    const members=groupMembers(group);
    const sizeCount=groupUI().groupBySize(members).length;
    const confirmed=await ui().confirmDialog({
      title:{vi:'Xác nhận xóa vĩnh viễn nhóm',zh:'確認永久刪除群組'},kind:'danger',
      message:{
        vi:`Sẽ xóa sạch nhóm “${group.name||group.groupId}” và ${members.length} chỉ mục thành viên trong Firebase; gồm ${sizeCount} nhóm kích thước. Mã hàng, công đoạn, giây, đơn hàng và sản lượng không bị xóa.`,
        zh:`將從 Firebase（雲端資料庫）完整刪除群組「${group.name||group.groupId}」及 ${members.length} 筆成員索引，共 ${sizeCount} 個尺寸群組；款號、工序、秒數、訂單與產能資料不會刪除。`
      },
      confirmText:{vi:'Tiếp tục xóa',zh:'繼續刪除'},cancelText:{vi:'Hủy',zh:'取消'}
    });
    if(!confirmed) return;
    const finalConfirmed=await ui().confirmDialog({
      title:{vi:'Không thể khôi phục sau khi xóa',zh:'刪除後無法復原'},kind:'danger',
      message:{
        vi:`Xác nhận xóa vĩnh viễn nhóm “${group.name||group.groupId}”? Nhật ký thao tác vẫn được giữ.`,
        zh:`確定永久刪除群組「${group.name||group.groupId}」？不可修改的操作紀錄仍會保留。`
      },
      confirmText:{vi:'Xóa vĩnh viễn',zh:'永久刪除'},cancelText:{vi:'Quay lại',zh:'返回'}
    });
    if(!finalConfirmed) return;
    try{
      await store().deleteGroup(group.groupId);
      renderGroupList();
      setStatus({vi:'Đã xóa vĩnh viễn nhóm và chỉ mục thành viên.',zh:'群組及成員索引已永久刪除。'},'success');
    }catch(error){ setStatus(textApi().errorPair(error),'danger'); }
  }

  async function renameGroup(group,onRenamed){
    const previousName=normalize(group.name||group.groupId);
    const value=await new Promise(resolve=>{
      let settled=false;
      const field=document.createElement('label');
      field.className='ui-dialog-field';
      field.appendChild(textApi().create({vi:'Tên nhóm mới',zh:'新群組名稱'}));
      const input=document.createElement('input');
      input.type='text';input.maxLength=200;input.value=previousName;
      field.appendChild(input);
      ui().openDialog({
        title:{vi:'Đổi tên nhóm',zh:'修改群組名稱'},body:field,keepPrevious:true,
        actions:[
          {text:{vi:'Hủy',zh:'取消'},onClick:()=>{ settled=true;resolve(null); }},
          {text:{vi:'Tiếp tục',zh:'繼續'},kind:'primary',onClick:()=>{
            const name=normalize(input.value);
            const duplicate=store().listGroups().some(item=>item.groupId!==group.groupId
              &&groupClient(item)===groupClient(group)
              &&normalize(item.name||item.groupId).toLocaleLowerCase()===name.toLocaleLowerCase());
            input.setCustomValidity(!name?'Vui lòng nhập tên nhóm. / 請輸入群組名稱。':duplicate?'Tên nhóm của khách hàng này đã tồn tại. / 此客人的群組名稱已存在。':'');
            if(!input.checkValidity()){ input.reportValidity();return false; }
            settled=true;resolve(input.value);return true;
          }}
        ],
        onClose:()=>{ if(!settled) resolve(null); }
      });
      setTimeout(()=>{ input.focus();input.select(); },0);
    });
    if(value===null) return false;
    const nextName=normalize(value);
    if(nextName===previousName){
      await ui().alertDialog({message:{vi:'Tên nhóm không thay đổi.',zh:'群組名稱沒有變更。'},kind:'info',keepPrevious:true});
      return false;
    }
    const confirmed=await ui().confirmDialog({
      title:{vi:'Xác nhận đổi tên nhóm',zh:'確認修改群組名稱'},keepPrevious:true,
      message:{vi:`${previousName} → ${nextName}`,zh:`${previousName} → ${nextName}`},
      confirmText:{vi:'Lưu tên mới',zh:'儲存新名稱'},cancelText:{vi:'Quay lại',zh:'返回'}
    });
    if(!confirmed) return false;
    const result=await store().renameGroup({groupId:group.groupId,name:nextName});
    if(result.changed){
      group.name=result.name;
      renderGroupList();
      onRenamed?.(result.name);
      ui().showToast({kind:'success',text:{vi:'Đã đổi tên nhóm.',zh:'群組名稱已修改。'}});
    }
    return result.changed;
  }

  function groupDetailCandidates(group,members){
    const memberCodes=new Set(members.map(item=>normalize(item.code)));
    return products().filter(item=>{
      const code=normalize(item.code);
      return code&&!memberCodes.has(code)&&clientName(item)===groupClient(group)
        &&window.PCMSProductModel.groupSignature(item)===group.signature;
    }).sort((a,b)=>normalize(a.sz).localeCompare(normalize(b.sz),undefined,{numeric:true,sensitivity:'base'})
      ||normalize(a.code).localeCompare(normalize(b.code),undefined,{numeric:true,sensitivity:'base'}));
  }

  function openAddProducts(group,existingProducts,onAdd){
    const existingCodes=new Set(existingProducts.map(item=>normalize(item.code)));
    const candidates=groupDetailCandidates(group,existingProducts);
    const chosen=new Set();
    const body=document.createElement('div');
    body.className='product-group-add-dialog';
    body.innerHTML=`<label class="product-groups-field is-search"><span class="ui-dual-copy"><strong>Tìm mã hàng</strong><span>搜尋款號</span></span><input type="search" data-group-add-search></label><div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table"><thead><tr><th class="ui-table-center-cell"><span class="ui-dual-copy"><strong>Chọn</strong><span>選取</span></span></th><th><span class="ui-dual-copy"><strong>Mã hàng</strong><span>款號</span></span></th><th><span class="ui-dual-copy"><strong>Tên Trung</strong><span>中文名稱</span></span></th><th><span class="ui-dual-copy"><strong>Tên Việt</strong><span>越文名稱</span></span></th><th><span class="ui-dual-copy"><strong>Kích thước</strong><span>尺寸</span></span></th><th><span class="ui-dual-copy"><strong>Nhóm hiện tại</strong><span>目前群組</span></span></th></tr></thead><tbody data-group-add-body></tbody></table></div></div></div>`;
    const search=body.querySelector('[data-group-add-search]');
    textApi().setLocalizedAttribute(search,'placeholder',{vi:'Nhập mã hàng hoặc tên sản phẩm',zh:'輸入款號或品名'});
    function draw(){
      const query=normalize(search.value).toLocaleLowerCase();
      const rows=candidates.filter(item=>!query||[item.code,item.zh,item.vi,item.sz].map(normalize).join(' ').toLocaleLowerCase().includes(query));
      body.querySelector('[data-group-add-body]').innerHTML=rows.length?rows.map(item=>{
        const other=store().groupForProduct(item.code);
        const disabled=!!other||existingCodes.has(normalize(item.code));
        return `<tr><td class="ui-table-center-cell"><input type="checkbox" data-group-add-code="${safe(item.code)}" ${chosen.has(normalize(item.code))?'checked':''} ${disabled?'disabled':''}></td><td><b>${safe(item.code)}</b></td><td>${safe(item.zh||'—')}</td><td>${safe(item.vi||'—')}</td><td>${safe(item.sz||'—')}</td><td>${other?`<span class="product-group-blocked">${safe(other.name||other.groupId)}</span>`:'<span class="ui-dual-copy"><strong>Chưa có nhóm</strong><span>未加入群組</span></span>'}</td></tr>`;
      }).join(''):'<tr><td colspan="6" class="ui-table-empty"><span class="ui-dual-copy"><strong>Không có mã phù hợp để thêm</strong><span>沒有可新增的符合款號</span></span></td></tr>';
    }
    search.addEventListener('input',draw);
    body.addEventListener('change',event=>{
      const code=normalize(event.target?.dataset?.groupAddCode);
      if(!code) return;
      if(event.target.checked) chosen.add(code); else chosen.delete(code);
    });
    draw();
    ui().openDialog({
      title:{vi:'Thêm mã hàng vào nhóm',zh:'新增款號到群組'},body,size:'large',keepPrevious:true,
      actions:[{text:{vi:'Hủy',zh:'取消'}},{text:{vi:'Thêm mã đã chọn',zh:'加入所選款號'},icon:'ti-plus',kind:'primary',onClick:()=>{
        const added=candidates.filter(item=>chosen.has(normalize(item.code))&&!store().groupForProduct(item.code));
        if(!added.length) return false;
        onAdd(added);
        return true;
      }}]
    });
  }

  function openGroupDetail(groupId){
    const group=store().listGroups().find(item=>item.groupId===normalize(groupId));
    if(!group) return;
    state.selectedGroupId=group.groupId;
    renderGroupList();
    const members=groupMembers(group);
    const body=document.createElement('div');
    body.className='product-group-detail-dialog';
    body.innerHTML=`<div class="product-group-detail-heading"><span><span class="ui-dual-copy"><strong>Khách hàng:</strong><span>客人：</span></span><b>${safe(groupClient(group))}</b></span><button type="button" class="product-group-detail-name" data-product-group-rename><span class="ui-dual-copy"><strong>Tên nhóm:</strong><span>群組名稱：</span></span><b data-product-group-name>${safe(group.name||group.groupId)}</b><i class="ti ti-edit"></i></button><button type="button" class="ui-button is-primary" data-product-group-add><i class="ti ti-plus"></i><span class="ui-dual-copy"><strong>Thêm mã hàng</strong><span>新增款號</span></span></button></div><div data-product-group-detail-selector></div>`;
    const selectorHost=body.querySelector('[data-product-group-detail-selector]');
    let detailProducts=members.slice();
    let selectedCodes=members.map(item=>item.code);
    let activeSize=members[0]?.sz;
    let selector;
    function renderSelector(){
      if(selector){ selectedCodes=selector.selectedCodes();activeSize=selector.activeSize(); }
      selector=groupUI().createMemberSelector({products:detailProducts,currentCode:members[0]?.code,activeSize,compact:true,selectedCodes,selectable:true});
      selectorHost.replaceChildren(selector.element);
    }
    renderSelector();
    body.querySelector('[data-product-group-rename]').addEventListener('click',()=>void renameGroup(group,name=>{
      const host=body.querySelector('[data-product-group-name]');
      if(host) host.textContent=name;
    }));
    body.querySelector('[data-product-group-add]').addEventListener('click',()=>openAddProducts(group,detailProducts,added=>{
      selectedCodes=selector.selectedCodes();
      added.forEach(item=>{ if(!detailProducts.some(row=>normalize(row.code)===normalize(item.code))) detailProducts.push(item);selectedCodes.push(item.code); });
      renderSelector();
    }));
    const dialog=ui().openDialog({
      title:{vi:'Chi tiết nhóm cùng sản phẩm',zh:'同產品群組明細'},body,size:'xlarge',
      actions:[
        {text:{vi:'Hủy',zh:'取消'}},
        {text:{vi:'Xác nhận và lưu',zh:'確認並儲存'},icon:'ti-device-floppy',kind:'primary',onClick:async()=>{
          const selectedProducts=selector.selectedProducts();
          if(selectedProducts.length<2){
            await ui().alertDialog({message:{vi:'Nhóm phải giữ lại ít nhất 2 mã hàng.',zh:'群組至少必須保留2個款號。'},kind:'warning',keepPrevious:true});
            return false;
          }
          const summary=groupChangeSummary(group,members,selectedProducts);
          if(!summary.added.length&&!summary.removed.length) return true;
          const confirmed=await ui().confirmDialog({
            title:{vi:'Xác nhận thay đổi thành viên nhóm',zh:'確認修改群組成員'},body:summary.body,keepPrevious:true,
            confirmText:{vi:'Lưu thay đổi',zh:'儲存修改'},cancelText:{vi:'Quay lại',zh:'返回'},kind:'warning'
          });
          if(!confirmed) return false;
          const result=await store().updateGroupMembers({groupId:group.groupId,memberCodes:selectedProducts.map(item=>item.code)});
          renderGroupList();
          ui().showToast({kind:result.logSaved?'success':'warning',text:result.logSaved
            ?{vi:'Đã cập nhật thành viên nhóm.',zh:'群組成員已更新。'}
            :{vi:'Đã cập nhật nhóm nhưng không lưu được nhật ký.',zh:'群組已更新，但操作紀錄保存失敗。'}});
          return true;
        }}
      ],
      onError:error=>ui().alertDialog({message:textApi().errorPair(error),kind:'danger',keepPrevious:true}),
      onClose:()=>{ if(state.dialog===dialog) state.dialog=null;state.selectedGroupId='';renderGroupList(); }
    });
    state.dialog=dialog;
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
    panel.innerHTML=`<div class="product-groups-wizard-source"><span class="ui-dual-copy"><strong>Mã hàng gốc</strong><span>來源款號</span></span><b>${safe(product.code)}</b><span>${safe(product.client||'—')} · ${safe(product.zh||'—')} · ${safe(product.vi||'—')} · ${safe(product.sz||'—')}</span></div>
      ${candidates.length?`<div class="product-groups-wizard-note ui-bilingual"><span class="ui-text-vi">Hệ thống tự khớp mã cùng sản phẩm. Danh sách đã chia theo kích thước; hãy kiểm tra khách hàng và tên sản phẩm trước khi tạo nhóm.</span><span class="ui-text-zh">系統已自動匹配同產品款號並依尺寸分組；建立前請確認客人及中越文品名。</span></div><div data-product-group-wizard-selector></div><div class="product-groups-wizard-final"><b id="product-groups-create-count"></b><button type="button" class="ui-button is-primary" id="product-groups-create-button"><i class="ti ti-check"></i><span class="ui-dual-copy"><strong>Xác nhận tạo 1 nhóm</strong><span>確認建立1個群組</span></span></button></div>`
      :'<div class="ui-notice"><i class="ti ti-info-circle"></i><span class="ui-dual-copy"><strong>Không tìm thấy mã cùng cấu trúc để lập nhóm</strong><span>找不到結構相同、可建立群組的其他款號</span></span></div>'}`;
    host._groupSelector=null;
    if(candidates.length){
      host._groupSelector=groupUI().createMemberSelector({
        products:[product,...candidates],currentCode:product.code,activeSize:product.sz,
        selectedCodes:[product,...candidates].map(item=>item.code),requiredCodes:[product.code],selectable:true,
        onChange:()=>updateCreateCount(host)
      });
      panel.querySelector('[data-product-group-wizard-selector]').appendChild(host._groupSelector.element);
    }
    updateCreateCount(host);
    setWizardStep(host,3);
  }

  function updateCreateCount(host){
    const count=host.querySelector('#product-groups-create-count');
    if(!count) return;
    const selected=host._groupSelector?.selectedCodes().length||1;
    count.textContent=textApi().visibleText({vi:`Nhóm mới có ${selected} mã`,zh:`新群組共 ${selected} 個款號`});
  }

  function openCreateWizard(prefillCode=''){
    const body=document.createElement('div');
    body.className='product-groups-wizard';
    body.innerHTML=`<div class="product-groups-wizard-steps"><div data-product-groups-step="1"><b>1</b><span class="ui-dual-copy"><strong>Chọn khách hàng</strong><span>選擇客人</span></span></div><div data-product-groups-step="2"><b>2</b><span class="ui-dual-copy"><strong>Chọn mã gốc</strong><span>選擇來源款號</span></span></div><div data-product-groups-step="3"><b>3</b><span class="ui-dual-copy"><strong>Xác nhận thành viên</strong><span>確認群組成員</span></span></div></div><div id="product-groups-wizard-status" hidden></div>
      <section data-product-groups-panel="1" class="product-groups-wizard-panel"><label class="product-groups-field"><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><select id="product-groups-wizard-client"></select></label><button type="button" class="ui-button is-primary" id="product-groups-client-next"><span class="ui-dual-copy"><strong>Tiếp tục chọn mã hàng</strong><span>下一步選擇款號</span></span><i class="ti ti-arrow-right"></i></button></section>
      <section data-product-groups-panel="2" class="product-groups-wizard-panel" hidden><div class="product-groups-wizard-selected-client"></div><label class="product-groups-field is-product"><span class="ui-dual-copy"><strong>Mã hàng gốc</strong><span>來源款號</span></span><input type="search" id="product-groups-wizard-source" list="product-groups-wizard-options" autocomplete="off"><datalist id="product-groups-wizard-options"></datalist></label><div class="product-groups-wizard-actions"><button type="button" class="ui-button" data-product-groups-back="1"><i class="ti ti-arrow-left"></i><span class="ui-dual-copy"><strong>Quay lại</strong><span>上一步</span></span></button><button type="button" class="ui-button is-primary" id="product-groups-source-next"><span class="ui-dual-copy"><strong>Tìm mã cùng sản phẩm</strong><span>尋找同產品款號</span></span><i class="ti ti-arrow-right"></i></button></div></section>
      <section data-product-groups-panel="3" class="product-groups-wizard-panel" hidden></section>`;
    const dialog=ui().openDialog({title:{vi:'Tạo nhóm cùng sản phẩm mới',zh:'建立新的同產品群組'},body,size:'xlarge',actions:[{text:{vi:'Đóng',zh:'關閉'},onClick:()=>true}]});
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
        if(existing){ dialog.close('existing'); openGroupDetail(existing.groupId); setStatus({vi:'Mã này đã có nhóm; đã mở nhóm hiện tại.',zh:'此款號已有群組，已開啟目前群組。'},'info'); return; }
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
    const memberCodes=host._groupSelector?.selectedCodes()||[product.code];
    if(memberCodes.length<2){ setWizardStatus(host,{vi:'Phải chọn ít nhất 2 mã hàng.',zh:'至少必須選擇2個款號。'},'warning'); return; }
    clearWizardStatus(host);
    try{
      const button=host.querySelector('#product-groups-create-button');
      if(button) button.disabled=true;
      const group=await store().createGroup({memberCodes,name:product.vi||product.zh||product.code});
      dialog.close('created');
      renderGroupList();
      setStatus({vi:'Đã tạo nhóm cùng sản phẩm.',zh:'同產品群組已建立。'},'success');
    }catch(error){
      const button=host.querySelector('#product-groups-create-button');
      if(button) button.disabled=false;
      setWizardStatus(host,textApi().errorPair(error),'danger');
    }
  }

  function handleLanguageChange(){
    state.listClient=fillClientSelect(document.getElementById('product-groups-list-client'),state.listClient);
    renderGroupList();
  }

  function bindEvents(){
    document.getElementById('product-groups-new-button')?.addEventListener('click',()=>openCreateWizard());
    document.getElementById('product-groups-list-client')?.addEventListener('change',event=>{ state.listClient=normalize(event.currentTarget.value); renderGroupList(); });
    document.getElementById('product-groups-search-input')?.addEventListener('input',event=>{ state.listQuery=normalize(event.currentTarget.value); renderGroupList(); });
    document.getElementById('product-groups-table-body')?.addEventListener('click',event=>{
      const deleteButton=event.target.closest('[data-product-group-delete]');
      if(deleteButton){ deleteGroup(deleteButton.dataset.productGroupDelete);return; }
      const button=event.target.closest('[data-product-group-view]');
      if(button) openGroupDetail(button.dataset.productGroupView);
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
    textApi().setLocalizedAttribute(document.getElementById('product-groups-search-input'),'placeholder',{vi:'Nhập tên nhóm, mã hàng hoặc kích thước',zh:'輸入群組名稱、款號或尺寸'});
    if(!state.languageBound){ document.addEventListener('pcms:languagechange',handleLanguageChange); state.languageBound=true; }
    state.listClient=fillClientSelect(document.getElementById('product-groups-list-client'),state.listClient);
    renderGroupList();
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
