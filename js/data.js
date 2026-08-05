// ===== 匯入 =====
let nItms=null, dups=[], detailImportFileName='';
const PROCESS_CATEGORIES={BL:'備料',SX:'生產',QC:'品檢',DG:'包裝'};
const dataSafeText=value=>window.PCMSSafe.text(value); // dataSafeText（資料畫面安全文字）
const dataSafeError=error=>window.PCMSSafe.errorMessage(error); // dataSafeError（資料畫面安全錯誤訊息）
function processCategoryLabel(code){ return PROCESS_CATEGORIES[code]||code||'—'; }

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
      if(i===7) return;
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
    html+=`<div style="margin-top:8px;font-weight:600">▼ ${dataSafeText(code)}　${total} lỗi / ${total} 筆錯誤</div>`;
    list.forEach(e=>{
      html+=`<div style="margin:5px 0 0 18px">${dataSafeText(e.vi)}<br><span style="color:var(--err)">${dataSafeText(e.zh)}</span></div>`;
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
  nItms=null; dups=[]; detailImportFileName=''; g('fi').value='';
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

async function processDetailImportFile(file){
  g('imp-err').style.display='none';
  detailImportFileName=String(file?.name||'').slice(0,300);
  try{
    await window.PCMSFeatures.ensureSpreadsheetTool();
  }catch(error){
    g('imp-err').style.display='flex';
    g('imp-err-msg').textContent='Không thể tải công cụ Excel. / 無法載入 Excel（表格檔）工具。';
    g('fi').value='';
    return;
  }
  setProg(10,'Đang đọc file... / 正在讀取檔案...','');
  setTimeout(()=>{
    const reader=new FileReader();
    reader.onerror=function(){
      hideProg();
      g('imp-err').style.display='flex';
      g('imp-err-msg').textContent='Không thể đọc file, vui lòng kiểm tra định dạng. / 無法讀取檔案，請確認格式是否正確。';
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
                    tr.innerHTML=`<td>${isDup?'<span class="tg tr2">Trùng/重複</span> ':''}<b>${dataSafeText(r[0])}</b></td><td>${dataSafeText(r[1])}</td><td>${dataSafeText(r[2])}</td><td>${dataSafeText(r[3])}</td><td>${dataSafeText(r[4])}</td><td>${dataSafeText(r[5])}</td><td>${dataSafeText(r[6])}</td><td>${dataSafeText(r[7])}</td><td>${dataSafeText(r[8])}</td><td>${dataSafeText(r[9])}</td>`;
                    tbody.appendChild(tr);
                  });
                },500);
              }catch(err){ hideProg(); g('imp-err').style.display='flex'; g('imp-err-msg').textContent='Xử lý dữ liệu thất bại / 處理資料失敗：'+String(err?.message||''); }
              finally{ g('fi').value=''; }
            },300);
          }catch(err){ hideProg(); g('imp-err').style.display='flex'; g('imp-err-msg').textContent='Không thể đọc bảng tính / 讀取工作表失敗：'+String(err?.message||''); }
          finally{ g('fi').value=''; }
        },200);
      }catch(err){ hideProg(); g('imp-err').style.display='flex'; g('imp-err-msg').textContent='Định dạng tệp không đúng / 檔案格式錯誤：'+String(err?.message||''); }
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
      return`<div class="di"><span><b>${dataSafeText(code)}</b> ${dataSafeText(ex.zh)}</span><span style="color:var(--mu)">${ex.ops.length} CĐ → ${inc.ops.length} CĐ</span></div>`;
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
      ow++;
    } else {
      added++;
    }
  });
  const actualCount=added+ow;
  const to=nd.filter(x=>!dups.includes(x.code)||mode!=='sk').reduce((a,d)=>a+d.ops.length,0);
  const hist={c:actualCount,o:to,ow,sk,fileName:detailImportFileName};
  const changedItems=nd.filter(x=>!dups.includes(x.code)||mode!=='sk');
  let msgVi=`✓ Đã đồng bộ lên đám mây: ${actualCount} mã, ${to} công đoạn`;
  let msgZh=`雲端已同步：${actualCount} 款，${to} 工序`;
  if(ow){ msgVi+=`, ghi đè ${ow} mã`; msgZh+=`，覆蓋 ${ow} 款`; }
  if(sk){ msgVi+=`, bỏ qua ${sk} mã`; msgZh+=`，跳過 ${sk} 款`; }
  const msg=`<div>${msgVi}</div><div>${msgZh}</div>`;

  g('imp-ok-msg').textContent=`Đang đồng bộ lên đám mây / 正在同步雲端：${actualCount} 款，${to} 工序`;
  g('imp-ok').style.display='flex';
  if(window.saveProductItemsToFB && window.saveHistoryToFB){
    const ok1=await saveProductItemsToFB(changedItems);
    if(!ok1){
      const failMsg=window.lastProductSyncError || '❌ Nhập thất bại, dữ liệu chính thức chưa cập nhật. Vui lòng kiểm tra mạng rồi nhập lại file Excel / 匯入失敗，正式資料未更新。請確認網路後重新匯入 Excel（表格檔）';
      if(window.lastProductSyncError){
        g('imp-ok-msg').innerHTML=window.PCMSSafe.lines(failMsg);
      } else {
        g('imp-ok-msg').textContent=failMsg;
      }
      if(window.setSyncState) window.setSyncState('failed', failMsg);
      return;
    }

    changedItems.forEach(x=>{
      const i=window.D.findIndex(d=>d.code===x.code);
      if(i>=0) window.D[i]=x;
      else window.D.push(x);
    });
    let savedHistory=null;
    try{
      savedHistory=await saveHistoryToFB(hist);
    }catch(error){
      console.error('Không thể lưu operationLogs / 無法儲存操作紀錄：',error);
    }
    if(!savedHistory){
      g('imp-ok-msg').innerHTML=msg+'<div>⚠️ Lịch sử nhập không lưu được lên đám mây, không lưu tạm trên máy này</div><div>匯入紀錄無法保存到雲端，未暫存在本機</div>';
    } else {
      window.impHist=[savedHistory,...(window.impHist||[])].slice(0,50);
    }
    ['dup-warn','imp-prev'].forEach(id=>g(id).style.display='none');
    nItms=null; dups=[]; detailImportFileName=''; g('fi').value='';
    rSum(); rDet(); rExp(); rBk(); rHist();
    if(savedHistory) g('imp-ok-msg').innerHTML=msg;
  } else {
    g('imp-ok-msg').textContent='❌ Không thể đồng bộ / 無法同步：Firebase 功能尚未載入，正式款號資料未更新';
  }
}

