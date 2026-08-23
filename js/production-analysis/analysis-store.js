// analysis-store（生產分析資料存取程式）：只讀所需月份摘要，分析結果在瀏覽器直接計算。
(function(){
  'use strict';

  const MONTH_STATE_COLLECTION='productionMonths';
  const MEMORY_FRESH_MS=60000;
  const MAX_RANGE_MONTHS=24;
  const DEFAULT_LOOKBACK_MONTHS=12;
  let state={loaded:false,source:'',dataset:null,monthRows:[],processStats:[],months:[],rangeKey:'',loadedAt:0,pendingProcessDays:false};
  let loadPromise=null;
  let currentStandards=new Map();

  function text(value){ return String(value??'').trim(); }
  function number(value){ const result=Number(value);return Number.isFinite(result)?result:0; }
  function cloneRows(rows){ return (rows||[]).map(item=>({...item,days:{...(item.days||{})}})); }
  function standardKey(productId,processId){ return `${text(productId)}||${text(processId)}`; }
  function monthText(value){
    const match=text(value).match(/^(\d{4})-(\d{2})/);
    return match?`${match[1]}-${match[2]}`:'';
  }
  function currentMonth(){
    const now=new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  function previousMonth(month){
    const match=monthText(month).match(/^(\d{4})-(\d{2})$/);
    if(!match) return '';
    const date=new Date(Number(match[1]),Number(match[2])-2,1,12);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  }
  function monthsBetween(fromMonth,toMonth){
    let first=monthText(fromMonth)||currentMonth();
    let last=monthText(toMonth)||first;
    if(first>last) [first,last]=[last,first];
    const months=[];
    let cursor=first;
    while(cursor&&cursor<=last&&months.length<=MAX_RANGE_MONTHS){
      months.push(cursor);
      const [year,month]=cursor.split('-').map(Number);
      const next=new Date(year,month,1,12);
      cursor=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`;
    }
    if(months.length>MAX_RANGE_MONTHS){
      throw new Error('Khoảng phân tích tối đa là 24 tháng. / 分析日期範圍最多 24 個月。');
    }
    return months;
  }
  function requestFor(options={}){
    const fromDate=text(options.fromDate);
    const toDate=text(options.toDate);
    const fromMonth=monthText(fromDate||toDate)||currentMonth();
    const toMonth=monthText(toDate||fromDate)||fromMonth;
    const months=monthsBetween(fromMonth,toMonth);
    return {fromDate,toDate,months,key:`${months.join(',')}|${fromDate}|${toDate}`};
  }

  function standardFromSample(sample){
    const productId=text(sample?.productId);
    const processId=text(sample?.processId);
    const processSeconds=number(sample?.processSeconds);
    if(!productId||!processId||!(processSeconds>0)) return null;
    return {
      productId,processId,productCode:text(sample.productCode),processNo:text(sample.processNo),
      processNameVi:text(sample.processNameVi),processNameZh:text(sample.processNameZh),
      processSeconds,hourlyCapacity:number(sample.hourlyCapacity),active:true
    };
  }

  function publishStandardMetrics(metrics){
    const finishedAt=Date.now();
    const result=Object.freeze({
      ...metrics,
      clientReadCount:0,rulesDependentReadCount:0,
      finishedAt,elapsedMs:Math.max(0,finishedAt-metrics.startedAt)
    });
    window.lastProductionIEStandardReadMetrics=result;
    return result;
  }

  async function loadCurrentStandards(options={}){
    const dataset=options.dataset||state.dataset;
    currentStandards=new Map();
    (dataset?.processSamples||[]).forEach(sample=>{
      const standard=standardFromSample(sample);
      if(standard) currentStandards.set(standardKey(standard.productId,standard.processId),standard);
    });
    const metrics=publishStandardMetrics({source:'resolved-product-master',keyCount:currentStandards.size,
      metaReadCount:0,metaRequestCount:0,standardReadCount:0,queryCount:0,fullProductReadCount:0,startedAt:Date.now()});
    return {standards:new Map([...currentStandards].map(([key,value])=>[key,{...value}])),source:'resolved-product-master',metrics,keyCount:currentStandards.size};
  }

  function applyCurrentProducts(items){
    if((items||[]).length) currentStandards=new Map();
  }

  function resetCurrentStandards(){
    currentStandards=new Map();
  }
  async function readControl(month,metrics){
    const snapshot=await window._getDoc(window._docRef(MONTH_STATE_COLLECTION,month));
    metrics.controlReadCount+=1;
    return snapshot.exists()?{id:month,...snapshot.data(),month}:null;
  }
  async function readControls(request,options,metrics){
    const controls=await Promise.all(request.months.map(month=>readControl(month,metrics)));
    const unavailable=request.months.filter((month,index)=>controls[index]?.summaryReady!==true);
    if(!unavailable.length) return controls;
    if(request.fromDate||request.toDate){
      throw new Error(`Chưa có tóm tắt tháng: ${unavailable.join(', ')}. / 月份摘要尚未完成：${unavailable.join('、')}。`);
    }
    let cursor=request.months[0];
    for(let count=1;count<DEFAULT_LOOKBACK_MONTHS;count+=1){
      cursor=previousMonth(cursor);
      if(!cursor) break;
      const control=await readControl(cursor,metrics);
      if(control?.summaryReady===true){
        request.months=[cursor];
        request.key=`${cursor}||`;
        return [control];
      }
    }
    throw new Error('Chưa có tóm tắt tháng có thể phân tích. / 尚無可供分析的月份摘要。');
  }
  async function loadMonths(controls,options,metrics){
    const summaryStore=window.PCMSProductionSummaries;
    if(!summaryStore?.loadEmployeeMonths){
      throw new Error('Bộ nhớ tóm tắt tháng chưa sẵn sàng. / 月摘要快取程式尚未載入。');
    }
    const groups=await Promise.all(controls.map(async control=>{
      const month=text(control.month||control.id);
      const sourceVersion=text(control.summaryVersion)||'0';
      let readMetrics={source:'indexeddb',versionReadCount:0,documentReadCount:0};
      const monthRows=await summaryStore.loadEmployeeMonths(month,{
        version:sourceVersion,
        onMetrics:value=>{ readMetrics=value; }
      });
      metrics.versionReadCount+=Number(readMetrics.versionReadCount)||0;
      metrics.employeeMonthReadCount+=Number(readMetrics.documentReadCount)||0;
      return {
        source:readMetrics.source,
        rows:monthRows.filter(item=>item.summaryComplete===true).map(item=>({...item,month}))
      };
    }));
    return {
      rows:groups.flatMap(group=>group.rows),
      cloudMonthCount:groups.filter(group=>group.source==='cloud').length
    };
  }
  function getState(){
    return {...state,months:[...state.months],monthRows:cloneRows(state.monthRows),
      processStats:(state.processStats||[]).map(item=>({...item}))};
  }
  function buildState(rows,request,source,metrics){
    const calculations=window.PCMSProductionAnalysisCalculations;
    const dataset=calculations.buildDatasetFromMonthSummaries(rows,{fromDate:request.fromDate,toDate:request.toDate});
    const loadedAt=Date.now();
    state={loaded:true,source,dataset,monthRows:cloneRows(rows),processStats:dataset.processStats,
      months:[...request.months],rangeKey:request.key,loadedAt,pendingProcessDays:false};
    window.lastProductionAnalysisReadMetrics=Object.freeze({
      source,selectedMonths:[...request.months],controlReadCount:metrics.controlReadCount,
      versionReadCount:metrics.versionReadCount,reloadedMonthCount:metrics.reloadedMonthCount,
      employeeMonthReadCount:metrics.employeeMonthReadCount,employeeMonthCount:rows.length,
      processResultCount:dataset.processStats.length,firestoreReadCount:metrics.controlReadCount+
        metrics.versionReadCount+metrics.employeeMonthReadCount,firestoreWriteCount:0,finishedAt:loadedAt
    });
    return getState();
  }
  async function runLoad(options,request){
    if(!window.PCMSProductionAnalysisCalculations?.buildDatasetFromMonthSummaries){
      throw new Error('Bộ tính tóm tắt phân tích chưa sẵn sàng. / 摘要分析程式尚未載入。');
    }
    const sameMonths=state.loaded&&request.months.length===state.months.length
      &&request.months.every((month,index)=>month===state.months[index]);
    if(options.force!==true&&sameMonths&&Date.now()-state.loadedAt<MEMORY_FRESH_MS){
      return buildState(state.monthRows,request,state.source,{controlReadCount:0,versionReadCount:0,
        employeeMonthReadCount:0,reloadedMonthCount:0});
    }
    const metrics={controlReadCount:0,versionReadCount:0,employeeMonthReadCount:0,reloadedMonthCount:0};
    const controls=await readControls(request,options,metrics);
    const result=await loadMonths(controls,options,metrics);
    metrics.reloadedMonthCount=result.cloudMonthCount;
    const source=result.cloudMonthCount===0?'indexeddb':'cloud';
    return buildState(result.rows,request,source,metrics);
  }
  async function load(options={}){
    const request=requestFor(options);
    if(options.force!==true&&!request.fromDate&&!request.toDate&&state.loaded&&Date.now()-state.loadedAt<5000) return getState();
    if(options.force!==true&&state.loaded&&state.rangeKey===request.key&&Date.now()-state.loadedAt<5000) return getState();
    if(loadPromise){
      if(loadPromise.key===request.key) return loadPromise.promise;
      await loadPromise.promise;
      return load(options);
    }
    const promise=runLoad(options,request).finally(()=>{
      if(loadPromise?.promise===promise) loadPromise=null;
    });
    loadPromise={key:request.key,promise};
    return promise;
  }
  function resetMemory(){
    state={loaded:false,source:'',dataset:null,monthRows:[],processStats:[],months:[],rangeKey:'',loadedAt:0,pendingProcessDays:false};
    loadPromise=null;
    resetCurrentStandards();
  }

  window.PCMSProductionAnalysisStore=Object.freeze({
    load,getState,resetMemory,loadCurrentStandards,applyCurrentProducts,resetCurrentStandards
  });
  window.loadProductionAnalysisData=options=>load(options);
})();
