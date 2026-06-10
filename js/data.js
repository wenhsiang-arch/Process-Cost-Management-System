// ===== 匯入 =====
let pImp=null, nItms=null, dups=[];
const PROCESS_CATEGORIES={BL:'備料',SX:'生產',QC:'品檢',DG:'包裝'};
function processCategoryLabel(code){ return PROCESS_CATEGORIES[code]||code||'—'; }

function validateProcessNumbers(ops,code){
  const label=code||'未知款號';
  if(!ops.length) return [`款號 ${label}：至少需要工序號 1`];
  const errors=[];
  const seen=new Set();
  ops.forEach(op=>{
    const no=String(op.no??'').trim();
    if(!normalizeProcessNo(no)){
      errors.push(`款號 ${label}：工序號「${no||'空白'}」格式錯誤，必須使用 1–99，且不可有前導零`);
    } else if(seen.has(no)){
      errors.push(`款號 ${label}：工序號 ${no} 重複`);
    }
    seen.add(no);
  });
  const valid=[...seen].filter(normalizeProcessNo).sort(compareProcessNo);
  const max=valid.length?Math.max(...valid.map(Number)):0;
  for(let i=1;i<=max;i++){
    const expected=String(i);
    if(!seen.has(expected)) errors.push(`款號 ${label}：缺少工序號 ${expected}`);
  }
  return [...new Set(errors)];
}

function validateImportProcessRows(rows){
  const byCode={};
  rows.forEach((r,i)=>{
    const code=String(r[0]).trim();
    if(!byCode[code]) byCode[code]=[];
    byCode[code].push({no:String(r[5]).trim(),row:r._excelRow||i+2});
  });
  const errors=[];
  Object.entries(byCode).forEach(([code,ops])=>{
    const seen=new Map();
    ops.forEach(op=>{
      if(!normalizeProcessNo(op.no)){
        errors.push({
          code,
          vi:`Dòng ${op.row}: Số công đoạn「${op.no||'trống'}」không đúng định dạng, phải dùng 1–99 và không có số 0 ở đầu.`,
          zh:`第 ${op.row} 行：工序號「${op.no||'空白'}」格式錯誤，必須使用 1–99，且不可有前導零。`
        });
      } else if(seen.has(op.no)){
        errors.push({
          code,
          vi:`Dòng ${op.row}: Số công đoạn ${op.no} bị trùng, xuất hiện lần đầu tại dòng ${seen.get(op.no)}.`,
          zh:`第 ${op.row} 行：工序號 ${op.no} 重複，首次出現在第 ${seen.get(op.no)} 行。`
        });
      } else {
        seen.set(op.no,op.row);
      }
    });
    const valid=[...seen.keys()].filter(normalizeProcessNo).sort(compareProcessNo);
    const max=valid.length?Math.max(...valid.map(Number)):0;
    for(let i=1;i<=max;i++){
      const expected=String(i);
      if(!seen.has(expected)) errors.push({
        code,
        vi:`Thiếu số công đoạn ${expected}.`,
        zh:`缺少工序號 ${expected}。`
      });
    }
  });
  return errors;
}

function validateRequiredImportFields(rows){
  const fields=['款號','客人','中文名稱','越文名稱','尺寸','工序號','加工','工序中文','工序越文','秒數'];
  const viFields=['Mã hàng','Khách hàng','Tên Trung','Tên Việt','Kích thước','Số công đoạn','Phân loại','Tên công đoạn Trung','Tên công đoạn Việt','Giây'];
  const errors=[];
  rows.forEach(r=>{
    const code=String(r[0]??'').trim()||'Không rõ / 未知';
    fields.forEach((field,i)=>{
      if(String(r[i]??'').trim()==='') errors.push({
        code,
        vi:`Dòng ${r._excelRow}: ${viFields[i]} không được để trống.`,
        zh:`第 ${r._excelRow} 行：${field}不得空白。`
      });
    });
    const category=String(r[6]??'');
    if(category&& !Object.prototype.hasOwnProperty.call(PROCESS_CATEGORIES,category)){
      errors.push({
        code,
        vi:`Dòng ${r._excelRow}: Phân loại「${category}」không hợp lệ, chỉ được dùng BL, SX, QC hoặc DG.`,
        zh:`第 ${r._excelRow} 行：加工分類「${category}」無效，只允許 BL、SX、QC、DG。`
      });
    }
    const sec=String(r[9]??'').trim();
    if(sec!==''&&(!Number.isFinite(Number(sec))||Number(sec)<=0)) errors.push({
      code,
      vi:`Dòng ${r._excelRow}: Giây của công đoạn ${r[5]} phải lớn hơn 0:「${sec}」.`,
      zh:`第 ${r._excelRow} 行：工序號 ${r[5]} 的秒數必須大於 0：「${sec}」。`
    });
  });
  return errors;
}

