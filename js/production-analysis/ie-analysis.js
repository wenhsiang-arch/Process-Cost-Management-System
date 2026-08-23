// ie-analysis（工序分析）：只顯示回推秒數與標準秒數絕對差異最大的二十筆。
(function(){
  'use strict';

  const DISPLAY_LIMIT=20;

  function create(root,options={}){
    const ui=window.PCMSProductionAnalysisUI;
    const calc=window.PCMSProductionAnalysisCalculations;
    let dataset=null;
    let rows=[];
    let initializedDates=false;
    let active=false;
    let standardsReady=false;
    let standardsLoading=false;
    let standardsError=null;
    let standards=new Map();
    let standardLoadSerial=0;
    const selectedKeys=new Set();

    root.innerHTML=`
      <div class="ui-operation-panel production-analysis-operation-panel">
        <div class="ui-command-row">
          <div class="production-analysis-filter-grid">
            ${ui.dateField('ie','from','Từ ngày','開始日期')}
            ${ui.dateField('ie','to','Đến ngày','結束日期')}
            <div class="ui-form-field"><label>${ui.dual('Mã hàng hoặc công đoạn','款號或工序')}</label><input type="search" data-filter="search" placeholder="Nhập từ khóa / 輸入關鍵字"></div>
          </div>
          <div class="ui-command-actions">
            <button type="button" class="ui-command-action" data-action="guide"><i class="ti ti-help-circle"></i>${ui.dual('Hướng dẫn','使用說明')}</button>
            <button type="button" class="ui-command-action" data-action="print"><i class="ti ti-printer"></i>${ui.dual('In để kiểm tra','列印查核')}</button>
          </div>
        </div>
      </div>
      <div class="production-analysis-source" data-role="source"></div>
      <div class="ui-summary-row production-analysis-summary">
        <div class="ui-summary-item"><div class="ui-summary-label">${ui.dual('Hiển thị tối đa','最多顯示')}</div><div class="ui-summary-value">20</div></div>
        <div class="ui-summary-item"><div class="ui-summary-label">${ui.dual('Công đoạn hiện có','目前筆數')}</div><div class="ui-summary-value" data-summary="rows">0</div></div>
        <div class="ui-summary-item"><div class="ui-summary-label">${ui.dual('Giờ hiệu quả tích lũy','累積有效工時')}</div><div class="ui-summary-value" data-summary="hours">0 h</div></div>
        <div class="ui-summary-item is-warning"><div class="ui-summary-label">${ui.dual('Đã chọn để in','已選列印')}</div><div class="ui-summary-value" data-summary="selected">0</div></div>
      </div>
      <section class="ui-data-section">
        <div class="ui-section-header"><i class="ti ti-adjustments-exclamation"></i>${ui.dual('20 công đoạn có chênh lệch giây lớn nhất','秒數差異最大的 20 筆工序')}</div>
        <div class="ui-table-frame"><div class="ui-table-scroll" data-ui-floating-scroll="only">
          <table class="ui-table production-analysis-table ie-analysis-table" data-ui-table-controls="auto" data-ui-table-sticky="original">
            <thead><tr>
              <th class="ui-table-center-cell" data-ui-table-column="select" data-ui-table-sortable="false">${ui.dual('Chọn','選取')}</th>
              <th data-ui-table-column="product">${ui.dual('Mã hàng','款號')}</th>
              <th data-ui-table-column="process">${ui.dual('Công đoạn','工序')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="currentSeconds" data-ui-table-sort-type="number">${ui.dual('Giây tiêu chuẩn hiện tại','目前標準秒數')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="suggestedSeconds" data-ui-table-sort-type="number">${ui.dual('Giây hồi tính đề nghị','回推建議秒數')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="difference" data-ui-table-sort-type="number">${ui.dual('Chênh lệch giây','秒數差異')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="rawEfficiency" data-ui-table-sort-type="number">${ui.dual('Hiệu suất toàn bộ','全部綜合效率')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="typicalEfficiency" data-ui-table-sort-type="number">${ui.dual('Hiệu suất thông thường','常規效率')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="hours" data-ui-table-sort-type="number">${ui.dual('Giờ hiệu quả tích lũy','累積有效工時')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="people" data-ui-table-sort-type="number">${ui.dual('Số nhân viên','員工人數')}</th>
              <th class="ui-table-center-cell" data-ui-table-column="correct" data-ui-table-sortable="false">${ui.dual('Xác nhận sửa','確認修正')}</th>
            </tr></thead><tbody></tbody>
          </table>
        </div></div>
      </section>`;

    const filterElements=Object.fromEntries([...root.querySelectorAll('[data-filter]')].map(element=>[element.dataset.filter,element]));
    const search=filterElements.search;
    const dateControls=ui.bindDateControls(root);
    function filters(){ return {fromDate:filterElements.from.value,toDate:filterElements.to.value}; }
    function printColumns(){
      return [
        {key:'productCode',vi:'Mã hàng',zh:'款號',width:16},{key:'processNo',vi:'Số công đoạn',zh:'工序號',width:12},
        {vi:'Tên công đoạn',zh:'工序名稱',width:28,value:row=>row.processNameZh||row.processNameVi},
        {vi:'Giây tiêu chuẩn hiện tại',zh:'目前標準秒數',width:18,value:row=>ui.seconds(row.currentSeconds)},
        {vi:'Giây hồi tính đề nghị',zh:'回推建議秒數',width:18,value:row=>ui.seconds(row.suggestedSeconds)},
        {vi:'Chênh lệch giây',zh:'秒數差異',width:14,value:row=>ui.seconds(row.differenceSeconds)},
        {vi:'Tỷ lệ chênh lệch',zh:'差異率',width:14,value:row=>ui.percent(row.differencePercent)},
        {vi:'Hiệu suất toàn bộ',zh:'全部綜合效率',width:16,value:row=>ui.percent(row.rawEfficiency)},
        {vi:'Hiệu suất thông thường',zh:'常規效率',width:16,value:row=>ui.percent(row.typicalEfficiency)},
        {vi:'Giờ hiệu quả tích lũy',zh:'累積有效工時',width:17,value:row=>ui.hours(row.cumulativeStandardHours)},
        {vi:'Số nhân viên',zh:'員工人數',width:12,value:row=>row.participantCount}
      ];
    }
    function explanationAppendix(){
      return [
        {label:'回推加工時間',content:'（考勤總工時 − 補充工時）× 該工序標準有效工時 ÷ 當日全部工序標準有效工時。'},
        {label:'回推秒數',content:'回推加工時間 × 3,000 秒 ÷ 生產數量。'},
        {label:'排序',content:'只按回推建議秒數與目前標準秒數的絕對差異，由大到小顯示前 20 筆。系統不判定可信度或優先級。'},
        {label:'使用限制',content:'結果只供現場人員判斷與查核，不會自動修改正式標準秒數。'}
      ];
    }
    function filteredRows(){
      const keyword=search.value.trim().toLocaleLowerCase();
      return (dataset&&standardsReady?calc.ieAnalysisRows(dataset,filters(),standards):[]).filter(row=>{
        if(!keyword) return true;
        return `${row.productCode} ${row.processNo} ${row.processNameVi} ${row.processNameZh}`.toLocaleLowerCase().includes(keyword);
      }).sort((a,b)=>number(b.absoluteDifferenceSeconds)-number(a.absoluteDifferenceSeconds)).slice(0,DISPLAY_LIMIT);
    }
    function number(value){ const parsed=Number(value);return Number.isFinite(parsed)?parsed:0; }
    function renderSummary(){
      root.querySelector('[data-summary="rows"]').textContent=String(rows.length);
      root.querySelector('[data-summary="hours"]').textContent=ui.hours(rows.reduce((sum,row)=>sum+number(row.cumulativeStandardHours),0));
      root.querySelector('[data-summary="selected"]').textContent=String(selectedKeys.size);
    }
    function renderTable(){
      const body=root.querySelector('tbody');
      body.replaceChildren();
      rows.forEach(row=>{
        const tableRow=document.createElement('tr');
        const selectCell=document.createElement('td');
        selectCell.className='ui-table-center-cell';
        const checkbox=document.createElement('input');
        checkbox.type='checkbox';checkbox.checked=selectedKeys.has(row.key);
        checkbox.setAttribute('aria-label',`Chọn ${row.productCode} ${row.processNo} / 選取 ${row.productCode} ${row.processNo}`);
        checkbox.addEventListener('change',()=>{
          if(checkbox.checked) selectedKeys.add(row.key);else selectedKeys.delete(row.key);
          renderSummary();
        });
        selectCell.appendChild(checkbox);
        const currentCell=ui.createCell('','ui-table-number-cell');
        if(window.PCMSQuickProcessSeconds){
          currentCell.appendChild(window.PCMSQuickProcessSeconds.createButton({
            value:ui.seconds(row.currentSeconds),productId:row.productId,processId:row.processId,code:row.productCode,processNo:row.processNo,
            processNameVi:row.processNameVi,displayedSeconds:number(row.currentSeconds),
            recommendedSeconds:number(row.suggestedSeconds),source:'ieAnalysis',onSaved:handleSaved
          }));
        }else currentCell.textContent=ui.seconds(row.currentSeconds);
        tableRow.append(
          selectCell,ui.createCell(row.productCode||'—'),
          ui.createCell([row.processNo,row.processNameVi].filter(Boolean).join(' / ')||'—'),currentCell,
          ui.createCell(ui.seconds(row.suggestedSeconds),'ui-table-number-cell'),
          ui.createCell(`${ui.seconds(row.differenceSeconds)}\n${ui.percent(row.differencePercent)}`,'ui-table-number-cell'),
          ui.createCell(ui.percent(row.rawEfficiency),'ui-table-number-cell'),
          ui.createCell(ui.percent(row.typicalEfficiency),'ui-table-number-cell'),
          ui.createCell(ui.hours(row.cumulativeStandardHours),'ui-table-number-cell'),
          ui.createCell(row.participantCount,'ui-table-number-cell')
        );
        const correction=document.createElement('td');
        correction.className='ui-table-center-cell';
        if(window.PCMSQuickProcessSeconds?.allowed?.()&&number(row.suggestedSeconds)>0){
          const button=window.PCMSUIComponents.createButton({text:{vi:'Sửa nhanh',zh:'快速修改'},icon:'ti-edit'});
          button.addEventListener('click',()=>window.PCMSQuickProcessSeconds.open({
            productId:row.productId,processId:row.processId,code:row.productCode,processNo:row.processNo,processNameVi:row.processNameVi,
            displayedSeconds:number(row.currentSeconds),recommendedSeconds:number(row.suggestedSeconds),source:'ieAnalysis',onSaved:handleSaved
          }));
          correction.appendChild(button);
        }else correction.textContent='—';
        tableRow.appendChild(correction);body.appendChild(tableRow);
      });
      if(!rows.length){
        const row=document.createElement('tr');
        const empty=standardsLoading
          ?{vi:'Đang xác nhận giây tiêu chuẩn hiện tại...',zh:'正在確認目前正式秒數…'}
          :(standardsError
            ?{vi:'Không thể xác nhận giây tiêu chuẩn hiện tại.',zh:'無法確認目前正式秒數。'}
            :{vi:'Tiêu chuẩn hiện tại chưa có mẫu hợp lệ.',zh:'目前標準尚無有效樣本。'});
        const cell=ui.createDualCell(empty,'production-analysis-empty');
        cell.colSpan=11;row.appendChild(cell);body.appendChild(row);
      }
      ui.refreshTableTools();
    }
    function render(){
      rows=filteredRows();
      const visibleKeys=new Set(rows.map(row=>row.key));
      [...selectedKeys].forEach(key=>{ if(!visibleKeys.has(key)) selectedKeys.delete(key); });
      renderSummary();renderTable();
    }
    async function ensureStandards(loadOptions={}){
      if(!active||!dataset) return;
      if(standardsLoading&&loadOptions.force!==true) return;
      const serial=++standardLoadSerial;
      standardsLoading=true;
      standardsError=null;
      render();
      try{
        const result=await window.PCMSProductionAnalysisStore.loadCurrentStandards({dataset,force:loadOptions.force===true});
        if(serial!==standardLoadSerial||!active) return;
        standards=result.standards;
        standardsReady=true;
      }catch(error){
        if(serial!==standardLoadSerial||!active) return;
        standards=new Map();
        standardsReady=false;
        standardsError=error;
        console.error('Không thể tải tiêu chuẩn công đoạn hiện tại / 無法載入目前正式工序標準',error);
        options.onStandardsError?.(error);
      }finally{
        if(serial===standardLoadSerial){
          standardsLoading=false;
          if(active) render();
        }
      }
    }
    async function handleSaved(result){
      if(typeof options.onProcessSecondsSaved==='function') await options.onProcessSecondsSaved(result,filters());
      else window.PCMSProductionAnalysisStore.resetCurrentStandards();
      if(active) await ensureStandards();
    }
    function selectedOrRows(){ const selected=rows.filter(row=>selectedKeys.has(row.key));return selected.length?selected:rows; }
    function showGuide(){
      ui.openExplanation({
        titleVi:'Cách dùng danh sách công đoạn',titleZh:'工序分析使用說明',
        userVi:'Trang chỉ dùng mẫu có số giây giống tiêu chuẩn chính thức hiện tại và hiển thị tối đa 20 công đoạn có chênh lệch lớn nhất. Người phụ trách tự đánh giá và có thể in danh sách để kiểm tra tại chuyền.',
        userZh:'畫面只統計秒數與目前正式標準相同的樣本，並顯示所選日期範圍內秒數絕對差異最大的 20 筆工序，由專業生產人員自行判斷及列印查核。',
        formulaZh:explanationAppendix().map(item=>`${item.label}：${item.content}`).join('\n\n')
      });
    }
    async function printRows(){
      await window.PCMSProductionAnalysisExport.printRows({
        title:'Danh sách kiểm tra công đoạn tại chuyền / 工序產線查核表',rows:selectedOrRows(),columns:printColumns(),
        filterSummary:`${ui.dateRangeLabel(filters().fromDate,filters().toDate)}；Sắp xếp theo chênh lệch giây giảm dần / 依秒數差異由大到小`,
        handwritingColumns:[{vi:'Giây thực đo',zh:'實測秒數'},{vi:'Nguyên nhân',zh:'原因'},{vi:'Kiến nghị',zh:'建議'},{vi:'Người kiểm tra / ngày',zh:'查核人／日期'}],
        formulaAppendix:explanationAppendix().map(item=>`${item.label}：${item.content}`).join('\n')
      });
    }

    root.querySelectorAll('[data-filter]').forEach(element=>element.addEventListener(element.tagName==='INPUT'?'input':'change',()=>{
      render();
      if(element.dataset.filter==='from'||element.dataset.filter==='to') options.onDateRangeChange?.(filters());
    }));
    root.querySelector('[data-action="guide"]').addEventListener('click',showGuide);
    root.querySelector('[data-action="print"]').addEventListener('click',printRows);

    return {
      setData(nextDataset,metadata={}){
        dataset=nextDataset;
        if(!initializedDates){
          filterElements.from.value=ui.earliestDate(dataset);
          filterElements.to.value=ui.latestDate(dataset);
          initializedDates=true;
        }
        dateControls.sync();
        ui.setSourceLabel(root.querySelector('[data-role="source"]'),metadata);
        if(active) void ensureStandards();
        else render();
      },
      dataRange(){ return filters(); },
      activate(){ active=true;void ensureStandards(); },
      refreshCurrentStandards(){ if(active) void ensureStandards(); },
      invalidateCurrentStandards(){
        standards=new Map();
        standardsReady=false;
        standardsError=null;
      },
      leave(){
        active=false;
        standardLoadSerial+=1;
        standardsLoading=false;
        standards=new Map();
        standardsReady=false;
        standardsError=null;
      }
    };
  }

  window.PCMSProductionIEAnalysis=Object.freeze({create});
})();
