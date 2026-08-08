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
  let toastSequence = 0; // toastSequence（共用短暫提示流水號）

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
    if(options.text){
      notice.appendChild(options.long === true
        ? createLanguageSections(options.text)
        : textApi.create(options.text,{tagName:'div'}));
    }
    return notice;
  }

  // getToastStack（取得共用短暫提示容器）：全系統只建立一個固定位置，不占用頁面排版空間。
  function getToastStack(){
    let stack = document.getElementById('ui-toast-stack'); // stack（共用短暫提示容器）
    if(stack) return stack;
    stack = document.createElement('div');
    stack.id = 'ui-toast-stack';
    stack.className = 'ui-toast-stack';
    stack.setAttribute('aria-live','polite');
    stack.setAttribute('aria-relevant','additions');
    document.body.appendChild(stack);
    return stack;
  }

  // showToast（顯示共用短暫提示）：適用於已確認完成的簡短成功結果，不取代錯誤或長時間工作進度。
  function showToast(options = {}){
    const kind = NOTICE_KINDS.has(options.kind) ? options.kind : 'success'; // kind（短暫提示種類）
    const durationMs = Math.max(1200,Number(options.durationMs) || 3200); // durationMs（自動收回時間）
    const stack = getToastStack(); // stack（共用短暫提示容器）
    const toast = createNotice({kind,text:options.text || options.message || {vi:'',zh:''},icon:options.icon}); // toast（短暫提示元件）
    const animate = window.requestAnimationFrame || (callback=>setTimeout(callback,0)); // animate（開始顯示動畫）
    let closeTimer = null; // closeTimer（自動收回計時器）
    let closed = false; // closed（提示是否已收回）
    toast.id = `ui-toast-${++toastSequence}`;
    toast.classList.add('ui-toast');

    function close(){
      if(closed) return false;
      closed = true;
      if(closeTimer) clearTimeout(closeTimer);
      toast.classList.add('is-leaving');
      setTimeout(()=>toast.remove(),180);
      return true;
    }

    function scheduleClose(){
      if(closed) return;
      if(closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(close,durationMs);
    }

    toast.addEventListener('pointerenter',()=>{
      if(closeTimer) clearTimeout(closeTimer);
    });
    toast.addEventListener('pointerleave',scheduleClose);
    while(stack.children.length >= 4) stack.firstElementChild?.remove();
    stack.appendChild(toast);
    animate(()=>toast.classList.add('is-visible'));
    scheduleClose();
    return Object.freeze({element:toast,close});
  }

  // createLanguageSections（建立長篇雙語區塊）：完整越文在前、完整中文在後，外觀不以字級或顏色區分。
  function createLanguageSections(value){
    const pair = textApi.resolve(value); // pair（長篇雙語內容）
    const host = document.createElement('div'); // host（長篇雙語容器）
    const vi = document.createElement('div'); // vi（完整越文區塊）
    const zh = document.createElement('div'); // zh（完整中文區塊）
    host.className = 'ui-language-sections';
    vi.className = 'ui-language-section is-vi';
    zh.className = 'ui-language-section is-zh';
    vi.textContent = pair.vi;
    zh.textContent = pair.zh;
    host.append(vi,zh);
    return host;
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

  // alertDialog（共用訊息視窗）：取代瀏覽器原生提示，長內容使用先越文後中文的完整區塊。
  function alertDialog(options = {}){
    const config = typeof options === 'object' && options !== null ? options : {message:options}; // config（訊息視窗設定）
    const kind = NOTICE_KINDS.has(config.kind) ? config.kind : 'info'; // kind（訊息種類）
    const titleKeys = {info:'common.warning',success:'common.success',warning:'common.warning',danger:'common.error'}; // titleKeys（訊息標題文字鍵）
    return new Promise(resolve=>{
      let settled = false; // settled（訊息視窗是否已關閉）
      const message = config.body && typeof config.body.nodeType === 'number'
        ? config.body
        : createLanguageSections(config.message || config.text || {vi:'',zh:''}); // message（訊息內容）
      openDialog({
        title:config.title || titleKeys[kind],
        body:message,
        size:config.size,
        actions:[{text:'common.close',kind:kind === 'danger' ? 'danger' : '' ,onClick:()=>{ settled = true; resolve(true); }}],
        onClose:()=>{ if(!settled) resolve(true); }
      });
    });
  }

  // promptDialog（共用輸入視窗）：以非阻塞視窗取代瀏覽器原生輸入框。
  function promptDialog(options = {}){
    return new Promise(resolve=>{
      let settled = false; // settled（輸入結果是否已決定）
      const field = document.createElement('div'); // field（輸入欄位容器）
      const input = document.createElement(options.multiline === true ? 'textarea' : 'input'); // input（輸入元件）
      field.className = 'ui-dialog-field';
      if(options.label) field.appendChild(textApi.create(options.label,{tagName:'label'}));
      if(input.tagName === 'INPUT') input.type = String(options.type || 'text');
      input.value = String(options.value ?? '');
      if(options.placeholder) input.placeholder = textApi.assistiveLabel(options.placeholder);
      if(Number.isFinite(Number(options.maxLength))) input.maxLength = Number(options.maxLength);
      field.appendChild(input);
      openDialog({
        title:options.title || 'common.confirm',
        body:field,
        actions:[
          {text:'common.cancel',onClick:()=>{ settled = true; resolve(null); }},
          {text:'common.confirm',kind:'primary',onClick:()=>{
            const value = input.value; // value（使用者輸入內容）
            if(typeof options.validate === 'function' && options.validate(value,input) === false) return false;
            settled = true;
            resolve(value);
            return true;
          }}
        ],
        onClose:()=>{ if(!settled) resolve(null); }
      });
      setTimeout(()=>input.focus(),0);
    });
  }

  // progressDialog（共用長時間工作進度視窗）：功能程式只提供進度與文字，元件負責一致顯示。
  function progressDialog(options = {}){
    const body = document.createElement('div'); // body（進度內容容器）
    const messageHost = document.createElement('div'); // messageHost（目前工作文字）
    const track = document.createElement('div'); // track（進度軌道）
    const bar = document.createElement('div'); // bar（進度色條）
    const detailHost = document.createElement('div'); // detailHost（進度補充文字）
    body.className = 'ui-progress';
    track.className = 'ui-progress-track';
    bar.className = 'ui-progress-bar';
    detailHost.className = 'ui-progress-status';
    track.appendChild(bar);
    body.append(messageHost,track,detailHost);
    const dialog = openDialog({
      title:options.title || 'common.processing',
      body,
      closeOnEscape:options.allowClose === true,
      closeOnBackdrop:false,
      actions:options.allowClose === true ? [{text:'common.close'}] : [],
      onClose:options.onClose
    }); // dialog（進度視窗控制介面）

    function setPair(host,value,long=false){
      if(!value){ host.replaceChildren(); return; }
      host.replaceChildren(long ? createLanguageSections(value) : textApi.create(value));
    }

    function update(state = {}){
      const value = Math.max(0,Math.min(100,Number(state.value) || 0)); // value（百分比進度）
      body.classList.toggle('is-indeterminate',state.indeterminate === true);
      body.classList.toggle('is-success',state.kind === 'success');
      body.classList.toggle('is-danger',state.kind === 'danger');
      if(state.indeterminate !== true) bar.style.width = `${value}%`;
      if(state.text) setPair(messageHost,state.text,state.long === true);
      if(state.detail !== undefined) setPair(detailHost,state.detail,state.detailLong === true);
      return controller;
    }

    const controller = Object.freeze({ // controller（共用進度控制介面）
      element:dialog.element,
      update,
      close:dialog.close,
      complete:(text,detail)=>update({value:100,text,detail,kind:'success'}),
      fail:(text,detail)=>update({value:100,text,detail,kind:'danger'})
    });
    update({value:options.value,text:options.text,detail:options.detail,indeterminate:options.indeterminate === true});
    return controller;
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
    showToast,
    createLanguageSections,
    openDialog,
    confirmDialog,
    alertDialog,
    promptDialog,
    progressDialog,
    createOtherActions,
    isActionRunning,
    runActionOnce,
    closeActiveDialog:()=>activeDialog?.close('program') || false // program（由程式關閉）
  });
})();