function renderImportErrors(errors){
  const codes=[...new Set(errors.map(e=>e.code).filter(Boolean))];
  const shown=errors.slice(0,10);
  let html=`<div>Phát hiện ${errors.length} lỗi trong ${codes.length} mã hàng.</div>
    <div style="margin-bottom:8px">發現 ${codes.length} 個款號，共 ${errors.length} 筆錯誤。</div>`;
  const grouped={};
  shown.forEach(e=>{
    const code=e.code||'Khác / 其他';
    if(!grouped[code]) grouped[code]=[];
    grouped[code].push(e);
  });
  Object.entries(grouped).forEach(([code,list])=>{
    const total=errors.filter(e=>(e.code||'Khác / 其他')===code).length;
    html+=`<div style="margin-top:8px;font-weight:600">▼ ${code}　${total} lỗi / ${total} 筆錯誤</div>`;
    list.forEach(e=>{
      html+=`<div style="margin:5px 0 0 18px">${e.vi}<br><span style="color:var(--err)">${e.zh}</span></div>`;
    });
  });
  if(errors.length>10) html+=`<div style="margin-top:10px">Hiển thị 10/${errors.length} lỗi.<br>目前顯示 10/${errors.length} 筆錯誤。</div>`;
  return html;
}

function setProg(p,l,s){
  g('pw-wrap').style.display='block';
  g('pw-bar').style.width=p+'%';
  g('pw-label').textContent=l;
  g('pw-sub').textContent=s||'';
}
function hideProg(){ g('pw-wrap').style.display='none'; }

function resetDetailImportDisplay(){
  ['imp-prev','dup-warn','imp-ok','imp-err'].forEach(id=>g(id).style.display='none');
  hideProg();
}

function openDetailImportModal(){
  resetDetailImportDisplay();
  om('m-detail-import');
}

function closeDetailImportModal(){
  resetDetailImportDisplay();
  pImp=null; nItms=null; dups=[]; g('fi').value='';
  cm('m-detail-import');
}

function handleDetailImportDragOver(event){
  event.preventDefault();
  event.dataTransfer.dropEffect='copy';
  g('detail-import-drop').classList.add('dragging');
}

function handleDetailImportDragLeave(event){
  event.preventDefault();
  g('detail-import-drop').classList.remove('dragging');
}

function handleDetailImportDrop(event){
  event.preventDefault();
  g('detail-import-drop').classList.remove('dragging');
  const file=event.dataTransfer.files[0];
  if(!file) return;
  openDetailImportModal();
  if(!/\.(xlsx|xls)$/i.test(file.name)){
    g('imp-err').style.display='flex';
    g('imp-err-msg').textContent='只支援 .xlsx 或 .xls 檔案';
    return;
  }
  processDetailImportFile(file);
}

function hImport(input){
  const file=input.files[0]; if(!file) return;
  openDetailImportModal();
  processDetailImportFile(file);
}

