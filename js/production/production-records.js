// production-records（每日績效頁程式）：依日期整合有效生產與考勤，每位員工每天顯示一列。
(function(){
  'use strict';

  const MAX_RANGE_DAYS = 31; // MAX_RANGE_DAYS（每日績效單次最多查詢天數）
  const state = {
    initialized:false,rows:[],filtered:[],loading:false,loadRequest:0,
    selectedEmployeeId:'',searchDropdown:null,pendingContext:null
  }; // state（每日績效頁狀態）

  function element(id){ return document.getElementById(id); }
  function today(){ return typeof formatLocalDate === 'function' ? formatLocalDate(new Date()) : new Date().toISOString().slice(0,10); }
  function shiftDate(days){
    const value = new Date();
    value.setDate(value.getDate()+days);
    return typeof formatLocalDate === 'function' ? formatLocalDate(value) : value.toISOString().slice(0,10);
  }
  function dateObject(value){
    const [year,month,day] = String(value || '').split('-').map(Number);
    const result = new Date(year,month-1,day);
    return Number.isFinite(result.getTime()) ? result : new Date();
  }
  function syncDateControl(inputId,nextId){
    const input = element(inputId);
    const next = element(nextId);
    if(!input) return;
    input.max = today();
    if(next) next.disabled = input.value >= input.max;
  }
  function shiftDateInput(inputId,nextId,days){
    const input = element(inputId);
    if(!input) return;
    const value = dateObject(input.value || today());
    value.setDate(value.getDate()+days);
    const nextValue = typeof formatLocalDate === 'function' ? formatLocalDate(value) : value.toISOString().slice(0,10);
    input.value = nextValue > today() ? today() : nextValue;
    syncDateControl(inputId,nextId);
    void load();
  }
  function openDatePicker(inputId){
    const input = element(inputId);
    if(!input) return;
    if(typeof input.showPicker === 'function') input.showPicker();
    else input.focus({preventScroll:true});
  }
  function dateText(value){
    const parts = String(value || '').split('-');
    return parts.length === 3 ? `${parts[0]}/${parts[1]}/${parts[2]}` : String(value || '—');
  }
  function dateBadgeText(value){
    const parts = String(value || '').split('-').map(Number);
    if(parts.length !== 3 || parts.some(part=>!Number.isFinite(part))) return {date:dateText(value),vi:'',zh:''};
    const date = new Date(parts[0],parts[1]-1,parts[2]);
    const viDays = ['Chủ nhật','Thứ hai','Thứ ba','Thứ tư','Thứ năm','Thứ sáu','Thứ bảy'];
    const zhDays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
    return {
      date:`${String(parts[2]).padStart(2,'0')}/${String(parts[1]).padStart(2,'0')}`,
      vi:viDays[date.getDay()],
      zh:zhDays[date.getDay()]
    };
  }
  function hoursText(value){
    const hours = Number(value);
    return Number.isFinite(hours)
      ? hours.toLocaleString(undefined,{minimumFractionDigits:hours % 1 === 0 ? 0 : 1,maximumFractionDigits:2})
      : '—';
  }
  function percentageText(value){
    const percentage = Number(value);
    return Number.isFinite(percentage)
      ? `${percentage.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})}%`
      : '—';
  }

  async function showError(error){
    await window.PCMSUIComponents.alertDialog({kind:'danger',message:window.PCMSUIText.errorPair(error)});
  }

  function rangeDates(from,to){
    const parse=value=>{
      const parts = String(value || '').split('-').map(Number);
      return parts.length === 3 ? new Date(parts[0],parts[1]-1,parts[2],12) : new Date(NaN);
    };
    const start = parse(from);
    const end = parse(to);
    if(!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end){
      throw new Error('Khoảng ngày không hợp lệ. / 日期範圍不正確。');
    }
    const dates = [];
    for(let cursor=new Date(start);cursor<=end;cursor.setDate(cursor.getDate()+1)){
      if(dates.length >= MAX_RANGE_DAYS){
        throw new Error('Chỉ được xem tối đa 31 ngày mỗi lần. / 每次最多查看31天。');
      }
      dates.push(typeof formatLocalDate === 'function' ? formatLocalDate(cursor) : cursor.toISOString().slice(0,10));
    }
    return dates;
  }

  function filters(){
    return {
      from:element('production-record-from').value,
      to:element('production-record-to').value,
      search:element('production-record-search').value,
      employeeId:state.selectedEmployeeId,
      status:element('production-record-status-filter').value
    };
  }

  function employeeInfo(employeeId,entries=[],attendance=null){
    const employee = window.PCMSProductionEmployees?.find?.(employeeId);
    const snapshot = entries[0] || attendance || {};
    return {
      name:String(employee?.name || snapshot.employeeName || '—').trim() || '—',
      department:String(employee?.department || snapshot.department || '—').trim() || '—'
    };
  }

  function aggregatePerformance(entries,attendanceByDate){
    const groups = new Map();
    const ensure=(productionDate,employeeId)=>{
      const key = `${productionDate}|${employeeId}`;
      if(!groups.has(key)) groups.set(key,{productionDate,employeeId,entries:[],attendance:null});
      return groups.get(key);
    };
    (Array.isArray(entries) ? entries : []).forEach(item=>{
      if(item?.status !== 'active') return;
      ensure(item.productionDate,item.employeeId).entries.push(item);
    });
    attendanceByDate.forEach((rows,productionDate)=>{
      (Array.isArray(rows) ? rows : []).forEach(attendance=>{
        ensure(productionDate,attendance.employeeId).attendance = attendance;
      });
    });
    return Array.from(groups.values()).map(group=>{
      const info = employeeInfo(group.employeeId,group.entries,group.attendance);
      const result = window.PCMSProductionAttendance.calculateEfficiency(group.entries,group.attendance);
      const supplementHours = group.entries.reduce((total,item)=>{
        const supplement = item.recordType === 'supplement' || String(item.processNo || '') === '0';
        return total+(supplement ? Number(item.supplementHours || 0) : 0);
      },0);
      const invalidContexts=group.entries.filter(item=>{
        if(item?.status!=='active'||item.recordType==='supplement'||String(item.processNo||'')==='0') return false;
        const quantity=Number(item.quantity);
        const capacity=Number(item.hourlyCapacitySnapshot);
        return Number.isFinite(quantity)&&quantity>0&&!(Number.isFinite(capacity)&&capacity>0);
      }).map(item=>({
        orderId:String(item.orderId||''),
        orderNo:String(item.orderNo||''),
        code:String(item.productCode||item.code||''),
        processNo:String(item.processNo||'')
      }));
      const hasProduction=group.entries.some(item=>item?.status==='active'
        &&item.recordType!=='supplement'&&String(item.processNo||'')!=='0'&&Number(item.quantity)>0);
      const attendanceHours=group.attendance
        ? Number(group.attendance.normalHours||0)+Number(group.attendance.overtimeHours||0)
        : null;
      const attendanceStatus=!group.attendance
        ? (hasProduction?'missing-attendance':'')
        : (hasProduction&&attendanceHours<=0?'invalid-attendance':'');
      const contextSource=invalidContexts[0]||group.entries[0]||null;
      return {
        productionDate:group.productionDate,
        employeeId:group.employeeId,
        employeeName:info.name,
        department:info.department,
        attendance:group.attendance,
        workedHours:result.workedHours,
        standardHours:result.standardHours,
        supplementHours,
        percentage:result.percentage,
        status:result.status,
        attendanceStatus,
        invalidContexts,
        context:contextSource?{
          orderId:String(contextSource.orderId||''),
          orderNo:String(contextSource.orderNo||''),
          code:String(contextSource.productCode||contextSource.code||''),
          processNo:String(contextSource.processNo||'')
        }:null
      };
    }).filter(item=>item.status!=='absent').sort((left,right)=>{
      const dateOrder=String(right.productionDate).localeCompare(String(left.productionDate));
      if(dateOrder) return dateOrder;
      const leftPercentage=Number(itemPercentage(left));
      const rightPercentage=Number(itemPercentage(right));
      const leftReady=Number.isFinite(leftPercentage);
      const rightReady=Number.isFinite(rightPercentage);
      if(leftReady!==rightReady) return leftReady?-1:1;
      if(leftReady&&rightReady&&rightPercentage!==leftPercentage) return rightPercentage-leftPercentage;
      return String(left.employeeId).localeCompare(String(right.employeeId),'en',{numeric:true,sensitivity:'base'});
    });
  }

  function itemPercentage(item){
    return item?.percentage == null ? Number.NaN : Number(item.percentage);
  }

  function filteredRows(){
    const current = filters();
    let matchedEmployeeIds=null;
    if(!current.employeeId&&String(current.search||'').trim()){
      const matches=window.PCMSUISearchDropdown?.matchItems?.(
        window.PCMSProductionEmployees?.list?.()||[],current.search,
        {limit:100,fields:[
          {key:'employeeId',mode:'code',weight:0},
          {key:'name',mode:'text',weight:10},
          {key:'department',mode:'text',weight:20}
        ]}
      );
      matchedEmployeeIds=new Set((matches?.items||[]).map(item=>String(item.employeeId)));
    }
    return state.rows.filter(item=>{
      if(current.status && item.status !== current.status) return false;
      if(current.employeeId&&item.employeeId!==current.employeeId) return false;
      if(matchedEmployeeIds&&!matchedEmployeeIds.has(item.employeeId)) return false;
      return true;
    }).sort((left,right)=>{
      const dateOrder=String(right.productionDate).localeCompare(String(left.productionDate));
      if(dateOrder) return dateOrder;
      const leftPercentage=Number(itemPercentage(left));
      const rightPercentage=Number(itemPercentage(right));
      const leftReady=Number.isFinite(leftPercentage);
      const rightReady=Number.isFinite(rightPercentage);
      if(leftReady!==rightReady) return leftReady?-1:1;
      if(leftReady&&rightReady&&rightPercentage!==leftPercentage) return rightPercentage-leftPercentage;
      return String(left.employeeId).localeCompare(String(right.employeeId),'en',{numeric:true,sensitivity:'base'});
    });
  }

  function addTextCell(row,value,className='',sortValue=''){
    const cell = document.createElement('td');
    if(className) cell.className = className;
    cell.textContent = String(value ?? '—');
    if(sortValue !== '') cell.dataset.uiTableSortValue = String(sortValue);
    row.appendChild(cell);
    return cell;
  }

  function addEfficiencyCell(row,item){
    const percentage=Number(item.percentage);
    const cell=document.createElement('td');
    cell.className='production-number-cell production-efficiency-cell';
    if(Number.isFinite(percentage)){
      cell.dataset.uiTableSortValue=String(percentage);
      const badge=document.createElement('button');
      badge.type='button';
      badge.className=`production-efficiency-badge ${percentage<70?'is-low':percentage<=100?'is-standard':'is-high'}`;
      badge.textContent=percentageText(percentage);
      badge.title='Mở bản ghi trong ngày / 開啟當日生產紀錄';
      badge.addEventListener('click',()=>void openEmployeeRegistration(item,{targetProcess:false}));
      cell.appendChild(badge);
    }else cell.textContent='—';
    row.appendChild(cell);
    return cell;
  }

  function addDateCell(row,value,showBadge){
    const cell = document.createElement('td');
    cell.className = 'production-date-cell';
    cell.dataset.uiTableSortValue = String(value || '');
    if(showBadge){
      const copy = dateBadgeText(value);
      const badge = document.createElement('span');
      badge.className = 'production-date-badge';
      const date = document.createElement('strong');
      const weekday = document.createElement('span');
      date.textContent = copy.date;
      weekday.appendChild(window.PCMSUIText.create({vi:copy.vi,zh:copy.zh}));
      badge.append(date,weekday);
      cell.appendChild(badge);
    }else{
      cell.setAttribute('aria-label',dateText(value));
    }
    row.appendChild(cell);
  }

  function addEmployeeCell(row,item){
    const cell = document.createElement('td');
    cell.className = 'production-record-text-cell production-employee-detail-cell';
    cell.dataset.uiTableSortValue = String(item.employeeName || '');
    cell.textContent = String(item.employeeName || '—');
    row.appendChild(cell);
  }

  function statusBadge(item){
    const badge = document.createElement('span');
    badge.className = 'production-status ui-dual-copy';
    const vi = document.createElement('strong');
    const zh = document.createElement('span');
    if(item.status === 'ready'){
      badge.classList.add('is-active');
      vi.textContent = 'Đã tính';
      zh.textContent = '已計算';
    }else if(item.status === 'invalid-attendance'){
      badge.classList.add('is-voided');
      vi.textContent = 'Giờ bất thường';
      zh.textContent = '考勤時數異常';
    }else if(item.status === 'invalid-capacity'){
      badge.classList.add('is-voided');
      vi.textContent = 'Thiếu chuẩn giờ';
      zh.textContent = '缺少標準產能';
    }else{
      badge.classList.add('is-pending');
      vi.textContent = 'Chưa chấm công';
      zh.textContent = '考勤未登記';
    }
    badge.append(vi,zh);
    if(item.status!=='ready'){
      badge.classList.add('is-navigable');
      badge.tabIndex=0;
      badge.setAttribute('role','button');
      badge.title=item.status==='invalid-capacity'
        ? 'Bổ sung dữ liệu công đoạn / 補充工序資料'
        : 'Bổ sung dữ liệu chấm công / 補充考勤資料';
      const open=()=>void openAbnormalDetail(item);
      badge.addEventListener('click',open);
      badge.addEventListener('keydown',event=>{ if(event.key==='Enter'||event.key===' '){ event.preventDefault();open(); } });
    }
    return badge;
  }

  async function openAbnormalDetail(item){
    if(item.status==='invalid-capacity') return openEmployeeRegistration(item,{targetProcess:true});
    if(typeof window.canOpenPage==='function'&&!window.canOpenPage('production-attendance')) return;
    try{
      await window.PCMSFeatures?.ensurePageScripts?.('production-attendance');
      window.PCMSProductionAttendancePage?.setPendingContext?.({employeeId:item.employeeId,attendanceDate:item.productionDate});
      if(typeof window.sp==='function') await window.sp('production-attendance');
    }catch(error){ await showError(error); }
  }

  async function openEmployeeRegistration(item,options={}){
    if(typeof window.canOpenPage === 'function' && !window.canOpenPage('production-entry')) return;
    try{
      await window.PCMSFeatures?.ensurePageScripts?.('production-entry');
      const context={
        employeeId:item.employeeId,
        productionDate:item.productionDate
      };
      if(options.targetProcess===true){
        Object.assign(context,{
          orderId:item.context?.orderId,
          orderNo:item.context?.orderNo,
          code:item.context?.code,
          processNo:item.context?.processNo
        });
      }
      window.PCMSProductionEntry?.setPendingContext?.(context);
      if(typeof window.sp === 'function') await window.sp('production-entry');
    }catch(error){ await showError(error); }
  }

  function render(){
    state.filtered = filteredRows();
    const body = element('production-records-table-body');
    body.replaceChildren();
    state.filtered.forEach((item,index)=>{
      const row = document.createElement('tr');
      const groupStart = index === 0 || state.filtered[index-1]?.productionDate !== item.productionDate;
      if(groupStart) row.classList.add('production-date-group-start');
      addDateCell(row,item.productionDate,groupStart);
      addTextCell(row,item.employeeId,'production-record-text-cell');
      addEmployeeCell(row,item);
      addTextCell(row,item.department,'production-record-text-cell');
      addTextCell(row,item.workedHours == null ? '—' : hoursText(item.workedHours),'production-number-cell',item.workedHours ?? '');
      addTextCell(row,hoursText(item.standardHours),'production-number-cell',item.standardHours);
      addTextCell(row,hoursText(item.supplementHours),'production-number-cell',item.supplementHours);
      addEfficiencyCell(row,item);
      addTextCell(
        row,
        Number.isFinite(Number(item.bonusAmount))?`${Math.round(Number(item.bonusAmount)).toLocaleString('vi-VN')} VND`:'—',
        'production-number-cell production-bonus-cell',
        Number.isFinite(Number(item.bonusAmount))?Number(item.bonusAmount):''
      );
      const statusCell = document.createElement('td');
      statusCell.className = 'production-center-cell';
      statusCell.appendChild(statusBadge(item));
      row.appendChild(statusCell);
      body.appendChild(row);
    });
    element('production-records-empty').hidden = state.filtered.length > 0;
    element('production-records-count').textContent = String(state.filtered.length);
    window.PCMSUITable?.refresh?.();
  }

  async function load(){
    const current = filters();
    let dates;
    try{ dates = rangeDates(current.from,current.to); }
    catch(error){ await showError(error); return; }
    const request = ++state.loadRequest; // request（查詢序號）：只允許最後一次日期查詢更新畫面。
    state.loading = true;
    state.rows = [];
    render();
    const searchButton = element('production-record-search-button');
    if(searchButton) searchButton.disabled = true;
    try{
      const summariesReady=await window.PCMSProductionSummaries.rangeReady(current.from,current.to);
      if(summariesReady){
        state.rows=await window.PCMSProductionSummaries.loadPerformanceRange(current.from,current.to);
      }else{
        const [entries,...attendanceDays] = await Promise.all([
          window.PCMSProductionReports.loadRange(current.from,current.to,{activeOnly:true}),
          ...dates.map(date=>window.PCMSProductionAttendance.loadDay(date))
        ]);
        const attendanceByDate = new Map(dates.map((date,index)=>[date,attendanceDays[index]]));
        state.rows = aggregatePerformance(entries,attendanceByDate);
      }
      if(request !== state.loadRequest) return;
      if(window.canOpenPage?.('production-bonus')===true&&window.PCMSPerformanceBonusStore){
        const months=[...new Set(dates.map(date=>date.slice(0,7)))];
        const bonusByDay=new Map();
        const bonusMaps=await Promise.all(months.map(month=>window.PCMSPerformanceBonusStore.loadDailyBonuses(month,state.rows)));
        bonusMaps.forEach(map=>map.forEach((amount,key)=>bonusByDay.set(key,amount)));
        state.rows=state.rows.map(item=>({...item,bonusAmount:bonusByDay.get(`${item.employeeId}|${item.productionDate}`)}));
      }
      if(request !== state.loadRequest) return;
      render();
    }catch(error){
      if(request !== state.loadRequest) return;
      state.rows = [];
      render();
      await showError(error);
    }finally{
      if(request === state.loadRequest){
        state.loading = false;
        if(searchButton) searchButton.disabled = false;
      }
    }
  }

  async function loadPerformanceRange(from,to){
    const dates=rangeDates(from,to);
    if(await window.PCMSProductionSummaries.rangeReady(from,to)){
      return window.PCMSProductionSummaries.loadPerformanceRange(from,to);
    }
    const [entries,...attendanceDays]=await Promise.all([
      window.PCMSProductionReports.loadRange(from,to,{activeOnly:true}),
      ...dates.map(date=>window.PCMSProductionAttendance.loadDay(date))
    ]);
    return aggregatePerformance(entries,new Map(dates.map((date,index)=>[date,attendanceDays[index]])));
  }

  function clearFilters(){
    element('production-record-from').value = shiftDate(-7);
    element('production-record-to').value = today();
    syncDateControl('production-record-from','production-record-from-next');
    syncDateControl('production-record-to','production-record-to-next');
    element('production-record-search').value = '';
    state.selectedEmployeeId='';
    state.searchDropdown?.close?.();
    element('production-record-status-filter').value = '';
    void load();
  }

  function init(){
    if(state.initialized) return;
    state.initialized = true;
    element('production-record-from').value = shiftDate(-7);
    element('production-record-to').value = today();
    syncDateControl('production-record-from','production-record-from-next');
    syncDateControl('production-record-to','production-record-to-next');
    element('production-record-from-calendar').addEventListener('click',()=>openDatePicker('production-record-from'));
    element('production-record-to-calendar').addEventListener('click',()=>openDatePicker('production-record-to'));
    element('production-record-from-previous').addEventListener('click',()=>shiftDateInput('production-record-from','production-record-from-next',-1));
    element('production-record-from-next').addEventListener('click',()=>shiftDateInput('production-record-from','production-record-from-next',1));
    element('production-record-to-previous').addEventListener('click',()=>shiftDateInput('production-record-to','production-record-to-next',-1));
    element('production-record-to-next').addEventListener('click',()=>shiftDateInput('production-record-to','production-record-to-next',1));
    element('production-record-from').addEventListener('change',()=>{
      syncDateControl('production-record-from','production-record-from-next');
      void load();
    });
    element('production-record-to').addEventListener('change',()=>{
      syncDateControl('production-record-to','production-record-to-next');
      void load();
    });
    element('production-record-search-button').addEventListener('click',()=>void load());
    element('production-record-clear-button').addEventListener('click',clearFilters);
    state.searchDropdown=window.PCMSUISearchDropdown.create({
      input:'#production-record-search',toggle:'#production-record-search-toggle',list:'#production-record-search-options',
      getItems:()=>window.PCMSProductionEmployees?.list?.()||[],
      fields:[
        {key:'employeeId',mode:'code',weight:0},
        {key:'name',mode:'text',weight:10},
        {key:'department',mode:'text',weight:20}
      ],
      renderItem:item=>({primary:String(item.name||item.employeeId),secondary:[item.employeeId,item.department].filter(Boolean).join(' · ')}),
      onInput:()=>{ state.selectedEmployeeId=''; render(); },
      onSelect:item=>{
        state.selectedEmployeeId=String(item.employeeId||'');
        element('production-record-search').value=String(item.name||item.employeeId||'');
        render();
      }
    });
    element('production-record-status-filter').addEventListener('change',render);
  }

  async function loadProductionRecordsData(options={}){
    await window.PCMSProductionEmployees.load({revalidate:options.background === true});
    return true;
  }

  function applyPendingContext(){
    const context=state.pendingContext;
    if(!context) return;
    state.pendingContext=null;
    if(context.from) element('production-record-from').value=context.from;
    if(context.to) element('production-record-to').value=context.to;
    state.selectedEmployeeId=String(context.employeeId||'');
    element('production-record-search').value=String(context.employeeName||context.employeeId||'');
    element('production-record-status-filter').value='';
    syncDateControl('production-record-from','production-record-from-next');
    syncDateControl('production-record-to','production-record-to-next');
  }
  async function productionRecordsInit(){ init(); applyPendingContext(); await load(); }
  function productionRecordsLeave(){
    state.loadRequest += 1;
    state.loading = false;
    window.PCMSProductionReports.reset();
  }

  window.loadProductionRecordsData = loadProductionRecordsData;
  window.productionRecordsInit = productionRecordsInit;
  window.productionRecordsLeave = productionRecordsLeave;
  window.PCMSProductionPerformance=Object.freeze({
    aggregatePerformance,loadPerformanceRange,
    setPendingContext:context=>{ state.pendingContext={...(context||{})}; }
  });
})();
