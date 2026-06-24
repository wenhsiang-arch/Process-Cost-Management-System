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
    return normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
    }finally{
      input.value = '';
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
    const codeWords = ['MAHANG','ITEM','款號','货号','MODEL'];
    const qtyWords = ['SOLUONG','QTY','PCS','SL','數量','数量','訂單數量'];
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

  function parseOrderRows(rows){
    const header = findOrderHeader(rows);
    const items = new Map();
    if(header){
      rows.slice(header.row + 1).forEach(row => {
        const code = normalizeCode(row[header.codeIdx]);
        const qty = parseNumber(row[header.qtyIdx]);
        if(!isLikelyCode(code) || qty <= 0) return;
        items.set(code, (items.get(code) || 0) + qty);
      });
    } else {
      rows.forEach(row => {
        const code = normalizeCode(row[0]);
        const qty = parseNumber(row[1]);
        if(!isLikelyCode(code) || qty <= 0) return;
        items.set(code, (items.get(code) || 0) + qty);
      });
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
        alertBox.innerHTML = `<i class="ti ti-check"></i><div>Kiểm tra đạt: ${fmtNum(total)} mã hàng đều có mẫu. Bước xuất PDF cần dùng bản sao Excel gốc để giữ nguyên màu sắc và hình ảnh.<br>檢查通過：${fmtNum(total)} 個款號都有模板。匯出 PDF 時需使用原始 Excel 副本，才能保留配色與圖片。</div>`;
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
    return `
      <div class="mg">
        <div class="mc"><div class="ml">Tổng mã hàng</div><div class="mvi">總款號</div><div class="mv">${fmtNum(state.results.length)}</div></div>
        <div class="mc"><div class="ml">Tổng số đơn</div><div class="mvi">訂單總數</div><div class="mv">${fmtNum(totalQty)}</div></div>
        <div class="mc"><div class="ml">Tổng dây cắt</div><div class="mvi">裁段總數</div><div class="mv">${fmtNum(totalPieces)}</div></div>
      </div>
      <div class="nt nw" style="margin-bottom:12px">
        <i class="ti ti-file-spreadsheet"></i>
        <div>PDF chính thức sẽ tạo bằng cách sao chép Excel gốc, điền ô SL:PO, rồi chuyển PDF để giữ nguyên hình ảnh và màu sắc.<br>正式 PDF 會用原始 Excel 副本填入 SL:PO 數量後轉檔，保留圖片與配色。</div>
      </div>
      <div class="to"><div class="ts" style="max-height:420px"><table>
        <thead><tr>
          <th>Mã hàng<br><span class="tv">款號</span></th>
          <th style="text-align:right">SL đơn<br><span class="tv">訂單數量</span></th>
          <th style="text-align:right">Số dây/SP<br><span class="tv">每件條數</span></th>
          <th style="text-align:right">Tổng dây<br><span class="tv">裁段總數</span></th>
          <th>Ô sẽ điền<br><span class="tv">將填入儲存格</span></th>
        </tr></thead>
        <tbody>
          ${state.results.map(r => `<tr><td>${esc(r.code)}</td><td style="text-align:right">${fmtNum(r.qty)}</td><td style="text-align:right">${fmtNum(r.piecesPerItem)}</td><td style="text-align:right">${fmtNum(r.totalPieces)}</td><td>${esc((r.rows || []).slice(0, 6).map(x => `${x.sheetName}!${x.qtyCell}`).join(', '))}</td></tr>`).join('')}
        </tbody>
      </table></div></div>
    `;
  }

  function cuttingOpenPreview(){
    if(!state.results.length || state.results.some(r => r.status !== 'pass')){
      alert('Vẫn còn mã hàng thiếu mẫu hoặc lỗi, không thể xem trước.\n仍有缺少模板或錯誤款號，不能預覽。');
      return;
    }
    html('cut-preview-body', buildPreviewHtml());
    om('m-cutting-preview');
  }

  function cuttingExportCheck(){
    if(!state.results.length || state.results.some(r => r.status !== 'pass')){
      alert('Không thể xuất khi còn lỗi.\n仍有錯誤時不能匯出。');
      return;
    }
    const rows = [
      ['Mã hàng / 款號','SL đơn / 訂單數量','Số dây/SP / 每件條數','Tổng dây / 裁段總數','SL suy ngược / 反推數量','Ô sẽ điền / 將填入儲存格','Trạng thái / 狀態'],
      ...state.results.map(r => [r.code, r.qty, r.piecesPerItem, r.totalPieces, r.reverseQty, (r.rows || []).map(x => `${x.sheetName}!${x.qtyCell}`).join(', '), 'Đạt / 通過'])
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '裁帶檢查');
    const stamp = new Date().toLocaleDateString('zh-TW').replace(/\//g, '-');
    XLSX.writeFile(wb, `裁帶檢查_${stamp}.xlsx`);
  }

  function cuttingPrintPreview(){
    alert('Bước này cần kết nối công cụ chuyển PDF trên máy này.\n此步驟需要接上本機 PDF 轉檔助手，才會用原始 Excel 模板輸出。');
  }

  async function cuttingInit(){
    await refreshTemplates();
  }

  window.cuttingPickTemplate = cuttingPickTemplate;
  window.cuttingHandleTemplateFile = cuttingHandleTemplateFile;
  window.cuttingApplyTemplateRules = cuttingApplyTemplateRules;
  window.cuttingConfirmTemplate = cuttingConfirmTemplate;
  window.cuttingDeleteTemplate = cuttingDeleteTemplate;
  window.cuttingPickOrder = cuttingPickOrder;
  window.cuttingHandleOrderFile = cuttingHandleOrderFile;
  window.cuttingClearCurrent = cuttingClearCurrent;
  window.cuttingOpenPreview = cuttingOpenPreview;
  window.cuttingExportCheck = cuttingExportCheck;
  window.cuttingPrintPreview = cuttingPrintPreview;
  window.cuttingInit = cuttingInit;

  window.addEventListener('DOMContentLoaded', cuttingInit);
})();
