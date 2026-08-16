// bonus-settings-page（績效獎金參數頁）：顯示保密參數，並在開頁時核對試算結果與公司損益。
(function(){
  'use strict';

  const state={initialized:false,request:0,month:'',settings:null,metadata:null,privateMonth:null};

  function el(id){ return document.getElementById(id); }
  function ui(){ return window.PCMSUIComponents; }
  function store(){ return window.PCMSPerformanceBonusStore; }
  function currentMonth(){ return store().currentMonth(); }
  function money(value){ return Math.round(Number(value)||0).toLocaleString('vi-VN'); }
  function statusPair(status){
    return ({
      draft:{vi:'Đang thử tính',zh:'試算中'},
      locked:{vi:'Đã khóa',zh:'已鎖定'},
      exported:{vi:'Đã xuất',zh:'已匯出'},
      paid:{vi:'Đã phát',zh:'已發放'}
    })[status]||{vi:'Chưa tính',zh:'尚未試算'};
  }
  function showError(error){
    return ui().alertDialog({kind:'danger',message:window.PCMSUIText.errorPair(error)});
  }
  function toast(message){ ui().showToast({kind:'success',message}); }
  function setBusy(busy){
    ['performance-bonus-settings-save'].forEach(id=>{ const button=el(id); if(button) button.disabled=busy; });
  }
  function renderShell(){
    const root=el('performance-bonus-settings-root');
    if(!root||root.dataset.ready==='true') return;
    root.dataset.ready='true';
    root.innerHTML=`
      <div class="performance-bonus-page ui-work-panel">
        <section class="performance-bonus-settings-panel ui-operation-panel">
          <div class="ui-section-header"><i class="ti ti-adjustments-dollar"></i><span class="ui-dual-copy"><strong>Tham số thưởng hiệu suất</strong><span>績效獎金參數</span></span></div>
          <div class="performance-bonus-settings-grid">
            <label class="performance-bonus-field"><span class="ui-dual-copy"><strong>Đơn giá 1% mỗi giờ</strong><span>每小時 1% 單價</span></span><input type="number" id="performance-bonus-unit-price" min="1" step="1" inputmode="numeric"></label>
            <label class="performance-bonus-field"><span class="ui-dual-copy"><strong>Tỷ lệ công ty</strong><span>公司分成</span></span><div class="performance-bonus-suffix-control"><input type="number" id="performance-bonus-company-share" min="0" max="100" step="0.01" inputmode="decimal"><span>%</span></div></label>
            <label class="performance-bonus-field"><span class="ui-dual-copy"><strong>Tỷ lệ nhân viên</strong><span>員工分成</span></span><div class="performance-bonus-suffix-control"><input type="number" id="performance-bonus-employee-share" readonly tabindex="-1"><span>%</span></div></label>
            <label class="performance-bonus-field"><span class="ui-dual-copy"><strong>Giới hạn hiệu suất tính thưởng</strong><span>績效獎金效率上限</span></span><div class="performance-bonus-suffix-control"><input type="number" id="performance-bonus-efficiency-cap" min="80" max="1000" step="1" inputmode="numeric"><span>%</span></div></label>
            <div class="performance-bonus-fixed-rule"><span class="ui-dual-copy"><strong>Mốc hiệu suất cố định</strong><span>固定效率基準</span></span><b>80%</b></div>
            <div class="performance-bonus-fixed-rule"><span class="ui-dual-copy"><strong>Giờ tối thiểu tính thưởng</strong><span>最低計獎工時</span></span><b>8</b></div>
          </div>
          <div class="performance-bonus-settings-actions ui-command-actions">
            <button type="button" class="ui-button is-primary" id="performance-bonus-settings-save"><i class="ti ti-device-floppy"></i><span class="ui-dual-copy"><strong>Lưu tham số</strong><span>儲存參數</span></span></button>
          </div>
        </section>
        <section class="performance-bonus-month-panel ui-operation-panel">
          <div class="performance-bonus-month-command ui-command-row">
            <label class="performance-bonus-field"><span class="ui-dual-copy"><strong>Tháng tính thưởng</strong><span>獎金月份</span></span><input type="month" id="performance-bonus-settings-month"></label>
            <div class="performance-bonus-month-status"><span class="ui-dual-copy"><strong>Trạng thái</strong><span>結算狀態</span></span><span id="performance-bonus-settings-status"><span class="ui-dual-copy"><strong>—</strong><span>—</span></span></span></div>
          </div>
          <div class="ui-notice" id="performance-bonus-settings-note" hidden></div>
        </section>
        <section class="performance-bonus-company-section ui-data-section">
          <div class="ui-section-header"><i class="ti ti-building-bank"></i><span class="ui-dual-copy"><strong>Lãi / lỗ hiệu suất của công ty</strong><span>公司效率損益</span></span></div>
          <div class="performance-bonus-company-empty ui-language-sections" id="performance-bonus-company-empty"><div class="ui-language-section is-vi">Chỉ thống kê tháng đã khóa hoặc đã xuất.</div><div class="ui-language-section is-zh">僅統計已鎖定或已匯出的月份。</div></div>
          <div class="performance-bonus-metric-grid" id="performance-bonus-company-metrics" hidden>
            <div class="performance-bonus-metric is-positive"><span class="ui-dual-copy"><strong>Giá trị tăng thêm</strong><span>額外效益</span></span><b id="performance-bonus-company-gross">0</b><small>VND</small></div>
            <div class="performance-bonus-metric is-negative"><span class="ui-dual-copy"><strong>Tổn thất hiệu suất</strong><span>效率工損</span></span><b id="performance-bonus-company-loss">0</b><small>VND</small></div>
            <div class="performance-bonus-metric"><span class="ui-dual-copy"><strong>Thưởng nhân viên</strong><span>員工獎金</span></span><b id="performance-bonus-company-bonus">0</b><small>VND</small></div>
            <div class="performance-bonus-metric is-net"><span class="ui-dual-copy"><strong>Kết quả ròng</strong><span>公司淨損益</span></span><b id="performance-bonus-company-net">0</b><small>VND</small></div>
          </div>
        </section>
      </div>`;
  }
  function syncEmployeeShare(){
    const company=Number(el('performance-bonus-company-share')?.value);
    el('performance-bonus-employee-share').value=Number.isFinite(company)?Math.max(0,100-company).toFixed(company%1===0?0:2):'';
  }
  function fillSettings(settings){
    state.settings=settings;
    el('performance-bonus-unit-price').value=String(settings.unitPrice);
    el('performance-bonus-company-share').value=String(settings.companyShare);
    el('performance-bonus-efficiency-cap').value=String(settings.efficiencyCap);
    syncEmployeeShare();
  }
  function renderMonth(){
    const metadata=state.metadata;
    const locked=metadata&&['locked','exported','paid'].includes(metadata.status);
    const pair=statusPair(metadata?.status);
    el('performance-bonus-settings-status').replaceChildren(window.PCMSUIText.create(pair));
    const note=el('performance-bonus-settings-note');
    note.hidden=false;
    note.replaceChildren(window.PCMSUIText.create(metadata
      ?{vi:`Lần tính gần nhất: ${new Date(Number(metadata.calculatedAt)||0).toLocaleString('vi-VN')}`,zh:`最近計算：${new Date(Number(metadata.calculatedAt)||0).toLocaleString('zh-TW')}`}
      :{vi:'Tháng này chưa có kết quả tính thử.',zh:'此月份尚無試算結果。'}));
    el('performance-bonus-company-empty').hidden=Boolean(locked);
    el('performance-bonus-company-metrics').hidden=!locked;
    if(!locked) return;
    const gross=Number(state.privateMonth?.grossExtra)||0;
    const loss=Number(state.privateMonth?.efficiencyLoss)||0;
    const bonus=Number(metadata.finalBonusTotal)||0;
    const net=Math.round(gross-loss-bonus);
    el('performance-bonus-company-gross').textContent=money(gross);
    el('performance-bonus-company-loss').textContent=money(loss);
    el('performance-bonus-company-bonus').textContent=money(bonus);
    const netElement=el('performance-bonus-company-net');
    netElement.textContent=money(net);
    netElement.closest('.performance-bonus-metric')?.classList.toggle('is-negative',net<0);
  }
  async function loadMonth(){
    const month=el('performance-bonus-settings-month').value||currentMonth();
    state.month=month;
    const request=++state.request;
    try{
      const publicMonth=await store().loadMonth(month,{force:true,includePrivate:true,settings:state.settings});
      if(request!==state.request) return;
      state.metadata=publicMonth.metadata;
      state.privateMonth=publicMonth.privateMonth;
      renderMonth();
    }catch(error){ if(request===state.request) await showError(error); }
  }
  async function saveSettings(){
    return ui().runActionOnce('performanceBonus.settings.save',async()=>{
      setBusy(true);
      try{
        const saved=await store().saveSettings({
          unitPrice:el('performance-bonus-unit-price').value,
          companyShare:el('performance-bonus-company-share').value,
          efficiencyCap:el('performance-bonus-efficiency-cap').value
        });
        fillSettings(saved);
        toast({vi:'Đã lưu tham số. Các tháng chưa khóa sẽ dùng ngay tham số mới khi hiển thị.',zh:'參數已儲存；未鎖定月份顯示時會立即使用新參數。'});
        await loadMonth();
      }catch(error){ await showError(error); }
      finally{ setBusy(false); }
    });
  }
  function bind(){
    el('performance-bonus-company-share').addEventListener('input',syncEmployeeShare);
    el('performance-bonus-settings-save').addEventListener('click',()=>void saveSettings());
    el('performance-bonus-settings-month').addEventListener('change',()=>void loadMonth());
  }
  async function loadPerformanceBonusSettingsData(options={}){
    return true;
  }
  async function performanceBonusSettingsInit(){
    renderShell();
    if(!state.initialized){ state.initialized=true; bind(); }
    el('performance-bonus-settings-month').value=state.month||currentMonth();
    try{
      const settings=await store().loadSettings({force:true});
      fillSettings(settings);
      await loadMonth();
    }catch(error){ await showError(error); }
  }
  function performanceBonusSettingsLeave(){ state.request+=1; }

  window.loadPerformanceBonusSettingsData=loadPerformanceBonusSettingsData;
  window.performanceBonusSettingsInit=performanceBonusSettingsInit;
  window.performanceBonusSettingsLeave=performanceBonusSettingsLeave;
})();
