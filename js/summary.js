// ===== 款號排序 =====
let _sumSortCol='', _sumSortDir=0;
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
  if(_sumSortCol!==col||_sumSortDir===0) return '<i class="ti ti-arrows-sort" style="font-size:11px;opacity:0.4"></i>';
  return _sumSortDir===1?'<i class="ti ti-arrow-up" style="font-size:11px"></i>':'<i class="ti ti-arrow-down" style="font-size:11px"></i>';
}

// ===== 款號總成本 =====
function rSum(){
  const q  = (g('s-search')||{}).value||'';
  const cf = (g('s-client')||{}).value||'';
  const isA = isAdm();
  const th=(col,vi,zh)=>`<th onclick="sumSort('${col}')" style="cursor:pointer;user-select:none;white-space:nowrap">${vi}<span class="tv">${zh}</span> ${sortIcon(col)}</th>`;
  g('sh').innerHTML=`<th>#</th>${th('code','Mã hàng','款號')}${th('client','Khách hàng','客人')}${th('zh','Tên Trung','中文名稱')}${th('vi','Tên Việt','越文名稱')}${th('sz','Kích thước','尺寸')}${th('ops','Số công đoạn','工序數')}`+(isA?th('cost',`Tổng chi phí (${window.cur})`,'總工價'):'')+`<th>Thao tác<span class="tv">操作</span></th>`;
  let fd=sortD().filter(d=>{
    const m=!q||(d.code+d.client+d.zh+d.vi).toLowerCase().includes(q.toLowerCase());
    return m&&(!cf||d.client===cf);
  });
  let tr=0; fd.forEach(d=>d.ops.forEach(()=>tr++));
  const pp=20, st=(window.sPage-1)*pp, pg=fd.slice(st,st+pp);
  const tb=g('sb2'); tb.innerHTML='';
  pg.forEach((d,i)=>{
    let sv2=0; d.ops.forEach(op=>{ sv2+=calc(op.sec).vnd; });
    const r=document.createElement('tr');
    r.innerHTML=`<td style="color:var(--hi)">${st+i+1}</td><td><b style="color:var(--navy)">${hl(d.code,q)}</b></td><td>${hl(d.client,q)}</td><td>${hl(d.zh,q)}</td><td style="color:var(--mu)">${hl(d.vi,q)}</td><td><span class="tg tn">${d.sz}</span></td><td><span class="tg tb2">${d.ops.length}</span></td>`+(isA?`<td style="color:var(--accent);font-weight:500">${fm(sv2)}</td>`:'')+`<td><div style="display:flex;gap:4px"><button class="btn bsm" onclick="oDet('${d.code}')"><i class="ti ti-eye"></i></button><button class="btn bsm bd2" onclick="askDel('${d.code}')"><i class="ti ti-trash"></i></button></div></td>`;
    tb.appendChild(r);
  });
  g('m-total').textContent=window.D.length;
  g('m-rows').textContent=tr;
  mkPager('sp2',window.sPage,fd.length,pp,'goSP');
  rcf();
}

