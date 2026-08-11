// system-monitor（系統監控畫面）：管理員查看全站日誌、目前裝置快取與全站呼叫估算。
(function(){
  'use strict';

  const ACTION_LABELS={
    userLogin:['Đăng nhập','登入'],userLogout:['Đăng xuất','登出'],
    accountCreate:['Thêm tài khoản','新增帳號'],accountUpdate:['Sửa tài khoản','修改帳號'],
    accountDelete:['Xóa tài khoản','刪除帳號'],rolePermissionsUpdate:['Cập nhật quyền','更新權限'],
    productImport:['Nhập mã hàng','匯入款號'],productBackupExport:['Xuất sao lưu mã hàng','匯出款號備份'],
    productCostExport:['Xuất giá công','匯出產品工價'],
    orderImport:['Nhập đơn hàng','匯入訂單'],costSettingsUpdate:['Sửa chi phí','修改成本'],
    cuttingTemplateImport:['Nhập mẫu dây cắt','匯入裁帶模板'],cuttingTemplateDelete:['Xóa mẫu dây cắt','刪除裁帶模板'],
    cuttingExcelExport:['Xuất bảng dây cắt','匯出裁帶表格'],cuttingPdfExport:['Xuất báo cáo dây cắt','匯出裁帶報表'],
    productionEntryUpdate:['Sửa sản lượng','修改產能'],productionEntryVoid:['Hủy sản lượng','作廢產能'],
    productionEntryDelete:['Xóa sản lượng','刪除產能'],productionAttendanceSave:['Lưu chấm công','儲存考勤'],
    productionAttendanceDelete:['Xóa chấm công','刪除考勤'],productionEmployeeDelete:['Xóa nhân viên','刪除員工'],
    productionDepartmentCreate:['Thêm bộ phận','新增部門'],productionDepartmentRename:['Đổi tên bộ phận','部門改名'],
    productionDepartmentStatus:['Đổi trạng thái bộ phận','變更部門狀態'],productionDepartmentDelete:['Xóa bộ phận','刪除部門'],
    productionAnalysisExport:['Xuất phân tích','匯出分析'],productionAnalysisPrint:['In phân tích','列印分析']
  };
  const FEATURE_LABELS={
    systemMonitor:['Giám sát hệ thống','系統監控'],accounts:['Quản lý tài khoản','帳號管理'],
    products:['Quản lý mã hàng','款號管理'],orders:['Dữ liệu đơn hàng','訂單資料'],
    production:['Ghi nhận sản lượng','產能登記'],productionAnalysis:['Phân tích sản xuất','生產分析'],
    cost:['Quản lý chi phí','成本管理'],cutting:['Thống kê dây cắt','裁帶統計']
  };
  const CACHE_LABELS={
    productionEntries:['Dữ liệu sản lượng','產能資料'],productionAttendance:['Dữ liệu chấm công','考勤資料'],
    productionAnalysis:['Dữ liệu phân tích','分析資料'],productionEmployees:['Dữ liệu nhân viên','員工資料'],
    productionDepartments:['Dữ liệu bộ phận','部門資料'],orders:['Dữ liệu đơn hàng','訂單資料'],
    orderProcesses:['Công đoạn đơn hàng','訂單工序'],products:['Dữ liệu mã hàng','款號資料'],
    operationSettings:['Cài đặt vận hành','運算設定'],costSettings:['Cài đặt chi phí','成本設定']
  };
  const state={
    tab:'logs',loading:false,error:'',logs:[],logMore:false,usage:[],usageMore:false,local:null,
    logFilters:{from:localDate(),to:localDate(),user:'',feature:'',status:'',search:''},
    usageFilters:{from:localDate(),to:localDate(),user:''}
  };

  function root(){ return document.getElementById('system-monitor-root'); }
  function esc(value){
    return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  }
  function localDate(date=new Date()){
    const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
    return `${year}-${month}-${day}`;
  }
  function millis(value){
    if(value&&typeof value.toMillis==='function') return value.toMillis();
    const parsed=Number(value); return Number.isFinite(parsed)?parsed:0;
  }
  function dateTime(value){
    const time=millis(value); return time?new Date(time).toLocaleString('zh-TW',{hour12:false}):'—';
  }
  function bytes(value){
    const amount=Math.max(0,Number(value)||0);
    if(amount>=1024*1024*1024) return `${(amount/1024/1024/1024).toFixed(2)} GB`;
    if(amount>=1024*1024) return `${(amount/1024/1024).toFixed(2)} MB`;
    if(amount>=1024) return `${(amount/1024).toFixed(1)} KB`;
    return `${amount} B`;
  }
  function count(value){ return Math.max(0,Number(value)||0).toLocaleString(); }
  function hitRate(hits,misses){
    const total=(Number(hits)||0)+(Number(misses)||0);
    return total?`${((Number(hits)||0)/total*100).toFixed(1)}%`:'—';
  }
  function dual(vi,zh,tag='span'){ return `<${tag} class="ui-dual-copy"><strong>${esc(vi)}</strong><span>${esc(zh)}</span></${tag}>`; }
  function statusLabel(status){
    return status==='success'?['Thành công','成功']:status==='partial'?['Một phần','部分完成']:['Thất bại','失敗'];
  }
  function actionLabel(action){ return ACTION_LABELS[action]||[String(action||'—'),String(action||'—')]; }
  function featureLabel(value){ return FEATURE_LABELS[value]||[String(value||'—'),String(value||'—')]; }
  function roleLabel(value){
    const label=typeof ROLE_LABEL!=='undefined'?ROLE_LABEL[value]:'';
    if(label&&label.includes(' / ')){ const parts=label.split(' / '); return [parts[0],parts.slice(1).join(' / ')]; }
    return [String(label||value||'—'),String(label||value||'—')];
  }
  function cacheLabel(scope){
    const group=scope.startsWith('productionEntries')?'productionEntries':scope.startsWith('productionAttendance')?'productionAttendance':scope.split(':')[0];
    return CACHE_LABELS[group]||[scope,scope];
  }
  function cacheGroup(scope){
    if(scope.startsWith('productionEntries')) return 'productionEntries';
    if(scope.startsWith('productionAttendance')) return 'productionAttendance';
    if(scope.startsWith('orderProcesses:')) return 'orderProcesses';
    return scope.split(':')[0]||'other';
  }
  function summarizeCacheEntries(entries){
    const groups=new Map();
    (entries||[]).forEach(item=>{
      const group=cacheGroup(item.scope);
      const summary=groups.get(group)||{
        scope:group,scopeCount:0,itemCount:0,itemCountKnown:false,byteSize:0,
        savedAt:0,lastAccessedAt:0,versions:new Set()
      };
      summary.scopeCount+=1;
      summary.byteSize+=Number(item.byteSize)||0;
      summary.savedAt=Math.max(summary.savedAt,Number(item.savedAt)||0);
      summary.lastAccessedAt=Math.max(summary.lastAccessedAt,Number(item.lastAccessedAt)||0);
      if(item.itemCount!==null){ summary.itemCountKnown=true; summary.itemCount+=Number(item.itemCount)||0; }
      if(item.version) summary.versions.add(item.version);
      groups.set(group,summary);
    });
    return [...groups.values()].sort((a,b)=>b.lastAccessedAt-a.lastAccessedAt);
  }
  function summaryCard(vi,zh,value,tone='blue'){
    return `<div class="system-monitor-summary-card is-${tone}">${dual(vi,zh,'div')}<b>${esc(value)}</b></div>`;
  }
  function notice(vi,zh){ return `<div class="system-monitor-notice"><i class="ti ti-info-circle"></i><div><p>${esc(vi)}</p><p>${esc(zh)}</p></div></div>`; }
  function filterLogs(){
    const user=state.logFilters.user.toLocaleLowerCase(),feature=state.logFilters.feature,search=state.logFilters.search.toLocaleLowerCase();
    return state.logs.filter(item=>{
      if(user&&!`${item.createdBy||''} ${item.createdByUid||''}`.toLocaleLowerCase().includes(user)) return false;
      if(feature&&item.feature!==feature&&item.permissionKey!==feature) return false;
      if(state.logFilters.status&&item.status!==state.logFilters.status) return false;
      if(search&&!`${item.action||''} ${item.note||''} ${item.fileName||''}`.toLocaleLowerCase().includes(search)) return false;
      return true;
    });
  }
  function renderLogs(){
    const rows=filterLogs();
    const users=new Set(rows.map(item=>item.createdByUid).filter(Boolean)).size;
    const failed=rows.filter(item=>item.status==='failed').length;
    return `
      <section class="system-monitor-panel">
        <div class="system-monitor-toolbar">
          <label>${dual('Từ ngày','開始日期')}<input id="sm-log-from" type="date" value="${esc(state.logFilters.from)}"></label>
          <label>${dual('Đến ngày','結束日期')}<input id="sm-log-to" type="date" value="${esc(state.logFilters.to)}"></label>
          <label>${dual('Người thao tác','操作人員')}<input id="sm-log-user" type="search" value="${esc(state.logFilters.user)}" placeholder="Tên hoặc UID / 姓名或UID"></label>
          <label>${dual('Chức năng','功能')}<select id="sm-log-feature"><option value="">Tất cả / 全部</option>${Object.entries(FEATURE_LABELS).map(([value,label])=>`<option value="${value}"${state.logFilters.feature===value?' selected':''}>${esc(label[0])} / ${esc(label[1])}</option>`).join('')}</select></label>
          <label>${dual('Trạng thái','狀態')}<select id="sm-log-status"><option value="">Tất cả / 全部</option><option value="success"${state.logFilters.status==='success'?' selected':''}>Thành công / 成功</option><option value="partial"${state.logFilters.status==='partial'?' selected':''}>Một phần / 部分完成</option><option value="failed"${state.logFilters.status==='failed'?' selected':''}>Thất bại / 失敗</option></select></label>
          <label class="is-wide">${dual('Từ khóa','關鍵字')}<input id="sm-log-search" type="search" value="${esc(state.logFilters.search)}" placeholder="Hành động, ghi chú / 動作、備註"></label>
          <button id="sm-log-refresh" class="ui-button ui-button-primary" type="button"><i class="ti ti-refresh"></i>${dual('Làm mới','重新整理')}</button>
        </div>
        <div class="system-monitor-summary">${summaryCard('Số nhật ký','日誌筆數',count(rows.length))}${summaryCard('Người thao tác','操作人數',count(users))}${summaryCard('Thất bại','失敗筆數',count(failed),failed?'orange':'blue')}</div>
        ${notice('Nhật ký chỉ ghi đăng nhập, đăng xuất và thao tác quan trọng; không ghi từng lần nhấp chuột.','日誌只記錄登入、登出及重要操作，不記錄每一次點擊。')}
        <div class="system-monitor-table-wrap"><table class="ui-table system-monitor-table"><thead><tr>
          <th>${dual('Thời gian','時間')}</th><th>${dual('Người thao tác','操作人員')}</th><th>${dual('Chức năng','功能')}</th>
          <th>${dual('Hành động','動作')}</th><th>${dual('Trạng thái','狀態')}</th><th>${dual('Số lượng','影響數量')}</th><th>${dual('Ghi chú','備註')}</th>
        </tr></thead><tbody>${rows.length?rows.map(item=>{
          const action=actionLabel(item.action),status=statusLabel(item.status);
          const feature=featureLabel(item.feature||item.permissionKey);
          return `<tr><td>${esc(dateTime(item.createdAt))}</td><td><b>${esc(item.createdBy||'—')}</b><small>${esc(item.createdByUid||'')}</small></td><td>${dual(feature[0],feature[1])}</td><td>${dual(action[0],action[1])}</td><td><span class="system-monitor-status is-${esc(item.status||'failed')}">${status[0]}<small>${status[1]}</small></span></td><td>${count(item.itemCount)}</td><td>${esc(item.note||item.fileName||'—')}</td></tr>`;
        }).join(''):`<tr><td colspan="7" class="system-monitor-empty">Không có dữ liệu phù hợp / 沒有符合的資料</td></tr>`}</tbody></table></div>
        ${state.logMore?`<button id="sm-log-more" class="ui-button system-monitor-more" type="button">${dual('Tải thêm 50 mục','再載入50筆')}</button>`:''}
      </section>`;
  }
  function usageTotals(rows){
    return rows.reduce((result,item)=>{
      Object.keys(result).forEach(key=>{ result[key]+=Number(item?.totals?.[key])||0; }); return result;
    },{queryCount:0,documentReads:0,documentWrites:0,cacheHits:0,cacheMisses:0,cacheWrites:0,fullLoads:0});
  }
  function filteredUsage(){
    const user=state.usageFilters.user.toLocaleLowerCase();
    return state.usage.filter(item=>!user||`${item.username||''} ${item.uid||''}`.toLocaleLowerCase().includes(user));
  }
  function renderCacheRows(){
    const metrics=state.local?.session?.cacheScopes||{};
    const rows=summarizeCacheEntries(state.local?.entries||[]);
    return rows.length?rows.map(item=>{
      const counter=metrics[item.scope]||{};
      const label=cacheLabel(item.scope);
      const version=item.versions.size<=1?[...item.versions][0]||'—':`${item.versions.size} phiên bản / ${item.versions.size}版本`;
      return `<tr><td>${dual(label[0],label[1])}<small>${count(item.scopeCount)} vùng đệm / ${count(item.scopeCount)}個快取區</small></td><td>${item.itemCountKnown?count(item.itemCount):'—'}</td><td>${bytes(item.byteSize)}</td><td>${esc(version)}</td><td>${dateTime(item.savedAt)}</td><td>${dateTime(item.lastAccessedAt)}</td><td>${count(counter.cacheHits)}</td><td>${count(counter.cacheMisses)}</td><td>${hitRate(counter.cacheHits,counter.cacheMisses)}</td></tr>`;
    }).join(''):`<tr><td colspan="9" class="system-monitor-empty">Chưa có bộ nhớ đệm / 目前沒有快取</td></tr>`;
  }
  function renderUsage(){
    const rows=filteredUsage(),totals=usageTotals(rows),localUsage=state.local?.usage||{usedBytes:0,maxBytes:0};
    return `
      <section class="system-monitor-panel">
        <div class="system-monitor-toolbar">
          <label>${dual('Từ ngày','開始日期')}<input id="sm-usage-from" type="date" value="${esc(state.usageFilters.from)}"></label>
          <label>${dual('Đến ngày','結束日期')}<input id="sm-usage-to" type="date" value="${esc(state.usageFilters.to)}"></label>
          <label class="is-wide">${dual('Người sử dụng','使用者')}<input id="sm-usage-user" type="search" value="${esc(state.usageFilters.user)}" placeholder="Tên hoặc UID / 姓名或UID"></label>
          <button id="sm-usage-refresh" class="ui-button ui-button-primary" type="button"><i class="ti ti-refresh"></i>${dual('Làm mới','重新整理')}</button>
        </div>
        <div class="system-monitor-summary">
          ${summaryCard('Lượt truy vấn ước tính','估算查詢次數',count(totals.queryCount))}
          ${summaryCard('Tài liệu trả về','回傳文件數',count(totals.documentReads))}
          ${summaryCard('Tỷ lệ trúng bộ nhớ đệm','快取命中率',hitRate(totals.cacheHits,totals.cacheMisses))}
          ${summaryCard('Tải lại toàn bộ','完整載入次數',count(totals.fullLoads),totals.fullLoads?'orange':'blue')}
          ${summaryCard('Bộ nhớ đệm máy này','本機快取用量',`${bytes(localUsage.usedBytes)} / ${bytes(localUsage.maxBytes)}`)}
        </div>
        ${notice('Số liệu cuộc gọi là ước tính do trang web ghi nhận; chi phí thực tế vẫn xem trong Firebase. Bảng bộ nhớ đệm chỉ thuộc tài khoản, máy tính và trình duyệt hiện tại.','呼叫數為網站記錄的估算值，實際計費仍以Firebase為準；快取表只代表目前帳號、電腦與瀏覽器。')}
        <div class="system-monitor-section-title">${dual('Bộ nhớ đệm trên máy này','目前電腦快取','div')}</div>
        <div class="system-monitor-table-wrap"><table class="ui-table system-monitor-table is-cache"><thead><tr><th>${dual('Phạm vi','快取範圍')}</th><th>${dual('Số mục','資料筆數')}</th><th>${dual('Dung lượng','容量')}</th><th>${dual('Phiên bản','版本')}</th><th>${dual('Đã lưu','儲存時間')}</th><th>${dual('Dùng gần nhất','最近使用')}</th><th>${dual('Trúng','命中')}</th><th>${dual('Trượt','未命中')}</th><th>${dual('Tỷ lệ','命中率')}</th></tr></thead><tbody>${renderCacheRows()}</tbody></table></div>
        <div class="system-monitor-section-title">${dual('Lượt gọi toàn hệ thống','全站呼叫估算','div')}</div>
        <div class="system-monitor-table-wrap"><table class="ui-table system-monitor-table"><thead><tr><th>${dual('Ngày','日期')}</th><th>${dual('Người sử dụng','使用者')}</th><th>${dual('Vai trò','角色')}</th><th>${dual('Truy vấn','查詢')}</th><th>${dual('Tài liệu','文件')}</th><th>${dual('Ghi dữ liệu','寫入')}</th><th>${dual('Trúng bộ nhớ đệm','快取命中')}</th><th>${dual('Trượt','未命中')}</th><th>${dual('Tỷ lệ','命中率')}</th><th>${dual('Tải toàn bộ','完整載入')}</th><th>${dual('Cập nhật','更新時間')}</th></tr></thead><tbody>${rows.length?rows.map(item=>{const role=roleLabel(item.role);return `<tr><td>${esc(item.usageDate||'—')}</td><td><b>${esc(item.username||'—')}</b><small>${esc(item.uid||'')}</small></td><td>${dual(role[0],role[1])}</td><td>${count(item.totals?.queryCount)}</td><td>${count(item.totals?.documentReads)}</td><td>${count(item.totals?.documentWrites)}</td><td>${count(item.totals?.cacheHits)}</td><td>${count(item.totals?.cacheMisses)}</td><td>${hitRate(item.totals?.cacheHits,item.totals?.cacheMisses)}</td><td>${count(item.totals?.fullLoads)}</td><td>${dateTime(item.updatedAt)}</td></tr>`;}).join(''):`<tr><td colspan="11" class="system-monitor-empty">Chưa có dữ liệu sử dụng / 目前沒有使用量資料</td></tr>`}</tbody></table></div>
        ${state.usageMore?`<button id="sm-usage-more" class="ui-button system-monitor-more" type="button">${dual('Tải thêm 50 mục','再載入50筆')}</button>`:''}
      </section>`;
  }
  function render(){
    const host=root(); if(!host) return;
    host.innerHTML=`<div class="system-monitor-page ui-work-panel">
      <div class="system-monitor-tabs ui-tabs ui-page-tabs" role="tablist" aria-label="Giám sát hệ thống / 系統監控">
        <button type="button" data-sm-tab="logs" class="ui-tab ${state.tab==='logs'?'is-active':''}" role="tab" aria-selected="${state.tab==='logs'}">${dual('Nhật ký toàn hệ thống','全站日誌')}</button>
        <button type="button" data-sm-tab="usage" class="ui-tab ${state.tab==='usage'?'is-active':''}" role="tab" aria-selected="${state.tab==='usage'}">${dual('Bộ nhớ đệm & lượt gọi','快取與呼叫')}</button>
      </div>
      ${state.error?`<div class="system-monitor-error">${esc(state.error)}</div>`:''}
      ${state.loading?`<div class="system-monitor-loading"><i class="ti ti-loader-2"></i>${dual('Đang tải dữ liệu','正在載入資料')}</div>`:state.tab==='logs'?renderLogs():renderUsage()}
    </div>`;
    bind();
  }
  function bind(){
    document.querySelectorAll('[data-sm-tab]').forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.smTab)));
    const bindValue=(id,handler,event='input')=>document.getElementById(id)?.addEventListener(event,e=>handler(e.target.value));
    if(state.tab==='logs'){
      bindValue('sm-log-user',value=>{state.logFilters.user=value;render();},'change');
      bindValue('sm-log-feature',value=>{state.logFilters.feature=value;render();},'change');
      bindValue('sm-log-status',value=>{state.logFilters.status=value;render();},'change');
      bindValue('sm-log-search',value=>{state.logFilters.search=value;render();},'change');
      document.getElementById('sm-log-refresh')?.addEventListener('click',()=>{
        state.logFilters.from=document.getElementById('sm-log-from')?.value||state.logFilters.from;
        state.logFilters.to=document.getElementById('sm-log-to')?.value||state.logFilters.to;
        void loadLogs(true,false);
      });
      document.getElementById('sm-log-more')?.addEventListener('click',()=>void loadLogs(false,true));
    }else{
      bindValue('sm-usage-user',value=>{state.usageFilters.user=value;render();},'change');
      document.getElementById('sm-usage-refresh')?.addEventListener('click',()=>{
        state.usageFilters.from=document.getElementById('sm-usage-from')?.value||state.usageFilters.from;
        state.usageFilters.to=document.getElementById('sm-usage-to')?.value||state.usageFilters.to;
        void loadUsage(true,false);
      });
      document.getElementById('sm-usage-more')?.addEventListener('click',()=>void loadUsage(false,true));
    }
  }
  async function withLoading(worker){
    state.loading=true; state.error=''; render();
    try{ await worker(); }
    catch(error){ console.error('系統監控載入失敗：',error); state.error=error?.message||'Không thể tải dữ liệu / 無法載入資料'; }
    finally{ state.loading=false; render(); }
  }
  async function loadLogs(force=false,loadMore=false){
    await withLoading(async()=>{
      const result=await window.PCMSSystemMonitorStore.loadLogs(state.logFilters,{force,loadMore});
      state.logs=result.rows; state.logMore=result.hasMore;
    });
  }
  async function loadUsage(force=false,loadMore=false){
    await withLoading(async()=>{
      await window.PCMSUsageMetrics?.flush?.({force:true});
      const [result,local]=await Promise.all([
        window.PCMSSystemMonitorStore.loadUsage(state.usageFilters,{force,loadMore}),
        window.PCMSSystemMonitorStore.loadLocalCache()
      ]);
      state.usage=result.rows; state.usageMore=result.hasMore; state.local=local;
    });
  }
  async function switchTab(tab){
    if(!['logs','usage'].includes(tab)||state.tab===tab) return;
    state.tab=tab;
    if(tab==='logs'&&!state.logs.length) await loadLogs();
    else if(tab==='usage'&&!state.local) await loadUsage();
    else render();
  }
  async function init(){
    if(window.cu?.role!=='admin') return;
    if(!state.logs.length) await loadLogs(); else render();
  }
  function leave(){
    window.PCMSSystemMonitorStore?.reset?.();
    state.logs=[]; state.logMore=false; state.usage=[]; state.usageMore=false;
    state.local=null; state.loading=false; state.error='';
  }

  window.systemMonitorInit=init;
  window.systemMonitorLeave=leave;
})();
