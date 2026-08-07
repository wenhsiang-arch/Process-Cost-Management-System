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
    const pair = resolve(value); // pair（本次雙語文字）
    return `${pair.vi} / ${pair.zh}`;
  }

  register('common', COMMON_TEXT); // common（共用文字範圍）

  window.PCMSUIText = Object.freeze({ // PCMSUIText（共用雙語文字介面）
    register,
    get,
    resolve,
    set,
    create,
    assistiveLabel
  });
})();
