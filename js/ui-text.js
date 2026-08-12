// ui-text.js（共用雙語文字）：集中共用操作與狀態文字；功能專屬文字於逐頁改版時另行登記。
(function(){
  const COMMON_TEXT = Object.freeze({ // COMMON_TEXT（共用雙語文字表）
    save:{vi:'Lưu',zh:'儲存'}, // save（儲存）
    cancel:{vi:'Hủy',zh:'取消'}, // cancel（取消）
    close:{vi:'Đóng',zh:'關閉'}, // close（關閉）
    add:{vi:'Thêm',zh:'新增'}, // add（新增）
    edit:{vi:'Chỉnh sửa',zh:'修改'}, // edit（修改）
    delete:{vi:'Xóa',zh:'刪除'}, // delete（刪除）
    confirm:{vi:'Xác nhận',zh:'確認'}, // confirm（確認）
    continue:{vi:'Tiếp tục',zh:'繼續'}, // continue（繼續）
    back:{vi:'Quay lại',zh:'返回'}, // back（返回）
    search:{vi:'Tìm kiếm',zh:'搜尋'}, // search（搜尋）
    clearFilters:{vi:'Xóa bộ lọc',zh:'清除篩選'}, // clearFilters（清除篩選）
    refresh:{vi:'Làm mới',zh:'重新整理'}, // refresh（重新整理）
    retry:{vi:'Thử lại',zh:'重試'}, // retry（重試）
    import:{vi:'Nhập',zh:'匯入'}, // import（匯入）
    export:{vi:'Xuất',zh:'匯出'}, // export（匯出）
    download:{vi:'Tải xuống',zh:'下載'}, // download（下載）
    preview:{vi:'Xem trước',zh:'預覽'}, // preview（預覽）
    otherActions:{vi:'Thao tác khác',zh:'其他操作'}, // otherActions（其他操作）
    help:{vi:'Hướng dẫn',zh:'使用說明'}, // help（使用說明）
    loading:{vi:'Đang tải',zh:'載入中'}, // loading（載入中）
    processing:{vi:'Đang xử lý',zh:'處理中'}, // processing（處理中）
    saving:{vi:'Đang lưu',zh:'儲存中'}, // saving（儲存中）
    importing:{vi:'Đang nhập',zh:'匯入中'}, // importing（匯入中）
    exporting:{vi:'Đang xuất',zh:'匯出中'}, // exporting（匯出中）
    success:{vi:'Thành công',zh:'成功'}, // success（成功）
    warning:{vi:'Cảnh báo',zh:'警告'}, // warning（警告）
    error:{vi:'Lỗi',zh:'錯誤'}, // error（錯誤）
    noData:{vi:'Chưa có dữ liệu',zh:'尚無資料'}, // noData（尚無資料）
    dropAnywhere:{vi:'Kéo tệp vào bất kỳ vị trí nào trên trang',zh:'可將檔案拖入此頁任何位置'} // dropAnywhere（全頁拖曳提示）
  });

  const textScopes = new Map(); // textScopes（雙語文字範圍索引）
  const LOCALIZED_ATTRIBUTES = Object.freeze(['aria-label','title','placeholder']); // LOCALIZED_ATTRIBUTES（可跟隨語言模式更新的輔助文字屬性）
  const LEGACY_TEXT_TARGETS = 'button,label,th,option,.sb-sec,.sb-sec-toggle > span,.logout-btn > span,.tg,.nt,.nt > div,.mt,.mt2,.mt2 > span,.at,.pwl,.psb,.production-section-count,.ui-empty-state,.ui-summary-label,.settings-summary-unit,.settings-matrix-unit,.settings-help-popover,.orders-state,.ml,.mvi,#lerr-text,#cut-pdf-tool-status > div'; // LEGACY_TEXT_TARGETS（只允許整理介面標籤，不掃描資料格或使用者輸入）
  let legacyObserver = null; // legacyObserver（舊介面文字新增觀察器）

  // normalizePair（正規化雙語文字）：缺少任一語言時保留空白，交由驗收找出，不以另一語言偷偷替代。
  function normalizePair(value){
    return Object.freeze({
      vi:String(value?.vi ?? ''),
      zh:String(value?.zh ?? '')
    });
  }

  // register（登記雙語文字範圍）：同一功能只在載入自己的文字檔時登記一次。
  function register(scope, entries){
    const scopeName = String(scope || '').trim(); // scopeName（文字範圍名稱）
    if(!scopeName) throw new Error('Thiếu tên phạm vi văn bản / 缺少文字範圍名稱');
    const normalized = {}; // normalized（正規化後的文字表）
    Object.entries(entries || {}).forEach(([key, value])=>{
      normalized[String(key)] = normalizePair(value);
    });
    textScopes.set(scopeName, Object.freeze(normalized));
    return true;
  }

  // get（取得雙語文字）：文字鍵使用「範圍.名稱」，未提供範圍時使用 common（共用文字）。
  function get(key){
    const raw = String(key || ''); // raw（原始文字鍵）
    const separator = raw.indexOf('.'); // separator（範圍分隔位置）
    const scopeName = separator > 0 ? raw.slice(0, separator) : 'common'; // scopeName（文字範圍名稱）
    const textKey = separator > 0 ? raw.slice(separator + 1) : raw; // textKey（範圍內文字鍵）
    return textScopes.get(scopeName)?.[textKey] || normalizePair({vi:'', zh:''});
  }

  // resolve（解析雙語文字）：接受文字鍵或直接提供的越文與中文物件。
  function resolve(value){
    return typeof value === 'string' ? get(value) : normalizePair(value);
  }

  // currentLanguageMode（取得目前語言模式）：共用執行控制尚未載入時固定使用雙語。
  function currentLanguageMode(){
    return window.PCMSUIRuntime?.getLanguageMode?.() || 'bilingual';
  }

  // visibleText（取得目前應顯示文字）：未知模式安全回傳雙語內容。
  function visibleText(value,mode=currentLanguageMode()){
    const pair = resolve(value); // pair（越文與中文文字對照）
    if(mode === 'vi') return pair.vi;
    if(mode === 'zh') return pair.zh;
    return [pair.vi,pair.zh].filter(Boolean).join(' / ');
  }

  // parseLegacyPair（解析程式既有雙語字串）：只供已知介面標籤與程式錯誤，不得套用業務資料。
  function parseLegacyPair(value){
    const text = String(value ?? '').trim(); // text（程式既有介面文字）
    const separator = text.indexOf(' / '); // separator（既有雙語分隔位置）
    if(separator <= 0) return null;
    const vi = text.slice(0,separator).trim();
    const zh = text.slice(separator+3).trim();
    if(!/[A-Za-zÀ-ỹ]/.test(vi) || !/[\u3400-\u9fff]/.test(zh)) return null;
    return normalizePair({vi,zh});
  }

  // errorPair（建立錯誤顯示文字）：資料存取程式可保留既有 Error 訊息，由畫面入口統一轉換。
  function errorPair(error,fallback={vi:'Không thể hoàn tất thao tác.',zh:'無法完成操作。'}){
    const raw = String(error?.message ?? error ?? '').trim(); // raw（程式錯誤訊息）
    return parseLegacyPair(raw) || resolve(fallback);
  }

  // set（設定雙語文字元件）：使用文字節點建立兩行，不使用 innerHTML（直接插入網頁標記）。
  function set(target, value){
    if(!target) return null;
    const pair = resolve(value); // pair（本次雙語文字）
    const vi = document.createElement('span'); // vi（越文文字區塊）
    const zh = document.createElement('span'); // zh（中文文字區塊）
    vi.className = 'ui-text-vi'; // ui-text-vi（越文文字樣式）
    zh.className = 'ui-text-zh'; // ui-text-zh（中文文字樣式）
    vi.textContent = pair.vi;
    zh.textContent = pair.zh;
    target.classList.add('ui-bilingual'); // ui-bilingual（雙語上下排列樣式）
    target.replaceChildren(vi, zh);
    return target;
  }

  // create（建立雙語文字元件）：預設使用 span（行內文字容器）。
  function create(value, options = {}){
    const tagName = String(options.tagName || 'span'); // tagName（文字容器標籤名稱）
    const element = document.createElement(tagName); // element（新文字元件）
    if(options.className) element.className = String(options.className); // className（額外樣式名稱）
    return set(element, value);
  }

  // assistiveLabel（建立輔助名稱）：提供純圖示按鈕及系統原生輔助屬性使用。
  function assistiveLabel(value){
    return visibleText(value);
  }

  // localizedAttributePrefix（語言屬性保存前綴）：只允許中央清單中的輔助文字屬性。
  function localizedAttributePrefix(attribute){
    const name = String(attribute || '').toLowerCase(); // name（準備更新的屬性名稱）
    return LOCALIZED_ATTRIBUTES.includes(name) ? `data-ui-localized-${name}` : '';
  }

  // refreshLocalizedElement（刷新單一元件輔助文字）：不改變元件內容或業務資料。
  function refreshLocalizedElement(target,attribute){
    const prefix = localizedAttributePrefix(attribute); // prefix（語言屬性資料前綴）
    if(!target || !prefix) return false;
    const vi = target.getAttribute?.(`${prefix}-vi`) ?? '';
    const zh = target.getAttribute?.(`${prefix}-zh`) ?? '';
    target.setAttribute?.(attribute,visibleText({vi,zh}));
    return true;
  }

  // setLocalizedAttribute（設定可切換輔助文字）：保存兩種語言並立即套用目前模式。
  function setLocalizedAttribute(target,attribute,value){
    const prefix = localizedAttributePrefix(attribute); // prefix（語言屬性資料前綴）
    if(!target || !prefix) return false;
    const pair = resolve(value); // pair（越文與中文文字對照）
    target.setAttribute?.(`${prefix}-vi`,pair.vi);
    target.setAttribute?.(`${prefix}-zh`,pair.zh);
    return refreshLocalizedElement(target,attribute);
  }

  // refreshLocalizedAttributes（刷新頁面輔助文字）：語言切換時統一更新已登記元件。
  function refreshLocalizedAttributes(root=document){
    let updated = 0; // updated（本次更新元件數）
    LOCALIZED_ATTRIBUTES.forEach(attribute=>{
      const prefix = localizedAttributePrefix(attribute);
      const selector = `[${prefix}-vi]`;
      const targets = [];
      if(root?.matches?.(selector)) targets.push(root);
      root?.querySelectorAll?.(selector)?.forEach(target=>targets.push(target));
      targets.forEach(target=>{ if(refreshLocalizedElement(target,attribute)) updated += 1; });
    });
    return updated;
  }

  function refreshLocalizedValues(root=document){
    const targets=[];
    const selector='[data-ui-localized-value-vi]';
    if(root?.matches?.(selector)) targets.push(root);
    root?.querySelectorAll?.(selector)?.forEach(target=>targets.push(target));
    targets.forEach(target=>{
      target.value=visibleText({
        vi:target.getAttribute?.('data-ui-localized-value-vi')||'',
        zh:target.getAttribute?.('data-ui-localized-value-zh')||''
      });
    });
    return targets.length;
  }

  function setLocalizedValue(target,value){
    if(!target) return false;
    const pair=resolve(value);
    target.setAttribute?.('data-ui-localized-value-vi',pair.vi);
    target.setAttribute?.('data-ui-localized-value-zh',pair.zh);
    refreshLocalizedValues(target);
    return true;
  }

  function clearLocalizedValue(target,value=''){
    if(!target) return false;
    target.removeAttribute?.('data-ui-localized-value-vi');
    target.removeAttribute?.('data-ui-localized-value-zh');
    target.value=String(value??'');
    return true;
  }

  function updateLegacyOption(option){
    if(!option) return false;
    const pair = parseLegacyPair(option.textContent);
    if(pair){
      option.setAttribute?.('data-ui-option-vi',pair.vi);
      option.setAttribute?.('data-ui-option-zh',pair.zh);
    }
    const vi = option.getAttribute?.('data-ui-option-vi');
    const zh = option.getAttribute?.('data-ui-option-zh');
    if(vi === null || zh === null) return false;
    const nextText = visibleText({vi,zh});
    if(option.textContent !== nextText) option.textContent = nextText;
    return true;
  }

  function directTextNodes(target){
    return Array.from(target?.childNodes || []).filter(node=>node.nodeType === 3 && String(node.textContent || '').trim());
  }

  function upgradeSummaryLabel(target){
    if(!target?.matches?.('.ui-summary-label')) return false;
    if(target.querySelector?.(':scope > .ui-text-vi') && target.querySelector?.(':scope > .ui-text-zh')) return true;
    const zh = target.querySelector?.(':scope > span');
    const nodes = directTextNodes(target);
    const viText = nodes.map(node=>String(node.textContent || '').trim()).filter(Boolean).join(' ');
    const zhText = String(zh?.textContent || '').trim();
    if(!viText || !zhText || !/[A-Za-zÀ-ỹ]/.test(viText) || !/[\u3400-\u9fff]/.test(zhText)) return false;
    const vi = document.createElement('span');
    vi.className = 'ui-text-vi';
    vi.textContent = viText;
    nodes[0].replaceWith?.(vi);
    nodes.slice(1).forEach(node=>node.remove?.());
    zh.classList?.add('ui-text-zh');
    return true;
  }

  function markNamedSiblingPair(target){
    if(!target?.matches?.('.settings-summary-unit,.settings-matrix-unit,.settings-help-popover,.cost-log-value-head,.cost-log-time-head,.cost-log-user-head')) return false;
    const blocks = Array.from(target.children || []).filter(child=>String(child.textContent || '').trim());
    if(blocks.length !== 2) return false;
    const viText = String(blocks[0].textContent || '').trim();
    const zhText = String(blocks[1].textContent || '').trim();
    if(!viText || !zhText || !/[A-Za-zÀ-ỹ%]/.test(viText)) return false;
    blocks[0].classList?.add('ui-text-vi');
    blocks[1].classList?.add('ui-text-zh');
    return true;
  }

  function markKnownLanguageNode(target){
    if(target?.matches?.('.ml')){
      target.classList?.add('ui-text-vi');
      return true;
    }
    if(target?.matches?.('.mvi')){
      target.classList?.add('ui-text-zh');
      return true;
    }
    return false;
  }

  function upgradeHeaderSecondaryCopy(target){
    if(String(target?.tagName || '').toUpperCase() !== 'TH') return false;
    if(target.closest?.('table[data-ui-table-controls="auto"]')) return false;
    const secondary = target.querySelector?.(':scope > span, :scope > small');
    if(!secondary || secondary.matches?.('.ui-bilingual,.ui-dual-copy,.ui-table-sort-heading')) return false;
    const nodes = directTextNodes(target);
    const vi = nodes.map(node=>String(node.textContent || '').trim()).filter(Boolean).join(' ');
    const zh = String(secondary.textContent || '').trim();
    if(!vi || !zh || !/[A-Za-zÀ-ỹ]/.test(vi) || !/[\u3400-\u9fff]/.test(zh)) return false;
    target.replaceChildren(create({vi,zh}));
    return true;
  }

  function markStructuredPair(target){
    const vi = target?.querySelector?.(':scope > strong');
    const zh = target?.querySelector?.(':scope > span');
    if(!vi || !zh || !/[A-Za-zÀ-ỹ]/.test(vi.textContent || '') || !/[\u3400-\u9fff]/.test(zh.textContent || '')) return false;
    target.classList?.add('ui-dual-copy');
    return true;
  }

  function markBlockPair(target){
    if(!target?.matches?.('.ui-empty-state')) return false;
    const blocks = Array.from(target.children || []).filter(child=>{
      if(child.matches?.('i,[aria-hidden="true"]')) return false;
      return String(child.textContent || '').trim();
    });
    if(blocks.length !== 2) return false;
    if(!/[A-Za-zÀ-ỹ]/.test(blocks[0].textContent || '') || !/[\u3400-\u9fff]/.test(blocks[1].textContent || '')) return false;
    blocks[0].classList?.add('ui-text-vi');
    blocks[1].classList?.add('ui-text-zh');
    return true;
  }

  function upgradeBreakSeparatedCopy(target){
    const nodes = Array.from(target?.childNodes || []);
    if(nodes.some(node=>node.nodeType === 1 && String(node.tagName || '').toUpperCase() !== 'BR')) return false;
    const breakIndex = nodes.findIndex(node=>String(node.tagName || '').toUpperCase() === 'BR');
    if(breakIndex <= 0 || breakIndex >= nodes.length-1) return false;
    const vi = nodes.slice(0,breakIndex).map(node=>node.textContent || '').join(' ').trim();
    const zh = nodes.slice(breakIndex+1).map(node=>node.textContent || '').join(' ').trim();
    const pair = parseLegacyPair(`${vi} / ${zh}`);
    if(!pair) return false;
    target.replaceChildren(create(pair));
    return true;
  }

  function upgradeSecondaryCopy(target){
    if(!target || target.closest?.('table[data-ui-table-controls="auto"]')) return false;
    const secondary = target.querySelector?.(':scope > .tv, :scope > .lvi');
    if(!secondary) return false;
    const nodes = directTextNodes(target);
    const vi = nodes.map(node=>node.textContent).join(' ').trim();
    const zh = String(secondary.textContent || '').trim();
    if(!vi || !zh) return false;
    target.replaceChildren(create({vi,zh}));
    return true;
  }

  function upgradeLegacyTextTarget(target){
    if(!target) return false;
    if(String(target.tagName || '').toUpperCase() === 'OPTION') return updateLegacyOption(target);
    if(markKnownLanguageNode(target)) return true;
    if(upgradeSummaryLabel(target)) return true;
    if(markNamedSiblingPair(target)) return true;
    if(markStructuredPair(target)) return true;
    if(upgradeHeaderSecondaryCopy(target)) return true;
    if(markBlockPair(target)) return true;
    if(upgradeBreakSeparatedCopy(target)) return true;
    if(upgradeSecondaryCopy(target)) return true;
    let changed = false;
    directTextNodes(target).forEach(node=>{
      const pair = parseLegacyPair(node.textContent);
      if(!pair) return;
      node.replaceWith?.(create(pair));
      changed = true;
    });
    return changed;
  }

  function upgradeLocalizedAttribute(target,attribute){
    const prefix = localizedAttributePrefix(attribute);
    if(!target || !prefix) return false;
    const pair = parseLegacyPair(target.getAttribute?.(attribute));
    if(!pair) return false;
    const currentVi = target.getAttribute?.(`${prefix}-vi`);
    const currentZh = target.getAttribute?.(`${prefix}-zh`);
    if(currentVi === pair.vi && currentZh === pair.zh) return false;
    return setLocalizedAttribute(target,attribute,pair);
  }

  // upgradeLegacyMarkup（整理核准範圍內的舊介面文字）：不掃描 td（資料格）、input 值或一般內容節點。
  function upgradeLegacyMarkup(root=document){
    const attributeTargets = [];
    if(root?.nodeType === 1) attributeTargets.push(root);
    root?.querySelectorAll?.('[title],[aria-label],[placeholder]')?.forEach(target=>attributeTargets.push(target));
    attributeTargets.forEach(target=>LOCALIZED_ATTRIBUTES.forEach(attribute=>{
      upgradeLocalizedAttribute(target,attribute);
    }));

    const textTargets = [];
    if(root?.matches?.(LEGACY_TEXT_TARGETS)) textTargets.push(root);
    root?.querySelectorAll?.(LEGACY_TEXT_TARGETS)?.forEach(target=>textTargets.push(target));
    textTargets.forEach(upgradeLegacyTextTarget);
    return attributeTargets.length+textTargets.length;
  }

  function initializeLegacyMarkup(){
    upgradeLegacyMarkup(document);
    if(typeof MutationObserver !== 'function' || legacyObserver) return;
    legacyObserver = new MutationObserver(records=>{
      records.forEach(record=>{
        if(record.type === 'attributes'){
          upgradeLocalizedAttribute(record.target,record.attributeName);
          return;
        }
        record.addedNodes?.forEach(node=>{
          if(node?.nodeType === 1) upgradeLegacyMarkup(node);
          else if(node?.parentElement?.matches?.(LEGACY_TEXT_TARGETS)) upgradeLegacyTextTarget(node.parentElement);
        });
        if(record.type === 'characterData' && record.target?.parentElement?.matches?.(LEGACY_TEXT_TARGETS)){
          upgradeLegacyTextTarget(record.target.parentElement);
        }
      });
    });
    legacyObserver.observe(document.documentElement,{
      subtree:true,
      childList:true,
      characterData:true,
      attributes:true,
      attributeFilter:LOCALIZED_ATTRIBUTES
    });
  }

  register('common', COMMON_TEXT); // common（共用文字範圍）

  window.PCMSUIText = Object.freeze({ // PCMSUIText（共用雙語文字介面）
    register,
    get,
    resolve,
    set,
    create,
    assistiveLabel,
    visibleText,
    parseLegacyPair,
    errorPair,
    setLocalizedAttribute,
    refreshLocalizedAttributes,
    setLocalizedValue,
    clearLocalizedValue,
    refreshLocalizedValues,
    upgradeLegacyMarkup
  });

  document.addEventListener?.('pcms:languagechange',()=>{
    refreshLocalizedAttributes();
    refreshLocalizedValues();
    document.querySelectorAll?.('option[data-ui-option-vi]')?.forEach(updateLegacyOption);
    upgradeLegacyMarkup(document);
  });
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initializeLegacyMarkup,{once:true});
  else initializeLegacyMarkup();
})();
