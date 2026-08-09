// ui-table.js（共用表格控制）：讓超寬表格在主內容可視底部提供同步水平捲軸。
(function(){
  const TABLE_SCROLL_SELECTOR = '.ui-table-scroll'; // TABLE_SCROLL_SELECTOR（正式表格水平捲動區）
  const FLOATING_ONLY_CLASS = 'is-ui-floating-only'; // FLOATING_ONLY_CLASS（浮動捲軸接管原始捲軸的狀態）
  const MIN_OVERFLOW_PX = 2; // MIN_OVERFLOW_PX（判定超寬的最小差距）
  const FALLBACK_BAR_HEIGHT = 18; // FALLBACK_BAR_HEIGHT（浮動捲軸預設備用高度）
  let activePageName = ''; // activePageName（目前套用共用表格控制的頁面）
  let activePage = null; // activePage（目前功能頁元件）
  let scrollHost = null; // scrollHost（頁面主捲動區）
  let floatingScroll = null; // floatingScroll（浮動水平捲軸）
  let floatingSpacer = null; // floatingSpacer（提供完整水平距離的空白內容）
  let activeTarget = null; // activeTarget（目前與浮動捲軸同步的表格捲動區）
  let frameId = 0; // frameId（等待中的畫面更新工作）
  let resizeObserver = null; // resizeObserver（尺寸變更觀察器）
  let mutationObserver = null; // mutationObserver（表格結構變更觀察器）
  let observedTargets = new Set(); // observedTargets（目前監聽的表格捲動區）
  let syncingScroll = false; // syncingScroll（避免雙向捲動重複觸發）

  function viewportSize(){
    return {
      width:Math.max(Number(window.innerWidth)||0,Number(document.documentElement?.clientWidth)||0),
      height:Math.max(Number(window.innerHeight)||0,Number(document.documentElement?.clientHeight)||0)
    };
  }

  function ensureFloatingScroll(){
    if(floatingScroll?.isConnected) return floatingScroll;
    floatingScroll = document.createElement('div');
    floatingScroll.className = 'ui-table-floating-scroll';
    floatingScroll.dataset.uiTableFloatingScroll = 'true';
    floatingScroll.setAttribute('aria-hidden','true');
    floatingScroll.tabIndex = -1;
    floatingSpacer = document.createElement('div');
    floatingSpacer.className = 'ui-table-floating-scroll-spacer';
    floatingScroll.appendChild(floatingSpacer);
    floatingScroll.addEventListener('scroll',()=>{
      if(!activeTarget || syncingScroll) return;
      syncingScroll = true;
      activeTarget.scrollLeft = floatingScroll.scrollLeft;
      syncingScroll = false;
    },{passive:true});
    document.body.appendChild(floatingScroll);
    return floatingScroll;
  }

  function releaseActiveTarget(){
    activeTarget?.classList?.remove?.(FLOATING_ONLY_CLASS);
  }

  function hideFloatingScroll(){
    releaseActiveTarget();
    activeTarget = null;
    if(floatingSpacer) floatingSpacer.style.width = '0px';
    if(!floatingScroll) return;
    floatingScroll.classList.remove('is-visible');
    floatingScroll.setAttribute('aria-hidden','true');
    floatingScroll.scrollLeft = 0;
  }

  function isHidden(element){
    return !element?.isConnected || element.hidden === true || Boolean(element.closest?.('[hidden]'));
  }

  function isHorizontalScroller(element){
    if(isHidden(element) || element.dataset?.uiFloatingScroll === 'off') return false;
    if(Number(element.scrollWidth) <= Number(element.clientWidth) + MIN_OVERFLOW_PX) return false;
    const overflowX = String(window.getComputedStyle?.(element)?.overflowX || '');
    return overflowX === 'auto' || overflowX === 'scroll';
  }

  function isFloatingOnly(element){
    return element?.dataset?.uiFloatingScroll === 'only';
  }

  function visibleContentRect(){
    if(!scrollHost?.isConnected) return null;
    const rect = scrollHost.getBoundingClientRect();
    const viewport = viewportSize();
    const left = Math.max(0,rect.left);
    const top = Math.max(0,rect.top);
    const right = Math.min(viewport.width,rect.left + Number(scrollHost.clientWidth || rect.width || 0));
    const bottom = Math.min(viewport.height,rect.top + Number(scrollHost.clientHeight || rect.height || 0));
    if(right <= left || bottom <= top) return null;
    return {left,top,right,bottom,width:right-left,height:bottom-top};
  }

  function refreshObservedTargets(){
    if(!activePage) return [];
    const latest = new Set(Array.from(activePage.querySelectorAll(TABLE_SCROLL_SELECTOR)));
    observedTargets.forEach(target=>{
      if(latest.has(target)) return;
      target.removeEventListener('scroll',handleTargetScroll);
      resizeObserver?.unobserve?.(target);
    });
    latest.forEach(target=>{
      if(observedTargets.has(target)) return;
      target.addEventListener('scroll',handleTargetScroll,{passive:true});
      resizeObserver?.observe?.(target);
    });
    observedTargets = latest;
    return Array.from(latest);
  }

  function chooseTarget(contentRect){
    const candidates = refreshObservedTargets()
      .filter(isHorizontalScroller)
      .map(element=>({element,rect:element.getBoundingClientRect(),floatingOnly:isFloatingOnly(element)}))
      .filter(item=>item.rect.top < contentRect.bottom-FALLBACK_BAR_HEIGHT
        && item.rect.bottom > contentRect.top
        && (item.floatingOnly || item.rect.bottom > contentRect.bottom+1))
      .sort((left,right)=>right.rect.top-left.rect.top);
    return candidates[0] || null;
  }

  function handleTargetScroll(event){
    if(event.currentTarget !== activeTarget || !floatingScroll || syncingScroll) return;
    syncingScroll = true;
    floatingScroll.scrollLeft = activeTarget.scrollLeft;
    syncingScroll = false;
  }

  function update(){
    frameId = 0;
    if(!activePage?.classList?.contains('active') || !scrollHost){
      hideFloatingScroll();
      return;
    }
    const contentRect = visibleContentRect();
    if(!contentRect){
      hideFloatingScroll();
      return;
    }
    const candidate = chooseTarget(contentRect);
    if(!candidate){
      hideFloatingScroll();
      return;
    }
    const bar = ensureFloatingScroll();
    const left = Math.max(contentRect.left,candidate.rect.left);
    const right = Math.min(contentRect.right,candidate.rect.right);
    const width = Math.max(0,right-left);
    if(width <= FALLBACK_BAR_HEIGHT*2){
      hideFloatingScroll();
      return;
    }
    if(activeTarget !== candidate.element) releaseActiveTarget();
    activeTarget = candidate.element;
    floatingSpacer.style.width = `${Math.max(activeTarget.scrollWidth,width)}px`;
    bar.style.left = `${left}px`;
    bar.style.width = `${width}px`;
    const barHeight = Number(bar.offsetHeight) || FALLBACK_BAR_HEIGHT;
    const visibleBottom = candidate.floatingOnly ? Math.min(contentRect.bottom,candidate.rect.bottom) : contentRect.bottom;
    bar.style.top = `${Math.max(contentRect.top,visibleBottom-barHeight)}px`;
    bar.scrollLeft = activeTarget.scrollLeft;
    bar.classList.add('is-visible');
    bar.setAttribute('aria-hidden','false');
    activeTarget.classList?.toggle?.(FLOATING_ONLY_CLASS,candidate.floatingOnly);
  }

  function scheduleUpdate(){
    if(frameId) return;
    frameId = window.requestAnimationFrame(update);
  }

  function stopObservers(){
    resizeObserver?.disconnect?.();
    mutationObserver?.disconnect?.();
    resizeObserver = null;
    mutationObserver = null;
    observedTargets.forEach(target=>target.removeEventListener('scroll',handleTargetScroll));
    observedTargets.clear();
  }

  function deactivatePage(pageName){
    if(pageName && activePageName && pageName !== activePageName) return;
    scrollHost?.removeEventListener('scroll',scheduleUpdate);
    window.removeEventListener('resize',scheduleUpdate);
    window.visualViewport?.removeEventListener('resize',scheduleUpdate);
    window.visualViewport?.removeEventListener('scroll',scheduleUpdate);
    stopObservers();
    if(frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
    activePageName = '';
    activePage = null;
    scrollHost = null;
    hideFloatingScroll();
  }

  function activatePage(pageName){
    deactivatePage();
    const name = String(pageName || '');
    const page = document.getElementById(`pg-${name}`);
    const mainScroll = page?.closest?.('.ct');
    if(!page || !mainScroll) return false;
    activePageName = name;
    activePage = page;
    scrollHost = mainScroll;
    resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleUpdate) : null;
    mutationObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(scheduleUpdate)
      : null;
    resizeObserver?.observe?.(scrollHost);
    resizeObserver?.observe?.(activePage);
    mutationObserver?.observe?.(activePage,{
      subtree:true,
      childList:true,
      attributes:true,
      attributeFilter:['class','hidden','style']
    });
    scrollHost.addEventListener('scroll',scheduleUpdate,{passive:true});
    window.addEventListener('resize',scheduleUpdate);
    window.visualViewport?.addEventListener('resize',scheduleUpdate);
    window.visualViewport?.addEventListener('scroll',scheduleUpdate);
    refreshObservedTargets();
    scheduleUpdate();
    return true;
  }

  window.PCMSUITable = Object.freeze({ // PCMSUITable（共用表格控制介面）
    activatePage,
    deactivatePage,
    refresh:scheduleUpdate
  });
})();
