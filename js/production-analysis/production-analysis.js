// production-analysis.js（生產分析主畫面）：管理三個分析分頁與共用的雙語說明視窗。
(function(){
  'use strict';

  const controllers=new Map();
  let activeTab='employee';
  let rangeLoadTimer=0;
  let rangeLoadSerial=0;

  function text(value){ return String(value??'').trim(); }
  function number(value){
    const result=Number(value);
    return Number.isFinite(result)?result:null;
  }
  function dual(vi,zh){
    return `<span class="ui-dual-copy"><strong>${vi}</strong><span>${zh}</span></span>`;
  }
  function localDateString(value){
    const date=value instanceof Date?value:new Date(value);
    if(!Number.isFinite(date.getTime())) return '';
    const year=date.getFullYear();
    const month=String(date.getMonth()+1).padStart(2,'0');
    const day=String(date.getDate()).padStart(2,'0');
    return `${year}-${month}-${day}`;
  }
  function dateObject(value){
    const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match) return null;
    const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),12);
    return date.getFullYear()===Number(match[1])&&date.getMonth()===Number(match[2])-1&&date.getDate()===Number(match[3])?date:null;
  }
  function dateField(scope,filter,vi,zh){
    const id=`production-analysis-${scope}-${filter}`;
    const maximum=localDateString(new Date());
    return `<div class="ui-form-field production-analysis-date-field">
      <div class="production-analysis-date-label-row">
        <label for="${id}">${dual(vi,zh)}</label>
        <button type="button" tabindex="-1" class="production-analysis-calendar-button" data-analysis-date-calendar aria-label="Mở lịch ${vi} / 開啟${zh}" title="Mở lịch ${vi} / 開啟${zh}"><i class="ti ti-calendar-time" aria-hidden="true"></i></button>
      </div>
      <div class="production-analysis-date-control">
        <input type="date" id="${id}" data-filter="${filter}" data-analysis-date-input max="${maximum}">
        <div class="production-analysis-date-stepper" aria-label="Chuyển ${vi} / 切換${zh}">
          <button type="button" tabindex="-1" data-analysis-date-step="previous" aria-label="Ngày trước / 前一天" title="Ngày trước / 前一天"><i class="ti ti-chevron-up" aria-hidden="true"></i></button>
          <button type="button" tabindex="-1" data-analysis-date-step="next" aria-label="Ngày sau / 後一天" title="Ngày sau / 後一天"><i class="ti ti-chevron-down" aria-hidden="true"></i></button>
        </div>
      </div>
    </div>`;
  }
  function bindDateControls(root){
    const fields=[...root.querySelectorAll('.production-analysis-date-field')];
    function sync(){
      const maximum=localDateString(new Date());
      fields.forEach(field=>{
        const input=field.querySelector('[data-analysis-date-input]');
        const next=field.querySelector('[data-analysis-date-step="next"]');
        if(!input) return;
        input.max=maximum;
        if(input.value>maximum) input.value=maximum;
        if(next) next.disabled=!input.value||input.value>=maximum;
      });
    }
    function shift(field,days){
      const input=field.querySelector('[data-analysis-date-input]');
      if(!input) return;
      const maximum=localDateString(new Date());
      const value=dateObject(input.value||maximum);
      if(!value) return;
      value.setDate(value.getDate()+days);
      const nextValue=localDateString(value);
      if(days>0&&nextValue>maximum) return;
      input.value=nextValue;
      sync();
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    fields.forEach(field=>{
      const input=field.querySelector('[data-analysis-date-input]');
      const calendar=field.querySelector('[data-analysis-date-calendar]');
      const previous=field.querySelector('[data-analysis-date-step="previous"]');
      const next=field.querySelector('[data-analysis-date-step="next"]');
      calendar?.addEventListener('click',()=>{
        input?.focus({preventScroll:true});
        if(typeof input?.showPicker==='function') input.showPicker();
        else input?.click();
      });
      previous?.addEventListener('click',()=>shift(field,-1));
      next?.addEventListener('click',()=>shift(field,1));
      input?.addEventListener('input',sync);
      input?.addEventListener('keydown',event=>{
        if(event.key!=='ArrowUp'&&event.key!=='ArrowDown') return;
        event.preventDefault();
        shift(field,event.key==='ArrowUp'?-1:1);
      });
    });
    sync();
    return Object.freeze({sync});
  }
  function format(value,digits=2,suffix=''){
    const result=number(value);
    return result===null?'—':`${result.toLocaleString('zh-TW',{minimumFractionDigits:digits,maximumFractionDigits:digits})}${suffix}`;
  }
  function percent(value){ return format(value,2,'%'); }
  function hours(value){ return format(value,2,' h'); }
  function seconds(value){ return format(value,2,' s'); }
  function integer(value){
    const result=number(value);
    return result===null?'—':Math.round(result).toLocaleString('zh-TW');
  }
  function dateRangeLabel(fromDate,toDate){
    if(fromDate&&toDate) return fromDate===toDate?fromDate:`${fromDate} ～ ${toDate}`;
    if(fromDate) return `${fromDate} ～`;
    if(toDate) return `～ ${toDate}`;
    return 'Toàn bộ lịch sử / 全部歷史';
  }
  function uniqueSorted(values){
    return [...new Set(values.map(text).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'vi',{numeric:true}));
  }
  function fillSelect(select,values,allVi='Tất cả',allZh='全部'){
    if(!select) return;
    const current=select.value;
    select.replaceChildren();
    const all=document.createElement('option');
    all.value='';
    all.textContent=`${allVi} / ${allZh}`;
    select.appendChild(all);
    values.forEach(value=>{
      const option=document.createElement('option');
      option.value=value;
      option.textContent=value;
      select.appendChild(option);
    });
    if([...select.options].some(option=>option.value===current)) select.value=current;
  }
  function appendLanguageSection(host,title,body,language){
    const section=document.createElement('section');
    section.className='production-analysis-dialog-section';
    const heading=document.createElement('h3');
    heading.textContent=title;
    const content=document.createElement('div');
    content.className='production-analysis-dialog-copy';
    content.textContent=body;
    section.dataset.language=language;
    section.append(heading,content);
    host.appendChild(section);
  }
  function openExplanation(options={}){
    const body=document.createElement('div');
    body.className='production-analysis-dialog-content';
    appendLanguageSection(body,'Hướng dẫn cho người sử dụng',options.userVi||'', 'vi');
    appendLanguageSection(body,'使用者說明',options.userZh||'', 'zh');
    appendLanguageSection(body,'計算內容（管理者查看）',options.formulaZh||'', 'formula');
    return window.PCMSUIComponents.openDialog({
      title:{vi:options.titleVi||'Giải thích dữ liệu',zh:options.titleZh||'資料說明'},
      body,size:'large',
      actions:[{text:{vi:'Đóng',zh:'關閉'}}]
    });
  }
  async function showError(error){
    await window.PCMSUIComponents.alertDialog({
      kind:'danger',
      message:{
        vi:'Không thể tải dữ liệu phân tích sản xuất. Vui lòng thử lại.',
        zh:`無法載入生產分析資料，請重試。${error?.message?`（${error.message}）`:''}`
      }
    });
  }
  function refreshTableTools(){
    window.PCMSUITableControls?.refreshPage?.();
    window.PCMSUITable?.refresh?.();
  }
  function latestDate(dataset){
    return dataset?.days?.reduce((latest,item)=>item.date>latest?item.date:latest,'')||'';
  }
  function earliestDate(dataset){
    return dataset?.days?.reduce((earliest,item)=>!earliest||item.date<earliest?item.date:earliest,'')||'';
  }
  function createCell(value,className=''){
    const cell=document.createElement('td');
    if(className) cell.className=className;
    cell.textContent=String(value??'');
    return cell;
  }
  function createDualCell(value,className=''){
    const cell=document.createElement('td');
    if(className) cell.className=className;
    cell.appendChild(window.PCMSUIText.create(value));
    return cell;
  }
  function createDualButton(vi,zh,icon,className='ui-button is-bilingual'){
    const button=document.createElement('button');
    button.type='button';
    button.className=className;
    if(icon){
      const iconElement=document.createElement('i');
      iconElement.className=`ti ${icon}`;
      button.appendChild(iconElement);
    }
    const copy=document.createElement('span');
    copy.className='ui-dual-copy';
    const viCopy=document.createElement('strong');
    const zhCopy=document.createElement('span');
    viCopy.textContent=vi;
    zhCopy.textContent=zh;
    copy.append(viCopy,zhCopy);
    button.appendChild(copy);
    return button;
  }
  function setSourceLabel(target,metadata={}){
    if(!target) return;
    const local=metadata.source==='indexeddb'; // local（是否使用目前 UID 的本機快取）
    window.PCMSUIText.set(target,local
      ? {vi:'Nguồn dữ liệu: Bộ nhớ máy này',zh:'資料來源：本機快取'}
      : {vi:'Nguồn dữ liệu: Dữ liệu đám mây',zh:'資料來源：雲端資料'});
  }
  function setTab(name){
    if(!controllers.has(name)) return;
    activeTab=name;
    document.querySelectorAll('#production-analysis-tabs [data-analysis-tab]').forEach(button=>{
      const selected=button.dataset.analysisTab===name;
      button.classList.toggle('is-active',selected);
      button.setAttribute('aria-selected',selected?'true':'false');
    });
    document.querySelectorAll('#production-analysis-root [data-analysis-view]').forEach(view=>{
      view.hidden=view.dataset.analysisView!==name;
    });
    const controller=controllers.get(name);
    controller?.activate?.();
    const range=controller?.dataRange?.();
    if(range?.fromDate||range?.toDate) requestDataRange(range);
    refreshTableTools();
  }
  function applyDataset(result){
    controllers.forEach(controller=>controller.setData(result.dataset,{source:result.source,loadedAt:result.loadedAt}));
  }
  // handleProcessSecondsSaved（處理本視窗正式秒數修改完成）：重新解析相同原始摘要，不回寫舊產能。
  async function handleProcessSecondsSaved(result,range={}){
    const store=window.PCMSProductionAnalysisStore;
    const root=document.getElementById('production-analysis-root');
    root?.classList.add('is-loading');
    try{
      store.resetCurrentStandards();
      const loaded=await store.load({force:true,fromDate:range.fromDate,toDate:range.toDate});
      applyDataset(loaded);
    }catch(error){
      console.error('Không thể nạp lại dữ liệu sau khi sửa mã hàng / 款號修改後無法重載資料',error);
      window.PCMSUIComponents?.showToast?.({kind:'warning',text:{
        vi:'Đã lưu dữ liệu mới, nhưng cần mở lại phân tích để cập nhật màn hình.',
        zh:'新資料已儲存，但需要重新開啟分析以更新畫面。'
      }});
    }finally{
      root?.classList.remove('is-loading');
    }
    controllers.get('ie')?.refreshCurrentStandards?.();
  }
  function requestDataRange(range={}){
    if(rangeLoadTimer) clearTimeout(rangeLoadTimer);
    rangeLoadTimer=setTimeout(async()=>{
      rangeLoadTimer=0;
      const serial=++rangeLoadSerial;
      const root=document.getElementById('production-analysis-root');
      root?.classList.add('is-loading');
      try{
        const result=await window.PCMSProductionAnalysisStore.load({fromDate:range.fromDate,toDate:range.toDate});
        if(serial!==rangeLoadSerial) return;
        applyDataset(result);
        controllers.get(activeTab)?.activate?.();
      }catch(error){
        if(serial!==rangeLoadSerial) return;
        console.error('Lỗi tải phạm vi phân tích / 分析日期範圍載入失敗',error);
        await showError(error);
      }finally{
        if(serial===rangeLoadSerial) root?.classList.remove('is-loading');
      }
    },120);
  }
  function ensureShell(root){
    if(root.dataset.ready==='true') return;
    root.innerHTML=`
      <div class="production-analysis-page ui-work-panel">
        <div class="ui-tabs ui-page-tabs production-analysis-tabs" id="production-analysis-tabs" role="tablist" aria-label="Phân tích sản xuất / 生產分析">
          <button type="button" class="ui-tab is-active" data-analysis-tab="employee" role="tab" aria-selected="true">${dual('Phân tích nhân viên','員工分析')}</button>
          <button type="button" class="ui-tab" data-analysis-tab="ie" role="tab" aria-selected="false">${dual('Phân tích công đoạn','工序分析')}</button>
          <button type="button" class="ui-tab" data-analysis-tab="department" role="tab" aria-selected="false">${dual('Hiệu suất bộ phận','部門效率')}</button>
        </div>
        <section data-analysis-view="employee" id="production-analysis-employee-view"></section>
        <section data-analysis-view="ie" id="production-analysis-ie-view" hidden></section>
        <section data-analysis-view="department" id="production-analysis-department-view" hidden></section>
      </div>`;
    root.querySelector('#production-analysis-tabs').addEventListener('click',event=>{
      const button=event.target.closest('[data-analysis-tab]');
      if(button) setTab(button.dataset.analysisTab);
    });
    const controllerOptions={onDateRangeChange:requestDataRange,onProcessSecondsSaved:handleProcessSecondsSaved};
    controllers.set('employee',window.PCMSProductionEmployeeAnalysis.create(root.querySelector('#production-analysis-employee-view'),controllerOptions));
    controllers.set('ie',window.PCMSProductionIEAnalysis.create(root.querySelector('#production-analysis-ie-view'),controllerOptions));
    controllers.set('department',window.PCMSProductionDepartmentAnalysis.create(root.querySelector('#production-analysis-department-view'),controllerOptions));
    root.dataset.ready='true';
  }
  async function productionAnalysisInit(options={}){
    const root=document.getElementById('production-analysis-root');
    if(!root) return;
    ensureShell(root);
    if(options.force===true){
      window.PCMSProductionAnalysisStore.resetCurrentStandards({revalidate:true});
      controllers.get('ie')?.invalidateCurrentStandards?.();
    }
    root.classList.add('is-loading');
    try{
      const result=await window.PCMSProductionAnalysisStore.load({force:options.force===true});
      applyDataset(result);
      setTab(activeTab);
    }catch(error){
      console.error('Lỗi tải phân tích sản xuất / 生產分析載入失敗',error);
      await showError(error);
    }finally{
      root.classList.remove('is-loading');
    }
  }
  function productionAnalysisLeave(){
    if(rangeLoadTimer) clearTimeout(rangeLoadTimer);
    rangeLoadTimer=0;
    rangeLoadSerial+=1;
    controllers.forEach(controller=>controller.leave?.());
    window.PCMSProductionAnalysisStore?.resetCurrentStandards?.({revalidate:true});
  }

  window.PCMSProductionAnalysisUI=Object.freeze({
    dual,format,percent,hours,seconds,integer,dateRangeLabel,uniqueSorted,fillSelect,
    openExplanation,showError,refreshTableTools,latestDate,earliestDate,createCell,createDualCell,createDualButton,setSourceLabel,
    dateField,bindDateControls,text
  });
  window.PCMSProductionAnalysis=Object.freeze({init:productionAnalysisInit,leave:productionAnalysisLeave,setTab});
  window.productionAnalysisInit=productionAnalysisInit;
  window.productionAnalysisLeave=productionAnalysisLeave;
})();
