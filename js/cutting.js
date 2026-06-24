// cutting（裁帶統計）：獨立功能，不讀寫原本訂單、報工或同步資料。
(function(){
  const state = {
    templates: [],
    orderItems: [],
    results: [],
    orderFileName: ''
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

  function normalizeCode(value){
    return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
  }

  function parseNumber(value){
    if(typeof value === 'number') return value;
    const raw = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '');
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function expandCodeRule(rule){
    const raw = normalizeCode(rule);
    const set = new Set();
    if(!raw) return [];
    set.add(raw);
    const m = raw.match(/^([A-Z]+)(\d+)-([A-Z]+)?(\d+)$/);
    if(m){
      const prefix = m[1];
      const startText = m[2];
      const endPrefix = m[3] || prefix;
      const endText = m[4];
      const start = Number(startText);
      const end = Number(endText);
      if(prefix === endPrefix && Number.isInteger(start) && Number.isInteger(end) && end >= start && end - start <= 300){
        const width = startText.length;
        for(let i = start; i <= end; i++) set.add(prefix + String(i).padStart(width, '0'));
      }
    }
    return Array.from(set);
  }

  function buildTemplateMap(){
    const map = new Map();
    state.templates.forEach(t => {
      [t.code, ...(t.aliases || [])].forEach(rule => {
        expandCodeRule(rule).forEach(code => {
          if(!map.has(code)) map.set(code, t);
        });
      });
    });
    return map;
  }

  function templateAliasText(template){
    return (template.aliases || []).join(', ');
  }

  async function refreshTemplates(){
    state.templates = window.cuttingStore ? await window.cuttingStore.listTemplates() : [];
    renderTemplateList();
  }

  function renderTemplateList(){
    const tb = g('cut-template-tb');
    if(!tb) return;
    if(!state.templates.length){
      tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--mu);padding:18px">Chưa có mẫu / 尚無模板</td></tr>';
      return;
    }
    tb.innerHTML = state.templates.map(t => `
      <tr>
        <td><b>${esc(t.code)}</b></td>
        <td style="text-align:right">${fmtNum(t.piecesPerItem)}</td>
        <td>${esc(templateAliasText(t) || '-')}</td>
        <td>${esc(t.fileName || '-')}</td>
        <td style="text-align:center"><button class="btn bsm bd2" onclick="cuttingDeleteTemplate('${esc(t.id)}')"><i class="ti ti-trash"></i>Xóa / 刪除</button></td>
      </tr>
    `).join('');
  }

  function guessCodeFromFileName(name){
    const base = String(name || '').replace(/\.(xlsx|xls)$/i, '').trim();
    const first = base.split(/\s+/)[0] || base;
    return normalizeCode(first);
  }

  function cuttingPickTemplate(){
    const input = g('cut-template-file');
    if(input) input.click();
  }

  function cuttingHandleTemplateFile(input){
    const file = input && input.files ? input.files[0] : null;
    if(!file) return;
    text('cut-template-file-name', file.name);
    const codeInput = g('cut-template-code');
    if(codeInput && !codeInput.value.trim()) codeInput.value = guessCodeFromFileName(file.name);
    const nameInput = g('cut-template-source');
    if(nameInput) nameInput.value = file.name;
  }

  async function cuttingSaveTemplate(){
    const code = normalizeCode(g('cut-template-code')?.value);
    const pieces = Number(g('cut-template-pieces')?.value || 0);
    const aliasesRaw = String(g('cut-template-aliases')?.value || '');
    const fileName = String(g('cut-template-source')?.value || '').trim();
    if(!code){ alert('Vui lòng nhập mã hàng.\n請輸入款號。'); return; }
    if(!Number.isFinite(pieces) || pieces <= 0){ alert('Vui lòng nhập số dây mỗi sản phẩm lớn hơn 0.\n請輸入大於 0 的每件條數。'); return; }
    const aliases = aliasesRaw.split(/[,，\n]/).map(normalizeCode).filter(Boolean);
    await window.cuttingStore.saveTemplate({code, piecesPerItem: pieces, aliases, fileName});
    g('cut-template-code').value = '';
    g('cut-template-pieces').value = '';
    g('cut-template-aliases').value = '';
    g('cut-template-source').value = '';
    text('cut-template-file-name', '');
    const fileInput = g('cut-template-file');
    if(fileInput) fileInput.value = '';
    await refreshTemplates();
    recomputeResults();
  }

  async function cuttingDeleteTemplate(id){
    if(!confirm('Xóa mẫu này?\n確定刪除此模板？')) return;
    await window.cuttingStore.removeTemplate(id);
    await refreshTemplates();
    recomputeResults();
  }

  function cuttingPickOrder(){
    const input = g('cut-order-file');
    if(input) input.click();
  }

  function findHeaderIndex(rows){
    const codeWords = ['MÃHÀNG','MAHANG','ITEM','款號','货号','MODEL','MÃ','MA'];
    const qtyWords = ['SỐLƯỢNG','SOLUONG','QTY','PCS','SL','數量','数量','訂單數量'];
    for(let r = 0; r < Math.min(rows.length, 30); r++){
      const cells = (rows[r] || []).map(v => normalizeCode(v));
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
    const header = findHeaderIndex(rows);
    const items = new Map();
    if(header){
      rows.slice(header.row + 1).forEach(row => {
        const code = normalizeCode(row[header.codeIdx]);
        const qty = parseNumber(row[header.qtyIdx]);
        if(!code || qty <= 0) return;
        items.set(code, (items.get(code) || 0) + qty);
      });
    } else {
      rows.forEach(row => {
        const code = normalizeCode(row[0]);
        const qty = parseNumber(row[1]);
        if(!code || qty <= 0 || code.includes('MÃHÀNG') || code.includes('款號')) return;
        items.set(code, (items.get(code) || 0) + qty);
      });
    }
    return Array.from(items.entries()).map(([code, qty]) => ({code, qty}));
  }

  async function cuttingHandleOrderFile(input){
    const file = input && input.files ? input.files[0] : null;
    if(!file) return;
    if(!window.XLSX){ alert('Không thể đọc Excel, vui lòng tải lại trang.\n無法讀取 Excel（表格檔），請重新整理頁面。'); return; }
    state.orderFileName = file.name;
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
        return {code:item.code, qty:item.qty, templateCode:template.code, piecesPerItem:pieces, totalPieces:0, reverseQty:0, status:'error'};
      }
      const totalPieces = item.qty * pieces;
      const reverseQty = totalPieces / pieces;
      const ok = Math.abs(reverseQty - item.qty) < 0.000001;
      return {code:item.code, qty:item.qty, templateCode:template.code, piecesPerItem:pieces, totalPieces, reverseQty, status:ok ? 'pass' : 'error'};
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
      if(!total){
        alertBox.className = 'nt nw';
        alertBox.innerHTML = '<i class="ti ti-info-circle"></i><div>Vui lòng nhập đơn hàng để kiểm tra.<br>請先匯入訂單進行比對。</div>';
        alertBox.style.display = 'flex';
      } else if(canPreview){
        alertBox.className = 'nt ns';
        alertBox.innerHTML = `<i class="ti ti-check"></i><div>Kiểm tra đạt: ${fmtNum(total)} mã hàng đều có mẫu, có thể xem trước.<br>檢查通過：${fmtNum(total)} 個款號都有模板，可以預覽。</div>`;
        alertBox.style.display = 'flex';
      } else {
        alertBox.className = 'nt nd';
        alertBox.innerHTML = `<i class="ti ti-alert-triangle"></i><div>Không thể xuất: thiếu ${fmtNum(missing.length)} mẫu, lỗi ${fmtNum(errors.length)} dòng.<br>不可匯出：缺少 ${fmtNum(missing.length)} 個款號模板，錯誤 ${fmtNum(errors.length)} 筆。</div>`;
        alertBox.style.display = 'flex';
      }
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
            <td>Không có mẫu trong dữ liệu, vui lòng tạo mẫu trước.<br>資料庫沒有此款號模板，請先建檔。</td>
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
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--mu);padding:22px">Chưa có dữ liệu / 尚無資料</td></tr>';
      return;
    }
    tb.innerHTML = state.results.map(r => `
      <tr>
        <td><b>${esc(r.code)}</b>${r.templateCode ? `<div style="font-size:10px;color:var(--mu);margin-top:2px">Mẫu / 模板：${esc(r.templateCode)}</div>` : ''}</td>
        <td style="text-align:right">${fmtNum(r.qty)}</td>
        <td style="text-align:right">${r.piecesPerItem ? fmtNum(r.piecesPerItem) : '-'}</td>
        <td style="text-align:right">${r.totalPieces ? fmtNum(r.totalPieces) : '-'}</td>
        <td style="text-align:right">${r.reverseQty ? fmtNum(r.reverseQty) : '-'}</td>
        <td>${statusBadge(r)}</td>
      </tr>
    `).join('');
  }

  function cuttingOpenPreview(){
    const missing = state.results.filter(r => r.status !== 'pass');
    if(missing.length || !state.results.length){
      alert('Vẫn còn mã hàng thiếu mẫu hoặc lỗi, không thể xem trước.\n仍有缺少模板或錯誤款號，不能預覽。');
      return;
    }
    html('cut-preview-body', buildPreviewHtml());
    om('m-cutting-preview');
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
      <div class="to"><div class="ts" style="max-height:420px"><table>
        <thead><tr>
          <th>Mã hàng<br><span class="tv">款號</span></th>
          <th style="text-align:right">SL đơn<br><span class="tv">訂單數量</span></th>
          <th style="text-align:right">Số dây/SP<br><span class="tv">每件條數</span></th>
          <th style="text-align:right">Tổng dây<br><span class="tv">裁段總數</span></th>
          <th style="text-align:right">SL suy ngược<br><span class="tv">反推數量</span></th>
        </tr></thead>
        <tbody>
          ${state.results.map(r => `<tr><td>${esc(r.code)}</td><td style="text-align:right">${fmtNum(r.qty)}</td><td style="text-align:right">${fmtNum(r.piecesPerItem)}</td><td style="text-align:right">${fmtNum(r.totalPieces)}</td><td style="text-align:right">${fmtNum(r.reverseQty)}</td></tr>`).join('')}
        </tbody>
      </table></div></div>
    `;
  }

  function cuttingExportCheck(){
    if(!state.results.length || state.results.some(r => r.status !== 'pass')){
      alert('Không thể xuất khi còn lỗi.\n仍有錯誤時不能匯出。');
      return;
    }
    const rows = [
      ['Mã hàng / 款號','SL đơn / 訂單數量','Số dây/SP / 每件條數','Tổng dây / 裁段總數','SL suy ngược / 反推數量','Trạng thái / 狀態'],
      ...state.results.map(r => [r.code, r.qty, r.piecesPerItem, r.totalPieces, r.reverseQty, 'Đạt / 通過'])
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '裁帶統計');
    const stamp = new Date().toLocaleDateString('zh-TW').replace(/\//g, '-');
    XLSX.writeFile(wb, `裁帶統計_${stamp}.xlsx`);
  }

  function cuttingPrintPreview(){
    if(!state.results.length || state.results.some(r => r.status !== 'pass')){
      alert('Không thể in khi còn lỗi.\n仍有錯誤時不能列印。');
      return;
    }
    const win = window.open('', '_blank');
    if(!win){ alert('Trình duyệt đã chặn cửa sổ in.\n瀏覽器已阻擋列印視窗。'); return; }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>裁帶統計</title>
      <style>body{font-family:Arial,"Microsoft JhengHei",sans-serif;padding:20px;color:#1e293b}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:7px 9px;text-align:left}th{background:#f1f5f9}.right{text-align:right}h1{font-size:18px;margin:0 0 12px}</style>
      </head><body><h1>Thống kê dây cắt / 裁帶統計</h1>${buildPreviewHtml()}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  async function cuttingInit(){
    await refreshTemplates();
    renderResults();
  }

  window.cuttingPickTemplate = cuttingPickTemplate;
  window.cuttingHandleTemplateFile = cuttingHandleTemplateFile;
  window.cuttingSaveTemplate = cuttingSaveTemplate;
  window.cuttingDeleteTemplate = cuttingDeleteTemplate;
  window.cuttingPickOrder = cuttingPickOrder;
  window.cuttingHandleOrderFile = cuttingHandleOrderFile;
  window.cuttingOpenPreview = cuttingOpenPreview;
  window.cuttingExportCheck = cuttingExportCheck;
  window.cuttingPrintPreview = cuttingPrintPreview;
  window.cuttingInit = cuttingInit;

  window.addEventListener('DOMContentLoaded', cuttingInit);
})();
