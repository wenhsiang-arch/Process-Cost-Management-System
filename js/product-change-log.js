// product-change-log（款號修改流水帳頁）：顯示一層操作摘要與一層可分批展開的完整明細。
(function(){
  'use strict';

  const PAGE_SIZE=50;
  const DETAIL_PAGE_SIZE=100;
  const naturalCollator=new Intl.Collator('vi',{numeric:true,sensitivity:'base'}); // naturalCollator（款號與工序自然排序器）
  const state={
    rows:[],searchRows:[],cursor:null,done:false,promise:null,searchTimer:null,searchToken:0,
    openBatchIds:new Set(),details:new Map(),initialized:false
  };

  function text(value){ return String(value??'').trim(); }
  function productCodeKey(value){ return text(value).normalize('NFKC').toLocaleUpperCase(); }
  function searchKey(value){
    return text(value).normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[Đđ]/g,'d').toLocaleLowerCase().replace(/\s+/g,' ');
  }
  function smartScore(query,value,mode='text'){
    const score=window.PCMSUISearchDropdown?.scoreText?.(query,value,mode);
    if(Number.isFinite(score)) return score;
    const keyword=searchKey(query),candidate=searchKey(value);
    return keyword&&candidate.includes(keyword)?200+candidate.indexOf(keyword):Number.POSITIVE_INFINITY;
  }
  function rankBySearch(items,query,fields){
    const keyword=text(query);
    if(!keyword) return Array.from(items||[]);
    return Array.from(items||[]).map((item,index)=>{
      let score=Number.POSITIVE_INFINITY;
      fields.forEach(field=>{
        const resolved=field.value(item);
        const values=Array.isArray(resolved)?resolved:[resolved];
        values.forEach(value=>{ score=Math.min(score,smartScore(keyword,value,field.mode||'text')+(field.weight||0)); });
      });
      return {item,index,score};
    }).filter(entry=>Number.isFinite(entry.score))
      .sort((left,right)=>left.score-right.score||left.index-right.index)
      .map(entry=>entry.item);
  }
  function escape(value){ return text(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
  function node(id){ return document.getElementById(id); }
  function pair(vi,zh){ return `<span class="ui-dual-copy"><strong>${escape(vi)}</strong><span>${escape(zh)}</span></span>`; }
  function naturalCompare(left,right){ return naturalCollator.compare(text(left),text(right)); }
  function batchKey(row){ return text(row?.batchId||row?.id); }
  function mergedRows(){ return [...new Map([...state.rows,...state.searchRows].map(item=>[batchKey(item),item])).values()]; }
  function findBatch(batchId){ return mergedRows().find(item=>batchKey(item)===batchId)||null; }
  function modeLabel(mode){
    return mode==='import'?pair('Nhập Excel','Excel 匯入'):mode==='group'?pair('Sửa theo nhóm','群組修改'):pair('Sửa một mã','單款修改');
  }
  function statusLabel(status){
    if(status==='success') return `<span class="product-change-status is-success">${pair('Thành công','成功')}</span>`;
    if(status==='partial') return `<span class="product-change-status is-partial">${pair('Hoàn tất một phần','部分完成')}</span>`;
    if(status==='failed') return `<span class="product-change-status is-failed">${pair('Thất bại','失敗')}</span>`;
    return `<span class="product-change-status is-running">${pair('Đang xử lý','處理中')}</span>`;
  }
  function time(value){
    const date=new Date(Number(value)||0);
    return Number.isNaN(date.getTime())?'—':date.toLocaleString('zh-TW',{hour12:false});
  }
  function summary(row){
    const success=Number(row.successCount)||0,failure=Number(row.failureCount)||0,unprocessed=Number(row.unprocessedCount)||0;
    if(row.status==='running') return `${Number(row.targetCount)||0}`;
    return `${success} / ${failure} / ${unprocessed}`;
  }
  function visibleRows(){
    const keyword=text(node('product-change-search')?.value);
    const mode=text(node('product-change-mode')?.value),status=text(node('product-change-status')?.value);
    const rows=mergedRows().filter(row=>(!mode||row.mode===mode)&&(!status||row.status===status));
    const ranked=rankBySearch(rows,keyword,[
      {value:row=>row.matchedProductCodes||[],mode:'code',weight:0},
      {value:row=>row.createdBy,mode:'text',weight:10},
      {value:row=>row.fileName,mode:'text',weight:20},
      {value:row=>row.action,mode:'text',weight:30},
      {value:row=>row.batchId,mode:'code',weight:40}
    ]);
    return keyword?ranked:ranked.sort((left,right)=>(Number(right.createdAt)||0)-(Number(left.createdAt)||0));
  }

  function ensureDetailState(batch){
    const batchId=batchKey(batch);
    if(!state.details.has(batchId)){
      state.details.set(batchId,{batch,items:[],cursor:null,done:false,promise:null,loading:false,error:'',search:'',selectedProductId:''});
    }
    const detailState=state.details.get(batchId);
    detailState.batch=batch;
    return detailState;
  }
  function detailCorpus(detail){
    const productValues=product=>product?[
      product.code,product.client,product.vi,product.sz,
      ...(product.ops||[]).flatMap(operation=>[operation.no,operation.vi,operation.sec,operation.category])
    ]:[];
    return searchKey([
      detail.productCode,detail.status,detail.error,
      ...productValues(detail.before),...productValues(detail.after),
      ...(detail.changes||[]).flatMap(change=>[change.field,change.processNo,change.processName,change.before,change.after,change.scope])
    ].join(' '));
  }
  function filteredDetails(detailState){
    return rankBySearch(detailState.items,detailState.search,[
      {value:detail=>detail.productCode,mode:'code',weight:0},
      {value:detail=>detailCorpus(detail),mode:'text',weight:10}
    ]);
  }
  function expectedDetailCount(batch){ return Math.max(0,Number(batch?.completedCount)||Number(batch?.targetCount)||0); }

  function fieldLabel(change){
    const field=change.field;
    const labels={
      client:['Khách hàng','客人'],zh:['Tên sản phẩm tiếng Trung','中文品名'],vi:['Tên sản phẩm tiếng Việt','越文品名'],sz:['Kích thước','尺寸'],
      no:['Số công đoạn','工序號'],category:['Phân loại','分類'],sec:['Giây','秒數'],created:['Thêm mới','新增'],removed:['Loại bỏ','移除']
    };
    if(change.scope==='process'&&(field==='vi'||field==='zh')) return pair('Tên công đoạn','工序名稱');
    const value=labels[field]||(field==='zh'||field==='vi'?labels[field]:['Tên công đoạn','工序名稱']);
    return pair(value[0],value[1]);
  }
  function displayValue(change,value){
    if(change.field==='sec'&&value!==''){
      const seconds=Number(value)||0,capacity=window.PCMSProductionEfficiencyCore?.hourlyCapacity?.(seconds)||0;
      return `${seconds} giây / 秒 · ${capacity}/giờ / 小時`;
    }
    return text(value)||'—';
  }
  function processNoCompare(left,right){
    const leftNumber=Number(left),rightNumber=Number(right);
    if(Number.isFinite(leftNumber)&&Number.isFinite(rightNumber)&&leftNumber!==rightNumber) return leftNumber-rightNumber;
    return naturalCompare(left,right);
  }
  function changeCompare(left,right){
    const leftScope=left.scope==='product'?0:1,rightScope=right.scope==='product'?0:1;
    if(leftScope!==rightScope) return leftScope-rightScope;
    if(leftScope===1){
      const processOrder=processNoCompare(left.processNo,right.processNo);
      if(processOrder) return processOrder;
    }
    const productOrder={client:0,vi:1,sz:2,zh:3,created:4,removed:5};
    const processOrder={no:0,vi:1,sec:2,category:3,zh:4,created:5,removed:6};
    const order=leftScope===0?productOrder:processOrder;
    return (order[left.field]??99)-(order[right.field]??99);
  }
  function manualDetails(details,keywordInput=''){
    const rows=[],keyword=searchKey(keywordInput);
    details.forEach(detail=>{
      const baseSearch=[
        detail.productCode,detail.after?.client||detail.before?.client,detail.after?.vi||detail.before?.vi,
        detail.after?.sz||detail.before?.sz,detail.status,detail.error
      ].join(' ');
      const baseMatches=!keywordInput||Number.isFinite(smartScore(keywordInput,detail.productCode,'code'))||Number.isFinite(smartScore(keywordInput,baseSearch));
      if(detail.status!=='success'){
        if(keyword&&!baseMatches&&!Number.isFinite(smartScore(keywordInput,detailCorpus(detail)))) return;
        rows.push(`<tr class="is-${escape(detail.status)}"><td>${escape(detail.productCode||detail.productId)}</td><td colspan="8">${escape(detail.error||detail.status)}</td><td>${statusLabel(detail.status==='failed'?'failed':'running')}</td></tr>`);
        return;
      }
      [...(detail.changes||[])].sort(changeCompare).forEach(change=>{
        if(change.field==='category'&&text(change.before)===text(change.after)) return;
        const changeSearch=[change.field,change.processNo,change.processName,change.before,change.after,change.scope].join(' ');
        if(keyword&&!baseMatches&&!Number.isFinite(smartScore(keywordInput,changeSearch))) return;
        rows.push(`<tr><td>${escape(detail.productCode)}</td><td>${escape(detail.after?.sz||detail.before?.sz||'—')}</td>
          <td>${Number(detail.after?.ops?.length??detail.before?.ops?.length)||0}</td><td>${escape(change.processNo||'—')}</td>
          <td>${escape(change.processName||'—')}</td><td>${fieldLabel(change)}</td>
          <td>${escape(displayValue(change,change.before))}</td><td>${escape(displayValue(change,change.after))}</td>
          <td>${escape(change.scope==='process'?'Công đoạn / 工序':'Mã hàng / 款號')}</td><td>${statusLabel('success')}</td></tr>`);
      });
    });
    return `<div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table product-change-detail-table"><thead><tr>
      <th>${pair('Mã hàng','款號')}</th><th>${pair('Kích thước','尺寸')}</th><th>${pair('Tổng công đoạn','總工序數')}</th>
      <th>${pair('Số công đoạn','工序號')}</th><th>${pair('Tên công đoạn','工序名稱')}</th><th>${pair('Nội dung sửa','修改項目')}</th>
      <th>${pair('Trước','修改前')}</th><th>${pair('Sau','修改後')}</th><th>${pair('Ảnh hưởng','影響')}</th><th>${pair('Kết quả','結果')}</th>
      </tr></thead><tbody>${rows.join('')||`<tr><td colspan="10" class="product-change-empty">${pair('Không có chi tiết phù hợp','沒有符合的明細')}</td></tr>`}</tbody></table></div></div>`;
  }

  function operationName(operation){
    const vi=text(operation?.vi),zh=text(operation?.zh);
    return pair(vi||'—',zh||'—');
  }
  function processTable(product,other,side){
    if(!product) return `<div class="product-change-no-baseline">${pair('Không có dữ liệu ban đầu','無原始資料')}</div>`;
    const rows=(product.ops||[]).map((operation,index)=>{
      const comparison=other?.ops?.[index];
      const added=side==='after'&&!comparison,removed=side==='before'&&!comparison;
      const rowClass=added?'is-added':removed?'is-removed':'';
      const cell=(field,value)=>{
        const changed=comparison&&(field==='name'
          ?String(comparison.vi??'')!==String(operation.vi??'')||String(comparison.zh??'')!==String(operation.zh??'')
          :String(comparison[field]??'')!==String(operation[field]??''));
        return `<td class="${changed?'is-changed':''}">${field==='name'?operationName(operation):escape(value)}</td>`;
      };
      return `<tr class="${rowClass}">${cell('no',operation.no)}${cell('name','')}${cell('sec',operation.sec)}</tr>`;
    }).join('');
    return `<table class="ui-table product-change-process-table"><thead><tr><th>${pair('Số','工序號')}</th><th>${pair('Tên công đoạn','工序名稱')}</th><th>${pair('Giây','秒數')}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function importProduct(details,selectedId){
    const selected=details.find(item=>item.productId===selectedId)||details[0];
    if(!selected) return '';
    if(selected.status!=='success') return `<div class="product-change-import-error">${statusLabel(selected.status==='failed'?'failed':'running')}<p>${escape(selected.error||'—')}</p></div>`;
    const before=selected.before,after=selected.after;
    return `<div class="product-change-compare-head"><strong>${escape(selected.productCode)}</strong><span>${before?.ops?.length||0} → ${after?.ops?.length||0}</span></div>
      <div class="product-change-compare"><section><h4>${pair('Toàn bộ công đoạn trước','套用前全部工序')}</h4>${processTable(before,after,'before')}</section>
      <section><h4>${pair('Toàn bộ công đoạn sau','套用後全部工序')}</h4>${processTable(after,before,'after')}</section></div>`;
  }
  function importDetails(detailState){
    const details=filteredDetails(detailState);
    if(!details.length) return `<div class="product-change-empty">${pair('Không có chi tiết phù hợp','沒有符合的明細')}</div>`;
    const selected=details.find(item=>item.productId===detailState.selectedProductId)||details[0];
    detailState.selectedProductId=selected?.productId||'';
    return `<div class="product-change-import-layout"><aside><div class="product-change-product-list">${details.map(detail=>`<button type="button" data-product-id="${escape(detail.productId)}" data-detail-batch-id="${escape(batchKey(detailState.batch))}" class="${detail.productId===detailState.selectedProductId?'active':''}"><strong>${escape(detail.productCode||detail.productId)}</strong>${statusLabel(detail.status==='success'?'success':detail.status==='failed'?'failed':'running')}</button>`).join('')}</div></aside>
      <div data-product-change-import-product>${importProduct(details,detailState.selectedProductId)}</div></div>`;
  }
  function detailBody(detailState){
    if(detailState.loading&&!detailState.items.length) return `<div class="product-change-detail-loading">${pair('Đang tải chi tiết…','正在載入明細…')}</div>`;
    if(detailState.error&&!detailState.items.length) return `<div class="product-change-empty is-error">${pair('Không thể tải chi tiết','無法載入明細')}</div>`;
    if(detailState.batch.mode==='import') return importDetails(detailState);
    return manualDetails(filteredDetails(detailState),detailState.search);
  }
  function detailFooter(detailState){
    const batch=detailState.batch,expected=expectedDetailCount(batch),loaded=detailState.items.length;
    const matched=filteredDetails(detailState).length,hasSearch=Boolean(searchKey(detailState.search));
    const countLabel=hasSearch
      ?pair(`${matched} kết quả trong ${loaded} mục đã tải`,`已載入 ${loaded} 筆中符合 ${matched} 筆`)
      :pair(`Đã tải ${loaded} / ${expected||loaded}`,`已載入 ${loaded}／${expected||loaded} 筆`);
    const retry=detailState.error?`<button type="button" class="btn bsm" data-product-change-retry="${escape(batchKey(batch))}">${pair('Thử lại','重試')}</button>`:'';
    const more=!detailState.done&&!detailState.error?`<button type="button" class="btn bsm product-change-detail-more" data-product-change-more-detail="${escape(batchKey(batch))}" ${detailState.loading?'disabled':''}><i class="ti ti-chevrons-down"></i>${detailState.loading?pair('Đang tải…','載入中…'):pair('Tải thêm chi tiết','載入更多明細')}</button>`:'';
    return `<div class="product-change-detail-count">${countLabel}</div>${retry}${more}`;
  }
  function detailRow(batch){
    const batchId=batchKey(batch),detailState=ensureDetailState(batch);
    return `<tr class="product-change-detail-row" data-detail-row-batch-id="${escape(batchId)}"><td colspan="7">
      <div class="product-change-detail-shell">
        <div class="product-change-detail-toolbar">
          <div class="product-change-detail-heading"><strong>${pair('Chi tiết thay đổi','修改明細')}</strong><span>${escape(time(batch.createdAt))} · ${escape(batch.createdBy)}</span></div>
          <label class="product-change-detail-search"><span class="ui-dual-copy"><strong>Tìm trong chi tiết đã tải</strong><span>搜尋已載入明細</span></span><input type="search" value="${escape(detailState.search)}" data-product-change-detail-search="${escape(batchId)}" data-ui-localized-placeholder-vi="Nhập mã hàng, công đoạn hoặc nội dung" data-ui-localized-placeholder-zh="輸入款號、工序或修改內容" placeholder="Nhập mã hàng, công đoạn hoặc nội dung"></label>
          <button type="button" class="ui-button is-compact product-change-detail-close" data-product-change-close="${escape(batchId)}"><i class="ti ti-chevron-up"></i>${pair('Thu gọn chi tiết','收合明細')}</button>
        </div>
        <div class="product-change-detail-body" data-detail-body="${escape(batchId)}">${detailBody(detailState)}</div>
        <div class="product-change-detail-footer" data-detail-footer="${escape(batchId)}">${detailFooter(detailState)}</div>
      </div>
    </td></tr>`;
  }

  function renderRows(){
    const body=node('product-change-table-body');
    if(!body) return;
    const rows=visibleRows();
    if(!rows.length){
      body.innerHTML=`<tr><td colspan="7" class="product-change-empty">${pair('Chưa có thay đổi kể từ khi bắt đầu theo dõi','追蹤啟用後尚無修改紀錄')}</td></tr>`;
    }else{
      body.innerHTML=rows.map(row=>{
        const batchId=batchKey(row),expanded=state.openBatchIds.has(batchId);
        return `<tr data-batch-id="${escape(batchId)}">
          <td>${escape(time(row.createdAt))}</td><td>${escape(row.createdBy||'—')}</td><td>${modeLabel(row.mode)}</td>
          <td>${Number(row.targetCount)||0}</td><td class="product-change-result-count">${escape(summary(row))}</td>
          <td>${statusLabel(row.status)}</td><td><button type="button" class="ui-button is-compact product-change-view" data-batch-id="${escape(batchId)}" aria-expanded="${expanded}">${expanded?pair('Thu gọn chi tiết','收合明細'):pair('Xem chi tiết','查看明細')}</button></td>
        </tr>${expanded?detailRow(row):''}`;
      }).join('');
    }
    window.PCMSUIText?.refreshLocalizedAttributes?.(body);
    const more=node('product-change-more'); if(more) more.hidden=state.done;
  }

  function detailRowNode(batchId){
    return [...(node('product-change-table-body')?.querySelectorAll('[data-detail-row-batch-id]')||[])]
      .find(row=>row.dataset.detailRowBatchId===batchId)||null;
  }
  function refreshDetailContents(batchId){
    const detailState=state.details.get(batchId),row=detailRowNode(batchId);
    if(!detailState||!row) return;
    const body=row.querySelector('[data-detail-body]'),footer=row.querySelector('[data-detail-footer]');
    if(body) body.innerHTML=detailBody(detailState);
    if(footer) footer.innerHTML=detailFooter(detailState);
    window.PCMSUIText?.refreshLocalizedAttributes?.(row);
  }
  async function loadDetailPage(batchId){
    const batch=findBatch(batchId); if(!batch) return [];
    const detailState=ensureDetailState(batch);
    if(detailState.done||detailState.promise) return detailState.promise||detailState.items;
    detailState.loading=true;detailState.error='';refreshDetailContents(batchId);
    detailState.promise=(async()=>{
      const constraints=[window._where('batchId','==',batchId)];
      if(detailState.cursor) constraints.push(window._startAfter(detailState.cursor));
      constraints.push(window._limit(DETAIL_PAGE_SIZE));
      const snapshot=await window._getDocs(window._query(window._collection('productChangeItems'),...constraints));
      detailState.cursor=snapshot.docs.at(-1)||detailState.cursor;
      const next=snapshot.docs.map(item=>({id:item.id,...item.data()}));
      detailState.items=[...new Map([...detailState.items,...next].map(item=>[item.id,item])).values()]
        .sort((left,right)=>naturalCompare(left.productCode,right.productCode));
      const expected=expectedDetailCount(batch);
      detailState.done=snapshot.size<DETAIL_PAGE_SIZE||(batch.status!=='running'&&expected>0&&detailState.items.length>=expected);
      if(!detailState.selectedProductId) detailState.selectedProductId=detailState.items[0]?.productId||'';
      return detailState.items;
    })().catch(error=>{
      console.error('Không thể tải chi tiết thay đổi / 無法載入修改明細',error);
      detailState.error=text(error?.message||error)||'detail-load-failed';
      return detailState.items;
    }).finally(()=>{
      detailState.loading=false;detailState.promise=null;refreshDetailContents(batchId);
    });
    return detailState.promise;
  }
  function closeDetails(batchId,restorePosition=false){
    state.openBatchIds.delete(batchId);
    renderRows();
    if(!restorePosition) return;
    requestAnimationFrame(()=>{
      const row=[...(node('product-change-table-body')?.querySelectorAll('[data-batch-id]')||[])].find(item=>item.dataset.batchId===batchId);
      row?.scrollIntoView?.({behavior:'smooth',block:'center'});
      row?.querySelector?.('.product-change-view')?.focus?.();
    });
  }
  async function toggleDetails(batchId){
    if(state.openBatchIds.has(batchId)){closeDetails(batchId,false);return;}
    const batch=findBatch(batchId); if(!batch) return;
    state.openBatchIds.add(batchId);ensureDetailState(batch);renderRows();
    detailRowNode(batchId)?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
    if(!state.details.get(batchId)?.items.length) await loadDetailPage(batchId);
  }
  async function handleTableClick(event){
    const toggle=event.target.closest?.('.product-change-view');
    if(toggle){await toggleDetails(text(toggle.dataset.batchId));return;}
    const close=event.target.closest?.('[data-product-change-close]');
    if(close){closeDetails(text(close.dataset.productChangeClose),true);return;}
    const more=event.target.closest?.('[data-product-change-more-detail]');
    if(more){await loadDetailPage(text(more.dataset.productChangeMoreDetail));return;}
    const retry=event.target.closest?.('[data-product-change-retry]');
    if(retry){
      const batchId=text(retry.dataset.productChangeRetry),detailState=state.details.get(batchId);
      if(detailState) detailState.error='';
      await loadDetailPage(batchId);return;
    }
    const product=event.target.closest?.('[data-product-id][data-detail-batch-id]');
    if(product){
      const batchId=text(product.dataset.detailBatchId),detailState=state.details.get(batchId);
      if(!detailState) return;
      detailState.selectedProductId=text(product.dataset.productId);
      refreshDetailContents(batchId);
    }
  }
  function handleTableInput(event){
    const input=event.target.closest?.('[data-product-change-detail-search]');
    if(!input) return;
    const batchId=text(input.dataset.productChangeDetailSearch),detailState=state.details.get(batchId);
    if(!detailState) return;
    detailState.search=input.value;
    refreshDetailContents(batchId);
  }

  function productCodeCandidates(query){
    const products=Array.isArray(window.D)?window.D:[];
    const matches=window.PCMSUISearchDropdown?.matchItems?.(products,query,{
      limit:20,fields:[{key:'code',mode:'code'}]
    })?.items||[];
    const keys=[...new Set(matches.map(item=>productCodeKey(item.code)).filter(Boolean))];
    return keys;
  }
  async function searchByProductCode(){
    const inputValue=text(node('product-change-search')?.value);
    const token=++state.searchToken;
    if(!inputValue){state.searchRows=[];renderRows();return;}
    try{
      const key=productCodeKey(inputValue);
      const keys=productCodeCandidates(inputValue);
      const codeConstraint=keys.length
        ?window._where('productCodeKey',keys.length===1?'==':'in',keys.length===1?keys[0]:keys)
        :window._where('productCodeKey','>=',key);
      const constraints=keys.length
        ?[codeConstraint,window._limit(PAGE_SIZE)]
        :[codeConstraint,window._where('productCodeKey','<=',`${key}\uf8ff`),window._limit(PAGE_SIZE)];
      const detailSnapshot=await window._getDocs(window._query(
        window._collection('productChangeItems'),...constraints
      ));
      const byBatch=new Map();
      detailSnapshot.docs.forEach(item=>{
        const detail=item.data(),batchId=text(detail.batchId);
        if(batchId) byBatch.set(batchId,[...(byBatch.get(batchId)||[]),detail.productCode]);
      });
      const batches=await Promise.all([...byBatch].map(async([batchId,codes])=>{
        const snapshot=await window._getDoc(window._docRef('productChangeBatches',batchId));
        return snapshot.exists()?{id:snapshot.id,...snapshot.data(),matchedProductCodes:codes}:null;
      }));
      if(token!==state.searchToken) return;
      state.searchRows=batches.filter(Boolean);
      renderRows();
    }catch(error){
      if(token!==state.searchToken) return;
      console.error('Không thể tìm nhật ký theo mã hàng / 無法依款號搜尋流水帳',error);
      state.searchRows=[];
      renderRows();
    }
  }
  function scheduleSearch(){
    state.searchRows=[];
    state.searchToken+=1;
    renderRows();
  }
  function handleSearchKeydown(event){
    if(event.key!=='Enter') return;
    event.preventDefault();
    void searchByProductCode();
  }
  function handleTableKeydown(event){
    const input=event.target.closest?.('[data-product-change-detail-search]');
    if(!input||event.key!=='Enter') return;
    event.preventDefault();
    handleTableInput(event);
  }

  async function load(reset=false){
    if(state.promise) return state.promise;
    if(reset){
      state.rows=[];state.searchRows=[];state.cursor=null;state.done=false;
      state.openBatchIds.clear();state.details.clear();
    }
    if(state.done&&!reset) return state.rows;
    state.promise=(async()=>{
      const constraints=[window._orderBy('createdAt','desc')];
      if(state.cursor) constraints.push(window._startAfter(state.cursor));
      constraints.push(window._limit(PAGE_SIZE));
      const snapshot=await window._getDocs(window._query(window._collection('productChangeBatches'),...constraints));
      state.cursor=snapshot.docs.at(-1)||state.cursor;
      state.done=snapshot.size<PAGE_SIZE;
      const next=snapshot.docs.map(item=>({id:item.id,...item.data()}));
      state.rows=[...new Map([...state.rows,...next].map(item=>[batchKey(item),item])).values()];
      renderRows();
      return state.rows;
    })().catch(async error=>{
      console.error('Không thể tải sổ thay đổi mã hàng / 無法載入款號修改流水帳',error);
      node('product-change-table-body').innerHTML=`<tr><td colspan="7" class="product-change-empty is-error">${pair('Không thể tải dữ liệu','無法載入資料')}</td></tr>`;
      throw error;
    }).finally(()=>{state.promise=null;});
    return state.promise;
  }

  async function init(){
    if(!state.initialized){
      node('product-change-search')?.addEventListener('input',scheduleSearch);
      node('product-change-search')?.addEventListener('keydown',handleSearchKeydown);
      node('product-change-mode')?.addEventListener('change',renderRows);
      node('product-change-status')?.addEventListener('change',renderRows);
      node('product-change-refresh')?.addEventListener('click',async()=>{await load(true);await searchByProductCode();});
      node('product-change-more')?.addEventListener('click',()=>load(false));
      node('product-change-table-body')?.addEventListener('click',handleTableClick);
      node('product-change-table-body')?.addEventListener('input',handleTableInput);
      node('product-change-table-body')?.addEventListener('keydown',handleTableKeydown);
      state.initialized=true;
    }
    await load(false);
  }
  function leave(){ state.promise=null;if(state.searchTimer) clearTimeout(state.searchTimer);state.searchTimer=null; }
  function invalidate(){
    state.rows=[];state.searchRows=[];state.cursor=null;state.done=false;
    state.openBatchIds.clear();state.details.clear();
  }

  window.productChangeLogInit=init;
  window.productChangeLogLeave=leave;
  window.PCMSProductChangeLog=Object.freeze({load,toggleDetails,invalidate});
})();
