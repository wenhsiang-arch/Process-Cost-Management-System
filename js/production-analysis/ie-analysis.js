// ie-analysis.js（IE 分析）：用全產線常規資料找出標準秒數差異，供現場優先查核。
(function(){
  'use strict';

  const PAGE_SIZE=50;

  function create(root){
    const ui=window.PCMSProductionAnalysisUI;
    const calc=window.PCMSProductionAnalysisCalculations;
    let dataset=null;
    let filtered=[];
    let page=1;
    let initializedDates=false;
    const selectedKeys=new Set();

    root.innerHTML=`
      <div class="ui-operation-panel production-analysis-operation-panel">
        <div class="ui-command-row">
          <div class="production-analysis-filter-grid">
            ${ui.dateField('ie','from','Từ ngày','開始日期')}
            ${ui.dateField('ie','to','Đến ngày','結束日期')}
            <div class="ui-form-field"><label>${ui.dual('Bộ phận','部門')}</label><select data-filter="department"></select></div>
            <div class="ui-form-field"><label>${ui.dual('Mã hàng hoặc công đoạn','款號或工序')}</label><input type="search" data-filter="search" placeholder="Nhập từ khóa / 輸入關鍵字"></div>
            <div class="ui-form-field"><label>${ui.dual('Chênh lệch ít nhất','最小差異')}</label><div class="production-analysis-suffix-input"><input type="number" min="0" max="300" step="1" value="15" data-filter="threshold"><span>%</span></div></div>
            <div class="ui-form-field"><label>${ui.dual('Hướng chênh lệch','差異方向')}</label><select data-filter="direction"><option value="">Hai hướng / 兩方向</option><option value="higher">Giây đề nghị cao hơn / 建議秒數較高</option><option value="lower">Giây đề nghị thấp hơn / 建議秒數較低</option></select></div>
            <div class="ui-form-field"><label>${ui.dual('Độ tin cậy','可信度')}</label><select data-filter="confidence"><option value="">Tất cả / 全部</option><option value="low">Thấp / 低</option><option value="medium">Trung bình / 中</option><option value="high">Cao / 高</option></select></div>
          </div>
          <div class="ui-command-actions">
            <button type="button" class="ui-command-action" data-action="guide"><i class="ti ti-help-circle"></i>${ui.dual('Hướng dẫn','使用說明')}</button>
            <button type="button" class="ui-command-action" data-action="print"><i class="ti ti-printer"></i>${ui.dual('In để kiểm tra','列印查核')}</button>
            <button type="button" class="ui-command-action is-primary" data-action="export"><i class="ti ti-file-spreadsheet"></i>${ui.dual('Xuất Excel','匯出表格')}</button>
          </div>
        </div>
      </div>
      <div class="production-analysis-source" data-role="source"></div>
      <div class="ui-summary-row production-analysis-summary">
        <div class="ui-summary-item"><div class="ui-summary-label">${ui.dual('Công đoạn bất thường','異常工序')}</div><div class="ui-summary-value" data-summary="rows">0</div></div>
        <div class="ui-summary-item is-danger"><div class="ui-summary-label">${ui.dual('Ưu tiên cao','高優先')}</div><div class="ui-summary-value" data-summary="high">0</div></div>
        <div class="ui-summary-item"><div class="ui-summary-label">${ui.dual('Giờ hiệu quả tích lũy','累積有效工時')}</div><div class="ui-summary-value" data-summary="hours">0 h</div></div>
        <div class="ui-summary-item is-warning"><div class="ui-summary-label">${ui.dual('Đã chọn để in','已選列印')}</div><div class="ui-summary-value" data-summary="selected">0</div></div>
      </div>
      <section class="ui-data-section">
        <div class="ui-section-header"><i class="ti ti-adjustments-exclamation"></i>${ui.dual('Danh sách kiểm tra sai lệch thời gian chuẩn','標準工時差異查核清單')}</div>
        <div class="ui-table-frame"><div class="ui-table-scroll" data-ui-floating-scroll="only">
          <table class="ui-table production-analysis-table ie-analysis-table" data-ui-table-controls="auto" data-ui-table-sticky="original">
            <thead><tr>
              <th class="ui-table-center-cell" data-ui-table-column="select" data-ui-table-sortable="false">${ui.dual('Chọn','選取')}</th>
              <th data-ui-table-column="process">${ui.dual('Mã hàng / công đoạn','款號／工序')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="currentSeconds" data-ui-table-sort-type="number">${ui.dual('Giây tiêu chuẩn hiện tại','目前標準秒數')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="suggestedSeconds" data-ui-table-sort-type="number">${ui.dual('Giây hồi tính đề nghị','回推建議秒數')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="difference" data-ui-table-sort-type="number">${ui.dual('Chênh lệch','差異')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="rawEfficiency" data-ui-table-sort-type="number">${ui.dual('Hiệu suất toàn bộ','全部綜合效率')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="typicalEfficiency" data-ui-table-sort-type="number">${ui.dual('Hiệu suất thông thường','常規效率')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="hours" data-ui-table-sort-type="number">${ui.dual('Giờ hiệu quả tích lũy','累積有效工時')}</th>
              <th class="ui-table-number-cell" data-ui-table-column="people" data-ui-table-sort-type="number">${ui.dual('Số nhân viên','員工人數')}</th>
              <th class="ui-table-center-cell" data-ui-table-column="confidence">${ui.dual('Độ tin cậy','可信度')}</th>
              <th class="ui-table-center-cell" data-ui-table-column="priority">${ui.dual('Ưu tiên','優先級')}</th>
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
        department:filterElements.department.value,
        search:filterElements.search.value.trim().toLocaleLowerCase(),
        threshold:Math.max(0,Number(filterElements.threshold.value)||0),
        direction:filterElements.direction.value,confidence:filterElements.confidence.value
      };
    }
    function confidenceLabel(confidence){
      const level={low:'Thấp / 低',medium:'Trung bình / 中',high:'Cao / 高'}[confidence?.level]||'—';
      return `${level}（≈${confidence?.displayPercent||'—'}）`;
    }
    function confidencePair(confidence){
      const level={low:{vi:'Thấp',zh:'低'},medium:{vi:'Trung bình',zh:'中'},high:{vi:'Cao',zh:'高'}}[confidence?.level]||{vi:'—',zh:'—'};
      const percent=confidence?.displayPercent||'—';
      return {vi:`${level.vi}（≈${percent}）`,zh:`${level.zh}（≈${percent}）`};
    }
    function priority(row){ return Math.abs(row.differencePercent||0)>=30?'high':'medium'; }
    function priorityLabel(row){ return priority(row)==='high'?'Cao / 高':'Trung bình / 中'; }
    function priorityPair(row){ return priority(row)==='high'?{vi:'Cao',zh:'高'}:{vi:'Trung bình',zh:'中'}; }
    function exportColumns(){
      return [
        {key:'productCode',vi:'Mã hàng',zh:'款號',width:16},{key:'processNo',vi:'Số công đoạn',zh:'工序號',width:12},
        {vi:'Tên công đoạn',zh:'工序名稱',width:28,value:row=>row.processNameZh||row.processNameVi},
        {vi:'Giây tiêu chuẩn hiện tại',zh:'目前標準秒數',width:18,value:row=>ui.seconds(row.currentSeconds)},
        {vi:'Giây hồi tính đề nghị',zh:'回推建議秒數',width:18,value:row=>ui.seconds(row.suggestedSeconds)},
        {vi:'Chênh lệch giây',zh:'差異秒數',width:14,value:row=>ui.seconds((row.suggestedSeconds??0)-(row.currentSeconds??0))},
        {vi:'Tỷ lệ chênh lệch',zh:'差異率',width:14,value:row=>ui.percent(row.differencePercent)},
        {vi:'Hiệu suất toàn bộ',zh:'全部綜合效率',width:16,value:row=>ui.percent(row.rawEfficiency)},
        {vi:'Hiệu suất thông thường',zh:'常規效率',width:16,value:row=>ui.percent(row.typicalEfficiency)},
        {vi:'Giờ hiệu quả tích lũy',zh:'累積有效工時',width:17,value:row=>ui.hours(row.cumulativeStandardHours)},
        {vi:'Số nhân viên',zh:'員工人數',width:12,value:row=>row.participantCount},
        {vi:'Độ tin cậy',zh:'可信度',width:18,value:row=>confidenceLabel(row.confidence)},
        {vi:'Ưu tiên',zh:'優先級',width:14,value:priorityLabel}
      ];
    }
    function explanationAppendix(){
      return [
        {label:'可分配生產時間',content:'考勤總工時 − 補充工時。補充工時不分攤到工序。'},
        {label:'回推加工時間',content:'（考勤總工時 − 補充工時）× 該工序標準有效工時 ÷ 當日全部工序標準有效工時。'},
        {label:'回推秒數',content:'回推加工時間 × 3,000 秒 ÷ 生產數量。使用 3,000 秒，是因款號表每小時產能以 50 分鐘有效生產時間計算；每日回推時間只在後台計算。'},
        {label:'全部綜合效率',content:'全部員工的標準有效工時合計 ÷ 回推加工時間合計 × 100%，不排除特別快或特別慢的人員。'},
        {label:'常規效率',content:'先依人員彙整效率，再套用常規資料規則，用來降低極端強人或長期偏低人員對全線參考值的影響。'},
        {label:'常規資料',content:'1 人採該人資料；2～9 人取中位數；10 人以上排除最高與最低各 20%，平均中間 60%。'},
        {label:'差異',content:'差異秒數 = 回推建議秒數 − 目前標準秒數；差異率 = 差異秒數 ÷ 目前標準秒數 × 100%。正值代表回推時間較長，負值代表回推時間較短。'},
        {label:'優先級',content:'差異率絕對值達 30% 為高優先，其餘符合目前篩選門檻的資料為中優先。只用來安排 IE 現場查核順序。'},
        {label:'可信度',content:'5 小時約 58%、10 小時約 70%、20 小時約 80%、30 小時約 85%、50 小時約 93%、100 小時約 97%、200 小時約 99%。這是落在實際值 ±10% 內的模擬機會，不是保證。'},
        {label:'樣本資料',content:'畫面同時呈現員工人數與累積有效工時；可信度只以累積有效工時判定，不以員工人數或生產天數限制是否顯示。'},
        {label:'版本與使用限制',content:'建議秒數只供 IE 現場查核，不會自動修改款號表。標準秒數或每小時產能快照不同時會分開統計。'}
      ];
    }
    function applyFilters(){
      if(!dataset) return [];
      const current=filters();
      return calc.ieAnalysisRows(dataset,current).filter(row=>{
        const rowText=`${row.productCode} ${row.processNo} ${row.processNameVi} ${row.processNameZh}`.toLocaleLowerCase();
        if(current.search&&!rowText.includes(current.search)) return false;
        if(row.differencePercent===null||Math.abs(row.differencePercent)<current.threshold) return false;
        if(current.direction==='higher'&&row.differencePercent<=0) return false;
        if(current.direction==='lower'&&row.differencePercent>=0) return false;
        if(current.confidence&&row.confidence.level!==current.confidence) return false;
        return true;
      }).sort((a,b)=>Math.abs(b.differencePercent)-Math.abs(a.differencePercent));
    }
    function renderSummary(){
      root.querySelector('[data-summary="rows"]').textContent=filtered.length;
      root.querySelector('[data-summary="high"]').textContent=filtered.filter(row=>priority(row)==='high').length;
      root.querySelector('[data-summary="hours"]').textContent=ui.hours(filtered.reduce((sum,row)=>sum+row.cumulativeStandardHours,0));
      root.querySelector('[data-summary="selected"]').textContent=selectedKeys.size;
    }
    function renderTable(){
      const body=root.querySelector('tbody');
      body.replaceChildren();
      const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
      if(page>totalPages) page=totalPages;
      filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).forEach(row=>{
        const tableRow=document.createElement('tr');
        const selectCell=document.createElement('td');
        selectCell.className='ui-table-center-cell';
        const checkbox=document.createElement('input');
        checkbox.type='checkbox';
        checkbox.checked=selectedKeys.has(row.key);
        checkbox.setAttribute('aria-label',`Chọn ${row.productCode} ${row.processNo} / 選取 ${row.productCode} ${row.processNo}`);
        checkbox.addEventListener('change',()=>{
          if(checkbox.checked) selectedKeys.add(row.key); else selectedKeys.delete(row.key);
          renderSummary();
        });
        selectCell.appendChild(checkbox);
        tableRow.append(
          selectCell,
          ui.createCell([row.productCode,row.processNo,row.processNameZh||row.processNameVi].filter(Boolean).join(' / ')),
          ui.createCell(ui.seconds(row.currentSeconds),'ui-table-number-cell'),
          ui.createCell(ui.seconds(row.suggestedSeconds),'ui-table-number-cell'),
          ui.createCell(`${ui.seconds((row.suggestedSeconds??0)-(row.currentSeconds??0))}\n${ui.percent(row.differencePercent)}`,'ui-table-number-cell'),
          ui.createCell(ui.percent(row.rawEfficiency),'ui-table-number-cell'),
          ui.createCell(ui.percent(row.typicalEfficiency),'ui-table-number-cell'),
          ui.createCell(ui.hours(row.cumulativeStandardHours),'ui-table-number-cell'),
          ui.createCell(row.participantCount,'ui-table-number-cell')
        );
        const confidenceCell=ui.createDualCell(confidencePair(row.confidence),'ui-table-center-cell');
        confidenceCell.dataset.confidence=row.confidence.level;
        const priorityCell=ui.createDualCell(priorityPair(row),'ui-table-center-cell');
        priorityCell.dataset.priority=priority(row);
        tableRow.append(confidenceCell,priorityCell);
        body.appendChild(tableRow);
      });
      if(!filtered.length){
        const row=document.createElement('tr');
        const cell=ui.createDualCell({vi:'Không có dữ liệu bất thường phù hợp.',zh:'沒有符合條件的異常資料。'},'production-analysis-empty');
        cell.colSpan=11;
        row.appendChild(cell);
        body.appendChild(row);
      }
      root.querySelector('[data-role="page-info"]').textContent=`${page} / ${totalPages}（${filtered.length}）`;
      root.querySelector('[data-page="previous"]').disabled=page<=1;
      root.querySelector('[data-page="next"]').disabled=page>=totalPages;
      ui.refreshTableTools();
    }
    function render(){ filtered=applyFilters();renderSummary();renderTable(); }
    function filterSummary(){
      const current=filters();
      return `${ui.dateRangeLabel(current.fromDate,current.toDate)}；Bộ phận / 部門：${current.department||'Tất cả / 全部'}；Chênh lệch / 差異：≥ ${current.threshold}%`;
    }
    function selectedOrFiltered(){
      const selected=filtered.filter(row=>selectedKeys.has(row.key));
      return selected.length?selected:filtered;
    }
    function showGuide(){
      ui.openExplanation({
        titleVi:'Cách dùng danh sách IE',titleZh:'IE 分析使用說明',
        userVi:'Hệ thống dùng dữ liệu sản xuất toàn chuyền để tìm công đoạn có giây hồi tính chênh lệch lớn với giây tiêu chuẩn hiện tại. IE có thể lọc, chọn và in danh sách để kiểm tra tại chuyền. Kết quả chỉ là tham khảo ưu tiên, không tự động sửa giây.',
        userZh:'系統用全產線歷史資料找出回推秒數與目前標準秒數差異較大的工序。IE 可篩選、勾選並列印到產線查核。結果只是除錯優先參考，不會自動修改標準工時。',
        formulaZh:explanationAppendix().map(item=>`${item.label}：${item.content}`).join('\n\n')
      });
    }
    async function exportRows(){
      const rows=selectedOrFiltered();
      await window.PCMSProductionAnalysisExport.exportWorkbook({
        title:'Phân tích bất thường IE / IE 異常分析',filePrefix:'Phan_tich_IE_IE異常分析',
        rows,columns:exportColumns(),filterSummary:filterSummary(),explanations:explanationAppendix()
      });
    }
    async function printRows(){
      const rows=selectedOrFiltered();
      await window.PCMSProductionAnalysisExport.printRows({
        title:'Danh sách IE kiểm tra tại chuyền / IE 產線查核表',rows,columns:exportColumns(),filterSummary:filterSummary(),
        handwritingColumns:[{vi:'Giây thực đo',zh:'實測秒數'},{vi:'Nguyên nhân',zh:'原因'},{vi:'Kiến nghị',zh:'建議'},{vi:'Người kiểm tra / ngày',zh:'查核人／日期'}],
        formulaAppendix:explanationAppendix().map(item=>`${item.label}：${item.content}`).join('\n')
      });
    }

    root.querySelectorAll('[data-filter]').forEach(element=>element.addEventListener(element.tagName==='INPUT'?'input':'change',()=>{page=1;render();}));
    root.querySelector('[data-action="guide"]').addEventListener('click',showGuide);
    root.querySelector('[data-action="export"]').addEventListener('click',exportRows);
    root.querySelector('[data-action="print"]').addEventListener('click',printRows);
    root.querySelector('[data-page="previous"]').addEventListener('click',()=>{if(page>1){page-=1;renderTable();}});
    root.querySelector('[data-page="next"]').addEventListener('click',()=>{if(page*PAGE_SIZE<filtered.length){page+=1;renderTable();}});

    return {
      setData(nextDataset,metadata={}){
        dataset=nextDataset;
        ui.fillSelect(filterElements.department,ui.uniqueSorted(dataset?.days?.map(item=>item.department)||[]),'Tất cả bộ phận','全部部門');
        if(!initializedDates){
          filterElements.from.value=ui.earliestDate(dataset);
          filterElements.to.value=ui.latestDate(dataset);
          initializedDates=true;
        }
        dateControls.sync();
        ui.setSourceLabel(root.querySelector('[data-role="source"]'),metadata);
        render();
      },
      activate(){render();},leave(){}
    };
  }

  window.PCMSProductionIEAnalysis=Object.freeze({create});
})();
