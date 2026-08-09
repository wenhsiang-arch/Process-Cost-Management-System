// ===== 款號排序 =====
let _sumSortCol='', _sumSortDir=0;
const _expandedSummaryCodes=new Set();
const _summaryColumnVisibility={index:true,code:true,client:true,zh:true,vi:true,size:true,ops:true,cost:true,action:true};
let _summaryColumnSettingsBound=false;
const summarySafeText=value=>window.PCMSSafe.text(value); // summarySafeText（款號畫面安全文字）
function summaryMessage(vi,zh,kind='info'){
  return window.PCMSUIComponents.alertDialog({message:{vi:String(vi||''),zh:String(zh||'')},kind});
}
function sumSort(col){
  if(_sumSortCol===col){ _sumSortDir=(_sumSortDir+1)%3; }
  else{ _sumSortCol=col; _sumSortDir=1; }
  window.sPage=1; rSum();
}
function sortD(){
  let d=[...window.D];
  if(_sumSortDir===0||!_sumSortCol) return d;
  const asc=_sumSortDir===1;
  if(_sumSortCol==='code') d.sort((a,b)=>asc?a.code.localeCompare(b.code):b.code.localeCompare(a.code));
  else if(_sumSortCol==='client') d.sort((a,b)=>asc?a.client.localeCompare(b.client):b.client.localeCompare(a.client));
  else if(_sumSortCol==='zh') d.sort((a,b)=>asc?(a.zh||'').localeCompare(b.zh||''):(b.zh||'').localeCompare(a.zh||''));
  else if(_sumSortCol==='vi') d.sort((a,b)=>asc?(a.vi||'').localeCompare(b.vi||''):(b.vi||'').localeCompare(a.vi||''));
  else if(_sumSortCol==='sz') d.sort((a,b)=>asc?(a.sz||'').localeCompare(b.sz||''):(b.sz||'').localeCompare(a.sz||''));
  else if(_sumSortCol==='ops') d.sort((a,b)=>asc?a.ops.length-b.ops.length:b.ops.length-a.ops.length);
  else if(_sumSortCol==='cost') d.sort((a,b)=>{
    const av=a.ops.reduce((s,o)=>s+calc(o.sec).vnd,0);
    const bv=b.ops.reduce((s,o)=>s+calc(o.sec).vnd,0);
    return asc?av-bv:bv-av;
  });
  return d;
}
function sortIcon(col){
  if(_sumSortCol!==col||_sumSortDir===0) return '<i class="ti ti-arrows-sort summary-sort-icon is-idle" aria-hidden="true"></i>';
  return _sumSortDir===1?'<i class="ti ti-arrow-up summary-sort-icon" aria-hidden="true"></i>':'<i class="ti ti-arrow-down summary-sort-icon" aria-hidden="true"></i>';
}
function summarySortAria(col){
  if(_sumSortCol!==col||_sumSortDir===0) return 'none';
  return _sumSortDir===1?'ascending':'descending';
}
function closeSummaryColumnSettings(){
  const menu=g('summary-column-settings-menu');
  const button=g('summary-column-settings-button');
  if(menu) menu.hidden=true;
  button?.setAttribute('aria-expanded','false');
}
function toggleSummaryColumnSettings(){
  const menu=g('summary-column-settings-menu');
  const button=g('summary-column-settings-button');
  if(!menu||!button) return;
  const willOpen=menu.hidden;
  menu.hidden=!willOpen;
  button.setAttribute('aria-expanded',String(willOpen));
}
function availableSummaryColumnToggles(){
  return Array.from(document.querySelectorAll('#summary-column-settings-menu [data-summary-column-toggle]'))
    .filter(input=>!input.closest('label')?.hidden);
}
function syncSummarySelectAll(){
  const selectAll=g('summary-column-settings-select-all');
  if(!selectAll) return;
  const toggles=availableSummaryColumnToggles();
  const selected=toggles.filter(input=>_summaryColumnVisibility[input.dataset.summaryColumnToggle]!==false).length;
  selectAll.checked=toggles.length>0&&selected===toggles.length;
  selectAll.indeterminate=selected>0&&selected<toggles.length;
}
function applySummaryColumnVisibility(){
  const table=g('summary-main-table');
  if(!table) return;
  const canSeeCosts=canViewCosts();
  const costOption=g('summary-cost-column-option');
  if(costOption) costOption.hidden=!canSeeCosts;
  table.querySelectorAll('[data-summary-column]').forEach(cell=>{
    const key=cell.dataset.summaryColumn;
    const visible=_summaryColumnVisibility[key]!==false&&(key!=='cost'||canSeeCosts);
    cell.classList.toggle('is-column-hidden',!visible);
  });
  document.querySelectorAll('#summary-column-settings-menu [data-summary-column-toggle]').forEach(input=>{
    input.checked=_summaryColumnVisibility[input.dataset.summaryColumnToggle]!==false;
  });
  const visibleCount=Array.from(table.querySelectorAll('thead [data-summary-column]'))
    .filter(cell=>!cell.classList.contains('is-column-hidden')).length;
  table.querySelectorAll('.summary-detail-cell').forEach(cell=>{ cell.colSpan=Math.max(1,visibleCount); });
  const frame=g('summary-table-frame');
  const empty=g('summary-columns-empty');
  const pager=g('sp2');
  if(frame) frame.hidden=visibleCount===0;
  if(empty) empty.hidden=visibleCount!==0;
  if(pager) pager.hidden=visibleCount===0;
  syncSummarySelectAll();
}
function setAllSummaryColumns(visible){
  availableSummaryColumnToggles().forEach(input=>{
    _summaryColumnVisibility[input.dataset.summaryColumnToggle]=visible===true;
  });
  applySummaryColumnVisibility();
}
function resetSummaryColumns(){
  Object.keys(_summaryColumnVisibility).forEach(key=>{ _summaryColumnVisibility[key]=true; });
  applySummaryColumnVisibility();
}
function bindSummaryColumnSettings(){
  if(_summaryColumnSettingsBound) return;
  const button=g('summary-column-settings-button');
  if(!button) return;
  button.addEventListener('click',toggleSummaryColumnSettings);
  g('summary-column-settings-reset')?.addEventListener('click',resetSummaryColumns);
  g('summary-column-settings-select-all')?.addEventListener('change',event=>setAllSummaryColumns(event.currentTarget.checked));
  document.querySelectorAll('#summary-column-settings-menu [data-summary-column-toggle]').forEach(input=>{
    input.addEventListener('change',event=>{
      _summaryColumnVisibility[event.currentTarget.dataset.summaryColumnToggle]=event.currentTarget.checked;
      applySummaryColumnVisibility();
    });
  });
  document.addEventListener('click',event=>{
    if(!event.target.closest('.summary-column-settings')) closeSummaryColumnSettings();
  });
  _summaryColumnSettingsBound=true;
}

