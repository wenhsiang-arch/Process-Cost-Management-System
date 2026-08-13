// production-anomaly-filter（產能異常篩選）：顯示目前月份的考勤與工序異常並導向補充資料。
(function(){
  'use strict';

  const state={initialized:false,request:0,rows:[],active:false};
  const element=id=>document.getElementById(id);

  function dateValue(date){
    const year=date.getFullYear();
    const month=String(date.getMonth()+1).padStart(2,'0');
    const day=String(date.getDate()).padStart(2,'0');
    return `${year}-${month}-${day}`;
  }

  function currentMonthRange(){
    const now=new Date();
    return {
      from:dateValue(new Date(now.getFullYear(),now.getMonth(),1)),
      to:dateValue(new Date(now.getFullYear(),now.getMonth()+1,0))
    };
  }

  function statusPair(status){
    if(status==='invalid-attendance') return {vi:'Giờ bất thường',zh:'考勤時數異常'};
    if(status==='invalid-capacity') return {vi:'Thiếu chuẩn công đoạn',zh:'缺少工序標準'};
    return {vi:'Chưa chấm công',zh:'考勤未登記'};
  }

  function setActive(active){
    state.active=active===true&&state.rows.length>0;
    const button=element('production-anomaly-filter-button');
    const panel=element('production-anomaly-panel');
    const regular=element('production-entry-data-section');
    if(button) button.setAttribute('aria-pressed',String(state.active));
    if(panel) panel.hidden=!state.active;
    if(regular) regular.hidden=state.active;
    if(state.active) window.PCMSUITable?.refresh?.();
  }

  function updateCard({loading=false,error=false}={}){
    const button=element('production-anomaly-filter-button');
    const count=element('production-anomaly-filter-count');
    if(!button||!count) return;
    count.textContent=loading?'…':String(state.rows.length);
    button.disabled=loading||error||state.rows.length===0;
    button.classList.toggle('has-anomaly',!loading&&!error&&state.rows.length>0);
    button.classList.toggle('has-none',!loading&&(error||state.rows.length===0));
    const pair=error
      ? {vi:'Không thể tải bất thường',zh:'無法載入異常'}
      : state.rows.length
        ? {vi:`Có ${state.rows.length} bất thường`,zh:`共有 ${state.rows.length} 筆異常`}
        : {vi:'Không có bất thường',zh:'沒有異常'};
    button.title=`${pair.vi} / ${pair.zh}`;
  }

  function relatedText(item){
    const values=[item.context?.orderNo||item.context?.orderId,item.context?.code,item.context?.processNo?`#${item.context.processNo}`:'']
      .filter(Boolean);
    return values.join(' · ')||'—';
  }

  function render(){
    const body=element('production-anomaly-table-body');
    const count=element('production-anomaly-panel-count');
    if(!body||!count) return;
    body.replaceChildren(...state.rows.map(item=>{
      const row=document.createElement('tr');
      const date=document.createElement('td');
      const employee=document.createElement('td');
      const status=document.createElement('td');
      const related=document.createElement('td');
      const action=document.createElement('td');
      date.textContent=item.productionDate||'—';
      employee.textContent=`${item.employeeId||'—'} · ${item.employeeName||'—'}`;
      const badge=document.createElement('button');
      badge.type='button';
      badge.className='production-status is-voided ui-dual-copy production-anomaly-status-button';
      badge.appendChild(window.PCMSUIText.create(statusPair(item.status)));
      badge.addEventListener('click',()=>void openDetail(item));
      status.appendChild(badge);
      related.textContent=relatedText(item);
      action.className='ui-table-center-cell';
      const button=window.PCMSUIComponents.createButton({
        text:item.status==='invalid-capacity'?{vi:'Bổ sung công đoạn',zh:'補充工序'}:{vi:'Bổ sung chấm công',zh:'補充考勤'},
        icon:'ti-arrow-right'
      });
      button.addEventListener('click',()=>void openDetail(item));
      action.appendChild(button);
      row.append(date,employee,status,related,action);
      return row;
    }));
    count.textContent=window.PCMSUIText.visibleText({vi:`${state.rows.length} mục`,zh:`${state.rows.length} 筆`});
  }

  async function openDetail(item){
    if(item.status==='invalid-capacity'){
      setActive(false);
      window.PCMSProductionEntry?.setPendingContext?.({
        employeeId:item.employeeId,productionDate:item.productionDate,
        orderId:item.context?.orderId,orderNo:item.context?.orderNo,
        code:item.context?.code,processNo:item.context?.processNo
      });
      await window.productionEntryInit?.();
      return;
    }
    if(typeof window.canOpenPage==='function'&&!window.canOpenPage('production-attendance')) return;
    await window.PCMSFeatures?.ensurePageScripts?.('production-attendance');
    window.PCMSProductionAttendancePage?.setPendingContext?.({employeeId:item.employeeId,attendanceDate:item.productionDate});
    if(typeof window.sp==='function') await window.sp('production-attendance');
  }

  async function load(){
    const request=++state.request;
    state.rows=[];
    setActive(false);
    updateCard({loading:true});
    try{
      const range=currentMonthRange();
      const rows=await window.PCMSProductionPerformance.loadPerformanceRange(range.from,range.to);
      if(request!==state.request) return;
      state.rows=rows.flatMap(item=>{
        const anomalies=[];
        if(item.attendanceStatus) anomalies.push({...item,status:item.attendanceStatus,context:null});
        (item.invalidContexts||[]).forEach(context=>anomalies.push({...item,status:'invalid-capacity',context}));
        return anomalies;
      });
      render();
      updateCard();
    }catch(error){
      if(request!==state.request) return;
      console.error('Không thể tải bộ lọc bất thường / 無法載入異常篩選',error);
      state.rows=[];render();updateCard({error:true});
    }
  }

  function init(){
    if(state.initialized) return;
    state.initialized=true;
    element('production-anomaly-filter-button')?.addEventListener('click',()=>setActive(!state.active));
  }

  async function productionAnomalyFilterInit(){ init();await load(); }
  function productionAnomalyFilterLeave(){ state.request+=1;state.rows=[];setActive(false);updateCard();window.PCMSProductionReports?.reset?.(); }

  window.productionAnomalyFilterInit=productionAnomalyFilterInit;
  window.productionAnomalyFilterLeave=productionAnomalyFilterLeave;
})();