function processDetailImportFile(file){
  g('imp-err').style.display='none';
  setProg(10,'Đang đọc file... / 正在讀取檔案...','');
  setTimeout(()=>{
    const reader=new FileReader();
    reader.onerror=function(){
      hideProg();
      g('imp-err').style.display='flex';
      g('imp-err-msg').innerHTML='無法讀取檔案，請確認格式是否正確 / Không thể đọc file.';
      g('fi').value='';
    };
    reader.onload=function(e){
      try{
        setProg(40,'Đang kiểm tra dữ liệu... / 正在驗證資料...','');
        setTimeout(()=>{
          try{
            const wb=XLSX.read(e.target.result,{type:'binary'});
            const ws=wb.Sheets[wb.SheetNames[0]];
            const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
            const dr=rows.map((r,i)=>{ r._excelRow=i+1; return r; }).filter(r=>{
              const values=r.slice(0,10).map(v=>String(v??'').trim());
              return values.some(Boolean)&&!['款號','mã hàng','Mã hàng'].includes(values[0]);
            });
            const errs=validateRequiredImportFields(dr);
            errs.push(...validateImportProcessRows(dr));
            if(errs.length>0){
              hideProg();
              g('imp-err').style.display='flex';
              g('imp-err-msg').innerHTML=renderImportErrors(errs);
              g('fi').value=''; return;
            }
            setProg(70,'Đang xử lý mã hàng... / 正在整理款號...','');
            setTimeout(()=>{
              try{
                const ni={};
                dr.forEach(r=>{
                  const code=String(r[0]).trim();
                  if(!ni[code]) ni[code]={code,client:String(r[1]).trim(),zh:String(r[2]).trim(),vi:String(r[3]).trim(),sz:String(r[4]).trim(),ops:[]};
                  ni[code].ops.push({no:normalizeProcessNo(r[5]),category:String(r[6]),zh:String(r[7]).trim(),vi:String(r[8]).trim(),sec:+r[9]});
                });
                nItms=ni;
                dups=Object.keys(ni).filter(code=>window.D.find(d=>d.code===code));
                setProg(100,'Hoàn tất / 完成！',`Tìm thấy / 找到 ${Object.keys(ni).length} mã hàng/款號`);
                setTimeout(()=>{
                  hideProg();
                  const prev=g('imp-prev'); prev.style.display='block';
                  const thead=document.querySelector('#prev-tbl thead');
                  const tbody=document.querySelector('#prev-tbl tbody');
                  thead.innerHTML='<tr><th>Mã hàng/款號</th><th>Khách/客人</th><th>Tên TQ/中文</th><th>Tên VN/越文</th><th>Size/尺寸</th><th>Số CĐ/工序號</th><th>Phân loại/加工</th><th>CĐ(TQ)</th><th>CĐ(VN)</th><th>Giây/秒數</th></tr>';
                  tbody.innerHTML='';
                  dr.slice(0,5).forEach(r=>{
                    const isDup=dups.includes(String(r[0]).trim());
                    const tr=document.createElement('tr');
                    tr.innerHTML=`<td>${isDup?'<span class="tg tr2">Trùng/重複</span> ':''}<b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td><td>${r[6]}</td><td>${r[7]}</td><td>${r[8]}</td><td>${r[9]}</td>`;
                    tbody.appendChild(tr);
                  });
                },500);
              }catch(err){ hideProg(); g('imp-err').style.display='flex'; g('imp-err-msg').innerHTML='處理資料失敗：'+err.message; }
              finally{ g('fi').value=''; }
            },300);
          }catch(err){ hideProg(); g('imp-err').style.display='flex'; g('imp-err-msg').innerHTML='讀取工作表失敗：'+err.message; }
          finally{ g('fi').value=''; }
        },200);
      }catch(err){ hideProg(); g('imp-err').style.display='flex'; g('imp-err-msg').innerHTML='檔案格式錯誤：'+err.message; }
      finally{ g('fi').value=''; }
    };
    reader.readAsBinaryString(file);
  },100);
}

function chkDup(){
  if(!nItms) return;
  if(dups.length>0){
    g('imp-prev').style.display='none';
    g('dup-warn').style.display='block';
    g('dup-list').innerHTML=dups.map(code=>{
      const ex=window.D.find(d=>d.code===code), inc=nItms[code];
      return`<div class="di"><span><b>${code}</b> ${ex.zh}</span><span style="color:var(--mu)">${ex.ops.length} CĐ → ${inc.ops.length} CĐ</span></div>`;
    }).join('');
  } else cImp('al');
}