function toggleSummaryDetail(code){
  if(_expandedSummaryCodes.has(code)) _expandedSummaryCodes.delete(code);
  else _expandedSummaryCodes.add(code);
  rSum();
}

function renderSummaryDetail(d){
  const isA=canViewCosts();
  let total=0;
  const rows=[...d.ops].sort((a,b)=>compareProcessNo(a.no,b.no)).map(op=>{
    const result=calc(op.sec); total+=result.vnd;
    return`<tr><td>${summarySafeText(op.no)}</td><td><span class="tg tn">${summarySafeText(op.category||'—')} · ${summarySafeText(processCategoryLabel(op.category))}</span></td><td>${summarySafeText(op.zh)}</td><td style="color:var(--mu)">${summarySafeText(op.vi||'')}</td><td>${summarySafeText(op.sec)}</td><td>${result.qty}</td>`+(isA?`<td style="color:var(--accent);font-weight:500">${summarySafeText(fm(result.vnd))}</td>`:'')+`</tr>`;
  }).join('');
  return`<div class="summary-detail-wrap">
    <div class="summary-detail-head">
      <span class="tg tn">Khách hàng / 客人: ${summarySafeText(d.client)}</span><span class="tg tn">Kích thước / 尺寸: ${summarySafeText(d.sz)}</span>
      ${isA?`<span class="tg tg2">USD: ${summarySafeText(fU(total))}</span><span class="tg tb2">VND: ${summarySafeText(fV(total))}</span><span class="tg ta">TWD: ${summarySafeText(fT(total))}</span>`:''}
    </div>
    <div class="summary-detail-table-wrap"><table class="summary-detail-table">
      <thead><tr><th>Số công đoạn<span class="tv">工序號</span></th><th>Phân loại<span class="tv">加工分類</span></th><th>Tên công đoạn (TQ)<span class="tv">工序中文</span></th><th>Tên công đoạn (VN)<span class="tv">工序越文</span></th><th>Giây<span class="tv">秒數</span></th><th>SL/giờ<span class="tv">標準產量/時</span></th>${isA?'<th>Chi phí<span class="tv">工資</span></th>':''}</tr></thead>
      <tbody>${rows||`<tr><td colspan="${isA?7:6}" style="text-align:center;color:var(--mu)">Chưa có công đoạn<span class="tv">尚無工序資料</span></td></tr>`}</tbody>
    </table></div>
  </div>`;
}

