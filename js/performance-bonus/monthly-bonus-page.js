// monthly-bonus-page（月績效獎金頁）：開頁核對並試算公開員工結果，不讀取保密參數。
(function(){
  'use strict';

  const state={initialized:false,request:0,month:'',metadata:null,employees:[],reference:null};

  function el(id){ return document.getElementById(id); }
  function ui(){ return window.PCMSUIComponents; }
  function store(){ return window.PCMSPerformanceBonusStore; }
  function money(value){ return Math.round(Number(value)||0).toLocaleString('vi-VN'); }
  function bonusFormula(employee){
    const base=Math.round(Number(employee?.baseBonus)||0);
    const adjustment=Math.round(Number(employee?.adjustmentAmount)||0);
    const final=Math.round(Number(employee?.finalBonus)||0);
    if(!adjustment) return `${money(final)} VND`;
    return `${money(base)} ${adjustment>0?'+':'−'} ${money(Math.abs(adjustment))} = ${money(final)} VND`;
  }
  function sortedBonusEmployees(rows){
    return (Array.isArray(rows)?rows:[]).filter(item=>Number(item.finalBonus)>0||Number(item.adjustmentAmount)!==0).slice().sort((left,right)=>{
      const bonusOrder=(Number(right.finalBonus)||0)-(Number(left.finalBonus)||0);
      return bonusOrder||String(left.employeeId||'').localeCompare(String(right.employeeId||''),'en',{numeric:true,sensitivity:'base'});
    });
  }
  function statusPair(status){
    return ({
      draft:{vi:'Đang thử tính',zh:'試算中'},
      locked:{vi:'Đã khóa',zh:'已鎖定'},
      exported:{vi:'Đã xuất',zh:'已匯出'},
      paid:{vi:'Đã phát',zh:'已發放'},
      notReady:{vi:'Chưa sẵn sàng',zh:'尚未就緒'}
    })[status]||{vi:'Chưa có dữ liệu',zh:'尚無資料'};
  }
  function errorDetails(error){
    const code=String(error?.code||error?.cause?.code||'unknown').trim()||'unknown';
    const message=String(error?.message||error?.cause?.message||error||'Không có chi tiết / 無詳細訊息').trim().slice(0,1000);
    return {code,message};
  }
  function errorReason(details){
    const parsed=window.PCMSUIText.parseLegacyPair(details.message);
    if(parsed) return parsed;
    const searchable=`${details.code} ${details.message}`.toLowerCase();
    if(searchable.includes('permission-denied')||searchable.includes('insufficient permissions')){
      return {vi:'Quyền tài khoản hoặc quy tắc bảo mật đã từ chối thao tác.',zh:'帳號權限或安全規則拒絕了這次操作。'};
    }
    if(searchable.includes('1000 expressions')||searchable.includes('resource-exhausted')){
      return {vi:'Quy tắc bảo mật đã vượt giới hạn xử lý.',zh:'安全規則超過運算限制。'};
    }
    if(searchable.includes('requires an index')){
      return {vi:'Truy vấn đang thiếu chỉ mục Firestore cần thiết.',zh:'查詢缺少必要的 Firestore 索引。'};
    }
    if(searchable.includes('aborted')||searchable.includes('transaction')){
      return {vi:'Giao dịch bị xung đột hoặc trạng thái tháng đã thay đổi.',zh:'交易發生衝突，或月份狀態已經改變。'};
    }
    if(searchable.includes('unavailable')||searchable.includes('network')||searchable.includes('offline')){
      return {vi:'Không thể kết nối ổn định với Firebase.',zh:'目前無法穩定連線至 Firebase。'};
    }
    if(searchable.includes('not-found')){
      return {vi:'Không tìm thấy dữ liệu cần thiết để hoàn tất thao tác.',zh:'找不到完成操作所需的資料。'};
    }
    return {vi:'Hệ thống đã trả về lỗi chưa được phân loại; xem chi tiết bên dưới.',zh:'系統回傳尚未分類的錯誤，請查看下方詳細訊息。'};
  }
  function issueCollectionLabel(collectionName,language){
    const labels={
      productionAttendance:{vi:'Chấm công',zh:'考勤'},
      productionEntries:{vi:'Sản lượng',zh:'產能紀錄'},
      productionDaySummaries:{vi:'Tóm tắt ngày',zh:'每日摘要'},
      productionEmployeeMonths:{vi:'Tóm tắt nhân viên theo tháng',zh:'員工月摘要'},
      productionMonths:{vi:'Trạng thái tháng',zh:'月份狀態'},
      productionProcessTotals:{vi:'Tổng số lượng công đoạn',zh:'工序累計'},
      performanceBonusAdjustments:{vi:'Điều chỉnh thưởng',zh:'獎金人工調整'},
      performanceBonusMonths:{vi:'Tóm tắt thưởng tháng',zh:'月份獎金摘要'},
      performanceBonusPrivateMonths:{vi:'Tóm tắt thưởng riêng',zh:'私密獎金摘要'}
    };
    if(String(collectionName||'').startsWith('performanceBonusMonths/')){
      return language==='vi'?'Kết quả thưởng theo nhân viên':'員工獎金結果';
    }
    return labels[collectionName]?.[language]||(language==='vi'?'Dữ liệu cần kiểm tra':'需要檢查的資料');
  }
  function issueLines(issues,language){
    return issues.slice(0,50).map((item,index)=>{
      const parts=[`${index+1}. ${issueCollectionLabel(item.collection,language)}`];
      if(item.documentId) parts.push(language==='vi'?`Mã: ${item.documentId}`:`編號：${item.documentId}`);
      if(item.employeeId) parts.push(language==='vi'?`Nhân viên: ${item.employeeId}`:`員工：${item.employeeId}`);
      if(item.date) parts.push(language==='vi'?`Ngày: ${item.date}`:`日期：${item.date}`);
      return parts.join(' · ');
    });
  }
  function showError(error,stage={vi:'Thao tác thưởng tháng',zh:'月績效操作'}){
    const details=errorDetails(error);
    const reason=errorReason(details);
    console.error(`[月績效] ${stage.zh}失敗`,error);
    const issues=Array.isArray(error?.userIssues)?error.userIssues:[];
    const issueTextVi=issueLines(issues,'vi');
    const issueTextZh=issueLines(issues,'zh');
    const body=document.createElement('div');
    body.appendChild(ui().createLanguageSections({
      vi:`Giai đoạn: ${stage.vi}\nNguyên nhân: ${issues[0]?.vi||reason.vi}${issueTextVi.length?`\n\nBản ghi cần kiểm tra:\n${issueTextVi.join('\n')}`:''}`,
      zh:`發生階段：${stage.zh}\n原因：${issues[0]?.zh||reason.zh}${issueTextZh.length?`\n\n需要檢查的資料：\n${issueTextZh.join('\n')}`:''}`
    }));
    const technical=document.createElement('details');
    const technicalTitle=document.createElement('summary');
    technicalTitle.appendChild(window.PCMSUIText.create({vi:'Chi tiết kỹ thuật (dành cho quản trị viên)',zh:'技術細節（供管理員查看）'}));
    const technicalBody=document.createElement('pre');
    technicalBody.textContent=`code=${details.code}\n${details.message}${error?.technical?`\n${JSON.stringify(error.technical,null,2)}`:''}`;
    technical.append(technicalTitle,technicalBody);
    body.appendChild(technical);
    body.querySelectorAll('.ui-language-section').forEach(section=>{
      section.style.whiteSpace='pre-wrap';
      section.style.overflowWrap='anywhere';
    });
    return ui().alertDialog({
      kind:'danger',title:{vi:'Không thể hoàn tất thao tác',zh:'無法完成操作'},body,size:'wide'
    });
  }
  function renderShell(){
    const root=el('performance-bonus-monthly-root');
    if(!root||root.dataset.ready==='true') return;
    root.dataset.ready='true';
    root.innerHTML=`
      <div class="performance-bonus-page ui-work-panel">
        <section class="performance-bonus-monthly-panel ui-operation-panel">
          <div class="performance-bonus-month-command ui-command-row">
            <label class="performance-bonus-field"><span class="ui-dual-copy"><strong>Tháng thưởng</strong><span>獎金月份</span></span><input type="month" id="performance-bonus-month"></label>
            <div class="performance-bonus-month-status"><span class="ui-dual-copy"><strong>Trạng thái</strong><span>結算狀態</span></span><span id="performance-bonus-status"><span class="ui-dual-copy"><strong>—</strong><span>—</span></span></span></div>
            <button type="button" class="ui-button" id="performance-bonus-reference"><i class="ti ti-table"></i><span class="ui-dual-copy"><strong>Bảng đối chiếu</strong><span>獎金對照表</span></span></button>
            <button type="button" class="ui-button is-primary" id="performance-bonus-export"><i class="ti ti-file-spreadsheet"></i><span class="ui-dual-copy"><strong>Khóa và xuất Excel</strong><span>鎖定並匯出 Excel</span></span></button>
            <button type="button" class="ui-button" id="performance-bonus-paid" hidden><i class="ti ti-cash-banknote"></i><span class="ui-dual-copy"><strong>Đánh dấu đã phát</strong><span>標記已發放</span></span></button>
            <button type="button" class="ui-button is-danger" id="performance-bonus-unlock" hidden><i class="ti ti-lock-open"></i><span class="ui-dual-copy"><strong>Mở khóa tháng</strong><span>解除月份鎖定</span></span></button>
          </div>
          <div class="ui-notice" id="performance-bonus-month-note" hidden></div>
        </section>
        <section class="performance-bonus-list-section ui-data-section">
          <div class="ui-section-header"><i class="ti ti-award"></i><span class="ui-dual-copy"><strong>Thưởng hiệu suất nhân viên trong tháng</strong><span>員工月績效獎金</span></span><span class="performance-bonus-count ui-bilingual"><span id="performance-bonus-count">0</span><span class="ui-text-vi">người</span><span class="performance-bonus-language-divider" aria-hidden="true">/</span><span class="ui-text-zh">人</span><span class="performance-bonus-count-separator" aria-hidden="true">·</span><span class="ui-text-vi">Tổng thưởng</span><span class="performance-bonus-language-divider" aria-hidden="true">/</span><span class="ui-text-zh">獎金總和</span><strong class="performance-bonus-total"><span id="performance-bonus-total">0</span> VND</strong></span></div>
          <div class="ui-table-frame"><div class="ui-table-scroll" data-ui-floating-scroll="only"><table class="ui-table performance-bonus-table" id="performance-bonus-table" data-ui-table-controls="auto" data-ui-table-sort="none" data-ui-table-resizable="true" data-ui-table-sticky="original">
            <thead><tr>
              <th data-ui-table-column="employeeId" data-ui-table-min-width="130" data-ui-table-width="160" data-ui-table-max-width="220"><span class="ui-dual-copy"><strong>Mã nhân viên</strong><span>員工工號</span></span></th>
              <th data-ui-table-column="employeeName" data-ui-table-min-width="180" data-ui-table-width="250" data-ui-table-max-width="360"><span class="ui-dual-copy"><strong>Tên nhân viên</strong><span>員工姓名</span></span></th>
              <th data-ui-table-column="department" data-ui-table-min-width="150" data-ui-table-width="200" data-ui-table-max-width="300"><span class="ui-dual-copy"><strong>Bộ phận</strong><span>部門</span></span></th>
              <th class="ui-table-center-cell" data-ui-table-column="bonus" data-ui-table-min-width="190" data-ui-table-width="230" data-ui-table-max-width="300"><span class="ui-dual-copy"><strong>Tổng thưởng</strong><span>累計獎金</span></span></th>
              <th class="ui-table-center-cell" data-ui-table-column="adjustment" data-ui-table-min-width="210" data-ui-table-width="250" data-ui-table-max-width="340"><span class="ui-dual-copy"><strong>Điều chỉnh</strong><span>調整金額</span></span></th>
              <th class="ui-table-center-cell" data-ui-table-column="action" data-ui-table-min-width="104" data-ui-table-width="116" data-ui-table-max-width="140"><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th>
            </tr></thead><tbody id="performance-bonus-table-body"></tbody>
          </table></div></div>
          <div class="performance-bonus-empty ui-language-sections" id="performance-bonus-empty"><div class="ui-language-section is-vi">Chưa có kết quả thưởng của tháng này.</div><div class="ui-language-section is-zh">此月份尚無獎金結果。</div></div>
        </section>
      </div>`;
  }
  function createCell(row,text,className='',columnKey=''){
    const cell=document.createElement('td');
    cell.textContent=String(text??'');
    if(className) cell.className=className;
    if(columnKey) cell.dataset.uiTableColumn=columnKey;
    row.appendChild(cell);
    return cell;
  }
  function render(){
    const summaryReady=state.metadata?.summaryReady===true
      ||Boolean(state.metadata&&state.metadata.status!=='draft');
    const sourceControlMissing=Boolean(state.metadata)&&state.metadata.sourceControlAvailable===false;
    const status=statusPair(sourceControlMissing?'notReady':state.metadata?.status);
    el('performance-bonus-status').replaceChildren(window.PCMSUIText.create(status));
    const note=el('performance-bonus-month-note');
    note.hidden=false;
    note.replaceChildren(window.PCMSUIText.create(sourceControlMissing
      ?{vi:'Tháng này chưa có trạng thái tháng và tóm tắt sản xuất hoàn chỉnh nên chưa thể khóa hoặc xuất thưởng.',zh:'此月份尚未建立月份狀態及完整生產摘要，因此暫時不能鎖定或匯出獎金。'}
      :!summaryReady
      ?{vi:'Tóm tắt đang tạm dừng nên phân tích và thưởng chưa hiển thị. Chấm công và sản lượng của tháng đang mở vẫn hoạt động bình thường.',zh:'摘要目前暫停，因此分析與獎金暫不顯示；開放月份的考勤與報工仍可正常操作。'}
      :state.metadata
      ?{vi:`Cập nhật lần cuối: ${new Date(Number(state.metadata.updatedAt||state.metadata.calculatedAt)||0).toLocaleString('vi-VN')}`,zh:`最後更新：${new Date(Number(state.metadata.updatedAt||state.metadata.calculatedAt)||0).toLocaleString('zh-TW')}`}
      :{vi:'Tháng này chưa có kết quả tính thử. Hãy kiểm tra dữ liệu chấm công và sản lượng.',zh:'此月份尚無試算結果，請檢查考勤與產能資料。'}));
    const draft=state.metadata?.status==='draft';
    const exportButton=el('performance-bonus-export');
    exportButton.disabled=!state.metadata||!summaryReady;
    exportButton.querySelector('.ui-dual-copy strong').textContent=draft?'Khóa và xuất Excel':'Xuất lại Excel';
    exportButton.querySelector('.ui-dual-copy span').textContent=draft?'鎖定並匯出 Excel':'重新匯出 Excel';
    el('performance-bonus-paid').hidden=state.metadata?.status!=='exported';
    el('performance-bonus-unlock').hidden=!state.metadata||draft||!store().canUnlock();
    const body=el('performance-bonus-table-body');
    body.replaceChildren();
    state.employees.forEach(employee=>{
      const row=document.createElement('tr');
      createCell(row,employee.employeeId,'','employeeId');
      createCell(row,employee.employeeName,'','employeeName');
      createCell(row,employee.department||'—','','department');
      const bonusCell=createCell(row,'','ui-table-center-cell','bonus');
      const amount=document.createElement('button');
      amount.type='button';
      amount.className='performance-bonus-amount';
      amount.textContent=`${money(employee.finalBonus)} VND`;
      amount.title='Xem hiệu suất hằng ngày / 查看每日績效';
      amount.addEventListener('click',()=>void openDaily(employee));
      bonusCell.appendChild(amount);
      const adjustmentCell=createCell(row,'','ui-table-center-cell','adjustment');
      const adjustment=Number(employee.adjustmentAmount)||0;
      if(adjustment){
        const adjustmentBadge=document.createElement('div');
        adjustmentBadge.className=`performance-bonus-adjustment-badge ${adjustment>0?'is-increase':'is-decrease'}`;
        const adjustmentAmount=document.createElement('strong');
        adjustmentAmount.textContent=`${money(Math.abs(adjustment))} VND`;
        adjustmentBadge.appendChild(adjustmentAmount);
        window.PCMSUIText.setLocalizedAttribute(adjustmentBadge,'title',{
          vi:`${adjustment>0?'Tăng':'Giảm'} ${money(Math.abs(adjustment))} VND`,
          zh:`${adjustment>0?'增加':'減少'} ${money(Math.abs(adjustment))} VND`
        });
        adjustmentCell.appendChild(adjustmentBadge);
      }
      const action=createCell(row,'','ui-table-center-cell','action');
      const actions=document.createElement('div');
      actions.className='performance-bonus-row-actions';
      const reason=document.createElement('button');
      reason.type='button';
      reason.className='performance-bonus-action-button';
      reason.classList.toggle('is-disabled',!adjustment);
      reason.setAttribute('aria-disabled',String(!adjustment));
      if(!adjustment) reason.tabIndex=-1;
      reason.innerHTML='<i class="ti ti-message-circle" aria-hidden="true"></i>';
      window.PCMSUIText.setLocalizedAttribute(reason,'title',adjustment
        ?{vi:'Xem lý do điều chỉnh',zh:'查看調整原因'}
        :{vi:'Chưa có lý do điều chỉnh',zh:'尚無調整原因'});
      window.PCMSUIText.setLocalizedAttribute(reason,'aria-label',adjustment
        ?{vi:'Xem lý do điều chỉnh',zh:'查看調整原因'}
        :{vi:'Chưa có lý do điều chỉnh',zh:'尚無調整原因'});
      if(adjustment) reason.addEventListener('click',()=>viewAdjustmentReason(employee));
      const adjust=document.createElement('button');
      adjust.type='button';
      adjust.className='performance-bonus-action-button is-edit';
      adjust.classList.toggle('is-disabled',!draft);
      adjust.setAttribute('aria-disabled',String(!draft));
      if(!draft) adjust.tabIndex=-1;
      adjust.innerHTML='<i class="ti ti-edit" aria-hidden="true"></i>';
      window.PCMSUIText.setLocalizedAttribute(adjust,'title',draft
        ?{vi:'Chỉnh sửa điều chỉnh thưởng',zh:'編輯人工調整'}
        :{vi:'Tháng đã khóa, không thể chỉnh sửa',zh:'月份已凍結，無法編輯'});
      window.PCMSUIText.setLocalizedAttribute(adjust,'aria-label',draft
        ?{vi:'Chỉnh sửa điều chỉnh thưởng',zh:'編輯人工調整'}
        :{vi:'Tháng đã khóa, không thể chỉnh sửa',zh:'月份已凍結，無法編輯'});
      if(draft) adjust.addEventListener('click',()=>void adjustEmployee(employee));
      actions.append(reason,adjust);
      action.appendChild(actions);
      body.appendChild(row);
    });
    const employeeCount=state.employees.filter(employee=>Number(employee.finalBonus)>0).length;
    const bonusTotal=state.employees.reduce((total,employee)=>total+(Number(employee.finalBonus)||0),0);
    el('performance-bonus-count').textContent=String(employeeCount);
    el('performance-bonus-total').textContent=money(bonusTotal);
    el('performance-bonus-empty').hidden=state.employees.length>0;
    window.PCMSUITableControls?.refreshPage?.();
  }
  async function loadMonth(){
    state.month=el('performance-bonus-month').value||store().currentMonth();
    const request=++state.request;
    try{
      const result=await store().loadMonth(state.month,{force:true});
      if(request!==state.request) return;
      state.metadata=result.metadata;
      state.employees=sortedBonusEmployees(result.employees);
      render();
    }catch(error){
      if(request!==state.request) return;
      state.metadata=null;
      state.employees=[];
      render();
      await showError(error,{vi:'Tải dữ liệu thưởng tháng',zh:'載入月績效資料'});
    }
  }
  function monthDates(month){
    const [year,number]=month.split('-').map(Number);
    const from=`${month}-01`;
    const last=new Date(year,number,0).getDate();
    let to=`${month}-${String(last).padStart(2,'0')}`;
    const today=typeof window.formatLocalDate==='function'?window.formatLocalDate(new Date()):new Date().toISOString().slice(0,10);
    if(month===today.slice(0,7)&&to>today) to=today;
    return {from,to};
  }
  async function openDaily(employee){
    const range=monthDates(state.month);
    window.PCMSProductionPerformance?.setPendingContext?.({employeeId:employee.employeeId,employeeName:employee.employeeName,...range});
    await window.sp?.('production-records');
  }
  function viewAdjustmentReason(employee){
    const adjustment=Number(employee.adjustmentAmount)||0;
    if(!adjustment) return;
    const amount=`${money(Math.abs(adjustment))} VND`;
    const reason=String(employee.adjustmentNote||'—');
    const body=ui().createLanguageSections({
      vi:`Nhân viên: ${employee.employeeName}\nĐiều chỉnh: ${adjustment>0?'Tăng':'Giảm'} ${amount}\nLý do: ${reason}`,
      zh:`員工：${employee.employeeName}\n調整：${adjustment>0?'增加':'減少'} ${amount}\n原因：${reason}`
    });
    body.classList.add('performance-bonus-reason-dialog');
    ui().openDialog({
      title:{vi:'Lý do điều chỉnh thưởng',zh:'獎金調整原因'},body,size:'small',actions:[{text:'common.close'}]
    });
  }
  function requestAdjustment(employee){
    return new Promise(resolve=>{
      let settled=false;
      let sign=1;
      const body=document.createElement('div');
      body.className='performance-bonus-adjustment-dialog';
      const current=document.createElement('div');
      current.className='performance-bonus-adjustment-current';
      const currentLabel=window.PCMSUIText.create({vi:'Thưởng hiện tại',zh:'目前獎金'});
      const currentValue=document.createElement('strong');
      currentValue.textContent=bonusFormula(employee);
      current.append(currentLabel,currentValue);
      if(Number(employee.adjustmentAmount)){
        const currentReason=document.createElement('div');
        currentReason.className='performance-bonus-adjustment-current-reason';
        currentReason.append(window.PCMSUIText.create({vi:'Lý do hiện tại',zh:'目前原因'}));
        const currentReasonValue=document.createElement('span');
        currentReasonValue.textContent=employee.adjustmentNote||'—';
        currentReason.appendChild(currentReasonValue);
        current.appendChild(currentReason);
      }
      const modeField=document.createElement('div');
      modeField.className='performance-bonus-adjustment-field';
      modeField.appendChild(window.PCMSUIText.create({vi:'Cách điều chỉnh',zh:'調整方式'}));
      const modeButtons=document.createElement('div');
      modeButtons.className='performance-bonus-adjustment-modes';
      const increase=document.createElement('button');
      increase.type='button';increase.className='is-active';
      increase.appendChild(window.PCMSUIText.create({vi:'+ Tăng',zh:'+ 增加'}));
      const decrease=document.createElement('button');
      decrease.type='button';
      decrease.appendChild(window.PCMSUIText.create({vi:'− Giảm',zh:'− 減少'}));
      modeButtons.append(increase,decrease);modeField.appendChild(modeButtons);
      const amountField=document.createElement('label');
      amountField.className='performance-bonus-adjustment-field';
      amountField.appendChild(window.PCMSUIText.create({vi:'Số tiền điều chỉnh',zh:'調整金額'}));
      const amountWrap=document.createElement('span');
      amountWrap.className='performance-bonus-adjustment-amount';
      const amount=document.createElement('input');
      amount.type='number';amount.min='0';amount.step='1';amount.inputMode='numeric';amount.placeholder='0';
      const currency=document.createElement('span');currency.textContent='VND';
      amountWrap.append(amount,currency);amountField.appendChild(amountWrap);
      const noteField=document.createElement('label');
      noteField.className='performance-bonus-adjustment-field';
      noteField.appendChild(window.PCMSUIText.create({vi:'Lý do điều chỉnh',zh:'調整原因'}));
      const note=document.createElement('textarea');
      note.maxLength=200;note.rows=3;
      window.PCMSUIText.setLocalizedAttribute(note,'placeholder',{vi:'Nhập lý do tăng hoặc giảm',zh:'請填寫增加或減少的原因'});
      noteField.appendChild(note);
      const preview=document.createElement('div');
      preview.className='performance-bonus-adjustment-preview';
      preview.appendChild(window.PCMSUIText.create({vi:'Sau điều chỉnh',zh:'調整後'}));
      const previewValue=document.createElement('strong');preview.appendChild(previewValue);
      body.append(current,modeField,amountField,noteField,preview);
      const updatePreview=()=>{
        const raw=Number(amount.value);
        if(!Number.isInteger(raw)||raw<=0){ previewValue.textContent=`${money(employee.baseBonus)} VND`; return; }
        const adjustment=sign*raw;
        previewValue.textContent=`${money(employee.baseBonus)} ${adjustment>0?'+':'−'} ${money(raw)} = ${money(Number(employee.baseBonus)+adjustment)} VND`;
      };
      const setSign=next=>{
        sign=next;increase.classList.toggle('is-active',sign===1);decrease.classList.toggle('is-active',sign===-1);updatePreview();
      };
      increase.addEventListener('click',()=>setSign(1));
      decrease.addEventListener('click',()=>setSign(-1));
      amount.addEventListener('input',updatePreview);
      const validate=(allowZero=false)=>{
        const rawText=amount.value.trim();
        const raw=Number(rawText);
        const reason=note.value.trim();
        const clearsAdjustment=allowZero||(rawText!==''&&raw===0);
        const validAmount=clearsAdjustment||(Number.isInteger(raw)&&raw>0&&Number(employee.baseBonus)+sign*raw>=0);
        amount.setCustomValidity(validAmount?'':sign<0&&Number.isInteger(raw)&&raw>Number(employee.baseBonus)
          ?'Số tiền giảm quá lớn / 減少金額不可超過系統獎金':'Chỉ nhập số nguyên từ 0 trở lên / 請輸入大於或等於 0 的整數');
        note.setCustomValidity(clearsAdjustment||reason?'':'Cần nhập lý do / 請填寫原因');
        if(!validAmount){ amount.reportValidity(); return null; }
        if(!clearsAdjustment&&!reason){ note.reportValidity(); return null; }
        return clearsAdjustment?{amount:0,note:''}:{amount:sign*raw,note:reason};
      };
      const actions=[];
      if(Number(employee.adjustmentAmount)) actions.push({
        text:{vi:'Hủy điều chỉnh hiện tại',zh:'取消目前調整'},kind:'danger',
        onClick:()=>{ const result=validate(true); if(!result) return false; settled=true;resolve(result);return true; }
      });
      actions.push(
        {text:'common.cancel',onClick:()=>{ settled=true;resolve(null); }},
        {text:{vi:'Xác nhận điều chỉnh',zh:'確認調整'},kind:'primary',onClick:()=>{
          const result=validate(false);if(!result) return false;settled=true;resolve(result);return true;
        }}
      );
      ui().openDialog({
        title:{vi:`Điều chỉnh thưởng · ${employee.employeeName}`,zh:`人工調整獎金 · ${employee.employeeName}`},
        body,size:'large',actions,onClose:()=>{if(!settled) resolve(null);}
      });
      updatePreview();
    });
  }
  async function adjustEmployee(employee){
    const adjustment=await requestAdjustment(employee);
    if(!adjustment) return;
    try{
      const result=await store().adjustEmployee(state.month,employee.employeeId,adjustment.amount,adjustment.note);
      ui().showToast({kind:'success',message:{vi:'Đã lưu điều chỉnh thưởng.',zh:'人工獎金調整已儲存。'}});
      state.metadata=result.metadata;
      state.employees=sortedBonusEmployees(result.employees);
      render();
    }catch(error){ await showError(error); }
  }
  function openReference(){
    const rows=Array.isArray(state.reference?.rows)?state.reference.rows:[];
    if(!rows.length){ void ui().alertDialog({kind:'warning',message:{vi:'Chưa có bảng đối chiếu.',zh:'尚無獎金對照表。'}}); return; }
    const frame=document.createElement('div');
    frame.className='ui-table-frame performance-bonus-reference-frame';
    const scroll=document.createElement('div');
    scroll.className='ui-table-scroll';
    const table=document.createElement('table');
    table.className='ui-table performance-bonus-reference-table';
    const head=document.createElement('thead');
    const headRow=document.createElement('tr');
    [
      {vi:'Hiệu suất',zh:'效率'},
      {vi:'8 giờ',zh:'8 小時'},
      {vi:'11,5 giờ',zh:'11.5 小時'}
    ].forEach(copy=>{ const th=document.createElement('th'); th.appendChild(window.PCMSUIText.create(copy)); headRow.appendChild(th); });
    head.appendChild(headRow);
    const body=document.createElement('tbody');
    rows.forEach(item=>{
      const row=document.createElement('tr');
      createCell(row,`${item.efficiency}%`);
      createCell(row,`${money(item.hours8)} VND`,'ui-table-number-cell');
      createCell(row,`${money(item.hours115)} VND`,'ui-table-number-cell');
      body.appendChild(row);
    });
    table.append(head,body); scroll.appendChild(table); frame.appendChild(scroll);
    ui().openDialog({title:{vi:'Bảng đối chiếu thưởng hiệu suất',zh:'績效獎金對照表'},body:frame,size:'large',actions:[{text:'common.close'}]});
  }
  function safeSpreadsheetValue(value){ return typeof value==='string'&&/^[=+\-@]/.test(value)?`'${value}`:value; }
  async function exportMonth(){
    if(!state.metadata) return;
    const draft=state.metadata.status==='draft';
    const confirmed=await ui().confirmDialog({
      title:draft?{vi:'Xác nhận khóa và xuất',zh:'確認鎖定並匯出'}:{vi:'Xác nhận xuất lại',zh:'確認重新匯出'},
      body:ui().createLanguageSections(draft
        ?{vi:'Sau khi chọn vị trí lưu, hệ thống sẽ khóa toàn bộ tháng rồi xuất Excel. Muốn sửa lại phải dùng quyền mở khóa.',zh:'選擇儲存位置後，系統會鎖定整個月份再匯出 Excel；如需修改，必須使用解除鎖定權限。'}
        :{vi:'Hệ thống sẽ xuất lại kết quả đã khóa của tháng này.',zh:'系統將重新匯出此月份已鎖定的結果。'}),
      confirmText:{vi:'Tiếp tục',zh:'繼續'}
    });
    if(!confirmed) return;
    const suggestedName=`Thuong_hieu_suat_${state.month}.xlsx`;
    const handle=await window.PCMSFileIO.chooseSaveHandle({
      suggestedName,types:[window.PCMSFileIO.spreadsheetFileType],
      onUnsupported:()=>ui().alertDialog({kind:'danger',message:{vi:'Trình duyệt không hỗ trợ chọn vị trí lưu. Đã dừng xuất.',zh:'瀏覽器不支援選擇儲存位置，已停止匯出。'}})
    });
    if(!handle) return;
    return ui().runActionOnce(`performanceBonus.export.${state.month}`,async()=>{
      try{
        if(draft){
          await store().lockMonth(state.month);
          const refreshed=await store().loadMonth(state.month,{force:true});
          state.metadata=refreshed.metadata;
          state.employees=sortedBonusEmployees(refreshed.employees);
        }
        const spreadsheet=await window.PCMSFeatures.ensureSpreadsheetTool();
        const rows=state.employees.filter(item=>Number(item.finalBonus)>0).map(item=>[
          safeSpreadsheetValue(item.employeeId),safeSpreadsheetValue(item.employeeName),Math.round(Number(item.finalBonus)||0)
        ]);
        const sheet=spreadsheet.utils.aoa_to_sheet([
          ['Mã nhân viên / 員工工號','Tên nhân viên / 員工姓名','Tổng thưởng / 獎金總額'],...rows
        ]);
        sheet['!cols']=[{wch:18},{wch:34},{wch:20}];
        const workbook=spreadsheet.utils.book_new();
        spreadsheet.utils.book_append_sheet(workbook,sheet,'Thuong_績效獎金');
        await window.PCMSFileIO.writeWorkbookToHandle(handle,workbook,spreadsheet);
        await store().markExported(state.month,handle.name||suggestedName);
        ui().showToast({kind:'success',message:{vi:'Đã khóa tháng và xuất Excel.',zh:'月份已鎖定並匯出 Excel。'}});
      }catch(error){ await showError(error); }
      finally{ await loadMonth(); }
    });
  }
  async function markPaid(){
    const confirmed=await ui().confirmDialog({
      title:{vi:'Xác nhận đã phát thưởng',zh:'確認獎金已發放'},
      body:ui().createLanguageSections({vi:'Đánh dấu toàn bộ tháng này là đã phát thưởng?',zh:'確定將整個月份標記為獎金已發放？'})
    });
    if(!confirmed) return;
    try{ await store().markPaid(state.month); await loadMonth(); }
    catch(error){ await showError(error); }
  }
  async function unlockMonth(){
    await ui().alertDialog({kind:'info',message:{vi:'Chức năng chưa được kết nối.',zh:'功能尚未接入。'}});
  }
  function bind(){
    el('performance-bonus-month').addEventListener('change',()=>void loadMonth());
    el('performance-bonus-reference').addEventListener('click',openReference);
    el('performance-bonus-export').addEventListener('click',()=>void exportMonth());
    el('performance-bonus-paid').addEventListener('click',()=>void markPaid());
    el('performance-bonus-unlock').addEventListener('click',()=>void unlockMonth());
  }
  async function loadPerformanceBonusData(){ return true; }
  async function performanceBonusInit(){
    renderShell();
    if(!state.initialized){ state.initialized=true; bind(); }
    el('performance-bonus-month').value=state.month||store().currentMonth();
    state.metadata=null;
    state.employees=[];
    render();
    try{
      state.reference=await store().loadReferenceTable({force:true});
      await loadMonth();
    }catch(error){ await showError(error); }
  }
  function performanceBonusLeave(){ state.request+=1; }

  window.loadPerformanceBonusData=loadPerformanceBonusData;
  window.performanceBonusInit=performanceBonusInit;
  window.performanceBonusLeave=performanceBonusLeave;
})();