async function cImp(mode){
  if(!nItms) return;
  const nd=Object.values(nItms);
  let ow=0,sk=0,added=0;
  nd.forEach(x=>{
    const isDup=dups.includes(x.code);
    if(isDup){
      if(mode==='sk'){ sk++; return; }
      const i=window.D.findIndex(d=>d.code===x.code);
      window.D[i]=x; ow++;
    } else {
      window.D.push(x); added++;
    }
  });
  const actualCount=added+ow;
  const to=nd.filter(x=>!dups.includes(x.code)||mode!=='sk').reduce((a,d)=>a+d.ops.length,0);
  const hist={t:new Date().toLocaleString('zh-TW'),u:window.cu.user,c:actualCount,o:to,ow,sk};
  window.impHist.push(hist);
  try{ localStorage.setItem('impHist',JSON.stringify(window.impHist)); }catch(e){}
  let msg=`✓ 本機已更新：${actualCount} 款，${to} 工序`;
  if(ow) msg+=`，覆蓋 ${ow} 款`;
  if(sk) msg+=`，跳過 ${sk} 款`;
  g('imp-ok-msg').textContent=msg;
  g('imp-ok').style.display='flex';
  ['dup-warn','imp-prev'].forEach(id=>g(id).style.display='none');
  pImp=null; nItms=null; dups=[]; g('fi').value='';
  rSum(); rDet(); rExp(); rBk(); rHist();
  if(window.saveProductsToFB && window.saveHistoryToFB){
    const ok1=await saveProductsToFB();
    const ok2=await saveHistoryToFB();
    if(ok1&&ok2){ g('imp-ok-msg').textContent=msg.replace('本機已更新','雲端已同步'); }
    else{ g('imp-ok-msg').textContent=msg+' ⚠️ 雲端同步失敗，資料已暫存本機'; }
  }
}

function xImp(){
  closeDetailImportModal();
}

// ===== 匯出報表 =====
function rExp(){
  const cf=(g('ex-cl')||{}).value||'';
  const tb=g('ex-tb'); if(!tb) return; tb.innerHTML='';
  window.D.filter(d=>!cf||d.client===cf).forEach(d=>{
    let s=0; d.ops.forEach(op=>{ s+=calc(op.sec).vnd; });
    const r=document.createElement('tr');
    r.innerHTML=`<td><b style="color:var(--navy)">${d.code}</b></td><td>${d.client}</td><td>${d.zh}</td><td>${d.sz}</td><td>${d.ops.length}</td><td style="color:var(--accent);font-weight:500">${fU(s)}</td><td>${fV(s)}</td><td>${fT(s)}</td>`;
    tb.appendChild(r);
  });
}

