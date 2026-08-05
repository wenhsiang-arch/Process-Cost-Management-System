// PCMS Safe DOM（系統安全顯示工具）：所有外部文字進入 HTML（網頁標記）前必須經過此處理。
(function(){
  const HTML_REPLACEMENTS = Object.freeze({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;',
    '`':'&#96;'
  }); // HTML_REPLACEMENTS（網頁特殊字元替換表）

  function text(value){
    return String(value ?? '').replace(/[&<>"'`]/g, character=>HTML_REPLACEMENTS[character]);
  }

  function attribute(value){
    return text(value).replace(/[\r\n\u2028\u2029]/g,' ');
  }

  function escapeRegExp(value){
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }

  function highlight(value, query){
    const source=String(value ?? '');
    const keyword=String(query ?? '');
    if(!keyword) return text(source);
    const matcher=new RegExp(escapeRegExp(keyword),'gi'); // matcher（安全搜尋比對器）
    let cursor=0;
    let html='';
    source.replace(matcher,(match,offset)=>{
      html+=text(source.slice(cursor,offset));
      html+=`<span class="hl">${text(match)}</span>`;
      cursor=offset+match.length;
      return match;
    });
    return html+text(source.slice(cursor));
  }

  function lines(value){
    return text(value).replace(/\r?\n/g,'<br>');
  }

  function errorMessage(error,maxLength=500){
    const raw=String(error?.message ?? error ?? '');
    return text(raw.slice(0,Math.max(0,Number(maxLength)||0)));
  }

  // inlineArgument（行內事件安全參數）：舊畫面逐步移除行內事件前，統一保護字串參數。
  function inlineArgument(value){
    return attribute(JSON.stringify(String(value ?? '')));
  }

  window.PCMSSafe=Object.freeze({
    text,
    attribute,
    highlight,
    lines,
    errorMessage,
    inlineArgument
  });
})();
