// cutting（裁帶統計）：獨立功能；模板輸出策略是保留原始 Excel（表格檔）副本，只填數量欄。
(function(){
  const state = {
    templates: [],
    orderItems: [],
    results: [],
    pendingTemplateFile: null,
    pendingBook: null
  };
  const FIXED_TEMPLATE_COLUMNS = Object.freeze({
    imageCol: 0,
    codeCol: 1,
    colorCol: 2,
    beltCol: 3,
    segmentCol: 4,
    cutSpecCol: 5,
    qtyCol: 6,
    pieceCol: 7,
    totalCol: 8,
    shortageCol: 9,
    noteCol: 10
  });
  let pdfToolStatusChecking = false;

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

  function normalizeText(value){
    return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
  }

  function normalizeHeader(value){
    return normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9\u4E00-\u9FFF]/g, '');
  }

  function normalizeCode(value){
    return normalizeText(value).replace(/[^\w~-]/g, '');
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
    const code = normalizeCode(value);
    return /^[A-Z0-9][A-Z0-9-]{2,}$/.test(code);
  }

  function codeAliases(value){
    const code = normalizeCode(value);
    return code ? [code] : [];
  }

  function isFixedTemplateHeader(row){
    const code = normalizeHeader(row?.[FIXED_TEMPLATE_COLUMNS.codeCol]);
    const qty = normalizeHeader(row?.[FIXED_TEMPLATE_COLUMNS.qtyCol]);
    const piece = normalizeHeader(row?.[FIXED_TEMPLATE_COLUMNS.pieceCol]);
    const total = normalizeHeader(row?.[FIXED_TEMPLATE_COLUMNS.totalCol]);
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
      schemaVersion: 'fixed-2026-07',
      sheetCount: workbook.SheetNames.length,
      itemCount: 0,
      rowCount: 0,
      warningCount: 0,
      sheets: [],
      codes: []
    };
    const codeMap = new Map();

    workbook.SheetNames.forEach(sheetName => {
      const ws = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
      const sheetInfo = {name: sheetName, detectedBlocks: 0, rowCount: 0, warningCount: 0, detections: []};
      rows.forEach((row, headerIndex) => {
        if(!isFixedTemplateHeader(row)) return;
        const dataIndex = headerIndex + 1;
        const dataRow = rows[dataIndex] || [];
        const rawCode = dataRow[FIXED_TEMPLATE_COLUMNS.codeCol];
        if(!isItemCode(rawCode)){
          sheetInfo.warningCount += 1;
          book.warningCount += 1;
          return;
        }
        const code = normalizeCode(rawCode);
        const pieces = parseNumber(dataRow[FIXED_TEMPLATE_COLUMNS.pieceCol]);
        const rowInfo = {
          sheetName,
          headerRowNumber: headerIndex + 1,
          rowNumber: dataIndex + 1,
          code,
          qtyCell: addr(dataIndex, FIXED_TEMPLATE_COLUMNS.qtyCol),
          pieceCell: addr(dataIndex, FIXED_TEMPLATE_COLUMNS.pieceCol),
          totalCell: addr(dataIndex, FIXED_TEMPLATE_COLUMNS.totalCol),
          piecesPerRow: pieces,
          detectMethod: 'fixed-new-spec',
          detectConfidence: 100
        };
        sheetInfo.detectedBlocks += 1;
        sheetInfo.rowCount += 1;
        book.rowCount += 1;
        sheetInfo.detections.push({
          rowNumber: headerIndex + 1,
          method: 'fixed-new-spec',
          confidence: 100,
          codeCol: FIXED_TEMPLATE_COLUMNS.codeCol,
          qtyCol: FIXED_TEMPLATE_COLUMNS.qtyCol,
          pieceCol: FIXED_TEMPLATE_COLUMNS.pieceCol,
          totalCol: FIXED_TEMPLATE_COLUMNS.totalCol
        });
        if(pieces <= 0){
          sheetInfo.warningCount += 1;
          book.warningCount += 1;
          rowInfo.warning = 'Số kiện trống hoặc bằng 0 / 每件條數空白或為 0';
        }
        if(!codeMap.has(code)){
          codeMap.set(code, {
            code,
            aliases: codeAliases(code),
            piecesPerItem: 0,
            rows: [],
            templateFileName: fileName
          });
        }
        const item = codeMap.get(code);
        item.rows.push(rowInfo);
        item.piecesPerItem += pieces;
      });
      if(!sheetInfo.detectedBlocks){
        sheetInfo.warningCount += 1;
        book.warningCount += 1;
      }
      book.sheets.push(sheetInfo);
    });

    book.codes = Array.from(codeMap.values()).sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric:true}));
    book.itemCount = book.codes.length;
    return book;
  }

  function buildTemplateMap(){
    const map = new Map();
    state.templates.forEach(book => {
      if(book.status !== 'confirmed' || book.schemaVersion !== 'fixed-2026-07') return;
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
    ['cut-template-file', 'cut-template-confirm-btn', 'cut-template-clear-btn'].forEach(id => {
      const el = g(id);
      if(el) el.disabled = !!busy;
    });
    const drop = g('cut-template-drop');
    if(drop) drop.style.pointerEvents = busy ? 'none' : '';
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
      if(template.schemaVersion !== 'fixed-2026-07') return;
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
        <td>${t.schemaVersion !== 'fixed-2026-07'
          ? '<span class="tg ta">Mẫu cũ đã ngừng / 舊格式已停用</span>'
          : (t.status === 'confirmed'
            ? (t.warningCount ? `<span class="tg ta">Đã xác nhận, ${fmtNum(t.warningCount)} cảnh báo / 已確認，${fmtNum(t.warningCount)} 警告</span>` : '<span class="tg tg2">Đã xác nhận / 已確認</span>')
            : '<span class="tg ta">Chưa xác nhận / 尚未確認</span>')}</td>
        <td style="text-align:center"><button class="btn bsm bd2" onclick="cuttingDeleteTemplate('${esc(t.id)}')"><i class="ti ti-trash"></i>Xóa / 刪除</button></td>
      </tr>
    `).join('');
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
        <div class="mc"><div class="ml">Cảnh báo</div><div class="mvi">警告</div><div class="mv">${fmtNum(book.warningCount)}</div></div>
      </div>
      <div class="nt ${book.warningCount ? 'nw' : 'ns'}" style="margin-bottom:12px">
        <i class="ti ${book.warningCount ? 'ti-alert-triangle' : 'ti-circle-check'}"></i>
        <div>${book.warningCount
          ? 'Một số sheet không đúng mẫu cố định A-K. / 部分工作表不符合 A-K 固定新規格。'
          : 'Đã xác nhận cấu trúc cố định A-K. / 已確認 A-K 固定新規格。'}</div>
      </div>
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
        alert('Cấu trúc mẫu không đúng quy cách mới, không thể lưu.\n模板結構不符合新規格，無法儲存。');
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
    if(!window.XLSX){ alert('Không thể đọc Excel, vui lòng tải lại trang.\n無法讀取 Excel，請重新整理頁面。'); return; }
    if(!isXlsxTemplateFile(file)){
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
        await setTemplateProgress(100, 'Mẫu không đúng quy cách mới. / 模板不符合新規格。', 'Vui lòng kiểm tra cột A–K trên mọi phân trang. / 請檢查每個分頁的 A–K 欄位。');
        renderTemplateAnalysis(book);
        alert('Mẫu không đúng quy cách mới. Vui lòng kiểm tra cột A–K trên mọi phân trang.\n模板不符合新規格，請檢查每個分頁的 A–K 欄位。');
        hideTemplateProgress(800);
        return;
      }
      book.status = 'pending';
      state.pendingTemplateFile = file;
      state.pendingBook = book;
      await setTemplateProgress(100, 'Phân tích mẫu hoàn tất. / 模板分析完成。', 'Cấu trúc cố định đã hợp lệ. / 固定格式已通過檢查。');
      renderTemplateAnalysis(book);
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
    state.results = [];
    state.pendingTemplateFile = null;
    state.pendingBook = null;
    text('cut-template-file-name', '');
    text('cut-order-file-name', '');
    renderTemplateAnalysis(null);
    renderResults();
  }

  function cuttingClearTemplateCurrent(){
    state.pendingTemplateFile = null;
    state.pendingBook = null;
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
        if(isItemCode(cell)) codeScores.set(c, (codeScores.get(c) || 0) + 1);
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
      if(!isItemCode(row[codeIdx])) continue;
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

  async function cuttingHandleOrderFile(input){
    const file = input && input.files ? input.files[0] : null;
    if(!file) return;
    if(!window.XLSX){ alert('Không thể đọc Excel, vui lòng tải lại trang.\n無法讀取 Excel（表格檔），請重新整理頁面。'); return; }
    text('cut-order-file-name', file.name);
    try{
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, {type:'array'});
      const all = [];
      wb.SheetNames.forEach(name => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, defval:''});
        all.push(...parseOrderRows(rows));
      });
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
    const problemRows = validations.flatMap(row => row.problems.map(problem => ({code: row.result.code, problem})));
    const passed = validations.filter(row => !row.problems.length).length;
    const failed = validations.length - passed;
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
      (result.rows || []).forEach(rowInfo => {
        addCellValue(`${rowInfo.sheetName}!${rowInfo.qtyCell}`, {rowInfo}, result.qty);
        if(rowInfo.totalCell){
          addCellValue(
            `${rowInfo.sheetName}!${rowInfo.totalCell}`,
            {rowInfo, cell: rowInfo.totalCell},
            Number(result.qty || 0) * Number(rowInfo.piecesPerRow || 0)
          );
        }
      });
    });
    return Array.from(cells.values());
  }

  function validateExportResult(result){
    const problems = [];
    const rows = result.rows || [];
    const pieces = rows.reduce((sum, rowInfo) => sum + Number(rowInfo.piecesPerRow || 0), 0);
    const totalPieces = Number(result.qty || 0) * pieces;
    const reverseQty = pieces ? totalPieces / pieces : 0;
    if(!rows.length) problems.push('Không có vị trí điền / 沒有填寫位置');
    if(pieces <= 0) problems.push('Số dây/SP bằng 0 / 每件條數為 0');
    if(Math.abs(pieces - Number(result.piecesPerItem || 0)) > 0.0001) problems.push('Số dây/SP không khớp / 每件條數不一致');
    if(Math.abs(totalPieces - Number(result.totalPieces || 0)) > 0.0001) problems.push('Tổng dây không khớp / 裁段總數不一致');
    if(Math.abs(reverseQty - Number(result.qty || 0)) > 0.0001) problems.push('SL suy ngược không khớp / 反推數量不一致');
    return problems;
  }

  function validateExportResults(results){
    return results.flatMap(result => validateExportResult(result).map(problem => `${result.code}: ${problem}`));
  }

  function setPdfToolStatus(status, detail = ''){
    const box = g('cut-pdf-tool-status');
    if(!box) return;
    const setupText = [
      '1. Lần đầu thiết lập: Vào 「OneDrive\\1MAY9」, nhấp chuột phải vào thư mục 「Cong cu chuyen doi PDF」, rồi chọn 「Luôn giữ trên thiết bị này」.',
      '2. Sử dụng hằng ngày: Vào 「OneDrive\\1MAY9\\Cong cu chuyen doi PDF」, nhấp đúp file 「Mở công cụ PDF」 để mở công cụ.',
      '1. 第一次設定：到「OneDrive\\1MAY9」，對「Cong cu chuyen doi PDF」資料夾按右鍵，選擇「永遠保留在此裝置」。',
      '2. 平常使用：到「OneDrive\\1MAY9\\Cong cu chuyen doi PDF」，雙擊「Mở công cụ PDF」檔案啟動工具。'
    ];
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
        text: setupText.join('<br>')
      }
    };
    const item = map[status] || map.offline;
    if(status === 'offline') detail = '';
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
      if(response.ok){
        setPdfToolStatus('online');
      }else{
        setPdfToolStatus('offline', 'Vui lòng mở công cụ PDF trước khi tạo file. / 產生檔案前請先開啟 PDF 工具。');
      }
      return response.ok;
    }catch(_){
      setPdfToolStatus('offline', 'Vui lòng mở công cụ PDF trước khi tạo file. / 產生檔案前請先開啟 PDF 工具。');
      return false;
    }finally{
      if(timer) clearTimeout(timer);
      pdfToolStatusChecking = false;
    }
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

  function downloadBlob(blob, fileName){
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  function buildLocalPdfOrderCells(results){
    const cells = [];
    results.forEach(result => {
      (result.rows || []).forEach(rowInfo => {
        cells.push({
          sheetName: rowInfo.sheetName,
          cell: rowInfo.qtyCell
        });
      });
    });
    return cells;
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
    const pdfToolReady = await cuttingCheckPdfToolStatus();
    if(!pdfToolReady){
      alert('Chưa mở công cụ PDF trên máy này.\n本機尚未啟動 PDF 工具。');
      return;
    }
    const byTemplate = new Map();
    exportableResults.forEach(result => {
      if(!byTemplate.has(result.templateId)) byTemplate.set(result.templateId, []);
      byTemplate.get(result.templateId).push(result);
    });
    const exportBtn = g('cut-export-filled-btn');
    try{
      if(exportBtn) exportBtn.disabled = true;
      openCuttingPdfProgress();
      setCuttingPdfProgress(8, 'Đang chuẩn bị dữ liệu... / 正在準備資料...', 'Hệ thống đang kiểm tra mẫu và đơn hàng. / 系統正在確認模板與訂單。');
      const templateEntries = Array.from(byTemplate.entries());
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
          writes: buildLocalPdfWrites(template, results),
          orderCells: buildLocalPdfOrderCells(results)
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
      setCuttingPdfProgress(96, 'Đang nhận file PDF... / 正在接收 PDF 檔...', 'PDF đã tạo xong, đang chuẩn bị tải xuống. / PDF 已產生，正在準備下載。');
      const pdfBlob = await response.blob();
      setCuttingPdfProgress(100, 'Hoàn tất PDF. / PDF 完成。', 'File đã được tải xuống. / 檔案已下載。');
      downloadBlob(pdfBlob, payload.outputName);
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
    cuttingSwitchTab('order');
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
  window.cuttingPickOrder = cuttingPickOrder;
  window.cuttingOrderDragOver = cuttingOrderDragOver;
  window.cuttingOrderDragLeave = cuttingOrderDragLeave;
  window.cuttingOrderDrop = cuttingOrderDrop;
  window.cuttingHandleOrderFile = cuttingHandleOrderFile;
  window.cuttingClearCurrent = cuttingClearCurrent;
  window.cuttingOpenPreview = cuttingOpenPreview;
  window.cuttingCreateLocalPdf = cuttingCreateLocalPdf;
  window.cuttingClosePdfProgress = cuttingClosePdfProgress;
  window.cuttingInit = cuttingInit;

  window.addEventListener('DOMContentLoaded', cuttingInit);
})();
