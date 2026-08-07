// ui-file-drop.js（全域拖曳匯入）：讓目前功能頁的整個可見內容區接收檔案，但不直接讀取或寫入業務資料。
(function(){
  const textApi = window.PCMSUIText; // textApi（共用雙語文字介面）
  const targets = new Map(); // targets（各功能頁登記的匯入用途）
  let activePage = ''; // activePage（目前啟用的功能頁）
  let overlay = null; // overlay（全域拖曳提示層）
  let overlayCopy = null; // overlayCopy（提示層雙語文字區）
  let overlayTimer = null; // overlayTimer（提示層延遲關閉計時器）

  if(textApi){
    textApi.register('fileDrop',{
      dropAnywhere:{vi:'Thả tệp vào bất kỳ vị trí nào trong vùng nội dung',zh:'放開即可從目前內容區任何位置匯入'},
      invalidType:{vi:'Định dạng tệp không được hỗ trợ',zh:'不支援這種檔案格式'},
      tooManyFiles:{vi:'Số lượng tệp vượt quá giới hạn',zh:'檔案數量超過限制'},
      unavailable:{vi:'Trang hiện tại chưa bật chức năng nhập tệp',zh:'目前頁面尚未啟用全域匯入'},
      ambiguous:{vi:'Vui lòng chọn mục nhập trước',zh:'請先選擇明確的匯入分頁'}
    });
  }

  // normalizeAccept（正規化允許格式）：支援副檔名、完整檔案類型及同類型萬用寫法。
  function normalizeAccept(value){
    const list = Array.isArray(value) ? value : String(value || '').split(','); // list（允許格式原始清單）
    return list.map(item=>String(item || '').trim().toLowerCase()).filter(Boolean);
  }

  // register（登記頁面匯入用途）：同一頁同時只能有一個符合目前狀態的用途。
  function register(options = {}){
    const id = String(options.id || '').trim(); // id（匯入用途識別碼）
    const page = String(options.page || '').trim(); // page（所屬功能頁）
    if(!id || !page) throw new Error('Thiếu mã hoặc trang nhập tệp / 缺少匯入用途識別碼或頁面');
    if(typeof options.onDrop !== 'function') throw new Error('Thiếu hàm xử lý tệp / 缺少檔案接收函式');
    const target = Object.freeze({ // target（正規化後的匯入用途）
      id,
      page,
      accept:Object.freeze(normalizeAccept(options.accept)),
      maxFiles:Math.max(1,Number(options.maxFiles) || 1),
      enabled:typeof options.enabled === 'function' ? options.enabled : ()=>options.enabled !== false,
      validate:typeof options.validate === 'function' ? options.validate : null,
      onDrop:options.onDrop,
      onReject:typeof options.onReject === 'function' ? options.onReject : null,
      onError:typeof options.onError === 'function' ? options.onError : null,
      text:options.text || 'fileDrop.dropAnywhere'
    });
    targets.set(id,target);
    return ()=>unregister(id);
  }

  // unregister（移除匯入用途）：不影響其他頁面或既有檔案選擇按鈕。
  function unregister(id){
    const removed = targets.delete(String(id || '')); // removed（是否成功移除）
    if(removed) hideOverlay();
    return removed;
  }

  // resolveActiveTarget（解析目前用途）：不存在或超過一個時都不自動猜測。
  function resolveActiveTarget(){
    const matches = []; // matches（目前符合的匯入用途）
    targets.forEach(target=>{
      if(target.page !== activePage) return;
      try{
        if(target.enabled()) matches.push(target);
      }catch(error){
        target.onError?.(error);
      }
    });
    if(matches.length === 1) return {status:'ready',target:matches[0]}; // ready（已有唯一用途）
    if(matches.length > 1) return {status:'ambiguous',target:null}; // ambiguous（用途不明確）
    return {status:'unavailable',target:null}; // unavailable（沒有可用用途）
  }

  // isFileDrag（判斷檔案拖曳）：一般文字拖曳不由匯入控制接管。
  function isFileDrag(event){
    const types = Array.from(event?.dataTransfer?.types || []); // types（拖曳資料種類）
    return types.includes('Files');
  }

  function getContentHost(){
    return document.getElementById('ma'); // ma（登入後整個應用程式可視區）
  }

  function isInside(host,event){
    if(!host || !event) return false;
    if(event.target && host.contains(event.target)) return true;
    const rect = host.getBoundingClientRect(); // rect（內容區可見範圍）
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  }

  function isInsideApplication(event){
    const application = document.getElementById('ma'); // application（登入後主介面）
    return !!activePage && !!application && !!event?.target && application.contains(event.target);
  }

  // ensureOverlay（建立提示層）：固定覆蓋目前可見內容區，不要求使用者對準小型方框。
  function ensureOverlay(){
    if(overlay?.isConnected) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'ui-file-drop-overlay';
    overlay.setAttribute('role','status');
    overlay.setAttribute('aria-live','polite');
    overlay.style.position = 'fixed';
    const icon = document.createElement('i'); // icon（全畫面匯入提示圖示）
    icon.className = 'ti ti-file-upload';
    icon.setAttribute('aria-hidden','true');
    overlayCopy = document.createElement('div');
    overlayCopy.className = 'ui-file-drop-copy';
    overlay.append(icon,overlayCopy);
    document.body.appendChild(overlay);
    return overlay;
  }

  function positionOverlay(){
    const host = getContentHost(); // host（主內容區）
    if(!host || !overlay) return false;
    const rect = host.getBoundingClientRect(); // rect（主內容區可見範圍）
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    return rect.width > 0 && rect.height > 0;
  }

  function showOverlay(target){
    const element = ensureOverlay(); // element（拖曳提示層）
    if(!positionOverlay()) return;
    if(textApi) textApi.set(overlayCopy,target?.text || 'fileDrop.dropAnywhere');
    element.classList.add('is-visible');
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(hideOverlay,160);
  }

  function hideOverlay(){
    clearTimeout(overlayTimer);
    overlayTimer = null;
    overlay?.classList.remove('is-visible');
  }

  // acceptsFile（檢查檔案格式）：空白格式清單代表由功能自己的檢查函式決定。
  function acceptsFile(file,accept){
    if(!accept.length) return true;
    const name = String(file?.name || '').toLowerCase(); // name（檔案名稱）
    const type = String(file?.type || '').toLowerCase(); // type（檔案類型）
    return accept.some(rule=>{
      if(rule.startsWith('.')) return name.endsWith(rule);
      if(rule.endsWith('/*')) return type.startsWith(rule.slice(0,-1));
      return type === rule;
    });
  }

  function rejection(status,message,target,files){
    const detail = Object.freeze({status,message,targetId:target?.id || '',page:activePage,files:Object.freeze(files.slice())}); // detail（拒絕原因資料）
    try{
      target?.onReject?.(detail);
    }catch(error){
      try{ target?.onError?.(error); }catch(_){}
    }
    try{
      if(typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('pcms:file-drop-rejected',{detail})); // pcms:file-drop-rejected（檔案拖曳遭拒事件）
    }catch(_){}
    return Object.freeze({accepted:false,...detail});
  }

  // receiveFiles（接收檔案）：只驗證並交給功能頁，絕不直接解析或寫入資料。
  async function receiveFiles(fileList,options = {}){
    const files = Array.from(fileList || []); // files（本次接收的檔案）
    const requestedTarget = options.targetId ? targets.get(String(options.targetId)) || null : null; // requestedTarget（指定的匯入用途）
    const resolved = requestedTarget && requestedTarget.page === activePage
      ? {status:'ready',target:requestedTarget}
      : options.targetId
        ? {status:'unavailable',target:null}
        : resolveActiveTarget(); // resolved（匯入用途解析結果）
    if(!resolved.target) return rejection(resolved.status,`fileDrop.${resolved.status}`,null,files);
    const target = resolved.target; // target（本次匯入用途）
    if(!files.length) return rejection('empty','fileDrop.unavailable',target,files); // empty（沒有檔案）
    if(files.length > target.maxFiles) return rejection('tooManyFiles','fileDrop.tooManyFiles',target,files); // tooManyFiles（檔案過多）
    if(files.some(file=>!acceptsFile(file,target.accept))) return rejection('invalidType','fileDrop.invalidType',target,files); // invalidType（格式不符）
    if(target.validate){
      try{
        const result = await target.validate(Object.freeze(files.slice())); // result（功能專屬檢查結果）
        if(result === false) return rejection('invalid','fileDrop.invalidType',target,files); // invalid（功能檢查不通過）
        if(result && typeof result === 'object' && result.ok === false) return rejection('invalid',result.message || 'fileDrop.invalidType',target,files);
      }catch(error){
        try{ target.onError?.(error); }catch(_){}
        return rejection('error',{vi:'Không thể kiểm tra tệp',zh:'無法檢查檔案'},target,files); // error（檢查失敗）
      }
    }
    try{
      await target.onDrop(Object.freeze(files.slice()),Object.freeze({page:activePage,targetId:target.id,source:options.source || 'drop'})); // drop（拖曳來源）
      return Object.freeze({accepted:true,status:'accepted',targetId:target.id,page:activePage,count:files.length}); // accepted（已交給功能頁）
    }catch(error){
      try{ target.onError?.(error); }catch(_){}
      return rejection('error',{vi:'Không thể xử lý tệp',zh:'無法處理檔案'},target,files); // error（處理失敗）
    }
  }

  function handleDragOver(event){
    if(!isFileDrag(event) || !isInsideApplication(event)) return;
    event.preventDefault();
    const host = getContentHost(); // host（主內容區）
    const resolved = resolveActiveTarget(); // resolved（目前匯入用途）
    if(isInside(host,event) && resolved.status === 'ready'){
      if(event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; // copy（複製檔案操作）
      showOverlay(resolved.target);
    }else{
      hideOverlay();
    }
  }

  async function handleDrop(event){
    if(!isFileDrag(event) || !isInsideApplication(event)) return;
    event.preventDefault();
    hideOverlay();
    const host = getContentHost(); // host（主內容區）
    if(!isInside(host,event)) return;
    const resolved = resolveActiveTarget(); // resolved（目前匯入用途）
    if(resolved.status !== 'ready'){
      await receiveFiles(event.dataTransfer?.files || []);
      return;
    }
    event.stopPropagation();
    await receiveFiles(event.dataTransfer?.files || [],{source:'drop'});
  }

  // activatePage（啟用頁面）：由中央頁面生命週期在進入功能時呼叫。
  function activatePage(pageName){
    activePage = String(pageName || '');
    hideOverlay();
    return activePage;
  }

  // deactivatePage（停用頁面）：離開頁面或登出時立即停止接收。
  function deactivatePage(pageName){
    if(pageName && String(pageName) !== activePage) return false;
    activePage = '';
    hideOverlay();
    return true;
  }

  document.addEventListener('dragover',handleDragOver);
  document.addEventListener('drop',handleDrop);
  document.addEventListener('dragleave',event=>{
    if(!event.relatedTarget) hideOverlay();
  });
  window.addEventListener('blur',hideOverlay);
  window.addEventListener('resize',()=>{ if(overlay?.classList.contains('is-visible')) positionOverlay(); });

  window.PCMSUIFileDrop = Object.freeze({ // PCMSUIFileDrop（全域拖曳匯入介面）
    register,
    unregister,
    activatePage,
    deactivatePage,
    receiveFiles,
    resolveActiveTarget,
    getActivePage:()=>activePage,
    listTargets:()=>Array.from(targets.values(),target=>({id:target.id,page:target.page,accept:target.accept.slice(),maxFiles:target.maxFiles}))
  });
})();
