// ui-search-dropdown（共用搜尋下拉程式）：統一智慧比對、結果排序、鍵盤及開關行為。
(function(){
  'use strict';

  const controllers = new Set(); // controllers（目前頁面已建立的搜尋下拉控制器）

  function text(value){
    return String(value ?? '').trim().replace(/\s+/g,' ');
  }

  function normalizeSearchText(value){
    return text(value)
      .normalize('NFKC')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/[Đđ]/g,'d')
      .toLocaleLowerCase();
  }

  function compactSearchText(value){
    return normalizeSearchText(value).replace(/[^\p{L}\p{N}]+/gu,'');
  }

  function orderedSubsequenceScore(query,target){
    let queryIndex = 0;
    let previousTargetIndex = -1;
    let gapScore = 0;
    for(let targetIndex=0;targetIndex<target.length&&queryIndex<query.length;targetIndex+=1){
      if(target[targetIndex] !== query[queryIndex]) continue;
      if(previousTargetIndex >= 0) gapScore += targetIndex-previousTargetIndex-1;
      previousTargetIndex = targetIndex;
      queryIndex += 1;
    }
    return queryIndex === query.length ? gapScore : Number.POSITIVE_INFINITY;
  }

  function shortLetterDigitCodeScore(query,target){
    if(!/^\p{L}\p{N}$/u.test(query) || target[0] !== query[0]) return Number.POSITIVE_INFINITY;
    const digitIndex = target.indexOf(query[1],1); // digitIndex（數字位置）：H1 可找到以 H 開頭且後段含 1 的款號。
    return digitIndex >= 1 ? digitIndex : Number.POSITIVE_INFINITY;
  }

  function scoreText(query,value,mode='text'){
    const needle = normalizeSearchText(query);
    const candidate = normalizeSearchText(value);
    if(!needle) return 0;
    if(!candidate) return Number.POSITIVE_INFINITY;
    if(candidate === needle) return 0;
    if(candidate.startsWith(needle)) return 100+candidate.length-needle.length;
    if(mode === 'numeric') return Number.POSITIVE_INFINITY;
    const containedIndex = candidate.indexOf(needle);
    if(containedIndex >= 0) return 200+containedIndex;

    const compactNeedle = compactSearchText(needle);
    const compactCandidate = compactSearchText(candidate);
    if(!compactNeedle || !compactCandidate) return Number.POSITIVE_INFINITY;
    if(compactCandidate === compactNeedle) return 300;
    if(compactCandidate.startsWith(compactNeedle)) return 400+compactCandidate.length-compactNeedle.length;
    const compactIndex = compactCandidate.indexOf(compactNeedle);
    if(compactIndex >= 0) return 500+compactIndex;
    if(mode === 'code' && compactNeedle.length === 2){
      const shortCodeScore = shortLetterDigitCodeScore(compactNeedle,compactCandidate);
      if(Number.isFinite(shortCodeScore)) return 580+shortCodeScore;
    }
    if(mode !== 'code' || compactNeedle.length < 3) return Number.POSITIVE_INFINITY;
    const sequenceScore = orderedSubsequenceScore(compactNeedle,compactCandidate);
    if(!Number.isFinite(sequenceScore)) return Number.POSITIVE_INFINITY;
    const trailingPart = compactNeedle.slice(1); // trailingPart（首字元後的連續代碼）：例如 B20 優先排列含 20 的款號。
    const trailingBonus = trailingPart.length >= 2 && compactCandidate.includes(trailingPart) ? -40 : 0;
    return 600+sequenceScore+trailingBonus;
  }

  function fieldDefinition(field,defaultMode){
    if(typeof field === 'string') return {value:item=>item?.[field],mode:defaultMode,weight:0};
    if(typeof field === 'function') return {value:field,mode:defaultMode,weight:0};
    return {
      value:typeof field?.value === 'function' ? field.value : item=>item?.[field?.key],
      mode:field?.mode || defaultMode,
      weight:Number(field?.weight) || 0
    };
  }

  function matchItems(items,query,options={}){
    const source = Array.from(items || []);
    const maximum = Math.max(1,Math.min(Number(options.limit) || 20,100));
    const needle = text(query);
    if(!needle) return {items:source.slice(0,maximum),total:source.length};
    const fields = (Array.isArray(options.fields)&&options.fields.length ? options.fields : [item=>item])
      .map(field=>fieldDefinition(field,options.mode || 'text'));
    const ranked = [];
    source.forEach((item,index)=>{
      let bestScore = Number.POSITIVE_INFINITY;
      fields.forEach(field=>{
        const fieldScore = scoreText(needle,field.value(item),field.mode);
        if(Number.isFinite(fieldScore)) bestScore = Math.min(bestScore,fieldScore+field.weight);
      });
      if(Number.isFinite(bestScore)) ranked.push({item,index,score:bestScore});
    });
    ranked.sort((left,right)=>left.score-right.score||left.index-right.index);
    return {items:ranked.slice(0,maximum).map(entry=>entry.item),total:ranked.length};
  }

  function isExact(query,value,options={}){
    const left = options.compact === true ? compactSearchText(query) : normalizeSearchText(query);
    const right = options.compact === true ? compactSearchText(value) : normalizeSearchText(value);
    return Boolean(left&&right&&left === right);
  }

  function resolveElement(value){
    if(value instanceof Element) return value;
    return typeof value === 'string' ? document.querySelector(value) : null;
  }

  function createCopyBlock(copy){
    const fragment = document.createDocumentFragment();
    const primary = document.createElement('strong');
    primary.textContent = String(copy?.primary || '');
    fragment.appendChild(primary);
    if(copy?.secondary){
      const secondary = document.createElement('span');
      secondary.textContent = String(copy.secondary);
      fragment.appendChild(secondary);
    }
    return fragment;
  }

  function createMessage(copy,className){
    const message = document.createElement('div');
    message.className = className;
    const vi = document.createElement('span');
    vi.className = 'ui-text-vi';
    vi.textContent = String(copy?.vi || '');
    const zh = document.createElement('span');
    zh.className = 'ui-text-zh';
    zh.textContent = String(copy?.zh || '');
    message.append(vi,zh);
    return message;
  }

  function create(options={}){
    const input = resolveElement(options.input);
    const toggle = resolveElement(options.toggle);
    const list = resolveElement(options.list);
    const root = resolveElement(options.root) || input?.closest('.ui-search-dropdown-control');
    if(!input || !toggle || !list || !root){
      throw new Error('Thiếu thành phần danh sách tìm kiếm. / 缺少搜尋下拉元件。');
    }

    list.classList.add('ui-search-dropdown-options');
    const listeners = [];
    let currentMatches = [];
    let currentTotal = 0;
    let activeIndex = -1;
    let destroyed = false;
    let controller;
    let selectAllOnClick = false; // selectAllOnClick（本次點擊是否全選）：第一次點擊方便直接取代，再次點擊可放置游標。

    const listen = (target,type,handler,settings)=>{
      target.addEventListener(type,handler,settings);
      listeners.push(()=>target.removeEventListener(type,handler,settings));
    };
    const getItems = ()=>Array.from(options.getItems?.() || []);
    const enabled = ()=>!destroyed&&toggle.disabled!==true&&options.isEnabled?.()!==false;
    const expanded = value=>{
      input.setAttribute('aria-expanded',String(value));
      toggle.setAttribute('aria-expanded',String(value));
    };
    const closeOthers = ()=>controllers.forEach(item=>{ if(item !== controller) item.close(); });

    function close(){
      list.hidden = true;
      activeIndex = -1;
      list.querySelectorAll('.ui-search-dropdown-option').forEach(option=>{
        option.classList.remove('is-keyboard-active');
        option.setAttribute('aria-selected','false');
      });
      expanded(false);
    }

    function selectItem(item){
      if(!item) return false;
      close();
      void Promise.resolve(options.onSelect?.(item));
      return true;
    }

    function setActive(index){
      if(!currentMatches.length) return false;
      activeIndex = Math.max(0,Math.min(index,currentMatches.length-1));
      list.querySelectorAll('.ui-search-dropdown-option').forEach((option,optionIndex)=>{
        const active = optionIndex === activeIndex;
        option.classList.toggle('is-keyboard-active',active);
        option.setAttribute('aria-selected',String(active));
        if(active) option.scrollIntoView({block:'nearest'});
      });
      return true;
    }

    function resultFor(query,limit=options.limit){
      return matchItems(getItems(),query,{
        fields:options.fields,
        mode:options.mode,
        limit:limit || 20
      });
    }

    function render(optionsOverride={}){
      const query = text(input.value);
      const showAll = optionsOverride.showAll === true;
      if(!enabled() || (!query&&!showAll)){
        close();
        return [];
      }
      closeOthers();
      const result = resultFor(showAll&&!query ? '' : query);
      currentMatches = result.items;
      currentTotal = result.total;
      activeIndex = -1;
      list.replaceChildren();
      currentMatches.forEach((item,index)=>{
        const button = document.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.className = 'ui-search-dropdown-option';
        button.setAttribute('role','option');
        button.setAttribute('aria-selected','false');
        button.dataset.optionIndex = String(index);
        const copy = options.renderItem?.(item) || {primary:String(item ?? '')};
        button.appendChild(createCopyBlock(copy));
        if(!copy.secondary) button.classList.add('is-single-line');
        button.addEventListener('mousedown',event=>event.preventDefault());
        button.addEventListener('click',()=>selectItem(item));
        list.appendChild(button);
      });
      if(!currentMatches.length){
        list.appendChild(createMessage(
          options.emptyText || {vi:'Không tìm thấy dữ liệu phù hợp.',zh:'找不到符合資料。'},
          'ui-search-dropdown-empty'
        ));
      }else if(currentTotal > currentMatches.length){
        const remaining = currentTotal-currentMatches.length;
        list.appendChild(createMessage(
          options.moreText?.(remaining) || {
            vi:`Còn ${remaining} kết quả. Vui lòng nhập thêm ký tự.`,
            zh:`另有 ${remaining} 筆結果，請繼續輸入。`
          },
          'ui-search-dropdown-more'
        ));
      }
      list.hidden = false;
      expanded(true);
      return currentMatches.slice();
    }

    function handleInput(){
      const proceed = options.onInput?.(input.value,controller);
      if(proceed === false){ close(); return; }
      if(text(input.value)) render();
      else close();
    }

    function handleFocus(){
      if(text(input.value)) render();
    }

    function handleInputMouseDown(event){
      const value = String(input.value || '');
      const alreadyFullySelected = document.activeElement === input
        && input.selectionStart === 0 && input.selectionEnd === value.length;
      selectAllOnClick = event.button === 0 && Boolean(text(value)) && !alreadyFullySelected;
    }

    function handleInputClick(event){
      const shouldSelect = selectAllOnClick;
      selectAllOnClick = false;
      if(event.button !== 0 || !shouldSelect) return;
      input.select();
    }

    function handleToggle(){
      const wasOpen = list.hidden === false;
      input.focus({preventScroll:true});
      if(!enabled()) return;
      if(wasOpen){ close(); return; }
      render({showAll:!text(input.value)});
    }

    function handleKeydown(event){
      if(event.key === 'Escape'){
        close();
        return;
      }
      if(event.key === 'ArrowDown' || event.key === 'ArrowUp'){
        event.preventDefault();
        if(list.hidden) render({showAll:!text(input.value)});
        if(!currentMatches.length) return;
        const next = activeIndex < 0
          ? (event.key === 'ArrowDown' ? 0 : currentMatches.length-1)
          : activeIndex+(event.key === 'ArrowDown' ? 1 : -1);
        setActive(next);
        return;
      }
      const forwardTab = event.key === 'Tab' && !event.shiftKey;
      if(event.key !== 'Enter' && !forwardTab) return;
      if(event.key === 'Enter' && activeIndex >= 0 && selectItem(currentMatches[activeIndex])){
        event.preventDefault();
        return;
      }
      const query = text(input.value);
      const uniqueResult = query ? resultFor(query,2) : {items:[],total:0};
      if(uniqueResult.total === 1 && selectItem(uniqueResult.items[0])){
        // Tab（定位鍵）保留瀏覽器或功能頁既有的往後移動；Enter（確認鍵）只完成本次唯一選項。
        if(event.key === 'Enter') event.preventDefault();
        return;
      }
      if(forwardTab) return;
      if(typeof options.onConfirm === 'function'){
        const confirmed = options.onConfirm(controller,event);
        if(confirmed !== false) event.preventDefault();
      }
    }

    controller = Object.freeze({
      input,toggle,list,root,
      close,
      open:settings=>render({showAll:settings?.showAll === true}),
      refresh:()=>render({showAll:!text(input.value)}),
      matches:(query=input.value,limit=100)=>resultFor(query,limit).items,
      total:()=>currentTotal,
      isOpen:()=>list.hidden === false,
      select:item=>selectItem(item),
      destroy:()=>{
        if(destroyed) return;
        destroyed = true;
        close();
        listeners.splice(0).forEach(remove=>remove());
        controllers.delete(controller);
      }
    });

    listen(input,'input',handleInput);
    listen(input,'focus',handleFocus);
    listen(input,'mousedown',handleInputMouseDown);
    listen(input,'click',handleInputClick);
    listen(input,'keydown',handleKeydown);
    listen(toggle,'click',handleToggle);
    listen(document,'click',event=>{
      if(!root.contains(event.target)) close();
    });
    controllers.add(controller);
    return controller;
  }

  function closeAll(){ controllers.forEach(controller=>controller.close()); }

  window.PCMSUISearchDropdown = Object.freeze({
    create,closeAll,matchItems,isExact,normalizeSearchText,compactSearchText,scoreText
  });
})();