function doExport(){
  try{
    const cf=g('ex-cl').value, ty=g('ex-ty').value;
    const fd=window.D.filter(d=>!cf||d.client===cf);
    const mkBd=()=>({top:{style:'thin',color:{rgb:'595959'}},bottom:{style:'thin',color:{rgb:'595959'}},left:{style:'thin',color:{rgb:'595959'}},right:{style:'thin',color:{rgb:'595959'}}});
    const mkBdH=()=>({top:{style:'thin',color:{rgb:'2D5F8E'}},bottom:{style:'thin',color:{rgb:'2D5F8E'}},left:{style:'thin',color:{rgb:'2D5F8E'}},right:{style:'thin',color:{rgb:'2D5F8E'}}});
    const hStyle=()=>({font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'1A3A5C'}},alignment:{horizontal:'center'},border:mkBdH()});
    const normStyle=()=>({border:mkBd()});
    const altStyle=()=>({fill:{fgColor:{rgb:'F8FAFC'}},border:mkBd()});
    const numVND=()=>({numFmt:'#,##0',border:mkBd()});
    const numUSD=()=>({numFmt:'#,##0.00',border:mkBd()});
    const numTWD=()=>({numFmt:'#,##0.0',border:mkBd()});
    const numVNDAlt=()=>({numFmt:'#,##0',fill:{fgColor:{rgb:'F8FAFC'}},border:mkBd()});
    const numUSDAlt=()=>({numFmt:'#,##0.00',fill:{fgColor:{rgb:'F8FAFC'}},border:mkBd()});
    const numTWDAlt=()=>({numFmt:'#,##0.0',fill:{fgColor:{rgb:'F8FAFC'}},border:mkBd()});
    const subStyle=()=>({font:{bold:true,color:{rgb:'166534'}},fill:{fgColor:{rgb:'DCFCE7'}},border:mkBd()});
    const subNumVND=()=>({font:{bold:true,color:{rgb:'166534'}},fill:{fgColor:{rgb:'DCFCE7'}},numFmt:'#,##0',border:mkBd()});
    const subNumUSD=()=>({font:{bold:true,color:{rgb:'166534'}},fill:{fgColor:{rgb:'DCFCE7'}},numFmt:'#,##0.00',border:mkBd()});
    const subNumTWD=()=>({font:{bold:true,color:{rgb:'166534'}},fill:{fgColor:{rgb:'DCFCE7'}},numFmt:'#,##0.0',border:mkBd()});

    function fillBorders(ws,totalCols,totalRows){
      for(let r=1;r<=totalRows;r++){
        for(let c=0;c<totalCols;c++){
          const cell=String.fromCharCode(65+c)+r;
          if(!ws[cell]) ws[cell]={v:'',t:'s',s:normStyle()};
          else if(!ws[cell].s) ws[cell].s=normStyle();
          else if(!ws[cell].s.border) ws[cell].s.border=mkBd();
        }
      }
    }

    // 總表 sheet
    const showUSD=!['vnd','twd'].includes(ty);
    const showVND=!['usd','twd'].includes(ty);
    const showTWD=['twd','all'].includes(ty);
    const sumHeaders=['款號','客人','中文名稱','越文名稱','尺寸','工序數'];
    if(showUSD) sumHeaders.push('總工價(USD)');
    if(showVND) sumHeaders.push('總工價(VND)');
    if(showTWD) sumHeaders.push('總工價(TWD)');
    const wsSum={'!ref':'A1'};
    sumHeaders.forEach((h,i)=>{ wsSum[String.fromCharCode(65+i)+'1']={v:h,s:hStyle()}; });
    let row=2;
    fd.forEach((d,di)=>{
      let sv=0; d.ops.forEach(op=>{ sv+=calc(op.sec).vnd; });
      const isAlt=di%2===1;
      const ns=isAlt?altStyle():normStyle();
      const vals=[d.code,d.client,d.zh,d.vi||'',d.sz,d.ops.length];
      if(showUSD) vals.push(sv/window.S.usd);
      if(showVND) vals.push(sv);
      if(showTWD) vals.push(sv/window.S.twd);
      vals.forEach((v,i)=>{
        const cell=String.fromCharCode(65+i)+row;
        if(i===6&&showUSD) wsSum[cell]={v,s:isAlt?numUSDAlt():numUSD()};
        else if((i===7&&showUSD&&showVND)||(i===6&&!showUSD&&showVND)) wsSum[cell]={v,s:isAlt?numVNDAlt():numVND()};
        else if(showTWD&&i===vals.length-1) wsSum[cell]={v,s:isAlt?numTWDAlt():numTWD()};
        else wsSum[cell]={v:String(v||''),t:'s',s:ns};
      });
      row++;
    });
    fillBorders(wsSum,sumHeaders.length,row-1);
    wsSum['!ref']='A1:'+String.fromCharCode(65+sumHeaders.length-1)+row;
    wsSum['!cols']=[{wch:14},{wch:12},{wch:22},{wch:22},{wch:8},{wch:8},{wch:14},{wch:14},{wch:14}].slice(0,sumHeaders.length);
    wsSum['!freeze']={xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft'};
    wsSum['!autofilter']={ref:'A1:'+String.fromCharCode(65+sumHeaders.length-1)+'1'};
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,wsSum,'款號總成本');

    // 明細 sheet
    if(ty==='detail'){
      const detHeaders=['款號','客人','中文名稱','工序號','加工','工序中文','工序越文','秒數','產量/小時'];
      if(showUSD) detHeaders.push('工價(USD)');
      if(showVND) detHeaders.push('工價(VND)');
      if(showTWD) detHeaders.push('工價(TWD)');
      const wsDet={'!ref':'A1'};
      detHeaders.forEach((h,i)=>{ wsDet[String.fromCharCode(65+i)+'1']={v:h,s:hStyle()}; });
      let drow=2; let di2=0;
      fd.forEach(d=>{
        d.ops.forEach(op=>{
          const r=calc(op.sec); const isAlt=di2%2===1;
          const ns=isAlt?altStyle():normStyle();
          const vals=[d.code,d.client,d.zh,op.no,op.category,op.zh,op.vi||'',op.sec,r.qty];
          if(showUSD) vals.push(r.vnd/window.S.usd);
          if(showVND) vals.push(r.vnd);
          if(showTWD) vals.push(r.vnd/window.S.twd);
          vals.forEach((v,i)=>{
            const cell=String.fromCharCode(65+i)+drow;
            if(i>=9) wsDet[cell]={v,s:isAlt?(i===9&&showUSD?numUSDAlt():i===9&&!showUSD&&showVND?numVNDAlt():numTWDAlt()):(i===9&&showUSD?numUSD():i===9&&!showUSD&&showVND?numVND():numTWD())};
            else wsDet[cell]={v:typeof v==='number'?v:String(v||''),t:typeof v==='number'?'n':'s',s:ns};
          });
          drow++; di2++;
        });
      });
      fillBorders(wsDet,detHeaders.length,drow-1);
      wsDet['!ref']='A1:'+String.fromCharCode(65+detHeaders.length-1)+drow;
      wsDet['!cols']=[{wch:14},{wch:12},{wch:22},{wch:8},{wch:20},{wch:20},{wch:8},{wch:10},{wch:12},{wch:12},{wch:12}].slice(0,detHeaders.length);
      wsDet['!freeze']={xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft'};
      XLSX.utils.book_append_sheet(wb,wsDet,'工序明細');
    }

    const fname='工序成本_'+new Date().toLocaleDateString('zh-TW').replace(/\//g,'-')+'.xlsx';
    XLSX.writeFile(wb,fname);
    const n=g('ex-ok'); n.style.display='flex'; setTimeout(()=>n.style.display='none',3000);
  }catch(err){ alert('匯出失敗：'+err.message); console.error(err); }
}