// ===== 工序明細彈窗 =====
function oDet(code){
  const d=window.D.find(x=>x.code===code); if(!d) return;
  const isA=isAdm();
  g('det-title').textContent=`${d.code} — ${d.zh} / ${d.vi}`;
  let sv=0;
  const rows=d.ops.map((op,idx)=>{
    const r=calc(op.sec); sv+=r.vnd;
    return`<tr><td>${op.no}</td><td>${op.zh}</td><td style="color:var(--mu)">${op.vi||''}</td><td>${op.sec}</td><td>${r.qty}</td>`+(isA?`<td style="color:var(--accent);font-weight:500">${fm(r.vnd)}</td>`:'')+`<td><div style="display:flex;gap:4px"><button class="btn bsm" onclick="oEop('${code}',${idx})"><i class="ti ti-edit"></i></button><button class="btn bsm bd2" onclick="delOp('${code}',${idx})"><i class="ti ti-trash"></i></button></div></td></tr>`;
  }).join('');
  g('det-body').innerHTML=`
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
      <span class="tg tn">Khách: ${d.client}</span><span class="tg tn">Size: ${d.sz}</span>
      ${isA?`<span class="tg tg2">USD: ${fU(sv)}</span><span class="tg tb2">VND: ${fV(sv)}</span><span class="tg ta">TWD: ${fT(sv)}</span>`:''}
    </div>
    <div class="to"><div class="ts" style="max-height:320px"><table>
      <thead><tr><th>工序號</th><th>工序(中)</th><th>工序(越)/Tên CĐ</th><th>秒數/Giây</th><th>SL/giờ<br><span style="font-size:10px;font-weight:400;color:var(--mu)">標準產量/時</span></th>${isA?'<th>Chi phí</th>':''}<th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
  om('m-det');
}

function oEop(code,idx){
  const d=window.D.find(x=>x.code===code); if(!d) return; const op=d.ops[idx];
  g('eo-code').value=code; g('eo-idx').value=idx;
  g('eo-no').value=op.no; g('eo-sec').value=op.sec;
  g('eo-zh').value=op.zh; g('eo-vi').value=op.vi||'';
  cm('m-det'); om('m-eop');
}

async function saveEop(){
  const code=g('eo-code').value, idx=+g('eo-idx').value;
  const d=window.D.find(x=>x.code===code); if(!d) return;
  const sec=+g('eo-sec').value;
  if(!sec||sec<=0){ alert('秒數必須大於0 / Giây phải lớn hơn 0'); return; }
  d.ops[idx]={no:g('eo-no').value,zh:g('eo-zh').value,vi:g('eo-vi').value,sec};
  cm('m-eop'); rSum(); rDet(); rExp(); rBk();
  if(window.saveProductsToFB) await saveProductsToFB();
}

async function delOp(code,idx){
  if(!confirm('Xác nhận xóa công đoạn? / 確定刪除此工序？')) return;
  const d=window.D.find(x=>x.code===code); if(!d) return;
  d.ops.splice(idx,1); cm('m-det'); rSum(); rDet(); rExp(); rBk();
  if(window.saveProductsToFB) await saveProductsToFB();
}

// ===== 工序明細表 =====
function rDet(){
  const q  = (g('d-search')||{}).value||'';
  const cf = (g('d-client')||{}).value||'';
  const sv = (g('d-sort')||{value:'ca'}).value||'ca';
  const pp = +(g('d-pp')||{value:50}).value||50;
  const isA = isAdm();
  g('dh').innerHTML=`<th>STT</th><th>Mã hàng<span class="tv">款號</span></th><th>Khách hàng<span class="tv">客人</span></th><th>Tên Trung<span class="tv">中文名稱</span></th><th>Tên Việt<span class="tv">越文名稱</span></th><th>Kích thước<span class="tv">尺寸</span></th><th>Số công đoạn<span class="tv">工序號</span></th><th>Tên công đoạn (TQ)<span class="tv">工序中文</span></th><th>Tên công đoạn (VN)<span class="tv">工序越文</span></th><th>Giây<span class="tv">秒數</span></th><th>SL/giờ<span class="tv">標準產量/時</span></th>`+(isA?`<th>Chi phí (${window.cur})<span class="tv">工資</span></th><th>Thao tác<span class="tv">操作</span></th>`:'');
  let src=window.D.filter(d=>{
    const m=!q||(d.code+d.client+d.zh).toLowerCase().includes(q.toLowerCase());
    return m&&(!cf||d.client===cf);
  });
  if(sv==='cd') src.sort((a,b)=>b.code.localeCompare(a.code));
  else src.sort((a,b)=>a.code.localeCompare(b.code));
  let rows=[];
  src.forEach(d=>{
    let ops=[...d.ops];
    if(sv==='oa') ops.sort((a,b)=>String(a.no).localeCompare(String(b.no),undefined,{numeric:true}));
    ops.forEach(op=>{ const ri=d.ops.indexOf(op); rows.push({d,op,ri,r:calc(op.sec)}); });
  });
  const st=(window.dPage-1)*pp, pr=rows.slice(st,st+pp);
  const tb=g('db'); tb.innerHTML='';
  pr.forEach((item,i)=>{
    const{d,op,ri,r}=item;
    const tr=document.createElement('tr');
    tr.innerHTML=`<td style="color:var(--hi)">${st+i+1}</td><td><b style="color:var(--navy)">${hl(d.code,q)}</b></td><td>${hl(d.client,q)}</td><td>${hl(d.zh,q)}</td><td style="color:var(--mu)">${d.vi}</td><td>${d.sz}</td><td>${op.no}</td><td>${op.zh}</td><td style="color:var(--mu)">${op.vi||''}</td><td>${op.sec}</td><td>${r.qty}</td>`+(isA?`<td style="color:var(--accent);font-weight:500">${fm(r.vnd)}</td><td><div style="display:flex;gap:4px"><button class="btn bsm" onclick="oEop('${d.code}',${ri})"><i class="ti ti-edit"></i></button><button class="btn bsm bd2" onclick="delOp('${d.code}',${ri})"><i class="ti ti-trash"></i></button></div></td>`:'');
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
  if(inp!==code){ alert('Mã hàng không khớp / 款號輸入不符合！'); return; }
  window.D=window.D.filter(d=>d.code!==code); cm('m-del'); rSum(); rDet(); rExp(); rBk();
  if(window.saveProductsToFB) await saveProductsToFB();
}

// ===== 新增款號 =====
let nOpc=0;
function addOp(){
  nOpc++;
  const div=document.createElement('div'); div.className='fg'; div.style.marginBottom='8px';
  div.innerHTML=`<div class="fgrp"><label>工序號/Số CĐ</label><input type="text" id="op-no-${nOpc}" placeholder="01"></div><div class="fgrp"><label>工序(中)</label><input type="text" id="op-zh-${nOpc}"></div><div class="fgrp"><label>工序(越)/Tên CĐ</label><input type="text" id="op-vi-${nOpc}"></div><div class="fgrp"><label>秒數/Giây</label><input type="number" id="op-sc-${nOpc}"></div>`;
  g('n-ops').appendChild(div);
}
async function saveNew(){
  const code=g('n-code').value.trim(); if(!code){ alert('Vui lòng nhập mã hàng / 請填入款號'); return; }
  if(window.D.find(d=>d.code===code)){ alert('Mã hàng đã tồn tại / 款號已存在：'+code); return; }
  const ops=[];
  for(let i=1;i<=nOpc;i++){
    const no=g('op-no-'+i); if(!no) continue;
    const sec=+g('op-sc-'+i).value;
    if(sec>0) ops.push({no:no.value,zh:g('op-zh-'+i).value,vi:g('op-vi-'+i).value,sec});
  }
  window.D.push({code,client:g('n-cl').value,zh:g('n-zh').value,vi:g('n-vi').value,sz:g('n-sz').value,ops});
  cm('m-add'); g('n-ops').innerHTML=''; nOpc=0; rSum(); rDet(); rExp(); rBk();
  if(window.saveProductsToFB) await saveProductsToFB();
}
