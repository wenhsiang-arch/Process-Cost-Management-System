// employee-analysis.js（員工分析）：以員工每日一列呈現，展開後查看當日工序明細。
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
    const expandedGroups=new Set();

    root.innerHTML=`
      <div class="ui-operation-panel production-analysis-operation-panel">
        <div class="ui-command-row">
          <div class="production-analysis-filter-grid employee-analysis-filter-grid">
            ${ui.dateField('employee','from','Từ ngày','開始日期')}
            ${ui.dateField('employee','to','Đến ngày','結束日期')}
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
        <div class="ui-summary-item"><div class="ui-summary-label">Số ngày nhân viên<span>員工日數</span></div><div class="ui-summary-value" data-summary="rows">0</div></div>
        <div class="ui-summary-item"><div class="ui-summary-label">Hiệu suất ngày tổng hợp<span>綜合當日效率</span></div><div class="ui-summary-value" data-summary="efficiency">—</div></div>
        <div class="ui-summary-item is-warning"><div class="ui-summary-label">Thấp hơn lịch sử<span>低於歷史員工日</span></div><div class="ui-summary-value" data-summary="below">0</div></div>
      </div>
      <section class="ui-data-section">
        <div class="ui-section-header"><i class="ti ti-users"></i>${ui.dual('Tình trạng hiệu suất nhân viên','員工效率狀態')}</div>
        <div class="ui-table-frame"><div class="ui-table-scroll" data-ui-floating-scroll="only">
          <table class="ui-table production-analysis-table employee-analysis-table" data-ui-table-controls="auto" data-ui-table-sticky="original">
            <thead><tr>
              <th class="ui-table-center-cell" data-ui-table-column="detail" data-ui-table-sortable="false">${ui.dual('Chi tiết','展開')}</th>
              <th data-ui-table-column="date" data-ui-table-sortable="false">${ui.dual('Ngày','日期')}</th>
              <th data-ui-table-column="employee" data-ui-table-sortable="false">${ui.dual('Nhân viên','員工')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="daily" data-ui-table-sortable="false">${ui.dual('Hiệu suất ngày','當日效率')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="employeeHistory" data-ui-table-sortable="false">${ui.dual('Lịch sử cá nhân','個人歷史平均')}</th>
              <th data-ui-table-column="comparison" data-ui-table-sortable="false">${ui.dual('So với bình thường','與平常相比')}</th>
              <th class="ui-table-center-cell" data-ui-table-column="explanation" data-ui-table-sortable="false">${ui.dual('Cách tính','算法說明')}</th>
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
    const dateControls=ui.bindDateControls(root);

    function filters(){
      return {
        fromDate:filterElements.from.value,toDate:filterElements.to.value,
        employee:filterElements.employee.value.trim().toLocaleLowerCase(),
        process:filterElements.process.value.trim().toLocaleLowerCase(),
        comparison:filterElements.comparison.value,level:filterElements.level.value
      };
    }
    function displayPercent(value){
      return value===null||value===undefined?'—':ui.percent(value);
    }
    function displayNumber(value){
      return value===null||value===undefined?'—':ui.format(value);
    }
    function positionText(level){
      return {
        low:{vi:'Thấp',zh:'低'},middle:{vi:'Trung bình',zh:'中'},high:{vi:'Cao',zh:'高'},
        unknown:{vi:'Chưa có mốc',zh:'尚無基準'}
      }[level]||{vi:'Chưa có mốc',zh:'尚無基準'};
    }
    function positionLabel(level){
      const value=positionText(level);
      return `${value.vi} / ${value.zh}`;
    }
    function methodLabel(method){
      return method==='trimmed-middle-60'?'排除最高與最低各 20%，平均中間 60%':method==='median'?'取所有人員效率的中位數':'目前僅一人，暫以該人資料呈現';
    }
    function statusText(group){
      return {
        'attendance-missing':{vi:'Chưa ghi nhận chấm công',zh:'考勤未登記'},
        'attendance-invalid':{vi:'Giờ chấm công bất thường',zh:'考勤時數異常'},
        'capacity-missing':{vi:'Thiếu sản lượng tiêu chuẩn',zh:'缺少標準產能'},
        'production-missing':{vi:'Chưa ghi nhận sản lượng',zh:'未登記產能'},
        ready:{vi:'Đã tính',zh:'已計算'}
      }[group.status]||{vi:'Không thể tính',zh:'無法計算'};
    }
    function comparisonText(group){
      if(group.status!=='ready') return {vi:'Không thể so sánh',zh:'無法比較'};
      if(group.comparison==='unknown') return {vi:'Chưa có lịch sử',zh:'尚無歷史'};
      if(group.comparison==='equal') return {vi:'Bằng lịch sử',zh:'與歷史持平'};
      const points=Math.abs(group.difference).toFixed(2);
      return group.comparison==='below'
        ?{vi:`Thấp hơn lịch sử ${points} điểm`,zh:`低於歷史 ${points} 個百分點`}
        :{vi:`Cao hơn lịch sử ${points} điểm`,zh:`高於歷史 ${points} 個百分點`};
    }
    function createDualValue(vi,zh,className=''){
      const wrapper=document.createElement('div');
      wrapper.className=`production-analysis-dual-value ${className}`.trim();
      const primary=document.createElement('span');
      const secondary=document.createElement('span');
      primary.textContent=vi;
      secondary.textContent=zh;
      wrapper.append(primary,secondary);
      return wrapper;
    }
    function createValueCell(value,className=''){
      const cell=document.createElement('td');
      if(className) cell.className=className;
      if(value instanceof Node) cell.appendChild(value);
      else cell.textContent=value;
      return cell;
    }
    function explanation(row){
      if(!row.productCode&&!row.processNo) return 'Không có chi tiết công đoạn trong ngày. / 當日沒有工序產能明細。';
      if(row.lineTypicalEfficiency===null) return 'Chưa có mức tham chiếu cùng công đoạn. / 該工序尚無全線參考值。';
      if(row.level==='low') return 'Mức cá nhân thấp hơn mức thông thường của chuyền trên 10%. / 個人低於全線常規值超過 10%。';
      if(row.level==='high') return 'Mức cá nhân cao hơn mức thông thường của chuyền trên 10%. / 個人高於全線常規值超過 10%。';
      return 'Mức cá nhân nằm trong khoảng ±10% của mức thông thường. / 個人位於全線常規值 ±10% 內。';
    }
    function openDailyFormula(group){
      const status=statusText(group);
      const comparison=comparisonText(group);
      const dailyResult=group.status==='ready'?displayPercent(group.dailyEfficiency):status.zh;
      ui.openExplanation({
        titleVi:'Giải thích hiệu suất ngày',titleZh:'當日效率計算說明',
        userVi:`Ngày ${group.date}, ${group.employeeName||group.employeeId}: ${group.status==='ready'?comparison.vi:status.vi}.`,
        userZh:`${group.date}，${group.employeeName||group.employeeId}：${group.status==='ready'?comparison.zh:status.zh}。展開此列可查看當日各工序明細。`,
        formulaZh:[
          `當日效率 =（當日標準有效工時 ${displayNumber(group.standardHours)} + 補充工時 ${displayNumber(group.supplementHours)}）÷ 考勤工時 ${displayNumber(group.attendanceHours)} × 100% = ${dailyResult}`,
          `員工歷史平均 = 歷史累計有效工時 ${ui.format(group.employeeHistoryNumeratorHours)} ÷ 歷史累計考勤工時 ${ui.format(group.employeeHistoryAttendanceHours)} × 100% = ${displayPercent(group.employeeHistoryEfficiency)}`,
          `與平常相比 = 當日效率 − 個人歷史平均；目前結果：${comparison.zh}。`,
          group.status==='ready'?'當日資料已具備考勤與標準產能，可正常計算。':`本日顯示「${status.zh}」，因此不以 0% 代替，也不列入可比較效率。`
        ].join('\n\n')
      });
    }
    function openProcessFormula(row){
      const processName=[row.productCode,row.processNo,row.processNameZh||row.processNameVi].filter(Boolean).join(' / ');
      ui.openExplanation({
        titleVi:'Giải thích hiệu suất công đoạn',titleZh:'工序效率計算說明',
        userVi:`Công đoạn ${processName||'không có dữ liệu'} được so sánh với lịch sử của nhân viên và mức thông thường cùng công đoạn trên toàn chuyền.`,
        userZh:`工序 ${processName||'無資料'} 同時比較該員工的歷史與全產線同工序常規值。${explanation(row).split(' / ')[1]||''}`,
        formulaZh:[
          `當日工序效率 = 該工序標準有效工時 ${displayNumber(row.processStandardHours)} ÷ 後台分攤的加工時間 ${displayNumber(row.inferredHours)} × 100% = ${displayPercent(row.currentProcessEfficiency)}`,
          `該工序個人歷史平均 = 個人該工序累計標準有效工時 ${ui.format(row.employeeProcessHistoryHours)} ÷ 累計回推加工時間 ${ui.format(row.employeeProcessHistoryInferredHours)} × 100% = ${displayPercent(row.employeeProcessHistoryEfficiency)}`,
          `全線常規平均：${methodLabel(row.lineMethod)}；目前 ${row.lineParticipantCount} 人、累積標準有效工時 ${ui.hours(row.lineCumulativeStandardHours)}，結果 ${displayPercent(row.lineTypicalEfficiency)}。`,
          '高低位置：低於全線常規值 90% 為低；介於 90%～110% 為中；高於 110% 為高。',
          `資料版本：款號 ${row.productCode||'—'}、工序 ${row.processNo||'—'}、標準秒數 ${ui.seconds(row.currentSeconds)}。秒數版本不同會分開統計。`
        ].join('\n\n')
      });
    }
    function exportColumns(){
      return [
        {key:'date',vi:'Ngày',zh:'日期',width:12},{vi:'Mã nhân viên',zh:'員工工號',width:14,value:row=>row.employeeId},
        {vi:'Tên nhân viên',zh:'員工姓名',width:18,value:row=>row.employeeName},
        {vi:'Hiệu suất ngày hoặc trạng thái',zh:'當日效率或狀態',width:22,value:row=>row.status==='ready'?displayPercent(row.dailyEfficiency):`${statusText(row).vi} / ${statusText(row).zh}`},
        {vi:'Lịch sử cá nhân',zh:'個人歷史平均',width:16,value:row=>displayPercent(row.employeeHistoryEfficiency)},
        {vi:'So với bình thường',zh:'與平常相比',width:26,value:row=>{const value=comparisonText(row);return `${value.vi} / ${value.zh}`;}},
        {key:'productCode',vi:'Mã hàng',zh:'款號',width:16},{key:'processNo',vi:'Số công đoạn',zh:'工序號',width:12},
        {vi:'Tên công đoạn',zh:'工序名稱',width:28,value:row=>row.processNameZh||row.processNameVi},
        {vi:'Số lượng',zh:'數量',width:12,value:row=>row.quantity||0},
        {vi:'Hiệu suất công đoạn ngày',zh:'當日工序效率',width:18,value:row=>displayPercent(row.currentProcessEfficiency)},
        {vi:'Lịch sử công đoạn cá nhân',zh:'該工序個人歷史平均',width:20,value:row=>displayPercent(row.employeeProcessHistoryEfficiency)},
        {vi:'Mức thông thường toàn chuyền',zh:'該工序全線常規平均',width:22,value:row=>displayPercent(row.lineTypicalEfficiency)},
        {vi:'Vị trí',zh:'高／中／低',width:14,value:row=>positionLabel(row.level)},
        {vi:'Giải thích',zh:'說明',width:42,value:explanation}
      ];
    }
    function explanationAppendix(){
      return [
        {label:'當日效率',content:'（當日標準有效工時 + 補充工時）÷ 當日考勤工時 × 100%。沒有產能、考勤或標準產能時顯示原因，不以 0% 代替。'},
        {label:'員工歷史平均',content:'歷史累計有效工時 ÷ 歷史累計考勤工時 × 100%，不是每天百分比直接平均。'},
        {label:'當日工序效率',content:'該工序標準有效工時 ÷ 後台依標準有效工時比例分攤的加工時間 × 100%。'},
        {label:'全線常規平均',content:'1 人採該人資料；2～9 人取中位數；10 人以上排除最高與最低各 20%，平均中間 60%。'},
        {label:'高／中／低',content:'低於全線常規值 90% 為低；90%～110% 為中；高於 110% 為高。'}
      ];
    }
    function applyFilters(){
      if(!dataset) return [];
      const current=filters();
      const rows=calc.employeeAnalysisRows(dataset,current).filter(row=>{
        const employeeText=`${row.employeeId} ${row.employeeName}`.toLocaleLowerCase();
        return !current.employee||employeeText.includes(current.employee);
      });
      return calc.employeeDailyAnalysisGroups(rows).map(group=>{
        const processes=group.processes.filter(row=>{
          const processText=`${row.productCode} ${row.processNo} ${row.processNameVi} ${row.processNameZh}`.toLocaleLowerCase();
          if(current.process&&!processText.includes(current.process)) return false;
          if(current.level&&row.level!==current.level) return false;
          return true;
        });
        return {...group,processes};
      }).filter(group=>{
        if((current.process||current.level)&&!group.processes.length) return false;
        if(current.comparison==='below'&&group.comparison!=='below') return false;
        return true;
      });
    }
    function exportRowsData(){
      return filtered.flatMap(group=>{
        const rows=group.processes.length?group.processes:[{}];
        return rows.map(row=>({...row,
          date:group.date,employeeId:group.employeeId,employeeName:group.employeeName,
          dailyEfficiency:group.dailyEfficiency,employeeHistoryEfficiency:group.employeeHistoryEfficiency,
          status:group.status,comparison:group.comparison,difference:group.difference
        }));
      });
    }
    function renderSummary(){
      const days=filtered.filter(group=>group.status==='ready');
      const numerator=days.reduce((sum,group)=>sum+group.standardHours+group.supplementHours,0);
      const denominator=days.reduce((sum,group)=>sum+group.attendanceHours,0);
      root.querySelector('[data-summary="employees"]').textContent=new Set(filtered.map(group=>group.employeeId)).size;
      root.querySelector('[data-summary="rows"]').textContent=filtered.length;
      root.querySelector('[data-summary="efficiency"]').textContent=denominator>0?ui.percent(numerator/denominator*100):'—';
      root.querySelector('[data-summary="below"]').textContent=filtered.filter(group=>group.comparison==='below').length;
    }
    function createProcessDetail(group){
      const detailRow=document.createElement('tr');
      detailRow.className='employee-analysis-detail-row';
      detailRow.dataset.groupId=group.id;
      const detailCell=document.createElement('td');
      detailCell.colSpan=7;
      const panel=document.createElement('div');
      panel.className='employee-analysis-detail-panel';
      const heading=document.createElement('div');
      heading.className='employee-analysis-detail-heading';
      heading.appendChild(createDualValue('Chi tiết công đoạn trong ngày','當日工序明細'));
      panel.appendChild(heading);
      if(!group.processes.length){
        panel.appendChild(createDualValue('Không có chi tiết sản lượng công đoạn trong ngày.','當日沒有工序產能明細。','production-analysis-empty'));
      }else{
        const table=document.createElement('table');
        table.className='ui-table employee-analysis-process-table';
        table.innerHTML=`<thead><tr>
          <th>${ui.dual('Mã hàng / công đoạn','款號／工序')}</th>
          <th class="ui-table-number-cell">${ui.dual('Số lượng','數量')}</th>
          <th class="ui-table-number-cell">${ui.dual('Hiệu suất công đoạn','當日工序效率')}</th>
          <th class="ui-table-number-cell">${ui.dual('Lịch sử cá nhân','該工序個人歷史平均')}</th>
          <th class="ui-table-number-cell">${ui.dual('Mức toàn chuyền','該工序全線常規平均')}</th>
          <th class="ui-table-center-cell">${ui.dual('Vị trí','高／中／低')}</th>
          <th class="ui-table-center-cell">${ui.dual('Cách tính','算法說明')}</th>
        </tr></thead>`;
        const body=document.createElement('tbody');
        group.processes.forEach(row=>{
          const processRow=document.createElement('tr');
          const position=positionText(row.level);
          const formulaCell=document.createElement('td');
          formulaCell.className='ui-table-center-cell';
          const formulaButton=ui.createDualButton('Xem cách tính','查看算法','ti-calculator','ui-button is-bilingual production-analysis-formula-button');
          formulaButton.addEventListener('click',()=>openProcessFormula(row));
          formulaCell.appendChild(formulaButton);
          processRow.append(
            ui.createCell([row.productCode,row.processNo,row.processNameZh||row.processNameVi].filter(Boolean).join(' / ')||'—'),
            ui.createCell(ui.format(row.quantity),'ui-table-number-cell'),
            ui.createCell(displayPercent(row.currentProcessEfficiency),'ui-table-number-cell'),
            ui.createCell(displayPercent(row.employeeProcessHistoryEfficiency),'ui-table-number-cell'),
            ui.createCell(displayPercent(row.lineTypicalEfficiency),'ui-table-number-cell'),
            createValueCell(createDualValue(position.vi,position.zh,`is-${row.level}`),'ui-table-center-cell'),
            formulaCell
          );
          body.appendChild(processRow);
        });
        table.appendChild(body);
        panel.appendChild(table);
      }
      detailCell.appendChild(panel);
      detailRow.appendChild(detailCell);
      return detailRow;
    }
    function renderTable(){
      const body=root.querySelector('.employee-analysis-table > tbody');
      body.replaceChildren();
      const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
      if(page>totalPages) page=totalPages;
      filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).forEach(group=>{
        const tableRow=document.createElement('tr');
        tableRow.className='employee-analysis-main-row';
        tableRow.dataset.groupId=group.id;
        const expanded=expandedGroups.has(group.id);
        if(expanded) tableRow.classList.add('is-expanded');

        const expandCell=document.createElement('td');
        expandCell.className='ui-table-center-cell';
        const expandButton=document.createElement('button');
        expandButton.type='button';
        expandButton.className='employee-analysis-expand-button';
        expandButton.setAttribute('aria-expanded',String(expanded));
        expandButton.setAttribute('aria-label',expanded?'Thu gọn chi tiết / 收合明細':'Mở chi tiết / 展開明細');
        expandButton.innerHTML='<i class="ti ti-chevron-right" aria-hidden="true"></i>';
        expandButton.addEventListener('click',()=>{
          if(expandedGroups.has(group.id)) expandedGroups.delete(group.id);
          else expandedGroups.add(group.id);
          renderTable();
        });
        expandCell.appendChild(expandButton);

        const employeeCell=document.createElement('td');
        const employeeId=document.createElement('strong');
        const employeeName=document.createElement('span');
        employeeId.textContent=group.employeeId;
        employeeName.textContent=group.employeeName||'—';
        employeeCell.className='employee-analysis-employee-cell';
        employeeCell.append(employeeId,employeeName);

        const dailyCell=document.createElement('td');
        dailyCell.className='ui-table-number-cell employee-analysis-daily-cell';
        if(group.status==='ready') dailyCell.textContent=displayPercent(group.dailyEfficiency);
        else{
          const status=statusText(group);
          dailyCell.appendChild(createDualValue(status.vi,status.zh,`is-${group.status}`));
        }

        const historyCell=document.createElement('td');
        historyCell.className='ui-table-number-cell';
        if(group.employeeHistoryEfficiency===null) historyCell.appendChild(createDualValue('Chưa có lịch sử','尚無歷史'));
        else historyCell.textContent=displayPercent(group.employeeHistoryEfficiency);

        const comparison=comparisonText(group);
        const comparisonCell=createValueCell(createDualValue(comparison.vi,comparison.zh,`is-${group.comparison}`),'employee-analysis-comparison-cell');

        const formulaCell=document.createElement('td');
        formulaCell.className='ui-table-center-cell';
        const formulaButton=ui.createDualButton('Xem cách tính','查看算法','ti-calculator','ui-button is-bilingual production-analysis-formula-button');
        formulaButton.addEventListener('click',()=>openDailyFormula(group));
        formulaCell.appendChild(formulaButton);

        tableRow.append(expandCell,ui.createCell(group.date),employeeCell,dailyCell,historyCell,comparisonCell,formulaCell);
        body.appendChild(tableRow);
        if(expanded) body.appendChild(createProcessDetail(group));
      });
      if(!filtered.length){
        const row=document.createElement('tr');
        const cell=ui.createCell('Không có dữ liệu phù hợp. / 沒有符合條件的資料。','production-analysis-empty');
        cell.colSpan=7;
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
      return `${ui.dateRangeLabel(current.fromDate,current.toDate)}；Nhân viên / 員工：${filterElements.employee.value||'Tất cả / 全部'}；Mã hàng hoặc công đoạn / 款號或工序：${filterElements.process.value||'Tất cả / 全部'}`;
    }
    function showGuide(){
      ui.openExplanation({
        titleVi:'Cách đọc phân tích nhân viên',titleZh:'員工分析使用說明',
        userVi:'Mỗi dòng là kết quả của một nhân viên trong một ngày. Mở dòng để xem các công đoạn đã làm, hiệu suất công đoạn, lịch sử cá nhân và vị trí so với toàn chuyền. Nếu thiếu chấm công, sản lượng hoặc sản lượng tiêu chuẩn, hệ thống sẽ ghi rõ nguyên nhân thay vì hiển thị 0%.',
        userZh:'每一列代表一位員工一天的結果。展開後可查看當日各工序效率、個人工序歷史與全線位置。若缺少考勤、產能或標準產能，系統會直接顯示原因，不再用 0% 代替。每日工序回推加工時間只在後台計算，本頁不呈現。',
        formulaZh:'當日效率 =（標準有效工時 + 補充工時）÷ 考勤工時 × 100%。\n\n個人歷史與同工序歷史都使用「累計工時相除」，不是把每天百分比直接平均。\n\n高／中／低直接與全線同工序常規效率比較：低於 90% 為低，90%～110% 為中，高於 110% 為高。'
      });
    }
    async function exportRows(){
      await window.PCMSProductionAnalysisExport.exportWorkbook({
        title:'Phân tích nhân viên / 員工分析',filePrefix:'Phan_tich_nhan_vien_員工分析',
        rows:exportRowsData(),columns:exportColumns(),filterSummary:filterSummary(),explanations:explanationAppendix()
      });
    }
    async function printRows(){
      await window.PCMSProductionAnalysisExport.printRows({
        title:'Phân tích nhân viên / 員工分析',rows:exportRowsData(),columns:exportColumns(),
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

  window.PCMSProductionEmployeeAnalysis=Object.freeze({create});
})();