// ===== 備份匯出 =====
function rBk(){
  const cf=g('bk-client')?.value||'';
  const fd=window.D.filter(d=>!cf||d.client===cf);
  const cl=[...new Set(window.D.map(d=>d.client))];
  const bkSel=g('bk-client');
  if(bkSel){
    const cv=bkSel.value;
    bkSel.innerHTML='<option value="">Tất cả / 全部</option>';
    cl.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; bkSel.appendChild(o); });
    if(cl.includes(cv)) bkSel.value=cv;
  }
  let totalOps=0; fd.forEach(d=>totalOps+=d.ops.length);
  const tb=g('bk-stats'); if(!tb) return;
  tb.innerHTML=`
    <div class="mc"><div class="ml">款號數</div><div class="mvi">Số mã hàng</div><div class="mv">${fd.length}</div></div>
    <div class="mc"><div class="ml">工序總數</div><div class="mvi">Tổng công đoạn</div><div class="mv">${totalOps}</div></div>
    <div class="mc"><div class="ml">客人數</div><div class="mvi">Số khách hàng</div><div class="mv">${cl.length}</div></div>`;
}

function doBackup(){
  try{
    const cf=g('bk-client').value;
    const fd=window.D.filter(d=>!cf||d.client===cf);
    const mkBd=()=>({top:{style:'thin',color:{rgb:'595959'}},bottom:{style:'thin',color:{rgb:'595959'}},left:{style:'thin',color:{rgb:'595959'}},right:{style:'thin',color:{rgb:'595959'}}});
    const mkBdH=()=>({top:{style:'thin',color:{rgb:'2D5F8E'}},bottom:{style:'thin',color:{rgb:'2D5F8E'}},left:{style:'thin',color:{rgb:'2D5F8E'}},right:{style:'thin',color:{rgb:'2D5F8E'}}});
    const hStyle=()=>({font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'1A3A5C'}},alignment:{horizontal:'center',vertical:'center'},border:mkBdH()});
    const normStyle=()=>({border:mkBd()});
    const altStyle=()=>({fill:{fgColor:{rgb:'F8FAFC'}},border:mkBd()});
    const numRight=()=>({alignment:{horizontal:'right'},border:mkBd()});
    const numRightAlt=()=>({alignment:{horizontal:'right'},fill:{fgColor:{rgb:'F8FAFC'}},border:mkBd()});
    const txtFmt=()=>({numFmt:'@',border:mkBd()});
    const txtFmtAlt=()=>({numFmt:'@',fill:{fgColor:{rgb:'F8FAFC'}},border:mkBd()});
    const headers=['款號','客人','中文名稱','越文名稱','尺寸','工序號','加工','工序中文','工序越文','秒數'];
    const ws={'!ref':'A1'};
    headers.forEach((h,i)=>{ ws[String.fromCharCode(65+i)+'1']={v:h,s:hStyle()}; });
    let row=2; let di=0;
    fd.forEach(d=>{
      d.ops.forEach(op=>{
        const isAlt=di%2===1;
        const vals=[d.code,d.client,d.zh,d.vi||'',d.sz,op.no,op.category,op.zh,op.vi||'',op.sec];
        vals.forEach((v,i)=>{
          const cell=String.fromCharCode(65+i)+row;
          if(i===5) ws[cell]={v:String(v),t:'s',s:isAlt?txtFmtAlt():txtFmt()};
          else if(i===9) ws[cell]={v:Number(v),s:isAlt?numRightAlt():numRight()};
          else ws[cell]={v:String(v||''),t:'s',s:isAlt?altStyle():normStyle()};
        });
        row++; di++;
      });
    });
    for(let r=1;r<row;r++){
      for(let c=0;c<headers.length;c++){
        const cell=String.fromCharCode(65+c)+r;
        if(!ws[cell]) ws[cell]={v:'',t:'s',s:normStyle()};
        else if(!ws[cell].s) ws[cell].s=normStyle();
        else if(!ws[cell].s.border) ws[cell].s.border=mkBd();
      }
    }
    ws['!ref']='A1:J'+row;
    ws['!cols']=[{wch:14},{wch:12},{wch:22},{wch:22},{wch:8},{wch:8},{wch:10},{wch:20},{wch:20},{wch:8}];
    ws['!freeze']={xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft'};
    ws['!autofilter']={ref:'A1:J1'};
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'備份資料');
    const fname='備份_'+new Date().toLocaleDateString('zh-TW').replace(/\//g,'-')+'.xlsx';
    XLSX.writeFile(wb,fname);
    const n=g('bk-ok');
    g('bk-ok-msg').textContent=`✓ 已匯出 ${fd.length} 個款號，${fd.reduce((a,d)=>a+d.ops.length,0)} 道工序 / Đã xuất ${fd.length} mã hàng.`;
    n.style.display='flex'; setTimeout(()=>n.style.display='none',4000);
  }catch(err){ alert('匯出失敗：'+err.message); console.error(err); }
}

