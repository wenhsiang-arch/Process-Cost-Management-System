// ===== 匯入 =====
let nItms=null, dups=[], detailImportFileName='';
let dataImportProgressController=null; // dataImportProgressController（產品匯入共用進度視窗控制介面）
const PROCESS_CATEGORIES={BL:'備料',SX:'生產',QC:'品檢',DG:'包裝'};
const EXPORT_PREVIEW_PAGE_SIZE=50; // EXPORT_PREVIEW_PAGE_SIZE（產品工價預覽每頁筆數）
const EXPORT_PREVIEW_CURRENCIES=Object.freeze({
  vnd:{vi:'Tổng giá công (VND)',zh:'總工價（越盾）',format:value=>fV(value)},
  usd:{vi:'Tổng giá công (USD)',zh:'總工價（美元）',format:value=>fU(value)},
  twd:{vi:'Tổng giá công (TWD)',zh:'總工價（台幣）',format:value=>fT(value)}
}); // EXPORT_PREVIEW_CURRENCIES（產品工價預覽幣別設定）
window.exportPreviewPage=1; // exportPreviewPage（產品工價預覽目前頁碼）
window.exportPreviewCurrency='vnd'; // exportPreviewCurrency（產品工價預覽目前幣別）
const dataSafeText=value=>window.PCMSSafe.text(value); // dataSafeText（資料畫面安全文字）
const dataSafeError=error=>window.PCMSSafe.errorMessage(error); // dataSafeError（資料畫面安全錯誤訊息）
function dataMessage(vi,zh,kind='info'){
  return window.PCMSUIComponents.alertDialog({message:{vi:String(vi||''),zh:String(zh||'')},kind});
}
function setDataBilingual(targetId,vi,zh){
  const target=g(targetId);
  if(!target) return;
  if(!vi&&!zh){ target.replaceChildren(); return; }
  target.replaceChildren(window.PCMSUIComponents.createLanguageSections({vi:String(vi||''),zh:String(zh||'')}));
}
function splitDataBilingual(value){
  return String(value||'').split('\n').reduce((result,line)=>{
    const separator=line.lastIndexOf(' / ');
    if(separator<0){ if(line){ result.vi.push(line); result.zh.push(line); } }
    else{
      result.vi.push(line.slice(0,separator));
      result.zh.push(line.slice(separator+3));
    }
    return result;
  },{vi:[],zh:[]});
}
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
  const grouped={};
  shown.forEach(e=>{
    const code=e.code||'Khác / 其他';
    if(!grouped[code]) grouped[code]=[];
    grouped[code].push(e);
  });
  const buildLanguage=(language,summary,more)=>{
    let content=`<div>${summary}</div>`;
    Object.entries(grouped).forEach(([code,list])=>{
      const total=errors.filter(e=>(e.code||'Khác / 其他')===code).length;
      content+=`<div style="margin-top:8px;font-weight:600">▼ ${dataSafeText(code)}　${total} ${language==='vi'?'lỗi':'筆錯誤'}</div>`;
      list.forEach(error=>{ content+=`<div style="margin:5px 0 0 18px">${dataSafeText(error[language])}</div>`; });
    });
    if(errors.length>10) content+=`<div style="margin-top:10px">${more}</div>`;
    return content;
  }; // buildLanguage（建立單一語言錯誤內容）
  const vi=buildLanguage('vi',`Phát hiện ${errors.length} lỗi trong ${codes.length} mã hàng.`,`Hiển thị 10/${errors.length} lỗi.`);
  const zh=buildLanguage('zh',`發現 ${codes.length} 個款號，共 ${errors.length} 筆錯誤。`,`目前顯示 10/${errors.length} 筆錯誤。`);
  return `<div class="ui-language-sections"><div class="ui-language-section">${vi}</div><div class="ui-language-section">${zh}</div></div>`;
}

