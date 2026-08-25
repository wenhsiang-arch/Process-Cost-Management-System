// product-change-log（款號修改流水帳頁）：顯示一層操作摘要與一層完整明細。
(function(){
  'use strict';

  const PAGE_SIZE=50;
  const state={rows:[],searchRows:[],cursor:null,done:false,promise:null,searchTimer:null,searchToken:0,selectedBatchId:'',details:new Map(),selectedProductId:'',initialized:false};

  function text(value){ return String(value??'').trim(); }
  function productCodeKey(value){ return text(value).normalize('NFKC').toLocaleUpperCase(); }
  function escape(value){ return text(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
  function node(id){ return document.getElementById(id); }
  function pair(vi,zh){ return `<span class="ui-dual-copy"><strong>${escape(vi)}</strong><span>${escape(zh)}</span></span>`; }
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
  function matches(row){
    const keyword=productCodeKey(node('product-change-search')?.value);
    const mode=text(node('product-change-mode')?.value),status=text(node('product-change-status')?.value);
    if(mode&&row.mode!==mode) return false;
    if(status&&row.status!==status) return false;
    if(!keyword) return true;
    return [row.createdBy,row.fileName,row.action,row.batchId,...(row.matchedProductCodes||[])].some(value=>text(value).toLocaleUpperCase().includes(keyword));
  }

  function renderRows(){
    const body=node('product-change-table-body');
    if(!body) return;
    const rows=[...new Map([...state.rows,...state.searchRows].map(item=>[item.batchId||item.id,item])).values()]
      .filter(matches).sort((left,right)=>(Number(right.createdAt)||0)-(Number(left.createdAt)||0));
    if(!rows.length){
      body.innerHTML=`<tr><td colspan="7" class="product-change-empty">${pair('Chưa có thay đổi kể từ khi bắt đầu theo dõi','追蹤啟用後尚無修改紀錄')}</td></tr>`;
    }else{
      body.innerHTML=rows.map(row=>`<tr data-batch-id="${escape(row.batchId)}">
        <td>${escape(time(row.createdAt))}</td><td>${escape(row.createdBy||'—')}</td><td>${modeLabel(row.mode)}</td>
        <td>${Number(row.targetCount)||0}</td><td class="product-change-result-count">${escape(summary(row))}</td>
        <td>${statusLabel(row.status)}</td><td><button type="button" class="btn bsm product-change-view" data-batch-id="${escape(row.batchId)}">${pair('Xem chi tiết','查看明細')}</button></td>
      </tr>`).join('');
    }
    body.querySelectorAll('.product-change-view').forEach(button=>button.addEventListener('click',()=>openDetails(button.dataset.batchId)));
    const more=node('product-change-more'); if(more) more.hidden=state.done;
  }

  async function searchByProductCode(){
    const keyword=productCodeKey(node('product-change-search')?.value);
    const token=++state.searchToken;
    if(!keyword){state.searchRows=[];renderRows();return;}
    try{
      const detailSnapshot=await window._getDocs(window._query(
        window._collection('productChangeItems'),window._where('productCodeKey','==',keyword),window._limit(PAGE_SIZE)
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
    renderRows();
    if(state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer=setTimeout(searchByProductCode,350);
  }

  async function load(reset=false){
    if(state.promise) return state.promise;
    if(reset){state.rows=[];state.searchRows=[];state.cursor=null;state.done=false;state.details.clear();state.selectedBatchId='';}
    if(state.done&&!reset) return state.rows;
    state.promise=(async()=>{
      const constraints=[window._orderBy('createdAt','desc')];
      if(state.cursor) constraints.push(window._startAfter(state.cursor));
      constraints.push(window._limit(PAGE_SIZE));
      const snapshot=await window._getDocs(window._query(window._collection('productChangeBatches'),...constraints));
      state.cursor=snapshot.docs.at(-1)||state.cursor;
      state.done=snapshot.size<PAGE_SIZE;
      const next=snapshot.docs.map(item=>({id:item.id,...item.data()}));
      state.rows=[...new Map([...state.rows,...next].map(item=>[item.batchId||item.id,item])).values()];
      renderRows();
      return state.rows;
    })().catch(async error=>{
      console.error('Không thể tải sổ thay đổi mã hàng / 無法載入款號修改流水帳',error);
      node('product-change-table-body').innerHTML=`<tr><td colspan="7" class="product-change-empty is-error">${pair('Không thể tải dữ liệu','無法載入資料')}</td></tr>`;
      throw error;
    }).finally(()=>{state.promise=null;});
    return state.promise;
  }

  function fieldLabel(field){
    const labels={
      client:['Khách hàng','客人'],zh:['Tên sản phẩm tiếng Trung','中文品名'],vi:['Tên sản phẩm tiếng Việt','越文品名'],sz:['Kích thước','尺寸'],
      no:['Số công đoạn','工序號'],category:['Phân loại','分類'],sec:['Giây','秒數'],created:['Thêm mới','新增'],removed:['Loại bỏ','移除']
    };
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
  function manualDetails(details){
    const rows=[];
    details.forEach(detail=>{
      if(detail.status!=='success'){
        rows.push(`<tr class="is-${escape(detail.status)}"><td>${escape(detail.productCode||detail.productId)}</td><td colspan="8">${escape(detail.error||detail.status)}</td><td>${statusLabel(detail.status==='failed'?'failed':'running')}</td></tr>`);
        return;
      }
      (detail.changes||[]).forEach(change=>{
        if(change.field==='category'&&text(change.before)===text(change.after)) return;
        rows.push(`<tr><td>${escape(detail.productCode)}</td><td>${escape(detail.after?.sz||detail.before?.sz||'—')}</td>
          <td>${Number(detail.after?.ops?.length??detail.before?.ops?.length)||0}</td><td>${escape(change.processNo||'—')}</td>
          <td>${escape(change.processName||'—')}</td><td>${fieldLabel(change.field)}</td>
          <td>${escape(displayValue(change,change.before))}</td><td>${escape(displayValue(change,change.after))}</td>
          <td>${escape(change.scope==='process'?'Công đoạn / 工序':'Mã hàng / 款號')}</td><td>${statusLabel('success')}</td></tr>`);
      });
    });
    return `<div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table product-change-detail-table"><thead><tr>
      <th>${pair('Mã hàng','款號')}</th><th>${pair('Kích thước','尺寸')}</th><th>${pair('Tổng công đoạn','總工序數')}</th>
      <th>${pair('Số công đoạn','工序號')}</th><th>${pair('Tên công đoạn','工序名稱')}</th><th>${pair('Nội dung sửa','修改項目')}</th>
      <th>${pair('Trước','修改前')}</th><th>${pair('Sau','修改後')}</th><th>${pair('Ảnh hưởng','影響')}</th><th>${pair('Kết quả','結果')}</th>
      </tr></thead><tbody>${rows.join('')||`<tr><td colspan="10" class="product-change-empty">${pair('Không có thay đổi','沒有變更')}</td></tr>`}</tbody></table></div></div>`;
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
  function importDetails(details){
    const selected=details.find(item=>item.productId===state.selectedProductId)||details[0];
    state.selectedProductId=selected?.productId||'';
    return `<div class="product-change-import-layout"><aside><div class="product-change-product-list">${details.map(detail=>`<button type="button" data-product-id="${escape(detail.productId)}" class="${detail.productId===state.selectedProductId?'active':''}"><strong>${escape(detail.productCode||detail.productId)}</strong>${statusLabel(detail.status==='success'?'success':detail.status==='failed'?'failed':'running')}</button>`).join('')}</div></aside>
      <div id="product-change-import-product">${importProduct(details,state.selectedProductId)}</div></div>`;
  }

  async function openDetails(batchId){
    const batch=state.rows.find(item=>(item.batchId||item.id)===batchId); if(!batch) return;
    state.selectedBatchId=batchId;state.selectedProductId='';
    let details=state.details.get(batchId);
    if(!details){
      const snapshot=await window._getDocs(window._query(
        window._collection('productChangeItems'),window._where('batchId','==',batchId),window._limit(5000)
      ));
      details=snapshot.docs.map(item=>({id:item.id,...item.data()})).sort((a,b)=>text(a.productCode).localeCompare(text(b.productCode)));
      state.details.set(batchId,details);
    }
    const host=node('product-change-details');
    host.hidden=false;
    host.innerHTML=`<header class="ui-section-header"><div><h3>${pair('Chi tiết thay đổi','修改明細')}</h3><p>${escape(time(batch.createdAt))} · ${escape(batch.createdBy)}</p></div><button type="button" class="btn bsm" id="product-change-close-detail">${pair('Đóng','關閉')}</button></header>
      <div class="product-change-detail-body">${batch.mode==='import'?importDetails(details):manualDetails(details)}</div>`;
    node('product-change-close-detail')?.addEventListener('click',()=>{host.hidden=true;host.replaceChildren();});
    host.querySelectorAll('[data-product-id]').forEach(button=>button.addEventListener('click',()=>{
      state.selectedProductId=button.dataset.productId;
      host.querySelector('#product-change-import-product').innerHTML=importProduct(details,state.selectedProductId);
      host.querySelectorAll('[data-product-id]').forEach(item=>item.classList.toggle('active',item.dataset.productId===state.selectedProductId));
    }));
    host.scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function init(){
    if(!state.initialized){
      node('product-change-search')?.addEventListener('input',scheduleSearch);
      node('product-change-mode')?.addEventListener('change',renderRows);
      node('product-change-status')?.addEventListener('change',renderRows);
      node('product-change-refresh')?.addEventListener('click',async()=>{await load(true);await searchByProductCode();});
      node('product-change-more')?.addEventListener('click',()=>load(false));
      state.initialized=true;
    }
    await load(false);
  }
  function leave(){ state.promise=null;if(state.searchTimer) clearTimeout(state.searchTimer);state.searchTimer=null; }
  function invalidate(){ state.rows=[];state.searchRows=[];state.cursor=null;state.done=false;state.details.clear(); }

  window.productChangeLogInit=init;
  window.productChangeLogLeave=leave;
  window.PCMSProductChangeLog=Object.freeze({load,openDetails,invalidate});
})();
