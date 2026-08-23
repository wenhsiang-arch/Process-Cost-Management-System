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

  // loadImpactCounts（讀取受影響報工數）：只對實際受影響的既有 processId 做 Aggregate count（彙總計數）。
  async function loadImpactCounts(planInput,options={}){
    const plan=planInput;
    const processIds=[...new Set((plan.rows||[]).filter(row=>row.requiresImpactCount&&row.processId)
      .map(row=>row.processId))];
    if(!processIds.length){
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
    plan.rows.forEach(row=>{ row.impactCount=counts.get(row.processId)||0; });
    plan.affectedEntryCount=[...counts.values()].reduce((sum,count)=>sum+count,0);
    // 只有匯入檔完全沒有同工序號可承接既有固定身分時才阻止，並非因「有報工」就一律拒絕覆蓋。
    plan.blockingRows=plan.rows.filter(row=>row.kind==='removed'&&row.impactCount>0);
    plan.hasBlockingImpact=plan.blockingRows.length>0;
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
      vi:'Có phiếu sản lượng nhưng tệp không có công đoạn cùng số',
      zh:'已有報工，但匯入檔沒有相同工序號'
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

    if(plan.hasBlockingImpact){
      host.appendChild(window.PCMSUIComponents.createNotice({
        kind:'danger',
        text:{
          vi:'Có phiếu sản lượng không thể nối sang công đoạn mới vì tệp thiếu số công đoạn tương ứng. Hãy sửa tệp rồi đọc lại.',
          zh:'部分既有報工無法接到新工序，因匯入檔缺少相同工序號；請修正檔案後重新讀取。'
        }
      }));
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
        if(item.kind==='removed'&&item.impactCount>0) row.classList.add('is-blocked');
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
          {text:{vi:'Hủy',zh:'取消'},onClick:()=>{ settled=true; resolve(false); }},
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
    createPreviewBody,
    confirmPreview
  });
})();
