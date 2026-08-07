// ui-components.js（共用介面元件）：安全建立雙語按鈕、提示、視窗與低頻操作入口。
(function(){
  const textApi = window.PCMSUIText; // textApi（共用雙語文字介面）
  if(!textApi){
    console.error('Không thể khởi tạo thành phần giao diện / 無法初始化共用介面元件');
    return;
  }

  const BUTTON_KINDS = new Set(['primary','danger']); // BUTTON_KINDS（按鈕樣式種類）
  const NOTICE_KINDS = new Set(['info','success','warning','danger']); // NOTICE_KINDS（提示樣式種類）
  const DISMISSIBLE_DETAILS_SELECTOR = 'details[data-ui-dismiss-outside]'; // DISMISSIBLE_DETAILS_SELECTOR（可點擊外部關閉的展開元件選擇器）
  const CONTENT_DISMISSIBLE_DETAILS_SELECTOR = 'details[data-ui-dismiss-on-content]'; // CONTENT_DISMISSIBLE_DETAILS_SELECTOR（可點擊內容關閉的純閱讀元件選擇器）
  const activeActions = new Map(); // activeActions（執行中的共用操作）：同一操作鍵只允許一個非同步工作。
  let activeDialog = null; // activeDialog（目前開啟的共用視窗）
  let dialogSequence = 0; // dialogSequence（共用視窗流水號）

  // closeDismissibleDetails（關閉展開元件）：保留使用者目前正在操作的內容，其餘開啟項目一律收回。
  function closeDismissibleDetails(except = null){
    let firstSummary = null; // firstSummary（第一個被關閉元件的原始按鈕）
    document.querySelectorAll(`${DISMISSIBLE_DETAILS_SELECTOR}[open]`).forEach(details=>{
      if(details === except) return;
      if(!firstSummary) firstSummary = details.querySelector('summary');
      details.removeAttribute('open');
    });
    return firstSummary;
  }

  document.addEventListener('pointerdown',event=>{
    const current = event.target?.closest?.(DISMISSIBLE_DETAILS_SELECTOR); // current（本次點擊所在的展開元件）
    const clickedSummary = event.target?.closest?.('summary'); // clickedSummary（本次是否點擊展開按鈕）
    if(current?.matches(CONTENT_DISMISSIBLE_DETAILS_SELECTOR) && !clickedSummary){
      current.removeAttribute('open');
      closeDismissibleDetails();
      return;
    }
    closeDismissibleDetails(current || null);
  });

  document.addEventListener('keydown',event=>{
    if(event.key !== 'Escape') return;
    const summary = closeDismissibleDetails(); // summary（關閉後要恢復焦點的展開按鈕）
    if(!summary) return;
    event.preventDefault();
    summary.focus();
  });

  // createIcon（建立圖示）：只設定樣式名稱，不插入外部網頁標記。
  function createIcon(iconName){
    const name = String(iconName || '').trim(); // name（圖示樣式名稱）
    if(!name) return null;
    const icon = document.createElement('i'); // icon（圖示元件）
    icon.className = name.startsWith('ti ') ? name : `ti ${name}`;
    icon.setAttribute('aria-hidden','true');
    return icon;
  }

  // createButton（建立雙語按鈕）：固定以越文在上、中文在下呈現。
  function createButton(options = {}){
    const button = document.createElement('button'); // button（按鈕元件）
    const kind = BUTTON_KINDS.has(options.kind) ? options.kind : ''; // kind（按鈕樣式種類）
    button.type = String(options.type || 'button');
    button.className = `ui-button is-bilingual${kind ? ` is-${kind}` : ''}`;
    button.disabled = options.disabled === true;
    if(options.id) button.id = String(options.id);
    if(options.title) button.title = textApi.assistiveLabel(options.title);
    if(options.text) button.setAttribute('aria-label',textApi.assistiveLabel(options.text));
    const icon = createIcon(options.icon); // icon（按鈕圖示）
    if(icon) button.appendChild(icon);
    if(options.text) button.appendChild(textApi.create(options.text));
    if(typeof options.onClick === 'function') button.addEventListener('click',options.onClick);
    return button;
  }

  // createNotice（建立雙語提示）：訊息內容只透過文字節點加入。
  function createNotice(options = {}){
    const kind = NOTICE_KINDS.has(options.kind) ? options.kind : 'info'; // kind（提示樣式種類）
    const notice = document.createElement('div'); // notice（提示元件）
    notice.className = `ui-notice${kind === 'info' ? '' : ` is-${kind}`}`;
    notice.setAttribute('role',kind === 'danger' ? 'alert' : 'status');
    const iconNames = {info:'ti-info-circle',success:'ti-circle-check',warning:'ti-alert-triangle',danger:'ti-alert-circle'}; // iconNames（提示圖示表）
    const icon = createIcon(options.icon || iconNames[kind]); // icon（提示圖示）
    if(icon) notice.appendChild(icon);
    if(options.text) notice.appendChild(textApi.create(options.text,{tagName:'div'}));
    return notice;
  }

  // appendDialogContent（加入視窗內容）：接受網頁節點或雙語文字，不接受網頁字串。
  function appendDialogContent(host,content){
    if(!host || content === null || content === undefined) return;
    if(Array.isArray(content)){
      content.forEach(item=>appendDialogContent(host,item));
      return;
    }
    if(typeof content === 'object' && typeof content.nodeType === 'number'){
      host.appendChild(content);
      return;
    }
    host.appendChild(textApi.create(content,{tagName:'div'}));
  }

  // getFocusableElements（取得可操作元件）：用於限制鍵盤焦點留在視窗內。
  function getFocusableElements(dialog){
    return Array.from(dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'));
  }

  // openDialog（開啟共用視窗）：同一時間只保留一個共用視窗，關閉後回到原焦點。
  function openDialog(options = {}){
    if(activeDialog) activeDialog.close('replace'); // replace（由新視窗取代）
    const previousFocus = document.activeElement; // previousFocus（開啟前的焦點）
    const backdrop = document.createElement('div'); // backdrop（視窗遮罩）
    const dialog = document.createElement('section'); // dialog（視窗本體）
    const header = document.createElement('header'); // header（視窗標題區）
    const body = document.createElement('div'); // body（視窗內容區）
    const actions = document.createElement('footer'); // actions（視窗操作區）
    const titleId = `pcms-ui-dialog-title-${++dialogSequence}`; // titleId（視窗標題識別碼）
    let closed = false; // closed（視窗是否已關閉）

    backdrop.className = 'ui-dialog-backdrop';
    dialog.className = `ui-dialog${options.size === 'large' ? ' is-large' : ''}`;
    header.className = 'ui-dialog-header';
    body.className = 'ui-dialog-body';
    actions.className = 'ui-dialog-actions';
    dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    dialog.setAttribute('aria-labelledby',titleId);
    dialog.setAttribute('tabindex','-1');
    const title = textApi.create(options.title || 'common.warning',{tagName:'h2'}); // title（視窗雙語標題）
    title.id = titleId;
    header.appendChild(title);
    appendDialogContent(body,options.body || options.message);
    dialog.append(header,body,actions);
    backdrop.appendChild(dialog);

    function close(reason = 'close'){
      if(closed) return false;
      closed = true;
      document.removeEventListener('keydown',handleKeydown,true);
      backdrop.remove();
      if(activeDialog === controller) activeDialog = null;
      if(previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected) previousFocus.focus();
      if(typeof options.onClose === 'function') options.onClose(reason);
      return true;
    }

    function handleKeydown(event){
      if(event.key === 'Escape' && options.closeOnEscape !== false){
        event.preventDefault();
        close('escape'); // escape（按下離開鍵）
        return;
      }
      if(event.key !== 'Tab') return;
      const focusable = getFocusableElements(dialog); // focusable（視窗內可操作元件）
      if(!focusable.length){
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]; // first（第一個可操作元件）
      const last = focusable[focusable.length - 1]; // last（最後一個可操作元件）
      if(event.shiftKey && document.activeElement === first){ event.preventDefault(); last.focus(); }
      else if(!event.shiftKey && document.activeElement === last){ event.preventDefault(); first.focus(); }
    }

    const controller = Object.freeze({ // controller（共用視窗控制介面）
      element:backdrop,
      dialog,
      body,
      close
    });

    (options.actions || []).forEach(action=>{
      const button = createButton({
        text:action.text,
        icon:action.icon,
        kind:action.kind,
        disabled:action.disabled
      }); // button（視窗操作按鈕）
      button.addEventListener('click',async event=>{
        if(button.disabled) return;
        button.disabled = true;
        try{
          const result = typeof action.onClick === 'function' ? await action.onClick({event,controller}) : true; // result（操作結果）
          if(result !== false && action.close !== false) close(action.value || 'action'); // action（按鈕操作）
        }catch(error){
          if(typeof options.onError === 'function') options.onError(error);
          else console.error('Lỗi thao tác cửa sổ / 視窗操作失敗',error);
        }finally{
          if(button.isConnected) button.disabled = action.disabled === true;
        }
      });
      actions.appendChild(button);
    });

    if(!(options.actions || []).length) actions.hidden = true;
    backdrop.addEventListener('mousedown',event=>{
      if(event.target === backdrop && options.closeOnBackdrop !== false) close('backdrop'); // backdrop（點擊遮罩）
    });
    dialog.addEventListener('mousedown',()=>{
      if(options.closeOnContent === true) close('content'); // content（點擊純閱讀內容）
    });
    document.addEventListener('keydown',handleKeydown,true);
    (options.host || document.body).appendChild(backdrop);
    activeDialog = controller;
    const firstFocus = getFocusableElements(dialog)[0] || dialog; // firstFocus（視窗初始焦點）
    firstFocus.focus();
    return controller;
  }

  // confirmDialog（共用確認視窗）：回傳使用者是否確認，不使用瀏覽器原生確認框。
  function confirmDialog(options = {}){
    return new Promise(resolve=>{
      let settled = false; // settled（確認結果是否已決定）
      openDialog({
        title:options.title || 'common.confirm',
        body:options.body || options.message,
        size:options.size,
        actions:[
          {text:'common.cancel',onClick:()=>{ settled = true; resolve(false); }},
          {text:'common.confirm',kind:'primary',onClick:()=>{ settled = true; resolve(true); }}
        ],
        onClose:()=>{ if(!settled) resolve(false); }
      });
    });
  }

  // createOtherActions（建立其他操作入口）：把低頻操作收進共用視窗，避免主操作區過度擁擠。
  function createOtherActions(options = {}){
    return createButton({
      text:options.text || 'common.otherActions',
      icon:options.icon || 'ti-chevron-down',
      onClick:()=>openDialog({
        title:options.title || 'common.otherActions',
        body:options.body,
        size:options.size,
        actions:[...(options.actions || []),{text:'common.close'}],
        onError:options.onError
      })
    });
  }

  // isActionRunning（檢查共用操作是否執行中）：功能頁可在開啟下一個流程前阻止重複入口。
  function isActionRunning(key){
    return activeActions.has(String(key || '').trim());
  }

  // runActionOnce（執行一次共用操作）：短暫鎖定按鈕，但操作鍵會保留到實際工作結束。
  function runActionOnce(key, task, options = {}){
    const actionKey = String(key || '').trim(); // actionKey（共用操作識別鍵）
    if(!actionKey || typeof task !== 'function'){
      return Promise.reject(new Error('Thiếu khóa hoặc tác vụ dùng chung. / 缺少共用操作鍵或工作。'));
    }
    const current = activeActions.get(actionKey); // current（目前執行中的相同工作）
    if(current){
      if(typeof options.onDuplicate === 'function'){
        try{ options.onDuplicate(current); }
        catch(error){ console.error('Không thể hiển thị trạng thái thao tác / 無法顯示操作狀態',error); }
      }
      return current;
    }

    const controls = Array.from(options.controls || []).filter(control=>control && 'disabled' in control); // controls（需要短暫鎖定的操作元件）
    const controlStates = controls.map(control=>({control,disabled:control.disabled})); // controlStates（操作元件原始停用狀態）
    controls.forEach(control=>{ control.disabled = true; });
    const cooldownMs = Math.max(0,Number(options.cooldownMs) || 0); // cooldownMs（按鈕防連點時間）
    let controlsRestored = false; // controlsRestored（操作元件是否已復原）
    const restoreControls = ()=>{
      if(controlsRestored) return;
      controlsRestored = true;
      controlStates.forEach(({control,disabled})=>{
        if(control.isConnected !== false) control.disabled = disabled;
      });
    }; // restoreControls（復原操作元件）
    if(cooldownMs > 0) setTimeout(restoreControls,cooldownMs);
    else restoreControls();

    const pending = Promise.resolve().then(task); // pending（本次共用非同步工作）
    activeActions.set(actionKey,pending);
    const release = ()=>{
      if(activeActions.get(actionKey) === pending) activeActions.delete(actionKey);
    }; // release（釋放共用操作鍵）
    pending.then(release,release);
    return pending;
  }

  window.PCMSUIComponents = Object.freeze({ // PCMSUIComponents（共用介面元件介面）
    createButton,
    createNotice,
    openDialog,
    confirmDialog,
    createOtherActions,
    isActionRunning,
    runActionOnce,
    closeActiveDialog:()=>activeDialog?.close('program') || false // program（由程式關閉）
  });
})();
