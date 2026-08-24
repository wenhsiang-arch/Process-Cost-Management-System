// process-group-ui（工序群組介面）：把同產品群組依款號表尺寸分層，供群組、工序修改與快速修改共用。
(function(){
  'use strict';

  const MISSING_SIZE='__pcms_missing_size__';
  const STANDARD_SIZE_ORDER=Object.freeze(['XXS','XS','S','M','L','XL','XXL','XXXL']);
  const STANDARD_SIZE_RANK=new Map(STANDARD_SIZE_ORDER.map((size,index)=>[size,index]));
  const normalize=value=>String(value??'').trim();
  const safe=value=>window.PCMSSafe.text(value);
  const safeAttribute=value=>window.PCMSSafe.attribute(value);

  function productCode(product){ return normalize(product?.code); }
  function sizeKey(product){ return normalize(product?.sz)||MISSING_SIZE; }
  function sizeText(key){ return key===MISSING_SIZE?'—':key; }
  function sizePair(key){
    return key===MISSING_SIZE
      ? {vi:'Chưa đặt kích thước',zh:'未設定尺寸'}
      : {vi:sizeText(key),zh:sizeText(key)};
  }

  // compareSizeKeys（比較尺寸）：數字由小到大，英文常規尺寸依服裝順序，其餘採自然排序，缺失尺寸固定最後。
  function compareSizeKeys(leftKey,rightKey){
    if(leftKey===MISSING_SIZE) return rightKey===MISSING_SIZE?0:1;
    if(rightKey===MISSING_SIZE) return -1;
    const left=normalize(leftKey).normalize('NFKC').toUpperCase().replace(/\s+/g,'');
    const right=normalize(rightKey).normalize('NFKC').toUpperCase().replace(/\s+/g,'');
    const numericPattern=/^(?:\d+(?:\.\d+)?|\.\d+)$/;
    const leftNumber=numericPattern.test(left)?Number(left):null;
    const rightNumber=numericPattern.test(right)?Number(right):null;
    if(leftNumber!==null||rightNumber!==null){
      if(leftNumber===null) return 1;
      if(rightNumber===null) return -1;
      if(leftNumber!==rightNumber) return leftNumber-rightNumber;
      return left.localeCompare(right,undefined,{numeric:true,sensitivity:'base'});
    }
    const leftRank=STANDARD_SIZE_RANK.get(left);
    const rightRank=STANDARD_SIZE_RANK.get(right);
    if(leftRank!==undefined||rightRank!==undefined){
      if(leftRank===undefined) return 1;
      if(rightRank===undefined) return -1;
      return leftRank-rightRank;
    }
    return left.localeCompare(right,undefined,{numeric:true,sensitivity:'base'});
  }

  function operationFor(product,processNo){
    return (Array.isArray(product?.ops)?product.ops:[])
      .find(item=>String(item?.no)===String(processNo)&&item?.active!==false);
  }

  function activeOperations(product){
    return (Array.isArray(product?.ops)?product.ops:[])
      .filter(item=>item?.active!==false)
      .slice()
      .sort((left,right)=>(Number(left?.no)||0)-(Number(right?.no)||0));
  }

  function normalizedDescription(value){
    return normalize(value).normalize('NFKC').toLocaleLowerCase();
  }

  function processProfile(product){
    return activeOperations(product).map(operation=>({
      no:normalize(operation?.no),
      vi:normalizedDescription(operation?.vi),
      sec:Number(operation?.sec)||0
    }));
  }

  function profileDifferences(profile,baseline){
    const countDifferent=profile.length!==baseline.length;
    const currentByNo=new Map(profile.map(item=>[item.no,item]));
    const baselineByNo=new Map(baseline.map(item=>[item.no,item]));
    const sharedNumbers=[...currentByNo.keys()].filter(no=>baselineByNo.has(no));
    let descriptionDifferent=currentByNo.size===baselineByNo.size&&sharedNumbers.length!==currentByNo.size;
    let secondsDifferent=false;
    sharedNumbers.forEach(no=>{
      const current=currentByNo.get(no);
      const expected=baselineByNo.get(no);
      if(current.vi!==expected.vi) descriptionDifferent=true;
      if(current.sec!==expected.sec) secondsDifferent=true;
    });
    return {countDifferent,descriptionDifferent,secondsDifferent};
  }

  function groupBySize(products=[],options={}){
    const order=new Map((options.orderCodes||[]).map((code,index)=>[normalize(code),index]));
    const groups=new Map();
    (Array.isArray(products)?products:[]).forEach(product=>{
      const key=sizeKey(product);
      if(!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(product);
    });
    return [...groups.entries()].map(([key,members])=>({
      key,
      label:sizeText(key),
      labelPair:sizePair(key),
      members:members.slice().sort((a,b)=>{
        const left=order.has(productCode(a))?order.get(productCode(a)):Number.MAX_SAFE_INTEGER;
        const right=order.has(productCode(b))?order.get(productCode(b)):Number.MAX_SAFE_INTEGER;
        return left-right||productCode(a).localeCompare(productCode(b),undefined,{numeric:true,sensitivity:'base'});
      })
    })).sort((a,b)=>compareSizeKeys(a.key,b.key));
  }

  function allSelectionState(codes,selected){
    const checked=codes.filter(code=>selected.has(code)).length;
    return {checked,total:codes.length,all:codes.length>0&&checked===codes.length,partial:checked>0&&checked<codes.length};
  }

  // comparisonContext（同尺寸比較內容）：不同尺寸不得互相污染；沒有明確主要版本時只提醒人工確認。
  function comparisonContext(products=[],options={}){
    const includeProductName=options.includeProductName===true;
    const summaries=new Map();
    const baselines=new Map();
    groupBySize(products).forEach(sizeGroup=>{
      const rows=sizeGroup.members.map(product=>({
        product,
        productName:includeProductName?normalizedDescription(product?.vi):'',
        profile:processProfile(product)
      }));
      const variants=new Map();
      rows.forEach(row=>{
        const key=JSON.stringify({productName:row.productName,profile:row.profile});
        const current=variants.get(key)||{key,productName:row.productName,profile:row.profile,count:0};
        current.count+=1;
        variants.set(key,current);
      });
      const ranked=[...variants.values()].sort((left,right)=>right.count-left.count||left.key.localeCompare(right.key));
      const single=rows.length<=1;
      const ambiguous=!single&&ranked.length>1&&ranked[0].count===ranked[1].count;
      const baseline=ranked[0]||{productName:'',profile:[]};
      baselines.set(sizeGroup.key,ambiguous?null:baseline.profile);
      rows.forEach(row=>{
        const differences=single||ambiguous
          ?{productNameDifferent:false,countDifferent:false,descriptionDifferent:false,secondsDifferent:false}
          :{
            productNameDifferent:includeProductName&&row.productName!==baseline.productName,
            ...profileDifferences(row.profile,baseline.profile)
          };
        const consistent=!differences.productNameDifferent&&!differences.countDifferent&&!differences.descriptionDifferent&&!differences.secondsDifferent;
        summaries.set(row.product.productId,{
          productId:row.product.productId,
          code:productCode(row.product),
          ...differences,
          consistent,
          comparisonState:single?'single':(ambiguous?'ambiguous':(consistent?'consistent':'different'))
        });
      });
    });
    return {summaries,baselines};
  }

  function statusHtml(summary){
    if(summary?.comparisonState==='single') return '<span class="process-group-status is-neutral"><span class="ui-dual-copy"><strong>Không có mã cùng kích thước để so sánh</strong><span>無同尺寸款號可比較</span></span></span>';
    if(summary?.comparisonState==='ambiguous') return '<span class="process-group-status is-neutral"><span class="ui-dual-copy"><strong>Có nhiều phiên bản · cần kiểm tra</strong><span>存在多種版本・請確認</span></span></span>';
    if(!summary||summary.consistent) return '<span class="process-group-status is-consistent"><span class="ui-dual-copy"><strong>Đồng nhất</strong><span>資料一致</span></span></span>';
    const labels=[];
    if(summary.productNameDifferent) labels.push({vi:'Khác tên sản phẩm Việt',zh:'越文品名不同'});
    if(summary.countDifferent) labels.push({vi:'Khác số lượng công đoạn',zh:'工序數量不同'});
    if(summary.descriptionDifferent) labels.push({vi:'Khác mô tả tiếng Việt',zh:'越文描述不同'});
    if(summary.secondsDifferent) labels.push({vi:'Khác giây tiêu chuẩn',zh:'標準秒數不同'});
    return labels.map(item=>`<span class="process-group-status is-warning"><span class="ui-dual-copy"><strong>${safe(item.vi)}</strong><span>${safe(item.zh)}</span></span></span>`).join('');
  }

  // recommendationStatusHtml（群組推薦狀態）：建立群組的所有入口共用相同差異標示與已入組提示。
  function recommendationStatusHtml(recommendation={},assignedGroup=null){
    if(assignedGroup){
      const name=safe(assignedGroup.name||assignedGroup.groupId||'—');
      return `<span class="process-group-status product-group-blocked"><span class="ui-dual-copy"><strong>Đã thuộc nhóm: ${name}</strong><span>已在其他群組：${name}</span></span></span>`;
    }
    if(recommendation.exact) return '<span class="process-group-status is-consistent"><span class="ui-dual-copy"><strong>Khớp cao</strong><span>高度符合</span></span></span>';
    const labels=[];
    if(recommendation.productNameDifferent) labels.push({vi:'Khác tên sản phẩm Việt',zh:'越文品名不同'});
    if(recommendation.countDifferent) labels.push({vi:'Khác số lượng công đoạn',zh:'工序數量不同'});
    if(recommendation.descriptionDifferent) labels.push({vi:'Khác mô tả tiếng Việt',zh:'越文描述不同'});
    if(recommendation.secondsDifferent) labels.push({vi:'Khác giây tiêu chuẩn',zh:'標準秒數不同'});
    return labels.map(item=>`<span class="process-group-status is-warning"><span class="ui-dual-copy"><strong>${safe(item.vi)}</strong><span>${safe(item.zh)}</span></span></span>`).join('');
  }

  // sizeRecommendationStatusHtml（同尺寸推薦狀態）：以每個尺寸自己的多數版本顯示高度符合與差異。
  function sizeRecommendationStatusHtml(summary={},assignedGroup=null){
    if(assignedGroup){
      const name=safe(assignedGroup.name||assignedGroup.groupId||'—');
      return `<span class="process-group-status product-group-blocked"><span class="ui-dual-copy"><strong>Đã thuộc nhóm: ${name}</strong><span>已在其他群組：${name}</span></span></span>`;
    }
    if(summary.comparisonState==='single') return '<span class="process-group-status is-neutral"><span class="ui-dual-copy"><strong>Không có mã cùng kích thước để so sánh</strong><span>無同尺寸款號可比較</span></span></span>';
    if(summary.comparisonState==='ambiguous') return '<span class="process-group-status is-neutral"><span class="ui-dual-copy"><strong>Có nhiều phiên bản · cần kiểm tra</strong><span>存在多種版本・請確認</span></span></span>';
    if(summary.consistent) return '<span class="process-group-status is-consistent"><span class="ui-dual-copy"><strong>Khớp cao</strong><span>高度符合</span></span></span>';
    const labels=[];
    if(summary.productNameDifferent) labels.push({vi:'Khác tên sản phẩm Việt',zh:'越文品名不同'});
    if(summary.countDifferent) labels.push({vi:'Khác số lượng công đoạn',zh:'工序數量不同'});
    if(summary.descriptionDifferent) labels.push({vi:'Khác mô tả tiếng Việt',zh:'越文描述不同'});
    if(summary.secondsDifferent) labels.push({vi:'Khác giây tiêu chuẩn',zh:'標準秒數不同'});
    return labels.map(item=>`<span class="process-group-status is-warning"><span class="ui-dual-copy"><strong>${safe(item.vi)}</strong><span>${safe(item.zh)}</span></span></span>`).join('');
  }

  function processDetailRows(product,baseline){
    const comparable=Array.isArray(baseline);
    const expected=new Map((comparable?baseline:[]).map(item=>[String(item.no),item]));
    const operations=activeOperations(product);
    return operations.map(operation=>{
      const reference=expected.get(String(operation.no));
      const viDifferent=comparable&&(!reference||normalizedDescription(operation.vi)!==normalize(reference.vi));
      const secondsDifferent=comparable&&(!reference||Number(operation.sec)!==Number(reference.sec));
      return `<tr><td>${safe(operation.no||'—')}</td><td class="${viDifferent?'is-different':''}">${safe(operation.vi||'—')}</td><td class="ui-table-number-cell ${secondsDifferent?'is-different':''}">${safe(operation.sec||'—')}</td></tr>`;
    }).join('');
  }

  function createMemberSelector(options={}){
    const products=(Array.isArray(options.products)?options.products:[]).filter(item=>productCode(item));
    const groups=groupBySize(products,{orderCodes:options.orderCodes});
    const productMap=new Map(products.map(item=>[productCode(item),item]));
    const required=new Set((options.requiredCodes||[]).map(normalize).filter(Boolean));
    const disabled=new Set((options.disabledCodes||[]).map(normalize).filter(Boolean));
    const consistency=comparisonContext(products,{includeProductName:options.includeProductName===true});
    const defaultCodes=options.selectConsistentByDefault===true
      ?products.filter(product=>consistency.summaries.get(product?.productId)?.comparisonState==='consistent').map(productCode)
      :products.map(productCode);
    const selected=new Set(
      options.selectedCodes===undefined
        ? defaultCodes.filter(code=>!disabled.has(code))
        : (options.selectedCodes||[]).map(normalize).filter(code=>productMap.has(code)&&!disabled.has(code))
    );
    required.forEach(code=>{ if(productMap.has(code)) selected.add(code); });
    const expanded=new Set((options.expandedCodes||[]).map(normalize).filter(code=>productMap.has(code)));
    const preferredSize=normalize(options.activeSize)
      ||sizeKey(productMap.get(normalize(options.currentCode)))
      ||groups[0]?.key
      ||MISSING_SIZE;
    let activeSize=groups.some(group=>group.key===preferredSize)?preferredSize:(groups[0]?.key||MISSING_SIZE);
    const root=document.createElement('div');
    root.className='process-size-selector';
    root.classList.toggle('is-compact',options.compact===true);
    root.style.setProperty('--process-size-count',String(Math.max(groups.length,1)));

    function notify(){
      if(typeof options.onChange==='function') options.onChange(controller);
    }

    function render(){
      const active=groups.find(group=>group.key===activeSize)||groups[0]||{key:MISSING_SIZE,members:[]};
      const currentCodes=active.members.map(productCode).filter(code=>!disabled.has(code));
      const selection=allSelectionState(currentCodes,selected);
      const showSeconds=options.processNo!==undefined&&options.processNo!==null&&options.processNo!=='';
      const selectable=options.selectable!==false;
      const showAction=typeof options.onEdit==='function';
      const showConsistency=options.consistency===true;
      const expandable=options.expandable===true;
      const columnCount=(selectable?1:0)+6+(showSeconds?1:0)+(showConsistency?1:0)+(showAction?1:0);
      root.innerHTML=`
        <div class="process-size-tabs" role="tablist" aria-label="Kích thước / 尺寸">
          ${groups.map(group=>`<button type="button" role="tab" data-process-size="${safeAttribute(group.key)}" aria-selected="${group.key===active.key?'true':'false'}" class="${group.key===active.key?'is-active':''}"><span>${safe(group.labelPair.vi)}/${group.members.length}</span></button>`).join('')}
        </div>
        <div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table process-size-member-table">
          <thead><tr>
            ${selectable?`<th class="ui-table-center-cell is-select"><button type="button" class="process-size-select-heading${selection.partial?' is-partial':''}" data-process-select-all aria-pressed="${selection.all?'true':'false'}"><span class="ui-dual-copy"><strong>Chọn</strong><span>選取</span></span></button></th>`:''}
            <th class="is-client"><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span></th>
            <th class="is-code"><span class="ui-dual-copy"><strong>Mã hàng</strong><span>款號</span></span></th>
            <th class="is-zh"><span class="ui-dual-copy"><strong>Tên Trung</strong><span>中文名稱</span></span></th>
            <th class="is-vi"><span class="ui-dual-copy"><strong>Tên Việt</strong><span>越文名稱</span></span></th>
            <th class="is-size"><span class="ui-dual-copy"><strong>Kích thước</strong><span>尺寸</span></span></th>
            <th class="ui-table-number-cell is-process-count"><span class="ui-dual-copy"><strong>Tổng số công đoạn</strong><span>總工序數量</span></span></th>
            ${showSeconds?'<th class="ui-table-number-cell is-seconds"><span class="ui-dual-copy"><strong>Giây hiện tại</strong><span>目前秒數</span></span></th>':''}
            ${showConsistency?'<th class="is-status"><span class="ui-dual-copy"><strong>Trạng thái</strong><span>差異狀態</span></span></th>':''}
            ${showAction?'<th class="ui-table-center-cell is-action"><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th>':''}
          </tr></thead>
          <tbody>${active.members.map(product=>{
            const code=productCode(product);
            const operation=operationFor(product,options.processNo);
            const summary=consistency.summaries.get(product.productId);
            const processCount=activeOperations(product).length;
            const unavailable=disabled.has(code);
            const customStatus=typeof options.statusRenderer==='function'?options.statusRenderer(product,summary):'';
            return `<tr class="${code===normalize(options.currentCode)?'is-current':''}">
              ${selectable?`<td class="ui-table-center-cell"><input type="checkbox" data-process-member="${safeAttribute(code)}" ${selected.has(code)?'checked':''} ${required.has(code)||unavailable?'disabled':''} aria-label="${safeAttribute(code)}"></td>`:''}
              <td title="${safeAttribute(product.client||'—')}">${safe(product.client||'—')}</td><td title="${safeAttribute(code)}">${expandable?`<button type="button" class="process-member-code-button${expanded.has(code)?' is-open':''}" data-process-member-expand="${safeAttribute(code)}" aria-expanded="${expanded.has(code)?'true':'false'}"><i class="ti ti-chevron-right" aria-hidden="true"></i><b>${safe(code)}</b></button>`:`<b>${safe(code)}</b>`}</td><td title="${safeAttribute(product.zh||'—')}">${safe(product.zh||'—')}</td><td title="${safeAttribute(product.vi||'—')}">${safe(product.vi||'—')}</td><td title="${safeAttribute(product.sz||'—')}">${safe(product.sz||'—')}</td><td class="ui-table-number-cell"><b>${safe(processCount)}</b></td>
              ${showSeconds?`<td class="ui-table-number-cell"><b>${operation&&Number(operation.sec)>0?safe(Math.round(Number(operation.sec))):'—'}</b></td>`:''}
              ${showConsistency?`<td class="process-group-status-cell">${customStatus||statusHtml(summary)}</td>`:''}
              ${showAction?`<td class="ui-table-center-cell"><button type="button" class="ui-button is-compact" data-process-member-edit="${safeAttribute(code)}"><i class="ti ti-edit"></i><span class="ui-dual-copy"><strong>Sửa công đoạn</strong><span>修改工序</span></span></button></td>`:''}
            </tr>${expandable&&expanded.has(code)?`<tr class="process-member-detail-row"><td colspan="${columnCount}"><div class="process-member-detail"><table class="ui-table"><thead><tr><th><span class="ui-dual-copy"><strong>Số công đoạn</strong><span>工序號</span></span></th><th><span class="ui-dual-copy"><strong>Mô tả tiếng Việt</strong><span>越文工序描述</span></span></th><th><span class="ui-dual-copy"><strong>Giây tiêu chuẩn</strong><span>標準秒數</span></span></th></tr></thead><tbody>${processDetailRows(product,consistency.baselines.get(active.key))}</tbody></table></div></td></tr>`:''}`;
          }).join('')}</tbody>
        </table></div></div>`;
      const selectAll=root.querySelector('[data-process-select-all]');
      if(selectAll){
        const copy=selection.all?{vi:'Bỏ chọn tất cả',zh:'取消全選'}:{vi:'Chọn tất cả',zh:'全選'};
        selectAll.setAttribute('aria-label',`${copy.vi} / ${copy.zh}`);
        selectAll.setAttribute('title',`${copy.vi} / ${copy.zh}`);
      }
    }

    root.addEventListener('click',event=>{
      const sizeButton=event.target.closest('[data-process-size]');
      if(sizeButton){ activeSize=sizeButton.dataset.processSize; render(); notify(); return; }
      const allButton=event.target.closest('[data-process-select-all]');
      if(allButton){
        const active=groups.find(group=>group.key===activeSize);
        const codes=(active?.members||[]).map(productCode).filter(code=>!disabled.has(code));
        const selection=allSelectionState(codes,selected);
        codes.forEach(code=>{ if(selection.all&&!required.has(code)) selected.delete(code); else selected.add(code); });
        required.forEach(code=>selected.add(code));
        render();notify();return;
      }
      const editButton=event.target.closest('[data-process-member-edit]');
      if(editButton&&typeof options.onEdit==='function') options.onEdit(editButton.dataset.processMemberEdit,controller);
      const expandButton=event.target.closest('[data-process-member-expand]');
      if(expandButton){
        const code=normalize(expandButton.dataset.processMemberExpand);
        if(expanded.has(code)) expanded.delete(code);else expanded.add(code);
        render();notify();
      }
    });
    root.addEventListener('change',event=>{
      const code=normalize(event.target?.dataset?.processMember);
      if(!code) return;
      if(disabled.has(code)) selected.delete(code);
      else if(event.target.checked||required.has(code)) selected.add(code); else selected.delete(code);
      required.forEach(item=>selected.add(item));
      render();notify();
    });

    const controller={
      element:root,
      groups:()=>groups.map(group=>({...group,members:group.members.slice()})),
      activeSize:()=>activeSize,
      selectedCodes:()=>[...selected],
      selectedProducts:()=>[...selected].map(code=>productMap.get(code)).filter(Boolean),
      expandedCodes:()=>[...expanded],
      setSelectedCodes(codes){ selected.clear();(codes||[]).map(normalize).filter(code=>productMap.has(code)&&!disabled.has(code)).forEach(code=>selected.add(code));required.forEach(code=>selected.add(code));render();notify(); },
      render
    };
    render();
    return controller;
  }

  window.PCMSProcessGroupUI=Object.freeze({
    missingSizeKey:MISSING_SIZE,
    sizeKey,sizePair,compareSizeKeys,groupBySize,operationFor,activeOperations,comparisonContext,processDetailRows,recommendationStatusHtml,sizeRecommendationStatusHtml,createMemberSelector
  });
})();