function xImp(){
  closeDetailImportModal();
}

// ===== 產品工價匯出 =====
function rExp(){
  if(typeof canOpenPage==='function'&&!canOpenPage('export')) return;
  const cf=(g('ex-cl')||{}).value||'';
  const tb=g('ex-tb'); if(!tb) return; tb.innerHTML='';
  const showCosts=true; // showCosts（顯示產品工價）：進入本分頁已通過獨立權限檢查。
  const currencyGroup=g('ex-cu-group');
  if(currencyGroup) currencyGroup.style.display=showCosts?'':'none';
  const head=g('ex-th');
  if(head){
    head.innerHTML='<th>Mã hàng<br><span class="tv">款號</span></th><th>Khách hàng<br><span class="tv">客人</span></th><th>Tên Trung<br><span class="tv">中文名稱</span></th><th>Kích thước<br><span class="tv">尺寸</span></th><th>Số công đoạn<br><span class="tv">工序數</span></th>'
      +(showCosts?'<th>Tổng giá công (USD)<br><span class="tv">總工價（美元）</span></th><th>Tổng giá công (VND)<br><span class="tv">總工價（越盾）</span></th><th>Tổng giá công (TWD)<br><span class="tv">總工價（台幣）</span></th>':'');
  }
  window.D.filter(d=>!cf||d.client===cf).forEach(d=>{
    let s=0; d.ops.forEach(op=>{ s+=calc(op.sec).vnd; });
    const r=document.createElement('tr');
    r.innerHTML=`<td><b style="color:var(--navy)">${dataSafeText(d.code)}</b></td><td>${dataSafeText(d.client)}</td><td>${dataSafeText(d.zh)}</td><td>${dataSafeText(d.sz)}</td><td>${d.ops.length}</td>`
      +(showCosts?`<td style="color:var(--accent);font-weight:500">${fU(s)}</td><td>${fV(s)}</td><td>${fT(s)}</td>`:'');
    tb.appendChild(r);
  });
}

