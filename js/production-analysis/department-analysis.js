// department-analysis.js（部門效率）：以部門總有效工時除以總考勤工時，避免平均個人百分比失真。
(function(){
  'use strict';

  function create(root){
    const ui=window.PCMSProductionAnalysisUI;
    const calc=window.PCMSProductionAnalysisCalculations;
    let dataset=null;
    let rows=[];
    let initializedDates=false;

    root.innerHTML=`
      <div class="ui-operation-panel production-analysis-operation-panel">
        <div class="ui-command-row">
          <div class="production-analysis-filter-grid production-analysis-department-filters">
            ${ui.dateField('department','from','Từ ngày','開始日期')}
            ${ui.dateField('department','to','Đến ngày','結束日期')}
            <div class="ui-form-field"><label>${ui.dual('Bộ phận','部門')}</label><select data-filter="department"></select></div>
          </div>
          <div class="ui-command-actions">
            <button type="button" class="ui-command-action" data-action="guide"><i class="ti ti-help-circle"></i>${ui.dual('Hướng dẫn','使用說明')}</button>
            <button type="button" class="ui-command-action" data-action="print"><i class="ti ti-printer"></i>${ui.dual('In báo cáo','列印報表')}</button>
            <button type="button" class="ui-command-action is-primary" data-action="export"><i class="ti ti-file-spreadsheet"></i>${ui.dual('Xuất Excel','匯出表格')}</button>
          </div>
        </div>
      </div>
      <div class="production-analysis-source" data-role="source"></div>
      <div class="ui-summary-row production-analysis-summary">
        <div class="ui-summary-item"><div class="ui-summary-label">Số bộ phận<span>部門數</span></div><div class="ui-summary-value" data-summary="departments">0</div></div>
        <div class="ui-summary-item"><div class="ui-summary-label">Số nhân viên<span>員工人數</span></div><div class="ui-summary-value" data-summary="employees">0</div></div>
        <div class="ui-summary-item"><div class="ui-summary-label">Tổng giờ chấm công<span>總考勤工時</span></div><div class="ui-summary-value" data-summary="attendance">0 h</div></div>
        <div class="ui-summary-item is-success"><div class="ui-summary-label">Hiệu suất tổng hợp<span>綜合部門效率</span></div><div class="ui-summary-value" data-summary="efficiency">—</div></div>
      </div>
      <section class="ui-data-section">
        <div class="ui-section-header"><i class="ti ti-building-factory-2"></i>${ui.dual('Hiệu suất theo bộ phận','各部門效率')}</div>
        <div class="ui-table-frame"><div class="ui-table-scroll" data-ui-floating-scroll="only">
          <table class="ui-table production-analysis-table department-analysis-table" data-ui-table-controls="auto" data-ui-table-sticky="original">
            <thead><tr>
              <th data-ui-table-column="department">${ui.dual('Bộ phận','部門')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="efficiency" data-ui-table-sort-type="number">${ui.dual('Hiệu suất kỳ này','本期效率')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="history" data-ui-table-sort-type="number">${ui.dual('Hiệu suất lịch sử','歷史平均效率')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="difference" data-ui-table-sort-type="number">${ui.dual('Chênh lệch','與歷史差異')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="employees" data-ui-table-sort-type="number">${ui.dual('Số nhân viên','員工人數')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="attendance" data-ui-table-sort-type="number">${ui.dual('Giờ chấm công','考勤工時')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="standard" data-ui-table-sort-type="number">${ui.dual('Giờ tiêu chuẩn','標準有效工時')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="supplement" data-ui-table-sort-type="number">${ui.dual('Giờ bổ sung','補充工時')}</th>
            </tr></thead><tbody></tbody>
          </table>
        </div></div>
      </section>`;

    const filterElements=Object.fromEntries([...root.querySelectorAll('[data-filter]')].map(element=>[element.dataset.filter,element]));
    const dateControls=ui.bindDateControls(root);

    function filters(){
      return {fromDate:filterElements.from.value,toDate:filterElements.to.value,department:filterElements.department.value};
    }
    function exportColumns(){
      return [
        {key:'department',vi:'Bộ phận',zh:'部門',width:20},
        {vi:'Hiệu suất kỳ này',zh:'本期效率',width:16,value:row=>ui.percent(row.efficiency)},
        {vi:'Hiệu suất lịch sử',zh:'歷史平均效率',width:17,value:row=>ui.percent(row.historicalEfficiency)},
        {vi:'Chênh lệch',zh:'與歷史差異',width:15,value:row=>ui.percent(row.difference)},
        {vi:'Số nhân viên',zh:'員工人數',width:12,value:row=>row.employeeCount},
        {vi:'Giờ chấm công',zh:'考勤工時',width:14,value:row=>ui.hours(row.attendanceHours)},
        {vi:'Giờ tiêu chuẩn',zh:'標準有效工時',width:16,value:row=>ui.hours(row.standardHours)},
        {vi:'Giờ bổ sung',zh:'補充工時',width:14,value:row=>ui.hours(row.supplementHours)}
      ];
    }
    function explanationAppendix(){
      return [
        {label:'部門效率',content:'（部門標準有效工時合計 + 部門補充工時合計）÷ 部門考勤工時合計 × 100%。'},
        {label:'計算方式',content:'先加總所有員工工時再相除，不直接平均個人效率百分比。'},
        {label:'歷史平均效率',content:'所選開始日期以前，該部門累計有效工時 ÷ 累計考勤工時 × 100%。'},
        {label:'與歷史差異',content:'本期部門效率 − 歷史平均效率。正值代表本期高於歷史，負值代表本期低於歷史。'},
        {label:'資料範圍',content:'部門統計包含全部員工，不排除極高或極低效率人員；本頁不判定高／中／低。'}
      ];
    }
    function applyFilters(){
      if(!dataset) return [];
      const current=filters();
      return calc.departmentAnalysisRows(dataset,current).filter(row=>!current.department||row.department===current.department);
    }
    function renderSummary(){
      const employees=new Set();
      const current=filters();
      dataset?.days?.forEach(day=>{
        if(current.fromDate&&day.date<current.fromDate) return;
        if(current.toDate&&day.date>current.toDate) return;
        if(current.department&&day.department!==current.department) return;
        employees.add(day.employeeId);
      });
      const numerator=rows.reduce((sum,row)=>sum+row.numeratorHours,0);
      const denominator=rows.reduce((sum,row)=>sum+row.attendanceHours,0);
      root.querySelector('[data-summary="departments"]').textContent=rows.length;
      root.querySelector('[data-summary="employees"]').textContent=employees.size;
      root.querySelector('[data-summary="attendance"]').textContent=ui.hours(denominator);
      root.querySelector('[data-summary="efficiency"]').textContent=denominator>0?ui.percent(numerator/denominator*100):'—';
    }
    function renderTable(){
      const body=root.querySelector('tbody');
      body.replaceChildren();
      rows.forEach(row=>{
        const tableRow=document.createElement('tr');
        tableRow.append(
          ui.createCell(row.department),ui.createCell(ui.percent(row.efficiency),'ui-table-number-cell'),
          ui.createCell(ui.percent(row.historicalEfficiency),'ui-table-number-cell'),
          ui.createCell(ui.percent(row.difference),'ui-table-number-cell'),
          ui.createCell(row.employeeCount,'ui-table-number-cell'),ui.createCell(ui.hours(row.attendanceHours),'ui-table-number-cell'),
          ui.createCell(ui.hours(row.standardHours),'ui-table-number-cell'),ui.createCell(ui.hours(row.supplementHours),'ui-table-number-cell')
        );
        body.appendChild(tableRow);
      });
      if(!rows.length){
        const tableRow=document.createElement('tr');
        const cell=ui.createCell('Không có dữ liệu phù hợp. / 沒有符合條件的資料。','production-analysis-empty');
        cell.colSpan=8;
        tableRow.appendChild(cell);
        body.appendChild(tableRow);
      }
      ui.refreshTableTools();
    }
    function render(){ rows=applyFilters();renderSummary();renderTable(); }
    function filterSummary(){
      const current=filters();
      return `${ui.dateRangeLabel(current.fromDate,current.toDate)}；Bộ phận / 部門：${current.department||'Tất cả / 全部'}`;
    }
    function showGuide(){
      ui.openExplanation({
        titleVi:'Cách đọc hiệu suất bộ phận',titleZh:'部門效率使用說明',
        userVi:'Trang này tổng hợp tình trạng của từng bộ phận trong thời gian đã chọn và so sánh với lịch sử trước đó. Trang chỉ dùng để theo dõi xu hướng bộ phận, không xếp hạng cao, trung bình hoặc thấp.',
        userZh:'這頁彙總所選期間的各部門效率，並與所選開始日期以前的歷史平均比較。此頁只追蹤部門趨勢，不做高、中、低排名。',
        formulaZh:explanationAppendix().map(item=>`${item.label}：${item.content}`).join('\n\n')
      });
    }
    async function exportRows(){
      await window.PCMSProductionAnalysisExport.exportWorkbook({
        title:'Hiệu suất bộ phận / 部門效率',filePrefix:'Hieu_suat_bo_phan_部門效率',
        rows,columns:exportColumns(),filterSummary:filterSummary(),explanations:explanationAppendix()
      });
    }
    async function printRows(){
      await window.PCMSProductionAnalysisExport.printRows({
        title:'Hiệu suất bộ phận / 部門效率',rows,columns:exportColumns(),filterSummary:filterSummary(),
        formulaAppendix:explanationAppendix().map(item=>`${item.label}：${item.content}`).join('\n')
      });
    }

    root.querySelectorAll('[data-filter]').forEach(element=>element.addEventListener(element.tagName==='INPUT'?'input':'change',render));
    root.querySelector('[data-action="guide"]').addEventListener('click',showGuide);
    root.querySelector('[data-action="export"]').addEventListener('click',exportRows);
    root.querySelector('[data-action="print"]').addEventListener('click',printRows);

    return {
      setData(nextDataset,metadata={}){
        dataset=nextDataset;
        ui.fillSelect(filterElements.department,ui.uniqueSorted(dataset?.days?.map(item=>item.department)||[]),'Tất cả bộ phận','全部部門');
        if(!initializedDates){
          const latest=ui.latestDate(dataset);
          filterElements.from.value=latest;
          filterElements.to.value=latest;
          initializedDates=true;
        }
        dateControls.sync();
        const source=metadata.source==='indexeddb'?'Bộ nhớ máy này / 本機快取':'Dữ liệu đám mây / 雲端資料';
        root.querySelector('[data-role="source"]').textContent=`Nguồn dữ liệu / 資料來源：${source}`;
        render();
      },
      activate(){render();},leave(){}
    };
  }

  window.PCMSProductionDepartmentAnalysis=Object.freeze({create});
})();