function setProg(p,l,s){
  const wrap=g('pw-wrap');
  if(wrap) wrap.style.display='none';
  const labelPair=splitDataBilingual(l);
  const subPair=splitDataBilingual(s||'');
  const value=Math.max(0,Math.min(100,Number(p)||0)); // value（產品匯入百分比進度）
  const textPair={vi:labelPair.vi.join('\n'),zh:labelPair.zh.join('\n')}; // textPair（產品匯入雙語進度文字）
  const detailPair={
    vi:subPair.vi.join('\n')||'Vui lòng chờ, không đóng cửa sổ này.',
    zh:subPair.zh.join('\n')||'請稍候，不要關閉此視窗。'
  }; // detailPair（產品匯入雙語補充文字）
  if(!dataImportProgressController){
    dataImportProgressController=window.PCMSUIComponents.progressDialog({
      title:{vi:'Tiến độ nhập dữ liệu sản phẩm',zh:'產品資料匯入進度'},
      value,
      text:textPair,
      detail:detailPair,
      onClose:()=>{ dataImportProgressController=null; }
    });
  }else{
    dataImportProgressController.update({value,text:textPair,detail:detailPair});
  }
  if(value>=100) dataImportProgressController.complete(textPair,detailPair);
}
function hideProg(){
  const wrap=g('pw-wrap');
  if(wrap) wrap.style.display='none';
  dataImportProgressController?.close('program');
  dataImportProgressController=null;
}

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
    setDataBilingual('imp-err-msg','Chỉ hỗ trợ tệp .xlsx hoặc .xls.','只支援 .xlsx 或 .xls 檔案。');
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
    setDataBilingual('imp-err-msg','Không thể tải công cụ bảng tính.','無法載入表格檔工具。');
    g('fi').value='';
    return;
  }
  setProg(10,'Đang đọc file... / 正在讀取檔案...','');
  setTimeout(()=>{
    const reader=new FileReader();
    reader.onerror=function(){
      hideProg();
      g('imp-err').style.display='flex';
      setDataBilingual('imp-err-msg','Không thể đọc tệp, vui lòng kiểm tra định dạng.','無法讀取檔案，請確認格式是否正確。');
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
                setProg(100,'Hoàn tất / 完成！',`Đã tìm thấy ${Object.keys(ni).length} mã hàng. / 找到 ${Object.keys(ni).length} 個款號。`);
                setTimeout(()=>{
                  hideProg();
                  const prev=g('imp-prev'); prev.style.display='block';
                  const thead=document.querySelector('#prev-tbl thead');
                  const tbody=document.querySelector('#prev-tbl tbody');
                  thead.innerHTML='<tr><th>Mã hàng<br><span class="tv">款號</span></th><th>Khách hàng<br><span class="tv">客人</span></th><th>Tên Trung<br><span class="tv">中文名稱</span></th><th>Tên Việt<br><span class="tv">越文名稱</span></th><th>Kích thước<br><span class="tv">尺寸</span></th><th>Số công đoạn<br><span class="tv">工序號</span></th><th>Phân loại<br><span class="tv">加工分類</span></th><th>Công đoạn Trung<br><span class="tv">工序中文</span></th><th>Công đoạn Việt<br><span class="tv">工序越文</span></th><th>Giây<br><span class="tv">秒數</span></th></tr>';
                  tbody.innerHTML='';
                  dr.slice(0,5).forEach(r=>{
                    const isDup=dups.includes(String(r[0]).trim());
                    const tr=document.createElement('tr');
                    tr.innerHTML=`<td>${isDup?'<span class="tg tr2">Trùng/重複</span> ':''}<b>${dataSafeText(r[0])}</b></td><td>${dataSafeText(r[1])}</td><td>${dataSafeText(r[2])}</td><td>${dataSafeText(r[3])}</td><td>${dataSafeText(r[4])}</td><td>${dataSafeText(r[5])}</td><td>${dataSafeText(r[6])}</td><td>${dataSafeText(r[7])}</td><td>${dataSafeText(r[8])}</td><td>${dataSafeText(r[9])}</td>`;
                    tbody.appendChild(tr);
                  });
                },500);
              }catch(err){ console.error('Xử lý dữ liệu thất bại / 處理資料失敗',err); hideProg(); g('imp-err').style.display='flex'; setDataBilingual('imp-err-msg','Xử lý dữ liệu thất bại.','處理資料失敗。'); }
              finally{ g('fi').value=''; }
            },300);
          }catch(err){ console.error('Không thể đọc bảng tính / 讀取工作表失敗',err); hideProg(); g('imp-err').style.display='flex'; setDataBilingual('imp-err-msg','Không thể đọc bảng tính.','讀取工作表失敗。'); }
          finally{ g('fi').value=''; }
        },200);
      }catch(err){ console.error('Định dạng tệp không đúng / 檔案格式錯誤',err); hideProg(); g('imp-err').style.display='flex'; setDataBilingual('imp-err-msg','Định dạng tệp không đúng.','檔案格式錯誤。'); }
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
  const msg=`<div class="ui-language-sections"><div class="ui-language-section">${msgVi}</div><div class="ui-language-section">${msgZh}</div></div>`;

  setDataBilingual('imp-ok-msg',`Đang đồng bộ lên đám mây: ${actualCount} mã, ${to} công đoạn.`,`正在同步雲端：${actualCount} 款，${to} 工序。`);
  g('imp-ok').style.display='flex';
  if(window.saveProductItemsToFB && window.saveHistoryToFB){
    const ok1=await saveProductItemsToFB(changedItems);
    if(!ok1){
      const failMsg=window.lastProductSyncError || '❌ Nhập thất bại, dữ liệu chính thức chưa cập nhật. Vui lòng kiểm tra mạng rồi nhập lại tệp bảng tính. / 匯入失敗，正式資料未更新。請確認網路後重新匯入表格檔。';
      setDataBilingual('imp-ok-msg','❌ Nhập thất bại, dữ liệu chính thức chưa cập nhật. Vui lòng kiểm tra mạng rồi nhập lại tệp bảng tính.','匯入失敗，正式資料未更新。請確認網路後重新匯入表格檔。');
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
      g('imp-ok-msg').innerHTML=`<div class="ui-language-sections"><div class="ui-language-section">${msgVi}<br>⚠️ Lịch sử nhập không lưu được lên đám mây và không được lưu tạm trên máy này.</div><div class="ui-language-section">${msgZh}<br>匯入紀錄無法保存到雲端，亦未暫存在本機。</div></div>`;
    } else {
      window.impHist=[savedHistory,...(window.impHist||[])].slice(0,50);
    }
    ['dup-warn','imp-prev'].forEach(id=>g(id).style.display='none');
    nItms=null; dups=[]; detailImportFileName=''; g('fi').value='';
    rSum(); rDet(); rExp(); rBk(); rHist();
    if(savedHistory) g('imp-ok-msg').innerHTML=msg;
  } else {
    setDataBilingual('imp-ok-msg','❌ Không thể đồng bộ vì dịch vụ dữ liệu đám mây chưa sẵn sàng; dữ liệu chính thức chưa cập nhật.','❌ 無法同步：雲端資料庫服務尚未載入，正式款號資料未更新。');
  }
}