// showSpreadsheetSaveUnsupported（顯示不支援選擇表格檔儲存位置的提示）。
function showSpreadsheetSaveUnsupported(){
  alert(
    'Trình duyệt này không hỗ trợ chọn vị trí lưu tệp.\n' +
    'Vui lòng sử dụng phiên bản Microsoft Edge hoặc Google Chrome mới nhất.\n\n' +
    '此瀏覽器不支援選擇檔案儲存位置。\n' +
    '請使用最新版 Microsoft Edge 或 Google Chrome。'
  );
}

// chooseSpreadsheetSaveHandle（選擇表格檔儲存位置）：必須由使用者點擊匯出後直接呼叫。
async function chooseSpreadsheetSaveHandle(suggestedName){
  if(typeof window.showSaveFilePicker !== 'function'){
    showSpreadsheetSaveUnsupported();
    return null;
  }
  try{
    return await window.showSaveFilePicker({
      suggestedName,
      types:[{
        description:'Tệp Excel / Excel 表格檔',
        // application/vnd.openxmlformats-officedocument.spreadsheetml.sheet（Excel 表格檔內容類型）。
        accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}
      }],
      excludeAcceptAllOption:true
    });
  }catch(error){
    if(error?.name==='AbortError') return null;
    if(error?.name==='SecurityError'||error?.name==='NotAllowedError'){
      showSpreadsheetSaveUnsupported();
      return null;
    }
    throw error;
  }
}

