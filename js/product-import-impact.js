// product-import-impact（款號匯入影響預覽）：計算完整覆蓋差異、低成本報工計數及確認畫面。
(function(){
  'use strict';

  function text(value){ return String(value??'').trim().replace(/\s+/g,' '); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }

  // buildPlan（建立匯入計畫）：相同資料不寫入，新款建立，既有不同款完整替代。
  function buildPlan(classificationInput={}){
    const classification={
      newItems:Array.isArray(classificationInput.newItems)?classificationInput.newItems:[],
      sameItems:Array.isArray(classificationInput.sameItems)?classificationInput.sameItems:[],
      differentItems:Array.isArray(classificationInput.differentItems)?classificationInput.differentItems:[]
    };
    const replacements=classification.differentItems.map(item=>model().buildImportImpact(item.existing,item.incoming));
    const rows=replacements.flatMap(item=>item.rows.map(row=>({...clone(row),impactCount:0})));
    return {
      newItems:classification.newItems.map(clone),
      sameItems:classification.sameItems.map(clone),
      replacements,
      rows,
      requests:[
        ...classification.newItems.map(incoming=>({mode:'create',incoming:clone(incoming)})),
        ...classification.differentItems.map(item=>({mode:'replace',existing:clone(item.existing),incoming:clone(item.incoming)}))
      ],
      overwriteCount:classification.differentItems.length,
      newCount:classification.newItems.length,
      sameCount:classification.sameItems.length,
      processChangeCount:replacements.reduce((sum,item)=>sum+item.processChangeCount,0),
      affectedEntryCount:0,
      matchedProcessCount:replacements.reduce((sum,item)=>sum+item.reconciliation.matches.length,0),
      retainedProcessCount:0,
      blockingRows:[],
      hasBlockingImpact:false
    };
  }

  function requireCountApi(){
    if(typeof window._getCountFromServer!=='function'||typeof window._query!=='function'
      ||typeof window._collection!=='function'||typeof window._where!=='function'){
      throw new Error('Dịch vụ đếm phiếu sản lượng chưa sẵn sàng. / 報工影響計數服務尚未載入。');
    }
  }

  async function countProcessEntries(processId){
    const snapshot=await window._getCountFromServer(window._query(
      window._collection('productionEntries'),
      window._where('processId','==',processId)
    ));
    return Math.max(0,Number(snapshot.data()?.count)||0);
  }

  const PROCESS_QUERY_CHUNK_SIZE=30;

  async function loadActiveProcessEntries(processIds,fromDate=''){
    if(typeof window._getDocs!=='function'||typeof window._orderBy!=='function'){
      throw new Error('Dịch vụ đọc phiếu sản lượng chưa sẵn sàng. / 產能讀取服務尚未載入。');
    }
    const ids=[...new Set((Array.isArray(processIds)?processIds:[processIds]).map(text).filter(Boolean))];
    if(!ids.length) return [];
    const constraints=[
      window._where('processId',ids.length===1?'==':'in',ids.length===1?ids[0]:ids),
      window._where('status','==','active')
    ];
    if(fromDate) constraints.push(window._where('productionDate','>=',fromDate));
    constraints.push(window._orderBy('productionDate','asc'));
    const snapshot=await window._getDocs(window._query(
      window._collection('productionEntries'),
      ...constraints
    ));
    return snapshot.docs.map(item=>({id:item.id,...item.data()}));
  }

  function employeeMonthKey(employeeId,month){ return `${text(month)}__${text(employeeId)}`; }
  function processReferenceKey(productId,processId){ return `${text(productId)}__${text(processId)}`; }
  function lockedMonthStatus(value){ return ['locked','exported','paid'].includes(text(value)); }
  function validMonth(value){ return /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value)); }
  function monthStart(month){ return validMonth(month)?`${text(month)}-01`:''; }
  function number(value){ const parsed=Number(value);return Number.isFinite(parsed)?parsed:0; }

  // loadProductionMonthWindow（載入可變動月份範圍）：只查開放月份，不讓已凍結年份持續增加讀取量。
  // 若沒有開放月份，再以一筆文件區分「全部已凍結」與「尚無月份資料」；異常時回退完整查詢。
  async function loadProductionMonthWindow(){
    try{
      const snapshot=await window._getDocs(window._query(
        window._collection('productionMonths'),window._where('status','==','open')
      ));
      const docs=Array.isArray(snapshot?.docs)?snapshot.docs:[];
      const statuses=new Map();
      for(const item of docs){
        const data=item.data?.()||{};
        const month=text(data.month||item.id);
        const status=text(data.status);
        if(!validMonth(month)||status!=='open') return {optimized:false,statuses:new Map(),fromDate:'',hasOpenMonths:true};
        statuses.set(month,status);
      }
      const openMonths=[...statuses.keys()].sort();
      if(openMonths.length){
        return {optimized:true,statuses,fromDate:monthStart(openMonths[0]),hasOpenMonths:true};
      }
      if(typeof window._limit!=='function') return {optimized:false,statuses:new Map(),fromDate:'',hasOpenMonths:true};
      const anySnapshot=await window._getDocs(window._query(window._collection('productionMonths'),window._limit(1)));
      const anyDocs=Array.isArray(anySnapshot?.docs)?anySnapshot.docs:[];
      if(!anyDocs.length) return {optimized:false,statuses:new Map(),fromDate:'',hasOpenMonths:true};
      const sample=anyDocs[0].data?.()||{};
      const sampleMonth=text(sample.month||anyDocs[0].id);
      if(!validMonth(sampleMonth)||!lockedMonthStatus(sample.status)){
        return {optimized:false,statuses:new Map(),fromDate:'',hasOpenMonths:true};
      }
      return {optimized:true,statuses,fromDate:'',hasOpenMonths:false};
    }catch(_error){
      return {optimized:false,statuses:new Map(),fromDate:'',hasOpenMonths:true};
    }
  }

  async function resolveMonthPercentages(monthRows,products,legacyProcesses=[]){
    const efficiency=window.PCMSProductionEfficiencyCore;
    const resolverApi=window.PCMSProductResolver;
    if(!efficiency||!resolverApi) throw new Error('Thiếu công thức tính hiệu suất. / 缺少績效計算服務。');
    const productMap=new Map((Array.isArray(products)?products:[]).map(item=>[text(item?.productId),item]));
    const resolver=resolverApi.create({
      loadProductsByIds:async ids=>ids.map(id=>productMap.get(id)).filter(Boolean),
      loadLegacyProcessesByReferences:async references=>{
        const keys=new Set((references||[]).map(item=>processReferenceKey(item.productId,item.processId)));
        return (legacyProcesses||[]).filter(item=>keys.has(processReferenceKey(item.productId,item.processId)));
      },
      efficiencyCore:efficiency,workSeconds:Number(window.S?.ws)||3000
    });
    const references=[];
    (monthRows||[]).forEach(row=>Object.values(row?.days||{}).forEach(day=>(day?.processes||[]).forEach(process=>references.push(process))));
    const resolution=references.length?await resolver.resolve(references):{rows:[],exceptions:[]};
    const resolved=new Map(resolution.rows.map(row=>[processReferenceKey(row.source.productId,row.source.processId),row.display]));
    const percentages=new Map();
    (monthRows||[]).forEach(row=>{
      const days=Object.values(row?.days||{}).map(day=>{
        const contributions=(day?.processes||[]).map(process=>{
          const display=resolved.get(processReferenceKey(process.productId,process.processId));
          const valid=Boolean(display&&Number(display.processSeconds)>0);
          return {quantity:number(process.quantity),valid,standardHours:valid
            ?efficiency.standardHours(process.quantity,display.processSeconds,Number(window.S?.ws)||3000):0};
        });
        contributions.push({supplementHours:number(day?.supplementHours),quantity:0,standardHours:0,valid:true});
        return efficiency.day({normalHours:day?.normalHours,overtimeHours:day?.overtimeHours,contributions});
      });
      percentages.set(employeeMonthKey(row.employeeId,row.month),efficiency.month(days));
    });
    return percentages;
  }

  // loadPerformanceImpacts（讀取績效差異）：只針對秒數或分類可能影響績效的已配對工序，且忽略已凍結月份。
  async function loadPerformanceImpacts(planInput,options={}){
    const plan=planInput;
    const candidates=[...new Map((plan.rows||[])
      .filter(row=>row.affectsEfficiency&&row.processId)
      .map(row=>[row.processId,row])).values()];
    plan.performanceImpacts=[];
    plan.performanceDifferenceCount=0;
    if(!candidates.length){ options.onProgress?.({completed:0,total:0,value:100});return plan; }
    const entries=[];
    const monthWindow=await loadProductionMonthWindow();
    const candidateById=new Map(candidates.map(row=>[row.processId,row]));
    let completed=0;
    if(!(monthWindow.optimized&&!monthWindow.hasOpenMonths)){
      for(let offset=0;offset<candidates.length;offset+=PROCESS_QUERY_CHUNK_SIZE){
        const ids=candidates.slice(offset,offset+PROCESS_QUERY_CHUNK_SIZE).map(row=>row.processId);
        const rows=await loadActiveProcessEntries(ids,monthWindow.optimized?monthWindow.fromDate:'');
        rows.forEach(entry=>entries.push({...entry,_impactRow:candidateById.get(text(entry.processId))}));
        completed+=ids.length;
        options.onProgress?.({completed,total:candidates.length,value:Math.round(completed/candidates.length*45)});
      }
    }
    const months=[...new Set(entries.map(entry=>text(entry.productionDate).slice(0,7)).filter(Boolean))];
    const missingMonths=months.filter(month=>!monthWindow.statuses.has(month));
    const missingSnapshots=await Promise.all(missingMonths.map(month=>window._getDoc(window._docRef('productionMonths',month))));
    missingSnapshots.forEach((snapshot,index)=>{
      const month=missingMonths[index];
      monthWindow.statuses.set(month,snapshot.exists()?text(snapshot.data()?.status):'');
    });
    const openMonths=new Set(months.filter(month=>!lockedMonthStatus(monthWindow.statuses.get(month))));
    const activeEntries=entries.filter(entry=>openMonths.has(text(entry.productionDate).slice(0,7)));
    const activeCounts=new Map();
    activeEntries.forEach(entry=>activeCounts.set(text(entry.processId),(activeCounts.get(text(entry.processId))||0)+1));
    let changedEntryCount=0;
    candidates.forEach(row=>{
      row.impactCount=activeCounts.get(row.processId)||0;
      changedEntryCount+=row.impactCount;
    });
    plan.affectedEntryCount=(Number(plan.removedEntryCount)||0)+changedEntryCount;
    const summaryKeys=[...new Set(activeEntries.map(entry=>employeeMonthKey(entry.employeeId,text(entry.productionDate).slice(0,7))))];
    const summarySnapshots=await Promise.all(summaryKeys.map(id=>window._getDoc(window._docRef('productionEmployeeMonths',id))));
    const monthRows=summarySnapshots.map((snapshot,index)=>snapshot.exists()?{id:summaryKeys[index],...snapshot.data()}:null).filter(Boolean);
    options.onProgress?.({completed:candidates.length,total:candidates.length,value:65});
    const currentProducts=(window.D||[]).map(clone);
    const replacementById=new Map((plan.replacements||[]).map(item=>[item.existing.productId,item.replacement]));
    const nextProducts=currentProducts.map(product=>replacementById.has(product.productId)?clone(replacementById.get(product.productId)):product);
    const retainedLegacy=(plan.requests||[]).flatMap(request=>(request.legacyProcesses||[]).map(operation=>({
      ...clone(operation),productId:text(request.existing?.productId),productCode:text(request.existing?.code)
    })));
    const [beforeMap,afterMap]=await Promise.all([
      resolveMonthPercentages(monthRows,currentProducts),resolveMonthPercentages(monthRows,nextProducts,retainedLegacy)
    ]);
    const groups=new Map();
    activeEntries.forEach(entry=>{
      const month=text(entry.productionDate).slice(0,7);
      const key=[entry.employeeId,month,entry.productId,entry.processId].join('__');
      if(!groups.has(key)) groups.set(key,{employeeId:text(entry.employeeId),employeeName:text(entry.employeeName),month,
        productId:text(entry.productId),productCode:text(entry._impactRow?.code),processId:text(entry.processId),
        processNo:text(entry._impactRow?.after?.no||entry._impactRow?.before?.no),
        processNameVi:text(entry._impactRow?.after?.vi||entry._impactRow?.before?.vi),
        processNameZh:text(entry._impactRow?.after?.zh||entry._impactRow?.before?.zh),entryIds:[]});
      groups.get(key).entryIds.push(entry.id);
    });
    const impacts=[];
    groups.forEach(group=>{
      const monthKey=employeeMonthKey(group.employeeId,group.month);
      const before=beforeMap.get(monthKey),after=afterMap.get(monthKey);
      const beforePercentage=before?.efficiencyPercentage??null;
      const afterPercentage=after?.efficiencyPercentage??null;
      if(beforePercentage===afterPercentage) return;
      impacts.push({...group,entryIds:[...new Set(group.entryIds)],entryCount:new Set(group.entryIds).size,
        beforePercentage,afterPercentage,difference:beforePercentage===null||afterPercentage===null?null
          :window.PCMSProductionEfficiencyCore.round(afterPercentage-beforePercentage,4)});
    });
    plan.performanceImpacts=impacts;
    plan.performanceDifferenceCount=impacts.length;
    plan.requests.forEach(request=>{
      request.productionImpacts=impacts.filter(item=>item.productId===request.existing?.productId).map(clone);
    });
    options.onProgress?.({completed:candidates.length,total:candidates.length,value:100});
    return plan;
  }

  // loadImpactCounts（讀取受影響報工數）：只有被移除的工序需查全部歷史，以判斷是否保存舊工序參照。
  // 分類或秒數變更的數量由後續未凍結月份批次查詢直接計算，避免先做重複彙總查詢。
  async function loadImpactCounts(planInput,options={}){
    const plan=planInput;
    const processIds=[...new Set((plan.rows||[]).filter(row=>row.kind==='removed'&&row.processId)
      .map(row=>row.processId))];
    if(!processIds.length){
      plan.removedEntryCount=0;
      options.onProgress?.({completed:0,total:0,value:100});
      return plan;
    }
    requireCountApi();
    const counts=new Map();
    let completed=0;
    const concurrency=Math.max(1,Math.min(6,Number(options.concurrency)||4));
    for(let offset=0;offset<processIds.length;offset+=concurrency){
      const group=processIds.slice(offset,offset+concurrency);
      const results=await Promise.all(group.map(async processId=>[processId,await countProcessEntries(processId)]));
      results.forEach(([processId,count])=>{
        counts.set(processId,count);
        completed+=1;
        options.onProgress?.({completed,total:processIds.length,value:Math.round(completed/processIds.length*100),processId,count});
      });
    }
    plan.rows.filter(row=>row.kind==='removed').forEach(row=>{ row.impactCount=counts.get(row.processId)||0; });
    plan.removedEntryCount=[...counts.values()].reduce((sum,count)=>sum+count,0);
    plan.affectedEntryCount=plan.removedEntryCount;
    const retainedRows=plan.rows.filter(row=>row.kind==='removed'&&row.impactCount>0);
    plan.retainedProcessCount=retainedRows.length;
    plan.requests.forEach(request=>{
      if(request.mode!=='replace') return;
      request.legacyProcesses=retainedRows.filter(row=>row.productId===request.existing?.productId)
        .map(row=>clone(row.before));
    });
    // 找不到新版對應的舊工序改由獨立參照保存，不再阻擋整批匯入。
    plan.blockingRows=[];
    plan.hasBlockingImpact=false;
    return plan;
  }

  function dual(value,tagName='span',className=''){
    return window.PCMSUIText.create(value,{tagName,className});
  }

  function operationText(operation){
    if(!operation) return {vi:'Không có',zh:'無'};
    const category=text(operation.category)||'—';
    const processNo=text(operation.no)||'—';
    const seconds=Number(operation.sec)||0;
    return {
      vi:`CĐ ${processNo} · ${category} · ${text(operation.vi)||'—'} · ${seconds} giây`,
      zh:`工序 ${processNo} · ${category} · ${text(operation.zh)||'—'} · ${seconds} 秒`
    };
  }

  function resultText(row){
    if(row.kind==='added') return {vi:'Thêm công đoạn mới',zh:'新增工序'};
    if(row.kind==='removed'&&row.impactCount>0) return {
      vi:'Giữ dữ liệu công đoạn cũ cho phiếu sản lượng hiện có',
      zh:'保留舊工序資料供既有產能使用'
    };
    if(row.kind==='removed') return {vi:'Xóa khỏi dữ liệu chính hiện tại',zh:'從目前主檔移除'};
    if(row.kind==='product-changed') return {vi:'Phiếu cũ dùng dữ liệu mã hàng mới',zh:'舊報工改用最新款號資料'};
    return {vi:'Phiếu cũ dùng dữ liệu công đoạn mới',zh:'舊報工改用最新工序資料'};
  }

  function createSummaryCard(icon,label,value,tone=''){
    const card=document.createElement('section');
    card.className=`product-import-impact-card${tone?` is-${tone}`:''}`;
    const iconHost=document.createElement('span');
    iconHost.className='product-import-impact-card-icon';
    const iconElement=document.createElement('i');
    iconElement.className=`ti ${icon}`;
    iconElement.setAttribute('aria-hidden','true');
    const copy=document.createElement('div');
    copy.append(dual(label,'div','product-import-impact-card-label'));
    const number=document.createElement('strong');
    number.textContent=String(value);
    copy.appendChild(number);
    iconHost.appendChild(iconElement);
    card.append(iconHost,copy);
    return card;
  }

  function createPreviewBody(plan,options={}){
    const host=document.createElement('div');
    host.className='product-import-impact';
    const file=document.createElement('div');
    file.className='product-import-impact-file';
    const fileIcon=document.createElement('i');
    fileIcon.className='ti ti-file-spreadsheet';
    fileIcon.setAttribute('aria-hidden','true');
    file.append(fileIcon,dual({
      vi:`Tệp: ${text(options.fileName)||'—'}`,
      zh:`檔案：${text(options.fileName)||'—'}`
    },'div'));
    const cards=document.createElement('div');
    cards.className='product-import-impact-cards';
    cards.append(
      createSummaryCard('ti-copy',{vi:'Ghi đè mã hàng',zh:'覆蓋款號'},plan.overwriteCount,'primary'),
      createSummaryCard('ti-plus',{vi:'Thêm mã hàng',zh:'新增款號'},plan.newCount,'success'),
      createSummaryCard('ti-arrows-exchange',{vi:'Thay đổi công đoạn',zh:'工序變更'},plan.processChangeCount,'warning'),
      createSummaryCard('ti-clipboard-data',{vi:'Phiếu sản lượng bị ảnh hưởng',zh:'受影響報工'},plan.affectedEntryCount,'info')
    );
    host.append(file,cards);

    if(plan.retainedProcessCount){
      host.appendChild(window.PCMSUIComponents.createNotice({kind:'info',text:{
        vi:'Công đoạn cũ có phiếu sản lượng sẽ được giữ riêng; dữ liệu chính vẫn dùng công đoạn mới.',
        zh:'已有產能的舊工序會另外保存；正式款號表仍只使用新版工序。'
      }}));
    }

    const section=document.createElement('section');
    section.className='product-import-impact-section';
    section.appendChild(dual({vi:'Chi tiết công đoạn của phiếu sản lượng bị ảnh hưởng',zh:'受影響報工工序明細'},'h3'));
    const frame=document.createElement('div');
    frame.className='ui-table-frame product-import-impact-table-frame';
    const scroll=document.createElement('div');
    scroll.className='ui-table-scroll';
    const table=document.createElement('table');
    table.className='ui-table product-import-impact-table';
    const head=document.createElement('thead');
    const headerRow=document.createElement('tr');
    [
      {vi:'Mã hàng',zh:'款號'},
      {vi:'Số công đoạn',zh:'工序號'},
      {vi:'Dữ liệu hiện tại',zh:'目前資料'},
      {vi:'Dữ liệu nhập',zh:'匯入資料'},
      {vi:'Số phiếu ảnh hưởng',zh:'受影響報工數'},
      {vi:'Kết quả',zh:'結果'}
    ].forEach(label=>{
      const th=document.createElement('th');
      th.appendChild(dual(label));
      headerRow.appendChild(th);
    });
    head.appendChild(headerRow);
    const body=document.createElement('tbody');
    const affectedRows=(plan.rows||[]).filter(item=>Number(item.impactCount)>0); // affectedRows（確實有既有報工受影響的工序）
    if(!affectedRows.length){
      const row=document.createElement('tr');
      const cell=document.createElement('td');
      cell.colSpan=6;
      cell.className='product-import-impact-empty';
      cell.appendChild(dual({vi:'Không có phiếu sản lượng hiện có bị ảnh hưởng',zh:'沒有既有報工受到影響'}));
      row.appendChild(cell);
      body.appendChild(row);
    }else{
      affectedRows.forEach(item=>{
        const row=document.createElement('tr');
        if(item.kind==='removed'&&item.impactCount>0) row.classList.add('is-retained');
        const code=document.createElement('td'); code.textContent=item.code;
        const processNo=document.createElement('td'); processNo.textContent=item.processNo;
        const before=document.createElement('td'); before.appendChild(dual(operationText(item.before)));
        const after=document.createElement('td'); after.appendChild(dual(operationText(item.after)));
        const count=document.createElement('td'); count.className='product-import-impact-count'; count.textContent=String(item.impactCount||0);
        const result=document.createElement('td');
        result.appendChild(dual(resultText(item),'span',`product-import-impact-result is-${item.kind}`));
        row.append(code,processNo,before,after,count,result);
        body.appendChild(row);
      });
    }
    table.append(head,body);
    scroll.appendChild(table);
    frame.appendChild(scroll);
    section.appendChild(frame);
    host.appendChild(section);
    return host;
  }

  // confirmPreview（顯示覆蓋確認）：保留精簡抬頭、四項摘要及唯一受影響報工明細表。
  function confirmPreview(plan,options={}){
    return new Promise(resolve=>{
      let settled=false;
      window.PCMSUIComponents.openDialog({
        title:{vi:'Xem trước ảnh hưởng nhập mã hàng',zh:'預覽匯入影響'},
        body:createPreviewBody(plan,options),
        size:'xlarge',
        closeOnBackdrop:false,
        actions:[
          {text:'common.cancel',onClick:()=>{ settled=true; resolve(false); }},
          {text:{vi:'Xác nhận ghi đè',zh:'確認覆蓋'},kind:'primary',disabled:plan.hasBlockingImpact||!plan.requests.length,
            onClick:()=>{ settled=true; resolve(true); }}
        ],
        onClose:()=>{ if(!settled) resolve(false); }
      });
    });
  }

  window.PCMSProductImportImpact=Object.freeze({
    buildPlan,
    loadImpactCounts,
    loadPerformanceImpacts,
    createPreviewBody,
    confirmPreview
  });
})();
