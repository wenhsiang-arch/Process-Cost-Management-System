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

  function isLikelyCode(value){
    const code = normalizeCode(value);
    return /^[A-Z]{1,6}\d{2,}[-A-Z0-9]*$/.test(code)
      || /^[A-Z]{1,6}\d{2,}~(?:[A-Z]{1,6})?\d{1,}[-A-Z0-9]*$/.test(code);
  }

  function expandCodeAliases(value){
    const code = normalizeCode(value);
    if(!code) return [];
    if(!code.includes('~')) return [code];
    const parts = code.split('~');
    if(parts.length !== 2) return [code];
    const left = parts[0];
    const right = parts[1];
    const leftMatch = left.match(/^([A-Z]{1,6})(\d+)([-A-Z0-9]*)$/);
    if(!leftMatch || leftMatch[3]) return [code];
    const prefix = leftMatch[1];
    const leftDigits = leftMatch[2];
    let rightDigits = '';
    const rightFull = right.match(/^([A-Z]{1,6})(\d+)$/);
    if(rightFull){
      if(rightFull[1] !== prefix) return [code];
      rightDigits = rightFull[2];
    }else if(/^\d+$/.test(right)){
      rightDigits = right;
    }else{
      return [code];
    }
    let baseDigits = '';
    let leftNum = 0;
    let rightNum = 0;
    let width = Math.max(leftDigits.length, rightDigits.length);
    if(rightDigits.length < leftDigits.length){
      const baseLength = leftDigits.length - rightDigits.length;
      baseDigits = leftDigits.slice(0, baseLength);
      leftNum = Number(leftDigits.slice(baseLength));
      rightNum = Number(rightDigits);
      width = rightDigits.length;
    }else{
      leftNum = Number(leftDigits);
      rightNum = Number(rightDigits);
    }
    if(!Number.isFinite(leftNum) || !Number.isFinite(rightNum) || rightNum < leftNum || rightNum - leftNum > 200) return [code];
    const aliases = [];
    for(let num = leftNum; num <= rightNum; num++){
      aliases.push(`${prefix}${baseDigits}${String(num).padStart(width, '0')}`);
    }
    return aliases;
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
            aliases: expandCodeAliases(code),
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
          codeMap.set(code, {code, aliases: expandCodeAliases(code), piecesPerItem: 0, rows: [], templateFileName: fileName});
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
        const templateItem = {...item, templateId: book.id, fileName: book.fileName};
        const aliases = item.aliases && item.aliases.length ? item.aliases : expandCodeAliases(item.code);
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
      : `Kiểm tra đạt: ${fmtNum(state.results.length)} mã hàng đều đúng, có thể tạo PDF bằng máy này.<br>驗算通過：${fmtNum(state.results.length)} 個款號都正確，可以由本機產生 PDF。`;
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
        <div>Phiên bản đầu chỉ hỗ trợ một mẫu Excel, hệ thống sẽ gửi dữ liệu cho máy này tạo PDF.<br>第一版只支援單一 Excel 模板，系統會把資料送到本機產生 PDF。</div>
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
      setCuttingPdfProgress(
        visualPercent,
        'Đang tạo PDF trên máy này... / 本機正在產生 PDF...',
        `Đã xử lý khoảng ${seconds} giây. Lần đầu tạo cache sẽ lâu hơn.<br>已處理約 ${seconds} 秒，第一次建立快取會比較久。`
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

  async function cuttingCreateLocalPdf(){
    if(!state.results.length || state.results.some(r => r.status !== 'pass')){
      alert('Không thể tạo PDF khi còn lỗi.\n仍有錯誤時不能產生 PDF。');
      return;
    }
    const resultProblems = validateExportResults(state.results);
    if(resultProblems.length){
      alert('Kiểm tra số lượng không đạt, không thể tạo PDF.\n數量驗算未通過，不能產生 PDF。\n\n' + resultProblems.slice(0, 8).join('\n'));
      return;
    }
    const sortedResults = [...state.results].sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, {numeric:true}));
    const byTemplate = new Map();
    sortedResults.forEach(result => {
      if(!byTemplate.has(result.templateId)) byTemplate.set(result.templateId, []);
      byTemplate.get(result.templateId).push(result);
    });
    const exportBtn = g('cut-export-filled-btn');
    try{
      if(exportBtn) exportBtn.disabled = true;
      openCuttingPdfProgress();
      setCuttingPdfProgress(8, 'Đang chuẩn bị dữ liệu... / 正在準備資料...', 'Hệ thống đang kiểm tra mẫu và đơn hàng. / 系統正在確認模板與訂單。');
      const templateEntries = Array.from(byTemplate.entries());
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
        setCuttingPdfProgress(
          Math.min(28, 12 + i * 4),
          'Đang đọc file mẫu... / 正在讀取模板檔...',
          `Đang chuẩn bị mẫu ${i + 1}/${templateEntries.length}.<br>正在準備第 ${i + 1}/${templateEntries.length} 個模板。`
        );
        const sourceFile = await cuttingStore.getTemplateFile(templateId);
        if(!sourceFile) throw new Error(`Không tìm thấy file mẫu gốc: ${fileName}\n找不到原始模板檔：${fileName}`);
        const buffer = await sourceFile.arrayBuffer();
        packages.push({
          templateId,
          templateUpdatedAt: template?.updatedAt || '',
          templateFileSize: sourceFile.size || 0,
          fileName,
          templateBase64: arrayBufferToBase64(buffer),
          writes: buildLocalPdfWrites(template, results),
          orderCells: buildLocalPdfOrderCells(results)
        });
      }
      setCuttingPdfProgress(28, 'Đang đóng gói dữ liệu... / 正在整理資料...', 'Đang chuẩn bị số lượng cần điền và vị trí ô. / 正在準備填寫數量與儲存格位置。');
      const payload = packages.length === 1
        ? {...packages[0], outputName: localPdfName(packages[0].fileName)}
        : {outputName: localMergedPdfName(), templates: packages};
      setCuttingPdfProgress(35, 'Đang gửi sang máy này... / 正在傳送到本機後台...', 'Hệ thống sẽ sắp xếp theo mã hàng rồi tạo PDF. / 系統會依款號排序後產生 PDF。');
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
    cuttingSwitchTab('template');
  }

  window.cuttingPickTemplate = cuttingPickTemplate;
  window.cuttingImportDragOver = cuttingImportDragOver;
  window.cuttingImportDragLeave = cuttingImportDragLeave;
  window.cuttingTemplateDrop = cuttingTemplateDrop;
  window.cuttingHandleTemplateFile = cuttingHandleTemplateFile;
  window.cuttingSwitchTab = cuttingSwitchTab;
  window.cuttingApplyTemplateRules = cuttingApplyTemplateRules;
  window.cuttingConfirmTemplate = cuttingConfirmTemplate;
  window.cuttingDeleteTemplate = cuttingDeleteTemplate;
  window.cuttingPickOrder = cuttingPickOrder;
  window.cuttingHandleOrderFile = cuttingHandleOrderFile;
  window.cuttingClearCurrent = cuttingClearCurrent;
  window.cuttingOpenPreview = cuttingOpenPreview;
  window.cuttingCreateLocalPdf = cuttingCreateLocalPdf;
  window.cuttingClosePdfProgress = cuttingClosePdfProgress;
  window.cuttingInit = cuttingInit;

  window.addEventListener('DOMContentLoaded', cuttingInit);
})();
