// ===== 款號表格操作 =====
const _expandedSummaryCodes=new Set();
let _summaryTableControl=null; // _summaryTableControl（款號共用表格操作控制）
const SUMMARY_COLUMNS=Object.freeze([
  {key:'index',label:{vi:'STT',zh:'序號'},minimum:58,preferred:68,maximum:84},
  {key:'code',label:{vi:'Mã hàng',zh:'款號'},minimum:110,preferred:140,maximum:220},
  {key:'client',label:{vi:'Khách hàng',zh:'客人'},minimum:100,preferred:130,maximum:220},
  {key:'zh',label:{vi:'Tên Trung',zh:'中文名稱'},minimum:180,preferred:280,maximum:520},
  {key:'vi',label:{vi:'Tên Việt',zh:'越文名稱'},minimum:180,preferred:280,maximum:520},
  {key:'size',label:{vi:'Kích thước',zh:'尺寸'},minimum:90,preferred:110,maximum:160},
  {key:'ops',label:{vi:'Số công đoạn',zh:'工序數'},minimum:90,preferred:105,maximum:130},
  {key:'cost',label:{vi:'Tổng chi phí',zh:'總工價'},minimum:120,preferred:150,maximum:210,available:()=>canViewCosts()},
  {key:'action',label:{vi:'Thao tác',zh:'操作'},minimum:88,preferred:96,maximum:120}
]); // SUMMARY_COLUMNS（款號欄位定義）：提供文字、既有權限與使用者拖曳時的合理寬度範圍。
const summarySafeText=value=>window.PCMSSafe.text(value); // summarySafeText（款號畫面安全文字）
const summaryPairHtml=(vi,zh)=>`<span class="ui-bilingual"><span class="ui-text-vi">${summarySafeText(vi)}</span><span class="ui-text-zh">${summarySafeText(zh)}</span></span>`; // summaryPairHtml（款號畫面可切換雙語文字）
function summaryMessage(vi,zh,kind='info'){
  return window.PCMSUIComponents.alertDialog({message:{vi:String(vi||''),zh:String(zh||'')},kind});
}

function ensureSummaryTableControl(){
  if(_summaryTableControl) return _summaryTableControl;
  _summaryTableControl=window.PCMSUITableControls.create({
    root:'#pg-summary',
    table:'#summary-main-table',
    settings:'#summary-column-settings',
    settingsButton:'#summary-column-settings-button',
    settingsMenu:'#summary-column-settings-menu',
    frame:'#summary-table-frame',
    empty:'#summary-columns-empty',
    columns:SUMMARY_COLUMNS,
    onColumnsChanged:({visibleCount})=>{
      document.querySelectorAll('#summary-main-table .summary-detail-cell').forEach(cell=>{
        cell.colSpan=Math.max(1,visibleCount);
      });
      const pager=g('sp2');
      if(pager) pager.hidden=visibleCount===0;
    },
    onSortChanged:()=>{
      window.sPage=1;
      rSum();
    }
  });
  return _summaryTableControl;
}

function sortD(){
  let d=[...window.D];
  const sort=_summaryTableControl?.getSort?.() || {key:'',direction:'none'}; // sort（共用控制提供的排序狀態）
  if(sort.direction==='none'||!sort.key) return d;
  const asc=sort.direction==='ascending';
  if(sort.key==='code') d.sort((a,b)=>asc?a.code.localeCompare(b.code):b.code.localeCompare(a.code));
  else if(sort.key==='client') d.sort((a,b)=>asc?a.client.localeCompare(b.client):b.client.localeCompare(a.client));
  else if(sort.key==='zh') d.sort((a,b)=>asc?(a.zh||'').localeCompare(b.zh||''):(b.zh||'').localeCompare(a.zh||''));
  else if(sort.key==='vi') d.sort((a,b)=>asc?(a.vi||'').localeCompare(b.vi||''):(b.vi||'').localeCompare(a.vi||''));
  else if(sort.key==='sz') d.sort((a,b)=>asc?(a.sz||'').localeCompare(b.sz||''):(b.sz||'').localeCompare(a.sz||''));
  else if(sort.key==='ops') d.sort((a,b)=>asc?a.ops.length-b.ops.length:b.ops.length-a.ops.length);
  else if(sort.key==='cost') d.sort((a,b)=>{
    const av=a.ops.reduce((s,o)=>s+calc(o.sec).vnd,0);
    const bv=b.ops.reduce((s,o)=>s+calc(o.sec).vnd,0);
    return asc?av-bv:bv-av;
  });
  return d;
}

