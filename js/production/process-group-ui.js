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
      .find(item=>String(item?.no)===String(processNo));
  }

  function groupBySize(products=[]){
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
      members:members.slice().sort((a,b)=>productCode(a).localeCompare(productCode(b),undefined,{numeric:true,sensitivity:'base'}))
    })).sort((a,b)=>compareSizeKeys(a.key,b.key));
  }

  function allSelectionState(codes,selected){
    const checked=codes.filter(code=>selected.has(code)).length;
    return {checked,total:codes.length,all:codes.length>0&&checked===codes.length,partial:checked>0&&checked<codes.length};
  }

  function consistencyDetails(products){
    const summaries=new Map((window.PCMSProductModel?.compareGroupConsistency?.(products)||[]).map(item=>[item.productId,item]));
    const profiles=(products||[]).map(product=>({product,profile:window.PCMSProductModel?.groupProcessProfile?.(product)||[]}));
    const variants=new Map();
    profiles.forEach(item=>{
      const key=JSON.stringify(item.profile);
      const current=variants.get(key)||{profile:item.profile,count:0};current.count+=1;variants.set(key,current);
    });
    const ranked=[...variants.values()].sort((left,right)=>right.count-left.count);
    const baseline=ranked[0]?.profile||[];
    return {summaries,baseline};
  }

  function statusHtml(summary){
    if(!summary||summary.consistent) return '<span class="process-group-status is-consistent"><span class="ui-dual-copy"><strong>Đồng nhất</strong><span>資料一致</span></span></span>';
    const labels=[];
    if(summary.countDifferent) labels.push({vi:'Khác số lượng công đoạn',zh:'工序數量不同'});
    if(summary.descriptionDifferent) labels.push({vi:'Khác mô tả tiếng Việt',zh:'越文描述不同'});
    if(summary.secondsDifferent) labels.push({vi:'Khác giây tiêu chuẩn',zh:'標準秒數不同'});
    return labels.map(item=>`<span class="process-group-status is-warning"><span class="ui-dual-copy"><strong>${safe(item.vi)}</strong><span>${safe(item.zh)}</span></span></span>`).join('');
  }

  function processDetailRows(product,baseline){
    const expected=new Map((baseline||[]).map(item=>[String(item.no),item]));
    const operations=(Array.isArray(product?.ops)?product.ops:[]).slice().sort((left,right)=>Number(left.no)-Number(right.no));
    return operations.map(operation=>{
      const reference=expected.get(String(operation.no));
      const viDifferent=!reference||normalize(operation.vi).normalize('NFKC').toLocaleLowerCase()!==normalize(reference.vi);
      const secondsDifferent=!reference||Number(operation.sec)!==Number(reference.sec);
      return `<tr><td>${safe(operation.no||'—')}</td><td class="${viDifferent?'is-different':''}">${safe(operation.vi||'—')}</td><td class="ui-table-number-cell ${secondsDifferent?'is-different':''}">${safe(operation.sec||'—')}</td></tr>`;
    }).join('');
  }

  function createMemberSelector(options={}){
    const products=(Array.isArray(options.products)?options.products:[]).filter(item=>productCode(item));
    const groups=groupBySize(products);
    const productMap=new Map(products.map(item=>[productCode(item),item]));
    const required=new Set((options.requiredCodes||[]).map(normalize).filter(Boolean));
    const selected=new Set(
      options.selectedCodes===undefined
        ? products.map(productCode)
        : (options.selectedCodes||[]).map(normalize).filter(code=>productMap.has(code))
    );
    required.forEach(code=>{ if(productMap.has(code)) selected.add(code); });
    const expanded=new Set((options.expandedCodes||[]).map(normalize).filter(code=>productMap.has(code)));
    const consistency=consistencyDetails(products);
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
      const currentCodes=active.members.map(productCode);
      const selection=allSelectionState(currentCodes,selected);
      const showSeconds=options.processNo!==undefined&&options.processNo!==null&&options.processNo!=='';
      const selectable=options.selectable!==false;
      const showAction=typeof options.onEdit==='function';
      const showConsistency=options.consistency===true;
      const expandable=options.expandable===true;
      const columnCount=(selectable?1:0)+(expandable?1:0)+5+(showSeconds?1:0)+(showConsistency?1:0)+(showAction?1:0);
      root.innerHTML=`
        <div class="process-size-tabs" role="tablist" aria-label="Kích thước / 尺寸">
          ${groups.map(group=>`<button type="button" role="tab" data-process-size="${safeAttribute(group.key)}" aria-selected="${group.key===active.key?'true':'false'}" class="${group.key===active.key?'is-active':''}"><span>${safe(group.labelPair.vi)}/${group.members.length}</span></button>`).join('')}
        </div>
        <div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table process-size-member-table">
          <thead><tr>
            ${expandable?'<th class="ui-table-center-cell is-expand"><span class="ui-dual-copy"><strong>Chi tiết</strong><span>明細</span></span></th>':''}
            ${selectable?`<th class="ui-table-center-cell is-select"><button type="button" class="process-size-select-heading${selection.partial?' is-partial':''}" data-process-select-all aria-pressed="${selection.all?'true':'false'}"><span class="ui-dual-copy"><strong>Chọn</strong><span>選取</span></span></button></th>`:''}
            <th class="is-client"><span class="ui-dual-copy"><strong>Khách hàng</strong><span>客人</span></span></th>
            <th class="is-code"><span class="ui-dual-copy"><strong>Mã hàng</strong><span>款號</span></span></th>
            <th class="is-zh"><span class="ui-dual-copy"><strong>Tên Trung</strong><span>中文名稱</span></span></th>
            <th class="is-vi"><span class="ui-dual-copy"><strong>Tên Việt</strong><span>越文名稱</span></span></th>
            <th class="is-size"><span class="ui-dual-copy"><strong>Kích thước</strong><span>尺寸</span></span></th>
            ${showSeconds?'<th class="ui-table-number-cell is-seconds"><span class="ui-dual-copy"><strong>Giây hiện tại</strong><span>目前秒數</span></span></th>':''}
            ${showConsistency?'<th class="is-status"><span class="ui-dual-copy"><strong>Trạng thái</strong><span>差異狀態</span></span></th>':''}
            ${showAction?'<th class="ui-table-center-cell is-action"><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th>':''}
          </tr></thead>
          <tbody>${active.members.map(product=>{
            const code=productCode(product);
            const operation=operationFor(product,options.processNo);
            const summary=consistency.summaries.get(product.productId);
            return `<tr class="${code===normalize(options.currentCode)?'is-current':''}">
              ${expandable?`<td class="ui-table-center-cell"><button type="button" class="process-member-expand${expanded.has(code)?' is-open':''}" data-process-member-expand="${safeAttribute(code)}" aria-expanded="${expanded.has(code)?'true':'false'}" title="Mở chi tiết công đoạn / 展開工序明細"><i class="ti ti-chevron-right"></i></button></td>`:''}
              ${selectable?`<td class="ui-table-center-cell"><input type="checkbox" data-process-member="${safeAttribute(code)}" ${selected.has(code)?'checked':''} ${required.has(code)?'disabled':''} aria-label="${safeAttribute(code)}"></td>`:''}
              <td title="${safeAttribute(product.client||'—')}">${safe(product.client||'—')}</td><td title="${safeAttribute(code)}"><b>${safe(code)}</b></td><td title="${safeAttribute(product.zh||'—')}">${safe(product.zh||'—')}</td><td title="${safeAttribute(product.vi||'—')}">${safe(product.vi||'—')}</td><td title="${safeAttribute(product.sz||'—')}">${safe(product.sz||'—')}</td>
              ${showSeconds?`<td class="ui-table-number-cell"><b>${operation&&Number(operation.sec)>0?safe(Math.round(Number(operation.sec))):'—'}</b></td>`:''}
              ${showConsistency?`<td class="process-group-status-cell">${statusHtml(summary)}</td>`:''}
              ${showAction?`<td class="ui-table-center-cell"><button type="button" class="ui-button is-compact" data-process-member-edit="${safeAttribute(code)}"><i class="ti ti-edit"></i><span class="ui-dual-copy"><strong>Sửa công đoạn</strong><span>修改工序</span></span></button></td>`:''}
            </tr>${expandable&&expanded.has(code)?`<tr class="process-member-detail-row"><td colspan="${columnCount}"><div class="process-member-detail"><table class="ui-table"><thead><tr><th><span class="ui-dual-copy"><strong>Số công đoạn</strong><span>工序號</span></span></th><th><span class="ui-dual-copy"><strong>Mô tả tiếng Việt</strong><span>越文工序描述</span></span></th><th><span class="ui-dual-copy"><strong>Giây tiêu chuẩn</strong><span>標準秒數</span></span></th></tr></thead><tbody>${processDetailRows(product,consistency.baseline)}</tbody></table></div></td></tr>`:''}`;
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
        const codes=(active?.members||[]).map(productCode);
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
      if(event.target.checked||required.has(code)) selected.add(code); else selected.delete(code);
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
      setSelectedCodes(codes){ selected.clear();(codes||[]).map(normalize).filter(code=>productMap.has(code)).forEach(code=>selected.add(code));required.forEach(code=>selected.add(code));render();notify(); },
      render
    };
    render();
    return controller;
  }

  window.PCMSProcessGroupUI=Object.freeze({
    missingSizeKey:MISSING_SIZE,
    sizeKey,sizePair,compareSizeKeys,groupBySize,operationFor,createMemberSelector
  });
})();