// ===== 款號總成本 =====
function rSum(){
  const q  = (g('s-search')||{}).value||'';
  const cf = (g('s-client')||{}).value||'';
  const isA = canViewCosts();
  bindSummaryColumnSettings();
  const th=(col,key,vi,zh)=>`<th class="summary-sortable-header" data-summary-column="${key}" aria-sort="${summarySortAria(col)}" onclick="sumSort('${col}')"><span class="summary-sort-heading"><span>${vi}</span>${sortIcon(col)}</span><span class="tv">${zh}</span></th>`;
  g('sh').innerHTML=`<th data-summary-column="index">#</th>${th('code','code','Mã hàng','款號')}${th('client','client','Khách hàng','客人')}${th('zh','zh','Tên Trung','中文名稱')}${th('vi','vi','Tên Việt','越文名稱')}${th('sz','size','Kích thước','尺寸')}${th('ops','ops','Số công đoạn','工序數')}`+(isA?th('cost','cost',`Tổng chi phí (${window.cur})`,'總工價'):'')+`<th class="summary-action-column" data-summary-column="action"><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th>`;
  let fd=sortD().filter(d=>{
    const m=!q||(d.code+d.client+d.zh+d.vi).toLowerCase().includes(q.toLowerCase());
    return m&&(!cf||d.client===cf);
  });
  let tr=0; fd.forEach(d=>d.ops.forEach(()=>tr++));
  const pp=20, st=(window.sPage-1)*pp, pg=fd.slice(st,st+pp);
  const tb=g('sb2'); tb.innerHTML='';
  pg.forEach((d,i)=>{
    let sv2=0; d.ops.forEach(op=>{ sv2+=calc(op.sec).vnd; });
    const expanded=_expandedSummaryCodes.has(d.code);
    const visibleColumns=['index','code','client','zh','vi','size','ops',...(isA?['cost']:[]),'action']
      .filter(key=>_summaryColumnVisibility[key]!==false).length;
    const r=document.createElement('tr');
    r.innerHTML=`<td data-summary-column="index" style="color:var(--hi)"><button class="summary-toggle${expanded?' open':''}" title="Mở chi tiết công đoạn / 展開工序明細"><i class="ti ti-chevron-right"></i></button>${st+i+1}</td><td data-summary-column="code"><b class="summary-code" style="color:var(--navy)">${hl(d.code,q)}</b></td><td data-summary-column="client">${hl(d.client,q)}</td><td data-summary-column="zh">${hl(d.zh,q)}</td><td data-summary-column="vi" style="color:var(--mu)">${hl(d.vi,q)}</td><td data-summary-column="size"><span class="tg tn">${summarySafeText(d.sz)}</span></td><td data-summary-column="ops"><span class="tg tb2">${d.ops.length}</span></td>`+(isA?`<td data-summary-column="cost" style="color:var(--accent);font-weight:500">${summarySafeText(fm(sv2))}</td>`:'')+`<td class="summary-action-column" data-summary-column="action"><button class="btn bsm bd2 summary-delete"><i class="ti ti-trash"></i></button></td>`;
    r.querySelector('.summary-toggle')?.addEventListener('click',()=>toggleSummaryDetail(d.code));
    r.querySelector('.summary-code')?.addEventListener('click',()=>toggleSummaryDetail(d.code));
    r.querySelector('.summary-delete')?.addEventListener('click',()=>askDel(d.code));
    tb.appendChild(r);
    if(expanded){
      const detailRow=document.createElement('tr');
      detailRow.className='summary-detail-row';
      detailRow.innerHTML=`<td colspan="${Math.max(1,visibleColumns)}" class="summary-detail-cell">${renderSummaryDetail(d)}</td>`;
      tb.appendChild(detailRow);
    }
  });
  g('m-total').textContent=fd.length;
  g('m-rows').textContent=tr;
  mkPager('sp2',window.sPage,fd.length,pp,'goSP');
  rcf();
  applySummaryColumnVisibility();
}