function summaryLeave(){
  _summaryTableControl?.deactivate?.({resetSort:true});
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
      <span class="tg tn">${summaryPairHtml(`Khách hàng: ${d.client}`,`客人：${d.client}`)}</span><span class="tg tn">${summaryPairHtml(`Kích thước: ${d.sz}`,`尺寸：${d.sz}`)}</span>
      ${isA?`<span class="tg tg2">USD: ${summarySafeText(fU(total))}</span><span class="tg tb2">VND: ${summarySafeText(fV(total))}</span><span class="tg ta">TWD: ${summarySafeText(fT(total))}</span>`:''}
    </div>
    <div class="summary-detail-table-wrap"><table class="summary-detail-table ui-table" data-ui-table-layout="special">
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
  const tableControl=ensureSummaryTableControl(); // tableControl（款號共用表格操作控制）
  const th=(col,key,vi,zh,numeric=false)=>`<th class="ui-table-sortable-header${numeric?' ui-table-number-cell':''}" data-ui-table-column="${key}" data-ui-table-sort-key="${col}" aria-sort="none"><span class="ui-table-sort-heading"><span class="ui-table-sort-label ui-bilingual"><span class="ui-text-vi">${summarySafeText(vi)}</span><span class="ui-text-zh">${summarySafeText(zh)}</span></span><i class="ti ti-arrows-sort ui-table-sort-icon is-idle" data-ui-table-sort-icon aria-hidden="true"></i></span></th>`;
  g('sh').innerHTML=`<th data-ui-table-column="index">#</th>${th('code','code','Mã hàng','款號')}${th('client','client','Khách hàng','客人')}${th('zh','zh','Tên Trung','中文名稱')}${th('vi','vi','Tên Việt','越文名稱')}${th('sz','size','Kích thước','尺寸')}${th('ops','ops','Số công đoạn','工序數',true)}`+(isA?th('cost','cost',`Tổng chi phí (${window.cur})`,'總工價',true):'')+`<th class="ui-table-center-cell summary-action-column" data-ui-table-column="action"><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th>`;
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
    const visibleColumns=tableControl.getVisibleKeys().length;
    const r=document.createElement('tr');
    r.innerHTML=`<td data-ui-table-column="index" style="color:var(--hi)"><button class="summary-toggle${expanded?' open':''}" title="Mở chi tiết công đoạn / 展開工序明細"><i class="ti ti-chevron-right"></i></button>${st+i+1}</td><td class="ui-table-ellipsis" data-ui-table-column="code"><b class="summary-code" style="color:var(--navy)">${hl(d.code,q)}</b></td><td class="ui-table-ellipsis" data-ui-table-column="client">${hl(d.client,q)}</td><td class="ui-table-ellipsis" data-ui-table-column="zh">${hl(d.zh,q)}</td><td class="ui-table-ellipsis" data-ui-table-column="vi" style="color:var(--mu)">${hl(d.vi,q)}</td><td data-ui-table-column="size"><span class="tg tn">${summarySafeText(d.sz)}</span></td><td class="ui-table-number-cell" data-ui-table-column="ops"><span class="tg tb2">${d.ops.length}</span></td>`+(isA?`<td class="ui-table-number-cell" data-ui-table-column="cost" style="color:var(--accent);font-weight:500">${summarySafeText(fm(sv2))}</td>`:'')+`<td class="ui-table-center-cell summary-action-column" data-ui-table-column="action"><button class="btn bsm bd2 summary-delete"><i class="ti ti-trash"></i></button></td>`;
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
  tableControl.refresh();
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