// ===== 匯入記錄 =====
function rHist(){
  const el=g('hist-list'); if(!el) return;
  if(!window.impHist.length){ el.innerHTML='<p style="color:var(--mu);font-size:13px">Chưa có lịch sử / 尚無記錄</p>'; return; }
  el.innerHTML=window.impHist.slice().reverse().map(h=>`<div class="hi2"><i class="ti ti-file-spreadsheet" style="color:var(--accent)"></i><span style="color:var(--mu);min-width:140px">${h.t}</span><span style="color:var(--mu)">${h.u}</span><span class="tg tb2">${h.c} mã/款號</span><span class="tg tg2">${h.o} CĐ/工序</span>${h.ow?`<span class="tg ta">Ghi đè/覆蓋 ${h.ow}</span>`:''}</div>`).join('');
}

// ===== 成本變動記錄 =====
function openHistoryModal(){
  rHist();
  om('m-history');
}

function openBackupModal(){
  rBk();
  om('m-backup');
}

function rClog(){
  const el=g('clog-list'); if(!el) return;
  if(!window.cLog.length){ el.innerHTML='<p style="color:var(--mu);font-size:13px">Chưa có lịch sử / 尚無記錄</p>'; return; }
  el.innerHTML=window.cLog.slice().reverse().map(log=>`
    <div style="margin-bottom:14px;border:1px solid var(--bd);border-radius:10px;overflow:hidden">
      <div style="background:#f8fafc;padding:9px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--bd)">
        <i class="ti ti-clock" style="color:var(--accent)"></i>
        <span style="font-size:12px;color:var(--mu)">${log.t}</span>
        <span class="tg tn">${log.u}</span>
        <span class="tg tb2">${log.ch.length} thay đổi / 項變更</span>
      </div>
      <div style="padding:4px 0">
        ${log.ch.map(c=>{
          const up=c.a>c.b;
          return`<div class="cc">
            <span style="min-width:100px;font-weight:500;font-size:12px">${c.f}</span>
            <span style="color:var(--mu);font-size:12px">${Number(c.b).toLocaleString()}</span>
            <i class="ti ti-arrow-right" style="color:var(--hi);font-size:12px"></i>
            <span style="font-weight:500;font-size:12px">${Number(c.a).toLocaleString()}</span>
            ${c.p?`<span class="tg ${up?'tr2':'tg2'}">${up?'▲':'▼'} ${Math.abs(c.p)}%</span>`:''}
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}