// ===== 工序明細表 =====
function rDet(){
  if(!g('dh')||!g('db')||!g('dp2')) return;
  const q  = (g('d-search')||{}).value||'';
  const cf = (g('d-client')||{}).value||'';
  const sv = (g('d-sort')||{value:'ca'}).value||'ca';
  const pp = +(g('d-pp')||{value:50}).value||50;
  const isA = canViewCosts();
  g('dh').innerHTML=`<th>STT</th><th>Mã hàng<span class="tv">款號</span></th><th>Khách hàng<span class="tv">客人</span></th><th>Tên Trung<span class="tv">中文名稱</span></th><th>Tên Việt<span class="tv">越文名稱</span></th><th>Kích thước<span class="tv">尺寸</span></th><th>Số công đoạn<span class="tv">工序號</span></th><th>Phân loại<span class="tv">加工分類</span></th><th>Tên công đoạn (TQ)<span class="tv">工序中文</span></th><th>Tên công đoạn (VN)<span class="tv">工序越文</span></th><th>Giây<span class="tv">秒數</span></th><th>SL/giờ<span class="tv">標準產量/時</span></th>`+(isA?`<th>Chi phí (${window.cur})<span class="tv">工資</span></th>`:'');
  let src=window.D.filter(d=>{
    const m=!q||(d.code+d.client+d.zh).toLowerCase().includes(q.toLowerCase());
    return m&&(!cf||d.client===cf);
  });
  if(sv==='cd') src.sort((a,b)=>b.code.localeCompare(a.code));
  else src.sort((a,b)=>a.code.localeCompare(b.code));
  let rows=[];
  src.forEach(d=>{
    let ops=[...d.ops];
    ops.sort((a,b)=>compareProcessNo(a.no,b.no));
    ops.forEach(op=>{ rows.push({d,op,r:calc(op.sec)}); });
  });
  const st=(window.dPage-1)*pp, pr=rows.slice(st,st+pp);
  const tb=g('db'); tb.innerHTML='';
  pr.forEach((item,i)=>{
    const{d,op,r}=item;
    const tr=document.createElement('tr');
    tr.innerHTML=`<td style="color:var(--hi)">${st+i+1}</td><td><b style="color:var(--navy)">${hl(d.code,q)}</b></td><td>${hl(d.client,q)}</td><td>${hl(d.zh,q)}</td><td style="color:var(--mu)">${summarySafeText(d.vi)}</td><td>${summarySafeText(d.sz)}</td><td>${summarySafeText(op.no)}</td><td><span class="tg tn">${summarySafeText(op.category||'—')} · ${summarySafeText(processCategoryLabel(op.category))}</span></td><td>${summarySafeText(op.zh)}</td><td style="color:var(--mu)">${summarySafeText(op.vi||'')}</td><td>${summarySafeText(op.sec)}</td><td>${r.qty}</td>`+(isA?`<td style="color:var(--accent);font-weight:500">${summarySafeText(fm(r.vnd))}</td>`:'');
    tb.appendChild(tr);
  });
  mkPager('dp2',window.dPage,rows.length,pp,'goDP');
}

// ===== 刪除款號 =====
function askDel(code){
  g('del-code').value=code; g('del-show').textContent=code; g('del-inp').value=''; om('m-del');
}
async function confDel(){
  const code=g('del-code').value, inp=g('del-inp').value.trim();
  if(inp!==code){ await summaryMessage('Mã hàng không khớp.','款號輸入不符合。','warning'); return; }
  if(window.deleteProductFromFB){
    const ok=await deleteProductFromFB(code);
    if(!ok){ await summaryMessage('Xóa thất bại, dữ liệu chính thức chưa thay đổi.','刪除失敗，正式資料未變更。','danger'); return; }
  }
  window.D=window.D.filter(d=>d.code!==code); cm('m-del'); rSum(); rDet(); rExp(); rBk();
}
