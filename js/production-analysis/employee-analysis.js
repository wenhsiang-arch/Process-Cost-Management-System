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
            <div class="ui-form-field"><label>${ui.dual('Nhân viên / mã hàng / công đoạn','員工／款號／工序')}</label><input type="search" data-filter="search" placeholder="Nhập từ khóa / 輸入關鍵字"></div>
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
        <div class="ui-summary-item"><div class="ui-summary-label">${ui.dual('Số nhân viên','員工人數')}</div><div class="ui-summary-value" data-summary="employees">0</div></div>
        <div class="ui-summary-item"><div class="ui-summary-label">${ui.dual('Số ngày nhân viên','員工日數')}</div><div class="ui-summary-value" data-summary="rows">0</div></div>
        <div class="ui-summary-item"><div class="ui-summary-label">${ui.dual('Hiệu suất ngày tổng hợp','綜合當日效率')}</div><div class="ui-summary-value" data-summary="efficiency">—</div></div>
        <div class="ui-summary-item is-warning"><div class="ui-summary-label">${ui.dual('Thấp hơn lịch sử','低於歷史員工日')}</div><div class="ui-summary-value" data-summary="below">0</div></div>
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
        search:filterElements.search.value.trim().toLocaleLowerCase(),
        comparison:filterElements.comparison.value,level:filterElements.level.value
      };
    }
    function displayPercent(value){
      return value===null||value===undefined?'—':ui.percent(value);
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
      primary.className='ui-text-vi';
      secondary.className='ui-text-zh';
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
    function targetPageForStatus(status){
      if(status==='attendance-invalid') return 'production-attendance';
      if(status==='production-missing') return 'production-entry';
      return '';
    }
    function canOpenTargetPage(pageName){
      return !!pageName&&typeof window.canOpenPage==='function'&&window.canOpenPage(pageName)===true;
    }
    async function openStatusTarget(group){
      const pageName=targetPageForStatus(group.status);
      if(!canOpenTargetPage(pageName)) return;
      try{
        await window.PCMSFeatures.ensurePageScripts(pageName);
        if(pageName==='production-attendance'){
          if(typeof window.PCMSProductionAttendancePage?.setPendingContext!=='function') throw new Error('Thiếu chức năng chuyển đến chấm công. / 缺少考勤跳轉功能。');
          window.PCMSProductionAttendancePage.setPendingContext({employeeId:group.employeeId,attendanceDate:group.date});
        }else{
          if(typeof window.PCMSProductionEntry?.setPendingContext!=='function') throw new Error('Thiếu chức năng chuyển đến ghi nhận sản xuất. / 缺少生產登記跳轉功能。');
          window.PCMSProductionEntry.setPendingContext({employeeId:group.employeeId,productionDate:group.date});
        }
        await window.sp(pageName);
      }catch(error){ await ui.showError(error); }
    }
    function createStatusValue(group,status){
      const pageName=targetPageForStatus(group.status);
      if(!canOpenTargetPage(pageName)) return createDualValue(status.vi,status.zh,`is-${group.status}`);
      const button=document.createElement('button');
      button.type='button';
      button.className=`production-analysis-dual-value employee-analysis-status-action is-${group.status}`;
      const vi=document.createElement('span');
      const zh=document.createElement('span');
      vi.className='ui-text-vi';
      zh.className='ui-text-zh';
      vi.textContent=status.vi;
      zh.textContent=status.zh;
      button.append(vi,zh);
      button.setAttribute('aria-label',pageName==='production-attendance'
        ?`Mở chấm công ${group.date} của ${group.employeeId} / 開啟 ${group.employeeId} 在 ${group.date} 的考勤`
        :`Mở ghi nhận sản xuất ${group.date} của ${group.employeeId} / 開啟 ${group.employeeId} 在 ${group.date} 的生產登記`);
      button.addEventListener('click',()=>void openStatusTarget(group));
      return button;
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
        {vi:'Vị trí',zh:'高／中／低',width:14,value:row=>positionLabel(row.level)}
      ];
    }
    function explanationAppendix(){
      return [
        {label:'當日效率',content:'（當日標準有效工時 + 補充工時）÷ 當日考勤工時 × 100%。沒有產能、考勤或標準產能時顯示原因，不以 0% 代替。'},
        {label:'員工歷史平均',content:'歷史累計有效工時 ÷ 歷史累計考勤工時 × 100%，不是每天百分比直接平均。'},
        {label:'當日工序效率',content:'該工序標準有效工時 ÷ 後台依標準有效工時比例分攤的加工時間 × 100%。'},
        {label:'該工序個人歷史平均',content:'個人該工序累計標準有效工時 ÷ 個人該工序累計回推加工時間 × 100%。只合併相同款號、工序及秒數／產能版本。'},
        {label:'全線常規平均',content:'1 人採該人資料；2～9 人取中位數；10 人以上排除最高與最低各 20%，平均中間 60%。'},
        {label:'與平常相比',content:'當日效率 − 個人歷史平均；正值表示高於個人平常，負值表示低於個人平常。'},
        {label:'高／中／低',content:'個人工序效率低於全線常規值 90% 為低；介於 90%～110% 為中；高於 110% 為高。'}
      ];
    }
    function applyFilters(){
      if(!dataset) return [];
      const current=filters();
      const rows=calc.employeeAnalysisRows(dataset,current);
      return calc.employeeDailyAnalysisGroups(rows).map(group=>{
        const employeeText=`${group.employeeId} ${group.employeeName}`.toLocaleLowerCase();
        const employeeMatches=!current.search||employeeText.includes(current.search);
        const processes=group.processes.filter(row=>{
          const processText=`${row.productCode} ${row.processNo} ${row.processNameVi} ${row.processNameZh}`.toLocaleLowerCase();
          if(!employeeMatches&&current.search&&!processText.includes(current.search)) return false;
          if(current.level&&row.level!==current.level) return false;
          return true;
        });
        return {group:{...group,processes},employeeMatches};
      }).filter(({group,employeeMatches})=>{
        if(current.search&&!employeeMatches&&!group.processes.length) return false;
        if(current.level&&!group.processes.length) return false;
        if(current.comparison==='below'&&group.comparison!=='below') return false;
        return true;
      }).map(({group})=>group);
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
      detailCell.colSpan=6;
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
        </tr></thead>`;
        const body=document.createElement('tbody');
        group.processes.forEach(row=>{
          const processRow=document.createElement('tr');
          const position=positionText(row.level);
          processRow.append(
            ui.createCell([row.productCode,row.processNo,row.processNameVi].filter(Boolean).join(' / ')||'—'),
            ui.createCell(ui.format(row.quantity),'ui-table-number-cell'),
            ui.createCell(displayPercent(row.currentProcessEfficiency),'ui-table-number-cell'),
            ui.createCell(displayPercent(row.employeeProcessHistoryEfficiency),'ui-table-number-cell'),
            ui.createCell(displayPercent(row.lineTypicalEfficiency),'ui-table-number-cell'),
            createValueCell(createDualValue(position.vi,position.zh,`is-${row.level}`),'ui-table-center-cell')
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
          dailyCell.appendChild(createStatusValue(group,status));
        }

        const historyCell=document.createElement('td');
        historyCell.className='ui-table-number-cell';
        if(group.employeeHistoryEfficiency===null) historyCell.appendChild(createDualValue('Chưa có lịch sử','尚無歷史'));
        else historyCell.textContent=displayPercent(group.employeeHistoryEfficiency);

        const comparison=comparisonText(group);
        const comparisonCell=createValueCell(createDualValue(comparison.vi,comparison.zh,`is-${group.comparison}`),'employee-analysis-comparison-cell');

        tableRow.append(expandCell,ui.createCell(group.date),employeeCell,dailyCell,historyCell,comparisonCell);
        body.appendChild(tableRow);
        if(expanded) body.appendChild(createProcessDetail(group));
      });
      if(!filtered.length){
        const row=document.createElement('tr');
        const cell=ui.createDualCell({vi:'Không có dữ liệu phù hợp.',zh:'沒有符合條件的資料。'},'production-analysis-empty');
        cell.colSpan=6;
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
      return `${ui.dateRangeLabel(current.fromDate,current.toDate)}；Tìm kiếm / 搜尋：${filterElements.search.value||'Tất cả / 全部'}`;
    }
    function showGuide(){
      ui.openExplanation({
        titleVi:'Cách đọc phân tích nhân viên',titleZh:'員工分析使用說明',
        userVi:'Mỗi dòng là kết quả của một nhân viên trong một ngày. Mở dòng để xem các công đoạn đã làm, hiệu suất công đoạn, lịch sử cá nhân và vị trí so với toàn chuyền. Nếu thiếu chấm công, sản lượng hoặc sản lượng tiêu chuẩn, hệ thống sẽ ghi rõ nguyên nhân thay vì hiển thị 0%.',
        userZh:'每一列代表一位員工一天的結果。展開後可查看當日各工序效率、個人工序歷史與全線位置。若缺少考勤、產能或標準產能，系統會直接顯示原因，不再用 0% 代替。每日工序回推加工時間只在後台計算，本頁不呈現。',
        formulaZh:explanationAppendix().map(item=>`${item.label}：${item.content}`).join('\n\n')
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
        ui.setSourceLabel(root.querySelector('[data-role="source"]'),metadata);
        render();
      },
      activate(){render();},leave(){}
    };
  }

  window.PCMSProductionEmployeeAnalysis=Object.freeze({create});
})();
