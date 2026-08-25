// product-quick-edit（款號快速修改介面）：依尺寸選取群組成員，顯示相關明細並共用預覽、進度與結果流程。
(function(){
  'use strict';

  const FIELD_CONFIG=Object.freeze({
    client:{scope:'product',vi:'Khách hàng',zh:'款號客戶',type:'text',maxLength:200},
    zh:{scope:'product',vi:'Tên tiếng Trung',zh:'中文品名',type:'text',maxLength:200},
    vi:{scope:'product',vi:'Tên tiếng Việt',zh:'越文品名',type:'text',maxLength:200},
    sz:{scope:'product',vi:'Kích thước',zh:'尺寸',type:'text',maxLength:200},
    processNo:{scope:'process',vi:'Số công đoạn',zh:'工序號',type:'number',min:1,max:99},
    processCategory:{scope:'process',vi:'Phân loại',zh:'分類',type:'select'},
    processNameZh:{scope:'process',vi:'Tên công đoạn Trung',zh:'工序中文',type:'text',maxLength:200},
    processNameVi:{scope:'process',vi:'Tên công đoạn Việt',zh:'工序越文',type:'text',maxLength:200},
    processSeconds:{scope:'process',vi:'Giây tiêu chuẩn',zh:'標準秒數',type:'number',min:1,max:86400}
  });

  function text(value){ return String(value??'').trim(); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function safe(value){ return window.PCMSSafe?.text?.(value)??String(value??''); }
  function safeAttribute(value){ return window.PCMSSafe?.attribute?.(value)??safe(value); }
  function dual(vi,zh){ return `<span class="ui-dual-copy"><strong>${safe(vi)}</strong><span>${safe(zh)}</span></span>`; }
  function model(){ return window.PCMSProductModel; }
  function service(){ return window.PCMSProductMasterService; }
  function ui(){ return window.PCMSUIComponents; }
  function groupUI(){ return window.PCMSProcessGroupUI; }
  function groupRuntime(){ return window.PCMSProductGroupRuntime; }
  function allowed(field=''){
    if(!FIELD_CONFIG[field]) return false;
    const role=window.cu?.role;
    return role==='admin'||(
      window.permissionSettings?.[role]?.productsMain===true
      &&window.permissionSettings?.[role]?.productionProcessEdit===true
    );
  }
  function productId(value){ return model().fixedId(value,'product'); }
  function processId(value){ return model().fixedId(value,'process'); }

  // runOpenPreparation（開啟修改前載入）：立即顯示進度，讓所有修改入口共用相同等待回饋。
  async function runOpenPreparation(task,options={}){
    const progress=ui().progressDialog({
      title:options.title||{vi:'Đang mở chỉnh sửa mã hàng',zh:'正在開啟款號修改'},
      text:options.text||{vi:'Đang chuẩn bị dữ liệu mã hàng...',zh:'正在準備款號資料…'},
      detail:options.detail||{vi:'Vui lòng chờ, không cần bấm lại.',zh:'請稍候，不需要重複點擊。'},
      value:5,indeterminate:true,keepPrevious:options.keepPrevious===true
    });
    try{
      await new Promise(resolve=>setTimeout(resolve,0));
      const result=await task(progress);
      progress.complete({vi:'Đã chuẩn bị xong.',zh:'資料準備完成。'});
      return result;
    }catch(error){
      progress.fail({vi:'Không thể mở màn hình chỉnh sửa.',zh:'無法開啟修改畫面。'},resultError(error));
      throw error;
    }finally{
      progress.close('program');
    }
  }

  // prepareGroupContext（準備群組內容）：所有快速修改入口共用；有群組只顯示目前群組，無群組才即時建立推薦清單。
  async function prepareGroupContext(input={},progress=null){
    if(input.groupContextPrepared===true) return input;
    if(input.group){
      input.candidatePlan=null;
      input.groupContextPrepared=true;
      return input;
    }
    if(typeof groupRuntime()?.prepareQuickEdit!=='function') return input;
    progress?.update?.({value:65,indeterminate:true,text:{vi:'Đang kiểm tra nhóm và mã đề xuất...',zh:'正在確認群組與推薦款號…'},detail:{vi:'Mã đã có nhóm chỉ hiện nhóm hiện tại; mã chưa có nhóm mới tìm đề xuất.',zh:'已有群組只顯示目前群組；沒有群組才尋找推薦。'}});
    const context=await groupRuntime().prepareQuickEdit(input.sourceProductId);
    input.group=context.group||null;
    input.candidatePlan=context.group?null:context.plan;
    input.groupContextPrepared=true;
    return input;
  }

  function fieldValue(product,operation,field){
    const values={
      client:product.client,zh:product.zh,vi:product.vi,sz:product.sz,
      processNo:operation?.no,processCategory:operation?.category,
      processNameZh:operation?.zh,processNameVi:operation?.vi,processSeconds:operation?.sec
    };
    return values[field]??'';
  }

  function consistencyMap(products,options={}){
    const shared=groupUI()?.comparisonContext?.(products,options);
    if(shared?.summaries) return shared.summaries;
    return new Map((model().compareGroupConsistency?.(products)||[]).map(item=>[item.productId,item]));
  }

  // buildTargets（建立群組修改目標）：先用相同工序號匹配；缺少時可由使用者明確指定，不因描述或秒數不同拒絕。
  function buildTargets({field,sourceProductId,sourceProcessId='',products=[],group=null,candidatePlan=null}={}){
    const config=FIELD_CONFIG[field];
    if(!config) throw new Error('Trường sửa nhanh không hợp lệ. / 快速修改欄位不正確。');
    const rows=Array.isArray(products)?products:[];
    const source=rows.find(product=>productId(product?.productId)===productId(sourceProductId));
    if(!source) throw new Error('Không tìm thấy mã hàng cần sửa. / 找不到要修改的款號。');
    const candidateMode=!group&&candidatePlan?.source;
    const orderedIds=group?.memberProductIds?.length
      ?group.memberProductIds.map(productId)
      :candidateMode
        ?[source.productId,...(candidatePlan.candidates||[]).map(product=>productId(product?.productId))]
        :[source.productId];
    const rowById=new Map(rows.map(product=>[productId(product?.productId),product]).filter(([id])=>id));
    const members=[...new Set(orderedIds.filter(Boolean))].map(id=>rowById.get(id)).filter(Boolean);
    if(!members.some(product=>productId(product?.productId)===productId(source.productId))) members.unshift(source);
    const statuses=consistencyMap(members,{
      includeProductName:Boolean(candidateMode),
      referenceProductId:source.productId,
      referenceCode:source.code
    });
    const disabledCodes=new Set((candidatePlan?.disabledCodes||[]).map(text));
    const sourceOperation=config.scope==='process'
      ?(source.ops||[]).find(operation=>processId(operation?.processId)===processId(sourceProcessId))
      :null;
    if(config.scope==='process'&&!sourceOperation) throw new Error('Không tìm thấy công đoạn cần sửa. / 找不到要修改的工序。');
    return members.map(product=>{
      let operation=null;
      if(config.scope==='process'){
        operation=product.productId===source.productId
          ?sourceOperation
          :(product.ops||[]).find(item=>String(item.no)===String(sourceOperation.no)&&item.active!==false);
      }
      const isSource=productId(product.productId)===productId(source.productId);
      const matched=config.scope==='product'||!!operation;
      const assignedGroup=candidateMode&&!isSource?groupRuntime()?.groupForProduct?.(product.productId||product.code):null;
      const consistency=statuses.get(productId(product.productId))||null;
      const recommended=consistency?.comparisonState==='consistent';
      return {
        product,operation,matched,isSource,required:isSource,disabled:Boolean(assignedGroup)||disabledCodes.has(text(product.code)),assignedGroup,
        recommendation:candidateMode&&!isSource?model().groupRecommendation(source,product):null,
        selected:matched&&(isSource||recommended),
        value:fieldValue(product,operation,field),consistency
      };
    });
  }

  function commonInput(config,sourceValue){
    if(config.type==='select') return '<select data-common-value><option value="BL">BL</option><option value="SX">SX</option><option value="QC">QC</option><option value="DG">DG</option></select>';
    const limits=config.type==='number'?` min="${config.min}" max="${config.max}" step="1" inputmode="numeric"`:'';
    const maximum=config.maxLength?` maxlength="${config.maxLength}"`:'';
    return `<input data-common-value type="${config.type}"${limits}${maximum} value="${safeAttribute(sourceValue)}">`;
  }

  function summaryPanel(config,input,sourceTarget){
    const process=config.scope==='process';
    const operation=sourceTarget.operation;
    const groupName=text(input.group?.name||input.group?.groupId);
    const identityLabel=process?{vi:'Số công đoạn',zh:'工序號'}:{vi:'Mã hàng',zh:'款號'};
    const identityValue=process?(operation?.no||'—'):(sourceTarget.product.code||'—');
    const nameLabel=process?{vi:'Tên công đoạn Việt',zh:'工序越文名稱'}:{vi:'Tên sản phẩm Việt',zh:'越文品名'};
    const nameValue=process?(operation?.vi||'—'):(sourceTarget.product.vi||'—');
    const currentValue=displayValue(fieldValue(sourceTarget.product,operation,config.key));
    const nextControl=config.perProduct
      ?`<div class="product-quick-summary-per-row">${dual('Nhập riêng trong bảng dưới','於下表逐款號輸入')}</div>`
      :commonInput(config,currentValue==='—'?'':currentValue);
    return `<section class="product-quick-summary">
      <div><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span><b>${safe(sourceTarget.product.client||'—')}</b></div>
      <div><span class="ui-dual-copy"><strong>${safe(identityLabel.vi)}</strong><span>${safe(identityLabel.zh)}</span></span><b>${safe(identityValue)}</b></div>
      <div class="is-name"><span class="ui-dual-copy"><strong>${safe(nameLabel.vi)}</strong><span>${safe(nameLabel.zh)}</span></span><b title="${safeAttribute(nameValue)}">${safe(nameValue)}</b></div>
      <div><span class="ui-dual-copy"><strong>Hiện tại: ${safe(config.vi)}</strong><span>目前${safe(config.zh)}</span></span><b>${safe(currentValue)}</b></div>
      <span class="product-quick-direction" aria-hidden="true"><i class="ti ti-arrow-right"></i></span>
      <label class="is-next"><span class="ui-dual-copy"><strong>Sau sửa: ${safe(config.vi)}</strong><span>修改後${safe(config.zh)}</span></span>${nextControl}</label>
      <div class="is-group"><span class="ui-dual-copy"><strong>${groupName?'Nhóm hiện tại':'Trạng thái nhóm'}</strong><span>${groupName?'目前群組':'群組狀態'}</span></span>${groupName?`<b title="${safeAttribute(groupName)}">${safe(groupName)}</b>`:dual('Chưa có nhóm','未有群組')}</div>
    </section>`;
  }

  function processOptions(product,selected=''){
    return `<option value="">Chọn công đoạn / 選擇工序</option>${(product.ops||[]).filter(operation=>operation.active!==false).map(operation=>
      `<option value="${safeAttribute(operation.processId)}"${operation.processId===selected?' selected':''}>${safe(operation.no)} · ${safe(operation.vi||operation.zh)}</option>`).join('')}`;
  }

  function capacity(seconds){
    const value=Number(seconds)||0;
    const workSeconds=Number(window.S?.ws)||3000;
    return window.PCMSProductionEfficiencyCore?.hourlyCapacity?.(value,workSeconds)??(value>0?Math.round(workSeconds/value):0);
  }

  function statusTags(target){
    if(target.isSource) return `<span class="product-quick-status-tag is-neutral">${dual('Mã đang sửa','目前款號')}</span>`;
    if(target.assignedGroup) return groupUI().sizeRecommendationStatusHtml(target.consistency||{},target.assignedGroup);
    if(!target.operation&&target.matched===false) return dual('Không có công đoạn tương ứng','無對應工序');
    if(target.recommendation) return groupUI().sizeRecommendationStatusHtml(target.consistency||{},null);
    if(target.consistency?.comparisonState==='single') return `<span class="product-quick-status-tag is-neutral">${dual('Không có mã cùng kích thước để so sánh','無同尺寸款號可比較')}</span>`;
    if(target.consistency?.comparisonState==='ambiguous') return `<span class="product-quick-status-tag is-neutral">${dual('Có nhiều phiên bản · cần kiểm tra','存在多種版本・請確認')}</span>`;
    const tags=[];
    if(target.consistency?.productNameDifferent) tags.push({vi:'Khác tên sản phẩm Việt',zh:'越文品名不同'});
    if(target.consistency?.countDifferent) tags.push({vi:'Khác số lượng công đoạn',zh:'工序數量不同'});
    if(target.consistency?.descriptionDifferent) tags.push({vi:'Khác mô tả tiếng Việt',zh:'越文描述不同'});
    if(target.consistency?.secondsDifferent) tags.push({vi:'Khác giây tiêu chuẩn',zh:'標準秒數不同'});
    if(!tags.length) tags.push({vi:'Đồng nhất',zh:'資料一致'});
    return tags.map(item=>`<span class="product-quick-status-tag${tags.length===1&&item.zh==='資料一致'?' is-consistent':' is-warning'}">${dual(item.vi,item.zh)}</span>`).join('');
  }

  function displayValue(value){ return value===''||value===null||value===undefined?'—':String(value); }

  function afterValue(config,target,commonValue,row){
    if(!target.matched&&!row?.dataset?.processId) return '—';
    return config.perProduct?text(row?.querySelector('[data-row-value]')?.value):text(commonValue);
  }

  function tableHead(config){
    const process=config.scope==='process';
    const cells=[
      {value:dual('Chọn','選擇'),className:'ui-table-center-cell is-select'},
      {value:dual('Mã hàng','款號'),className:'is-code'},
      {value:dual('Tên sản phẩm Việt','越文品名'),className:'is-product-vi'},
      {value:dual('Kích thước','尺寸'),className:'ui-table-center-cell is-size'},
      {value:dual('Tổng số công đoạn','總工序數量'),className:'ui-table-center-cell is-process-count'}
    ];
    if(process){
      cells.push(
        {value:dual('Số công đoạn','工序號'),className:'ui-table-center-cell is-process-no'},
        {value:dual('Mô tả tiếng Việt','越文工序描述'),className:'is-process-description'}
      );
      if(!['processSeconds','processNo'].includes(config.key)) cells.push({value:dual('Giây hiện tại','目前秒數'),className:'ui-table-number-cell is-current-seconds'});
    }
    cells.push(
      {value:dual(`Hiện tại: ${config.vi}`,`目前${config.zh}`),className:config.type==='number'?'ui-table-number-cell':''},
      {value:dual(`Sau sửa: ${config.vi}`,`修改後${config.zh}`),className:config.type==='number'?'ui-table-number-cell':''}
    );
    if(config.key==='processSeconds') cells.push({value:dual('SL/giờ sau sửa','修改後每小時產能'),className:'ui-table-number-cell'});
    cells.push({value:dual('Trạng thái','差異狀態'),className:'is-status'});
    return cells.map(cell=>`<th${cell.className?` class="${cell.className}"`:''}>${cell.value}</th>`).join('');
  }

  function tableColumnCount(config){
    let count=5;
    if(config.scope==='process') count+=2+(!['processSeconds','processNo'].includes(config.key)?1:0);
    count+=2+(config.key==='processSeconds'?1:0)+1;
    return count;
  }

  function renderRows(host,targets,config,activeSize,selected,commonValue,rowValues,expanded,comparison){
    host.replaceChildren();
    const visibleTargets=targets.filter(target=>groupUI().sizeKey(target.product)===activeSize).slice().sort((left,right)=>{
      const rank=target=>target.disabled?2:(target.isSource||target.consistency?.comparisonState==='consistent'?0:1);
      return rank(left)-rank(right);
    });
    visibleTargets.forEach(target=>{
      const actualIndex=targets.indexOf(target);
      const row=document.createElement('tr');
      row.dataset.index=String(actualIndex);
      row.dataset.productId=target.product.productId;
      row.dataset.processId=target.operation?.processId||'';
      const operation=target.operation;
      const processCells=config.scope==='process'?[
        {value:operation?safe(operation.no):`<select data-process-select${target.disabled?' disabled':''}>${processOptions(target.product)}</select>`,className:'ui-table-center-cell is-process-no'},
        {value:safe(operation?.vi||'—'),className:'is-process-description'},
        ...(!['processSeconds','processNo'].includes(config.key)?[{value:safe(displayValue(operation?.sec)),className:'ui-table-number-cell is-current-seconds'}]:[])
      ]:[];
      const current=displayValue(fieldValue(target.product,operation,config.key));
      const pending=rowValues?.get(target.product.productId)??(current==='—'?'':current);
      const perProductInput=config.perProduct
        ?`<input type="text" maxlength="${config.maxLength||200}" data-row-value value="${safeAttribute(pending)}">`
        :safe(current);
      const next=config.perProduct?pending:afterValue(config,target,commonValue,row);
      row.innerHTML=`<td class="ui-table-center-cell"><input type="checkbox" data-select${selected.has(target.product.productId)?' checked':''}${target.required||target.disabled||!target.matched?' disabled':''}></td>
        <td><button type="button" class="product-quick-code-button${expanded.has(target.product.productId)?' is-open':''}" data-product-quick-expand="${safeAttribute(target.product.productId)}" aria-expanded="${expanded.has(target.product.productId)?'true':'false'}"><i class="ti ti-chevron-right" aria-hidden="true"></i><b>${safe(target.product.code)}</b></button></td><td class="is-product-vi" title="${safeAttribute(target.product.vi||'—')}">${safe(target.product.vi||'—')}</td><td class="ui-table-center-cell">${safe(target.product.sz||'—')}</td><td class="ui-table-center-cell is-process-count"><b>${safe(groupUI().activeOperations(target.product).length)}</b></td>
        ${processCells.map(cell=>`<td class="${cell.className}">${cell.value}</td>`).join('')}
        <td class="${config.type==='number'?'ui-table-number-cell':''}">${perProductInput}</td><td class="${config.type==='number'?'ui-table-number-cell':''}" data-after>${safe(next)}</td>
        ${config.key==='processSeconds'?`<td class="ui-table-number-cell" data-capacity>${next!=='—'?safe(capacity(next)):'—'}</td>`:''}
        <td class="product-quick-status" data-status>${statusTags(target)}</td>`;
      host.appendChild(row);
      if(expanded.has(target.product.productId)){
        const detail=document.createElement('tr');
        detail.className='process-member-detail-row product-quick-detail-row';
        detail.dataset.detailFor=target.product.productId;
        const baseline=comparison?.baselines?.get(groupUI().sizeKey(target.product));
        detail.innerHTML=`<td colspan="${tableColumnCount(config)}"><div class="process-member-detail"><table class="ui-table"><thead><tr><th>${dual('Số công đoạn','工序號')}</th><th>${dual('Mô tả tiếng Việt','越文工序描述')}</th><th>${dual('Giây tiêu chuẩn','標準秒數')}</th></tr></thead><tbody>${groupUI().processDetailRows(target.product,baseline)}</tbody></table></div></td>`;
        host.appendChild(detail);
      }
    });
  }

  const PRODUCT_CHANGE_FIELDS=new Set(['code','client','zh','vi','sz','operationCount']);

  function productContext(product={}){
    return `<div class="product-change-product"><b>${safe(product.code||'—')}</b><span>${safe(product.client||'—')}</span><span>${safe(product.zh||'—')}</span><span>${safe(product.vi||'—')}</span></div>`;
  }

  function operationContext(difference,request){
    if(PRODUCT_CHANGE_FIELDS.has(difference.field)) return {no:'—',vi:'—',seconds:'—'};
    const before=difference.operationBefore||null;
    const after=difference.operationAfter||null;
    const byId=product=>product?.ops?.find(operation=>processId(operation?.processId)===processId(difference.processId));
    const byNo=product=>product?.ops?.find(operation=>String(operation?.no)===String(difference.operationNo));
    const fallbackAfter=byId(request.draft)||byNo(request.draft);
    const fallbackBefore=byId(request.base)||byNo(request.base);
    const operation=after||before||fallbackAfter||fallbackBefore||{};
    return {
      no:after?.no||before?.no||operation.no||difference.operationNo||'—',
      vi:after?.vi||before?.vi||operation.vi||'—',
      seconds:before?.sec||after?.sec||operation.sec||'—'
    };
  }

  function impactCopy(difference){
    if(difference.field==='sec'){
      return {
        vi:`SL/giờ ${capacity(difference.before)} → ${capacity(difference.after)}`,
        zh:`每小時產能 ${capacity(difference.before)} → ${capacity(difference.after)}`
      };
    }
    if(difference.field==='operationCount') return {vi:'Cập nhật tổng số công đoạn',zh:'更新總工序數量'};
    if(difference.field==='no'){
      if(displayValue(difference.before)==='—') return {vi:'Thêm công đoạn mới',zh:'新增工序'};
      if(displayValue(difference.after)==='—') return {vi:'Xóa khỏi danh sách công đoạn hiện tại',zh:'自目前工序清單移除'};
      return {vi:'Cập nhật số và thứ tự công đoạn',zh:'更新工序號與順序'};
    }
    if(['client','zh','vi','sz'].includes(difference.field)) return {vi:'Dữ liệu chưa khóa tự dùng giá trị mới',zh:'未鎖定資料自動使用新值'};
    return {vi:'Dữ liệu công đoạn chưa khóa tự cập nhật',zh:'未鎖定工序資料自動更新'};
  }

  function workflowTable(){
    return `<div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table product-change-workflow-table"><thead><tr>
      <th class="is-product">${dual('Thông tin mã hàng','款號資料')}</th><th class="ui-table-center-cell is-size">${dual('Kích thước','尺寸')}</th>
      <th class="ui-table-center-cell is-process-no">${dual('Số công đoạn','工序號')}</th><th class="is-process-name">${dual('Tên công đoạn Việt','越文工序名稱')}</th><th class="ui-table-number-cell is-seconds">${dual('Giây hiện tại','目前秒數')}</th>
      <th class="is-field">${dual('Mục sửa','修改項目')}</th><th class="is-value">${dual('Trước sửa','修改前')}</th><th class="is-value">${dual('Sau sửa','修改後')}</th>
      <th class="is-impact">${dual('Ảnh hưởng','影響結果')}</th><th class="is-result">${dual('Kết quả','結果')}</th><th class="is-detail">${dual('Chi tiết','說明')}</th>
    </tr></thead><tbody></tbody></table></div></div>`;
  }

  function changeRow(request,difference,{status,detail,className=''}={}){
    const product=request.draft||request.base||{};
    const operation=operationContext(difference,request);
    const impact=impactCopy(difference);
    const row=document.createElement('tr');
    if(className) row.className=className;
    row.innerHTML=`<td>${productContext(product)}</td><td class="ui-table-center-cell">${safe(product.sz||'—')}</td>
      <td class="ui-table-center-cell">${safe(operation.no)}</td><td>${safe(operation.vi)}</td><td class="ui-table-number-cell">${safe(operation.seconds)}</td>
      <td>${dual(difference.label?.vi||difference.field,difference.label?.zh||difference.field)}</td><td class="product-change-before">${safe(displayValue(difference.before))}</td><td class="product-change-after">${safe(displayValue(difference.after))}</td>
      <td>${dual(impact.vi,impact.zh)}</td><td>${dual(status.vi,status.zh)}</td><td>${dual(detail.vi,detail.zh)}</td>`;
    return row;
  }

  function skippedRow(item){
    const product=item.product||{};
    const row=document.createElement('tr');
    row.className='is-warning';
    row.innerHTML=`<td>${productContext(product)}</td><td class="ui-table-center-cell">${safe(product.sz||'—')}</td><td class="ui-table-center-cell">—</td><td>—</td><td class="ui-table-number-cell">—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${dual('Không xử lý','未處理')}</td><td>${dual(item.reason?.vi||'Không có công đoạn tương ứng',item.reason?.zh||'無對應工序')}</td>`;
    return row;
  }

  function createPreviewBody(requests,skipped=[]){
    const body=document.createElement('div');
    body.className='product-change-preview';
    body.innerHTML=`<div class="ui-notice is-info"><i class="ti ti-eye-check"></i>${dual('Kiểm tra từng mục trước và sau khi sửa rồi mới xác nhận.','請逐項確認修改前後內容，再執行儲存。')}</div>${workflowTable()}`;
    const rows=body.querySelector('tbody');
    requests.forEach(request=>{
      const warning=(request.warnings||[])[0];
      const detail=warning
        ?{vi:`Có nhắc nhở: ${warning.vi}`,zh:`有提醒：${warning.zh}`}
        :{vi:'Sẽ lưu sau khi người dùng xác nhận.',zh:'使用者確認後才會儲存。'};
      model().compareProducts(request.base,request.draft).forEach(difference=>rows.appendChild(changeRow(request,difference,{
        status:{vi:'Chờ thực hiện',zh:'待執行'},detail,className:warning?'is-warning':''
      })));
    });
    skipped.forEach(item=>rows.appendChild(skippedRow(item)));
    return body;
  }

  function resultError(error){
    const pair=window.PCMSUIText?.errorPair?.(error)||window.PCMSUIText?.fromError?.(error);
    return pair||{vi:text(error?.message||error)||'Không rõ nguyên nhân',zh:text(error?.message||error)||'原因不明'};
  }

  function recommendationStatus(source,candidate,summary){
    const assigned=groupRuntime().groupForProduct(candidate.productId||candidate.code);
    if(productId(source.productId)===productId(candidate.productId)) return `<span class="product-quick-status-tag is-neutral">${dual('Mã đang sửa','目前款號')}</span>`;
    return groupUI().sizeRecommendationStatusHtml(summary||{},assigned);
  }

  // openGroupCreation（未分組款號建立群組）：群組寫入獨立完成，不與後續款號修改綁成同一筆資料操作。
  async function openGroupCreation(product,options={}){
    const plan=options.plan||await runOpenPreparation(async progress=>{
      progress.update({value:25,indeterminate:true,text:{vi:'Đang tải danh sách nhóm hiện tại...',zh:'正在載入目前群組清單…'},detail:{vi:'Kiểm tra để tránh một mã thuộc hai nhóm.',zh:'正在確認款號不會重複加入群組。'}});
      await groupRuntime().load();
      progress.update({value:85,indeterminate:true,text:{vi:'Đang phân tích mã hàng đề xuất...',zh:'正在分析推薦款號…'},detail:{vi:'Mã khớp cao sẽ được chọn sẵn.',zh:'高度符合者將預設勾選。'}});
      return groupRuntime().candidatePlan(product.productId||product.code);
    },{
      title:{vi:'Đang chuẩn bị nhóm mã hàng',zh:'正在準備款號群組'},
      keepPrevious:options.keepPrevious===true
    });
    const existing=groupRuntime().groupForProduct(product.productId||product.code);
    if(existing) return existing;
    if(!plan.candidates.length){
      await ui().alertDialog({
        message:{vi:'Không tìm thấy mã cùng khách hàng và cùng tên sản phẩm Việt để tạo nhóm. Hãy quay lại và chọn Bỏ qua nếu vẫn muốn tiếp tục sửa.',zh:'找不到同一客人且越文品名相同的其他候選款號。若仍要繼續修改，請返回後選擇略過。'},
        kind:'warning',keepPrevious:true
      });
      return null;
    }
    return new Promise(resolve=>{
      let settled=false;
      const body=document.createElement('div');
      body.className='product-group-detail-dialog product-quick-group-create';
      const notice=ui().createNotice({
        kind:'info',
        text:{vi:'Mã khớp cao được chọn sẵn. Mã có khác biệt không được chọn sẵn nhưng vẫn có thể tự chọn.',zh:'高度符合者預設勾選；有差異者預設不勾選，但仍可由使用者自行選擇。'}
      });
      const selector=groupUI().createMemberSelector({
        products:[product,...plan.candidates],currentCode:product.code,activeSize:product.sz,
        orderCodes:[product.code,...plan.candidates.map(candidate=>candidate.code)],
        selectedCodes:options.selectedCodes?.length?options.selectedCodes:undefined,
        requiredCodes:[product.code],disabledCodes:plan.disabledCodes,
        selectable:true,consistency:true,expandable:true,includeProductName:true,selectConsistentByDefault:true,
        statusRenderer:(item,summary)=>recommendationStatus(product,item,summary)
      });
      body.append(notice,selector.element);
      ui().openDialog({
        title:{vi:'Thiết lập nhóm mã hàng',zh:'設定款號群組'},body,size:'xlarge',keepPrevious:true,
        actions:[
          {text:{vi:'Quay lại',zh:'返回'},onClick:()=>{ settled=true;resolve(null); }},
          {text:{vi:'Xác nhận tạo nhóm',zh:'確認建立群組'},icon:'ti-box-multiple',kind:'primary',onClick:async()=>{
            const memberCodes=selector.selectedCodes();
            if(memberCodes.length<2){
              await ui().alertDialog({message:{vi:'Nhóm mới phải có ít nhất 2 mã hàng.',zh:'新群組至少需要2個款號。'},kind:'warning',keepPrevious:true});
              return false;
            }
            const created=await groupRuntime().createGroup({memberCodes,name:product.vi||product.zh||product.code});
            settled=true;resolve(created);
            ui().showToast({kind:'success',text:{vi:'Đã tạo nhóm mã hàng.',zh:'款號群組已建立。'}});
            return true;
          }}
        ],
        onError:error=>ui().alertDialog({message:resultError(error),kind:'danger',keepPrevious:true}),
        onClose:()=>{ if(!settled) resolve(null); }
      });
    });
  }

  async function confirmGroupBeforeCommit(input,sourceProduct,selectedCodes=[]){
    const existing=input.group||groupRuntime()?.groupForProduct?.(sourceProduct.productId||sourceProduct.code);
    if(existing) return true;
    const setup=await ui().confirmDialog({
      title:{vi:'Mã hàng chưa có nhóm',zh:'款號尚未建立群組'},
      body:{vi:'Mã hàng này chưa có nhóm. Bạn có muốn tạo nhóm trước khi sửa không? Chọn Bỏ qua để tiếp tục sửa mà không tạo nhóm.',zh:'此款號尚未建立群組，是否先建立群組？選擇略過將不建立群組並繼續修改。'},
      keepPrevious:true,
      confirmText:{vi:'Tạo nhóm',zh:'建立群組'},cancelText:{vi:'Bỏ qua và tiếp tục',zh:'略過並繼續'}
    });
    if(!setup) return true;
    const created=await openGroupCreation(sourceProduct,{keepPrevious:true,plan:input.candidatePlan,selectedCodes});
    if(!created) return false;
    input.group=created;
    return true;
  }

  function createResultBody(result,skipped=[]){
    const body=document.createElement('div');
    body.className='product-change-result';
    const success=result.successes.length;
    const failure=result.failures.length;
    body.innerHTML=`<div class="product-change-result-summary ${failure?'is-warning':'is-success'}">${dual(
      failure?`Hoàn tất ${success} mã, ${failure} mã thất bại.`:`Đã hoàn tất ${success} mã.`,
      failure?`已完成 ${success} 個款號，${failure} 個失敗。`:`已完成 ${success} 個款號。`
    )}</div>${workflowTable()}`;
    const rows=body.querySelector('tbody');
    result.results.forEach(item=>{
      const error=item.ok?null:resultError(item.error);
      const warning=(item.warnings||[])[0];
      const request=item.request||{base:item.product||{},draft:item.product||{}};
      const differences=model().compareProducts(request.base,request.draft);
      const status=item.ok?{vi:'Hoàn tất',zh:'完成'}:{vi:'Thất bại',zh:'失敗'};
      const detail=item.ok
        ?(warning?{vi:`Đã lưu; ${warning.vi}`,zh:`已儲存；${warning.zh}`}:{vi:'Đã lưu đầy đủ.',zh:'已完整儲存。'})
        :error;
      if(differences.length) differences.forEach(difference=>rows.appendChild(changeRow(request,difference,{status,detail,className:item.ok?'':'is-warning'})));
      else rows.appendChild(skippedRow({product:item.product||request.base,reason:detail}));
    });
    skipped.forEach(item=>rows.appendChild(skippedRow(item)));
    return body;
  }

  // saveWithWorkflow（統一修改流程）：預覽、批次進度與完成結果皆沿用共用彈窗。
  async function saveWithWorkflow(requestsInput=[],options={}){
    const requests=(Array.isArray(requestsInput)?requestsInput:[]).filter(request=>model().compareProducts(request.base,request.draft).length>0);
    const skipped=Array.isArray(options.skipped)?options.skipped:[];
    if(!requests.length){
      await ui().alertDialog({message:{vi:'Không có nội dung có thể sửa.',zh:'沒有可執行的修改內容。'},kind:'warning',keepPrevious:true});
      return {cancelled:true,results:[],successes:[],failures:[],skipped};
    }
    const confirmed=await ui().confirmDialog({
      title:options.previewTitle||{vi:'Xem trước thay đổi',zh:'預覽修改內容'},
      body:createPreviewBody(requests,skipped),size:'xlarge',keepPrevious:true,
      confirmText:{vi:'Xác nhận thực hiện',zh:'確認執行'},cancelText:{vi:'Quay lại chỉnh sửa',zh:'返回修改'}
    });
    if(!confirmed) return {cancelled:true,results:[],successes:[],failures:[],skipped};
    if(typeof options.beforeCommit==='function'&&await options.beforeCommit()===false){
      return {cancelled:true,results:[],successes:[],failures:[],skipped};
    }
    const progress=ui().progressDialog({title:{vi:'Đang cập nhật mã hàng',zh:'正在更新款號'},value:0,keepPrevious:options.keepPrevious===true,
      text:{vi:'Đang chuẩn bị...',zh:'正在準備…'},detail:{vi:`0/${requests.length} mã`,zh:`0/${requests.length} 個款號`}});
    let result;
    try{
      result=await service().saveManyDrafts(requests,{
        onProgress:item=>{
          const completed=Math.max(0,Number(item.completed)||0);
          progress.update({value:requests.length?completed/requests.length*100:100,
            text:{vi:'Đang lưu dữ liệu đã chọn...',zh:'正在儲存所選資料…'},
            detail:{vi:`${completed}/${requests.length} mã`,zh:`${completed}/${requests.length} 個款號`}});
          options.onProgress?.(item);
        }
      });
      const requestById=new Map(requests.map(request=>[request.base.productId,request]));
      result.results=result.results.map(item=>{
        const request=requestById.get(item.productId);
        return {...item,request:clone(request),warnings:clone(request?.warnings||[])};
      });
      result.successes=result.results.filter(item=>item.ok);
      result.failures=result.results.filter(item=>!item.ok);
      progress.complete({vi:'Đã xử lý xong.',zh:'處理完成。'},{vi:`Hoàn tất ${result.successes.length} mã.`,zh:`完成 ${result.successes.length} 個款號。`});
    }catch(error){
      progress.fail({vi:'Không thể hoàn tất thao tác.',zh:'無法完成操作。'},resultError(error));
      throw error;
    }finally{
      progress.close('program');
    }
    await ui().alertDialog({title:{vi:'Kết quả cập nhật',zh:'修改結果'},body:createResultBody(result,skipped),
      kind:result.failures.length?'warning':'success',size:'xlarge',keepPrevious:options.keepPrevious===true});
    await options.onSaved?.(result);
    return {...result,skipped,cancelled:false};
  }

  async function open(input={}){
    if(!allowed(input.field)){
      await ui().alertDialog({message:{vi:'Bạn không có quyền sửa mã hàng.',zh:'你沒有修改款號的權限。'},kind:'warning'});
      return false;
    }
    const config={...FIELD_CONFIG[input.field],key:input.field};
    if(!config.scope) throw new Error('Trường sửa nhanh không hợp lệ. / 快速修改欄位不正確。');
    if(input.groupContextPrepared!==true) await prepareGroupContext(input);
    const products=Array.isArray(input.products)?input.products:window.D||[];
    const targets=buildTargets({...input,products});
    const sourceTarget=targets.find(target=>target.product.productId===input.sourceProductId)||targets[0];
    const selected=new Set(targets.filter(target=>target.selected&&!target.disabled).map(target=>target.product.productId));
    const expanded=new Set();
    const rowValues=new Map(targets.map(target=>[target.product.productId,String(target.value??'')]));
    const sizes=groupUI().groupBySize(targets.map(target=>target.product),{
      orderCodes:targets.map(target=>target.product.code)
    });
    let comparison=groupUI().comparisonContext(targets.map(target=>target.product),{
      includeProductName:Boolean(input.candidatePlan),referenceProductId:sourceTarget.product.productId,referenceCode:sourceTarget.product.code
    });
    let activeSize=groupUI().sizeKey(sourceTarget.product);
    const commonValues=new Map();
    const targetsInSize=size=>targets.filter(target=>groupUI().sizeKey(target.product)===size);
    const representativeTarget=size=>{
      const rows=targetsInSize(size);
      return rows.find(target=>target.isSource)
        ||rows.find(target=>target.consistency?.comparisonState==='consistent'&&!target.disabled&&target.matched)
        ||rows.find(target=>!target.disabled&&target.matched)
        ||rows[0];
    };
    sizes.forEach(group=>{
      const target=representativeTarget(group.key);
      commonValues.set(group.key,String(target?.value??''));
    });
    const body=document.createElement('div');
    body.className='product-quick-edit';
    const selectionNotice=input.group
      ?dual('Chỉ hiển thị nhóm hiện tại và chọn sẵn các mã có công đoạn tương ứng; khác biệt chỉ để nhắc.','只顯示目前群組並預選有對應工序的款號；差異只作提醒。')
      :input.candidatePlan?.candidates?.length
        ?dual('Mã khớp cao được chọn sẵn; mã khác biệt không chọn sẵn nhưng vẫn có thể tự chọn. Mã thuộc nhóm khác chỉ để đối chiếu.','高度符合者預設勾選；有差異者預設不勾選，但仍可自行選擇。已在其他群組者只供比對。')
        :dual('Mã này chưa có nhóm và chưa tìm thấy mã cùng khách hàng, cùng tên sản phẩm Việt.','此款號尚未有群組，且找不到同客人、同越文品名的其他款號。');
    body.innerHTML=`<div data-summary-panel></div>
      <div class="ui-notice is-info"><i class="ti ti-checkbox"></i>${selectionNotice}</div>
      <div class="process-size-tabs product-quick-size-tabs" data-size-tabs></div>
      <div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table product-quick-table"><thead><tr data-table-head></tr></thead><tbody data-target-body></tbody></table></div></div>`;
    const rowsHost=body.querySelector('[data-target-body]');
    body.querySelector('.product-quick-table').dataset.scope=config.scope;
    body.querySelector('[data-table-head]').innerHTML=tableHead(config);

    function commonControl(){ return body.querySelector('[data-common-value]'); }
    function captureCommonValue(){
      const common=commonControl();
      if(common) commonValues.set(activeSize,common.value);
    }

    function render(){
      const activeTarget=representativeTarget(activeSize)||sourceTarget;
      body.querySelector('[data-summary-panel]').innerHTML=summaryPanel(config,input,activeTarget);
      const common=commonControl();
      if(common){
        common.value=commonValues.get(activeSize)??String(activeTarget?.value??'');
      }
      const tabs=body.querySelector('[data-size-tabs]');
      tabs.innerHTML=sizes.map(group=>`<button type="button" role="tab" data-size="${safeAttribute(group.key)}" aria-selected="${group.key===activeSize?'true':'false'}" class="${group.key===activeSize?'is-active':''}"><span>${safe(group.labelPair.vi)}/${group.members.length}</span></button>`).join('');
      renderRows(rowsHost,targets,config,activeSize,selected,common?.value,rowValues,expanded,comparison);
    }
    function refreshAfterValues(){
      const common=commonControl();
      rowsHost.querySelectorAll('tr[data-index]').forEach(row=>{
        const target=targets[Number(row.dataset.index)];
        const next=afterValue(config,target,common?.value,row);
        row.querySelector('[data-after]').textContent=next;
        const capacityHost=row.querySelector('[data-capacity]');
        if(capacityHost) capacityHost.textContent=next==='—'?'—':String(capacity(next));
      });
    }
    body.addEventListener('click',event=>{
      const tab=event.target.closest('[data-size]');
      if(tab){ captureCommonValue();activeSize=tab.dataset.size;render(); }
      const expandButton=event.target.closest('[data-product-quick-expand]');
      if(expandButton){
        const id=expandButton.dataset.productQuickExpand;
        if(expanded.has(id)) expanded.delete(id);else expanded.add(id);
        render();
      }
    });
    body.addEventListener('change',event=>{
      const checkbox=event.target.closest('[data-select]');
      if(checkbox){
        const row=checkbox.closest('tr');
        if(checkbox.checked) selected.add(row.dataset.productId);else selected.delete(row.dataset.productId);
      }
      const select=event.target.closest('[data-process-select]');
      if(select){
        const row=select.closest('tr');
        const target=targets[Number(row.dataset.index)];
        const operation=(target.product.ops||[]).find(item=>item.processId===select.value)||null;
        target.operation=operation;target.matched=!!operation;target.value=fieldValue(target.product,operation,config.key);
        row.dataset.processId=operation?.processId||'';
        if(operation) selected.add(target.product.productId);else selected.delete(target.product.productId);
        render();
      }
      refreshAfterValues();
    });
    body.addEventListener('input',event=>{
      const rowInput=event.target.closest('[data-row-value]');
      if(rowInput) rowValues.set(rowInput.closest('tr').dataset.productId,rowInput.value);
      if(event.target.closest('[data-common-value]')) commonValues.set(activeSize,event.target.value);
      refreshAfterValues();
    });
    render();

    ui().openDialog({
      title:{vi:`Sửa nhanh: ${config.vi}`,zh:`快速修改：${config.zh}`},body,size:'xlarge',
      keepPrevious:input.keepPrevious===true,
      actions:[
        {text:{vi:'Hủy',zh:'取消'}},
        {text:{vi:'Xem trước mục đã chọn',zh:'預覽已選項目'},icon:'ti-eye-check',kind:'primary',onClick:async()=>{
          captureCommonValue();
          const requests=[];
          const skipped=[];
          const activeTargets=targetsInSize(activeSize);
          activeTargets.forEach(target=>{
            if(config.scope==='process'&&!target.operation){
              const hasAvailable=(target.product.ops||[]).some(operation=>operation.active!==false);
              skipped.push({product:target.product,reason:hasAvailable
                ?{vi:'Chưa chọn công đoạn tương ứng.',zh:'尚未選擇對應工序。'}
                :{vi:'Không có công đoạn có thể chọn.',zh:'沒有可選擇的工序。'}});
              return;
            }
            if(!selected.has(target.product.productId)) return;
            const value=config.perProduct?(rowValues.get(target.product.productId)??target.value):(commonValues.get(activeSize)??'');
            requests.push({base:clone(target.product),draft:service().draftWithField(target.product,{field:config.key,value,processId:target.operation?.processId||''}),action:'productGroupQuickEdit'});
          });
          const selectedCodesForGroup=targets.filter(target=>selected.has(target.product.productId)&&!target.disabled)
            .map(target=>target.product.code);
          const result=await saveWithWorkflow(requests,{
            skipped,onSaved:input.onSaved,keepPrevious:true,
            beforeCommit:()=>confirmGroupBeforeCommit(input,sourceTarget.product,selectedCodesForGroup)
          });
          if(result.cancelled) return false;
          (result.successes||[]).forEach(item=>{
            const target=targets.find(row=>productId(row.product.productId)===productId(item.productId));
            if(!target||!item.product) return;
            const currentProcessId=target.operation?.processId||'';
            target.product=item.product;
            target.operation=config.scope==='process'
              ?(item.product.ops||[]).find(operation=>processId(operation.processId)===processId(currentProcessId))||null
              :null;
            target.matched=config.scope==='product'||Boolean(target.operation);
            target.value=fieldValue(target.product,target.operation,config.key);
            rowValues.set(target.product.productId,String(target.value??''));
          });
          comparison=groupUI().comparisonContext(targets.map(target=>target.product),{
            includeProductName:Boolean(input.candidatePlan),referenceProductId:sourceTarget.product.productId,referenceCode:sourceTarget.product.code
          });
          targets.forEach(target=>{ target.consistency=comparison.summaries.get(target.product.productId)||null; });
          if(sizes.length<=1) return true;
          const continueOtherSize=await ui().confirmDialog({
            title:{vi:'Tiếp tục sửa kích thước khác?',zh:'是否繼續修改其他尺寸'},
            body:{vi:'Bạn có thể quay lại cùng màn hình để chọn kích thước khác hoặc sửa lại kích thước vừa xử lý.',zh:'你可以回到同一個修改面板，選擇其他尺寸，或重新訂正剛處理的尺寸。'},
            confirmText:{vi:'Tiếp tục sửa',zh:'繼續修改'},cancelText:{vi:'Kết thúc',zh:'結束'},keepPrevious:true
          });
          if(continueOtherSize){ render();return false; }
          return true;
        }}
      ],
      onError:error=>ui().alertDialog({message:resultError(error),kind:'danger',keepPrevious:true}),
      onClose:()=>input.onClose?.()
    });
    return true;
  }

  function createTrigger(input={}){
    const button=document.createElement('button');
    button.type='button';button.className='product-quick-edit-trigger';button.disabled=!allowed(input.field);
    button.textContent=String(input.value??'—');
    let opening=false;
    if(!button.disabled) button.addEventListener('click',async event=>{
      event.stopPropagation();
      if(opening) return;
      opening=true;button.disabled=true;
      try{
        const ready=await runOpenPreparation(async progress=>{
          progress.update({value:45,indeterminate:true,text:{vi:'Đang kiểm tra dữ liệu chỉnh sửa...',zh:'正在確認修改資料…'},detail:{vi:'Vui lòng chờ, không cần bấm lại.',zh:'請稍候，不需要重複點擊。'}});
          if(typeof input.beforeOpen==='function'&&await input.beforeOpen()===false) return false;
          await prepareGroupContext(input,progress);
          return true;
        },{keepPrevious:input.keepPrevious===true});
        if(ready!==false) await open(input);
      }catch(error){
        await ui().alertDialog({message:resultError(error),kind:'danger',keepPrevious:input.keepPrevious===true});
      }finally{
        opening=false;button.disabled=!allowed(input.field);
      }
    });
    return button;
  }

  window.PCMSProductQuickEdit=Object.freeze({FIELD_CONFIG,buildTargets,open,createTrigger,allowed,saveWithWorkflow,createPreviewBody,createResultBody,runOpenPreparation,prepareGroupContext,openGroupCreation});
})();