// writeSpreadsheetWorkbookToHandle（將表格活頁簿寫入使用者選擇的位置）。
async function writeSpreadsheetWorkbookToHandle(fileHandle,workbook){
  const workbookBytes=XLSX.write(workbook,{bookType:'xlsx',type:'array'}); // workbookBytes（活頁簿位元資料）。
  const spreadsheetBlob=new Blob(
    [workbookBytes],
    // spreadsheetBlob（表格檔資料）；type（內容類型）使用 Excel 表格檔標準值。
    {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
  );
  const writable=await fileHandle.createWritable(); // writable（可寫入檔案串流）。
  let completed=false; // completed（是否寫入完成）。
  try{
    await writable.write(spreadsheetBlob);
    await writable.close();
    completed=true;
  }finally{
    if(!completed){
      try{ await writable.abort(); }catch(_){}
    }
  }
}

async function doExport(){
  if(typeof canOpenPage==='function'&&!canOpenPage('export')){
    alert('Không có quyền xuất giá công sản phẩm / 沒有產品工價匯出權限');
    return;
  }
  try{
    const cf=g('ex-cl').value;
    const currencyType=g('ex-cu').value; // currencyType（幣別選項）。
    const reportType=g('ex-ty').value; // reportType（報表類型）。
    const showCosts=true; // showCosts（匯出產品工價）：分頁權限即代表允許匯出工價。
    const fname='產品工價_'+new Date().toLocaleDateString('zh-TW').replace(/\//g,'-')+'.xlsx';
    const saveHandle=await chooseSpreadsheetSaveHandle(fname); // saveHandle（使用者選擇的儲存位置）。
    if(!saveHandle) return;
    await window.PCMSFeatures.ensureSpreadsheetTool();
    const fd=window.D.filter(d=>!cf||d.client===cf);
    const mkBd=()=>({top:{style:'thin',color:{rgb:'595959'}},bottom:{style:'thin',color:{rgb:'595959'}},left:{style:'thin',color:{rgb:'595959'}},right:{style:'thin',color:{rgb:'595959'}}});
    const mkBdH=()=>({top:{style:'thin',color:{rgb:'2D5F8E'}},bottom:{style:'thin',color:{rgb:'2D5F8E'}},left:{style:'thin',color:{rgb:'2D5F8E'}},right:{style:'thin',color:{rgb:'2D5F8E'}}});
    const hStyle=()=>({font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'1A3A5C'}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:mkBdH()});
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

    // makeCurrencyCell（建立可在 Excel 內調整小數位數的數字儲存格）。
    function makeCurrencyCell(value,currencyType,isAlt){
      const numberFormat=currencyType==='usd'?'#,##0.00':currencyType==='twd'?'#,##0.0':'#,##0'; // numberFormat（預設數字格式）。
      const style=isAlt
        ? (currencyType==='usd'?numUSDAlt():currencyType==='twd'?numTWDAlt():numVNDAlt())
        : (currencyType==='usd'?numUSD():currencyType==='twd'?numTWD():numVND());
      return {v:Number(value),t:'n',z:numberFormat,s:style}; // n（數字類型）；z（Excel 預設顯示格式）。
    }

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
    const showUSD=!['vnd','twd'].includes(currencyType);
    const showVND=!['usd','twd'].includes(currencyType);
    const showTWD=['twd','all'].includes(currencyType);
    const vndPerUsd=safePositiveNumber(window.S?.usd,25400); // vndPerUsd（每美元兌越盾匯率）。
    const vndPerTwd=safePositiveNumber(window.S?.twd,780); // vndPerTwd（每台幣兌越盾匯率）。
    const twdPerUsd=vndPerUsd/vndPerTwd; // twdPerUsd（本表實際匯率推算的每美元兌台幣匯率）。
    const twdPerUsdLabel=twdPerUsd.toFixed(2); // twdPerUsdLabel（美台匯率表頭文字）。
    const vndPerTwdLabel=Number(vndPerTwd.toFixed(2)).toString(); // vndPerTwdLabel（台越匯率表頭文字）。
    const currencyColumns=[]; // currencyColumns（依匯出順序排列的幣別欄位）。
    if(showCosts&&showUSD) currencyColumns.push({type:'usd',header:`總工價(USD)\n(美台匯率 ${twdPerUsdLabel})`,value:v=>v/vndPerUsd}); // usd（美元）。
    if(showCosts&&showTWD) currencyColumns.push({type:'twd',header:`總工價(TWD)\n(台越匯率 ${vndPerTwdLabel})`,value:v=>v/vndPerTwd}); // twd（新臺幣）。
    if(showCosts&&showVND) currencyColumns.push({type:'vnd',header:'總工價(VND)',value:v=>v}); // vnd（越南盾）。
    const sumHeaders=['款號','客人','中文名稱','越文名稱','尺寸','工序數',...currencyColumns.map(column=>column.header)];
    const wsSum={'!ref':'A1'};
    sumHeaders.forEach((h,i)=>{ wsSum[String.fromCharCode(65+i)+'1']={v:h,s:hStyle()}; });
    wsSum['!rows']=[{hpt:34}];
    let row=2;
    fd.forEach((d,di)=>{
      let sv=0; d.ops.forEach(op=>{ sv+=calc(op.sec).vnd; });
      const isAlt=di%2===1;
      const ns=isAlt?altStyle():normStyle();
      const vals=[d.code,d.client,d.zh,d.vi||'',d.sz,d.ops.length];
      currencyColumns.forEach(column=>vals.push(column.value(sv)));
      vals.forEach((v,i)=>{
        const cell=String.fromCharCode(65+i)+row;
        if(i>=6) wsSum[cell]=makeCurrencyCell(v,currencyColumns[i-6].type,isAlt);
        else if(i===5) wsSum[cell]={v:Number(v)||0,t:'n',z:'0',s:{...ns,numFmt:'0'}}; // n（數字類型）；工序數以整數儲存。
        else wsSum[cell]={v:String(v||''),t:'s',s:ns};
      });
      row++;
    });
    fillBorders(wsSum,sumHeaders.length,row-1);
    wsSum['!ref']='A1:'+String.fromCharCode(65+sumHeaders.length-1)+row;
    wsSum['!cols']=[
      {wch:14},{wch:12},{wch:22},{wch:22},{wch:8},{wch:8},
      ...currencyColumns.map(()=>({wch:20}))
    ]; // currencyColumns（幣別欄位）加寬，避免第二行匯率被篩選按鈕遮住。
    wsSum['!freeze']={xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft'};
    wsSum['!autofilter']={ref:'A1:'+String.fromCharCode(65+sumHeaders.length-1)+'1'};
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,wsSum,showCosts?'款號總成本':'款號總表');

    // 明細 sheet
    if(reportType==='detail'){
      const detHeaders=['款號','客人','中文名稱','工序號','加工','工序中文','工序越文','秒數','產量/小時',...currencyColumns.map(column=>column.header)];
      const wsDet={'!ref':'A1'};
      detHeaders.forEach((h,i)=>{ wsDet[String.fromCharCode(65+i)+'1']={v:h,s:hStyle()}; });
      wsDet['!rows']=[{hpt:34}];
      let drow=2; let di2=0;
      fd.forEach(d=>{
        d.ops.forEach(op=>{
          const r=calc(op.sec); const isAlt=di2%2===1;
          const ns=isAlt?altStyle():normStyle();
          const vals=[d.code,d.client,d.zh,op.no,op.category,op.zh,op.vi||'',op.sec,r.qty];
          currencyColumns.forEach(column=>vals.push(column.value(r.vnd)));
          vals.forEach((v,i)=>{
            const cell=String.fromCharCode(65+i)+drow;
            if(i>=9) wsDet[cell]=makeCurrencyCell(v,currencyColumns[i-9].type,isAlt);
            else wsDet[cell]={v:typeof v==='number'?v:String(v||''),t:typeof v==='number'?'n':'s',s:ns};
          });
          drow++; di2++;
        });
      });
      fillBorders(wsDet,detHeaders.length,drow-1);
      wsDet['!ref']='A1:'+String.fromCharCode(65+detHeaders.length-1)+drow;
      wsDet['!cols']=[
        {wch:14},{wch:12},{wch:22},{wch:8},{wch:20},{wch:20},{wch:8},{wch:10},{wch:12},
        ...currencyColumns.map(()=>({wch:20}))
      ]; // currencyColumns（幣別欄位）加寬，完整顯示第二行匯率。
      wsDet['!freeze']={xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft'};
      wsDet['!autofilter']={ref:'A1:'+String.fromCharCode(65+detHeaders.length-1)+'1'}; // autofilter（自動篩選）：在明細表第一列表頭提供篩選與排序。
      XLSX.utils.book_append_sheet(wb,wsDet,'工序明細');
    }

    await writeSpreadsheetWorkbookToHandle(saveHandle,wb);
    if(window.saveOperationLogToFB){
      try{
        await saveOperationLogToFB({
          permissionKey:'export',
          feature:'cost',
          action:'productCostExport',
          status:'success',
          itemCount:fd.length,
          detailCount:fd.reduce((sum,item)=>sum+item.ops.length,0),
          fileName:saveHandle.name||fname
        });
      }catch(logError){
        console.error('Không thể lưu operationLogs / 無法儲存操作紀錄：',logError);
        alert('Đã xuất tệp, nhưng không thể lưu lịch sử thao tác.\n檔案已匯出，但操作紀錄無法保存。');
      }
    }
    const n=g('ex-ok'); n.style.display='flex'; setTimeout(()=>n.style.display='none',3000);
  }catch(err){ alert('Xuất thất bại / 匯出失敗：'+err.message); console.error(err); }
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

async function doBackup(){
  try{
    const cf=g('bk-client').value;
    const fname='備份_'+new Date().toLocaleDateString('zh-TW').replace(/\//g,'-')+'.xlsx';
    const saveHandle=await chooseSpreadsheetSaveHandle(fname); // saveHandle（使用者選擇的儲存位置）。
    if(!saveHandle) return;
    await window.PCMSFeatures.ensureSpreadsheetTool();
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
    await writeSpreadsheetWorkbookToHandle(saveHandle,wb);
    if(window.saveOperationLogToFB){
      try{
        await saveOperationLogToFB({
          permissionKey:'summary',
          feature:'products',
          action:'productBackupExport',
          status:'success',
          itemCount:fd.length,
          detailCount:fd.reduce((sum,item)=>sum+item.ops.length,0),
          fileName:saveHandle.name||fname
        });
      }catch(logError){
        console.error('Không thể lưu operationLogs / 無法儲存操作紀錄：',logError);
        alert('Đã xuất tệp, nhưng không thể lưu lịch sử thao tác.\n檔案已匯出，但操作紀錄無法保存。');
      }
    }
    const n=g('bk-ok');
    g('bk-ok-msg').textContent=`✓ 已匯出 ${fd.length} 個款號，${fd.reduce((a,d)=>a+d.ops.length,0)} 道工序 / Đã xuất ${fd.length} mã hàng.`;
    n.style.display='flex'; setTimeout(()=>n.style.display='none',4000);
  }catch(err){ alert('Xuất thất bại / 匯出失敗：'+err.message); console.error(err); }
}

// ===== 匯入記錄 =====
function rHist(){
  const el=g('hist-list'); if(!el) return;
  if(!window.impHist.length){ el.innerHTML='<p style="color:var(--mu);font-size:13px">Chưa có lịch sử / 尚無記錄</p>'; return; }
  el.innerHTML=window.impHist.map(h=>{
    const time=h.createdAt?new Date(h.createdAt).toLocaleString('zh-TW'):h.t;
    const user=h.createdBy||h.u||'';
    const count=h.itemCount??h.c??0;
    const details=h.detailCount??h.o??0;
    const overwritten=h.overwriteCount??h.ow??0;
    return`<div class="hi2"><i class="ti ti-file-spreadsheet" style="color:var(--accent)"></i><span style="color:var(--mu);min-width:140px">${dataSafeText(time)}</span><span style="color:var(--mu)">${dataSafeText(user)}</span><span class="tg tb2">${Number(count)||0} mã/款號</span><span class="tg tg2">${Number(details)||0} CĐ/工序</span>${Number(overwritten)>0?`<span class="tg ta">Ghi đè/覆蓋 ${Number(overwritten)}</span>`:''}</div>`;
  }).join('');
}

// ===== 成本變動記錄 =====
function rClog(){
  const el=g('clog-list'); if(!el) return;
  if(!canViewCosts()){
    el.innerHTML='<p style="color:var(--mu);font-size:13px">Không có quyền xem giá công / 沒有查看工價權限</p>';
    return;
  }
  if(!window.cLog.length){ el.innerHTML='<p style="color:var(--mu);font-size:13px">Chưa có lịch sử / 尚無記錄</p>'; return; }
  el.innerHTML=window.cLog.map(log=>{
    const changes=Array.isArray(log.changes)?log.changes:(Array.isArray(log.ch)?log.ch:[]);
    const time=log.createdAt?new Date(log.createdAt).toLocaleString('zh-TW'):log.t;
    const user=log.createdBy||log.u||'';
    return`
    <div style="margin-bottom:14px;border:1px solid var(--bd);border-radius:10px;overflow:hidden">
      <div style="background:#f8fafc;padding:9px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--bd)">
        <i class="ti ti-clock" style="color:var(--accent)"></i>
        <span style="font-size:12px;color:var(--mu)">${dataSafeText(time)}</span>
        <span class="tg tn">${dataSafeText(user)}</span>
        <span class="tg tb2">${changes.length} thay đổi / 項變更</span>
      </div>
      <div style="padding:4px 0">
        ${changes.map(c=>{
          const before=c.before??c.b??0;
          const after=c.after??c.a??0;
          const percent=c.percent??c.p??null;
          const field=c.field??c.f??'';
          const up=after>before;
          return`<div class="cc">
            <span style="min-width:100px;font-weight:500;font-size:12px">${dataSafeText(field)}</span>
            <span style="color:var(--mu);font-size:12px">${Number(before).toLocaleString()}</span>
            <i class="ti ti-arrow-right" style="color:var(--hi);font-size:12px"></i>
            <span style="font-weight:500;font-size:12px">${Number(after).toLocaleString()}</span>
            ${percent?`<span class="tg ${up?'tr2':'tg2'}">${up?'▲':'▼'} ${Math.abs(percent)}%</span>`:''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}
