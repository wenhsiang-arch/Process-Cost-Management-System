// production-analysis.js（生產分析主畫面）：管理三個分析分頁與共用的雙語說明視窗。
(function(){
  'use strict';

  const controllers=new Map();
  let activeTab='employee';

  function text(value){ return String(value??'').trim(); }
  function number(value){
    const result=Number(value);
    return Number.isFinite(result)?result:null;
  }
  function dual(vi,zh){
    return `<span class="ui-dual-copy"><strong>${vi}</strong><span>${zh}</span></span>`;
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
    controllers.get(name)?.activate?.();
    refreshTableTools();
  }
  function ensureShell(root){
    if(root.dataset.ready==='true') return;
    root.innerHTML=`
      <div class="production-analysis-page ui-work-panel">
        <div class="ui-tabs ui-page-tabs production-analysis-tabs" id="production-analysis-tabs" role="tablist" aria-label="Phân tích sản xuất / 生產分析">
          <button type="button" class="ui-tab is-active" data-analysis-tab="employee" role="tab" aria-selected="true">${dual('Phân tích nhân viên','員工分析')}</button>
          <button type="button" class="ui-tab" data-analysis-tab="ie" role="tab" aria-selected="false">${dual('Phân tích IE','IE 分析')}</button>
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
    controllers.set('employee',window.PCMSProductionEmployeeAnalysis.create(root.querySelector('#production-analysis-employee-view')));
    controllers.set('ie',window.PCMSProductionIEAnalysis.create(root.querySelector('#production-analysis-ie-view')));
    controllers.set('department',window.PCMSProductionDepartmentAnalysis.create(root.querySelector('#production-analysis-department-view')));
    root.dataset.ready='true';
  }
  async function productionAnalysisInit(options={}){
    const root=document.getElementById('production-analysis-root');
    if(!root) return;
    ensureShell(root);
    root.classList.add('is-loading');
    try{
      const result=await window.PCMSProductionAnalysisStore.load({force:options.force===true});
      controllers.forEach(controller=>controller.setData(result.dataset,{source:result.source,loadedAt:result.loadedAt}));
      setTab(activeTab);
    }catch(error){
      console.error('Lỗi tải phân tích sản xuất / 生產分析載入失敗',error);
      await showError(error);
    }finally{
      root.classList.remove('is-loading');
    }
  }
  function productionAnalysisLeave(){
    controllers.forEach(controller=>controller.leave?.());
  }

  window.PCMSProductionAnalysisUI=Object.freeze({
    dual,format,percent,hours,seconds,integer,dateRangeLabel,uniqueSorted,fillSelect,
    openExplanation,showError,refreshTableTools,latestDate,earliestDate,createCell,createDualButton,text
  });
  window.PCMSProductionAnalysis=Object.freeze({init:productionAnalysisInit,leave:productionAnalysisLeave,setTab});
  window.productionAnalysisInit=productionAnalysisInit;
  window.productionAnalysisLeave=productionAnalysisLeave;
})();
