// cutting（裁帶統計）：獨立功能；模板輸出策略是保留原始 Excel（表格檔）副本，只填數量欄。
(function(){
  const state = {
    templates: [],
    orderItems: [],
    orderErrors: [], // orderErrors（訂單錯誤）：只保存訂單檔案本身的不完整或無效資料，不包含缺少模板。
    orderCodeCount: 0, // orderCodeCount（訂單款號數）：只計算訂單內實際出現的非空白唯一款號。
    orderLabel: '', // orderLabel（PDF 左上角內容）：自動辨識後可由使用者修改。
    results: [],
    pendingTemplateFile: null,
    pendingBook: null,
    activeTab: 'order', // activeTab（目前裁帶功能分頁）：決定全畫面拖曳的唯一匯入用途。
    historyLogs: [], // historyLogs（裁帶操作歷史）：只在使用者開啟歷史分頁後載入。
    historyLoaded: false,
    historyLoading: false
  };
  const FIXED_TEMPLATE_COLUMNS = Object.freeze({
    codeCol: 1,
    qtyCol: 6,
    pieceCol: 7,
    totalCol: 8
  });
  const TEMPLATE_SCHEMA_VERSION = 'fixed-2026-07'; // TEMPLATE_SCHEMA_VERSION（固定模板規格版本）
  const TEMPLATE_ANALYSIS_VERSION = 'merge-v1'; // TEMPLATE_ANALYSIS_VERSION（合併儲存格分析版本）
  const PDF_QUALITY_STORAGE_KEY = 'cuttingPdfQuality'; // PDF_QUALITY_STORAGE_KEY（PDF 品質記憶鍵）
  const LOCAL_PDF_REQUEST_TIMEOUT_MS = 15 * 60 * 1000; // LOCAL_PDF_REQUEST_TIMEOUT_MS（本機 PDF 要求等待上限）：最多等待十五分鐘。
  const PDF_TOOL_START_ACTION_KEY = 'cutting.pdfToolStart'; // PDF_TOOL_START_ACTION_KEY（PDF 工具啟動操作鍵）
  const PDF_EXPORT_OPEN_ACTION_KEY = 'cutting.openPdfExport'; // PDF_EXPORT_OPEN_ACTION_KEY（PDF 匯出入口操作鍵）
  const PDF_TOOL_START_TIMEOUT_MS = 10000; // PDF_TOOL_START_TIMEOUT_MS（PDF 工具啟動檢查上限）：只限制背景檢查，不延長按鈕鎖定。
  let pdfToolStatusChecking = false;
  let pdfToolKnownOnline = null; // pdfToolKnownOnline（已知的本機 PDF 工具狀態）：只用來避免使用者白選儲存位置，正式匯出前仍會再次確認。
  let orderLabelDialogResolve = null; // orderLabelDialogResolve（訂單文字視窗回傳函式）
  let fileDropTargetsRegistered = false; // fileDropTargetsRegistered（裁帶全畫面匯入用途是否已登記）

  function text(id, value){
    const el = g(id);
    if(el) el.textContent = value;
  }

  function html(id, value){
    const el = g(id);
    if(el) el.innerHTML = value;
  }

  // setTemplateFileDisplay（設定模板檔案顯示）：檔案框同時提供選擇、拖入及更換檔案入口。
  function setTemplateFileDisplay(value = ''){
    const fileName = String(value || '').trim(); // fileName（模板檔案顯示名稱）
    const target = g('cut-template-file-name'); // target（模板檔名元件）
    const helper = g('cut-template-file-helper'); // helper（模板檔案操作提示）
    const picker = g('cut-template-drop'); // picker（模板檔案框）
    if(target){
      target.textContent = fileName;
      target.title = fileName;
      target.hidden = !fileName;
    }
    if(helper){
      helper.hidden = !!fileName;
      helper.innerHTML = fileName
        ? 'Nhấp để thay thế · Chỉ nhận cột A–K.<br>點擊可更換 · 僅接受 A–K 固定欄位。'
        : 'Nhấp để chọn hoặc kéo tệp .xlsx.<br>點擊選擇或拖入 .xlsx 模板。';
    }
    picker?.classList.toggle('is-filled', !!fileName);
  }

  // setOrderFileDisplay（設定訂單檔案顯示）：檔案框同時提供選擇、拖入及更換檔案入口。
  function setOrderFileDisplay(value = ''){
    const fileName = String(value || '').trim(); // fileName（訂單檔案顯示名稱）
    const target = g('cut-order-file-name'); // target（訂單檔名元件）
    const helper = g('cut-order-file-helper'); // helper（訂單檔案操作提示）
    const picker = g('cut-order-drop'); // picker（訂單檔案框）
    if(target){
      target.textContent = fileName;
      target.title = fileName;
      target.hidden = !fileName;
    }
    if(helper){
      helper.hidden = !!fileName;
      helper.innerHTML = fileName
        ? 'Nhấp để thay thế tệp.<br>點擊可更換檔案。'
        : 'Nhấp để chọn hoặc kéo tệp .xlsx, .xls.<br>點擊選擇或拖入 .xlsx、.xls 訂單。';
    }
    picker?.classList.toggle('is-filled', !!fileName);
  }

  // showCuttingFileDropMessage（顯示裁帶拖曳結果）：格式或數量不符時提供雙語原因。
  function showCuttingFileDropMessage(detail){
    const message = detail?.message || {vi:'Không thể nhận tệp',zh:'無法接收檔案'}; // message（拖曳拒絕原因）
    const pair = window.PCMSUIText?.resolve?.(message) || {vi:'Không thể nhận tệp',zh:'無法接收檔案'}; // pair（拒絕原因雙語文字）
    alert(`${pair.vi}\n${pair.zh}`);
  }

  // registerCuttingFileDropTargets（登記裁帶全畫面匯入）：由目前分頁決定訂單或模板，不依副檔名猜測用途。
  function registerCuttingFileDropTargets(){
    const fileDrop = window.PCMSUIFileDrop; // fileDrop（全畫面拖曳共用介面）
    if(!fileDrop || fileDropTargetsRegistered) return false;
    fileDrop.register({
      id:'cutting-order-import', // cutting-order-import（裁帶訂單匯入用途）
      page:'cutting',
      accept:['.xlsx','.xls'],
      maxFiles:1,
      enabled:()=>state.activeTab === 'order',
      text:{vi:'Thả tệp để nhập đơn hàng',zh:'放開即可匯入訂單'},
      onDrop:files=>cuttingHandleOrderFile({files}),
      onReject:showCuttingFileDropMessage,
      onError:()=>showCuttingFileDropMessage({message:{vi:'Không thể xử lý tệp đơn hàng',zh:'無法處理訂單檔案'}})
    });
    fileDrop.register({
      id:'cutting-template-import', // cutting-template-import（裁帶模板匯入用途）
      page:'cutting',
      accept:['.xlsx'],
      maxFiles:1,
      enabled:()=>state.activeTab === 'template' && !g('cut-template-file')?.disabled,
      text:{vi:'Thả tệp để nhập mẫu',zh:'放開即可匯入模板'},
      onDrop:files=>cuttingHandleTemplateFile({files}),
      onReject:showCuttingFileDropMessage,
      onError:()=>showCuttingFileDropMessage({message:{vi:'Không thể xử lý tệp mẫu',zh:'無法處理模板檔案'}})
    });
    fileDropTargetsRegistered = true;
    return true;
  }

  function cuttingSwitchTab(tab){
    const selectedTab = ['order', 'template', 'history'].includes(tab) ? tab : 'order'; // selectedTab（目前裁帶分頁）
    state.activeTab = selectedTab;
    ['order', 'template', 'history'].forEach(tabName => {
      const panel = g(`cut-panel-${tabName}`); // panel（裁帶分頁內容）
      const button = g(`cut-tab-${tabName}`); // button（裁帶分頁按鈕）
      if(panel) panel.style.display = selectedTab === tabName ? '' : 'none';
      if(button) button.classList.toggle('active', selectedTab === tabName);
    });
    if(selectedTab === 'history') void cuttingLoadHistory();
  }

  function esc(value){
    return window.PCMSSafe.text(value);
  }

  function inlineArg(value){
    return window.PCMSSafe.inlineArgument(value);
  }

  function fmtNum(value){
    const n = Number(value || 0);
    return Number.isFinite(n) ? n.toLocaleString('en-US') : '0';
  }

  const CUTTING_HISTORY_ACTIONS = Object.freeze({
    cuttingTemplateImport: {vi:'Nhập mẫu', zh:'匯入模板'},
    cuttingTemplateDelete: {vi:'Xóa mẫu', zh:'刪除模板'}, // cuttingTemplateDelete（刪除裁帶模板）
    cuttingExcelExport: {vi:'Xuất Excel', zh:'匯出 Excel'},
    cuttingPdfExport: {vi:'Xuất PDF', zh:'匯出 PDF'}
  }); // CUTTING_HISTORY_ACTIONS（裁帶歷史動作名稱）

  const CUTTING_HISTORY_STATUSES = Object.freeze({
    success: {vi:'Thành công', zh:'成功', className:'tg2'},
    partial: {vi:'Một phần', zh:'部分完成', className:'ta'},
    failed: {vi:'Thất bại', zh:'失敗', className:'tr2'}
  }); // CUTTING_HISTORY_STATUSES（裁帶歷史狀態名稱）

  function cuttingHistoryTime(value){
    const date = new Date(Number(value)); // date（操作時間）
    return Number.isFinite(date.getTime()) ? date.toLocaleString('vi-VN', {hour12:false}) : '-';
  }

  function renderCuttingHistory(){
    const body = g('cut-history-tb'); // body（裁帶歷史表格內容）
    if(!body) return;
    if(!state.historyLogs.length){
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--mu)">Chưa có lịch sử thao tác.<br><span class="tv">尚無操作紀錄。</span></td></tr>';
      return;
    }
    body.innerHTML = state.historyLogs.map(log => {
      const action = CUTTING_HISTORY_ACTIONS[log?.action] || {
        vi:'Thao tác khác',
        zh:'其他操作'
      }; // action（操作名稱）
      const status = CUTTING_HISTORY_STATUSES[log?.status] || CUTTING_HISTORY_STATUSES.failed; // status（操作狀態）
      const operator = String(log?.createdBy || log?.createdByUid || '-'); // operator（操作者）
      const fileName = String(log?.fileName || '-'); // fileName（操作檔名）
      return `<tr>
        <td>${esc(cuttingHistoryTime(log?.createdAt))}</td>
        <td>${esc(operator)}</td>
        <td><strong>${esc(action.vi)}</strong><br><span class="tv">${esc(action.zh)}</span></td>
        <td>${esc(fileName)}</td>
        <td style="text-align:right">${fmtNum(log?.itemCount)}</td>
        <td style="text-align:right">${fmtNum(log?.detailCount)}</td>
        <td><span class="tg ${status.className}">${esc(status.vi)}<br>${esc(status.zh)}</span></td>
      </tr>`;
    }).join('');
  }

  async function cuttingLoadHistory(force = false){
    if(state.historyLoading) return;
    if(state.historyLoaded && !force){
      renderCuttingHistory();
      return;
    }
    const body = g('cut-history-tb'); // body（裁帶歷史表格內容）
    const button = g('cut-history-refresh-btn'); // button（重新整理按鈕）
    state.historyLoading = true;
    if(button) button.disabled = true;
    if(body) body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--mu)">Đang tải lịch sử...<br><span class="tv">正在載入歷史紀錄...</span></td></tr>';
    try{
      if(typeof window.ensureCuttingHistoryLoaded !== 'function'){
        throw new Error('Chức năng lịch sử chưa sẵn sàng / 歷史功能尚未就緒');
      }
      state.historyLogs = await window.ensureCuttingHistoryLoaded({limit:50});
      state.historyLoaded = true;
      renderCuttingHistory();
    }catch(error){
      state.historyLoaded = false;
      console.error('Không thể tải operationLogs / 無法載入操作紀錄：', error);
      if(body) body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--err)">Không thể tải lịch sử thao tác, vui lòng thử lại.<br><span class="tv">無法載入操作紀錄，請重試。</span></td></tr>';
    }finally{
      state.historyLoading = false;
      if(button) button.disabled = false;
    }
  }

  function cuttingRefreshHistory(){
    void cuttingLoadHistory(true);
  }

  function rememberCuttingHistoryLog(log){
    if(!log || !state.historyLoaded) return;
    state.historyLogs = [log, ...state.historyLogs.filter(item => item?.id !== log.id)].slice(0, 50);
    renderCuttingHistory();
  }

  // normalizePdfQuality（標準化 PDF 品質）：high（高品質）以外一律使用 standard（標準品質）。
  function normalizePdfQuality(value){
    return value === 'high' ? 'high' : 'standard';
  }

  // getSavedPdfQuality（取得已記住的 PDF 品質）：無紀錄時維持 standard（標準品質）。
  function getSavedPdfQuality(){
    try{
      return normalizePdfQuality(localStorage.getItem(PDF_QUALITY_STORAGE_KEY));
    }catch(_){
      return 'standard';
    }
  }

  // restorePdfQualitySelection（還原 PDF 品質選擇）：開啟預覽時顯示上次選項。
  function restorePdfQualitySelection(){
    const select = g('cut-pdf-quality'); // select（品質選單）
    if(select) select.value = getSavedPdfQuality();
  }

  // getSelectedPdfQuality（取得目前 PDF 品質）：產生檔案時記住使用者選擇。
  function getSelectedPdfQuality(){
    const select = g('cut-pdf-quality'); // select（品質選單）
    const quality = normalizePdfQuality(select?.value); // quality（品質設定）
    try{
      localStorage.setItem(PDF_QUALITY_STORAGE_KEY, quality);
    }catch(_){}
    return quality;
  }

  function normalizeText(value){
    return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
  }

  function normalizeHeader(value){
    return normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9\u4E00-\u9FFF]/g, '');
  }

  // normalizeCode（標準化款號）：保留款號中的英文字母、數字與所有符號，只清除前後空白並統一英文大小寫。
  function normalizeCode(value){
    return String(value ?? '').trim().toUpperCase();
  }

  function parseNumber(value){
    if(typeof value === 'number') return value;
    const raw = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '');
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function addr(rowIndex, colIndex){
    return XLSX.utils.encode_cell({r: rowIndex, c: colIndex});
  }

  function isItemCode(value){
    return normalizeCode(value).length > 0;
  }

  function codeAliases(value){
    const code = normalizeCode(value);
    return code ? [code] : [];
  }

  // buildTemplateMergeMap（建立模板合併儲存格索引）：合併範圍內每一格都指向左上角來源。
  function buildTemplateMergeMap(ws){
    const map = new Map();
    const analyzedColumns = [
      FIXED_TEMPLATE_COLUMNS.codeCol,
      FIXED_TEMPLATE_COLUMNS.qtyCol,
      FIXED_TEMPLATE_COLUMNS.pieceCol,
      FIXED_TEMPLATE_COLUMNS.totalCol
    ]; // analyzedColumns（需要解析合併狀態的固定欄）
    (ws?.['!merges'] || []).forEach(range => {
      const startRow = Number(range?.s?.r);
      const startCol = Number(range?.s?.c);
      const endRow = Number(range?.e?.r);
      const endCol = Number(range?.e?.c);
      if(![startRow, startCol, endRow, endCol].every(Number.isInteger)) return;
      if(startRow < 0 || startCol < 0 || endRow < startRow || endCol < startCol) return;
      const anchorCell = addr(startRow, startCol);
      const reference = `${anchorCell}:${addr(endRow, endCol)}`;
      const info = {
        reference,
        anchorCell,
        value: ws?.[anchorCell]?.v ?? ''
      };
      for(let rowIndex = startRow; rowIndex <= endRow; rowIndex++){
        for(const colIndex of analyzedColumns){
          if(colIndex < startCol || colIndex > endCol) continue;
          map.set(addr(rowIndex, colIndex), info);
        }
      }
    });
    return map;
  }

  // resolveTemplateCell（解析模板儲存格）：回傳實際來源位置、合併範圍與左上角內容。
  function resolveTemplateCell(ws, rowIndex, colIndex, mergeMap){
    const cell = addr(rowIndex, colIndex);
    const merge = mergeMap.get(cell);
    if(merge){
      return {
        cell: merge.anchorCell,
        value: merge.value,
        mergeRef: merge.reference
      };
    }
    return {
      cell,
      value: ws?.[cell]?.v ?? '',
      mergeRef: ''
    };
  }

  function isFixedTemplateHeader(ws, rowIndex, mergeMap){
    const code = normalizeHeader(resolveTemplateCell(ws, rowIndex, FIXED_TEMPLATE_COLUMNS.codeCol, mergeMap).value);
    const qty = normalizeHeader(resolveTemplateCell(ws, rowIndex, FIXED_TEMPLATE_COLUMNS.qtyCol, mergeMap).value);
    const piece = normalizeHeader(resolveTemplateCell(ws, rowIndex, FIXED_TEMPLATE_COLUMNS.pieceCol, mergeMap).value);
    const total = normalizeHeader(resolveTemplateCell(ws, rowIndex, FIXED_TEMPLATE_COLUMNS.totalCol, mergeMap).value);
    return (
      code.includes('MAHANG') &&
      (qty.includes('SLPO') || qty.includes('PCS')) &&
      piece.includes('SOKIEN') &&
      (total.includes('SLCAT') || total.includes('THUCTE'))
    );
  }

  function analyzeTemplateWorkbook(fileName, workbook){
    const book = {
      fileName,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      analysisVersion: TEMPLATE_ANALYSIS_VERSION,
      sheetCount: workbook.SheetNames.length,
      itemCount: 0,
      rowCount: 0,
      warningCount: 0,
      issues: [],
      noticeCount: 0,
      notices: [],
      codes: []
    };
    const codeMap = new Map();

    workbook.SheetNames.forEach(sheetName => {
      const ws = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
      const mergeMap = buildTemplateMergeMap(ws); // mergeMap（合併儲存格索引）
      let detectedBlocks = 0; // detectedBlocks（已找到的原始組別數）
      const issuePieceCells = new Set(); // issuePieceCells（已記錄錯誤的件數儲存格）
      const headerIndexes = []; // headerIndexes（表頭列索引）
      rows.forEach((row, rowIndex) => {
        if(isFixedTemplateHeader(ws, rowIndex, mergeMap)) headerIndexes.push(rowIndex);
      });
      headerIndexes.forEach((headerIndex, blockIndex) => {
        const nextHeaderIndex = blockIndex + 1 < headerIndexes.length ? headerIndexes[blockIndex + 1] : rows.length; // nextHeaderIndex（下一個表頭列索引）
        let blockRowCount = 0; // blockRowCount（本組款號列數）
        const blockRows = []; // blockRows（本組款號資料列）
        detectedBlocks += 1;
        for(let dataIndex = headerIndex + 1; dataIndex < nextHeaderIndex; dataIndex++){
          const codeSource = resolveTemplateCell(ws, dataIndex, FIXED_TEMPLATE_COLUMNS.codeCol, mergeMap); // codeSource（款號來源）
          const pieceSource = resolveTemplateCell(ws, dataIndex, FIXED_TEMPLATE_COLUMNS.pieceCol, mergeMap); // pieceSource（每件條數來源）
          const qtySource = resolveTemplateCell(ws, dataIndex, FIXED_TEMPLATE_COLUMNS.qtyCol, mergeMap); // qtySource（訂單數量來源）
          const totalSource = resolveTemplateCell(ws, dataIndex, FIXED_TEMPLATE_COLUMNS.totalCol, mergeMap); // totalSource（裁段總數來源）
          const rawCode = codeSource.value;
          if(!isItemCode(rawCode)) continue;
          const code = normalizeCode(rawCode);
          const pieces = parseNumber(pieceSource.value);
          const rowInfo = {
            sheetName,
            rowNumber: dataIndex + 1,
            code,
            qtyCell: qtySource.cell,
            pieceCell: pieceSource.cell,
            totalCell: totalSource.cell,
            qtyMergeRef: qtySource.mergeRef,
            totalMergeRef: totalSource.mergeRef,
            piecesPerRow: pieces
          };
          blockRowCount += 1;
          blockRows.push(rowInfo);
          book.rowCount += 1;
          const pieceSourceKey = `${sheetName}!${pieceSource.cell}`; // pieceSourceKey（每件條數來源識別）
          if(pieces <= 0 && !issuePieceCells.has(pieceSourceKey)){
            issuePieceCells.add(pieceSourceKey);
            book.warningCount += 1;
            rowInfo.warning = 'Số kiện trống hoặc bằng 0 / 每件條數空白或為 0';
            book.issues.push({
              sheetName,
              cell: rowInfo.pieceCell,
              rowNumber: rowInfo.rowNumber,
              code,
              viMessage: 'Số kiện trống hoặc bằng 0. Vui lòng nhập số kiện chính xác.',
              zhMessage: '件數空白或為 0，請填入正確件數。'
            });
          }
          if(!codeMap.has(code)){
            codeMap.set(code, {
              code,
              aliases: codeAliases(code),
              piecesPerItem: 0,
              rows: [],
              pieceSourceKeys: []
            });
          }
          const item = codeMap.get(code);
          item.rows.push(rowInfo);
          if(!item.pieceSourceKeys.includes(pieceSourceKey)){
            item.pieceSourceKeys.push(pieceSourceKey);
            item.piecesPerItem += pieces;
          }
        }
        if(!blockRowCount){
          book.warningCount += 1;
          book.issues.push({
            sheetName,
            cell: addr(headerIndex + 1, FIXED_TEMPLATE_COLUMNS.codeCol),
            rowNumber: headerIndex + 2,
            code: '',
            viMessage: `Không tìm thấy mã hàng bên dưới tiêu đề ở dòng ${headerIndex + 1}.`,
            zhMessage: `第 ${headerIndex + 1} 列表頭下方找不到款號。`
          });
        }
        const positivePieceRows = Array.from(new Map(
          blockRows
            .filter(row => row.piecesPerRow > 0)
            .map(row => [`${row.code}|${row.sheetName}!${row.pieceCell}`, row])
        ).values()); // positivePieceRows（去除合併重複後的有效件數資料列）
        const pieceValues = new Set(positivePieceRows.map(row => row.piecesPerRow)); // pieceValues（同組件數值）
        if(pieceValues.size > 1){
          book.noticeCount += 1;
          book.notices.push({
            sheetName,
            headerRowNumber: headerIndex + 1,
            details: positivePieceRows.map(row => ({
              code: row.code,
              cell: row.pieceCell,
              pieces: row.piecesPerRow
            })),
            viMessage: 'Số kiện trong cùng một nhóm không giống nhau. Vui lòng kiểm tra trước khi nhập.',
            zhMessage: '同一組別的每件條數不一致，請確認後再匯入。'
          });
        }
      });
      if(!detectedBlocks){
        book.warningCount += 1;
        book.issues.push({
          sheetName,
          cell: '',
          rowNumber: 0,
          code: '',
          viMessage: 'Không tìm thấy tiêu đề cố định A–K. Vui lòng kiểm tra cột B, G, H và I.',
          zhMessage: '找不到 A–K 固定表頭，請檢查 B、G、H、I 欄位。'
        });
      }
    });

    book.codes = Array.from(codeMap.values()).map(item => {
      const {pieceSourceKeys, ...storedItem} = item;
      return storedItem;
    }).sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric:true}));
    book.itemCount = book.codes.length;
    return book;
  }

  function buildTemplateMap(){
    const map = new Map();
    state.templates.forEach(book => {
      if(
        book.status !== 'confirmed' ||
        book.schemaVersion !== TEMPLATE_SCHEMA_VERSION ||
        book.analysisVersion !== TEMPLATE_ANALYSIS_VERSION
      ) return;
      (book.codes || []).forEach(item => {
        const templateItem = {...item, templateId: book.id, fileName: book.fileName};
        const aliases = item.aliases && item.aliases.length ? item.aliases : codeAliases(item.code);
        aliases.forEach(alias => {
          if(!map.has(alias)) map.set(alias, templateItem);
        });
        if(!map.has(item.code)) map.set(item.code, templateItem);
      });
    });
    return map;
  }

  async function refreshTemplates(){
    state.templates = window.cuttingStore ? await window.cuttingStore.listTemplates() : [];
    renderTemplateList();
    recomputeResults();
  }

  function waitForTemplateProgressPaint(){
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  async function setTemplateProgress(percent, message, subMessage){
    const wrap = g('cut-template-progress-wrap');
    const bar = g('cut-template-progress-bar');
    const label = g('cut-template-progress-text');
    const sub = g('cut-template-progress-sub');
    if(!wrap) return;
    wrap.style.display = 'block';
    if(bar) bar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
    if(label) label.textContent = message || 'Đang xử lý... / 處理中...';
    if(sub) sub.innerHTML = window.PCMSSafe.lines(subMessage || 'Vui lòng chờ, không đóng trang này. / 請稍候，不要關閉此頁面。');
    await waitForTemplateProgressPaint();
  }

  function hideTemplateProgress(delay = 0){
    const run = () => {
      const wrap = g('cut-template-progress-wrap');
      const bar = g('cut-template-progress-bar');
      if(wrap) wrap.style.display = 'none';
      if(bar) bar.style.width = '0%';
    };
    if(delay > 0) setTimeout(run, delay);
    else run();
  }

  function setTemplateBusy(busy){
    ['cut-template-file', 'cut-template-clear-btn'].forEach(id => {
      const el = g(id);
      if(el) el.disabled = !!busy;
    });
    const confirmButton = g('cut-template-confirm-btn'); // confirmButton（確認模板按鈕）
    const hasReadyTemplate = !!state.pendingTemplateFile && !!state.pendingBook; // hasReadyTemplate（模板已可確認狀態）
    if(confirmButton){
      confirmButton.disabled = !!busy || !hasReadyTemplate;
      confirmButton.classList.toggle('is-ready', hasReadyTemplate);
    }
    const drop = g('cut-template-drop');
    if(drop) drop.disabled = !!busy;
  }

  // clearPendingTemplate（清除待確認模板）：新檔案分析失敗時不得沿用上一份已通過資料。
  function clearPendingTemplate(){
    state.pendingTemplateFile = null;
    state.pendingBook = null;
  }

  function cuttingTemplateModal(options){
    return new Promise(resolve => {
      let modal = g('cut-template-conflict-modal');
      if(!modal){
        modal = document.createElement('div');
        modal.id = 'cut-template-conflict-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.52);z-index:9999;display:none;align-items:center;justify-content:center;padding:18px';
        modal.innerHTML = '<div style="background:var(--sf);border:1px solid var(--bd);border-radius:12px;width:520px;max-width:96vw;box-shadow:0 18px 50px rgba(15,23,42,.22);padding:22px"><div id="cut-template-conflict-title" style="font-size:18px;font-weight:800;color:var(--navy);margin-bottom:12px"></div><div id="cut-template-conflict-body" style="font-size:14px;line-height:1.8;color:var(--ink);margin-bottom:18px"></div><div id="cut-template-conflict-actions" class="br"></div></div>';
        document.body.appendChild(modal);
      }
      const title = g('cut-template-conflict-title');
      const body = g('cut-template-conflict-body');
      const actions = g('cut-template-conflict-actions');
      title.innerHTML = options.title || '';
      body.innerHTML = options.body || '';
      actions.innerHTML = '';
      (options.buttons || []).forEach(btn => {
        const el = document.createElement('button');
        el.className = btn.className || 'btn';
        el.innerHTML = btn.text;
        el.onclick = () => {
          modal.style.display = 'none';
          resolve(btn.value);
        };
        actions.appendChild(el);
      });
      modal.style.display = 'flex';
    });
  }

  // templateIssuesHtml（模板錯誤明細）：以工作表、儲存格、款號與原因呈現可直接修改的位置。
  function templateIssuesHtml(book, limit = 20){
    const issues = Array.isArray(book?.issues) ? book.issues : [];
    if(!issues.length){
      return '<div>Không xác định được vị trí lỗi. Vui lòng kiểm tra tiêu đề A–K trên từng sheet.<br>無法判斷錯誤位置，請檢查每個工作表的 A–K 表頭。</div>';
    }
    const rows = issues.slice(0, limit).map(issue => `
      <tr>
        <td><b>${esc(issue.sheetName || '-')}</b></td>
        <td><b>${esc(issue.cell || '-')}</b></td>
        <td>${issue.code ? `<b>${esc(issue.code)}</b>` : '-'}</td>
        <td>
          <div>${esc(issue.viMessage || '')}</div>
          <div class="tv" style="margin-top:3px">${esc(issue.zhMessage || '')}</div>
        </td>
      </tr>
    `).join('');
    const remaining = issues.length - Math.min(issues.length, limit);
    return `
      <div style="margin-bottom:10px">
        Phát hiện ${fmtNum(issues.length)} lỗi. Vui lòng sửa đúng ô được liệt kê rồi nhập lại.<br>
        發現 ${fmtNum(issues.length)} 個錯誤，請修改列出的儲存格後重新匯入。
      </div>
      <div class="to"><div class="ts" style="max-height:320px"><table>
        <thead><tr>
          <th>Trang tính<br><span class="tv">工作表</span></th>
          <th>Ô<br><span class="tv">儲存格</span></th>
          <th>Mã hàng<br><span class="tv">款號</span></th>
          <th>Vấn đề<br><span class="tv">問題</span></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>
      ${remaining > 0 ? `<div style="margin-top:8px;color:var(--mu)">Còn ${fmtNum(remaining)} lỗi chưa hiển thị. / 另有 ${fmtNum(remaining)} 個錯誤未顯示。</div>` : ''}
    `;
  }

  // showTemplateIssues（顯示模板錯誤）：匯入或確認失敗時顯示同一份明細。
  async function showTemplateIssues(book){
    await cuttingTemplateModal({
      title: 'Chi tiết lỗi mẫu / 模板錯誤明細',
      body: templateIssuesHtml(book),
      buttons: [{text:'Đã hiểu / 確定', value:'ok', className:'btn bp'}]
    });
  }

  // templateNoticesHtml（模板提醒明細）：同組件數不一致時列出每個款號、儲存格與條數。
  function templateNoticesHtml(book, limit = 20){
    const notices = Array.isArray(book?.notices) ? book.notices : [];
    if(!notices.length) return '';
    const rows = notices.slice(0, limit).map(notice => {
      const detailLines = (notice.details || []).map(detail => `
        <div>
          <b>${esc(detail.code || '-')}</b>
          · ${esc(detail.cell || '-')}
          · ${fmtNum(detail.pieces)} dây/SP / 每件 ${fmtNum(detail.pieces)} 條
        </div>
      `).join('');
      return `
        <tr>
          <td><b>${esc(notice.sheetName || '-')}</b></td>
          <td>${fmtNum(notice.headerRowNumber)}</td>
          <td>${detailLines}</td>
          <td>
            <div>${esc(notice.viMessage || '')}</div>
            <div class="tv" style="margin-top:3px">${esc(notice.zhMessage || '')}</div>
          </td>
        </tr>
      `;
    }).join('');
    const remaining = notices.length - Math.min(notices.length, limit);
    return `
      <div style="margin-bottom:10px">
        Đây là cảnh báo, vẫn có thể xác nhận và nhập mẫu.<br>
        此項屬於提醒，仍可確認並匯入模板。
      </div>
      <div class="to"><div class="ts" style="max-height:320px"><table>
        <thead><tr>
          <th>Trang tính<br><span class="tv">工作表</span></th>
          <th>Dòng tiêu đề<br><span class="tv">表頭列</span></th>
          <th>Vị trí và số kiện<br><span class="tv">位置與條數</span></th>
          <th>Cảnh báo<br><span class="tv">提醒</span></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>
      ${remaining > 0 ? `<div style="margin-top:8px;color:var(--mu)">Còn ${fmtNum(remaining)} cảnh báo chưa hiển thị. / 另有 ${fmtNum(remaining)} 個提醒未顯示。</div>` : ''}
    `;
  }

  // showTemplateNotices（顯示模板提醒）：提醒使用者檢查，但不清除待匯入資料。
  async function showTemplateNotices(book){
    await cuttingTemplateModal({
      title: 'Cảnh báo số kiện / 每件條數提醒',
      body: templateNoticesHtml(book),
      buttons: [{text:'Tiếp tục / 繼續', value:'continue', className:'btn bp'}]
    });
  }

  function templateCodeKeys(book){
    const keys = new Set();
    (book?.codes || []).forEach(item => {
      [item.code, ...(item.aliases || [])].forEach(code => {
        const key = normalizeCode(code);
        if(key) keys.add(key);
      });
    });
    return keys;
  }

  function findTemplateCodeConflict(book, templates){
    const incoming = templateCodeKeys(book);
    const rows = [];
    (templates || []).forEach(template => {
      if(template.fileName === book.fileName) return;
      if(template.status && template.status !== 'confirmed') return;
      if(
        template.schemaVersion !== TEMPLATE_SCHEMA_VERSION ||
        template.analysisVersion !== TEMPLATE_ANALYSIS_VERSION
      ) return;
      (template.codes || []).forEach(item => {
        const candidates = [item.code, ...(item.aliases || [])].map(code => normalizeCode(code)).filter(Boolean);
        const matched = candidates.find(code => incoming.has(code));
        if(matched) rows.push({code: item.code || matched, fileName: template.fileName || ''});
      });
    });
    return rows;
  }

  async function checkTemplateSaveConflicts(book){
    const templates = window.cuttingStore ? await window.cuttingStore.listTemplates() : state.templates;
    state.templates = Array.isArray(templates) ? templates : [];
    const codeConflicts = findTemplateCodeConflict(book, state.templates);
    if(codeConflicts.length){
      const lines = codeConflicts.slice(0, 8).map(item => `<div><b>${esc(item.code)}</b> - ${esc(item.fileName)}</div>`).join('');
      await cuttingTemplateModal({
        title: 'Mã hàng đã tồn tại / 已有相同款號',
        body: `Không thể nhập mẫu này vì mã hàng đã có trong mẫu khác.<br>此模板有款號已存在於其他模板，禁止匯入。<div style="margin-top:10px">${lines}${codeConflicts.length > 8 ? '<div>...</div>' : ''}</div>`,
        buttons: [{text:'OK / 確定', value:'ok', className:'btn bp'}]
      });
      return false;
    }
    const sameFile = state.templates.find(item => item.fileName === book.fileName);
    if(sameFile){
      const action = await cuttingTemplateModal({
        title: 'Tên file mẫu đã tồn tại / 已有相同模板檔名',
        body: `Đã có mẫu cùng tên file.<br>已存在相同檔名的模板。<br><br><b>${esc(book.fileName)}</b><br><br>Bạn muốn ghi đè mẫu cũ không?<br>是否要覆蓋原本的模板？`,
        buttons: [
          {text:'Ghi đè / 覆蓋', value:'overwrite', className:'btn bp'},
          {text:'Hủy / 取消', value:'cancel', className:'btn'}
        ]
      });
      return action === 'overwrite';
    }
    return true;
  }

  function renderTemplateList(){
    const tb = g('cut-template-tb');
    if(!tb) return;
    if(!state.templates.length){
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--mu);padding:18px">Chưa có mẫu / 尚無模板</td></tr>';
      return;
    }
    tb.innerHTML = state.templates.map(t => `
      <tr>
        <td><b>${esc(t.fileName)}</b><div style="font-size:10px;color:var(--mu);margin-top:2px">Lưu nguyên file mẫu / 保留原始模板檔</div></td>
        <td style="text-align:right">${fmtNum(t.sheetCount)}</td>
        <td style="text-align:right">${fmtNum(t.itemCount)}</td>
        <td style="text-align:right">${fmtNum(t.rowCount)}</td>
        <td>${t.schemaVersion !== TEMPLATE_SCHEMA_VERSION
          ? '<span class="tg ta">Mẫu cũ đã ngừng / 舊格式已停用</span>'
          : (t.analysisVersion !== TEMPLATE_ANALYSIS_VERSION
            ? '<span class="tg ta">Cần nhập lại / 需要重新匯入</span>'
          : (t.status === 'confirmed'
            ? (t.warningCount
              ? `<span class="tg ta">Có lỗi / 有錯誤</span>`
              : (t.noticeCount
                ? `<span class="tg ta">Đã xác nhận, ${fmtNum(t.noticeCount)} cảnh báo / 已確認，${fmtNum(t.noticeCount)} 個提醒</span>`
                : '<span class="tg tg2">Đã xác nhận / 已確認</span>'))
            : '<span class="tg ta">Chưa xác nhận / 尚未確認</span>'))}</td>
        <td style="text-align:center">
          <div class="cut-template-actions">
            <button class="btn cut-template-action cut-template-download" onclick="cuttingDownloadTemplate(${inlineArg(t.id)}, this)">
              <i class="ti ti-file-download"></i>
              <span class="cut-template-action-text"><span class="cut-template-action-vi">Tải file gốc</span><span class="cut-template-action-zh">下載原始檔</span></span>
            </button>
            <button class="btn cut-template-action bd2" onclick="cuttingDeleteTemplate(${inlineArg(t.id)})">
              <i class="ti ti-trash"></i>
              <span class="cut-template-action-text"><span class="cut-template-action-vi">Xóa</span><span class="cut-template-action-zh">刪除</span></span>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // showCuttingSaveUnsupported（顯示不支援另存新檔提示）：所有裁帶下載都禁止改用瀏覽器預設位置。
  function showCuttingSaveUnsupported(){
    alert(
      'Trình duyệt này không hỗ trợ chọn vị trí lưu tệp.\n' +
      'Vui lòng sử dụng phiên bản Microsoft Edge hoặc Google Chrome mới nhất.\n\n' +
      '此瀏覽器不支援選擇檔案儲存位置。\n' +
      '請使用最新版 Microsoft Edge 或 Google Chrome。'
    );
  }

  // chooseCuttingSaveHandle（選擇儲存位置）：由模板與 PDF 下載共用，必須由使用者點擊後直接呼叫。
  async function chooseCuttingSaveHandle(suggestedName, fileType){
    if(typeof window.showSaveFilePicker !== 'function'){
      showCuttingSaveUnsupported();
      return null;
    }
    try{
      return await window.showSaveFilePicker({
        suggestedName,
        types: [fileType],
        excludeAcceptAllOption: true
      });
    }catch(error){
      if(error?.name === 'AbortError') return null;
      if(error?.name === 'SecurityError' || error?.name === 'NotAllowedError'){
        showCuttingSaveUnsupported();
        return null;
      }
      throw error;
    }
  }

  // writeCuttingFileToHandle（寫入所選檔案）：模板與 PDF 共用，失敗時中止未完成的寫入。
  async function writeCuttingFileToHandle(fileHandle, fileData){
    const writable = await fileHandle.createWritable(); // writable（可寫入檔案串流）
    let completed = false; // completed（是否寫入完成）
    try{
      await writable.write(fileData);
      await writable.close();
      completed = true;
    }finally{
      if(!completed){
        try{ await writable.abort(); }catch(_){}
      }
    }
  }

  // cuttingDownloadTemplate（下載原始模板）：先選擇儲存位置，再優先使用瀏覽器快取，必要時才從雲端還原原始檔。
  async function cuttingDownloadTemplate(templateId, button){
    if(!templateId || button?.disabled) return;
    const template = state.templates.find(item => item.id === templateId); // template（模板資料）
    const fileName = template?.fileName || 'mau-cat-day.xlsx'; // fileName（檔案名稱）
    let saveHandle = null; // saveHandle（儲存檔案控制物件）
    try{
      saveHandle = await chooseCuttingSaveHandle(fileName, {
        description: 'Tệp Excel / Excel 表格檔',
        accept: {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']}
      });
    }catch(error){
      console.error('Mở cửa sổ lưu file thất bại / 開啟儲存視窗失敗', error);
      alert('Không thể mở cửa sổ chọn vị trí lưu.\n無法開啟儲存位置選擇視窗。');
      return;
    }
    if(!saveHandle) return;
    const originalHtml = button?.innerHTML || ''; // originalHtml（按鈕原始內容）
    if(button){
      button.disabled = true;
      button.innerHTML = '<i class="ti ti-loader-2"></i><span class="cut-template-action-text"><span class="cut-template-action-vi">Đang tải</span><span class="cut-template-action-zh">下載中</span></span>';
    }
    try{
      const sourceFile = await cuttingStore.getTemplateFile(templateId); // sourceFile（原始模板檔）
      if(!sourceFile){
        throw new Error('Không tìm thấy file mẫu gốc. / 找不到原始模板檔。');
      }
      await writeCuttingFileToHandle(saveHandle, sourceFile);
    }catch(error){
      console.error('Tải file mẫu thất bại / 下載模板檔失敗', error);
      alert(
        'Không thể tải file mẫu gốc. Vui lòng thử lại.\n' +
        '無法下載原始模板檔，請稍後再試。\n\n' +
        String(error?.message || '')
      );
    }finally{
      if(button){
        button.disabled = false;
        button.innerHTML = originalHtml;
      }
    }
  }

  function renderTemplateAnalysis(book){
    const box = g('cut-template-analysis');
    if(!box) return;
    if(!book){
      box.style.display = 'none';
      html('cut-template-analysis-body', '');
      return;
    }
    box.style.display = 'block';
    const hasAttention = !!(book.warningCount || book.noticeCount); // hasAttention（模板是否有需注意內容）
    const statusClass = book.warningCount ? 'nw' : (book.noticeCount ? 'nw' : 'ns'); // statusClass（模板檢查狀態樣式）
    const statusIcon = hasAttention ? 'ti-alert-triangle' : 'ti-circle-check'; // statusIcon（模板檢查狀態圖示）
    const statusText = book.warningCount
      ? '<strong>Mẫu chưa đạt, vui lòng sửa theo thông báo.</strong><br><span class="tv">模板尚未通過，請依提示修正。</span>'
      : (book.noticeCount
        ? `<strong>Kiểm tra mẫu hoàn tất, có ${fmtNum(book.noticeCount)} mục cần xác nhận.</strong><br><span class="tv">模板檢查完成，有 ${fmtNum(book.noticeCount)} 項需要確認。</span>`
        : '<strong>Kiểm tra mẫu đạt.</strong><br><span class="tv">模板檢查通過。</span>'); // statusText（模板檢查雙語結果）
    html('cut-template-analysis-body', `
      <div class="nt ${statusClass} cutting-inline-result">
        <i class="ti ${statusIcon}"></i>
        <div>${statusText}</div>
      </div>
    `);
  }

  function cuttingPickTemplate(){
    const input = g('cut-template-file');
    if(input) input.click();
  }

  function cuttingImportDragOver(event){
    event.preventDefault();
    const drop = g('cut-template-drop');
    if(drop) drop.classList.add('dragging');
  }

  function cuttingImportDragLeave(event){
    event.preventDefault();
    const drop = g('cut-template-drop');
    if(drop) drop.classList.remove('dragging');
  }

  function cuttingTemplateDrop(event){
    event.preventDefault();
    event.stopPropagation();
    const drop = g('cut-template-drop');
    if(drop) drop.classList.remove('dragging');
    const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
    if(file) cuttingAnalyzeTemplateFile(file);
  }

  function isXlsxTemplateFile(file){
    return !!(file && /\.xlsx$/i.test(file.name || ''));
  }

  function alertTemplateFileTypeError(fileName){
    alert(
      `Chỉ hỗ trợ tệp mẫu .xlsx.\n僅支援 .xlsx 模板檔。\n\n` +
      `Tệp hiện tại: ${fileName || '-'}\n目前檔案：${fileName || '-'}\n\n` +
      `Cách xử lý: Mở tệp bằng Excel, chọn lưu dưới dạng .xlsx, rồi nhập lại.\n解決方式：請用 Excel 開啟檔案，選「另存新檔」，存成 .xlsx 後再匯入。\n\n` +
      `Không chỉ đổi tên đuôi tệp.\n不要只修改副檔名。`
    );
  }

  async function cuttingHandleTemplateFile(input){
    const file = input && input.files ? input.files[0] : null;
    if(!file) return;
    await cuttingAnalyzeTemplateFile(file);
    input.value = '';
  }
  async function cuttingConfirmTemplate(){
    if(!state.pendingTemplateFile || !state.pendingBook){
      alert('Chưa có mẫu cần xác nhận.\n尚無需要確認的模板。');
      return;
    }
    setTemplateBusy(true);
    try{
      await setTemplateProgress(8, 'Đang kiểm tra cấu trúc cố định... / 正在檢查固定格式...', 'Hệ thống chỉ nhận mẫu mới có cột A–K cố định. / 系統只接受新版 A–K 固定欄位模板。');
      const book = {...state.pendingBook, status:'confirmed', confirmedAt:new Date().toISOString()};
      if(!book.itemCount || book.warningCount){
        hideTemplateProgress();
        await showTemplateIssues(book);
        return;
      }
      await setTemplateProgress(18, 'Đang chuẩn bị lưu mẫu... / 正在準備儲存模板...', 'Excel sẽ được chia nhỏ để lưu vào cơ sở dữ liệu đám mây. / Excel 會分段存到雲端資料庫。');
      const canSave = await checkTemplateSaveConflicts(book);
      if(!canSave){
        hideTemplateProgress();
        return;
      }
      await window.cuttingStore.saveTemplateBook(book, state.pendingTemplateFile, progress => {
        const total = Number(progress?.total || 0);
        const current = Number(progress?.current || 0);
        const percent = Number(progress?.percent || 0);
        const remainingSeconds = Number(progress?.remainingSeconds || 0);
        const remainingText = remainingSeconds > 0
          ? `\nƯớc tính còn khoảng ${remainingSeconds} giây. / 預估剩餘約 ${remainingSeconds} 秒。`
          : '';
        const label = progress?.stage === 'uploading'
          ? `Đang lưu phân đoạn ${current}/${total}... / 正在儲存分段 ${current}/${total}...`
          : (progress?.message || 'Đang lưu mẫu... / 正在儲存模板...');
        const sub = progress?.stage === 'uploading'
          ? 'Vui lòng chờ đến khi thanh tiến độ hoàn tất. / 請等進度條完成。'
          : 'Vui lòng chờ, không đóng trang này. / 請稍候，不要關閉此頁面。';
        setTemplateProgress(percent || 35, label, sub + remainingText);
      });
      await setTemplateProgress(92, 'Đang làm mới danh sách mẫu... / 正在更新模板清單...', 'Sắp hoàn tất. / 即將完成。');
      state.pendingTemplateFile = null;
      state.pendingBook = null;
      setTemplateFileDisplay('');
      renderTemplateAnalysis(null);
      await refreshTemplates();
      if(window.saveOperationLogToFB){
        try{
          const savedLog = await saveOperationLogToFB({
            permissionKey:'cutting',
            feature:'cutting',
            action:'cuttingTemplateImport',
            status:'success',
            itemCount:Number(book.itemCount)||0,
            detailCount:Number(book.rowCount)||0,
            fileName:book.fileName||''
          });
          rememberCuttingHistoryLog(savedLog);
        }catch(logError){
          console.error('Không thể lưu operationLogs / 無法儲存操作紀錄：',logError);
          alert('Đã lưu mẫu, nhưng không thể lưu lịch sử thao tác.\n模板已儲存，但操作紀錄無法保存。');
        }
      }
      await setTemplateProgress(100, 'Đã lưu mẫu. / 已儲存模板。', 'Có thể tiếp tục thao tác. / 可以繼續操作。');
      hideTemplateProgress(800);
    }catch(e){
      console.error(e);
      hideTemplateProgress();
      alert('Lưu mẫu thất bại.\n儲存模板失敗。\n' + (e.message || e));
    }finally{
      setTemplateBusy(false);
    }
  }

  async function cuttingAnalyzeTemplateFile(file){
    clearPendingTemplate();
    setTemplateFileDisplay('');
    if(!isXlsxTemplateFile(file)){
      setTemplateBusy(false);
      alertTemplateFileTypeError(file.name);
      return;
    }
    setTemplateFileDisplay(file.name);
    setTemplateBusy(true);
    try{
      await window.PCMSFeatures.ensureSpreadsheetTool();
      await setTemplateProgress(8, 'Đang đọc file mẫu... / 正在讀取模板檔案...', file.name);
      const data = await file.arrayBuffer();
      await setTemplateProgress(30, 'Đang mở Excel... / 正在開啟 Excel...', 'Hệ thống đang đọc nội dung bảng tính. / 系統正在讀取活頁簿內容。');
      const wb = XLSX.read(data, {type:'array', cellFormula:false, cellStyles:false});
      await setTemplateProgress(58, 'Đang kiểm tra cột A–K và mã hàng... / 正在檢查 A–K 欄位與款號...', 'Mỗi phân trang được đọc tiêu đề riêng. / 每個分頁都會獨立讀取抬頭。');
      const book = analyzeTemplateWorkbook(file.name, wb);
      if(!book.itemCount || book.warningCount){
        const firstIssue = Array.isArray(book.issues) && book.issues.length ? book.issues[0] : null; // firstIssue（第一筆模板錯誤）
        const issueLocation = firstIssue
          ? `Trang tính ${firstIssue.sheetName || '-'} · Ô ${firstIssue.cell || '-'} / 工作表 ${firstIssue.sheetName || '-'} · 儲存格 ${firstIssue.cell || '-'}`
          : 'Vui lòng xem chi tiết lỗi bên dưới. / 請查看下方錯誤明細。';
        await setTemplateProgress(100, 'Mẫu có dữ liệu cần sửa. / 模板有資料需要修改。', issueLocation);
        renderTemplateAnalysis(book);
        await showTemplateIssues(book);
        hideTemplateProgress(800);
        return;
      }
      book.status = 'pending';
      state.pendingTemplateFile = file;
      state.pendingBook = book;
      await setTemplateProgress(
        100,
        book.noticeCount ? 'Phân tích hoàn tất, có cảnh báo. / 分析完成，另有提醒。' : 'Phân tích mẫu hoàn tất. / 模板分析完成。',
        book.noticeCount ? 'Vẫn có thể xác nhận và nhập mẫu. / 仍可確認並匯入模板。' : 'Cấu trúc cố định đã hợp lệ. / 固定格式已通過檢查。'
      );
      renderTemplateAnalysis(book);
      if(book.noticeCount) await showTemplateNotices(book);
      hideTemplateProgress(800);
    }catch(e){
      console.error(e);
      hideTemplateProgress();
      alert('Phân tích mẫu Excel thất bại.\n分析 Excel 模板失敗。\n' + (e.message || e));
    }finally{
      setTemplateBusy(false);
    }
  }

  async function cuttingDeleteTemplateCache(template, sourceFile){
    const payload = {
      templateId: template?.id || '',
      templateUpdatedAt: template?.updatedAt || '',
      templateFileSize: sourceFile?.size || '',
      fileName: template?.fileName || ''
    };
    if(!payload.templateId) throw new Error('Thiếu mã mẫu cần xóa.\n缺少要刪除的模板編號。');
    const response = await fetchCuttingPdfTool('/cutting/cache', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    }, 10000);
    if(!response.ok){
      let message = 'Không thể xóa bộ nhớ đệm mẫu.\n無法刪除模板快取。';
      try{
        const data = await response.json();
        if(data.error) message += `\n${data.error}`;
      }catch(_){}
      throw new Error(message);
    }
    return response.json();
  }

  async function cuttingDeleteTemplate(id){
    if(!confirm('Xóa mẫu này?\n確定刪除此模板？')) return;
    try{
      const pdfToolReady = await cuttingCheckPdfToolStatus();
      if(!pdfToolReady){
        alert('Vui lòng mở công cụ PDF trước khi xóa mẫu.\n刪除模板前請先啟動 PDF 工具。');
        return;
      }
      const template = window.cuttingStore.getTemplate ? await window.cuttingStore.getTemplate(id) : null;
      await window.cuttingStore.removeTemplate(id);
      let cacheCleared = false;
      try{
        await cuttingDeleteTemplateCache(template || {id}, null);
        cacheCleared = true;
      }catch(cacheError){
        console.warn('清除裁帶模板快取失敗', cacheError);
      }
      renderTemplateAnalysis(null);
      await refreshTemplates();
      let historySaved = false; // historySaved（刪除操作紀錄是否已保存）
      if(window.saveOperationLogToFB){
        try{
          const savedLog = await saveOperationLogToFB({
            permissionKey:'cutting',
            feature:'cutting',
            action:'cuttingTemplateDelete',
            status:'success',
            itemCount:Number(template?.itemCount)||0,
            detailCount:Number(template?.rowCount)||0,
            fileName:template?.fileName||'',
            note:String(id||'')
          });
          rememberCuttingHistoryLog(savedLog);
          historySaved = true;
        }catch(logError){
          console.error('Không thể lưu operationLogs khi xóa mẫu / 刪除模板時無法儲存操作紀錄：',logError);
        }
      }
      const historyWarning = historySaved
        ? ''
        : '\n\nKhông thể lưu lịch sử thao tác.\n操作紀錄無法保存。';
      if(cacheCleared){
        alert('Đã xóa mẫu và bộ nhớ đệm.\n已刪除模板與快取。'+historyWarning);
      }else{
        alert('Đã xóa mẫu trên đám mây. Bộ nhớ đệm trên máy này chưa xóa, nhưng sẽ không chặn thao tác.\n已刪除雲端模板。本機快取尚未清除，但不會阻止操作。'+historyWarning);
      }
    }catch(e){
      console.error(e);
      alert('Xóa mẫu thất bại.\n刪除模板失敗。\n\n' + (e.message || e));
    }
  }

  function cuttingPickOrder(){
    const input = g('cut-order-file');
    if(input) input.click();
  }

  function cuttingOrderDragOver(event){
    event.preventDefault();
    const drop = g('cut-order-drop');
    if(drop) drop.classList.add('dragging');
  }

  function cuttingOrderDragLeave(event){
    event.preventDefault();
    const drop = g('cut-order-drop');
    if(drop) drop.classList.remove('dragging');
  }

  function cuttingOrderDrop(event){
    event.preventDefault();
    event.stopPropagation();
    const drop = g('cut-order-drop');
    if(drop) drop.classList.remove('dragging');
    const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
    if(file) cuttingHandleOrderFile({files:[file]});
  }

  function cuttingClearCurrent(){
    state.orderItems = [];
    state.orderErrors = [];
    state.orderCodeCount = 0;
    state.orderLabel = '';
    state.results = [];
    clearPendingTemplate();
    setTemplateFileDisplay('');
    setOrderFileDisplay('');
    setTemplateBusy(false);
    renderTemplateAnalysis(null);
    renderResults();
  }

  function cuttingClearTemplateCurrent(){
    clearPendingTemplate();
    const input = g('cut-template-file');
    if(input) input.value = '';
    setTemplateFileDisplay('');
    hideTemplateProgress();
    setTemplateBusy(false);
    renderTemplateAnalysis(null);
  }

  const ORDER_CODE_HEADERS = new Set([
    'ITEMNO','ITEMNUMBER','ITEM','SKU','STYLE','MODEL','MAHANG','款號','货号'
  ]); // ORDER_CODE_HEADERS（款號表頭名稱）：只接受明確表頭，不依資料外觀猜測。
  const ORDER_QTY_HEADERS = new Set([
    'QTY','QUANTITY','ORDERQTY','PCS','SLPOPCS','SOLUONG','SOLUONGPCS','SL','數量','数量','訂單數量'
  ]); // ORDER_QTY_HEADERS（訂單數量表頭名稱）：PCS 是表頭名稱，不是數量內容。

  // orderHeaderParts（拆分訂單表頭）：允許同一格使用換行或斜線顯示雙語表頭。
  function orderHeaderParts(value){
    const rawParts = String(value ?? '').split(/[\r\n\/|｜]+/); // rawParts（原始表頭片段）
    return rawParts.map(part => normalizeHeader(part)).filter(Boolean);
  }

  // matchesOrderHeader（比對訂單表頭）：必須完整符合已核准名稱，避免把說明或其他數字標題誤認成訂單資料。
  function matchesOrderHeader(value, acceptedHeaders){
    const parts = orderHeaderParts(value); // parts（標準化表頭片段）
    return parts.some(part => acceptedHeaders.has(part));
  }

  // findOrderHeader（尋找訂單表頭）：同一列必須各有一個明確的款號與訂單數量表頭。
  function findOrderHeader(rows){
    for(let rowIndex = 0; rowIndex < Math.min(rows.length, 35); rowIndex++){
      const row = rows[rowIndex] || []; // row（目前檢查列）
      const codeIndexes = []; // codeIndexes（款號表頭位置）
      const qtyIndexes = []; // qtyIndexes（訂單數量表頭位置）
      row.forEach((value, cellIndex) => {
        if(matchesOrderHeader(value, ORDER_CODE_HEADERS)) codeIndexes.push(cellIndex);
        if(matchesOrderHeader(value, ORDER_QTY_HEADERS)) qtyIndexes.push(cellIndex);
      });
      if(codeIndexes.length && qtyIndexes.length){
        if(codeIndexes.length === 1 && qtyIndexes.length === 1 && codeIndexes[0] !== qtyIndexes[0]){
          return {ok:true, row:rowIndex, codeIdx:codeIndexes[0], qtyIdx:qtyIndexes[0]};
        }
        return {
          ok:false,
          reasonVi:'Không thể xác định duy nhất tiêu đề mã hàng và số lượng đơn hàng.',
          reasonZh:'無法唯一確認款號與訂單數量表頭。',
          solutionVi:'Chỉ giữ một tiêu đề mã hàng và một tiêu đề số lượng đơn hàng trong cùng một dòng.',
          solutionZh:'請在同一列表頭中只保留一個款號表頭及一個訂單數量表頭。'
        };
      }
    }
    return {
      ok:false,
      reasonVi:'Không tìm thấy tiêu đề mã hàng và số lượng đơn hàng.',
      reasonZh:'找不到款號與訂單數量表頭。',
      solutionVi:'Kiểm tra tiêu đề mã hàng và tiêu đề PCS hoặc số lượng đơn hàng rồi nhập lại.',
      solutionZh:'請確認款號表頭，以及 PCS 或訂單數量表頭後重新匯入。'
    };
  }

  // parseOrderQuantity（檢查訂單數量）：只接受大於零的安全整數，不移除文字、單位、小數點或其他符號後猜測數量。
  function parseOrderQuantity(value){
    const rawText = String(value ?? '').trim(); // rawText（原始訂單數量文字）
    if(rawText === '') return {ok:false, kind:'blank', rawText};
    if(typeof value === 'number'){
      if(!Number.isFinite(value)) return {ok:false, kind:'invalid', rawText};
      if(value === 0) return {ok:false, kind:'zero', rawText};
      if(value < 0) return {ok:false, kind:'negative', rawText};
      if(!Number.isInteger(value)) return {ok:false, kind:'decimal', rawText};
      if(!Number.isSafeInteger(value)) return {ok:false, kind:'unsafe', rawText};
      return {ok:true, value, rawText};
    }
    if(!/^\d+$/.test(rawText)){
      const numericValue = Number(rawText); // numericValue（可直接轉換的數值）：只用來區分小數、負數與一般無效文字。
      if(Number.isFinite(numericValue) && numericValue < 0) return {ok:false, kind:'negative', rawText};
      if(Number.isFinite(numericValue) && !Number.isInteger(numericValue)) return {ok:false, kind:'decimal', rawText};
      return {ok:false, kind:'invalid', rawText};
    }
    const integerValue = Number(rawText); // integerValue（訂單整數數量）
    if(integerValue === 0) return {ok:false, kind:'zero', rawText};
    if(!Number.isSafeInteger(integerValue)) return {ok:false, kind:'unsafe', rawText};
    return {ok:true, value:integerValue, rawText};
  }

  // orderIssueLocation（訂單問題位置）：用工作表名稱與資料列說明，不要求使用者記住英文字母欄位。
  function orderIssueLocation(sheetName, rowNumber){
    const safeSheetName = String(sheetName || '-'); // safeSheetName（顯示用工作表名稱）
    return {
      vi: rowNumber > 0 ? `Trang tính ${safeSheetName} · Dòng ${rowNumber}` : `Trang tính ${safeSheetName}`,
      zh: rowNumber > 0 ? `工作表 ${safeSheetName} · 第 ${rowNumber} 列` : `工作表 ${safeSheetName}`
    };
  }

  // createOrderError（建立訂單錯誤）：訂單不完整才使用錯誤，缺少模板不得使用此狀態。
  function createOrderError({sheetName, rowNumber = 0, code = '', reasonVi, reasonZh, solutionVi, solutionZh}){
    const location = orderIssueLocation(sheetName, rowNumber); // location（訂單錯誤位置）
    return {
      code,
      qty:0,
      piecesPerItem:0,
      totalPieces:0,
      reverseQty:0,
      status:'error',
      source:'order',
      locationVi:location.vi, // locationVi（越文位置文字）
      locationZh:location.zh, // locationZh（中文位置文字）
      detailReasonVi:reasonVi, // detailReasonVi（越文原因內容）
      detailReasonZh:reasonZh, // detailReasonZh（中文原因內容）
      reasonVi:`${location.vi}. ${reasonVi}`,
      reasonZh:`${location.zh}。${reasonZh}`,
      solutionVi,
      solutionZh
    };
  }

  // quantityIssueText（訂單數量錯誤文字）：依空白、零、負數、小數或其他無效內容提供具體原因。
  function quantityIssueText(quantityResult){
    const rawText = quantityResult.rawText || ''; // rawText（錯誤數量原文）
    const shownValue = rawText || '(trống / 空白)'; // shownValue（顯示用原始數量）
    const reasonMap = {
      blank:{vi:'Mã hàng có dữ liệu nhưng số lượng đơn hàng đang trống.',zh:'已有款號，但訂單數量空白。'},
      zero:{vi:'Số lượng đơn hàng bằng 0.',zh:'訂單數量為 0。'},
      negative:{vi:`Số lượng đơn hàng là số âm: ${shownValue}.`,zh:`訂單數量為負數：${shownValue}。`},
      decimal:{vi:`Số lượng đơn hàng có số thập phân: ${shownValue}.`,zh:`訂單數量含有小數：${shownValue}。`},
      unsafe:{vi:`Số lượng đơn hàng vượt quá phạm vi an toàn: ${shownValue}.`,zh:`訂單數量超出安全範圍：${shownValue}。`},
      invalid:{vi:`Số lượng đơn hàng không hợp lệ: ${shownValue}.`,zh:`訂單數量內容無效：${shownValue}。`}
    }; // reasonMap（訂單數量錯誤原因）
    return reasonMap[quantityResult.kind] || reasonMap.invalid;
  }

  // parseOrderRows（檢查訂單資料列）：完整列才進入模板配對；錯誤列保留位置與原始原因並阻止匯出。
  function parseOrderRows(rows, sheetName = '-'){
    const header = findOrderHeader(rows); // header（已確認的訂單表頭）
    if(!header.ok){
      return {
        items:[],
        errors:[createOrderError({sheetName, reasonVi:header.reasonVi, reasonZh:header.reasonZh, solutionVi:header.solutionVi, solutionZh:header.solutionZh})],
        codeCount:0
      };
    }
    const candidates = []; // candidates（逐列檢查通過的訂單資料）
    const errors = []; // errors（訂單資料錯誤）
    const codeRows = new Map(); // codeRows（同一款號出現的資料列）
    for(let rowIndex = header.row + 1; rowIndex < rows.length; rowIndex++){
      const row = rows[rowIndex] || []; // row（目前訂單資料列）
      const rawCode = row[header.codeIdx]; // rawCode（原始款號內容）
      const rawQty = row[header.qtyIdx]; // rawQty（原始訂單數量內容）
      const code = normalizeCode(rawCode); // code（標準化款號）
      const quantityText = String(rawQty ?? '').trim(); // quantityText（訂單數量原文）
      if(!code && !quantityText) continue;
      const rowNumber = rowIndex + 1; // rowNumber（Excel 資料列號碼）
      if(
        matchesOrderHeader(rawCode, ORDER_CODE_HEADERS) &&
        matchesOrderHeader(rawQty, ORDER_QTY_HEADERS)
      ) continue;
      if(code){
        if(!codeRows.has(code)) codeRows.set(code, []);
        codeRows.get(code).push(rowNumber);
      }
      if(!code){
        errors.push(createOrderError({
          sheetName,
          rowNumber,
          reasonVi:`Có số lượng đơn hàng "${quantityText}" nhưng mã hàng đang trống.`,
          reasonZh:`有訂單數量「${quantityText}」，但款號空白。`,
          solutionVi:'Điền mã hàng tương ứng rồi nhập lại đơn hàng.',
          solutionZh:'請填入對應款號後重新匯入訂單。'
        }));
        continue;
      }
      const quantityResult = parseOrderQuantity(rawQty); // quantityResult（訂單數量檢查結果）
      if(!quantityResult.ok){
        const reason = quantityIssueText(quantityResult); // reason（訂單數量錯誤原因）
        errors.push(createOrderError({
          sheetName,
          rowNumber,
          code,
          reasonVi:reason.vi,
          reasonZh:reason.zh,
          solutionVi:'Nhập số lượng đơn hàng là số nguyên lớn hơn 0 rồi nhập lại.',
          solutionZh:'請將訂單數量改為大於 0 的整數後重新匯入。'
        }));
        continue;
      }
      candidates.push({code, qty:quantityResult.value, rowNumber});
    }
    const duplicateCodes = new Set(); // duplicateCodes（重複款號）
    codeRows.forEach((rowNumbers, code) => {
      if(rowNumbers.length <= 1) return;
      duplicateCodes.add(code);
      const rowText = rowNumbers.join(', '); // rowText（重複款號資料列）
      errors.push(createOrderError({
        sheetName,
        rowNumber:rowNumbers[0],
        code,
        reasonVi:`Mã hàng bị trùng ở các dòng ${rowText}.`,
        reasonZh:`款號重複出現在第 ${rowText} 列。`,
        solutionVi:'Chỉ giữ một dòng duy nhất cho mã hàng này, không cộng gộp tự động.',
        solutionZh:'請只保留此款號唯一一筆資料，系統不會自動合併數量。'
      }));
    });
    const items = candidates
      .filter(item => !duplicateCodes.has(item.code))
      .map(({code, qty}) => ({code, qty})); // items（可進行模板配對的完整訂單資料）
    if(!items.length && !errors.length){
      errors.push(createOrderError({
        sheetName,
        reasonVi:'Không tìm thấy dữ liệu mã hàng và số lượng đơn hàng.',
        reasonZh:'找不到款號與訂單數量資料。',
        solutionVi:'Kiểm tra nội dung bên dưới tiêu đề mã hàng và số lượng đơn hàng rồi nhập lại.',
        solutionZh:'請檢查款號與訂單數量表頭下方的資料後重新匯入。'
      }));
    }
    return {items, errors, codeCount:codeRows.size};
  }

  // extractOrderHeadingValue（解析訂單標題儲存格）：支援 ORDER NO（訂單編號）與 ORDER NUMBER（訂單編號）。
  function extractOrderHeadingValue(value){
    const raw = String(value ?? '').replace(/\u00a0/g, ' ').trim();
    if(!raw) return null;
    const match = raw.match(/^ORDER\s*(?:NO\.?|NUMBER)\s*[:：]?\s*(.*)$/i);
    return match ? String(match[1] || '').trim() : null;
  }

  // findOrderNumbersInRows（從訂單列尋找訂單號碼）：標題同格無號碼時，讀取右側最近的非空白儲存格。
  function findOrderNumbersInRows(rows){
    const numbers = [];
    (rows || []).forEach(row => {
      const cells = Array.isArray(row) ? row : [];
      cells.forEach((cell, columnIndex) => {
        let number = extractOrderHeadingValue(cell);
        if(number === null) return;
        if(!number){
          const lastColumn = Math.min(cells.length - 1, columnIndex + 12);
          for(let nextColumn = columnIndex + 1; nextColumn <= lastColumn; nextColumn++){
            const candidate = String(cells[nextColumn] ?? '').trim();
            if(!candidate) continue;
            number = candidate.replace(/^[:：]\s*/, '').trim();
            break;
          }
        }
        if(number) numbers.push(number);
      });
    });
    return numbers;
  }

  // buildDetectedOrderLabel（建立辨識後的左上角文字）：唯一結果預加 PO#（訂單編號前綴），多個不同結果視為無法辨識。
  function buildDetectedOrderLabel(numbers){
    const unique = new Map();
    (numbers || []).forEach(value => {
      const number = String(value ?? '').trim();
      if(number) unique.set(number.toUpperCase(), number);
    });
    if(unique.size !== 1) return '';
    const number = Array.from(unique.values())[0];
    return /^PO\s*#/i.test(number) ? number.replace(/^PO\s*#\s*/i, 'PO#') : `PO#${number}`;
  }

  // openCuttingOrderLabelDialog（開啟訂單文字視窗）：有辨識結果時預填，沒有結果時保持空白。
  function openCuttingOrderLabelDialog(defaultValue){
    const input = g('cut-order-label-input');
    const help = g('cut-order-label-help');
    const error = g('cut-order-label-error');
    if(!input) return Promise.resolve(null);
    input.value = String(defaultValue || '');
    if(help){
      help.innerHTML = input.value
        ? 'Đã tự nhận diện số đơn hàng. Có thể sửa nội dung trước khi xuất.<br>已自動辨識訂單號碼，匯出前仍可修改內容。'
        : 'Không nhận diện được số đơn hàng. Vui lòng tự nhập nội dung cần hiển thị.<br>未辨識到訂單號碼，請自行輸入要顯示的內容。';
    }
    if(error){ error.textContent = ''; error.style.display = 'none'; }
    input.onkeydown = event => {
      if(event.key === 'Enter'){ // Enter（確認鍵）
        event.preventDefault();
        cuttingConfirmOrderLabel();
      }
    };
    om('m-cutting-order-label');
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return new Promise(resolve => { orderLabelDialogResolve = resolve; });
  }

  // cuttingConfirmOrderLabel（確認訂單文字）：空白或只有空格時禁止繼續。
  function cuttingConfirmOrderLabel(){
    const input = g('cut-order-label-input');
    const error = g('cut-order-label-error');
    const value = String(input?.value || '').trim();
    if(!value){
      if(error){
        error.textContent = 'Vui lòng nhập nội dung trước khi tạo PDF. / 請輸入內容後再產生 PDF。';
        error.style.display = 'block';
      }
      input?.focus();
      return;
    }
    state.orderLabel = value;
    cm('m-cutting-order-label');
    const resolve = orderLabelDialogResolve;
    orderLabelDialogResolve = null;
    if(resolve) resolve(value);
  }

  // cuttingCancelOrderLabel（取消訂單文字視窗）：停止本次 PDF 匯出。
  function cuttingCancelOrderLabel(){
    cm('m-cutting-order-label');
    const resolve = orderLabelDialogResolve;
    orderLabelDialogResolve = null;
    if(resolve) resolve(null);
  }

  async function cuttingHandleOrderFile(input){
    const file = input && input.files ? input.files[0] : null;
    if(!file) return;
    state.orderItems = [];
    state.orderErrors = [];
    state.orderCodeCount = 0;
    state.results = [];
    setOrderFileDisplay(file.name);
    state.orderLabel = '';
    renderResults();
    try{
      if(!/\.(xlsx|xls)$/i.test(String(file.name || ''))){
        state.orderErrors = [createOrderError({
          sheetName:'-',
          reasonVi:'Định dạng tệp đơn hàng không được hỗ trợ.',
          reasonZh:'訂單檔案格式不受支援。',
          solutionVi:'Chọn tệp đơn hàng .xlsx hoặc .xls rồi nhập lại.',
          solutionZh:'請選擇 .xlsx 或 .xls 訂單檔案後重新匯入。'
        })];
        setOrderFileDisplay(`${file.name}（định dạng không hợp lệ / 格式不符）`);
        recomputeResults();
        return;
      }
      await window.PCMSFeatures.ensureSpreadsheetTool();
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, {type:'array'});
      const sheetCount = Array.isArray(wb.SheetNames) ? wb.SheetNames.length : 0; // sheetCount（訂單工作表數量）
      if(sheetCount !== 1){
        const sheetNames = sheetCount ? wb.SheetNames.map(name => String(name || '')).join(', ') : '-'; // sheetNames（訂單工作表名稱）
        state.orderErrors = [createOrderError({
          sheetName:sheetNames,
          reasonVi:`Tệp đơn hàng có ${sheetCount} trang tính.`,
          reasonZh:`訂單檔案共有 ${sheetCount} 個工作表。`,
          solutionVi:'Chỉ giữ một trang tính đơn hàng rồi nhập lại.',
          solutionZh:'請只保留一個訂單工作表後重新匯入。'
        })];
        setOrderFileDisplay(`${file.name}（${sheetCount} trang tính, bị từ chối / 共 ${sheetCount} 個工作表，已禁止匯入）`);
        recomputeResults();
        alert(
          `Tệp đơn hàng chỉ được có 1 trang tính.\n` +
          `Tệp hiện tại có ${sheetCount} trang tính: ${sheetNames}.\n` +
          `Vui lòng xóa các trang tính khác hoặc lưu riêng trang cần nhập rồi thử lại.\n\n` +
          `訂單檔案只允許 1 個工作表。\n` +
          `此檔案共有 ${sheetCount} 個工作表：${sheetNames}。\n` +
          `請刪除其他工作表，或將需要匯入的工作表另存成單獨檔案後再試。`
        );
        return;
      }
      const all = [];
      const detectedOrderNumbers = []; // detectedOrderNumbers（各工作表辨識到的訂單號碼）
      wb.SheetNames.forEach(name => {
        const worksheet = wb.Sheets[name]; // worksheet（目前訂單工作表）
        const rows = XLSX.utils.sheet_to_json(worksheet, {header:1, defval:''});
        all.push(parseOrderRows(rows, name));
        const displayRows = XLSX.utils.sheet_to_json(worksheet, {header:1, defval:'', raw:false}); // displayRows（依 Excel 顯示文字讀取的資料列）
        detectedOrderNumbers.push(...findOrderNumbersInRows(displayRows));
      });
      state.orderLabel = buildDetectedOrderLabel(detectedOrderNumbers);
      state.orderItems = all.flatMap(result => result.items || []);
      state.orderErrors = all.flatMap(result => result.errors || []);
      state.orderCodeCount = all.reduce((sum, result) => sum + Number(result.codeCount || 0), 0);
      if(state.orderErrors.length){
        setOrderFileDisplay(`${file.name}（${fmtNum(state.orderErrors.length)} lỗi / ${fmtNum(state.orderErrors.length)} 筆錯誤）`);
      }
      recomputeResults();
    }catch(e){
      console.error(e);
      state.orderItems = [];
      state.orderCodeCount = 0;
      state.orderErrors = [createOrderError({
        sheetName:'-',
        reasonVi:'Không thể đọc nội dung tệp đơn hàng.',
        reasonZh:'無法讀取訂單檔案內容。',
        solutionVi:'Kiểm tra tệp có bị hỏng hay không, sau đó chọn lại tệp đơn hàng.',
        solutionZh:'請檢查檔案是否損壞，再重新選擇訂單檔案。'
      })];
      setOrderFileDisplay(`${file.name}（đọc thất bại / 讀取失敗）`);
      recomputeResults();
      alert('Đọc đơn hàng thất bại.\n讀取訂單失敗。\n\n' + e.message);
    }finally{
      input.value = '';
    }
  }

  function recomputeResults(){
    const map = buildTemplateMap();
    const grouped = new Map();
    const missing = [];
    state.orderItems.forEach(item => {
      const template = map.get(item.code);
      if(!template){
        missing.push({code:item.code, qty:item.qty, piecesPerItem:0, totalPieces:0, reverseQty:0, status:'missing'});
        return;
      }
      const key = `${template.templateId}|${template.code}`;
      if(!grouped.has(key)){
        grouped.set(key, {...template, qty:0, orderCodes: []});
      }
      const target = grouped.get(key);
      target.qty += Number(item.qty || 0);
      target.orderCodes.push(item.code);
    });
    const passed = Array.from(grouped.values()).map(template => {
      const pieces = Number(template.piecesPerItem || 0);
      const totalPieces = template.qty * pieces;
      const reverseQty = totalPieces / pieces;
      return {...template, qty:template.qty, totalPieces, reverseQty, status:'pass'};
    });
    state.results = [...state.orderErrors, ...passed, ...missing];
    renderResults();
  }

  function renderResults(){
    const total = state.orderCodeCount;
    const passed = state.results.filter(r => r.status === 'pass').length;
    const missing = state.results.filter(r => r.status === 'missing');
    const errors = state.results.filter(r => r.status === 'error');
    text('cut-total', fmtNum(total));
    text('cut-pass', fmtNum(passed));
    text('cut-missing', fmtNum(missing.length));
    text('cut-error', fmtNum(errors.length));
    const canPreview = passed > 0 && errors.length === 0;
    const previewBtn = g('cut-preview-btn');
    if(previewBtn){
      previewBtn.disabled = !canPreview;
      previewBtn.classList.toggle('is-ready', canPreview);
    }

    const alertBox = g('cut-alert');
    if(alertBox){
      if(errors.length){
        alertBox.className = 'nt nd';
        alertBox.innerHTML = `<i class="ti ti-alert-circle"></i><div><strong>Phát hiện ${fmtNum(errors.length)} lỗi trong đơn hàng.</strong><br><span class="tv">發現 ${fmtNum(errors.length)} 筆訂單錯誤。</span></div>`;
        alertBox.style.display = 'inline-flex';
      } else if(!total){
        alertBox.className = 'nt';
        alertBox.innerHTML = '';
        alertBox.style.display = 'none';
      } else if(missing.length){
        alertBox.className = 'nt nw';
        alertBox.innerHTML = `<i class="ti ti-alert-triangle"></i><div><strong>Thiếu mẫu cho ${fmtNum(missing.length)} mã hàng.</strong><br><span class="tv">${fmtNum(missing.length)} 個款號缺少模板。</span></div>`;
        alertBox.style.display = 'inline-flex';
      } else {
        alertBox.className = 'nt';
        alertBox.innerHTML = '';
        alertBox.style.display = 'none';
      }
    }

    const resultsEmpty = g('cut-results-empty'); // resultsEmpty（核對結果空狀態）
    if(resultsEmpty){
      const hasIssues = missing.length > 0 || errors.length > 0; // hasIssues（是否有需處理的核對問題）
      resultsEmpty.style.display = hasIssues ? 'none' : 'flex';
      resultsEmpty.classList.toggle('is-success',total > 0 && !hasIssues);
      if(!hasIssues){
        const icon = total > 0 ? 'ti-circle-check' : 'ti-file-search'; // icon（空狀態圖示）
        const vi = total > 0 ? 'Không có mã hàng thiếu mẫu hoặc lỗi.' : 'Chưa có kết quả kiểm tra.'; // vi（越文空狀態文字）
        const zh = total > 0 ? '沒有缺少模板或錯誤。' : '尚無核對結果。'; // zh（中文空狀態文字）
        resultsEmpty.innerHTML = `<i class="ti ${icon}" aria-hidden="true"></i><span class="cutting-results-empty-copy"><strong>${vi}</strong><span>${zh}</span></span>`;
      }
    }

    const missingBox = g('cut-missing-box');
    if(missingBox){
      if(missing.length){
        missingBox.style.display = 'block';
        html('cut-missing-list', missing.map(r => `
          <tr>
            <td><span class="tg tr2">Thiếu mẫu<br><span class="tv">缺少模板</span></span></td>
            <td><b>${esc(r.code)}</b></td>
            <td style="text-align:right">${fmtNum(r.qty)}</td>
            <td>Nhập mẫu có mã hàng này, sau đó chọn lại đơn hàng.<br><span class="tv">請先匯入包含此款號的模板，再重新選擇訂單。</span></td>
          </tr>
        `).join(''));
      } else {
        missingBox.style.display = 'none';
        html('cut-missing-list', '');
      }
    }

    const errorBox = g('cut-error-box'); // errorBox（裁帶錯誤區）
    if(errorBox){
      if(errors.length){
        errorBox.style.display = 'block';
        html('cut-error-list', errors.map(result => {
          const locationVi = result.locationVi || ''; // locationVi（越文位置文字）
          const locationZh = result.locationZh || ''; // locationZh（中文位置文字）
          const reasonVi = result.detailReasonVi || result.reasonVi || 'Dữ liệu đơn hàng không hợp lệ.'; // reasonVi（越文原因文字）
          const reasonZh = result.detailReasonZh || result.reasonZh || '訂單資料無效。'; // reasonZh（中文原因文字）
          return `
            <tr>
              <td><b>${esc(result.code || 'Trống / 空白')}</b></td>
              <td>
                <span class="cutting-error-location">
                  <span>${esc(locationVi)}</span>
                  <span class="cutting-error-location-zh">${esc(locationZh)}</span>
                </span>
                <span class="cutting-error-copy">
                  <span>${esc(reasonVi)}</span>
                  <span class="cutting-error-copy-zh">${esc(reasonZh)}</span>
                </span>
              </td>
              <td>
                <span class="cutting-error-copy">
                  <span>${esc(result.solutionVi || 'Kiểm tra và nhập lại đơn hàng.')}</span>
                  <span class="cutting-error-copy-zh">${esc(result.solutionZh || '請檢查並重新匯入訂單。')}</span>
                </span>
              </td>
            </tr>
          `;
        }).join(''));
      }else{
        errorBox.style.display = 'none';
        html('cut-error-list', '');
      }
    }
  }

  function buildPreviewHtml(){
    const exportableResults = state.results.filter(r => r.status === 'pass');
    const skippedMissing = state.results.filter(r => r.status === 'missing');
    const totalQty = exportableResults.reduce((sum, r) => sum + r.qty, 0);
    const totalPieces = exportableResults.reduce((sum, r) => sum + r.totalPieces, 0);
    const validations = exportableResults.map(result => ({result, problems: validateExportResult(result)}));
    const sharedProblems = validateSharedWriteTargets(exportableResults);
    const problemRows = [
      ...validations.flatMap(row => row.problems.map(problem => ({code: row.result.code, problem}))),
      ...sharedProblems.map(problem => ({code: '-', problem}))
    ];
    const passed = validations.filter(row => !row.problems.length).length;
    const failed = validations.length - passed + sharedProblems.length;
    const problemHtml = failed ? `
      <div class="to"><div class="ts" style="max-height:260px"><table>
        <thead><tr>
          <th>Mã hàng<br><span class="tv">款號</span></th>
          <th>Nội dung lỗi<br><span class="tv">錯誤內容</span></th>
        </tr></thead>
        <tbody>
          ${problemRows.map(row => `<tr><td><b>${esc(row.code)}</b></td><td>${esc(row.problem)}</td></tr>`).join('')}
        </tbody>
      </table></div></div>
    ` : '';
    return `
      <div class="mg">
        <div class="mc"><div class="ml">Mã hàng xuất</div><div class="mvi">匯出款號</div><div class="mv">${fmtNum(exportableResults.length)}</div></div>
        <div class="mc"><div class="ml">Tổng số đơn</div><div class="mvi">訂單總數</div><div class="mv">${fmtNum(totalQty)}</div></div>
        <div class="mc"><div class="ml">Tổng dây cắt</div><div class="mvi">裁段總數</div><div class="mv">${fmtNum(totalPieces)}</div></div>
        <div class="mc"><div class="ml">Thiếu mẫu</div><div class="mvi">缺少模板</div><div class="mv">${fmtNum(skippedMissing.length)}</div></div>
      </div>
      ${problemHtml}
    `;
  }

  function cuttingOpenPreview(){
    const openPreview = ()=>{
      if(isCuttingPdfToolStarting()){
        showCuttingPdfToolStartingDialog();
        return false;
      }
      const exportableResults = state.results.filter(r => r.status === 'pass');
      const hasErrors = state.results.some(r => r.status === 'error');
      if(!exportableResults.length || hasErrors){
        alert('Không có mã hàng có mẫu để xuất, hoặc vẫn còn lỗi.\n沒有可匯出的有模板款號，或仍有錯誤。');
        return false;
      }
      const problems = validateExportResults(exportableResults);
      const exportBtn = g('cut-export-filled-btn');
      if(exportBtn) exportBtn.disabled = problems.length > 0;
      html('cut-preview-body', buildPreviewHtml());
      restorePdfQualitySelection();
      om('m-cutting-preview');
      return true;
    }; // openPreview（開啟裁帶 PDF 匯出視窗）
    const ui = window.PCMSUIComponents; // ui（共用介面元件）
    if(typeof ui?.runActionOnce !== 'function') return openPreview();
    return ui.runActionOnce(PDF_EXPORT_OPEN_ACTION_KEY,openPreview,{
      controls:[g('cut-preview-btn')],
      cooldownMs:1000
    });
  }

  function templateQtyRows(template){
    const rows = [];
    (template?.codes || []).forEach(item => {
      (item.rows || []).forEach(rowInfo => {
        if(rowInfo.sheetName && rowInfo.qtyCell) rows.push({...rowInfo, templateCode: item.code});
      });
    });
    return rows;
  }

  function buildExportPlan(template, results){
    const cells = new Map();
    const addCellValue = (key, entry, value) => {
      const current = cells.get(key);
      if(current){
        current.value = Number(current.value || 0) + Number(value || 0);
      }else{
        cells.set(key, {...entry, value: Number(value || 0)});
      }
    };
    templateQtyRows(template).forEach(rowInfo => {
      cells.set(`${rowInfo.sheetName}!${rowInfo.qtyCell}`, {rowInfo, value: 0});
      if(rowInfo.totalCell) cells.set(`${rowInfo.sheetName}!${rowInfo.totalCell}`, {rowInfo, cell: rowInfo.totalCell, value: 0});
    });
    results.forEach(result => {
      const qtyTargets = new Set(); // qtyTargets（本款號已寫入的訂單數量位置）
      const totalContributions = new Set(); // totalContributions（本款號已計算的裁段來源）
      (result.rows || []).forEach(rowInfo => {
        const qtyKey = `${rowInfo.sheetName}!${rowInfo.qtyCell}`;
        if(!qtyTargets.has(qtyKey)){
          qtyTargets.add(qtyKey);
          addCellValue(qtyKey, {rowInfo}, result.qty);
        }
        if(rowInfo.totalCell){
          const totalKey = `${rowInfo.sheetName}!${rowInfo.totalCell}`;
          const pieceKey = `${rowInfo.sheetName}!${rowInfo.pieceCell || `R${rowInfo.rowNumber || 0}`}`;
          const contributionKey = `${totalKey}|${pieceKey}`;
          if(!totalContributions.has(contributionKey)){
            totalContributions.add(contributionKey);
            addCellValue(
              totalKey,
              {rowInfo, cell: rowInfo.totalCell},
              Number(result.qty || 0) * Number(rowInfo.piecesPerRow || 0)
            );
          }
        }
      });
    });
    return Array.from(cells.values());
  }

  function validateExportResult(result){
    const problems = [];
    const rows = result.rows || [];
    const uniquePieceRows = Array.from(new Map(rows.map(rowInfo => [
      `${rowInfo.sheetName}!${rowInfo.pieceCell || `R${rowInfo.rowNumber || 0}`}`,
      rowInfo
    ])).values()); // uniquePieceRows（去除合併重複後的每件條數資料列）
    const pieces = uniquePieceRows.reduce((sum, rowInfo) => sum + Number(rowInfo.piecesPerRow || 0), 0);
    const totalPieces = Number(result.qty || 0) * pieces;
    const reverseQty = pieces ? totalPieces / pieces : 0;
    if(!rows.length) problems.push('Không có vị trí điền / 沒有填寫位置');
    if(pieces <= 0) problems.push('Số dây/SP bằng 0 / 每件條數為 0');
    if(Math.abs(pieces - Number(result.piecesPerItem || 0)) > 0.0001) problems.push('Số dây/SP không khớp / 每件條數不一致');
    if(Math.abs(totalPieces - Number(result.totalPieces || 0)) > 0.0001) problems.push('Tổng dây không khớp / 裁段總數不一致');
    if(Math.abs(reverseQty - Number(result.qty || 0)) > 0.0001) problems.push('SL suy ngược không khớp / 反推數量不一致');
    return problems;
  }

  // validateSharedWriteTargets（檢查共用寫入位置）：不同款號或不同欄位不得共用同一個合併來源格。
  function validateSharedWriteTargets(results){
    const targets = new Map();
    const addTarget = (result, rowInfo, field, label) => {
      const cell = rowInfo?.[field];
      if(!rowInfo?.sheetName || !cell) return;
      // key（寫入位置識別）：必須包含模板編號，避免不同模板的相同工作表與儲存格被誤判為共用。
      const key = `${result.templateId || result.fileName || ''}|${rowInfo.sheetName}!${cell}`.toUpperCase();
      if(!targets.has(key)){
        targets.set(key, {
          sheetName: rowInfo.sheetName,
          cell,
          mergeRef: rowInfo[`${field.replace('Cell', '')}MergeRef`] || '',
          entries: new Map()
        });
      }
      const target = targets.get(key);
      const entryKey = `${label}|${result.code}`;
      if(!target.entries.has(entryKey)) target.entries.set(entryKey, {label, code: result.code});
    };
    (results || []).forEach(result => {
      (result.rows || []).forEach(rowInfo => {
        addTarget(result, rowInfo, 'qtyCell', 'SL:PO');
        addTarget(result, rowInfo, 'totalCell', 'SL:CẮT THỰC TẾ');
      });
    });
    const problems = [];
    targets.forEach(target => {
      const entries = Array.from(target.entries.values());
      const roles = new Set(entries.map(entry => entry.label));
      const codes = new Set(entries.map(entry => entry.code));
      if(roles.size <= 1 && codes.size <= 1) return;
      const location = `${target.sheetName}!${target.mergeRef || target.cell}`;
      const codeText = Array.from(codes).join(', ');
      problems.push(
        `Ô gộp ${location} được nhiều mã hàng hoặc cột dùng chung (${codeText}). Vui lòng tách ô trước khi xuất. / ` +
        `合併儲存格 ${location} 被多個款號或不同欄位共用（${codeText}），請拆開後再匯出。`
      );
    });
    return problems;
  }

  function validateExportResults(results){
    return [
      ...results.flatMap(result => validateExportResult(result).map(problem => `${result.code}: ${problem}`)),
      ...validateSharedWriteTargets(results)
    ];
  }

  function setPdfToolStatus(status){
    const box = g('cut-pdf-tool-status');
    if(!box) return;
    const map = {
      checking: {
        cls: 'nt nw',
        icon: 'ti-loader',
        vi: 'Đang kiểm tra công cụ PDF...',
        zh: '正在檢查 PDF 工具...'
      },
      requested: {
        cls: 'nt nw',
        icon: 'ti-send',
        vi: 'Đang khởi động công cụ PDF...',
        zh: '正在啟動 PDF 工具...'
      },
      online: {
        cls: 'nt ns',
        icon: 'ti-circle-check',
        vi: 'Đã mở công cụ PDF.',
        zh: 'PDF 工具已啟動。'
      },
      offline: {
        cls: 'nt nw',
        icon: 'ti-alert-circle',
        vi: 'Chưa mở công cụ PDF trên máy này.',
        zh: '本機尚未啟動 PDF 工具。'
      }
    };
    const item = map[status] || map.offline;
    box.className = item.cls;
    box.title = `${item.vi}\n${item.zh}`;
    box.innerHTML = `<i class="ti ${item.icon}"></i><div class="cutting-status-copy"><span class="cutting-status-vi">${item.vi}</span><span class="cutting-status-zh">${item.zh}</span></div>`;
  }

  // waitCuttingPdfToolDelay（等待本機 PDF 工具）：只供啟動後短暫輪詢使用。
  function waitCuttingPdfToolDelay(milliseconds){
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  // fetchCuttingPdfTool（呼叫本機 PDF 工具）：統一設定等待上限，避免本機服務異常時畫面永久等待。
  async function fetchCuttingPdfTool(path, options = {}, timeoutMs = 10000){
    const controller = new AbortController(); // controller（中止控制器）
    const timer = setTimeout(() => controller.abort(), timeoutMs); // timer（逾時計時器）
    try{
      return await fetch(`http://127.0.0.1:8765${path}`, {
        ...options,
        signal: controller.signal
      });
    }catch(error){
      if(error?.name === 'AbortError'){
        throw new Error('Công cụ PDF phản hồi quá lâu, thao tác đã dừng. / PDF 工具回應逾時，本次操作已停止。');
      }
      throw error;
    }finally{
      clearTimeout(timer);
    }
  }

  async function cuttingCheckPdfToolStatus(options = {}){
    if(pdfToolStatusChecking){
      await waitCuttingPdfToolDelay(200);
      return pdfToolKnownOnline === true;
    }
    pdfToolStatusChecking = true;
    if(!options.silent) setPdfToolStatus('checking');
    try{
      const response = await fetchCuttingPdfTool('/health', {
        method: 'GET',
        cache: 'no-store'
      }, Math.max(1,Math.min(1800,Number(options.timeoutMs) || 1800)));
      let health = null; // health（本機工具健康狀態）
      if(response.ok){
        try{ health = await response.json(); }catch(_){}
      }
      const ready = !!(response.ok && health?.ok === true && health?.service === 'cutting-pdf-local'); // ready（是否為正確的裁帶 PDF 工具）
      pdfToolKnownOnline = ready;
      if(ready){
        setPdfToolStatus('online');
      }else if(!options.silent){
        setPdfToolStatus('offline');
      }
      return ready;
    }catch(_){
      pdfToolKnownOnline = false;
      if(!options.silent){
        setPdfToolStatus('offline');
      }
      return false;
    }finally{
      pdfToolStatusChecking = false;
    }
  }

  // invokeCuttingLauncher（呼叫本機啟動器）：只使用程式內固定的啟動或取消連結。
  function invokeCuttingLauncher(uri){
    const launcherFrame = document.createElement('iframe'); // launcherFrame（啟動連結隱藏框架）
    launcherFrame.style.display = 'none';
    launcherFrame.setAttribute('aria-hidden', 'true');
    launcherFrame.src = uri;
    document.body.appendChild(launcherFrame);
    setTimeout(() => launcherFrame.remove(), 2500);
  }

  // waitForCuttingPdfTool（等待本機 PDF 工具就緒）：啟動後最多等待十秒，不讓使用者先選擇無法使用的儲存位置。
  async function waitForCuttingPdfTool(maxWaitMs = PDF_TOOL_START_TIMEOUT_MS){
    const deadline = Date.now() + maxWaitMs; // deadline（等待截止時間）
    while(Date.now() < deadline){
      await waitCuttingPdfToolDelay(Math.min(700,Math.max(0,deadline - Date.now())));
      const remainingMs = deadline - Date.now(); // remainingMs（本次健康檢查可用時間）
      if(remainingMs <= 0) break;
      if(await cuttingCheckPdfToolStatus({silent:true,timeoutMs:remainingMs})) return true;
    }
    pdfToolKnownOnline = false;
    setPdfToolStatus('offline');
    return false;
  }

  // showCuttingPdfToolStartingDialog（顯示 PDF 工具啟動說明）：重複操作只顯示狀態，不再呼叫本機啟動器。
  function showCuttingPdfToolStartingDialog(){
    const ui = window.PCMSUIComponents; // ui（共用介面元件）
    if(typeof ui?.openDialog === 'function'){
      ui.openDialog({
        title:{vi:'Công cụ PDF đang khởi động',zh:'PDF 工具正在啟動'},
        body:{vi:'Vui lòng chờ trong giây lát rồi thử lại.',zh:'請稍候片刻後再試。'},
        actions:[{text:'common.close'}],
        closeOnContent:true
      });
      return;
    }
    alert('Công cụ PDF đang khởi động. Vui lòng chờ.\nPDF 工具正在啟動，請稍候。');
  }

  // isCuttingPdfToolStarting（檢查 PDF 工具是否正在啟動）：啟動與匯出入口共用同一個狀態。
  function isCuttingPdfToolStarting(){
    return window.PCMSUIComponents?.isActionRunning?.(PDF_TOOL_START_ACTION_KEY) === true;
  }

  // startCuttingPdfToolOnce（只啟動一次 PDF 工具）：按鈕鎖定一秒，背景啟動狀態最多保留十秒。
  function startCuttingPdfToolOnce(){
    const startTask = async ()=>{
      const deadline = Date.now() + PDF_TOOL_START_TIMEOUT_MS; // deadline（PDF 工具啟動截止時間）
      if(await cuttingCheckPdfToolStatus({silent:true})) return true;
      pdfToolKnownOnline = false;
      setPdfToolStatus('requested');
      invokeCuttingLauncher('cuttingpdf://start');
      const remainingMs = Math.max(0,deadline - Date.now()); // remainingMs（啟動檢查剩餘時間）
      if(!remainingMs){
        setPdfToolStatus('offline');
        return false;
      }
      return waitForCuttingPdfTool(remainingMs);
    }; // startTask（PDF 工具啟動工作）
    const ui = window.PCMSUIComponents; // ui（共用介面元件）
    if(typeof ui?.runActionOnce !== 'function') return startTask();
    return ui.runActionOnce(PDF_TOOL_START_ACTION_KEY,startTask,{
      controls:[g('cut-start-pdf-tool-btn')],
      cooldownMs:1000,
      onDuplicate:showCuttingPdfToolStartingDialog
    });
  }

  // ensureCuttingPdfToolReady（確保本機 PDF 工具就緒）：啟動中不開啟儲存流程，也不等待後自動繼續匯出。
  async function ensureCuttingPdfToolReady(){
    if(pdfToolKnownOnline === true) return true;
    if(isCuttingPdfToolStarting()){
      showCuttingPdfToolStartingDialog();
      return null;
    }
    return startCuttingPdfToolOnce();
  }

  // cuttingStartPdfTool（啟動 PDF 工具）：相同工作執行中時只顯示說明，不重複送出啟動要求。
  async function cuttingStartPdfTool(){
    return startCuttingPdfToolOnce();
  }

  // cuttingUnregisterPdfTool（取消啟動路徑）：確認後只要求本機啟動器移除目前使用者的路徑登記。
  function cuttingUnregisterPdfTool(){
    if(!confirm('Hủy đường dẫn khởi động PDF hiện tại?\n取消目前的 PDF 工具啟動路徑？')) return;
    const buttons = Array.from(document.querySelectorAll('[data-cutting-action-key="unregister"]')); // buttons（取消路徑按鈕）
    if(buttons.some(button => button.disabled)) return;
    buttons.forEach(button => { button.disabled = true; });
    pdfToolKnownOnline = false;
    setPdfToolStatus('checking');
    invokeCuttingLauncher('cuttingpdf://unregister');
    setTimeout(() => {
      buttons.forEach(button => { button.disabled = false; });
      setPdfToolStatus('offline');
    }, 2000);
  }

  function orderExportableResultsByTemplate(results){
    const map = new Map();
    results.forEach(result => {
      const key = `${result.templateId}|${result.code}`;
      map.set(key, result);
    });
    const ordered = [];
    state.templates.forEach(template => {
      (template.codes || []).forEach(item => {
        const found = map.get(`${template.id}|${item.code}`);
        if(found) ordered.push(found);
      });
    });
    results.forEach(result => {
      if(!ordered.includes(result)) ordered.push(result);
    });
    return ordered;
  }

  let cuttingPdfProgressTimer = null;

  function setCuttingPdfProgress(percent, message, subText = ''){
    const wrap = g('cut-pdf-progress');
    const bar = g('cut-pdf-progress-bar');
    const label = g('cut-pdf-progress-text');
    const sub = g('cut-pdf-progress-sub');
    const closeBtn = g('cut-pdf-progress-close');
    if(wrap) wrap.style.display = 'block';
    if(closeBtn) closeBtn.style.display = 'flex';
    if(bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if(label) label.innerHTML = message;
    if(sub) sub.innerHTML = subText || 'Vui lòng chờ, không đóng cửa sổ này. / 請稍候，不要關閉此視窗。';
  }

  function setCuttingPdfError(message, subText){
    const closeBtn = g('cut-pdf-progress-close');
    setCuttingPdfProgress(
      100,
      message,
      subText
    );
    if(closeBtn) closeBtn.style.display = 'flex';
  }

  function openCuttingPdfProgress(){
    om('m-cutting-pdf-progress');
  }

  function hideCuttingPdfProgress(delay = 0){
    const run = () => {
      const wrap = g('cut-pdf-progress');
      if(wrap) wrap.style.display = 'none';
      const closeBtn = g('cut-pdf-progress-close');
      if(closeBtn) closeBtn.style.display = 'none';
      const bar = g('cut-pdf-progress-bar');
      if(bar) bar.style.width = '0%';
      cm('m-cutting-pdf-progress');
    };
    if(delay) setTimeout(run, delay);
    else run();
  }

  function cuttingClosePdfProgress(){
    hideCuttingPdfProgress();
  }

  function startCuttingPdfProgressLoop(){
    clearInterval(cuttingPdfProgressTimer);
    const startedAt = Date.now();
    let visualPercent = 35;
    cuttingPdfProgressTimer = setInterval(() => {
      const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      visualPercent = Math.min(92, visualPercent + (visualPercent < 70 ? 4 : 1));
      const remainingSeconds = Math.max(5, Math.round(seconds * (96 - visualPercent) / Math.max(1, visualPercent - 35)));
      setCuttingPdfProgress(
        visualPercent,
        'Đang tạo PDF trên máy này... / 本機正在產生 PDF...',
        `Đã xử lý khoảng ${seconds} giây. Ước tính còn khoảng ${remainingSeconds} giây. Lần đầu tạo cache sẽ lâu hơn.<br>已處理約 ${seconds} 秒，預估剩餘約 ${remainingSeconds} 秒，第一次建立快取會比較久。`
      );
    }, 1200);
  }

  function stopCuttingPdfProgressLoop(){
    clearInterval(cuttingPdfProgressTimer);
    cuttingPdfProgressTimer = null;
  }

  function localPdfName(fileName){
    const base = String(fileName || 'cutting.xlsx').replace(/\.(xlsx|xlsm|xls)$/i, '');
    const stamp = new Date().toLocaleDateString('zh-TW').replace(/\//g, '-');
    return `${base}_PDF_${stamp}.pdf`;
  }

  function localMergedPdfName(){
    const stamp = new Date().toLocaleDateString('zh-TW').replace(/\//g, '-');
    return `cutting_multi_PDF_${stamp}.pdf`;
  }

  function arrayBufferToBase64(buffer){
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for(let i = 0; i < bytes.length; i += chunk){
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function buildLocalPdfWrites(template, results){
    return buildExportPlan(template, results).map(item => ({
      sheetName: item.rowInfo.sheetName,
      cell: item.cell || item.rowInfo.qtyCell,
      value: Number(item.value || 0)
    }));
  }

  function buildLocalPdfReport(exportableResults, allResults){
    const missingResults = allResults.filter(result => result.status === 'missing');
    const completed = exportableResults.map(result => ({
      code: result.code || '',
      qty: Number(result.qty || 0),
      piece: Number(result.piecesPerItem || 0),
      total: Number(result.totalPieces || 0)
    }));
    const missing = missingResults.map(result => ({
      code: result.code || '',
      qty: Number(result.qty || 0),
      piece: '',
      total: ''
    }));
    return {
      completed,
      missing,
      completedCount: completed.length,
      missingCount: missing.length
    };
  }

  async function getCuttingPdfCacheStatus(templates){
    const response = await fetchCuttingPdfTool('/cutting/cache/status', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({templates})
    }, 10000);
    if(!response.ok) return new Set();
    const data = await response.json();
    return new Set(Array.isArray(data.cachedTemplateIds) ? data.cachedTemplateIds : []);
  }

  async function cuttingCreateLocalPdf(){
    const exportableResults = orderExportableResultsByTemplate(state.results.filter(r => r.status === 'pass'));
    const hasErrors = state.results.some(r => r.status === 'error');
    if(!exportableResults.length || hasErrors){
      alert('Không có mã hàng có mẫu để tạo PDF, hoặc vẫn còn lỗi.\n沒有可產生 PDF 的有模板款號，或仍有錯誤。');
      return;
    }
    const resultProblems = validateExportResults(exportableResults);
    if(resultProblems.length){
      alert('Kiểm tra số lượng không đạt, không thể tạo PDF.\n數量驗算未通過，不能產生 PDF。\n\n' + resultProblems.slice(0, 8).join('\n'));
      return;
    }
    const toolReadyBeforeSave = await ensureCuttingPdfToolReady(); // toolReadyBeforeSave（選擇儲存位置前的工具狀態）
    if(toolReadyBeforeSave === null) return;
    if(!toolReadyBeforeSave){
      alert('Không thể khởi động công cụ PDF. Vui lòng thử lại.\n無法啟動 PDF 工具，請再試一次。');
      return;
    }
    const confirmedOrderLabel = await openCuttingOrderLabelDialog(state.orderLabel); // confirmedOrderLabel（使用者確認的 PDF 左上角內容）
    if(confirmedOrderLabel === null) return;
    const byTemplate = new Map();
    exportableResults.forEach(result => {
      if(!byTemplate.has(result.templateId)) byTemplate.set(result.templateId, []);
      byTemplate.get(result.templateId).push(result);
    });
    const templateEntries = Array.from(byTemplate.entries()); // templateEntries（依模板整理的輸出資料）
    const firstTemplateId = templateEntries[0]?.[0] || ''; // firstTemplateId（第一個模板識別碼）
    const firstTemplateResults = templateEntries[0]?.[1] || []; // firstTemplateResults（第一個模板的輸出資料）
    const firstTemplate = state.templates.find(item => item.id === firstTemplateId); // firstTemplate（第一個模板）
    const suggestedOutputName = templateEntries.length === 1
      ? localPdfName(firstTemplate?.fileName || firstTemplateResults[0]?.fileName || '')
      : localMergedPdfName(); // suggestedOutputName（建議輸出檔名）
    const saveHandle = await chooseCuttingSaveHandle(suggestedOutputName, {
      description: 'Tệp PDF / PDF 檔案',
      accept: {'application/pdf': ['.pdf']}
    }); // saveHandle（使用者選擇的儲存位置）
    if(!saveHandle) return;
    const pdfToolReady = await cuttingCheckPdfToolStatus();
    if(!pdfToolReady){
      alert('Chưa mở công cụ PDF trên máy này.\n本機尚未啟動 PDF 工具。');
      return;
    }
    const exportBtn = g('cut-export-filled-btn');
    try{
      if(exportBtn) exportBtn.disabled = true;
      openCuttingPdfProgress();
      setCuttingPdfProgress(8, 'Đang chuẩn bị dữ liệu... / 正在準備資料...', 'Hệ thống đang kiểm tra mẫu và đơn hàng. / 系統正在確認模板與訂單。');
      const cacheChecks = templateEntries.map(([templateId, results]) => {
        const template = state.templates.find(item => item.id === templateId);
        return {
          templateId,
          templateUpdatedAt: template?.updatedAt || '',
          templateFileSize: Number(template?.fileSize || 0),
          fileName: template?.fileName || results[0]?.fileName || ''
        };
      });
      const cachedTemplateIds = await getCuttingPdfCacheStatus(cacheChecks);
      const packages = [];
      for(let i = 0; i < templateEntries.length; i++){
        const [templateId, results] = templateEntries[i];
        const template = state.templates.find(item => item.id === templateId);
        const fileName = template?.fileName || results[0]?.fileName || '';
        if(!/\.xlsx$/i.test(fileName)){
          hideCuttingPdfProgress();
          if(exportBtn) exportBtn.disabled = false;
          alert(`Mẫu này không phải .xlsx: ${fileName}\n此模板不是 .xlsx：${fileName}\n\nVui lòng dùng Excel lưu mẫu thành .xlsx rồi nhập lại.\n請先用 Excel 將模板另存為 .xlsx 後重新匯入。`);
          return;
        }
        const packageData = {
          templateId,
          templateUpdatedAt: template?.updatedAt || '',
          templateFileSize: Number(template?.fileSize || 0),
          fileName,
          writes: buildLocalPdfWrites(template, results)
        };
        if(!cachedTemplateIds.has(templateId)){
          setCuttingPdfProgress(
            Math.min(28, 12 + i * 4),
            'Đang đọc file mẫu... / 正在讀取模板檔...',
            `Đang chuẩn bị mẫu ${i + 1}/${templateEntries.length}.<br>正在準備第 ${i + 1}/${templateEntries.length} 個模板。`
          );
          const sourceFile = await cuttingStore.getTemplateFile(templateId);
          if(!sourceFile) throw new Error(`Không tìm thấy file mẫu gốc: ${fileName}\n找不到原始模板檔：${fileName}`);
          const buffer = await sourceFile.arrayBuffer();
          packageData.templateFileSize = sourceFile.size || 0;
          packageData.templateBase64 = arrayBufferToBase64(buffer);
        }
        packages.push(packageData);
      }
      setCuttingPdfProgress(28, 'Đang đóng gói dữ liệu... / 正在整理資料...', 'Đang chuẩn bị số lượng cần điền và vị trí ô. / 正在準備填寫數量與儲存格位置。');
      const report = buildLocalPdfReport(exportableResults, state.results);
      const payload = packages.length === 1
        ? {...packages[0], outputName: localPdfName(packages[0].fileName)}
        : {outputName: localMergedPdfName(), templates: packages};
      payload.report = report;
      payload.orderLabel = confirmedOrderLabel; // orderLabel（PDF 左上角內容）：完全依照匯出前輸入框的確認值。
      payload.pdfQuality = getSelectedPdfQuality(); // pdfQuality（PDF 品質）：standard（標準）或 high（高品質）。
      setCuttingPdfProgress(35, 'Đang gửi sang máy này... / 正在傳送到本機後台...', 'Hệ thống sẽ tạo PDF theo thứ tự mẫu. / 系統會依模板順序產生 PDF。');
      startCuttingPdfProgressLoop();
      const response = await fetchCuttingPdfTool('/cutting/pdf', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      }, LOCAL_PDF_REQUEST_TIMEOUT_MS);
      stopCuttingPdfProgressLoop();
      if(!response.ok){
        let msg = '';
        try{
          const data = await response.json();
          const parts = [];
          if(data.stage) parts.push(`Giai đoạn / 階段：${data.stage}`);
          if(data.detail) parts.push(`Chi tiết / 細節：${data.detail}`);
          if(data.error) parts.push(`Lỗi / 錯誤：${data.error}`);
          msg = parts.join('\n') || response.statusText;
        }catch(_){
          msg = response.statusText;
        }
        throw new Error(msg || 'Lỗi máy tạo PDF / 本機 PDF 後台錯誤');
      }
      setCuttingPdfProgress(96, 'Đang nhận file PDF... / 正在接收 PDF 檔...', 'PDF đã tạo xong, đang chuẩn bị lưu. / PDF 已產生，正在準備儲存。');
      const pdfBlob = await response.blob();
      await writeCuttingFileToHandle(saveHandle, pdfBlob);
      if(window.saveOperationLogToFB){
        try{
          const exportedResults=state.results.filter(result=>result.status==='pass');
          const savedLog = await saveOperationLogToFB({
            permissionKey:'cutting',
            feature:'cutting',
            action:'cuttingPdfExport',
            status:'success',
            itemCount:exportedResults.length,
            detailCount:exportedResults.reduce((sum,result)=>sum+(Number(result.totalPieces)||0),0),
            fileName:saveHandle.name||''
          });
          rememberCuttingHistoryLog(savedLog);
        }catch(logError){
          console.error('Không thể lưu operationLogs / 無法儲存操作紀錄：',logError);
          alert('Đã lưu PDF, nhưng không thể lưu lịch sử thao tác.\nPDF 已儲存，但操作紀錄無法保存。');
        }
      }
      setCuttingPdfProgress(100, 'Hoàn tất PDF. / PDF 完成。', 'Tệp đã được lưu vào vị trí đã chọn. / 檔案已儲存到選擇的位置。');
      hideCuttingPdfProgress(1600);
    }catch(e){
      stopCuttingPdfProgressLoop();
      console.error(e);
      const message = String(e && e.message ? e.message : '');
      const isLocalToolClosed = /Failed to fetch|NetworkError|Load failed/i.test(message);
      if(isLocalToolClosed){
        pdfToolKnownOnline = false;
        setCuttingPdfError(
          'Chưa mở công cụ chuyển PDF trên máy này.<br>Bản PDF chưa được tạo.',
          '本機尚未啟動 PDF 轉檔工具。<br>PDF 尚未產生。'
        );
      }else{
        setCuttingPdfError(
          'Tạo PDF thất bại.<br>產生 PDF 失敗。',
          `Vui lòng chụp thông báo lỗi để kiểm tra.<br>請截圖錯誤訊息方便排查。<br><br><pre style="white-space:pre-wrap;margin:0">${esc(message)}</pre>`
        );
      }
    }finally{
      if(exportBtn) exportBtn.disabled = false;
    }
  }

  async function cuttingInit(){
    registerCuttingFileDropTargets();
    await refreshTemplates();
    setTemplateBusy(false);
    setTemplateFileDisplay('');
    setOrderFileDisplay('');
    cuttingSwitchTab('order');
    cuttingCheckPdfToolStatus();
  }

  window.cuttingPickTemplate = cuttingPickTemplate;
  window.cuttingImportDragOver = cuttingImportDragOver;
  window.cuttingImportDragLeave = cuttingImportDragLeave;
  window.cuttingTemplateDrop = cuttingTemplateDrop;
  window.cuttingHandleTemplateFile = cuttingHandleTemplateFile;
  window.cuttingSwitchTab = cuttingSwitchTab;
  window.cuttingRefreshHistory = cuttingRefreshHistory;
  window.cuttingConfirmTemplate = cuttingConfirmTemplate;
  window.cuttingClearTemplateCurrent = cuttingClearTemplateCurrent;
  window.cuttingDeleteTemplate = cuttingDeleteTemplate;
  window.cuttingDownloadTemplate = cuttingDownloadTemplate;
  window.cuttingPickOrder = cuttingPickOrder;
  window.cuttingOrderDragOver = cuttingOrderDragOver;
  window.cuttingOrderDragLeave = cuttingOrderDragLeave;
  window.cuttingOrderDrop = cuttingOrderDrop;
  window.cuttingHandleOrderFile = cuttingHandleOrderFile;
  window.cuttingClearCurrent = cuttingClearCurrent;
  window.cuttingOpenPreview = cuttingOpenPreview;
  window.cuttingCreateLocalPdf = cuttingCreateLocalPdf;
  window.cuttingStartPdfTool = cuttingStartPdfTool;
  window.cuttingUnregisterPdfTool = cuttingUnregisterPdfTool;
  window.cuttingCheckPdfToolStatus = cuttingCheckPdfToolStatus;
  window.cuttingConfirmOrderLabel = cuttingConfirmOrderLabel;
  window.cuttingCancelOrderLabel = cuttingCancelOrderLabel;
  window.cuttingClosePdfProgress = cuttingClosePdfProgress;
  window.PCMSCuttingOrderValidation = Object.freeze({
    parseRows:parseOrderRows,
    parseQuantity:parseOrderQuantity
  }); // PCMSCuttingOrderValidation（裁帶訂單檢查介面）：提供相同正式規則給自動測試驗收。
  window.cuttingInit = cuttingInit;
})();
