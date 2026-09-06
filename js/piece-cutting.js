// piece-cutting（裁片出單）：解析裁片主檔與訂單、顯示配對結果，並交給獨立本機工具產生 PDF（可攜式文件）。
(function(){
  const LOCAL_ORIGIN='http://127.0.0.1:8766';
  const HISTORY_ACTIONS=['pieceCuttingTemplateImport','pieceCuttingTemplateDelete','pieceCuttingPdfExport'];
  const state={initialized:false,authSession:null,activeTab:'order',meta:null,analysis:null,templateFile:null,pendingFile:null,pendingAnalysis:null,
    orderFiles:[],orderItems:[],orderErrors:[],orderNumbers:[],exportModel:null,history:[],historyLoaded:false,toolOnline:null};
  let fileDropRegistered=false,orderLoadRevision=0;

  const g=id=>document.getElementById(id);
  const safe=value=>window.PCMSSafe?.text?.(value)??String(value??'');
  const pair=(vi,zh)=>({vi:String(vi||''),zh:String(zh||'')});

  function message(vi,zh,kind='info'){
    return window.PCMSUIComponents?.alertDialog?.({kind,message:pair(vi,zh)})||Promise.resolve(false);
  }

  function normalizeText(value){
    return String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  }

  function normalizeKey(value){
    return normalizeText(value).toLocaleUpperCase('vi-VN');
  }

  function normalizeHeader(value){
    return normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/Đ/g,'D').replace(/đ/g,'d')
      .toUpperCase().replace(/[^A-Z0-9]/g,'');
  }

  function cellAddress(row,column){
    return XLSX.utils.encode_cell({r:row,c:column});
  }

  function mergeRangesForColumn(sheet,column){
    return (sheet?.['!merges']||[]).filter(range=>Number(range?.s?.c)<=column&&Number(range?.e?.c)>=column);
  }

  function mergedValue(sheet,row,column,ranges){
    const range=ranges.find(item=>row>=item.s.r&&row<=item.e.r);
    const source=range?cellAddress(range.s.r,range.s.c):cellAddress(row,column);
    return {value:sheet?.[source]?.v??'',range:range||null};
  }

  function imageGroupKey(row,ranges){
    const range=ranges.find(item=>row>=item.s.r&&row<=item.e.r);
    return range?`G${range.s.r+1}:G${range.e.r+1}`:`G${row+1}`;
  }

  function scopedImageGroupKey(sheetIndex,row,ranges){
    return `S${sheetIndex+1}!${imageGroupKey(row,ranges)}`;
  }

  function detectTemplateHeader(rows){
    const expected=['MAHANG','SIZE','TENVATLIEU','BOPHANCAT','SOKIEN','GHICHU','HINHANH'];
    const limit=Math.min(rows.length,50);
    for(let row=0;row<limit;row+=1){
      if(expected.every((header,column)=>normalizeHeader(rows[row]?.[column])===header)) return row;
    }
    return -1;
  }

  function analyzeTemplateWorkbook(fileName,workbook){
    if(!Array.isArray(workbook?.SheetNames)||!workbook.SheetNames.length){
      throw new Error('Tệp mẫu không có trang tính.\n裁片主檔沒有工作表。');
    }
    const issues=[];
    const usable=[];
    const analyzedSheets=[];
    const productLocations=new Map();
    workbook.SheetNames.forEach((sheetName,sheetIndex)=>{
      const sheet=workbook.Sheets[sheetName];
      const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false});
      if(!rows.some(row=>(row||[]).some(cell=>normalizeText(cell)))) return;
      const headerRow=detectTemplateHeader(rows);
      if(headerRow<0){
        issues.push(`Trang tính "${sheetName}": không tìm thấy đủ 7 tiêu đề cố định từ cột A đến G. / 工作表「${sheetName}」：找不到 A 至 G 七個固定表頭。`);
        return;
      }
      analyzedSheets.push({sheetName,sheetIndex,headerRow:headerRow+1});
      const materialRanges=mergeRangesForColumn(sheet,2);
      const pictureRanges=mergeRangesForColumn(sheet,6);
      const groups=new Map();
      for(let row=headerRow+1;row<rows.length;row+=1){
        const code=normalizeText(rows[row]?.[0]);
        const size=normalizeText(rows[row]?.[1]);
        const material=normalizeText(mergedValue(sheet,row,2,materialRanges).value);
        const part=normalizeText(rows[row]?.[3]);
        const rawPieces=normalizeText(rows[row]?.[4]);
        const note=normalizeText(rows[row]?.[5]);
        if(!code&&!size&&!material&&!part&&!rawPieces&&!note) continue;
        const key=scopedImageGroupKey(sheetIndex,row,pictureRanges);
        if(!groups.has(key)) groups.set(key,{key,sheetIndex,sheetName,startRow:row+1,endRow:row+1,products:[],pieces:[]});
        const group=groups.get(key);
        group.endRow=row+1;
        if(code||size){
          if(!code||!size){
            issues.push(`Trang tính "${sheetName}" · dòng ${row+1}: mã hàng và size phải cùng có dữ liệu. / 工作表「${sheetName}」第 ${row+1} 列：款號與尺寸必須同時有值。`);
          }else{
            const codeKey=normalizeKey(code);
            const previous=productLocations.get(codeKey);
            if(previous){
              issues.push(`Trang tính "${sheetName}" · dòng ${row+1}: mã hàng ${code} bị trùng với trang tính "${previous.sheetName}" dòng ${previous.rowNumber}; mỗi mã chỉ được xuất hiện một lần. / 工作表「${sheetName}」第 ${row+1} 列：款號 ${code} 與工作表「${previous.sheetName}」第 ${previous.rowNumber} 列重複；每個款號只能出現一次。`);
            }else productLocations.set(codeKey,{code,sheetName,rowNumber:row+1});
            group.products.push({code,size,rowNumber:row+1,sheetName,sheetIndex});
          }
        }
        if(material||part||rawPieces||note){
          const pieces=Number(rawPieces);
          if(!material||!part||!Number.isSafeInteger(pieces)||pieces<1||pieces>999){
            issues.push(`Trang tính "${sheetName}" · dòng ${row+1}: vật liệu, bộ phận cắt và số kiện 1–999 phải hợp lệ. / 工作表「${sheetName}」第 ${row+1} 列：布料、裁片名稱及每件用量 1–999 必須完整有效。`);
          }else group.pieces.push({material,part,pieces,note,rowNumber:row+1,sheetName,sheetIndex,imageGroupKey:key});
        }
      }
      [...groups.values()].filter(group=>group.products.length||group.pieces.length).forEach(group=>usable.push(group));
    });
    usable.forEach(group=>{
      const location=`Trang tính "${group.sheetName}" · ${imageGroupKey(group.startRow-1,[{s:{r:group.startRow-1},e:{r:group.endRow-1}}])}`;
      const locationZh=`工作表「${group.sheetName}」· G${group.startRow}:G${group.endRow}`;
      if(!group.products.length) issues.push(`${location}: không có mã hàng và size. / ${locationZh}：沒有款號與尺寸。`);
      if(!group.pieces.length) issues.push(`${location}: không có dữ liệu bộ phận cắt. / ${locationZh}：沒有裁片資料。`);
      const pieceLocations=new Map();
      group.pieces.forEach(piece=>{
        const duplicateKey=`${normalizeKey(piece.material)}\u001f${normalizeKey(piece.part)}`;
        const previous=pieceLocations.get(duplicateKey);
        if(previous){
          issues.push(`Trang tính "${group.sheetName}" · dòng ${piece.rowNumber}: vật liệu "${piece.material}" và bộ phận cắt "${piece.part}" bị trùng với dòng ${previous.rowNumber} trong cùng nhóm hình; hãy gộp thành một dòng và điền đúng SỐ KIỆN. / 工作表「${group.sheetName}」第 ${piece.rowNumber} 列：布料「${piece.material}」與裁片「${piece.part}」和同圖片群組第 ${previous.rowNumber} 列重複；請合併成一列並填寫正確的 SỐ KIỆN。`);
        }else pieceLocations.set(duplicateKey,piece);
      });
    });
    if(!analyzedSheets.length&&!issues.length) issues.push('Không có trang tính chứa dữ liệu mẫu. / 找不到包含主檔資料的工作表。');
    if(!usable.length&&!issues.length) issues.push('Không có nhóm hình ảnh và dữ liệu cắt. / 找不到圖片群組與裁片資料。');
    if(issues.length){
      const error=new Error(`Mẫu có ${issues.length} lỗi cần sửa.\n模板有 ${issues.length} 筆需要修正的錯誤。`);
      error.issues=issues;
      throw error;
    }
    const products=new Map(),sizes=new Map(),materials=new Map();
    usable.forEach(group=>{
      group.products.forEach(item=>{ products.set(normalizeKey(item.code),item); sizes.set(normalizeKey(item.size),item.size); });
      group.pieces.forEach(item=>materials.set(normalizeKey(item.material),item.material));
    });
    const sheetName=analyzedSheets.length===1?analyzedSheets[0].sheetName:`${analyzedSheets.length} trang tính / ${analyzedSheets.length} 工作表`;
    return {schemaVersion:1,fileName,sheetName,sheetNames:analyzedSheets.map(item=>item.sheetName),groups:usable,
      productCount:products.size,sizeCount:sizes.size,materialCount:materials.size,
      pieceCount:usable.reduce((sum,group)=>sum+group.pieces.length,0),imageGroupCount:usable.length};
  }

  function buildExportModel(analysis,orderItems,orderLabel=''){
    const byCode=new Map();
    analysis.groups.forEach(group=>group.products.forEach(product=>{
      const key=normalizeKey(product.code);
      if(!byCode.has(key)) byCode.set(key,[]);
      byCode.get(key).push({group,product});
    }));
    const materialGroupMap=new Map(),missing=[],matched=[];
    orderItems.forEach(order=>{
      const occurrences=byCode.get(normalizeKey(order.code))||[];
      if(!occurrences.length){ missing.push(order); return; }
      matched.push(order);
      occurrences.forEach(({group,product})=>group.pieces.forEach(piece=>{
        const materialKey=normalizeKey(piece.material);
        const materialGroupKey=`${group.key}\u001f${materialKey}`;
        if(!materialGroupMap.has(materialGroupKey)) materialGroupMap.set(materialGroupKey,{material:piece.material,imageGroupKey:group.key,codes:new Map(),sizes:new Map(),products:new Map(),parts:new Map()});
        const material=materialGroupMap.get(materialGroupKey);
        material.codes.set(normalizeKey(product.code),product.code);
        material.sizes.set(normalizeKey(product.size),product.size);
        material.products.set(`${normalizeKey(product.code)}\u001f${normalizeKey(product.size)}`,{code:product.code,size:product.size});
        const partKey=normalizeKey(piece.part);
        if(!material.parts.has(partKey)) material.parts.set(partKey,{part:piece.part,noteEntries:new Map(),quantities:new Map()});
        const part=material.parts.get(partKey);
        if(piece.note){
          const noteKey=`${normalizeKey(product.code)}\u001f${normalizeKey(product.size)}\u001f${normalizeKey(piece.note)}`;
          part.noteEntries.set(noteKey,{code:product.code,size:product.size,part:piece.part,note:piece.note});
        }
        const sizeKey=normalizeKey(product.size);
        part.quantities.set(sizeKey,(part.quantities.get(sizeKey)||0)+(Number(order.qty)*piece.pieces));
      }));
    });
    const materials=[...materialGroupMap.values()].map(material=>({
      material:material.material,imageGroupKey:material.imageGroupKey,codes:[...material.codes.values()],sizes:[...material.sizes.values()],products:[...material.products.values()],imageGroups:[material.imageGroupKey],
      parts:[...material.parts.values()].map(part=>({part:part.part,noteEntries:[...part.noteEntries.values()],imageGroups:[material.imageGroupKey],
        quantities:Object.fromEntries([...part.quantities.entries()])}))
    }));
    return {schemaVersion:1,orderLabel,matched,missing,materials,
      materialCount:new Set(materials.map(item=>normalizeKey(item.material))).size,
      materialGroupCount:materials.length,
      totalQuantity:matched.reduce((sum,item)=>sum+Number(item.qty||0),0),
      totalPieces:materials.reduce((sum,material)=>sum+material.parts.reduce((partSum,part)=>partSum+Object.values(part.quantities).reduce((a,b)=>a+Number(b||0),0),0),0)};
  }

  function extractOrderHeading(value){
    const match=normalizeText(value).match(/^ORDER\s*(?:NO\.?|NUMBER)\s*[:：]?\s*(.*)$/i);
    return match?String(match[1]||'').trim():null;
  }

  function findOrderNumbers(rows){
    const values=[];
    rows.forEach(row=>(row||[]).forEach((cell,column)=>{
      let value=extractOrderHeading(cell);
      if(value===null) return;
      if(!value){
        for(let next=column+1;next<=Math.min((row||[]).length-1,column+12);next+=1){
          value=normalizeText(row[next]).replace(/^[:：]\s*/,'');
          if(value) break;
        }
      }
      if(value) values.push(value);
    }));
    return [...new Map(values.map(value=>[normalizeKey(value),value])).values()];
  }

  async function readWorkbook(file){
    await window.PCMSFeatures.ensureSpreadsheetTool();
    return XLSX.read(await file.arrayBuffer(),{type:'array',cellFormula:false,cellStyles:false});
  }

  function orderFileIdentity(file){ return `${encodeURIComponent(file.name)}:${file.size}:${file.lastModified||0}`; }
  function suggestedPdfName(){
    const order=state.orderNumbers.length===1?state.orderNumbers[0].replace(/^PO\s*#\s*/i,''):(state.orderNumbers.length?state.orderNumbers.join('_'):'phieu-cat-chi-tiet');
    const safeName=normalizeText(order||'phieu-cat-chi-tiet').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[.\s]+$/g,'').slice(0,120);
    const date=new Date();
    return `${safeName}_${date.getDate()}_${date.getMonth()+1}_${date.getFullYear()}.pdf`;
  }

  function renderRoot(){
    const root=g('piece-cutting-root');
    if(!root||root.dataset.ready==='1') return;
    root.dataset.ready='1';
    root.innerHTML=`<section class="piece-cutting-page ui-work-panel">
      <nav class="pc-tabs" aria-label="Phân trang cắt chi tiết / 裁片功能分頁">
        <button id="pc-tab-order" class="active" data-pc-tab="order"><span class="ui-text-vi">Nhập đơn hàng</span><span class="ui-text-zh">匯入訂單</span></button>
        <button id="pc-tab-template" data-pc-tab="template"><span class="ui-text-vi">Nhập mẫu chính</span><span class="ui-text-zh">匯入主檔</span></button>
        <button id="pc-tab-history" data-pc-tab="history"><span class="ui-text-vi">Lịch sử thao tác</span><span class="ui-text-zh">歷史操作紀錄</span></button>
      </nav>
      <section id="pc-panel-order" class="pc-panel">
        <div class="pc-action-grid">
          <button id="pc-order-drop" class="pc-file-card"><i class="ti ti-files"></i><span><b class="ui-text-vi">Tệp đơn hàng</b><b class="ui-text-zh">訂單檔案</b><small id="pc-order-file"><span class="ui-text-vi">Chọn hoặc kéo nhiều tệp .xlsx, .xls</span><span class="ui-text-zh">可選取或拖入多個 .xlsx、.xls</span></small></span></button>
          <div id="pc-tool-status" class="pc-tool-status"><i class="ti ti-alert-circle"></i><span><b class="ui-text-vi">Chưa mở công cụ PDF cắt chi tiết</b><b class="ui-text-zh">裁片 PDF 工具尚未啟動</b></span></div>
          <button id="pc-start-tool" class="pc-action"><i class="ti ti-player-play"></i><span><b class="ui-text-vi">Mở công cụ PDF</b><b class="ui-text-zh">啟動 PDF 工具</b></span></button>
          <button id="pc-export" class="pc-action pc-primary" disabled><i class="ti ti-file-type-pdf"></i><span><b class="ui-text-vi">Xuất PDF cắt chi tiết</b><b class="ui-text-zh">匯出裁片 PDF</b></span></button>
        </div>
        <input id="pc-order-input" type="file" accept=".xlsx,.xls" multiple hidden>
        <div id="pc-order-summary" class="pc-summary"></div>
        <div class="pc-table-wrap pc-order-files-wrap"><table class="pc-table pc-order-files-table"><thead><tr>
          <th><span class="ui-text-vi">Tên tệp</span><span class="ui-text-zh">檔名</span></th><th><span class="ui-text-vi">Đơn hàng</span><span class="ui-text-zh">訂單</span></th>
          <th><span class="ui-text-vi">Số mã</span><span class="ui-text-zh">款號數</span></th><th><span class="ui-text-vi">Tổng số lượng</span><span class="ui-text-zh">總數量</span></th>
          <th><span class="ui-text-vi">Tình trạng</span><span class="ui-text-zh">狀態</span></th><th><span class="ui-text-vi">Thao tác</span><span class="ui-text-zh">操作</span></th>
        </tr></thead><tbody id="pc-order-files-body"></tbody></table></div>
        <div id="pc-order-errors-wrap" class="pc-table-wrap pc-error-wrap" hidden><table class="pc-table pc-error-table"><thead><tr>
          <th><span class="ui-text-vi">Tên tệp</span><span class="ui-text-zh">檔名</span></th><th><span class="ui-text-vi">Đơn hàng</span><span class="ui-text-zh">訂單</span></th>
          <th><span class="ui-text-vi">Vị trí</span><span class="ui-text-zh">位置</span></th><th><span class="ui-text-vi">Mã hàng</span><span class="ui-text-zh">款號</span></th>
          <th><span class="ui-text-vi">Nguyên nhân</span><span class="ui-text-zh">錯誤原因</span></th><th><span class="ui-text-vi">Cách sửa</span><span class="ui-text-zh">修正方式</span></th>
        </tr></thead><tbody id="pc-order-errors-body"></tbody></table></div>
        <div class="pc-table-wrap"><table class="pc-table pc-order-items-table"><thead><tr>
          <th><span class="ui-text-vi">Tên tệp</span><span class="ui-text-zh">檔名</span></th><th><span class="ui-text-vi">Đơn hàng</span><span class="ui-text-zh">訂單</span></th>
          <th><span class="ui-text-vi">Mã hàng</span><span class="ui-text-zh">款號</span></th><th><span class="ui-text-vi">Số lượng</span><span class="ui-text-zh">訂單數量</span></th>
          <th><span class="ui-text-vi">Size</span><span class="ui-text-zh">尺寸</span></th><th><span class="ui-text-vi">Vật liệu liên quan</span><span class="ui-text-zh">相關布料</span></th>
          <th><span class="ui-text-vi">Tình trạng</span><span class="ui-text-zh">狀態</span></th></tr></thead><tbody id="pc-order-body"></tbody></table></div>
      </section>
      <section id="pc-panel-template" class="pc-panel" hidden>
        <div class="pc-template-tools">
          <button id="pc-template-drop" class="pc-file-card"><i class="ti ti-photo-up"></i><span><b class="ui-text-vi">Mẫu chính cắt chi tiết</b><b class="ui-text-zh">裁片主檔</b><small id="pc-template-file"><span class="ui-text-vi">Nhấp để chọn hoặc kéo tệp .xlsx</span><span class="ui-text-zh">點擊選擇或拖入 .xlsx</span></small></span></button>
          <button id="pc-save-template" class="pc-action pc-primary" disabled><i class="ti ti-device-floppy"></i><span><b class="ui-text-vi">Lưu mẫu chính</b><b class="ui-text-zh">儲存主檔</b></span></button>
          <button id="pc-delete-template" class="pc-action pc-danger" disabled><i class="ti ti-trash"></i><span><b class="ui-text-vi">Xóa mẫu chính</b><b class="ui-text-zh">刪除主檔</b></span></button>
        </div>
        <input id="pc-template-input" type="file" accept=".xlsx" hidden><div id="pc-template-summary" class="pc-summary"></div>
        <div class="pc-template-help"><section><b>Quy tắc mẫu</b><p>Đọc tất cả trang tính có dữ liệu. Mỗi trang dùng cột A–G cố định: MÃ HÀNG, SIZE, TÊN VẬT LIỆU, BỘ PHẬN CẮT, SỐ KIỆN, GHI CHÚ, HÌNH ẢNH. Mã hàng không được trùng giữa các trang.</p></section><section><b>主檔規則</b><p>讀取所有非空白工作表；每頁 A–G 固定為款號、尺寸、布料名稱、裁片名稱、每件用量、備註、圖片。款號不得跨分頁重複。</p></section></div>
      </section>
      <section id="pc-panel-history" class="pc-panel" hidden><div id="pc-history-status" class="pc-summary"></div>
        <div class="pc-table-wrap"><table class="pc-table"><thead><tr><th><span class="ui-text-vi">Thời gian</span><span class="ui-text-zh">時間</span></th><th><span class="ui-text-vi">Người thao tác</span><span class="ui-text-zh">操作者</span></th><th><span class="ui-text-vi">Thao tác</span><span class="ui-text-zh">操作</span></th><th><span class="ui-text-vi">Tên tệp</span><span class="ui-text-zh">檔名</span></th><th><span class="ui-text-vi">Số mục</span><span class="ui-text-zh">影響筆數</span></th></tr></thead><tbody id="pc-history-body"></tbody></table></div>
        <button id="pc-history-more" class="pc-more" hidden><span class="ui-text-vi">Tải thêm</span><span class="ui-text-zh">載入更多</span></button></section>
    </section>`;
  }

  function setSummary(id,vi,zh,kind='info'){
    const target=g(id); if(!target) return;
    target.className=`pc-summary pc-${kind}`;
    target.replaceChildren(window.PCMSUIComponents.createLanguageSections(pair(vi,zh)));
  }

  function renderMeta(){
    const meta=state.meta,pending=state.pendingAnalysis;
    g('pc-delete-template').disabled=!meta;
    g('pc-save-template').disabled=!pending;
    if(pending){
      setSummary('pc-template-summary',`Đã kiểm tra ${pending.sheetNames.length} trang tính · ${pending.productCount} mã · ${pending.sizeCount} size · ${pending.materialCount} vật liệu · ${pending.pieceCount} bộ phận · ${pending.imageGroupCount} nhóm hình. Nhấn lưu để thay mẫu chính.`,
        `已檢查 ${pending.sheetNames.length} 個工作表 · ${pending.productCount} 款 · ${pending.sizeCount} 尺寸 · ${pending.materialCount} 種布料 · ${pending.pieceCount} 筆裁片 · ${pending.imageGroupCount} 個圖片群組。按儲存才會取代主檔。`,'success');
    }else if(meta){
      const summary=meta.summary||{};
      setSummary('pc-template-summary',`Mẫu hiện tại: ${meta.fileName} · ${summary.productCount||0} mã · cập nhật ${new Date(meta.updatedAt).toLocaleString('vi-VN')}`,
        `目前主檔：${meta.fileName} · ${summary.productCount||0} 款 · 更新於 ${new Date(meta.updatedAt).toLocaleString('zh-TW')}`,'info');
    }else setSummary('pc-template-summary','Chưa có mẫu chính cắt chi tiết.','尚未建立裁片主檔。','warning');
  }

  function renderOrder(){
    const body=g('pc-order-body'),fileBody=g('pc-order-files-body'),errorBody=g('pc-order-errors-body'); if(!body||!fileBody||!errorBody) return;
    body.replaceChildren();fileBody.replaceChildren();errorBody.replaceChildren();
    const model=state.exportModel;
    const materialByCode=new Map();
    model?.materials.forEach(material=>material.codes.forEach(code=>{
      const key=normalizeKey(code); if(!materialByCode.has(key)) materialByCode.set(key,[]); materialByCode.get(key).push(material.material);
    }));
    const missingKeys=new Set((model?.missing||[]).map(item=>normalizeKey(item.code)));
    state.orderFiles.forEach(record=>{
      const recordErrors=effectiveOrderErrors(record);
      const row=document.createElement('tr'),hasErrors=recordErrors.length>0;
      row.innerHTML=`<td title="${safe(record.fileName)}">${safe(record.fileName)}</td><td>${safe(record.orderNumbers.length?record.orderNumbers.join(' + '):'—')}</td><td>${safe(record.items.length)}</td><td>${safe(record.items.reduce((sum,item)=>sum+Number(item.qty||0),0).toLocaleString())}</td><td><span class="pc-badge ${hasErrors?'is-error':'is-ready'}">${hasErrors?'<span class="ui-text-vi">Có lỗi</span><span class="ui-text-zh">有錯誤</span>':'<span class="ui-text-vi">Hợp lệ</span><span class="ui-text-zh">有效</span>'}</span></td><td><button class="pc-remove-file" type="button" data-order-file-id="${safe(record.id)}"><span class="ui-text-vi">Bỏ tệp</span><span class="ui-text-zh">移除</span></button></td>`;
      fileBody.appendChild(row);
      recordErrors.forEach(error=>{
        const errorRow=document.createElement('tr');
        errorRow.innerHTML=`<td>${safe(record.fileName)}</td><td>${safe(record.orderNumbers.join(' + ')||'—')}</td><td><span class="ui-text-vi">${safe(error.locationVi||`Trang tính ${record.sheetName||'—'}`)}</span><span class="ui-text-zh">${safe(error.locationZh||`工作表 ${record.sheetName||'—'}`)}</span></td><td>${safe(error.code||'—')}</td><td><span class="ui-text-vi">${safe(error.detailReasonVi||error.reasonVi||'Dữ liệu không hợp lệ.')}</span><span class="ui-text-zh">${safe(error.detailReasonZh||error.reasonZh||'資料無效。')}</span></td><td><span class="ui-text-vi">${safe(error.solutionVi||'Kiểm tra và nhập lại tệp này.')}</span><span class="ui-text-zh">${safe(error.solutionZh||'請修正後重新匯入此檔案。')}</span></td>`;
        errorBody.appendChild(errorRow);
      });
    });
    if(!state.orderFiles.length){const row=document.createElement('tr');row.innerHTML='<td colspan="6" class="pc-empty"><span class="ui-text-vi">Chưa chọn tệp đơn hàng</span><span class="ui-text-zh">尚未選取訂單檔案</span></td>';fileBody.appendChild(row);}
    g('pc-order-errors-wrap').hidden=!state.orderErrors.length;
    state.orderItems.forEach(item=>{
      const row=document.createElement('tr'); const materials=[...new Set(materialByCode.get(normalizeKey(item.code))||[])];
      const occurrence=state.analysis?.groups.flatMap(group=>group.products).find(product=>normalizeKey(product.code)===normalizeKey(item.code));
      row.innerHTML=`<td title="${safe(item.fileName)}">${safe(item.fileName)}</td><td>${safe(item.orderLabel||'—')}</td><td><b>${safe(item.code)}</b></td><td>${safe(item.qty)}</td><td>${safe(occurrence?.size||'—')}</td><td title="${safe(materials.join(' · '))}">${safe(materials.join(' · ')||'—')}</td><td><span class="pc-badge ${missingKeys.has(normalizeKey(item.code))?'is-missing':'is-ready'}">${missingKeys.has(normalizeKey(item.code))?'<span class="ui-text-vi">Thiếu mẫu</span><span class="ui-text-zh">主檔缺少</span>':'<span class="ui-text-vi">Sẵn sàng</span><span class="ui-text-zh">可匯出</span>'}</span></td>`;
      body.appendChild(row);
    });
    if(!state.orderItems.length){ const row=document.createElement('tr'); row.innerHTML='<td colspan="7" class="pc-empty"><span class="ui-text-vi">Chưa có dữ liệu đơn hàng hợp lệ</span><span class="ui-text-zh">尚無有效訂單資料</span></td>'; body.appendChild(row); }
    g('pc-export').disabled=!(model?.matched.length&&model?.materials.length&&!state.orderErrors.length&&!model?.missing?.length);
    if(state.orderErrors.length) setSummary('pc-order-summary',`${state.orderFiles.length} tệp · ${state.orderErrors.length} lỗi. Tệp hợp lệ vẫn được giữ; bỏ hoặc thay tệp lỗi trước khi xuất.`,`共 ${state.orderFiles.length} 個檔案、${state.orderErrors.length} 筆錯誤；有效檔案會保留，請移除或重新匯入錯誤檔案後再匯出。`,'danger');
    else if(model?.missing?.length) setSummary('pc-order-summary',`${state.orderFiles.length} tệp · thiếu ${missingMasterCodes(model).length} mã trong mẫu chính. Đã chặn xuất PDF để tránh tính thiếu.`,
      `共 ${state.orderFiles.length} 個檔案 · ${missingMasterCodes(model).length} 個款號在主檔中找不到。為避免少算，已禁止匯出 PDF。`,'danger');
    else if(model) setSummary('pc-order-summary',`${state.orderFiles.length} tệp · ${state.orderNumbers.length} đơn hàng · ${model.matched.length} dòng mã khớp · ${model.missing.length} mã thiếu mẫu · ${model.totalPieces.toLocaleString('vi-VN')} chi tiết cần cắt`,
      `${state.orderFiles.length} 個檔案 · ${state.orderNumbers.length} 張訂單 · ${model.matched.length} 筆款號符合 · ${model.missing.length} 款缺少主檔 · 共 ${model.totalPieces.toLocaleString('zh-TW')} 片`,'success');
    else setSummary('pc-order-summary','Nhập đơn hàng để đối chiếu với mẫu chính.','匯入訂單後會與裁片主檔配對。','info');
    g('pc-order-file').replaceChildren(window.PCMSUIComponents.createLanguageSections(pair(
      state.orderFiles.length?`Đã chọn ${state.orderFiles.length} tệp; có thể chọn thêm`:'Chọn hoặc kéo nhiều tệp .xlsx, .xls',
      state.orderFiles.length?`已選 ${state.orderFiles.length} 個檔案；可繼續加入`:'可選取或拖入多個 .xlsx、.xls'
    )));
  }

  async function ensureAnalysis(){
    if(state.analysis&&state.templateFile&&state.meta?.contentHash) return state.analysis;
    state.meta=state.meta||await window.PCMSPieceCuttingStore.loadMeta();
    if(!state.meta) throw new Error('Chưa có mẫu chính cắt chi tiết.\n尚未建立裁片主檔。');
    const loaded=await window.PCMSPieceCuttingStore.loadTemplateFile(state.meta);
    if(!loaded?.blob) throw new Error('Không thể tải tệp mẫu chính.\n無法載入裁片主檔。');
    const file=new File([loaded.blob],state.meta.fileName,{type:state.meta.contentType});
    state.templateFile=file;
    state.analysis=analyzeTemplateWorkbook(file.name,await readWorkbook(file));
    return state.analysis;
  }

  async function handleTemplate(file){
    if(!file) return;
    if(!/\.xlsx$/i.test(file.name)||file.size>window.PCMSPieceCuttingStore.MAX_FILE_BYTES){
      await message('Mẫu chỉ nhận .xlsx và tối đa 100 MB.','主檔只接受 .xlsx，且上限為 100 MB。','warning'); return;
    }
    try{
      const analysis=analyzeTemplateWorkbook(file.name,await readWorkbook(file));
      state.pendingFile=file; state.pendingAnalysis=analysis;
      g('pc-template-file').textContent=file.name; renderMeta();
    }catch(error){
      state.pendingFile=null; state.pendingAnalysis=null; renderMeta();
      const details=(error.issues||[]).slice(0,12).join('\n');
      await message(`${error.message.split('\n')[0]}${details?`\n\n${details.split(' / ')[0]}`:''}`,`${error.message.split('\n')[1]||error.message}${details?`\n\n${details}`:''}`,'danger');
    }
  }

  async function saveTemplate(){
    if(!state.pendingFile||!state.pendingAnalysis) return;
    const confirmed=await window.PCMSUIComponents.confirmDialog({title:pair('Lưu mẫu chính','儲存裁片主檔'),body:window.PCMSUIComponents.createLanguageSections(pair('Mẫu mới sẽ thay toàn bộ mẫu chính hiện tại.','新檔案會完整取代目前裁片主檔。'))});
    if(!confirmed) return;
    try{
      g('pc-save-template').disabled=true;
      state.meta=await window.PCMSPieceCuttingStore.saveTemplate(state.pendingFile,state.pendingAnalysis);
      state.templateFile=state.pendingFile; state.analysis=state.pendingAnalysis; state.pendingFile=null; state.pendingAnalysis=null;
      if(state.orderFiles.length) await rebuildOrderModel();
      g('pc-template-file').textContent=state.meta.fileName; renderMeta(); renderOrder();
      window.PCMSUIComponents.showToast({kind:'success',text:pair('Đã lưu mẫu chính cắt chi tiết.','裁片主檔已儲存。')});
    }catch(error){ await message('Không thể lưu mẫu chính.','無法儲存裁片主檔。','danger'); console.error(error); renderMeta(); }
  }

  async function deleteTemplate(){
    if(!state.meta) return;
    const confirmed=await window.PCMSUIComponents.confirmDialog({title:pair('Xóa mẫu chính','刪除裁片主檔'),body:window.PCMSUIComponents.createLanguageSections(pair('Xóa toàn bộ mẫu chính cắt chi tiết?','確定刪除整份裁片主檔？'))});
    if(!confirmed) return;
    try{
      await window.PCMSPieceCuttingStore.removeTemplate();
      state.meta=null;state.analysis=null;state.templateFile=null;state.pendingFile=null;state.pendingAnalysis=null;state.exportModel=null;
      renderMeta();renderOrder();window.PCMSUIComponents.showToast({kind:'success',text:pair('Đã xóa mẫu chính.','裁片主檔已刪除。')});
      fetchLocal('/piece-cutting/cache',{method:'DELETE'},2500).catch(()=>false);
    }catch(error){ await message('Không thể xóa mẫu chính.','無法刪除裁片主檔。','danger'); console.error(error); }
  }

  function basicOrderError(fileName,sheetName,vi,zh,solutionVi,solutionZh){
    return {source:'order',status:'error',code:'',locationVi:`Tệp ${fileName}${sheetName?` · Trang tính ${sheetName}`:''}`,
      locationZh:`檔案 ${fileName}${sheetName?` · 工作表 ${sheetName}`:''}`,detailReasonVi:vi,detailReasonZh:zh,reasonVi:vi,reasonZh:zh,solutionVi,solutionZh};
  }

  function effectiveOrderErrors(record){
    return [...(record?.errors||[]),...(record?.duplicateOrderErrors||[])];
  }

  function findDuplicateOrderErrors(records){
    const byOrder=new Map(),errorsByRecord=new Map();
    records.forEach(record=>(record.orderNumbers||[]).forEach(orderNumber=>{
      const key=normalizeKey(orderNumber);
      if(!byOrder.has(key)) byOrder.set(key,{orderNumber,records:[]});
      byOrder.get(key).records.push(record);
    }));
    byOrder.forEach(({orderNumber,records:matchedRecords})=>{
      if(matchedRecords.length<2) return;
      const fileNames=matchedRecords.map(record=>record.fileName).join('、');
      matchedRecords.forEach(record=>{
        const error={...basicOrderError(record.fileName,record.sheetName,
          `Số đơn hàng ${orderNumber} xuất hiện trong nhiều tệp: ${fileNames}.`,
          `訂單號 ${orderNumber} 同時出現在多個檔案：${fileNames}。`,
          'Chỉ giữ một tệp của đơn hàng này rồi nhập lại.',
          '同一訂單只保留一個檔案，移除重複檔案後再匯入。'),code:orderNumber,fileName:record.fileName,orderLabel:record.orderLabel};
        if(!errorsByRecord.has(record.id)) errorsByRecord.set(record.id,[]);
        errorsByRecord.get(record.id).push(error);
      });
    });
    return errorsByRecord;
  }

  function missingMasterCodes(model){
    const unique=new Map();
    (model?.missing||[]).forEach(item=>{const key=normalizeKey(item.code);if(!unique.has(key)) unique.set(key,item.code);});
    return [...unique.values()];
  }

  async function showMissingMasterWarning(model){
    const codes=missingMasterCodes(model);
    if(!codes.length) return false;
    const shown=codes.slice(0,20).join('、');
    const more=codes.length>20?` (+${codes.length-20})`:'';
    await message(`Không thể xuất PDF vì ${codes.length} mã đơn hàng không có trong bất kỳ trang tính nào của mẫu chính: ${shown}${more}. Hãy bổ sung mẫu chính rồi nhập lại.`,
      `無法匯出 PDF：共有 ${codes.length} 個訂單款號在裁片主檔所有工作表中都找不到：${shown}${more}。請先補入主檔並重新匯入。`,'danger');
    return true;
  }

  async function parseOrderFile(file){
    const record={id:orderFileIdentity(file),file,fileName:file.name,sheetName:'',orderNumbers:[],orderLabel:'',items:[],errors:[],duplicateOrderErrors:[]};
    try{
      if(!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Định dạng đơn hàng không hợp lệ.\n訂單檔案格式不符。');
      const workbook=await readWorkbook(file);
      if(workbook.SheetNames.length!==1) throw new Error(`Đơn hàng có ${workbook.SheetNames.length} trang tính; chỉ được có một trang.\n訂單共有 ${workbook.SheetNames.length} 個工作表；只允許一個。`);
      record.sheetName=workbook.SheetNames[0];
      const sheet=workbook.Sheets[record.sheetName];
      const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
      const displayRows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false});
      const formulaRows=rows.map((row,rowIndex)=>(row||[]).map((_,column)=>String(sheet[cellAddress(rowIndex,column)]?.f||'')));
      const parsed=window.PCMSCuttingOrderValidation.parseRows(rows,record.sheetName,{formulaRows});
      record.items=parsed.items||[];record.errors=parsed.errors||[];record.orderNumbers=findOrderNumbers(displayRows);
      record.orderLabel=record.orderNumbers.map(value=>`PO#${value.replace(/^PO\s*#\s*/i,'')}`).join(' + ');
      if(!record.orderNumbers.length) record.errors.push(basicOrderError(file.name,record.sheetName,
        'Không tìm thấy số đơn hàng trong tiêu đề ORDER NO hoặc ORDER NUMBER.',
        '找不到 ORDER NO 或 ORDER NUMBER 訂單號碼。',
        'Điền số đơn hàng vào tệp rồi nhập lại; hệ thống không dùng tên tệp để thay thế.',
        '請在檔案內填入訂單號後重新匯入；系統不會以檔名代替訂單號。'));
    }catch(error){
      const parts=String(error.message||error).split('\n');
      record.errors.push(basicOrderError(file.name,record.sheetName,parts[0],parts[1]||parts[0],
        'Kiểm tra định dạng tệp rồi nhập lại.','請確認檔案格式後重新匯入。'));
      console.error(error);
    }
    record.errors=record.errors.map(error=>({...error,fileName:file.name,orderLabel:record.orderLabel}));
    return record;
  }

  async function rebuildOrderModel(){
    const duplicateErrors=findDuplicateOrderErrors(state.orderFiles);
    state.orderFiles.forEach(record=>{record.duplicateOrderErrors=duplicateErrors.get(record.id)||[];});
    state.orderErrors=state.orderFiles.flatMap(effectiveOrderErrors);
    const validRecords=state.orderFiles.filter(record=>!effectiveOrderErrors(record).length);
    state.orderNumbers=[...new Map(validRecords.flatMap(record=>record.orderNumbers).map(value=>[normalizeKey(value),value])).values()];
    state.orderItems=validRecords.flatMap(record=>record.items.map(item=>({...item,fileName:record.fileName,orderLabel:record.orderLabel,orderNumbers:record.orderNumbers.slice()})));
    state.exportModel=null;
    if(state.orderItems.length){
      const analysis=await ensureAnalysis();
      const label=state.orderNumbers.map(value=>`PO#${value.replace(/^PO\s*#\s*/i,'')}`).join(' + ');
      state.exportModel=buildExportModel(analysis,state.orderItems,label);
    }
  }

  async function handleOrders(files){
    const selected=Array.from(files||[]);if(!selected.length)return;
    const revision=++orderLoadRevision;
    const records=await Promise.all(selected.map(parseOrderFile));
    if(revision!==orderLoadRevision)return;
    const merged=new Map(state.orderFiles.map(record=>[record.id,record]));
    records.forEach(record=>merged.set(record.id,record));state.orderFiles=[...merged.values()];
    try{await rebuildOrderModel();}
    catch(error){console.error(error);await message(String(error.message||error).split('\n')[0],String(error.message||error).split('\n')[1]||String(error.message||error),'danger');}
    renderOrder();
    if(!state.orderErrors.length) await showMissingMasterWarning(state.exportModel);
  }

  async function removeOrderFile(id){
    orderLoadRevision+=1;state.orderFiles=state.orderFiles.filter(record=>record.id!==id);
    try{await rebuildOrderModel();}catch(error){console.error(error);}
    renderOrder();
  }

  async function fetchLocal(path,options={},timeout=10000){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{return await fetch(`${LOCAL_ORIGIN}${path}`,{...options,signal:controller.signal});}finally{clearTimeout(timer);}
  }

  function renderTool(online){
    state.toolOnline=online; const target=g('pc-tool-status'); if(!target) return;
    target.classList.toggle('is-online',online===true); target.classList.toggle('is-checking',online===null);
    target.innerHTML=online===true?'<i class="ti ti-circle-check"></i><span><b class="ui-text-vi">Công cụ PDF cắt chi tiết đã mở</b><b class="ui-text-zh">裁片 PDF 工具已啟動</b></span>':
      '<i class="ti ti-alert-circle"></i><span><b class="ui-text-vi">Chưa mở công cụ PDF cắt chi tiết</b><b class="ui-text-zh">裁片 PDF 工具尚未啟動</b></span>';
  }

  async function checkTool(silent=false){
    if(!silent) renderTool(null);
    try{ const response=await fetchLocal('/health',{cache:'no-store'},1800); const data=response.ok?await response.json():null; const ready=data?.service==='piece-cutting-pdf-local'; renderTool(ready); return ready; }
    catch(_){ renderTool(false); return false; }
  }

  async function startTool(){
    if(await checkTool(true)) return true;
    const frame=document.createElement('iframe');frame.hidden=true;frame.src='piececuttingpdf://start';document.body.appendChild(frame);setTimeout(()=>frame.remove(),2500);
    for(let index=0;index<10;index+=1){ await new Promise(resolve=>setTimeout(resolve,700)); if(await checkTool(true)) return true; }
    await message('Không thể mở công cụ PDF cắt chi tiết. Hãy chạy trình khởi động đã cài trên máy này.','無法啟動裁片 PDF 工具，請先執行此電腦已安裝的啟動器。','warning');
    return false;
  }

  async function exportPdf(){
    if(await showMissingMasterWarning(state.exportModel)) return;
    if(!state.exportModel?.materials.length||state.orderErrors.length) return;
    if(!(await startTool())) return;
    const handle=await window.PCMSFileIO.chooseSaveHandle({id:'pcms-piece-cutting-pdf',suggestedName:suggestedPdfName(),types:[{description:'Tệp PDF / PDF 檔案',accept:{'application/pdf':['.pdf']}}],
      onUnsupported:()=>message('Trình duyệt này không hỗ trợ chọn vị trí lưu.','此瀏覽器不支援選擇儲存位置。','warning')});
    if(!handle) return;
    try{
      const meta=state.meta||await window.PCMSPieceCuttingStore.loadMeta();
      const status=await fetchLocal('/piece-cutting/cache/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contentHash:meta.contentHash,fileSize:meta.fileSize})},5000);
      const cached=status.ok&&(await status.json()).cached===true;
      const payload={outputName:suggestedPdfName(),template:{contentHash:meta.contentHash,fileSize:meta.fileSize,fileName:meta.fileName},report:state.exportModel};
      if(!cached){ const loaded=await window.PCMSPieceCuttingStore.loadTemplateFile(meta); payload.template.base64=await window.PCMSPieceCuttingStore.blobToBase64(loaded.blob); }
      const response=await fetchLocal('/piece-cutting/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},15*60*1000);
      if(!response.ok){ let detail='';try{detail=(await response.json()).error||'';}catch(_){} throw new Error(detail||`HTTP ${response.status}`); }
      await window.PCMSFileIO.writeToHandle(handle,await response.blob());
      try{
        await window.PCMSHistory.saveOperationLog({permissionKey:'cutting',feature:'pieceCutting',action:'pieceCuttingPdfExport',status:'success',itemCount:state.exportModel.matched.length,detailCount:state.exportModel.totalPieces,fileName:handle.name||suggestedPdfName()});
      }catch(logError){
        console.error('裁片 PDF 操作紀錄寫入失敗：',logError);
        await message('PDF đã được lưu, nhưng không thể ghi lịch sử thao tác. Hãy báo quản trị viên.','PDF 已儲存，但操作紀錄寫入失敗，請通知管理員。','warning');
        return;
      }
      window.PCMSUIComponents.showToast({kind:'success',text:pair('Đã lưu PDF cắt chi tiết.','裁片 PDF 已儲存。')});
    }catch(error){ console.error(error); await message(`Không thể xuất PDF. ${error.message||''}`,`無法匯出 PDF。${error.message||''}`,'danger'); }
  }

  function historyAction(action){
    return {pieceCuttingTemplateImport:pair('Nhập mẫu chính','匯入主檔'),pieceCuttingTemplateDelete:pair('Xóa mẫu chính','刪除主檔'),pieceCuttingPdfExport:pair('Xuất PDF','匯出 PDF')}[action]||pair(action,action);
  }

  function renderHistory(){
    const body=g('pc-history-body');if(!body)return;body.replaceChildren();
    state.history.forEach(log=>{const row=document.createElement('tr'),action=historyAction(log.action);row.innerHTML=`<td>${safe(new Date(log.createdAt).toLocaleString())}</td><td>${safe(log.createdBy||'—')}</td><td><span class="ui-text-vi">${safe(action.vi)}</span><span class="ui-text-zh">${safe(action.zh)}</span></td><td>${safe(log.fileName||'—')}</td><td>${safe(log.itemCount||0)}</td>`;body.appendChild(row);});
    if(!state.history.length){const row=document.createElement('tr');row.innerHTML='<td colspan="5" class="pc-empty"><span class="ui-text-vi">Chưa có lịch sử thao tác</span><span class="ui-text-zh">尚無操作紀錄</span></td>';body.appendChild(row);}
    g('pc-history-more').hidden=!window.PCMSHistory.hasMore('operationLogs',{permissionKey:'cutting',actions:HISTORY_ACTIONS,limit:50});
    setSummary('pc-history-status',`${state.history.length} bản ghi đã tải. Mỗi lần tải tối đa 50 bản ghi.`,`已載入 ${state.history.length} 筆，每次最多讀取 50 筆。`,'info');
  }

  async function loadHistory(loadMore=false){
    try{state.history=await window.PCMSHistory.loadOperationLogs({permissionKey:'cutting',actions:HISTORY_ACTIONS,limit:50,loadMore});state.historyLoaded=true;renderHistory();}
    catch(error){console.error(error);setSummary('pc-history-status','Không thể tải lịch sử.','無法載入歷史紀錄。','danger');}
  }

  function switchTab(tab){
    state.activeTab=['order','template','history'].includes(tab)?tab:'order';
    ['order','template','history'].forEach(name=>{g(`pc-tab-${name}`)?.classList.toggle('active',name===state.activeTab);g(`pc-panel-${name}`).hidden=name!==state.activeTab;});
    if(state.activeTab==='history'&&!state.historyLoaded) void loadHistory(false);
  }

  function registerDrop(){
    if(fileDropRegistered||!window.PCMSUIFileDrop)return;
    const reject=detail=>{const text=window.PCMSUIText.resolve(detail?.message||pair('Không thể nhận tệp.','無法接收檔案。'));void message(text.vi,text.zh,'warning');};
    window.PCMSUIFileDrop.register({id:'piece-cutting-order',page:'piece-cutting',accept:['.xlsx','.xls'],maxFiles:100,enabled:()=>state.activeTab==='order',text:pair('Thả một hoặc nhiều tệp đơn hàng','放開一個或多個訂單檔案'),onDrop:files=>handleOrders(files),onReject:reject});
    window.PCMSUIFileDrop.register({id:'piece-cutting-template',page:'piece-cutting',accept:['.xlsx'],maxFiles:1,enabled:()=>state.activeTab==='template',text:pair('Thả tệp để nhập mẫu chính','放開即可匯入主檔'),onDrop:files=>handleTemplate(files[0]),onReject:reject});
    fileDropRegistered=true;
  }

  function bind(){
    document.querySelectorAll('[data-pc-tab]').forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.pcTab)));
    g('pc-order-drop').addEventListener('click',()=>g('pc-order-input').click());g('pc-order-input').addEventListener('change',event=>{void handleOrders(event.target.files);event.target.value='';});
    g('pc-order-files-body').addEventListener('click',event=>{const button=event.target.closest('[data-order-file-id]');if(button)void removeOrderFile(button.dataset.orderFileId);});
    g('pc-template-drop').addEventListener('click',()=>g('pc-template-input').click());g('pc-template-input').addEventListener('change',event=>{void handleTemplate(event.target.files?.[0]);event.target.value='';});
    g('pc-save-template').addEventListener('click',()=>void saveTemplate());g('pc-delete-template').addEventListener('click',()=>void deleteTemplate());
    g('pc-start-tool').addEventListener('click',()=>void startTool());g('pc-export').addEventListener('click',()=>void exportPdf());g('pc-history-more').addEventListener('click',()=>void loadHistory(true));
  }

  // resetUserState（切換登入工作階段時清除使用者訂單與歷史）：裁片主檔快取仍依核准規則在同一裝置共用。
  function resetUserState(authSession){
    state.authSession=authSession||null;state.activeTab='order';state.meta=null;state.analysis=null;state.templateFile=null;
    state.pendingFile=null;state.pendingAnalysis=null;state.orderFiles=[];state.orderItems=[];state.orderErrors=[];
    state.orderNumbers=[];state.exportModel=null;state.history=[];state.historyLoaded=false;state.toolOnline=null;
    window.PCMSPieceCuttingStore?.resetSession?.();
    if(state.initialized){switchTab('order');renderOrder();}
  }

  async function pieceCuttingInit(){
    if(state.authSession!==window.firebaseAuthUser) resetUserState(window.firebaseAuthUser);
    renderRoot();if(!state.initialized){bind();registerDrop();state.initialized=true;renderOrder();}
    try{state.meta=await window.PCMSPieceCuttingStore.loadMeta();}catch(error){console.error(error);state.meta=null;await message('Không thể kiểm tra mẫu chính.','無法檢查裁片主檔。','danger');}
    renderMeta();void checkTool(true);
  }

  function pieceCuttingLeave(){ return true; }

  window.pieceCuttingInit=pieceCuttingInit;
  window.pieceCuttingLeave=pieceCuttingLeave;
  window.PCMSPieceCuttingValidation=Object.freeze({normalizeText,normalizeKey,normalizeHeader,detectTemplateHeader,analyzeTemplateWorkbook,buildExportModel,findOrderNumbers,findDuplicateOrderErrors,missingMasterCodes});
})();
