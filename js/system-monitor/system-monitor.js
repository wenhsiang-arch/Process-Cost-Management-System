// system-monitor（系統監控畫面）：管理員查看全站日誌、雲端呼叫與目前裝置快取。
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
  const PAGE_LABELS={
    home:['Trang chủ','首頁'],progress:['Dữ liệu đơn hàng','訂單資料'],summary:['Tổng hợp mã hàng','款號總表'],
    cutting:['Thống kê dây cắt','裁帶統計'],'production-entry':['Ghi nhận sản lượng','生產登記'],
    'production-records':['Hiệu suất nhân viên','員工績效'],'production-attendance':['Chấm công','考勤'],
    'production-employees':['Dữ liệu nhân viên','員工資料'],'production-analysis':['Phân tích sản xuất','生產分析'],
    sync:['Đồng bộ giây công đoạn','工序秒數同步'],settings:['Cài đặt chi phí','成本設定'],
    costlog:['Lịch sử chi phí','成本紀錄'],export:['Xuất giá công','產品工價匯出'],accounts:['Quản lý tài khoản','帳號管理'],
    permissions:['Phân quyền','權限管理'],'system-monitor':['Giám sát hệ thống','系統監控'],other:['Khác','其他']
  };
  const COUNTER_KEYS=['queryCount','writeRequestCount','documentReads','documentWrites','cacheHits','cacheMisses','cacheWrites','fullLoads'];
  const APP_CHECK_REFRESH_MS=30*60*1000;
  const AVERAGE_MONTH_DAYS=365.25/12;
  const state={
    tab:'logs',loading:false,error:null,logs:[],logMore:false,usage:[],usageMore:false,local:null,expandedUsage:new Set(),
    loaded:{logs:false,calls:false,cache:false},
    logFilters:{from:localDate(),to:localDate(),user:'',feature:'',status:'',search:''},
    usageFilters:{from:localDate(daysAgo(6)),to:localDate(),user:''}
  };

  function root(){ return document.getElementById('system-monitor-root'); }
  function esc(value){
    return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  }
  function localDate(date=new Date()){
    const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
    return `${year}-${month}-${day}`;
  }
  function daysAgo(amount){ const date=new Date(); date.setDate(date.getDate()-Math.max(0,Number(amount)||0)); return date; }
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
  function pageLabel(value){ return PAGE_LABELS[value]||[String(value||'other'),String(value||'other')]; }
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
  function notice(vi,zh){ return `<div class="system-monitor-notice"><i class="ti ti-info-circle"></i><div><p class="ui-text-vi">${esc(vi)}</p><p class="ui-text-zh">${esc(zh)}</p></div></div>`; }
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
          return `<tr><td>${esc(dateTime(item.createdAt))}</td><td><b>${esc(item.createdBy||'—')}</b><small>${esc(item.createdByUid||'')}</small></td><td>${dual(feature[0],feature[1])}</td><td>${dual(action[0],action[1])}</td><td><span class="system-monitor-status is-${esc(item.status||'failed')}">${dual(status[0],status[1])}</span></td><td>${count(item.itemCount)}</td><td>${esc(item.note||item.fileName||'—')}</td></tr>`;
        }).join(''):`<tr><td colspan="7" class="system-monitor-empty">${dual('Không có dữ liệu phù hợp','沒有符合的資料')}</td></tr>`}</tbody></table></div>
        ${state.logMore?`<button id="sm-log-more" class="ui-button system-monitor-more" type="button">${dual('Tải thêm 50 mục','再載入50筆')}</button>`:''}
      </section>`;
  }
  function emptyCounters(){ return Object.fromEntries(COUNTER_KEYS.map(key=>[key,0])); }
  function addCounters(target,source={}){
    COUNTER_KEYS.forEach(key=>{ target[key]+=(Number(source?.[key])||0); });
    return target;
  }
  function usageTotals(rows){ return rows.reduce((result,item)=>addCounters(result,item?.totals),emptyCounters()); }
  function isLegacyUsage(item){
    return Number(item?.schemaVersion)!==2||!Object.prototype.hasOwnProperty.call(item?.totals||{},'writeRequestCount');
  }
  function knownCalls(item){ return (Number(item?.totals?.queryCount)||0)+(Number(item?.totals?.writeRequestCount)||0); }
  function callDisplay(item){ return `${item?.legacy?'≥':''}${count(knownCalls(item))}`; }
  function writeCallDisplay(item){
    const value=Number(item?.totals?.writeRequestCount)||0;
    if(!item?.legacy) return count(value);
    return value?`≥${count(value)}`:'—';
  }
  function filteredUsage(){
    const user=state.usageFilters.user.toLocaleLowerCase();
    return state.usage.filter(item=>!user||`${item.username||''} ${item.uid||''}`.toLocaleLowerCase().includes(user));
  }
  function usageFilterDayCount(){
    const parse=value=>{
      const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return match?Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])):NaN;
    };
    const from=parse(state.usageFilters.from),to=parse(state.usageFilters.to);
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<from) return 1;
    return Math.floor((to-from)/(24*60*60*1000))+1;
  }
  function appCheckSessionEstimate(item){
    const startedAt=millis(item?.startedAt);
    const endedAt=millis(item?.endedAt)||millis(item?.updatedAt);
    if(!startedAt||endedAt<startedAt) return 0;
    return Math.max(1,Math.ceil((endedAt-startedAt)/APP_CHECK_REFRESH_MS));
  }
  function appCheckMonthlyEstimate(){
    const sessions=filteredUsage();
    if(!sessions.length) return null;
    const periodEstimate=sessions.reduce((sum,item)=>sum+appCheckSessionEstimate(item),0);
    if(!periodEstimate) return null;
    return Math.max(1,Math.round(periodEstimate/usageFilterDayCount()*AVERAGE_MONTH_DAYS));
  }
  function aggregateUsageRows(){
    const groups=new Map();
    filteredUsage().forEach(item=>{
      const identity=String(item.uid||item.username||'unknown');
      const key=`${item.usageDate||'unknown'}__${identity}`;
      const legacy=isLegacyUsage(item);
      const group=groups.get(key)||{
        key,usageDate:item.usageDate||'—',uid:item.uid||'',username:item.username||item.uid||'—',role:item.role||'',
        totals:emptyCounters(),pages:new Map(),legacy:false,sessionCount:0,updatedAt:0,comparison:null
      };
      addCounters(group.totals,item.totals);
      group.legacy=group.legacy||legacy;
      group.sessionCount+=1;
      if(millis(item.updatedAt)>=group.updatedAt){
        group.updatedAt=millis(item.updatedAt);
        group.username=item.username||group.username;
        group.role=item.role||group.role;
      }
      Object.entries(item.pages||{}).forEach(([page,counters])=>{
        const pageRow=group.pages.get(page)||{page,totals:emptyCounters(),legacy:false};
        addCounters(pageRow.totals,counters);
        pageRow.legacy=pageRow.legacy||legacy;
        group.pages.set(page,pageRow);
      });
      groups.set(key,group);
    });
    const rows=[...groups.values()].map(item=>({...item,pages:[...item.pages.values()].sort((a,b)=>knownCalls(b)-knownCalls(a))}));
    rows.forEach(item=>{
      if(item.legacy) return;
      const history=rows.filter(other=>other.uid===item.uid&&!other.legacy&&other.usageDate<item.usageDate)
        .sort((a,b)=>b.usageDate.localeCompare(a.usageDate)).slice(0,7);
      if(history.length<3) return;
      const average=history.reduce((sum,other)=>sum+knownCalls(other),0)/history.length;
      if(average<=0) return;
      const current=knownCalls(item);
      item.comparison={average,days:history.length,percent:(current-average)/average*100,attention:current>average*2};
    });
    return rows.sort((a,b)=>b.usageDate.localeCompare(a.usageDate)||knownCalls(b)-knownCalls(a));
  }
  function renderCacheRows(){
    const metrics=state.local?.session?.cacheScopes||{};
    const rows=summarizeCacheEntries(state.local?.entries||[]);
    return rows.length?rows.map(item=>{
      const counter=metrics[item.scope]||{};
      const label=cacheLabel(item.scope);
      const version=item.versions.size<=1?esc([...item.versions][0]||'—'):dual(`${item.versions.size} phiên bản`,`${item.versions.size}版本`);
      return `<tr><td>${dual(label[0],label[1])}${dual(`${count(item.scopeCount)} vùng đệm`,`${count(item.scopeCount)}個快取區`,'small')}</td><td>${item.itemCountKnown?count(item.itemCount):'—'}</td><td>${bytes(item.byteSize)}</td><td>${version}</td><td>${dateTime(item.savedAt)}</td><td>${dateTime(item.lastAccessedAt)}</td><td>${count(counter.cacheHits)}</td><td>${count(counter.cacheMisses)}</td><td>${hitRate(counter.cacheHits,counter.cacheMisses)}</td></tr>`;
    }).join(''):`<tr><td colspan="9" class="system-monitor-empty">${dual('Chưa có bộ nhớ đệm','目前沒有快取')}</td></tr>`;
  }
  function comparisonCell(item){
    if(item.legacy) return `<span>—</span>${dual('Dữ liệu cũ','舊資料','small')}`;
    if(!item.comparison) return `<span>—</span>${dual('Cần 3 ngày trước','需3個舊日','small')}`;
    const direction=item.comparison.percent>=0?'+':'';
    return `<b>${esc(`${direction}${item.comparison.percent.toFixed(0)}%`)}</b>${dual(`TB ${count(Math.round(item.comparison.average))}`,`平均${count(Math.round(item.comparison.average))}`,'small')}`;
  }
  function attentionCell(item){
    if(!item.comparison) return '—';
    return item.comparison.attention
      ?`<span class="system-monitor-status is-attention">${dual('Cần chú ý','待關注')}</span>`
      :`<span class="system-monitor-status is-normal">${dual('Bình thường','一般')}</span>`;
  }
  function renderUsageDetails(item){
    const rows=item.pages;
    return `<tr class="system-monitor-detail-row"><td colspan="10"><div class="system-monitor-detail-card">
      <div class="system-monitor-detail-title">${dual('Chi tiết theo chức năng','依功能明細','div')}${dual(`${count(item.sessionCount)} phiên đăng nhập`,`${count(item.sessionCount)}個登入工作階段`,'small')}</div>
      <div class="system-monitor-table-wrap"><table class="ui-table system-monitor-table is-detail"><thead><tr>
        <th>${dual('Chức năng','功能')}</th><th>${dual('Tổng lượt gọi','總呼叫')}</th><th>${dual('Lượt đọc','讀取呼叫')}</th><th>${dual('Lượt ghi','寫入呼叫')}</th>
        <th>${dual('Tài liệu đọc','讀取文件')}</th><th>${dual('Tài liệu ghi','寫入文件')}</th><th>${dual('Tải toàn bộ','完整載入')}</th>
      </tr></thead><tbody>${rows.length?rows.map(page=>{const label=pageLabel(page.page);return `<tr><td>${dual(label[0],label[1])}</td><td class="system-monitor-call-total">${callDisplay(page)}</td><td>${count(page.totals.queryCount)}</td><td>${writeCallDisplay(page)}</td><td>${count(page.totals.documentReads)}</td><td>${count(page.totals.documentWrites)}</td><td>${count(page.totals.fullLoads)}</td></tr>`;}).join(''):`<tr><td colspan="7" class="system-monitor-empty">${dual('Không có chi tiết chức năng','沒有功能明細')}</td></tr>`}</tbody></table></div>
    </div></td></tr>`;
  }
  function renderCalls(){
    const rows=aggregateUsageRows(),totals=usageTotals(rows);
    const hasLegacy=rows.some(item=>item.legacy);
    const attention=rows.filter(item=>item.comparison?.attention).length;
    const appCheckEstimate=appCheckMonthlyEstimate();
    return `
      <section class="system-monitor-panel">
        <div class="system-monitor-toolbar">
          <label>${dual('Từ ngày','開始日期')}<input id="sm-usage-from" type="date" value="${esc(state.usageFilters.from)}"></label>
          <label>${dual('Đến ngày','結束日期')}<input id="sm-usage-to" type="date" value="${esc(state.usageFilters.to)}"></label>
          <label class="is-wide">${dual('Người sử dụng','使用者')}<input id="sm-usage-user" type="search" value="${esc(state.usageFilters.user)}" placeholder="Tên hoặc UID / 姓名或UID"></label>
          <button id="sm-usage-refresh" class="ui-button ui-button-primary" type="button"><i class="ti ti-refresh"></i>${dual('Làm mới','重新整理')}</button>
        </div>
        <div class="system-monitor-summary is-six">
          ${summaryCard('Tổng lượt gọi ước tính','估算總呼叫',`${hasLegacy?'≥':''}${count(totals.queryCount+totals.writeRequestCount)}`)}
          ${summaryCard('Lượt gọi đọc','讀取呼叫',count(totals.queryCount))}
          ${summaryCard('Lượt gọi ghi','寫入呼叫',`${hasLegacy?'≥':''}${count(totals.writeRequestCount)}`)}
          ${summaryCard('Ngày cần chú ý','待關注日數',count(attention),attention?'orange':'blue')}
          ${summaryCard('Tải lại toàn bộ','完整載入次數',count(totals.fullLoads),totals.fullLoads?'orange':'blue')}
          ${summaryCard('Ước tính App Check nội bộ/tháng','內部App Check月估算',appCheckEstimate===null?'—':`${state.usageMore?'≥':''}${count(appCheckEstimate)}`)}
        </div>
        ${notice('Tổng lượt gọi = lượt đọc + lượt ghi. Một lần ghi theo lô chỉ tính 1 lượt gọi; số tài liệu nằm trong phần mở rộng. Đây là số ước tính của trang web, chi phí thực tế vẫn theo Firebase.','總呼叫＝讀取呼叫＋寫入呼叫。一次批次寫入只算1次呼叫；文件數放在展開明細。這是網站估算值，實際計費仍以Firebase為準。')}
        ${notice('Ước tính App Check nội bộ dựa trên thời lượng phiên trong khoảng lọc: khoảng 1 lần mỗi 30 phút, sau đó quy đổi theo 30,44 ngày/tháng. Không bao gồm lượt truy cập chưa đăng nhập hoặc tấn công bên ngoài và không phải số chính thức của Google.','內部App Check月估算依篩選期間的工作階段時長計算：約每30分鐘1次，再換算為每月30.44天。不包含未登入瀏覽或外部攻擊，也不是Google正式統計。')}
        ${hasLegacy?notice('Dữ liệu cũ chưa ghi riêng lượt gọi ghi nên hiển thị dấu ≥, không giả định thành số chính xác.','舊資料沒有獨立記錄寫入呼叫，因此以≥顯示，不假裝為精確數字。'):''}
        <div class="system-monitor-table-wrap"><table class="ui-table system-monitor-table is-calls"><thead><tr><th></th><th>${dual('Ngày','日期')}</th><th>${dual('Người sử dụng','使用者')}</th><th>${dual('Vai trò','角色')}</th><th>${dual('Tổng lượt gọi','總呼叫')}</th><th>${dual('Lượt đọc','讀取呼叫')}</th><th>${dual('Lượt ghi','寫入呼叫')}</th><th>${dual('So với bình quân','與平均比較')}</th><th>${dual('Trạng thái','狀態')}</th><th>${dual('Cập nhật','更新時間')}</th></tr></thead><tbody>${rows.length?rows.map(item=>{const role=roleLabel(item.role),expanded=state.expandedUsage.has(item.key);return `<tr class="system-monitor-call-row"><td><button class="system-monitor-expand-button" type="button" data-sm-usage-key="${esc(item.key)}" aria-expanded="${expanded}" title="Mở chi tiết / 展開明細"><i class="ti ti-chevron-${expanded?'up':'down'}"></i></button></td><td>${esc(item.usageDate)}</td><td><b>${esc(item.username)}</b><small>${esc(item.uid)}</small></td><td>${dual(role[0],role[1])}</td><td class="system-monitor-call-total">${callDisplay(item)}</td><td>${count(item.totals.queryCount)}</td><td>${writeCallDisplay(item)}</td><td>${comparisonCell(item)}</td><td>${attentionCell(item)}</td><td>${dateTime(item.updatedAt)}</td></tr>${expanded?renderUsageDetails(item):''}`;}).join(''):`<tr><td colspan="10" class="system-monitor-empty">${dual('Chưa có dữ liệu lượt gọi','目前沒有呼叫資料')}</td></tr>`}</tbody></table></div>
        ${state.usageMore?`<button id="sm-usage-more" class="ui-button system-monitor-more" type="button">${dual('Tải thêm 50 mục','再載入50筆')}</button>`:''}
      </section>`;
  }
  function renderCache(){
    const localUsage=state.local?.usage||{usedBytes:0,maxBytes:0};
    const sessionTotals=state.local?.session?.totals||emptyCounters();
    const cacheRows=summarizeCacheEntries(state.local?.entries||[]);
    return `<section class="system-monitor-panel">
      <div class="system-monitor-cache-actions"><button id="sm-cache-refresh" class="ui-button ui-button-primary" type="button"><i class="ti ti-refresh"></i>${dual('Làm mới','重新整理')}</button></div>
      <div class="system-monitor-summary is-four">
        ${summaryCard('Tỷ lệ trúng bộ nhớ đệm','快取命中率',hitRate(sessionTotals.cacheHits,sessionTotals.cacheMisses))}
        ${summaryCard('Lượt trúng','命中次數',count(sessionTotals.cacheHits))}
        ${summaryCard('Lượt trượt','未命中次數',count(sessionTotals.cacheMisses),sessionTotals.cacheMisses?'orange':'blue')}
        ${summaryCard('Dung lượng máy này','本機快取用量',`${bytes(localUsage.usedBytes)} / ${bytes(localUsage.maxBytes)}`)}
      </div>
      ${notice('Bảng này chỉ hiển thị bộ nhớ đệm của tài khoản, máy tính và trình duyệt hiện tại; không phải tổng của toàn hệ thống.','此表只顯示目前帳號、電腦與瀏覽器的快取，不是全站總量。')}
      <div class="system-monitor-table-wrap"><table class="ui-table system-monitor-table is-cache"><thead><tr><th>${dual('Phạm vi','快取範圍')}</th><th>${dual('Số mục','資料筆數')}</th><th>${dual('Dung lượng','容量')}</th><th>${dual('Phiên bản','版本')}</th><th>${dual('Đã lưu','儲存時間')}</th><th>${dual('Dùng gần nhất','最近使用')}</th><th>${dual('Trúng','命中')}</th><th>${dual('Trượt','未命中')}</th><th>${dual('Tỷ lệ','命中率')}</th></tr></thead><tbody>${renderCacheRows()}</tbody></table></div>
      <small class="system-monitor-cache-count">${dual(`${count(cacheRows.length)} nhóm bộ nhớ đệm`,`${count(cacheRows.length)}個快取群組`)}</small>
    </section>`;
  }
  function render(){
    const host=root(); if(!host) return;
    host.innerHTML=`<div class="system-monitor-page ui-work-panel">
      <div class="system-monitor-tabs ui-tabs ui-page-tabs" role="tablist" aria-label="Giám sát hệ thống / 系統監控">
        <button type="button" data-sm-tab="logs" class="ui-tab ${state.tab==='logs'?'is-active':''}" role="tab" aria-selected="${state.tab==='logs'}">${dual('Nhật ký toàn hệ thống','全站日誌')}</button>
        <button type="button" data-sm-tab="calls" class="ui-tab ${state.tab==='calls'?'is-active':''}" role="tab" aria-selected="${state.tab==='calls'}">${dual('Giám sát lượt gọi','呼叫監控')}</button>
        <button type="button" data-sm-tab="cache" class="ui-tab ${state.tab==='cache'?'is-active':''}" role="tab" aria-selected="${state.tab==='cache'}">${dual('Tình trạng bộ nhớ đệm','快取狀況')}</button>
      </div>
      ${state.error?`<div class="system-monitor-error">${dual(state.error.vi,state.error.zh,'div')}</div>`:''}
      ${state.loading?`<div class="system-monitor-loading"><i class="ti ti-loader-2"></i>${dual('Đang tải dữ liệu','正在載入資料')}</div>`:state.tab==='logs'?renderLogs():state.tab==='calls'?renderCalls():renderCache()}
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
    }else if(state.tab==='calls'){
      bindValue('sm-usage-user',value=>{state.usageFilters.user=value;render();},'change');
      document.getElementById('sm-usage-refresh')?.addEventListener('click',()=>{
        state.usageFilters.from=document.getElementById('sm-usage-from')?.value||state.usageFilters.from;
        state.usageFilters.to=document.getElementById('sm-usage-to')?.value||state.usageFilters.to;
        void loadUsage(true,false);
      });
      document.getElementById('sm-usage-more')?.addEventListener('click',()=>void loadUsage(false,true));
      document.querySelectorAll('[data-sm-usage-key]').forEach(button=>button.addEventListener('click',()=>{
        const key=button.dataset.smUsageKey;
        if(state.expandedUsage.has(key)) state.expandedUsage.delete(key); else state.expandedUsage.add(key);
        render();
      }));
    }else{
      document.getElementById('sm-cache-refresh')?.addEventListener('click',()=>void loadCache());
    }
  }
  async function withLoading(worker){
    state.loading=true; state.error=null; render();
    try{ await worker(); }
    catch(error){ console.error('系統監控載入失敗：',error); state.error=window.PCMSUIText.errorPair(error,{vi:'Không thể tải dữ liệu.',zh:'無法載入資料。'}); }
    finally{ state.loading=false; render(); }
  }
  async function loadLogs(force=false,loadMore=false){
    await withLoading(async()=>{
      const result=await window.PCMSSystemMonitorStore.loadLogs(state.logFilters,{force,loadMore});
      state.logs=result.rows; state.logMore=result.hasMore;
      state.loaded.logs=true;
    });
  }
  async function loadUsage(force=false,loadMore=false){
    await withLoading(async()=>{
      await window.PCMSUsageMetrics?.flush?.({force:true});
      const result=await window.PCMSSystemMonitorStore.loadUsage(state.usageFilters,{force,loadMore});
      state.usage=result.rows; state.usageMore=result.hasMore; state.loaded.calls=true;
    });
  }
  async function loadCache(){
    await withLoading(async()=>{
      state.local=await window.PCMSSystemMonitorStore.loadLocalCache();
      state.loaded.cache=true;
    });
  }
  async function switchTab(tab){
    if(!['logs','calls','cache'].includes(tab)||state.tab===tab) return;
    state.tab=tab;
    if(tab==='logs'&&!state.loaded.logs) await loadLogs();
    else if(tab==='calls'&&!state.loaded.calls) await loadUsage();
    else if(tab==='cache'&&!state.loaded.cache) await loadCache();
    else render();
  }
  async function init(){
    if(window.cu?.role!=='admin') return;
    if(!state.loaded.logs) await loadLogs(); else render();
  }
  function leave(){
    window.PCMSSystemMonitorStore?.reset?.();
    state.logs=[]; state.logMore=false; state.usage=[]; state.usageMore=false;
    state.local=null; state.loading=false; state.error=''; state.expandedUsage.clear();
    state.loaded={logs:false,calls:false,cache:false};
  }

  window.systemMonitorInit=init;
  window.systemMonitorLeave=leave;
})();