function xImp(){
  closeDetailImportModal();
}

// ===== 產品工價匯出 =====
function syncExportClientOptions(){
  const select=g('ex-cl'); // select（產品工價預覽客人選單）
  if(!select) return;
  const clients=[...new Set((window.D||[]).map(item=>String(item?.client||'').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b)); // clients（目前款號資料內的客人清單）
  const signature=clients.join('\u001f'); // signature（客人選項內容識別字串）
  if(select.dataset.optionsSignature===signature) return;
  const currentValue=select.value; // currentValue（重新建立前的客人篩選值）
  select.replaceChildren();
  const allOption=document.createElement('option'); // allOption（全部客人選項）
  allOption.value='';
  allOption.textContent='Tất cả / 全部';
  select.appendChild(allOption);
  clients.forEach(client=>{
    const option=document.createElement('option'); // option（單一客人選項）
    option.value=client;
    option.textContent=client;
    select.appendChild(option);
  });
  select.dataset.optionsSignature=signature;
  select.value=clients.includes(currentValue)?currentValue:'';
}

function updateExportPreviewCurrencyButtons(){
  Object.keys(EXPORT_PREVIEW_CURRENCIES).forEach(currency=>{
    const button=g(`ex-preview-${currency}`); // button（產品工價預覽幣別按鈕）
    if(!button) return;
    const active=currency===window.exportPreviewCurrency; // active（按鈕是否為目前幣別）
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-pressed',String(active));
  });
}

function setExportPreviewCurrency(currency){
  if(!EXPORT_PREVIEW_CURRENCIES[currency]) return;
  window.exportPreviewCurrency=currency;
  window.exportPreviewPage=1;
  rExp();
}

function setExportClientFilter(){
  window.exportPreviewPage=1;
  rExp();
}

function goExportPreviewPage(page){
  window.exportPreviewPage=Math.max(1,Number(page)||1);
  rExp();
}

function rExp(){
  if(typeof canOpenPage==='function'&&!canOpenPage('export')) return;
  const page=g('pg-export'); // page（產品工價匯出頁面）
  if(!page||!page.classList.contains('active')) return;
  syncExportClientOptions();
  const cf=(g('ex-cl')||{}).value||'';
  const tb=g('ex-tb'); if(!tb) return; tb.innerHTML='';
  const currencyGroup=g('ex-cu-group');
  if(currencyGroup) currencyGroup.style.display='';
  const currency=EXPORT_PREVIEW_CURRENCIES[window.exportPreviewCurrency]
    ||EXPORT_PREVIEW_CURRENCIES.vnd; // currency（目前產品工價預覽幣別設定）
  window.exportPreviewCurrency=Object.keys(EXPORT_PREVIEW_CURRENCIES)
    .find(key=>EXPORT_PREVIEW_CURRENCIES[key]===currency)||'vnd';
  updateExportPreviewCurrencyButtons();
  const head=g('ex-th');
  if(head){
    head.innerHTML='<th>Mã hàng<br><span class="tv">款號</span></th><th>Khách hàng<br><span class="tv">客人</span></th><th>Tên Trung<br><span class="tv">中文名稱</span></th><th>Kích thước<br><span class="tv">尺寸</span></th><th>Số công đoạn<br><span class="tv">工序數</span></th>'
      +`<th>${currency.vi}<br><span class="tv">${currency.zh}</span></th>`;
  }
  const filtered=(window.D||[]).filter(item=>!cf||item.client===cf); // filtered（符合客人條件的全部款號）
  const totalPages=Math.max(1,Math.ceil(filtered.length/EXPORT_PREVIEW_PAGE_SIZE)); // totalPages（產品工價預覽總頁數）
  window.exportPreviewPage=Math.min(Math.max(1,Number(window.exportPreviewPage)||1),totalPages);
  const start=(window.exportPreviewPage-1)*EXPORT_PREVIEW_PAGE_SIZE; // start（目前頁面起始位置）
  filtered.slice(start,start+EXPORT_PREVIEW_PAGE_SIZE).forEach(d=>{
    const operations=Array.isArray(d.ops)?d.ops:[]; // operations（款號工序清單）
    let totalVnd=0; operations.forEach(op=>{ totalVnd+=calc(op.sec).vnd; }); // totalVnd（款號越盾總工價）
    const r=document.createElement('tr');
    r.innerHTML=`<td><b style="color:var(--navy)">${dataSafeText(d.code)}</b></td><td>${dataSafeText(d.client)}</td><td>${dataSafeText(d.zh)}</td><td>${dataSafeText(d.sz)}</td><td>${operations.length}</td><td class="export-preview-amount">${currency.format(totalVnd)}</td>`;
    tb.appendChild(r);
  });
  mkPager('ex-pager',window.exportPreviewPage,filtered.length,EXPORT_PREVIEW_PAGE_SIZE,'goExportPreviewPage');
}

// showSpreadsheetSaveUnsupported（顯示不支援選擇表格檔儲存位置的提示）。
function showSpreadsheetSaveUnsupported(){
  return dataMessage(
    'Trình duyệt này không hỗ trợ chọn vị trí lưu tệp.\nVui lòng sử dụng trình duyệt mới nhất có hỗ trợ chức năng này.',
    '此瀏覽器不支援選擇檔案儲存位置。\n請使用支援此功能的最新版瀏覽器。',
    'warning'
  );
}

async function doExport(){
  if(typeof canOpenPage==='function'&&!canOpenPage('export')){
    await dataMessage('Không có quyền xuất giá công sản phẩm.','沒有產品工價匯出權限。','warning');
    return;
  }
  try{
    const cf=g('ex-cl').value;
    const currencyType=g('ex-cu').value; // currencyType（幣別選項）。
    const reportType=g('ex-ty').value; // reportType（報表類型）。
    const showCosts=true; // showCosts（匯出產品工價）：分頁權限即代表允許匯出工價。
    const fname='產品工價_'+new Date().toLocaleDateString('zh-TW').replace(/\//g,'-')+'.xlsx';
    const saveHandle=await window.PCMSFileIO.chooseSaveHandle({
      suggestedName:fname,
      types:[window.PCMSFileIO.spreadsheetFileType],
      onUnsupported:showSpreadsheetSaveUnsupported
    }); // saveHandle（使用者選擇的儲存位置）
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

    await window.PCMSFileIO.writeWorkbookToHandle(saveHandle,wb,window.XLSX);
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
        await dataMessage('Đã xuất tệp, nhưng không thể lưu lịch sử thao tác.','檔案已匯出，但操作紀錄無法保存。','warning');
      }
    }
    const n=g('ex-ok'); n.style.display='flex'; setTimeout(()=>n.style.display='none',3000);
  }catch(err){
    console.error('Xuất tệp thất bại / 檔案匯出失敗',err);
    await dataMessage('Xuất tệp thất bại. Vui lòng kiểm tra rồi thử lại.','檔案匯出失敗，請檢查後再試。','danger');
  }
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
    <div class="mc"><div class="ml">Số mã hàng</div><div class="mvi">款號數</div><div class="mv">${fd.length}</div></div>
    <div class="mc"><div class="ml">Tổng công đoạn</div><div class="mvi">工序總數</div><div class="mv">${totalOps}</div></div>
    <div class="mc"><div class="ml">Số khách hàng</div><div class="mvi">客人數</div><div class="mv">${cl.length}</div></div>`;
}

async function doBackup(){
  try{
    const cf=g('bk-client').value;
    const fname='備份_'+new Date().toLocaleDateString('zh-TW').replace(/\//g,'-')+'.xlsx';
    const saveHandle=await window.PCMSFileIO.chooseSaveHandle({
      suggestedName:fname,
      types:[window.PCMSFileIO.spreadsheetFileType],
      onUnsupported:showSpreadsheetSaveUnsupported
    }); // saveHandle（使用者選擇的儲存位置）
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
    await window.PCMSFileIO.writeWorkbookToHandle(saveHandle,wb,window.XLSX);
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
        await dataMessage('Đã xuất tệp, nhưng không thể lưu lịch sử thao tác.','檔案已匯出，但操作紀錄無法保存。','warning');
      }
    }
    const n=g('bk-ok');
    g('bk-ok-msg').innerHTML=`<div class="ui-language-sections"><div class="ui-language-section is-vi">✓ Đã xuất ${fd.length} mã hàng, ${fd.reduce((a,d)=>a+d.ops.length,0)} công đoạn.</div><div class="ui-language-section is-zh">✓ 已匯出 ${fd.length} 個款號，${fd.reduce((a,d)=>a+d.ops.length,0)} 道工序。</div></div>`;
    n.style.display='flex'; setTimeout(()=>n.style.display='none',4000);
  }catch(err){
    console.error('Xuất tệp sao lưu thất bại / 備份檔匯出失敗',err);
    await dataMessage('Xuất tệp sao lưu thất bại. Vui lòng kiểm tra rồi thử lại.','備份檔匯出失敗，請檢查後再試。','danger');
  }
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

// openImportHistory（開啟款號匯入歷史）：使用者實際點擊後才讀取，切換頁面不預先呼叫。
async function openImportHistory(force=false){
  try{
    if(typeof window.ensureImportHistoryLoaded!=='function'){
      throw new Error('Chức năng lịch sử chưa sẵn sàng / 歷史功能尚未就緒');
    }
    await window.ensureImportHistoryLoaded({limit:50,force});
    rHist();
    om('m-history');
  }catch(error){
    console.error('Không thể tải lịch sử nhập mã hàng / 無法載入款號匯入歷史：',error);
    await dataMessage('Không thể tải lịch sử nhập.','無法載入匯入歷史。','danger');
  }
}

// ===== 成本變動記錄 =====
function rClog(){
  const el=g('clog-list'); if(!el) return;
  if(typeof canOpenPage==='function'&&!canOpenPage('costlog')){
    el.innerHTML='<div class="cost-log-empty"><div>Không có quyền xem lịch sử chi phí</div><div>沒有查看成本歷史權限</div></div>';
    return;
  }
  if(!window.cLog.length){ el.innerHTML='<div class="cost-log-empty"><div>Chưa có lịch sử</div><div>尚無記錄</div></div>'; return; }
  const fieldLabels={
    '平均薪資':{vi:'Lương bình quân',zh:'平均薪資'},
    '平均保險':{vi:'Bảo hiểm bình quân',zh:'平均保險'},
    '餐費':{vi:'Chi phí bữa ăn',zh:'餐費'},
    '匯率USD':{vi:'Tỷ giá đô la Mỹ',zh:'美元匯率'},
    '匯率TWD':{vi:'Tỷ giá Đài tệ',zh:'台幣匯率'},
    '工作秒數/小時':{vi:'Giây làm việc mỗi giờ',zh:'工作秒數／小時'},
    '生產效率(%)':{vi:'Hiệu suất sản xuất',zh:'生產效率'},
    '平均時薪':{vi:'Lương giờ bình quân',zh:'平均時薪'}
  }; // fieldLabels（成本欄位顯示文字）：只轉換畫面，不改既有紀錄資料。
  el.innerHTML=window.cLog.map(log=>{
    const changes=Array.isArray(log.changes)?log.changes:(Array.isArray(log.ch)?log.ch:[]);
    const time=log.createdAt?new Date(log.createdAt).toLocaleString('zh-TW'):log.t;
    const user=log.createdBy||log.u||'';
    return`
    <div class="cost-log-card">
      <div class="cost-log-head">
        <i class="ti ti-clock" style="color:var(--accent)"></i>
        <span style="font-size:12px;color:var(--mu)">${dataSafeText(time)}</span>
        <span class="tg tn">${dataSafeText(user)}</span>
        <span class="tg tb2">${changes.length} thay đổi / ${changes.length} 項變更</span>
      </div>
      <div class="cost-log-body">
        ${changes.map(c=>{
          const before=c.before??c.b??0;
          const after=c.after??c.a??0;
          const percent=c.percent??c.p??null;
          const field=c.field??c.f??'';
          const label=fieldLabels[field]||{vi:field,zh:field};
          const up=after>before;
          return`<div class="cc">
            <span style="min-width:130px;font-weight:500;font-size:12px">${dataSafeText(label.vi)}<span class="tv">${dataSafeText(label.zh)}</span></span>
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
