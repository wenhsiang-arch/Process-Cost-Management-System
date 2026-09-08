// home-updates（首頁歷史公告）：只在使用者要求時讀取同站年度靜態檔，不存取業務資料。
(function(){
  'use strict';
  const cache=new Map(); // cache（當次頁面記憶體）：公開公告不建立帳號偏好或持久快取。
  let pending=null,controller=null,generation=0;
  const byId=id=>document.getElementById(id);
  const text=(target,pair)=>window.PCMSUIText.set(target,pair);

  function busy(value){
    byId('home-updates-load').disabled=value;
    byId('home-updates-year').disabled=value;
    if(value) byId('home-updates-load').setAttribute('aria-busy','true');
    else byId('home-updates-load').removeAttribute('aria-busy');
  }

  // validateArchive（驗證年度檔）：先完整核對再顯示，不以半份內容覆蓋已載入公告。
  function validateArchive(data,year){
    const string=value=>typeof value==='string'&&value.length<=30000;
    const list=values=>Array.isArray(values)&&values.length<=200&&values.every(string);
    const section=value=>value&&string(value.heading)
      &&(value.items===undefined||list(value.items))
      &&(value.paragraphs===undefined||list(value.paragraphs))
      &&((value.items?.length||0)+(value.paragraphs?.length||0)>0);
    if(data?.schemaVersion!==1||data.year!==Number(year)||!Array.isArray(data.entries)||data.entries.length>500) throw new Error('invalid-archive');
    const dates=new Set([...document.querySelectorAll('#home-updates-latest-list time[datetime]')].map(node=>node.getAttribute('datetime')));
    for(const entry of data.entries){
      if(!entry||typeof entry.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)||!entry.date.startsWith(year+'-')||dates.has(entry.date)) throw new Error('invalid-date');
      const date=new Date(entry.date+'T00:00:00Z');
      if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==entry.date) throw new Error('invalid-date');
      dates.add(entry.date);
      for(const language of ['vi','zh']){
        if(!string(entry.title?.[language])||!entry.title[language].trim()||!Array.isArray(entry.sections?.[language])||!entry.sections[language].length||entry.sections[language].length>40||!entry.sections[language].every(section)) throw new Error('invalid-copy');
      }
    }
    return [...data.entries].sort((a,b)=>b.date.localeCompare(a.date));
  }

  function element(tag,className,value){
    const node=document.createElement(tag);
    if(className) node.className=className;
    if(value!==undefined) node.textContent=value;
    return node;
  }

  // render（呈現公告）：全部文字使用文字節點，不把年度檔內容當作網頁程式執行。
  function render(entries,year){
    const fragment=document.createDocumentFragment();
    for(const entry of entries){
      const article=element('article','home-update-item');
      const marker=element('div','home-update-marker');
      marker.setAttribute('aria-hidden','true');
      marker.append(element('i','ti ti-check'));
      const content=element('div','home-update-content');
      const date=element('time','home-update-date',entry.date.split('-').reverse().join('/'));
      date.setAttribute('datetime',entry.date);
      const title=element('h2','ui-dual-copy');
      text(title,entry.title);
      const description=element('div','home-update-description');
      for(const language of ['vi','zh']){
        const block=element('div','home-update-language-block ui-text-'+language);
        block.setAttribute('lang',language==='vi'?'vi':'zh-Hant');
        for(const source of entry.sections[language]){
          const topic=element('section','home-update-topic');
          if(source.heading) topic.append(element('h3','',source.heading));
          for(const paragraph of source.paragraphs||[]) topic.append(element('p','',paragraph));
          if(source.items?.length){
            const list=element('ol');
            for(const item of source.items) list.append(element('li','',item));
            topic.append(list);
          }
          block.append(topic);
        }
        description.append(block);
      }
      content.append(date,title,description);
      article.append(marker,content);
      fragment.append(article);
    }
    byId('home-updates-archive-list').replaceChildren(fragment);
    text(byId('home-updates-archive-title'),{vi:'Cập nhật trước — '+year,zh:'較早更新 — '+year});
    byId('home-updates-archive').hidden=false;
    byId('home-updates-load').setAttribute('aria-expanded','true');
    if(entries.length) byId('home-updates-status').replaceChildren();
    else text(byId('home-updates-status'),{vi:'Không có cập nhật trước trong năm này.',zh:'這個年度沒有較早公告。'});
  }

  function show(){
    if(pending) return pending;
    const option=byId('home-updates-year').selectedOptions[0];
    const year=option?.value,version=option?.dataset.version;
    if(!/^\d{4}$/.test(year||'')||!/^\d{8}-\d+$/.test(version||'')){
      text(byId('home-updates-status'),{vi:'Năm cập nhật không hợp lệ.',zh:'公告年度設定無效。'});
      return Promise.resolve(false);
    }
    const key=year+'|'+version;
    if(cache.has(key)){render(cache.get(key),year);return Promise.resolve(true);}
    const requestGeneration=++generation;
    const requestController=new AbortController();
    controller=requestController;
    busy(true);
    text(byId('home-updates-status'),{vi:'Đang tải cập nhật…',zh:'正在載入更新…'});
    const timeout=setTimeout(()=>requestController.abort(),10000);
    pending=(async()=>{
      try{
        const response=await fetch(new URL('data/home-updates/'+year+'.json?v='+version,document.baseURI).href,{signal:requestController.signal,credentials:'same-origin',cache:'default'});
        if(!response.ok) throw new Error('archive-unavailable');
        const source=await response.text();
        if(source.length>2000000) throw new Error('archive-too-large');
        const entries=validateArchive(JSON.parse(source),year);
        if(requestGeneration!==generation) return false;
        render(entries,year);
        cache.set(key,entries);
        return true;
      }catch(error){
        if(requestGeneration===generation) text(byId('home-updates-status'),{vi:'Không thể tải. Vui lòng nhấn lại để thử.',zh:'載入失敗，請再次點擊重試。'});
        return false;
      }finally{
        clearTimeout(timeout);
        if(requestGeneration===generation){pending=null;controller=null;busy(false);}
      }
    })();
    return pending;
  }

  function leave(){
    generation++;
    controller?.abort();
    controller=null;
    pending=null;
    busy(false);
    byId('home-updates-status').replaceChildren();
  }

  window.PCMSHomeUpdates=Object.freeze({show,leave});
})();
