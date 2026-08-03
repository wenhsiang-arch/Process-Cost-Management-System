// cutting（裁帶統計）：獨立功能；模板輸出策略是保留原始 Excel（表格檔）副本，只填數量欄。
(function(){
  const state = {
    templates: [],
    orderItems: [],
    orderLabel: '', // orderLabel（PDF 左上角內容）：自動辨識後可由使用者修改。
    results: [],
    pendingTemplateFile: null,
    pendingBook: null
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
  let pdfToolStatusChecking = false;
  let orderLabelDialogResolve = null; // orderLabelDialogResolve（訂單文字視窗回傳函式）

  function text(id, value){
    const el = g(id);
    if(el) el.textContent = value;
  }

  function html(id, value){
    const el = g(id);
    if(el) el.innerHTML = value;
  }

  function cuttingSwitchTab(tab){
    const isOrder = tab === 'order';
    const templatePanel = g('cut-panel-template');
    const orderPanel = g('cut-panel-order');
    const templateTab = g('cut-tab-template');
    const orderTab = g('cut-tab-order');
    if(templatePanel) templatePanel.style.display = isOrder ? 'none' : '';
    if(orderPanel) orderPanel.style.display = isOrder ? '' : 'none';
    if(templateTab) templateTab.classList.toggle('active', !isOrder);
    if(orderTab) orderTab.classList.toggle('active', isOrder);
  }

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }

  function fmtNum(value){
    const n = Number(value || 0);
    return Number.isFinite(n) ? n.toLocaleString('en-US') : '0';
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

  // isLikelyItemCode（推測款號格式）：只用於沒有表頭時推測訂單欄位，不限制已確認欄位內的正式款號。
  function isLikelyItemCode(value){
    const code = normalizeCode(value);
    return !!code && /[A-Z0-9]/.test(code);
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
    if(label) label.innerHTML = message || 'Đang xử lý... / 處理中...';
    if(sub) sub.innerHTML = subMessage || 'Vui lòng chờ, không đóng trang này. / 請稍候，不要關閉此頁面。';
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
    if(confirmButton) confirmButton.disabled = !!busy || !state.pendingTemplateFile || !state.pendingBook;
    const drop = g('cut-template-drop');
    if(drop) drop.style.pointerEvents = busy ? 'none' : '';
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
            <button class="btn cut-template-action cut-template-download" onclick="cuttingDownloadTemplate('${esc(t.id)}', this)">
              <i class="ti ti-file-download"></i>
              <span class="cut-template-action-text"><span class="cut-template-action-vi">Tải file gốc</span><span class="cut-template-action-zh">下載原始檔</span></span>
            </button>
            <button class="btn cut-template-action bd2" onclick="cuttingDeleteTemplate('${esc(t.id)}')">
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
    html('cut-template-analysis-body', `
      <div class="mg">
        <div class="mc"><div class="ml">Số sheet</div><div class="mvi">工作表</div><div class="mv">${fmtNum(book.sheetCount)}</div></div>
        <div class="mc"><div class="ml">Mã hàng</div><div class="mvi">款號</div><div class="mv">${fmtNum(book.itemCount)}</div></div>
        <div class="mc"><div class="ml">Dòng cần điền</div><div class="mvi">填寫列數</div><div class="mv">${fmtNum(book.rowCount)}</div></div>
        <div class="mc"><div class="ml">Lỗi</div><div class="mvi">錯誤</div><div class="mv">${fmtNum(book.warningCount)}</div></div>
        <div class="mc"><div class="ml">Cảnh báo</div><div class="mvi">提醒</div><div class="mv">${fmtNum(book.noticeCount)}</div></div>
      </div>
      <div class="nt ${book.warningCount || book.noticeCount ? 'nw' : 'ns'}" style="margin-bottom:12px">
        <i class="ti ${book.warningCount || book.noticeCount ? 'ti-alert-triangle' : 'ti-circle-check'}"></i>
        <div>${book.warningCount
          ? 'Một số sheet không đúng mẫu cố định A-K. / 部分工作表不符合 A-K 固定新規格。'
          : (book.noticeCount
            ? 'Có nhóm có số kiện khác nhau, nhưng vẫn có thể nhập mẫu. / 部分組別的每件條數不同，但仍可匯入模板。'
            : 'Đã xác nhận cấu trúc cố định A-K. / 已確認 A-K 固定新規格。')}</div>
      </div>
      ${book.warningCount ? `
        <div style="font-weight:700;color:var(--navy);margin:10px 0 8px">Chi tiết cần sửa / 需要修改的位置</div>
        ${templateIssuesHtml(book, 50)}
      ` : ''}
      ${book.noticeCount ? `
        <div style="font-weight:700;color:var(--navy);margin:10px 0 8px">Cảnh báo số kiện / 每件條數提醒</div>
        ${templateNoticesHtml(book, 50)}
      ` : ''}
      <div style="font-weight:700;color:var(--navy);margin:10px 0 8px">Vị trí điền số lượng theo mã hàng / 款號數量填寫位置</div>
      <div class="to"><div class="ts" style="max-height:240px"><table>
        <thead><tr>
          <th>Mã hàng<br><span class="tv">款號</span></th>
          <th style="text-align:right">Số dây/SP<br><span class="tv">每件條數</span></th>
          <th style="text-align:right">Số dòng<br><span class="tv">列數</span></th>
          <th>Vị trí điền SL<br><span class="tv">數量填寫位置</span></th>
        </tr></thead>
        <tbody>
          ${book.codes.slice(0, 80).map(item => `<tr>
            <td><b>${esc(item.code)}</b></td>
            <td style="text-align:right">${fmtNum(item.piecesPerItem)}</td>
            <td style="text-align:right">${fmtNum(item.rows.length)}</td>
            <td>${esc(item.rows.slice(0, 6).map(r => `${r.sheetName}!${r.qtyCell}`).join(', '))}${item.rows.length > 6 ? '...' : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div></div>
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
          ? `<br>Ước tính còn khoảng ${remainingSeconds} giây. / 預估剩餘約 ${remainingSeconds} 秒。`
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
      text('cut-template-file-name', '');
      renderTemplateAnalysis(null);
      await refreshTemplates();
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
    if(!window.XLSX){
      setTemplateBusy(false);
      alert('Không thể đọc Excel, vui lòng tải lại trang.\n無法讀取 Excel，請重新整理頁面。');
      return;
    }
    if(!isXlsxTemplateFile(file)){
      setTemplateBusy(false);
      alertTemplateFileTypeError(file.name);
      return;
    }
    text('cut-template-file-name', file.name);
    setTemplateBusy(true);
    try{
      await setTemplateProgress(8, 'Đang đọc file mẫu... / 正在讀取模板檔案...', esc(file.name));
      const data = await file.arrayBuffer();
      await setTemplateProgress(30, 'Đang mở Excel... / 正在開啟 Excel...', 'Hệ thống đang đọc nội dung bảng tính. / 系統正在讀取活頁簿內容。');
      const wb = XLSX.read(data, {type:'array', cellFormula:false, cellStyles:false});
      await setTemplateProgress(58, 'Đang kiểm tra cột A–K và mã hàng... / 正在檢查 A–K 欄位與款號...', 'Mỗi phân trang được đọc tiêu đề riêng. / 每個分頁都會獨立讀取抬頭。');
      const book = analyzeTemplateWorkbook(file.name, wb);
      if(!book.itemCount || book.warningCount){
        const firstIssue = Array.isArray(book.issues) && book.issues.length ? book.issues[0] : null; // firstIssue（第一筆模板錯誤）
        const issueLocation = firstIssue
          ? `Trang tính ${esc(firstIssue.sheetName || '-')} · Ô ${esc(firstIssue.cell || '-')} / 工作表 ${esc(firstIssue.sheetName || '-')} · 儲存格 ${esc(firstIssue.cell || '-')}`
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
    const response = await fetch('http://127.0.0.1:8765/cutting/cache', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
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
      if(cacheCleared){
        alert('Đã xóa mẫu và bộ nhớ đệm.\n已刪除模板與快取。');
      }else{
        alert('Đã xóa mẫu trên đám mây. Bộ nhớ đệm trên máy này chưa xóa, nhưng sẽ không chặn thao tác.\n已刪除雲端模板。本機快取尚未清除，但不會阻止操作。');
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
    const drop = g('cut-order-drop');
    if(drop) drop.classList.remove('dragging');
    const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
    if(file) cuttingHandleOrderFile({files:[file]});
  }

  function cuttingClearCurrent(){
    state.orderItems = [];
    state.orderLabel = '';
    state.results = [];
    clearPendingTemplate();
    text('cut-template-file-name', '');
    text('cut-order-file-name', '');
    setTemplateBusy(false);
    renderTemplateAnalysis(null);
    renderResults();
  }

  function cuttingClearTemplateCurrent(){
    clearPendingTemplate();
    const input = g('cut-template-file');
    if(input) input.value = '';
    text('cut-template-file-name', '');
    hideTemplateProgress();
    setTemplateBusy(false);
    renderTemplateAnalysis(null);
  }

  function findOrderHeader(rows){
    const codeWords = ['ITEMNO','ITEMNUMBER','ITEM','SKU','STYLE','MODEL','MAHANG','款號','货号'];
    const qtyWords = ['QTY','QUANTITY','ORDERQTY','PCS','SOLUONG','SL','數量','数量','訂單數量'];
    for(let r = 0; r < Math.min(rows.length, 35); r++){
      const cells = (rows[r] || []).map(v => normalizeHeader(v));
      let codeIdx = -1;
      let qtyIdx = -1;
      cells.forEach((v, i) => {
        if(codeIdx < 0 && codeWords.some(w => v.includes(w))) codeIdx = i;
        if(qtyIdx < 0 && qtyWords.some(w => v.includes(w))) qtyIdx = i;
      });
      if(codeIdx >= 0 && qtyIdx >= 0 && codeIdx !== qtyIdx) return {row: r, codeIdx, qtyIdx};
    }
    return null;
  }

  function inferOrderHeaderByShape(rows){
    const codeScores = new Map();
    for(let r = 0; r < Math.min(rows.length, 160); r++){
      (rows[r] || []).forEach((cell, c) => {
        if(isLikelyItemCode(cell)) codeScores.set(c, (codeScores.get(c) || 0) + 1);
      });
    }
    let codeIdx = -1, bestCodeScore = 0;
    codeScores.forEach((score, col) => {
      if(score > bestCodeScore){
        bestCodeScore = score;
        codeIdx = col;
      }
    });
    if(codeIdx < 0 || bestCodeScore < 2) return null;

    const qtyScores = new Map();
    for(let r = 0; r < Math.min(rows.length, 220); r++){
      const row = rows[r] || [];
      if(!isLikelyItemCode(row[codeIdx])) continue;
      row.forEach((cell, c) => {
        if(c === codeIdx) return;
        const qty = parseNumber(cell);
        if(qty <= 0) return;
        let score = qty >= 10 ? 3 : 1;
        if(c > codeIdx) score += 1;
        qtyScores.set(c, (qtyScores.get(c) || 0) + score);
      });
    }
    let qtyIdx = -1, bestQtyScore = 0;
    qtyScores.forEach((score, col) => {
      if(score > bestQtyScore){
        bestQtyScore = score;
        qtyIdx = col;
      }
    });
    return qtyIdx >= 0 ? {row:-1, codeIdx, qtyIdx, method:'shape'} : null;
  }

  function parseOrderRows(rows){
    let header = findOrderHeader(rows);
    const items = new Map();
    if(header){
      rows.slice(header.row + 1).forEach(row => {
        const code = normalizeCode(row[header.codeIdx]);
        const qty = parseNumber(row[header.qtyIdx]);
        if(!isItemCode(code) || qty <= 0) return;
        items.set(code, (items.get(code) || 0) + qty);
      });
    }
    if(!items.size){
      header = inferOrderHeaderByShape(rows);
      if(header){
        rows.forEach(row => {
          const code = normalizeCode(row[header.codeIdx]);
          const qty = parseNumber(row[header.qtyIdx]);
          if(!isItemCode(code) || qty <= 0) return;
          items.set(code, (items.get(code) || 0) + qty);
        });
      }
    }
    return Array.from(items.entries()).map(([code, qty]) => ({code, qty}));
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
    if(!window.XLSX){ alert('Không thể đọc Excel, vui lòng tải lại trang.\n無法讀取 Excel（表格檔），請重新整理頁面。'); return; }
    text('cut-order-file-name', file.name);
    state.orderLabel = '';
    try{
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, {type:'array'});
      const all = [];
      const detectedOrderNumbers = []; // detectedOrderNumbers（各工作表辨識到的訂單號碼）
      wb.SheetNames.forEach(name => {
        const worksheet = wb.Sheets[name]; // worksheet（目前訂單工作表）
        const rows = XLSX.utils.sheet_to_json(worksheet, {header:1, defval:''});
        all.push(...parseOrderRows(rows));
        const displayRows = XLSX.utils.sheet_to_json(worksheet, {header:1, defval:'', raw:false}); // displayRows（依 Excel 顯示文字讀取的資料列）
        detectedOrderNumbers.push(...findOrderNumbersInRows(displayRows));
      });
      state.orderLabel = buildDetectedOrderLabel(detectedOrderNumbers);
      const merged = new Map();
      all.forEach(item => merged.set(item.code, (merged.get(item.code) || 0) + item.qty));
      state.orderItems = Array.from(merged.entries()).map(([code, qty]) => ({code, qty}));
      if(!state.orderItems.length){
        text('cut-order-file-name', file.name + '（không đọc được mã hàng / 未讀到款號）');
        alert('Không đọc được mã hàng và số lượng trong đơn hàng.\n訂單內沒有讀到款號與數量。\n\n請確認訂單表裡有款號欄與數量欄。');
      }
      recomputeResults();
    }catch(e){
      console.error(e);
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
      if(pieces <= 0){
        return {...template, piecesPerItem:pieces, totalPieces:0, reverseQty:0, status:'error'};
      }
      const totalPieces = template.qty * pieces;
      const reverseQty = totalPieces / pieces;
      return {...template, qty:template.qty, totalPieces, reverseQty, status:'pass'};
    });
    state.results = [...passed, ...missing];
    renderResults();
  }

  function statusBadge(result){
    if(result.status === 'pass') return '<span class="tg tg2">Đạt / 通過</span>';
    if(result.status === 'missing') return '<span class="tg tr2">Thiếu mẫu / 缺少模板</span>';
    return '<span class="tg tr2">Lỗi / 錯誤</span>';
  }

  function renderResults(){
    const total = state.results.length;
    const passed = state.results.filter(r => r.status === 'pass').length;
    const missing = state.results.filter(r => r.status === 'missing');
    const errors = state.results.filter(r => r.status === 'error');
    text('cut-total', fmtNum(total));
    text('cut-pass', fmtNum(passed));
    text('cut-missing', fmtNum(missing.length));
    text('cut-error', fmtNum(errors.length));
    const canPreview = passed > 0 && errors.length === 0;
    const previewBtn = g('cut-preview-btn');
    if(previewBtn) previewBtn.disabled = !canPreview;

    const alertBox = g('cut-alert');
    if(alertBox){
      if(!state.templates.length){
        alertBox.className = 'nt nw';
        alertBox.innerHTML = '<i class="ti ti-info-circle"></i><div>Vui lòng nhập mẫu Excel trước. Hệ thống sẽ giữ nguyên file mẫu, chỉ phân tích vị trí cần điền số lượng.<br>請先匯入 Excel 模板。系統會保留原始模板檔，只分析要填數量的位置。</div>';
      } else if(!total){
        alertBox.className = 'nt nw';
        alertBox.innerHTML = '<i class="ti ti-info-circle"></i><div>Đã có mẫu, vui lòng nhập đơn hàng để kiểm tra.<br>已有模板，請匯入訂單進行比對。</div>';
      } else if(canPreview && missing.length){
        alertBox.className = 'nt nw';
        alertBox.innerHTML = `<i class="ti ti-alert-triangle"></i><div>Có thể xuất ${fmtNum(passed)} mã hàng có mẫu. ${fmtNum(missing.length)} mã hàng thiếu mẫu sẽ không vào PDF.<br>可匯出 ${fmtNum(passed)} 個有模板款號。${fmtNum(missing.length)} 個缺少模板款號不會進入 PDF。</div>`;
      } else if(canPreview){
        alertBox.className = 'nt ns';
        alertBox.innerHTML = `<i class="ti ti-check"></i><div>Kiểm tra đạt: ${fmtNum(total)} mã hàng đều có mẫu. Có thể xuất Excel thành phẩm từ mẫu gốc để giữ nguyên màu sắc và hình ảnh.<br>檢查通過：${fmtNum(total)} 個款號都有模板。可用原始 Excel 模板匯出成品，保留配色與圖片。</div>`;
      } else {
        alertBox.className = 'nt nd';
        alertBox.innerHTML = `<i class="ti ti-alert-triangle"></i><div>Không thể xuất: chưa có mã hàng có mẫu hoặc còn ${fmtNum(errors.length)} lỗi.<br>不可匯出：沒有可匯出的有模板款號，或仍有 ${fmtNum(errors.length)} 筆錯誤。</div>`;
      }
      alertBox.style.display = 'flex';
    }

    const missingBox = g('cut-missing-box');
    if(missingBox){
      if(missing.length){
        missingBox.style.display = 'block';
        html('cut-missing-list', missing.map(r => `
          <tr>
            <td><span class="tg tr2">Thiếu mẫu / 缺少模板</span></td>
            <td><b>${esc(r.code)}</b></td>
            <td style="text-align:right">${fmtNum(r.qty)}</td>
            <td>Không tìm thấy mã hàng này trong mẫu Excel đã nhập.<br>已匯入的 Excel 模板中找不到此款號。</td>
          </tr>
        `).join(''));
      } else {
        missingBox.style.display = 'none';
        html('cut-missing-list', '');
      }
    }

    const tb = g('cut-result-tb');
    if(!tb) return;
    if(!state.results.length){
      tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--mu);padding:22px">Chưa có dữ liệu / 尚無資料</td></tr>';
      return;
    }
    tb.innerHTML = state.results.map(r => `
      <tr>
        <td><b>${esc(r.code)}</b>${r.fileName ? `<div style="font-size:10px;color:var(--mu);margin-top:2px">${esc(r.fileName)}</div>` : ''}</td>
        <td style="text-align:right">${fmtNum(r.qty)}</td>
        <td style="text-align:right">${r.piecesPerItem ? fmtNum(r.piecesPerItem) : '-'}</td>
        <td style="text-align:right">${r.totalPieces ? fmtNum(r.totalPieces) : '-'}</td>
        <td style="text-align:right">${r.reverseQty ? fmtNum(r.reverseQty) : '-'}</td>
        <td>${r.rows ? esc(r.rows.slice(0, 4).map(x => `${x.sheetName}!${x.qtyCell}`).join(', ')) : '-'}</td>
        <td>${statusBadge(r)}</td>
      </tr>
    `).join('');
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
    const exportableResults = state.results.filter(r => r.status === 'pass');
    const hasErrors = state.results.some(r => r.status === 'error');
    if(!exportableResults.length || hasErrors){
      alert('Không có mã hàng có mẫu để xuất, hoặc vẫn còn lỗi.\n沒有可匯出的有模板款號，或仍有錯誤。');
      return;
    }
    const problems = validateExportResults(exportableResults);
    const exportBtn = g('cut-export-filled-btn');
    if(exportBtn) exportBtn.disabled = problems.length > 0;
    html('cut-preview-body', buildPreviewHtml());
    restorePdfQualitySelection();
    om('m-cutting-preview');
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

  function setPdfToolStatus(status, detail = ''){
    const box = g('cut-pdf-tool-status');
    if(!box) return;
    const map = {
      checking: {
        cls: 'nt nw',
        icon: 'ti-loader',
        text: 'Đang kiểm tra công cụ PDF... / 正在檢查 PDF 工具...'
      },
      online: {
        cls: 'nt ns',
        icon: 'ti-circle-check',
        text: 'Đã mở công cụ PDF / PDF 工具已啟動'
      },
      offline: {
        cls: 'nt nw',
        icon: 'ti-alert-circle',
        text: 'Chưa mở công cụ PDF trên máy này. / 本機尚未啟動 PDF 工具。'
      }
    };
    const item = map[status] || map.offline;
    box.className = item.cls;
    box.innerHTML = `<i class="ti ${item.icon}"></i><div>${item.text}${detail ? `<br><span style="font-size:11px;color:var(--mu)">${detail}</span>` : ''}</div>`;
  }

  async function cuttingCheckPdfToolStatus(options = {}){
    if(pdfToolStatusChecking) return false;
    pdfToolStatusChecking = true;
    if(!options.silent) setPdfToolStatus('checking');
    let timer = null;
    try{
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 1800);
      const response = await fetch('http://127.0.0.1:8765/health', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timer);
      let health = null; // health（本機工具健康狀態）
      if(response.ok){
        try{ health = await response.json(); }catch(_){}
      }
      const ready = !!(response.ok && health?.ok === true && health?.service === 'cutting-pdf-local'); // ready（是否為正確的裁帶 PDF 工具）
      if(ready){
        setPdfToolStatus('online');
      }else if(!options.silent){
        setPdfToolStatus('offline', 'Vui lòng mở công cụ PDF trước khi tạo file. / 產生檔案前請先開啟 PDF 工具。');
      }
      return ready;
    }catch(_){
      if(!options.silent){
        setPdfToolStatus('offline', 'Vui lòng mở công cụ PDF trước khi tạo file. / 產生檔案前請先開啟 PDF 工具。');
      }
      return false;
    }finally{
      if(timer) clearTimeout(timer);
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

  // cuttingStartPdfTool（啟動 PDF 工具）：由使用者點擊直接呼叫本機登記連結，再輪詢健康狀態。
  async function cuttingStartPdfTool(){
    const button = g('cut-start-pdf-tool-btn'); // button（啟動按鈕）
    if(button?.disabled) return;
    if(button) button.disabled = true;
    setPdfToolStatus('checking', 'Đang gửi yêu cầu khởi động... / 正在送出啟動要求...');
    invokeCuttingLauncher('cuttingpdf://start');

    let ready = false; // ready（工具是否啟動成功）
    try{
      for(let attempt = 0; attempt < 20; attempt++){
        await new Promise(resolve => setTimeout(resolve, 600));
        if(await cuttingCheckPdfToolStatus({silent:true})){
          ready = true;
          break;
        }
      }
      if(!ready){
        setPdfToolStatus(
          'offline',
          'Nếu đây là lần đầu sử dụng trên máy này, hãy nhấp đúp 「Khởi động công cụ PDF - 啟動PDF工具.bat」 trong thư mục OneDrive trước. / 若此電腦第一次使用，請先到 OneDrive 資料夾雙擊「Khởi động công cụ PDF - 啟動PDF工具.bat」。'
        );
      }
    }finally{
      if(button) button.disabled = false;
    }
  }

  // cuttingUnregisterPdfTool（取消啟動路徑）：確認後只要求本機啟動器移除目前使用者的路徑登記。
  function cuttingUnregisterPdfTool(){
    if(!confirm('Hủy đường dẫn khởi động PDF hiện tại?\n取消目前的 PDF 工具啟動路徑？')) return;
    const button = g('cut-unregister-pdf-tool-btn'); // button（取消路徑按鈕）
    if(button?.disabled) return;
    if(button) button.disabled = true;
    setPdfToolStatus('checking', 'Đang gửi yêu cầu hủy đường dẫn... / 正在送出取消路徑要求...');
    invokeCuttingLauncher('cuttingpdf://unregister');
    setTimeout(() => {
      if(button) button.disabled = false;
      setPdfToolStatus(
        'offline',
        'Đã gửi yêu cầu hủy. Nếu không xuất hiện cửa sổ xác nhận, đường dẫn có thể chưa được đăng ký. / 已送出取消要求；若沒有出現確認視窗，目前可能尚未登記路徑。'
      );
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
    const response = await fetch('http://127.0.0.1:8765/cutting/cache/status', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({templates})
    });
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
      const response = await fetch('http://127.0.0.1:8765/cutting/pdf', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
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
      setCuttingPdfProgress(100, 'Hoàn tất PDF. / PDF 完成。', 'Tệp đã được lưu vào vị trí đã chọn. / 檔案已儲存到選擇的位置。');
      hideCuttingPdfProgress(1600);
    }catch(e){
      stopCuttingPdfProgressLoop();
      console.error(e);
      const message = String(e && e.message ? e.message : '');
      const isLocalToolClosed = /Failed to fetch|NetworkError|Load failed/i.test(message);
      if(isLocalToolClosed){
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
    await refreshTemplates();
    setTemplateBusy(false);
    cuttingSwitchTab('order');
    cuttingCheckPdfToolStatus();
  }

  window.cuttingPickTemplate = cuttingPickTemplate;
  window.cuttingImportDragOver = cuttingImportDragOver;
  window.cuttingImportDragLeave = cuttingImportDragLeave;
  window.cuttingTemplateDrop = cuttingTemplateDrop;
  window.cuttingHandleTemplateFile = cuttingHandleTemplateFile;
  window.cuttingSwitchTab = cuttingSwitchTab;
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
  window.cuttingInit = cuttingInit;

  window.addEventListener('DOMContentLoaded', cuttingInit);
})();
