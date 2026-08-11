// employee-analysis.js（員工分析）：呈現主管查看的個人與同工序比較，不顯示每日回推時間。
(function(){
  'use strict';

  const PAGE_SIZE=50;

  function create(root){
    const ui=window.PCMSProductionAnalysisUI;
    const calc=window.PCMSProductionAnalysisCalculations;
    let dataset=null;
    let metadata={};
    let filtered=[];
    let page=1;
    let initializedDates=false;

    root.innerHTML=`
      <div class="ui-operation-panel production-analysis-operation-panel">
        <div class="ui-command-row">
          <div class="production-analysis-filter-grid">
            <div class="ui-form-field"><label>${ui.dual('Từ ngày','開始日期')}</label><input type="date" data-filter="from"></div>
            <div class="ui-form-field"><label>${ui.dual('Đến ngày','結束日期')}</label><input type="date" data-filter="to"></div>
            <div class="ui-form-field"><label>${ui.dual('Bộ phận','部門')}</label><select data-filter="department"></select></div>
            <div class="ui-form-field"><label>${ui.dual('Nhân viên','員工')}</label><input type="search" data-filter="employee" placeholder="Mã hoặc tên / 工號或姓名"></div>
            <div class="ui-form-field"><label>${ui.dual('Mã hàng hoặc công đoạn','款號或工序')}</label><input type="search" data-filter="process" placeholder="Nhập từ khóa / 輸入關鍵字"></div>
            <div class="ui-form-field"><label>${ui.dual('So với lịch sử','與歷史比較')}</label><select data-filter="comparison"><option value="">Tất cả / 全部</option><option value="below">Thấp hơn lịch sử / 低於歷史</option></select></div>
            <div class="ui-form-field"><label>${ui.dual('Vị trí trên chuyền','全線位置')}</label><select data-filter="level"><option value="">Tất cả / 全部</option><option value="low">Thấp / 低</option><option value="middle">Trung bình / 中</option><option value="high">Cao / 高</option></select></div>
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
        <div class="ui-summary-item"><div class="ui-summary-label">Số nhân viên<span>員工人數</span></div><div class="ui-summary-value" data-summary="employees">0</div></div>
        <div class="ui-summary-item"><div class="ui-summary-label">Số dòng phân tích<span>分析筆數</span></div><div class="ui-summary-value" data-summary="rows">0</div></div>
        <div class="ui-summary-item"><div class="ui-summary-label">Hiệu suất ngày tổng hợp<span>綜合當日效率</span></div><div class="ui-summary-value" data-summary="efficiency">—</div></div>
        <div class="ui-summary-item is-warning"><div class="ui-summary-label">Thấp hơn lịch sử<span>低於歷史筆數</span></div><div class="ui-summary-value" data-summary="below">0</div></div>
      </div>
      <section class="ui-data-section">
        <div class="ui-section-header"><i class="ti ti-users"></i>${ui.dual('Tình trạng hiệu suất nhân viên','員工效率狀態')}</div>
        <div class="ui-table-frame"><div class="ui-table-scroll" data-ui-floating-scroll="only">
          <table class="ui-table production-analysis-table employee-analysis-table" data-ui-table-controls="auto" data-ui-table-sticky="original">
            <thead><tr>
              <th data-ui-table-column="date" data-ui-table-sort-type="date">${ui.dual('Ngày','日期')}</th>
              <th data-ui-table-column="employee">${ui.dual('Nhân viên','員工')}</th>
              <th data-ui-table-column="department">${ui.dual('Bộ phận','部門')}</th>
              <th data-ui-table-column="process">${ui.dual('Mã hàng / công đoạn','款號／工序')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="daily" data-ui-table-sort-type="number">${ui.dual('Hiệu suất ngày','當日效率')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="employeeHistory" data-ui-table-sort-type="number">${ui.dual('Lịch sử nhân viên','員工歷史平均')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="processHistory" data-ui-table-sort-type="number">${ui.dual('Lịch sử công đoạn cá nhân','該工序個人歷史平均')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="line" data-ui-table-sort-type="number">${ui.dual('Mức thông thường toàn chuyền','該工序全線常規平均')}</th>
              <th class="ui-table-center-cell" data-ui-table-column="level">${ui.dual('Vị trí','高／中／低')}</th>
              <th data-ui-table-column="explanation" data-ui-table-sortable="false">${ui.dual('Giải thích','說明')}</th>
            </tr></thead><tbody></tbody>
          </table>
        </div></div>
      </section>
      <div class="production-analysis-pagination">
        <button type="button" class="ui-button" data-page="previous">${ui.dual('Trang trước','上一頁')}</button>
        <span data-role="page-info"></span>
        <button type="button" class="ui-button" data-page="next">${ui.dual('Trang sau','下一頁')}</button>
      </div>`;

    const filterElements=Object.fromEntries([...root.querySelectorAll('[data-filter]')].map(element=>[element.dataset.filter,element]));

    function filters(){
      return {
        fromDate:filterElements.from.value,toDate:filterElements.to.value,
        department:filterElements.department.value,
        employee:filterElements.employee.value.trim().toLocaleLowerCase(),
        process:filterElements.process.value.trim().toLocaleLowerCase(),
        comparison:filterElements.comparison.value,level:filterElements.level.value
      };
    }
    function positionLabel(level){
      return {low:'Thấp / 低',middle:'Trung bình / 中',high:'Cao / 高'}[level]||'Chưa có mốc / 尚無基準';
    }
    function methodLabel(method){
      return method==='trimmed-middle-60'?'排除最高與最低各 20%，平均中間 60%':method==='median'?'取所有人員效率的中位數':'目前僅一人，暫以該人資料呈現';
    }
    function explanation(row){
      if(row.lineTypicalEfficiency===null) return 'Chưa có mức tham chiếu cùng công đoạn. / 該工序尚無全線參考值。';
      if(row.level==='low') return 'Mức cá nhân thấp hơn mức thông thường của chuyền trên 10%. / 個人低於全線常規值超過 10%。';
      if(row.level==='high') return 'Mức cá nhân cao hơn mức thông thường của chuyền trên 10%. / 個人高於全線常規值超過 10%。';
      return 'Mức cá nhân nằm trong khoảng ±10% của mức thông thường. / 個人位於全線常規值 ±10% 內。';
    }
    function openFormula(row){
      const processName=[row.productCode,row.processNo,row.processNameZh||row.processNameVi].filter(Boolean).join(' / ');
      ui.openExplanation({
        titleVi:'Giải thích hiệu suất nhân viên',titleZh:'員工效率計算說明',
        userVi:`Ngày ${row.date}, ${row.employeeName||row.employeeId} được so sánh với lịch sử của chính mình và mức thông thường của cùng công đoạn trên toàn chuyền. ${explanation(row).split(' / ')[0]}`,
        userZh:`${row.date}，${row.employeeName||row.employeeId} 的表現同時比較自己的歷史與全產線同工序常規值。工序：${processName||'無工序資料'}。${explanation(row).split(' / ')[1]||''}`,
        formulaZh:[
          `當日效率 =（當日標準有效工時 ${ui.format(row.standardHours)} + 補充工時 ${ui.format(row.supplementHours)}）÷ 考勤工時 ${ui.format(row.attendanceHours)} × 100% = ${ui.percent(row.dailyEfficiency)}`,
          `員工歷史平均 = 歷史累計有效工時 ${ui.format(row.employeeHistoryNumeratorHours)} ÷ 歷史累計考勤工時 ${ui.format(row.employeeHistoryAttendanceHours)} × 100% = ${ui.percent(row.employeeHistoryEfficiency)}`,
          `該工序個人歷史平均 = 個人該工序累計標準有效工時 ${ui.format(row.employeeProcessHistoryHours)} ÷ 累計回推加工時間 ${ui.format(row.employeeProcessHistoryInferredHours)} × 100% = ${ui.percent(row.employeeProcessHistoryEfficiency)}`,
          `全線常規平均：${methodLabel(row.lineMethod)}；目前 ${row.lineParticipantCount} 人、累積標準有效工時 ${ui.hours(row.lineCumulativeStandardHours)}，結果 ${ui.percent(row.lineTypicalEfficiency)}。`,
          `高低位置：低於全線常規值 90% 為低；介於 90%～110% 為中；高於 110% 為高。`,
          `資料版本：款號 ${row.productCode||'—'}、工序 ${row.processNo||'—'}、標準秒數 ${ui.seconds(row.currentSeconds)}。秒數版本不同會分開統計。`
        ].join('\n\n')
      });
    }
    function exportColumns(){
      return [
        {key:'date',vi:'Ngày',zh:'日期',width:12},{vi:'Mã nhân viên',zh:'員工工號',width:14,value:row=>row.employeeId},
        {vi:'Tên nhân viên',zh:'員工姓名',width:18,value:row=>row.employeeName},{key:'department',vi:'Bộ phận',zh:'部門',width:16},
        {key:'productCode',vi:'Mã hàng',zh:'款號',width:16},{key:'processNo',vi:'Số công đoạn',zh:'工序號',width:12},
        {vi:'Tên công đoạn',zh:'工序名稱',width:28,value:row=>row.processNameZh||row.processNameVi},
        {vi:'Hiệu suất ngày',zh:'當日效率',width:14,value:row=>ui.percent(row.dailyEfficiency)},
        {vi:'Lịch sử nhân viên',zh:'員工歷史平均',width:16,value:row=>ui.percent(row.employeeHistoryEfficiency)},
        {vi:'Lịch sử công đoạn cá nhân',zh:'該工序個人歷史平均',width:20,value:row=>ui.percent(row.employeeProcessHistoryEfficiency)},
        {vi:'Mức thông thường toàn chuyền',zh:'該工序全線常規平均',width:22,value:row=>ui.percent(row.lineTypicalEfficiency)},
        {vi:'Vị trí',zh:'高／中／低',width:14,value:row=>positionLabel(row.level)},
        {vi:'Giải thích',zh:'說明',width:42,value:explanation}
      ];
    }
    function explanationAppendix(){
      return [
        {label:'當日效率',content:'（當日標準有效工時 + 補充工時）÷ 當日考勤工時 × 100%。'},
        {label:'員工歷史平均',content:'歷史累計有效工時 ÷ 歷史累計考勤工時 × 100%，不是每天百分比直接平均。'},
        {label:'全線常規平均',content:'1 人採該人資料；2～9 人取中位數；10 人以上排除最高與最低各 20%，平均中間 60%。'},
        {label:'高／中／低',content:'低於全線常規值 90% 為低；90%～110% 為中；高於 110% 為高。'}
      ];
    }
    function applyFilters(){
      if(!dataset) return [];
      const current=filters();
      return calc.employeeAnalysisRows(dataset,current).filter(row=>{
        if(current.department&&row.department!==current.department) return false;
        const employeeText=`${row.employeeId} ${row.employeeName}`.toLocaleLowerCase();
        if(current.employee&&!employeeText.includes(current.employee)) return false;
        const processText=`${row.productCode} ${row.processNo} ${row.processNameVi} ${row.processNameZh}`.toLocaleLowerCase();
        if(current.process&&!processText.includes(current.process)) return false;
        if(current.comparison==='below'&&!(row.dailyEfficiency!==null&&row.employeeHistoryEfficiency!==null&&row.dailyEfficiency<row.employeeHistoryEfficiency)) return false;
        if(current.level&&row.level!==current.level) return false;
        return true;
      });
    }
    function renderSummary(){
      const uniqueDays=new Map();
      filtered.forEach(row=>uniqueDays.set(`${row.employeeId}|${row.date}`,row));
      const days=[...uniqueDays.values()].filter(row=>row.attendanceHours>0&&row.dailyEfficiency!==null);
      const numerator=days.reduce((sum,row)=>sum+row.standardHours+row.supplementHours,0);
      const denominator=days.reduce((sum,row)=>sum+row.attendanceHours,0);
      root.querySelector('[data-summary="employees"]').textContent=new Set(filtered.map(row=>row.employeeId)).size;
      root.querySelector('[data-summary="rows"]').textContent=filtered.length;
      root.querySelector('[data-summary="efficiency"]').textContent=denominator>0?ui.percent(numerator/denominator*100):'—';
      root.querySelector('[data-summary="below"]').textContent=filtered.filter(row=>row.dailyEfficiency!==null&&row.employeeHistoryEfficiency!==null&&row.dailyEfficiency<row.employeeHistoryEfficiency).length;
    }
    function renderTable(){
      const body=root.querySelector('tbody');
      body.replaceChildren();
      const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
      if(page>totalPages) page=totalPages;
      filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).forEach(row=>{
        const tableRow=document.createElement('tr');
        tableRow.append(
          ui.createCell(row.date),
          ui.createCell(`${row.employeeId}\n${row.employeeName}`),
          ui.createCell(row.department||'—'),
          ui.createCell([row.productCode,row.processNo,row.processNameZh||row.processNameVi].filter(Boolean).join(' / ')||'—'),
          ui.createCell(ui.percent(row.dailyEfficiency),'ui-table-number-cell'),
          ui.createCell(ui.percent(row.employeeHistoryEfficiency),'ui-table-number-cell'),
          ui.createCell(ui.percent(row.employeeProcessHistoryEfficiency),'ui-table-number-cell'),
          ui.createCell(ui.percent(row.lineTypicalEfficiency),'ui-table-number-cell')
        );
        const levelCell=ui.createCell(positionLabel(row.level),'ui-table-center-cell');
        levelCell.dataset.level=row.level;
        const explanationCell=document.createElement('td');
        const copy=document.createElement('div');
        copy.className='production-analysis-explanation';
        copy.textContent=explanation(row);
        const button=ui.createDualButton('Xem cách tính','查看算法','ti-calculator','ui-button is-bilingual production-analysis-formula-button');
        button.addEventListener('click',()=>openFormula(row));
        explanationCell.append(copy,button);
        tableRow.append(levelCell,explanationCell);
        body.appendChild(tableRow);
      });
      if(!filtered.length){
        const row=document.createElement('tr');
        const cell=ui.createCell('Không có dữ liệu phù hợp. / 沒有符合條件的資料。','production-analysis-empty');
        cell.colSpan=10;
        row.appendChild(cell);
        body.appendChild(row);
      }
      root.querySelector('[data-role="page-info"]').textContent=`${page} / ${totalPages}（${filtered.length}）`;
      root.querySelector('[data-page="previous"]').disabled=page<=1;
      root.querySelector('[data-page="next"]').disabled=page>=totalPages;
      ui.refreshTableTools();
    }
    function render(){
      filtered=applyFilters();
      renderSummary();
      renderTable();
    }
    function filterSummary(){
      const current=filters();
      return `${ui.dateRangeLabel(current.fromDate,current.toDate)}；Bộ phận / 部門：${current.department||'Tất cả / 全部'}；Nhân viên / 員工：${filterElements.employee.value||'Tất cả / 全部'}`;
    }
    function showGuide(){
      ui.openExplanation({
        titleVi:'Cách đọc phân tích nhân viên',titleZh:'員工分析使用說明',
        userVi:'Dùng trang này để xem hiệu suất ngày của nhân viên có giữ được mức lịch sử hay không, và vị trí của họ so với mức thông thường của cùng công đoạn trên chuyền. Có thể lọc riêng người thấp hơn lịch sử rồi in cho quản lý theo dõi.',
        userZh:'這頁用來看員工當日效率是否維持自己的歷史狀態，以及在全產線同工序中屬於低、中或高位。可篩選低於歷史的人員後列印給幹部追蹤。每日工序回推時間只在後台計算，不在本頁呈現。',
        formulaZh:'當日效率 =（標準有效工時 + 補充工時）÷ 考勤工時 × 100%。\n\n個人歷史與同工序歷史都使用「累計工時相除」，不是把每天百分比直接平均。\n\n高／中／低直接與全線同工序常規效率比較：低於 90% 為低，90%～110% 為中，高於 110% 為高。'
      });
    }
    async function exportRows(){
      await window.PCMSProductionAnalysisExport.exportWorkbook({
        title:'Phân tích nhân viên / 員工分析',filePrefix:'Phan_tich_nhan_vien_員工分析',
        rows:filtered,columns:exportColumns(),filterSummary:filterSummary(),explanations:explanationAppendix()
      });
    }
    async function printRows(){
      await window.PCMSProductionAnalysisExport.printRows({
        title:'Phân tích nhân viên / 員工分析',rows:filtered,columns:exportColumns(),
        filterSummary:filterSummary(),formulaAppendix:explanationAppendix().map(item=>`${item.label}：${item.content}`).join('\n')
      });
    }

    root.querySelectorAll('[data-filter]').forEach(element=>element.addEventListener(element.tagName==='INPUT'?'input':'change',()=>{page=1;render();}));
    root.querySelector('[data-action="guide"]').addEventListener('click',showGuide);
    root.querySelector('[data-action="export"]').addEventListener('click',exportRows);
    root.querySelector('[data-action="print"]').addEventListener('click',printRows);
    root.querySelector('[data-page="previous"]').addEventListener('click',()=>{if(page>1){page-=1;renderTable();}});
    root.querySelector('[data-page="next"]').addEventListener('click',()=>{if(page*PAGE_SIZE<filtered.length){page+=1;renderTable();}});

    return {
      setData(nextDataset,nextMetadata={}){
        dataset=nextDataset;
        metadata=nextMetadata;
        ui.fillSelect(filterElements.department,ui.uniqueSorted(dataset?.days?.map(item=>item.department)||[]),'Tất cả bộ phận','全部部門');
        if(!initializedDates){
          const latest=ui.latestDate(dataset);
          filterElements.from.value=latest;
          filterElements.to.value=latest;
          initializedDates=true;
        }
        const source=metadata.source==='indexeddb'?'Bộ nhớ máy này / 本機快取':'Dữ liệu đám mây / 雲端資料';
        root.querySelector('[data-role="source"]').textContent=`Nguồn dữ liệu / 資料來源：${source}`;
        render();
      },
      activate(){render();},leave(){}
    };
  }

  window.PCMSProductionEmployeeAnalysis=Object.freeze({create});
})();
