// cutting（裁帶統計）：獨立功能；模板輸出策略是保留原始 Excel（表格檔）副本，只填數量欄。
(function(){
  const state = {
    templates: [],
    orderItems: [],
    results: [],
    selectedTemplateId: '',
    pendingTemplateFile: null,
    pendingWorkbook: null,
    pendingBook: null
  };

  function text(id, value){
    const el = g(id);
    if(el) el.textContent = value;
  }

  function html(id, value){
    const el = g(id);
    if(el) el.innerHTML = value;
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
    return normalizeText(value).replace(/[^\w-]/g, '');
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

  function isLikelyCode(value){
    const code = normalizeCode(value);
    return /^[A-Z]{1,6}\d{2,}[-A-Z0-9]*$/.test(code);
  }

  function colLettersToIndex(letters){
    let n = 0;
    String(letters || '').toUpperCase().split('').forEach(ch => {
      n = n * 26 + (ch.charCodeAt(0) - 64);
    });
    return n - 1;
  }

  function formulaRefs(formula){
    const refs = [];
    String(formula || '').replace(/\$?([A-Z]{1,3})\$?(\d+)/g, (_, col, row) => {
      refs.push({col: colLettersToIndex(col), row: Number(row) - 1});
      return _;
    });
    return refs;
  }

  function colOptions(selected){
    const cols = [];
    for(let i = 0; i < 32; i++){
      const label = XLSX.utils.encode_col(i);
      cols.push(`<option value="${i}" ${i === selected ? 'selected' : ''}>${label}</option>`);
    }
    return `<option value="-1">-</option>${cols.join('')}`;
  }

  function findTemplateHeader(row){
    const found = {codeCol:-1, qtyCol:-1, pieceCol:-1, totalCol:-1, confidence:0, method:'header'};
    row.forEach((cell, idx) => {
      const h = normalizeHeader(cell);
      if(found.codeCol < 0 && (h.includes('MAHANG') || h.includes('ITEM') || h.includes('款號'))) found.codeCol = idx;
      if(found.qtyCol < 0 && ((h.includes('SL') && h.includes('PO')) || h.includes('PCS') || h.includes('訂單數量'))) found.qtyCol = idx;
      if(found.pieceCol < 0 && (h.includes('SOKIEN') || h.includes('SOBO') || h.includes('每件條數') || h.includes('條數'))) found.pieceCol = idx;
      if(found.totalCol < 0 && (h.includes('THUCTE') || h.includes('SLCAT') || h.includes('裁段總數'))) found.totalCol = idx;
    });
    found.confidence = ['codeCol','qtyCol','pieceCol'].filter(k => found[k] >= 0).length;
    return found.confidence >= 2 ? found : null;
  }

  function inferHeaderFromRows(rows, ws, startRow, currentHeader){
    const scores = new Map();
    const add = (col, key, score) => {
      if(col < 0 || col > 80) return;
      const row = scores.get(col) || {code:0, qty:0, piece:0, total:0};
      row[key] += score;
      scores.set(col, row);
    };

    if(currentHeader){
      if(currentHeader.codeCol >= 0) add(currentHeader.codeCol, 'code', 12);
      if(currentHeader.qtyCol >= 0) add(currentHeader.qtyCol, 'qty', 12);
      if(currentHeader.pieceCol >= 0) add(currentHeader.pieceCol, 'piece', 12);
      if(currentHeader.totalCol >= 0) add(currentHeader.totalCol, 'total', 8);
    }

    for(let r = startRow; r < Math.min(rows.length, startRow + 80); r++){
      const row = rows[r] || [];
      row.forEach((cell, c) => {
        const value = parseNumber(cell);
        if(isLikelyCode(cell)) add(c, 'code', 3);
        if(value > 0 && value <= 20 && Number.isInteger(value)) add(c, 'piece', 2);
        if(value > 20) add(c, 'qty', 1);
      });
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
      for(let c = range.s.c; c <= Math.min(range.e.c, 80); c++){
        const cell = ws[addr(r, c)];
        if(!cell || typeof cell.f !== 'string') continue;
        const refs = formulaRefs(cell.f);
        if(refs.length >= 2){
          add(c, 'total', 5);
          refs.forEach(ref => {
            if(ref.row === r){
              add(ref.col, 'qty', 2);
              add(ref.col, 'piece', 2);
            }
          });
        }
      }
    }

    const pick = (key, exclude=[]) => {
      let best = -1, bestScore = 0;
      scores.forEach((score, col) => {
        if(exclude.includes(col)) return;
        if(score[key] > bestScore){
          bestScore = score[key];
          best = col;
        }
      });
      return {col: best, score: bestScore};
    };

    const code = pick('code');
    const total = pick('total', [code.col]);
    const qty = pick('qty', [code.col, total.col]);
    const piece = pick('piece', [code.col, total.col, qty.col]);
    let confidence = 0;
    if(code.col >= 0) confidence += Math.min(code.score, 10);
    if(qty.col >= 0) confidence += Math.min(qty.score, 10);
    if(piece.col >= 0) confidence += Math.min(piece.score, 10);
    if(total.col >= 0) confidence += Math.min(total.score, 6);
    return {
      codeCol: code.col,
      qtyCol: qty.col,
      pieceCol: piece.col,
      totalCol: total.col,
      confidence,
      method: currentHeader ? 'header+formula+shape' : 'formula+shape'
    };
  }

  function analyzeTemplateWorkbook(fileName, workbook){
    const book = {
      fileName,
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
      let header = null;

      rows.forEach((row, rIdx) => {
        const maybeHeader = findTemplateHeader(row);
        if(maybeHeader){
          header = inferHeaderFromRows(rows, ws, rIdx + 1, maybeHeader);
          sheetInfo.detectedBlocks += 1;
          sheetInfo.detections.push({
            rowNumber: rIdx + 1,
            method: header.method,
            confidence: header.confidence,
            codeCol: header.codeCol,
            qtyCol: header.qtyCol,
            pieceCol: header.pieceCol,
            totalCol: header.totalCol
          });
          if(header.confidence < 16){
            sheetInfo.warningCount += 1;
            book.warningCount += 1;
          }
          return;
        }
        if(!header && rIdx === 0){
          header = inferHeaderFromRows(rows, ws, 0, null);
          if(header.confidence < 14) header = null;
        }
        if(!header || header.codeCol < 0 || header.qtyCol < 0 || header.pieceCol < 0) return;
        const rawCode = row[header.codeCol];
        if(!isLikelyCode(rawCode)) return;
        const code = normalizeCode(rawCode);
        const pieces = parseNumber(row[header.pieceCol]);
        const qtyCell = addr(rIdx, header.qtyCol);
        const pieceCell = addr(rIdx, header.pieceCol);
        const totalCell = header.totalCol >= 0 ? addr(rIdx, header.totalCol) : '';
        const rowInfo = {
          sheetName,
          rowNumber: rIdx + 1,
          code,
          qtyCell,
          pieceCell,
          totalCell,
          piecesPerRow: pieces,
          detectMethod: header.method,
          detectConfidence: header.confidence
        };
        sheetInfo.rowCount += 1;
        book.rowCount += 1;
        if(pieces <= 0){
          sheetInfo.warningCount += 1;
          book.warningCount += 1;
          rowInfo.warning = 'Số kiện trống hoặc bằng 0 / 每件條數空白或為 0';
        }
        if(!codeMap.has(code)){
          codeMap.set(code, {
            code,
            piecesPerItem: 0,
            rows: [],
            templateFileName: fileName
          });
        }
        const item = codeMap.get(code);
        item.rows.push(rowInfo);
        item.piecesPerItem += pieces;
      });
      book.sheets.push(sheetInfo);
    });

    book.codes = Array.from(codeMap.values()).sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric:true}));
    book.itemCount = book.codes.length;
    book.rules = book.sheets.map(sheet => {
      const best = (sheet.detections || []).slice().sort((a, b) => b.confidence - a.confidence)[0];
      return best ? {
        sheetName: sheet.name,
        method: best.method,
        confidence: best.confidence,
        codeCol: best.codeCol,
        qtyCol: best.qtyCol,
        pieceCol: best.pieceCol,
        totalCol: best.totalCol
      } : {
        sheetName: sheet.name,
        method: 'not-detected',
        confidence: 0,
        codeCol: -1,
        qtyCol: -1,
        pieceCol: -1,
        totalCol: -1
      };
    });
    return book;
  }

  function buildTemplateBookFromRules(fileName, workbook, rules){
    const book = {
      fileName,
      sheetCount: workbook.SheetNames.length,
      itemCount: 0,
      rowCount: 0,
      warningCount: 0,
      status: 'pending',
      sheets: [],
      codes: [],
      rules: rules.map(r => ({...r}))
    };
    const ruleMap = new Map(book.rules.map(r => [r.sheetName, r]));
    const codeMap = new Map();

    workbook.SheetNames.forEach(sheetName => {
      const ws = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
      const rule = ruleMap.get(sheetName);
      const sheetInfo = {
        name: sheetName,
        detectedBlocks: rule && rule.codeCol >= 0 ? 1 : 0,
        rowCount: 0,
        warningCount: 0,
        detections: rule ? [{...rule, method: 'confirmed-rule'}] : []
      };

      if(!rule || rule.codeCol < 0 || rule.qtyCol < 0 || rule.pieceCol < 0){
        sheetInfo.warningCount += 1;
        book.warningCount += 1;
        book.sheets.push(sheetInfo);
        return;
      }

      rows.forEach((row, rIdx) => {
        const rawCode = row[rule.codeCol];
        if(!isLikelyCode(rawCode)) return;
        const code = normalizeCode(rawCode);
        const pieces = parseNumber(row[rule.pieceCol]);
        const rowInfo = {
          sheetName,
          rowNumber: rIdx + 1,
          code,
          qtyCell: addr(rIdx, rule.qtyCol),
          pieceCell: addr(rIdx, rule.pieceCol),
          totalCell: rule.totalCol >= 0 ? addr(rIdx, rule.totalCol) : '',
          piecesPerRow: pieces,
          detectMethod: 'confirmed-rule',
          detectConfidence: rule.confidence
        };
        sheetInfo.rowCount += 1;
        book.rowCount += 1;
        if(pieces <= 0){
          sheetInfo.warningCount += 1;
          book.warningCount += 1;
          rowInfo.warning = 'Số kiện trống hoặc bằng 0 / 每件條數空白或為 0';
        }
        if(!codeMap.has(code)){
          codeMap.set(code, {code, piecesPerItem: 0, rows: [], templateFileName: fileName});
        }
        const item = codeMap.get(code);
        item.rows.push(rowInfo);
        item.piecesPerItem += pieces;
      });
      book.sheets.push(sheetInfo);
    });

    book.codes = Array.from(codeMap.values()).sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric:true}));
    book.itemCount = book.codes.length;
    return book;
  }

  function buildTemplateMap(){
    const map = new Map();
    state.templates.forEach(book => {
      if(book.status !== 'confirmed') return;
      (book.codes || []).forEach(item => {
        if(!map.has(item.code)){
          map.set(item.code, {...item, templateId: book.id, fileName: book.fileName});
        }
      });
    });
    return map;
  }

  async function refreshTemplates(){
    state.templates = window.cuttingStore ? await window.cuttingStore.listTemplates() : [];
    renderTemplateList();
    recomputeResults();
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
        <td>${t.status === 'confirmed' ? (t.warningCount ? `<span class="tg ta">Đã xác nhận, ${fmtNum(t.warningCount)} cảnh báo / 已確認，${fmtNum(t.warningCount)} 警告</span>` : '<span class="tg tg2">Đã xác nhận / 已確認</span>') : '<span class="tg ta">Chưa xác nhận / 尚未確認</span>'}</td>
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
    const isPending = state.pendingBook && state.pendingBook === book;
    html('cut-template-analysis-body', `
      <div class="mg">
        <div class="mc"><div class="ml">Số sheet</div><div class="mvi">工作表</div><div class="mv">${fmtNum(book.sheetCount)}</div></div>
        <div class="mc"><div class="ml">Mã hàng</div><div class="mvi">款號</div><div class="mv">${fmtNum(book.itemCount)}</div></div>
        <div class="mc"><div class="ml">Dòng cần điền</div><div class="mvi">可填數量列</div><div class="mv">${fmtNum(book.rowCount)}</div></div>
        <div class="mc"><div class="ml">Cảnh báo</div><div class="mvi">警告</div><div class="mv">${fmtNum(book.warningCount)}</div></div>
      </div>
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
      <div class="dv"></div>
      <div class="to"><div class="ts" style="max-height:180px"><table>
        <thead><tr>
          <th>Sheet<br><span class="tv">工作表</span></th>
          <th>Phương pháp<br><span class="tv">判斷方式</span></th>
          <th style="text-align:right">Tin cậy<br><span class="tv">信心分數</span></th>
          <th>Cột mã hàng<br><span class="tv">款號欄</span></th>
          <th>Cột SL:PO<br><span class="tv">訂單數量欄</span></th>
          <th>Cột số kiện<br><span class="tv">每件條數欄</span></th>
          <th>Cột thực tế<br><span class="tv">裁段總數欄</span></th>
        </tr></thead>
        <tbody>
          ${(book.rules || []).map((d, i) => `<tr>
            <td>${esc(d.sheetName)}</td>
            <td>${esc(d.method)}</td>
            <td style="text-align:right">${fmtNum(d.confidence)}</td>
            <td><select data-cut-rule="${i}" data-cut-field="codeCol" style="padding:5px 8px;border:1px solid var(--bd);border-radius:7px">${colOptions(d.codeCol)}</select></td>
            <td><select data-cut-rule="${i}" data-cut-field="qtyCol" style="padding:5px 8px;border:1px solid var(--bd);border-radius:7px">${colOptions(d.qtyCol)}</select></td>
            <td><select data-cut-rule="${i}" data-cut-field="pieceCol" style="padding:5px 8px;border:1px solid var(--bd);border-radius:7px">${colOptions(d.pieceCol)}</select></td>
            <td><select data-cut-rule="${i}" data-cut-field="totalCol" style="padding:5px 8px;border:1px solid var(--bd);border-radius:7px">${colOptions(d.totalCol)}</select></td>
          </tr>`).join('')}
        </tbody>
      </table></div></div>
      ${isPending ? `<div class="nt nw" style="margin-bottom:12px"><i class="ti ti-alert-triangle"></i><div>Hệ thống chỉ đưa ra đề xuất. Vui lòng kiểm tra cột rồi xác nhận mẫu trước khi sử dụng.<br>系統目前只是建議判斷，請檢查欄位後確認模板，才可正式使用。</div></div>
      <div class="br">
        <button class="btn" onclick="cuttingApplyTemplateRules()"><i class="ti ti-refresh"></i>Áp dụng chỉnh sửa / 套用修正</button>
        <button class="btn bp" onclick="cuttingConfirmTemplate()"><i class="ti ti-check"></i>Xác nhận mẫu / 確認模板</button>
      </div>` : ''}
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

  function readTemplateRulesFromUi(){
    const base = state.pendingBook?.rules || [];
    return base.map((rule, i) => {
      const next = {...rule};
      document.querySelectorAll(`[data-cut-rule="${i}"]`).forEach(sel => {
        next[sel.dataset.cutField] = Number(sel.value);
      });
      next.method = 'manual-confirm';
      next.confidence = Math.max(next.confidence || 0, 100);
      return next;
    });
  }

  function cuttingApplyTemplateRules(){
    if(!state.pendingWorkbook || !state.pendingBook){
      alert('Chưa có mẫu cần chỉnh sửa.\n目前沒有可修正的模板。');
      return;
    }
    const rules = readTemplateRulesFromUi();
    state.pendingBook = buildTemplateBookFromRules(state.pendingBook.fileName, state.pendingWorkbook, rules);
    renderTemplateAnalysis(state.pendingBook);
  }

  async function cuttingConfirmTemplate(){
    if(!state.pendingTemplateFile || !state.pendingWorkbook || !state.pendingBook){
      alert('Chưa có mẫu cần xác nhận.\n目前沒有可確認的模板。');
      return;
    }
    cuttingApplyTemplateRules();
    const book = {...state.pendingBook, status:'confirmed', confirmedAt:new Date().toISOString()};
    if(!book.itemCount){
      alert('Không có mã hàng sau khi áp dụng quy tắc, không thể lưu mẫu.\n套用規則後沒有款號，不能保存模板。');
      return;
    }
    await window.cuttingStore.saveTemplateBook(book, state.pendingTemplateFile);
    state.pendingTemplateFile = null;
    state.pendingWorkbook = null;
    state.pendingBook = null;
    text('cut-template-file-name', '');
    renderTemplateAnalysis(book);
    await refreshTemplates();
    alert('Đã xác nhận và lưu mẫu.\n已確認並保存模板。');
  }

  async function cuttingHandleTemplateFile(input){
    const file = input && input.files ? input.files[0] : null;
    if(!file) return;
    await cuttingAnalyzeTemplateFile(file);
    input.value = '';
  }

  async function cuttingAnalyzeTemplateFile(file){
    if(!window.XLSX){ alert('Không thể đọc Excel, vui lòng tải lại trang.\n無法讀取 Excel（表格檔），請重新整理頁面。'); return; }
    if(!/\.(xlsx|xls)$/i.test(file.name)){
      alert('Chỉ hỗ trợ Excel .xlsx hoặc .xls.\n只支援 Excel（表格檔）.xlsx 或 .xls。');
      return;
    }
    text('cut-template-file-name', file.name);
    try{
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, {type:'array', cellFormula:true, cellStyles:true});
      const book = analyzeTemplateWorkbook(file.name, wb);
      if(!book.itemCount){
        renderTemplateAnalysis(book);
        alert('Không tìm thấy mã hàng trong mẫu. Vui lòng kiểm tra cột Mã hàng / SL:PO / Số kiện.\n模板內找不到款號，請檢查 Mã hàng、SL:PO、Số kiện 欄位。');
        return;
      }
      book.status = 'pending';
      state.pendingTemplateFile = file;
      state.pendingWorkbook = wb;
      state.pendingBook = book;
      renderTemplateAnalysis(book);
    }catch(e){
      console.error(e);
      alert('Phân tích mẫu Excel thất bại.\n分析 Excel（表格檔）模板失敗。\n\n' + e.message);
    }
  }

  async function cuttingDeleteTemplate(id){
    if(!confirm('Xóa mẫu này?\n確定刪除此模板？')) return;
    await window.cuttingStore.removeTemplate(id);
    renderTemplateAnalysis(null);
    await refreshTemplates();
  }

  function cuttingPickOrder(){
    const input = g('cut-order-file');
    if(input) input.click();
  }

  function cuttingClearCurrent(){
    state.orderItems = [];
    state.results = [];
    state.pendingTemplateFile = null;
    state.pendingWorkbook = null;
    state.pendingBook = null;
    text('cut-template-file-name', '');
    text('cut-order-file-name', '');
    renderTemplateAnalysis(null);
    renderResults();
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
        if(isLikelyCode(cell)) codeScores.set(c, (codeScores.get(c) || 0) + 1);
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
      if(!isLikelyCode(row[codeIdx])) continue;
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
        if(!isLikelyCode(code) || qty <= 0) return;
        items.set(code, (items.get(code) || 0) + qty);
      });
    }
    if(!items.size){
      header = inferOrderHeaderByShape(rows);
      if(header){
        rows.forEach(row => {
          const code = normalizeCode(row[header.codeIdx]);
          const qty = parseNumber(row[header.qtyIdx]);
          if(!isLikelyCode(code) || qty <= 0) return;
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
    state.results = state.orderItems.map(item => {
      const template = map.get(item.code);
      if(!template){
        return {code:item.code, qty:item.qty, piecesPerItem:0, totalPieces:0, reverseQty:0, status:'missing'};
      }
      const pieces = Number(template.piecesPerItem || 0);
      if(pieces <= 0){
        return {...template, qty:item.qty, piecesPerItem:pieces, totalPieces:0, reverseQty:0, status:'error'};
      }
      const totalPieces = item.qty * pieces;
      const reverseQty = totalPieces / pieces;
      return {...template, qty:item.qty, totalPieces, reverseQty, status:'pass'};
    });
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
    const canPreview = total > 0 && missing.length === 0 && errors.length === 0;
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
      } else if(canPreview){
        alertBox.className = 'nt ns';
        alertBox.innerHTML = `<i class="ti ti-check"></i><div>Kiểm tra đạt: ${fmtNum(total)} mã hàng đều có mẫu. Có thể xuất Excel thành phẩm từ mẫu gốc để giữ nguyên màu sắc và hình ảnh.<br>檢查通過：${fmtNum(total)} 個款號都有模板。可用原始 Excel 模板匯出成品，保留配色與圖片。</div>`;
      } else {
        alertBox.className = 'nt nd';
        alertBox.innerHTML = `<i class="ti ti-alert-triangle"></i><div>Không thể xuất: thiếu ${fmtNum(missing.length)} mẫu, lỗi ${fmtNum(errors.length)} dòng.<br>不可匯出：缺少 ${fmtNum(missing.length)} 個款號模板，錯誤 ${fmtNum(errors.length)} 筆。</div>`;
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
    const totalQty = state.results.reduce((sum, r) => sum + r.qty, 0);
    const totalPieces = state.results.reduce((sum, r) => sum + r.totalPieces, 0);
    const validations = state.results.map(result => ({result, problems: validateExportResult(result)}));
    const problemRows = validations.flatMap(row => row.problems.map(problem => ({code: row.result.code, problem})));
    const passed = validations.filter(row => !row.problems.length).length;
    const failed = validations.length - passed;
    const statusClass = failed ? 'nt nd' : 'nt ns';
    const statusIcon = failed ? 'ti ti-alert-triangle' : 'ti ti-check';
    const statusText = failed
      ? `Kiểm tra không đạt: ${fmtNum(failed)} mã hàng có lỗi, vui lòng sửa trước khi tạo PDF.<br>驗算未通過：${fmtNum(failed)} 個款號有錯誤，請修正後再產生 PDF。`
      : `Kiểm tra đạt: ${fmtNum(state.results.length)} mã hàng đều đúng, có thể tạo PDF in.<br>驗算通過：${fmtNum(state.results.length)} 個款號都正確，可以產生 PDF 列印。`;
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
    ` : `
      <div class="nt ns">
        <i class="ti ti-check"></i>
        <div>Chỉ nhóm có mã hàng trong đơn mới xuất ra PDF; SL:PO và SL:CẮT sẽ tính lại khi in.<br>只有包含訂單款號的組會輸出到 PDF；列印時會重新計算 SL:PO 與 SL:CẮT。</div>
      </div>
    `;
    return `
      <div class="mg">
        <div class="mc"><div class="ml">Tổng mã hàng</div><div class="mvi">總款號</div><div class="mv">${fmtNum(state.results.length)}</div></div>
        <div class="mc"><div class="ml">Tổng số đơn</div><div class="mvi">訂單總數</div><div class="mv">${fmtNum(totalQty)}</div></div>
        <div class="mc"><div class="ml">Tổng dây cắt</div><div class="mvi">裁段總數</div><div class="mv">${fmtNum(totalPieces)}</div></div>
        <div class="mc"><div class="ml">Mã hàng đạt</div><div class="mvi">通過款號</div><div class="mv">${fmtNum(passed)}</div></div>
      </div>
      <div class="${statusClass}" style="margin-bottom:12px">
        <i class="${statusIcon}"></i>
        <div>${statusText}</div>
      </div>
      ${problemHtml}
    `;
  }

  function cuttingOpenPreview(){
    if(!state.results.length || state.results.some(r => r.status !== 'pass')){
      alert('Vẫn còn mã hàng thiếu mẫu hoặc lỗi, không thể xem trước.\n仍有缺少模板或錯誤款號，不能預覽。');
      return;
    }
    const problems = validateExportResults(state.results);
    const exportBtn = g('cut-export-filled-btn');
    if(exportBtn) exportBtn.disabled = problems.length > 0;
    html('cut-preview-body', buildPreviewHtml());
    om('m-cutting-preview');
  }

  const XLSX_MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const XLSX_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const XLSX_DOC_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function xmlElements(root, localName){
    return Array.from(root.getElementsByTagName('*')).filter(el => el.localName === localName);
  }

  function parseXml(text){
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const error = doc.getElementsByTagName('parsererror')[0];
    if(error) throw new Error('Không đọc được cấu trúc Excel.\n無法讀取 Excel 結構。');
    return doc;
  }

  async function readXml(zip, path){
    const file = zip.file(path);
    if(!file) throw new Error(`Thiếu file trong Excel: ${path}\nExcel 內缺少檔案：${path}`);
    return parseXml(await file.async('text'));
  }

  function serializeXml(doc){
    return new XMLSerializer().serializeToString(doc);
  }

  function sheetCellText(value){
    if(value == null) return '';
    if(typeof value === 'object' && value !== null){
      if(value.w != null) return String(value.w);
      if(value.v != null) return String(value.v);
    }
    return String(value);
  }

  function resolveZipPath(basePath, target){
    const raw = String(target || '').replace(/^\/+/, '');
    if(raw.startsWith('xl/')) return raw;
    const parts = basePath.split('/');
    parts.pop();
    raw.split('/').forEach(part => {
      if(!part || part === '.') return;
      if(part === '..') parts.pop();
      else parts.push(part);
    });
    return parts.join('/');
  }

  function fileMimeType(path){
    const ext = String(path || '').split('.').pop().toLowerCase();
    if(ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if(ext === 'webp') return 'image/webp';
    if(ext === 'gif') return 'image/gif';
    return 'image/png';
  }

  function uint8ToBase64(bytes){
    let binary = '';
    const chunkSize = 0x8000;
    for(let i = 0; i < bytes.length; i += chunkSize){
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function firstChildText(node, localName){
    const found = xmlElements(node, localName)[0];
    return found ? found.textContent : '';
  }

  function normalizeXlsxTarget(target){
    const clean = String(target || '').replace(/^\/+/, '').replace(/^\.\//, '');
    return clean.startsWith('xl/') ? clean : `xl/${clean}`;
  }

  async function getSheetPathMap(zip){
    const workbookDoc = await readXml(zip, 'xl/workbook.xml');
    const relsDoc = await readXml(zip, 'xl/_rels/workbook.xml.rels');
    const rels = new Map();
    xmlElements(relsDoc, 'Relationship').forEach(rel => {
      rels.set(rel.getAttribute('Id'), normalizeXlsxTarget(rel.getAttribute('Target')));
    });
    const sheets = new Map();
    xmlElements(workbookDoc, 'sheet').forEach(sheet => {
      const relId = sheet.getAttributeNS(XLSX_DOC_REL_NS, 'id') || sheet.getAttribute('r:id');
      const target = rels.get(relId);
      if(target) sheets.set(sheet.getAttribute('name'), target);
    });
    return {workbookDoc, sheets};
  }

  function drawingAnchorRange(anchor){
    const from = xmlElements(anchor, 'from')[0];
    const to = xmlElements(anchor, 'to')[0];
    const fromCol = Number(firstChildText(from, 'col') || 0);
    const fromRow = Number(firstChildText(from, 'row') || 0);
    const rawToCol = Number(firstChildText(to, 'col') || 0);
    const rawToRow = Number(firstChildText(to, 'row') || 0);
    return {
      fromCol,
      fromRow,
      toCol: rawToCol > fromCol ? rawToCol : fromCol + 3,
      toRow: rawToRow > fromRow ? rawToRow : fromRow + 18
    };
  }

  async function extractSheetImages(zip, sheetPath){
    const relsPath = sheetPath.replace('/worksheets/', '/worksheets/_rels/') + '.rels';
    const sheetRelsFile = zip.file(relsPath);
    if(!sheetRelsFile) return [];
    const sheetRelsDoc = parseXml(await sheetRelsFile.async('text'));
    const drawingRel = xmlElements(sheetRelsDoc, 'Relationship').find(rel => String(rel.getAttribute('Type') || '').includes('/drawing'));
    if(!drawingRel) return [];
    const drawingPath = resolveZipPath(sheetPath, drawingRel.getAttribute('Target'));
    const drawingFile = zip.file(drawingPath);
    if(!drawingFile) return [];
    const drawingDoc = parseXml(await drawingFile.async('text'));
    const drawingRelsPath = drawingPath.replace('/drawings/', '/drawings/_rels/') + '.rels';
    const drawingRelsFile = zip.file(drawingRelsPath);
    if(!drawingRelsFile) return [];
    const drawingRelsDoc = parseXml(await drawingRelsFile.async('text'));
    const media = new Map();
    xmlElements(drawingRelsDoc, 'Relationship').forEach(rel => {
      media.set(rel.getAttribute('Id'), resolveZipPath(drawingPath, rel.getAttribute('Target')));
    });

    const images = [];
    const anchors = xmlElements(drawingDoc, 'twoCellAnchor').concat(xmlElements(drawingDoc, 'oneCellAnchor'));
    for(const anchor of anchors){
      const blip = xmlElements(anchor, 'blip')[0];
      const relId = blip ? (blip.getAttributeNS(XLSX_DOC_REL_NS, 'embed') || blip.getAttribute('r:embed')) : '';
      const mediaPath = media.get(relId);
      const mediaFile = mediaPath ? zip.file(mediaPath) : null;
      if(!mediaFile) continue;
      const bytes = await mediaFile.async('uint8array');
      images.push({
        ...drawingAnchorRange(anchor),
        dataUrl: `data:${fileMimeType(mediaPath)};base64,${uint8ToBase64(bytes)}`
      });
    }
    return images;
  }

  async function extractWorkbookImages(zip, sheetPaths){
    const images = new Map();
    for(const [sheetName, sheetPath] of sheetPaths.entries()){
      images.set(sheetName, await extractSheetImages(zip, sheetPath));
    }
    return images;
  }

  function rowNumberFromAddress(cellAddr){
    const match = String(cellAddr || '').match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  function columnNumberFromAddress(cellAddr){
    const match = String(cellAddr || '').match(/[A-Z]+/i);
    return match ? colLettersToIndex(match[0]) : -1;
  }

  function ensureRow(doc, sheetData, rowNumber){
    const rows = Array.from(sheetData.childNodes).filter(node => node.nodeType === 1 && node.localName === 'row');
    let row = rows.find(node => Number(node.getAttribute('r')) === rowNumber);
    if(row) return row;
    row = doc.createElementNS(XLSX_MAIN_NS, 'row');
    row.setAttribute('r', String(rowNumber));
    const next = rows.find(node => Number(node.getAttribute('r')) > rowNumber);
    sheetData.insertBefore(row, next || null);
    return row;
  }

  function ensureCell(doc, row, cellAddr){
    const wantedCol = columnNumberFromAddress(cellAddr);
    const cells = Array.from(row.childNodes).filter(node => node.nodeType === 1 && node.localName === 'c');
    let cell = cells.find(node => node.getAttribute('r') === cellAddr);
    if(cell) return cell;
    cell = doc.createElementNS(XLSX_MAIN_NS, 'c');
    cell.setAttribute('r', cellAddr);
    const next = cells.find(node => columnNumberFromAddress(node.getAttribute('r')) > wantedCol);
    row.insertBefore(cell, next || null);
    return cell;
  }

  function setCellNumber(doc, cell, value){
    cell.removeAttribute('t');
    Array.from(cell.childNodes).forEach(node => {
      if(node.nodeType === 1 && ['f','v','is'].includes(node.localName)) cell.removeChild(node);
    });
    const v = doc.createElementNS(XLSX_MAIN_NS, 'v');
    v.textContent = String(Number(value || 0));
    cell.appendChild(v);
  }

  function forceWorkbookRecalc(workbookDoc){
    const workbook = workbookDoc.documentElement;
    let calcPr = xmlElements(workbookDoc, 'calcPr')[0];
    if(!calcPr){
      calcPr = workbookDoc.createElementNS(XLSX_MAIN_NS, 'calcPr');
      workbook.appendChild(calcPr);
    }
    calcPr.setAttribute('calcMode', 'auto');
    calcPr.setAttribute('fullCalcOnLoad', '1');
    calcPr.setAttribute('forceFullCalc', '1');
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
    templateQtyRows(template).forEach(rowInfo => {
      cells.set(`${rowInfo.sheetName}!${rowInfo.qtyCell}`, {rowInfo, value: 0});
    });
    results.forEach(result => {
      (result.rows || []).forEach(rowInfo => {
        cells.set(`${rowInfo.sheetName}!${rowInfo.qtyCell}`, {rowInfo, value: result.qty});
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

  function resultMapByCode(results){
    const map = new Map();
    results.forEach(result => map.set(result.code, result));
    return map;
  }

  function headerRowsForPrint(rows, rule){
    const found = [];
    rows.forEach((row, index) => {
      if(findTemplateHeader(row)) found.push(index);
    });
    if(!found.length && rule && rule.rowNumber) found.push(Number(rule.rowNumber) - 1);
    return found.sort((a, b) => a - b);
  }

  function findGroupValue(rows, startRow, endRow, fromCol, toCol, tester){
    for(let r = startRow; r <= endRow && r < rows.length; r++){
      const row = rows[r] || [];
      for(let c = Math.max(0, fromCol); c <= toCol; c++){
        const value = sheetCellText(row[c]).trim();
        if(value && tester(value)) return value;
      }
    }
    return '';
  }

  function pickGroupImage(images, startRow, endRow){
    return (images || []).find(img => img.fromRow <= endRow && img.toRow >= startRow) || null;
  }

  function buildPrintBlocksFromWorkbook(workbook, template, results, imagesBySheet){
    const blocks = [];
    const resultMap = resultMapByCode(results);
    const ruleMap = new Map((template.rules || []).map(rule => [rule.sheetName, rule]));
    workbook.SheetNames.forEach(sheetName => {
      const rule = ruleMap.get(sheetName);
      if(!rule || rule.codeCol < 0 || rule.qtyCol < 0 || rule.pieceCol < 0) return;
      const ws = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
      const headers = headerRowsForPrint(rows, rule);
      headers.forEach((headerRow, index) => {
        const nextHeader = headers[index + 1] ?? rows.length;
        const endRow = nextHeader - 1;
        const itemRows = [];
        for(let r = headerRow + 1; r <= endRow && r < rows.length; r++){
          const row = rows[r] || [];
          const code = normalizeCode(row[rule.codeCol]);
          if(!isLikelyCode(code)) continue;
          const order = resultMap.get(code);
          const pieces = parseNumber(row[rule.pieceCol]);
          const poQty = order ? Number(order.qty || 0) : 0;
          itemRows.push({
            code,
            color: sheetCellText(row[rule.codeCol + 1] || ''),
            cutSpec: sheetCellText(row[Math.max(0, rule.qtyCol - 1)] || ''),
            pieces,
            poQty,
            cutQty: poQty * pieces,
            matched: !!order
          });
        }
        if(!itemRows.some(row => row.matched)) return;
        const header = rows[headerRow] || [];
        const image = pickGroupImage(imagesBySheet.get(sheetName), headerRow, endRow);
        const segment = findGroupValue(rows, headerRow + 1, endRow, 0, Math.max(0, rule.codeCol - 1), value => /ĐOẠN|DOAN/i.test(value)) || sheetName;
        const beltSpec = findGroupValue(rows, headerRow + 1, endRow, 0, Math.max(0, rule.codeCol - 1), value => /MM|\*/i.test(value));
        const groupCutSpec = itemRows.find(row => row.cutSpec)?.cutSpec || '';
        const note = findGroupValue(rows, headerRow + 1, endRow, (rule.totalCol >= 0 ? rule.totalCol + 1 : rule.pieceCol + 2), Math.min(40, (rule.totalCol >= 0 ? rule.totalCol + 4 : rule.pieceCol + 5)), value => !findTemplateHeader([value]));
        blocks.push({
          fileName: template.fileName,
          sheetName,
          poTitle: sheetCellText(header[0] || ''),
          codeHeader: sheetCellText(header[rule.codeCol] || 'MÃ HÀNG'),
          segment,
          beltSpec,
          groupCutSpec,
          note,
          image,
          rows: itemRows
        });
      });
    });
    return blocks;
  }

  function printBlockHtml(block){
    const rowCount = Math.max(block.rows.length, 1);
    return `
      <section class="cut-print-block">
        <table>
          <thead>
            <tr>
              <th>${esc(block.poTitle || block.fileName)}</th>
              <th>QUY CÁCH<br>DÂY ĐAI</th>
              <th>${esc(block.codeHeader)}</th>
              <th>MÀU</th>
              <th>QUY CÁCH<br>CẮT</th>
              <th>SL:PO<br>PCS</th>
              <th>SỐ KIỆN</th>
              <th>SL:CẮT<br>THỰC TẾ</th>
              <th>SL: THIẾU<br>LIỆU</th>
              <th>GHI CHÚ</th>
            </tr>
          </thead>
          <tbody>
            ${block.rows.map((row, index) => `
              <tr>
                ${index === 0 ? `<td class="visual" rowspan="${rowCount}"><div class="segment">${esc(block.segment)}</div>${block.image ? `<img src="${block.image.dataUrl}" alt="">` : ''}</td><td class="spec" rowspan="${rowCount}">${esc(block.beltSpec)}</td>` : ''}
                <td>${esc(row.code)}</td>
                <td>${esc(row.color)}</td>
                ${index === 0 ? `<td class="spec" rowspan="${rowCount}">${esc(block.groupCutSpec)}</td>` : ''}
                <td class="num">${fmtNum(row.poQty)}</td>
                <td class="num">${fmtNum(row.pieces)}</td>
                <td class="num cut">${fmtNum(row.cutQty)}</td>
                <td></td>
                ${index === 0 ? `<td class="note" rowspan="${rowCount}">${esc(block.note)}</td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
    `;
  }

  function buildPrintDocumentHtml(blocks){
    const stamp = new Date().toLocaleString('zh-TW');
    return `<!doctype html>
      <html><head><meta charset="utf-8">
      <title>裁帶 PDF 列印</title>
      <style>
        @page{size:A4 landscape;margin:8mm}
        *{box-sizing:border-box}
        body{margin:0;font-family:Arial,"Microsoft JhengHei",sans-serif;color:#000;background:#fff}
        .toolbar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 12px;background:#f8fafc;border-bottom:1px solid #cbd5e1}
        .toolbar b{font-size:14px}.toolbar span{font-size:12px;color:#64748b}
        .toolbar button{border:0;border-radius:6px;background:#2563eb;color:#fff;padding:9px 14px;font-size:14px;cursor:pointer}
        .page{padding:10px}
        .cut-print-block{break-inside:avoid;page-break-inside:avoid;margin:0 0 12px}
        table{width:100%;border-collapse:collapse;table-layout:fixed}
        th,td{border:1px solid #1f2937;text-align:center;vertical-align:middle;padding:4px 5px;font-size:15px;line-height:1.15}
        th{background:#08765e;color:white;font-weight:700;font-size:17px}
        td.visual{width:190px;min-height:260px}
        .visual .segment{font-size:24px;font-weight:800;margin:10px 0 18px}
        .visual img{max-width:160px;max-height:230px;object-fit:contain}
        .spec{font-size:20px;font-weight:800}
        .num{font-size:18px}
        .cut{background:#fff2cc;font-weight:800;font-size:20px}
        .note{font-size:20px;font-weight:800;text-align:left;white-space:pre-line}
        @media print{.toolbar{display:none}.page{padding:0}.cut-print-block{margin-bottom:8mm}}
      </style></head>
      <body>
        <div class="toolbar"><div><b>PDF in dây cắt / 裁帶 PDF 列印</b><br><span>${esc(stamp)}，${fmtNum(blocks.length)} nhóm / 組</span></div><button onclick="window.print()">In / 列印</button></div>
        <main class="page">${blocks.map(printBlockHtml).join('')}</main>
      </body></html>`;
  }

  async function buildPdfPrintHtml(){
    const byTemplate = new Map();
    state.results.forEach(result => {
      if(!byTemplate.has(result.templateId)) byTemplate.set(result.templateId, []);
      byTemplate.get(result.templateId).push(result);
    });
    const blocks = [];
    for(const [templateId, results] of byTemplate.entries()){
      const template = state.templates.find(item => item.id === templateId);
      const fileName = template?.fileName || results[0]?.fileName || '';
      if(!/\.xlsx$/i.test(fileName)){
        throw new Error(`Mẫu này không phải .xlsx: ${fileName}\n此模板不是 .xlsx：${fileName}`);
      }
      const sourceFile = await cuttingStore.getTemplateFile(templateId);
      if(!sourceFile) throw new Error(`Không tìm thấy file mẫu gốc: ${fileName}\n找不到原始模板檔：${fileName}`);
      const buffer = await sourceFile.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer.slice(0));
      const {sheets} = await getSheetPathMap(zip);
      const imagesBySheet = await extractWorkbookImages(zip, sheets);
      const workbook = XLSX.read(buffer, {type:'array', cellFormula:true, cellStyles:true});
      blocks.push(...buildPrintBlocksFromWorkbook(workbook, template, results, imagesBySheet));
    }
    if(!blocks.length) throw new Error('Không có nhóm nào có mã hàng trong đơn.\n沒有任何組包含訂單款號。');
    return buildPrintDocumentHtml(blocks);
  }

  async function fillTemplateZip(zip, template, results){
    const {workbookDoc, sheets} = await getSheetPathMap(zip);
    const openedSheets = new Map();
    const plan = buildExportPlan(template, results);
    if(!plan.length) throw new Error('Không có ô SL:PO nào cần điền.\n沒有可填入的 SL:PO 儲存格。');
    for(const item of plan){
      const rowInfo = item.rowInfo;
      const path = sheets.get(rowInfo.sheetName);
      if(!path) throw new Error(`Không tìm thấy sheet: ${rowInfo.sheetName}\n找不到工作表：${rowInfo.sheetName}`);
      if(!openedSheets.has(path)) openedSheets.set(path, await readXml(zip, path));
      const doc = openedSheets.get(path);
      const sheetData = xmlElements(doc, 'sheetData')[0];
      if(!sheetData) throw new Error(`Sheet không có dữ liệu: ${rowInfo.sheetName}\n工作表沒有資料：${rowInfo.sheetName}`);
      const rowNumber = rowNumberFromAddress(rowInfo.qtyCell);
      const cell = ensureCell(doc, ensureRow(doc, sheetData, rowNumber), rowInfo.qtyCell);
      setCellNumber(doc, cell, item.value);
    }
    forceWorkbookRecalc(workbookDoc);
    zip.file('xl/workbook.xml', serializeXml(workbookDoc));
    openedSheets.forEach((doc, path) => zip.file(path, serializeXml(doc)));
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

  function finishedExcelName(fileName, stamp){
    const base = String(fileName || 'template.xlsx').replace(/\.(xlsx|xlsm)$/i, '');
    return `${base}_成品_${stamp}.xlsx`;
  }

  async function cuttingExportFilledExcel(){
    if(!state.results.length || state.results.some(r => r.status !== 'pass')){
      alert('Không thể xuất khi còn lỗi.\n仍有錯誤時不能匯出。');
      return;
    }
    if(!window.JSZip){
      alert('Thiếu công cụ đọc Excel, vui lòng tải lại trang rồi thử lại.\n缺少 Excel 讀取工具，請重新整理頁面後再試。');
      return;
    }
    const resultProblems = validateExportResults(state.results);
    if(resultProblems.length){
      alert('Kiểm tra số lượng không đạt, không thể xuất.\n數量驗算未通過，不能匯出。\n\n' + resultProblems.slice(0, 8).join('\n'));
      return;
    }
    const byTemplate = new Map();
    state.results.forEach(result => {
      if(!byTemplate.has(result.templateId)) byTemplate.set(result.templateId, []);
      byTemplate.get(result.templateId).push(result);
    });
    const stamp = new Date().toLocaleDateString('zh-TW').replace(/\//g, '-');
    const outputs = [];
    try{
      for(const [templateId, results] of byTemplate.entries()){
        const template = state.templates.find(item => item.id === templateId);
        const fileName = template?.fileName || results[0]?.fileName || '';
        if(!/\.xlsx$/i.test(fileName)){
          alert(`Mẫu này không phải .xlsx: ${fileName}\n此模板不是 .xlsx：${fileName}\n\nVui lòng dùng Excel lưu mẫu thành .xlsx rồi nhập lại.\n請先用 Excel 將模板另存為 .xlsx 後重新匯入。`);
          return;
        }
        const sourceFile = await cuttingStore.getTemplateFile(templateId);
        if(!sourceFile) throw new Error(`Không tìm thấy file mẫu gốc: ${fileName}\n找不到原始模板檔：${fileName}`);
        const zip = await JSZip.loadAsync(await sourceFile.arrayBuffer());
        await fillTemplateZip(zip, template, results);
        const blob = await zip.generateAsync({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        outputs.push({name: finishedExcelName(fileName, stamp), blob});
      }
      if(outputs.length === 1){
        downloadBlob(outputs[0].blob, outputs[0].name);
      }else{
        const pack = new JSZip();
        for(const output of outputs){
          pack.file(output.name, await output.blob.arrayBuffer());
        }
        const packBlob = await pack.generateAsync({type:'blob', mimeType:'application/zip'});
        downloadBlob(packBlob, `裁帶成品_${stamp}.zip`);
      }
    }catch(e){
      console.error(e);
      alert('Xuất Excel thành phẩm thất bại.\n匯出成品 Excel 失敗。\n\n' + e.message);
    }
  }

  async function cuttingOpenPdfPrint(){
    if(!state.results.length || state.results.some(r => r.status !== 'pass')){
      alert('Không thể tạo PDF khi còn lỗi.\n仍有錯誤時不能產生 PDF。');
      return;
    }
    if(!window.JSZip){
      alert('Thiếu công cụ đọc Excel, vui lòng tải lại trang rồi thử lại.\n缺少 Excel 讀取工具，請重新整理頁面後再試。');
      return;
    }
    const resultProblems = validateExportResults(state.results);
    if(resultProblems.length){
      alert('Kiểm tra số lượng không đạt, không thể tạo PDF.\n數量驗算未通過，不能產生 PDF。\n\n' + resultProblems.slice(0, 8).join('\n'));
      return;
    }
    const printWindow = window.open('', '_blank');
    if(!printWindow){
      alert('Trình duyệt đã chặn cửa sổ in, vui lòng cho phép bật cửa sổ mới.\n瀏覽器已阻擋列印視窗，請允許開啟新視窗。');
      return;
    }
    printWindow.document.write('<!doctype html><meta charset="utf-8"><body style="font-family:Arial,Microsoft JhengHei,sans-serif;padding:24px">Đang tạo PDF in...<br>正在產生 PDF 列印頁...</body>');
    try{
      const content = await buildPdfPrintHtml();
      printWindow.document.open();
      printWindow.document.write(content);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 700);
    }catch(e){
      console.error(e);
      printWindow.close();
      alert('Tạo PDF in thất bại.\n產生 PDF 列印頁失敗。\n\n' + e.message);
    }
  }

  async function cuttingInit(){
    await refreshTemplates();
  }

  window.cuttingPickTemplate = cuttingPickTemplate;
  window.cuttingImportDragOver = cuttingImportDragOver;
  window.cuttingImportDragLeave = cuttingImportDragLeave;
  window.cuttingTemplateDrop = cuttingTemplateDrop;
  window.cuttingHandleTemplateFile = cuttingHandleTemplateFile;
  window.cuttingApplyTemplateRules = cuttingApplyTemplateRules;
  window.cuttingConfirmTemplate = cuttingConfirmTemplate;
  window.cuttingDeleteTemplate = cuttingDeleteTemplate;
  window.cuttingPickOrder = cuttingPickOrder;
  window.cuttingHandleOrderFile = cuttingHandleOrderFile;
  window.cuttingClearCurrent = cuttingClearCurrent;
  window.cuttingOpenPreview = cuttingOpenPreview;
  window.cuttingExportFilledExcel = cuttingExportFilledExcel;
  window.cuttingOpenPdfPrint = cuttingOpenPdfPrint;
  window.cuttingInit = cuttingInit;

  window.addEventListener('DOMContentLoaded', cuttingInit);
})();
