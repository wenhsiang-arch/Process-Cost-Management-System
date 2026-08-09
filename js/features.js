// features（功能中央清單）：統一管理導覽、頁面、權限、程式依賴、資料載入與進入頁面動作。
(function(){
  const SCRIPT_URLS = Object.freeze({
    history:'js/history.js?v=20260809-2',
    fileIo:'js/file-io.js?v=20260808-1',
    settings:'js/settings.js?v=20260809-3',
    uiTableControls:'js/ui-table-controls.js?v=20260810-4',
    productCache:'js/product-cache.js?v=20260806-1',
    orderProcessCache:'js/order-process-cache.js?v=20260806-1',
    summary:'js/summary.js?v=20260810-2',
    data:'js/data.js?v=20260809-2',
    costLog:'js/cost-log.js?v=20260810-1',
    cuttingStore:'js/cutting-store.js?v=20260804-4',
    cutting:'js/cutting.js?v=20260810-2',
    accounts:'js/accounts.js?v=20260809-1',
    orders:'js/orders.js?v=20260810-1',
    sync:'js/sync.js?v=20260808-1',
    permissions:'js/permissions.js?v=20260810-1',
    productionEmployeeStore:'js/production/employee-store.js?v=20260809-3',
    productionEntryStore:'js/production/entry-store.js?v=20260809-3',
    productionReportStore:'js/production/report-store.js?v=20260810-3',
    productionAttendanceStore:'js/production/attendance-store.js?v=20260810-1',
    productionEntry:'js/production/production-entry.js?v=20260810-5',
    productionRecords:'js/production/production-records.js?v=20260810-3',
    productionAttendance:'js/production/production-attendance.js?v=20260810-2',
    productionEmployees:'js/production/production-employees.js?v=20260810-3'
  }); // SCRIPT_URLS（功能程式網址）：修改功能檔時只更新對應版本。

  const STYLE_URLS = Object.freeze({
    cutting:'styles/features/cutting.css?v=20260810-2',
    orders:'styles/features/orders.css?v=20260810-2',
    products:'styles/features/products.css?v=20260810-1',
    sync:'styles/features/sync.css?v=20260810-2',
    cost:'styles/features/cost.css?v=20260810-2',
    accounts:'styles/features/accounts.css?v=20260810-2',
    production:'styles/features/production.css?v=20260810-9'
  }); // STYLE_URLS（功能樣式網址）：功能開啟時才載入自己的畫面樣式。

  const FEATURE_MODULES = Object.freeze([
    {
      id:'orders',navId:'progress',navGroup:'primary',icon:'ti-chart-bar',mainKey:'progress',
      vi:'Dữ liệu đơn hàng',zh:'訂單資料',
      pages:[
        {
          page:'progress',feature:'progress',icon:'ti-chart-bar',vi:'Dữ liệu đơn hàng',zh:'訂單資料',
          styles:['orders'],
          // data（資料與報表程式）目前仍提供訂單明細共用的工序分類文字；待後續拆出共用工具。
          scripts:['history','productCache','uiTableControls','orderProcessCache','data','orders'],
          dataScopes:['operationSettings','orders','orderProcesses'],
          dataLoaders:['ensureOperationSettingsLoaded','loadOrderData'],
          onOpen:['renderProgress','renderOrders']
        }
      ]
    },
    {
      id:'products',navId:'products',navGroup:'primary',icon:'ti-layout-list',mainKey:'productsMain',
      vi:'Quản lý mã hàng',zh:'款號管理',
      pages:[
        {
          page:'summary',feature:'summary',icon:'ti-layout-list',vi:'Tổng hợp mã hàng',zh:'款號總表',
          styles:['products'],
          scripts:['history','fileIo','productCache','uiTableControls','summary','data'],
          dataScopes:['operationSettings','costSettings','products'],
          dataLoaders:[
            'ensureOperationSettingsLoaded',
            {name:'ensureCostSettingsLoaded',when:'costView'},
            'ensureProductsLoaded'
          ],
          onOpen:['rSum'],onLeave:['summaryLeave'],
          restrictions:[
            {key:'costView',vi:'Hiển thị giá công sản phẩm',zh:'顯示產品工價'}
          ]
        }
      ]
    },
    {
      id:'cutting',navId:'cutting',navGroup:'primary',icon:'ti-scissors',mainKey:'cutting',
      usesInternalTabs:true, // usesInternalTabs（使用內部分頁）：裁帶已有三格正式抬頭，不重複產生外層單格。
      vi:'Thống kê dây cắt',zh:'裁帶統計',
      pages:[
        {
          page:'cutting',feature:'cutting',icon:'ti-scissors',vi:'Thống kê dây cắt',zh:'裁帶統計',
          styles:['cutting'],scripts:['history','fileIo','uiTableControls','cuttingStore','cutting'],dataScopes:['cuttingTemplates'],dataLoaders:[],onOpen:['cuttingInit']
        }
      ]
    },
    {
      id:'production',navId:'production',navGroup:'primary',icon:'ti-clipboard-data',mainKey:'productionMain',
      vi:'Ghi nhận sản lượng',zh:'產能登記',
      pages:[
        {
          page:'production-entry',feature:'productionEntry',icon:'ti-clipboard-plus',vi:'Ghi nhận sản xuất',zh:'生產登記',
          styles:['production'],
          scripts:['uiTableControls','orderProcessCache','productionEmployeeStore','productionEntryStore','productionReportStore','productionAttendanceStore','productionEntry'],
          dataScopes:['productionEmployees','orders','orderProcesses','productionEntries','productionProcessTotals','productionAttendance'],
          dataLoaders:['loadProductionEntryData'],onOpen:['productionEntryInit'],onLeave:['productionEntryLeave']
        },
        {
          page:'production-records',feature:'productionRecords',icon:'ti-chart-bar',vi:'Hiệu suất nhân viên',zh:'員工績效',
          styles:['production'],
          scripts:['uiTableControls','productionEmployeeStore','productionEntryStore','productionReportStore','productionAttendanceStore','productionRecords'],
          dataScopes:['productionEmployees','productionEntries','productionProcessTotals','productionAttendance'],
          dataLoaders:['loadProductionRecordsData'],onOpen:['productionRecordsInit'],onLeave:['productionRecordsLeave']
        },
        {
          page:'production-attendance',feature:'productionAttendance',icon:'ti-calendar-time',vi:'Chấm công',zh:'考勤',
          styles:['production'],
          scripts:['uiTableControls','productionEmployeeStore','productionReportStore','productionAttendanceStore','productionAttendance'],
          dataScopes:['productionEmployees','productionEntries','productionAttendance'],
          dataLoaders:['loadProductionAttendanceData'],onOpen:['productionAttendanceInit'],onLeave:['productionAttendanceLeave']
        },
        {
          page:'production-employees',feature:'productionEmployees',icon:'ti-users',vi:'Dữ liệu nhân viên',zh:'員工資料',
          styles:['production'],
          scripts:['uiTableControls','productionEmployeeStore','productionEmployees'],
          dataScopes:['productionEmployees','productionDepartments'],dataLoaders:['loadProductionEmployeesData'],onOpen:['productionEmployeesInit']
        }
      ]
    },
    {
      id:'sync',navId:'sync',navGroup:'management',icon:'ti-refresh',mainKey:'sync',
      vi:'Đồng bộ giây công đoạn',zh:'工序秒數同步',
      pages:[
        {
          page:'sync',feature:'sync',icon:'ti-refresh',vi:'Đồng bộ giây công đoạn',zh:'工序秒數同步',
          styles:['sync'],
          scripts:['uiTableControls','orderProcessCache','orders','sync'],
          dataScopes:['operationSettings','orders','orderProcesses'],
          dataLoaders:['ensureOperationSettingsLoaded','reloadOrders'],
          onOpen:['syncInit']
        }
      ]
    },
    {
      id:'cost',navId:'cost',navGroup:'management',icon:'ti-currency-dollar',mainKey:'costMain',
      vi:'Quản lý chi phí',zh:'成本管理',
      pages:[
        {
          page:'settings',feature:'settings',icon:'ti-settings',vi:'Cài đặt chi phí',zh:'成本設定',
          styles:['cost'],
          scripts:['history','summary','data','settings'],
          dataScopes:['operationSettings','costSettings'],
          dataLoaders:['loadCostSettingsPageData'],
          onOpen:['rAll']
        },
        {
          page:'costlog',feature:'costlog',icon:'ti-file-analytics',vi:'Lịch sử chi phí',zh:'成本變動記錄',
          styles:['cost'],scripts:['history','costLog'],dataScopes:['operationLogs:costlog'],dataLoaders:['ensureCostLogLoaded'],onOpen:['rClog']
        },
        {
          page:'export',feature:'export',icon:'ti-download',vi:'Xuất giá công sản phẩm',zh:'產品工價匯出',
          styles:['cost'],
          scripts:['history','fileIo','productCache','uiTableControls','data'],
          dataScopes:['operationSettings','costSettings','products'],
          dataLoaders:['ensureOperationSettingsLoaded','ensureCostSettingsLoaded','ensureProductsLoaded'],
          onOpen:['rExp']
        }
      ]
    },
    {
      id:'accounts',navId:'accounts',navGroup:'management',icon:'ti-users',adminOnly:true,
      vi:'Quản lý tài khoản',zh:'帳號管理',
      pages:[
        {
          page:'accounts',adminOnly:true,icon:'ti-users',vi:'Quản lý tài khoản',zh:'帳號管理',
          styles:['accounts'],scripts:['uiTableControls','accounts'],dataScopes:['userAccess'],dataLoaders:['loadAccounts'],onOpen:['rAcc']
        },
        {
          page:'permissions',adminOnly:true,icon:'ti-shield-check',vi:'Phân quyền',zh:'權限管理',
          styles:['accounts'],scripts:['permissions'],dataScopes:['rolePermissions'],dataLoaders:[],onOpen:['renderPermissions']
        }
      ]
    }
  ]); // FEATURE_MODULES（中央功能清單）：權限頁與系統頁面共用同一份來源。

  const PERMISSION_KEYS = Object.freeze([
    'progress','orderImport','productsMain','summary','costView','cutting','sync',
    'productionMain','productionEntry','productionRecords','productionAttendance','productionEmployees',
    'costMain','settings','costlog','export','accounts'
  ]); // PERMISSION_KEYS（可儲存權限欄位）：必須與 Firestore Rules（雲端資料庫安全規則）一致。

  const pageMap = new Map(); // pageMap（頁面設定索引）
  const moduleMap = new Map(); // moduleMap（主功能設定索引）
  FEATURE_MODULES.forEach(module=>{
    moduleMap.set(module.id,module);
    module.pages.forEach(page=>pageMap.set(page.page,{...page,moduleId:module.id}));
  });

  const PERMISSION_STRUCTURE = Object.freeze(FEATURE_MODULES.map(module=>({
    id:module.id,
    icon:module.icon,
    mainKey:module.mainKey,
    adminOnly:module.adminOnly===true,
    vi:module.vi,
    zh:module.zh,
    restrictions:module.restrictions||[],
    pages:(module.pages.length===1&&module.pages[0].feature===module.mainKey
      ? []
      : module.pages.map(page=>({
        key:page.feature||page.page,
        adminOnly:page.adminOnly===true,
        vi:page.vi,
        zh:page.zh,
        restrictions:page.restrictions||[]
      })))
  }))); // PERMISSION_STRUCTURE（權限頁階層）：由中央功能清單產生，不再另外維護。

  const loadedScriptPromises = new Map(); // loadedScriptPromises（已載入或載入中的程式）
  const loadedStylePromises = new Map(); // loadedStylePromises（已載入或載入中的功能樣式）
  const pageDataStates = new Map(); // pageDataStates（功能頁資料狀態）：同一登入工作階段重複切換時共用。
  const PAGE_DATA_FRESH_MS = 60000; // PAGE_DATA_FRESH_MS（功能頁背景檢查間隔）：一分鐘內不重複檢查。
  let spreadsheetToolPromise = null; // spreadsheetToolPromise（Excel 表格工具載入工作）
  let activePageName = ''; // activePageName（目前功能頁面）

  function getPage(name){ return pageMap.get(name)||null; }
  function getModule(name){ return moduleMap.get(name)||null; }
  function getModules(){ return FEATURE_MODULES.slice(); }
  function getEntryOrder(){ return ['progress','summary','production-entry','cutting','sync','costlog','export']; }

  // createEmptyPermissionSet（建立全關閉權限）：沒有明確設定時一律拒絕。
  function createEmptyPermissionSet(){
    return Object.fromEntries(PERMISSION_KEYS.map(key=>[key,false]));
  }

  const DEFAULT_PERMISSIONS = Object.freeze(Object.fromEntries(
    CONFIGURABLE_ROLES.map(role=>[role,Object.freeze(createEmptyPermissionSet())])
  )); // DEFAULT_PERMISSIONS（安全預設權限）：只作拒絕用途，不猜測角色工作內容。

  // normalizeFeaturePermissions（正規化功能權限）：功能分頁開啟就允許該頁內操作，只保留敏感資料子開關。
  function normalizeFeaturePermissions(features,defaults=createEmptyPermissionSet()){
    const normalized={};
    PERMISSION_KEYS.forEach(key=>{
      normalized[key]=features&&typeof features[key]==='boolean'
        ? features[key]
        : defaults[key]===true;
    });
    if(features&&typeof features.productsMain!=='boolean'){
      normalized.productsMain=normalized.summary===true||normalized.costView===true;
    }
    // orderImport（舊訂單匯入權限）只保留作為雲端舊文件相容欄位，實際權限永遠跟隨 progress（訂單資料分頁）。
    normalized.orderImport=normalized.progress===true;
    if(features&&typeof features.costMain!=='boolean'){
      normalized.costMain=normalized.settings===true||normalized.costlog===true||normalized.export===true;
    }
    if(features&&typeof features.productionMain!=='boolean'){
      normalized.productionMain=normalized.productionEntry===true
        ||normalized.productionRecords===true
        ||normalized.productionAttendance===true
        ||normalized.productionEmployees===true;
    }
    normalized.accounts=false;
    return normalized;
  }

  function resetPermissionsToDefaults(){
    window.permissionSettings=Object.fromEntries(
      CONFIGURABLE_ROLES.map(role=>[role,{...DEFAULT_PERMISSIONS[role]}])
    );
    window.rolePermissionsReady=Object.fromEntries(CONFIGURABLE_ROLES.map(role=>[role,false]));
    window.selectedPermissionRole='manager';
  }

  // loadPermissions（登入後載入角色權限）：放在核心程式，權限管理畫面本身不必預先載入。
  async function loadPermissions(){
    if(typeof window.firebaseLoadRolePermissions!=='function'){
      resetPermissionsToDefaults();
      return window.rolePermissionsReady;
    }
    try{
      const requestedRoles=typeof isAdm==='function'&&isAdm()
        ? CONFIGURABLE_ROLES
        : CONFIGURABLE_ROLES.filter(role=>role===window.cu?.role); // requestedRoles（本次需要讀取的角色）
      const saved=await window.firebaseLoadRolePermissions(requestedRoles);
      CONFIGURABLE_ROLES.forEach(role=>{
        const doc=saved?.[role];
        window.rolePermissionsReady[role]=!!(doc&&doc.active===true&&doc.role===role);
        window.permissionSettings[role]=normalizeFeaturePermissions(doc?.features,DEFAULT_PERMISSIONS[role]);
      });
      return {...window.rolePermissionsReady};
    }catch(error){
      console.error('Không thể tải rolePermissions / 無法載入角色功能權限：',error);
      resetPermissionsToDefaults();
      return {...window.rolePermissionsReady};
    }
  }

  // loadFeatureScript（載入功能程式）：相同程式同時被多個頁面需要時只載入一次。
  function loadFeatureScript(scriptName){
    if(loadedScriptPromises.has(scriptName)) return loadedScriptPromises.get(scriptName);
    const src=SCRIPT_URLS[scriptName];
    if(!src) return Promise.reject(new Error(`Không tìm thấy tệp chức năng: ${scriptName} / 找不到功能程式：${scriptName}`));
    const promise=new Promise((resolve,reject)=>{
      const script=document.createElement('script'); // script（功能程式標籤）
      script.src=src;
      script.async=false;
      script.dataset.pcmsFeature=scriptName;
      script.onload=()=>resolve(true);
      script.onerror=()=>{
        script.remove();
        loadedScriptPromises.delete(scriptName);
        reject(new Error(`Không thể tải chức năng: ${scriptName} / 無法載入功能：${scriptName}`));
      };
      document.head.appendChild(script);
    });
    loadedScriptPromises.set(scriptName,promise);
    return promise;
  }

  // loadFeatureStyle（載入功能樣式）：只在使用者實際開啟對應功能頁時建立樣式連結。
  function loadFeatureStyle(styleName){
    if(loadedStylePromises.has(styleName)) return loadedStylePromises.get(styleName);
    const href=STYLE_URLS[styleName]; // href（功能樣式網址）
    if(!href) return Promise.reject(new Error(`Không tìm thấy kiểu giao diện: ${styleName} / 找不到功能樣式：${styleName}`));
    const promise=new Promise((resolve,reject)=>{
      const link=document.createElement('link'); // link（功能樣式連結）
      link.rel='stylesheet';
      link.href=href;
      link.dataset.pcmsFeatureStyle=styleName;
      link.onload=()=>resolve(true);
      link.onerror=()=>{
        link.remove();
        loadedStylePromises.delete(styleName);
        reject(new Error(`Không thể tải kiểu giao diện: ${styleName} / 無法載入功能樣式：${styleName}`));
      };
      document.head.appendChild(link);
    });
    loadedStylePromises.set(styleName,promise);
    return promise;
  }

  // ensurePageScripts（確保頁面程式）：先載入功能樣式，再依中央清單順序載入程式依賴。
  async function ensurePageScripts(pageName){
    const page=getPage(pageName);
    if(!page) throw new Error(`Trang không tồn tại: ${pageName} / 頁面不存在：${pageName}`);
    for(const styleName of page.styles||[]){
      await loadFeatureStyle(styleName);
    }
    for(const scriptName of page.scripts||[]){
      await loadFeatureScript(scriptName);
    }
    return page;
  }

  function getPageDataState(pageName){
    if(!pageDataStates.has(pageName)){
      pageDataStates.set(pageName,{
        loadedAt:0,
        dirty:false,
        warnings:[],
        promise:null
      });
    }
    return pageDataStates.get(pageName);
  }

  function isPageDataReady(pageName){
    return getPageDataState(pageName).loadedAt>0;
  }

  function isPageDataFresh(pageName){
    const page=getPage(pageName);
    const state=getPageDataState(pageName); // state（功能頁資料狀態）
    if(!state.loadedAt||state.dirty) return false;
    if(!(page?.dataLoaders||[]).length) return true;
    return Date.now()-state.loadedAt<PAGE_DATA_FRESH_MS;
  }

  async function runPageDataLoaders(pageName,{background=false}={}){
    const page=getPage(pageName);
    if(!page) throw new Error(`Trang không tồn tại: ${pageName} / 頁面不存在：${pageName}`);
    const warnings=[]; // warnings（附屬資料警告）：不阻止主功能開啟。
    const tasks=[];
    for(const loaderConfig of page.dataLoaders||[]){
      const item=typeof loaderConfig==='string'?{name:loaderConfig}:loaderConfig; // item（資料載入設定）
      if(item.when==='costView'&&typeof window.canViewCosts==='function'&&!window.canViewCosts()) continue;
      const loader=window[item.name]; // loader（資料載入函式）
      if(typeof loader!=='function'){
        throw new Error(`Thiếu hàm tải dữ liệu: ${item.name} / 缺少資料載入函式：${item.name}`);
      }
      const task=Promise.resolve()
        .then(()=>loader({background,pageName}))
        .catch(error=>{
          if(item.optional!==true) throw error;
          if(item.fallbackTarget) window[item.fallbackTarget]=[];
          warnings.push({
            name:item.name,
            vi:String(item.vi||'Dữ liệu phụ'),
            zh:String(item.zh||'附屬資料'),
            error
          });
          console.warn(`Không thể tải dữ liệu phụ ${item.name} / 無法載入附屬資料 ${item.name}：`,error);
          return null;
        });
      tasks.push(task);
    }
    await Promise.all(tasks);
    return warnings;
  }

  async function ensurePageData(pageName,options={}){
    const state=getPageDataState(pageName); // state（功能頁資料狀態）
    if(state.promise) return state.promise;
    if(state.loadedAt&&options.reload!==true) return state.warnings.slice();
    state.promise=(async()=>{
      const warnings=await runPageDataLoaders(pageName,{background:options.background===true});
      state.loadedAt=Date.now();
      state.dirty=false;
      state.warnings=warnings;
      return warnings.slice();
    })().finally(()=>{ state.promise=null; });
    return state.promise;
  }

  async function refreshPageDataInBackground(pageName){
    if(isPageDataFresh(pageName)) return {refreshed:false,warnings:getPageDataState(pageName).warnings.slice()};
    const warnings=await ensurePageData(pageName,{reload:true,background:true});
    if(activePageName===pageName) await runPageHooks(pageName,'onOpen');
    return {refreshed:true,warnings};
  }

  function invalidateDataScopes(scopes){
    const changed=new Set((Array.isArray(scopes)?scopes:[]).map(value=>String(value||'')).filter(Boolean));
    if(!changed.size) return;
    pageMap.forEach((page,pageName)=>{
      if(!(page.dataScopes||[]).some(scope=>changed.has(scope))) return;
      const state=getPageDataState(pageName); // state（受影響功能頁狀態）
      if(state.loadedAt) state.dirty=true;
    });
  }

  function resetPageDataStates(){
    pageDataStates.clear();
  }

  // ensureSpreadsheetTool（載入 Excel 表格工具）：只有實際匯入或匯出時才呼叫。
  function ensureSpreadsheetTool(){
    if(window.XLSX) return Promise.resolve(window.XLSX);
    if(spreadsheetToolPromise) return spreadsheetToolPromise;
    spreadsheetToolPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script'); // script（Excel 表格工具標籤）
      script.src='https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
      script.async=true;
      script.dataset.pcmsTool='xlsx-js-style'; // xlsx-js-style（Excel 樣式工具）
      script.onload=()=>{
        if(window.XLSX) resolve(window.XLSX);
        else{
          script.remove();
          spreadsheetToolPromise=null;
          reject(new Error('Công cụ Excel không khả dụng. / Excel 表格工具無法使用。'));
        }
      };
      script.onerror=()=>{
        script.remove();
        spreadsheetToolPromise=null;
        reject(new Error('Không thể tải công cụ Excel. / 無法載入 Excel 表格工具。'));
      };
      document.head.appendChild(script);
    });
    return spreadsheetToolPromise;
  }

  // runPageHooks（執行頁面生命週期）：功能可逐步加入進入與離開清理函式。
  async function runPageHooks(pageName,hookName){
    const page=getPage(pageName);
    if(!page) return;
    for(const functionName of page[hookName]||[]){
      const fn=window[functionName]; // fn（頁面生命週期函式）
      if(typeof fn!=='function'){
        throw new Error(`Thiếu hàm chức năng: ${functionName} / 缺少功能函式：${functionName}`);
      }
      await fn();
    }
  }

  // updateActivePageTitle（更新目前功能抬頭）：標題固定顯示於共用頂部列，避免各頁重複占用內容高度。
  function updateActivePageTitle(page){
    const title=document.getElementById('active-page-title'); // title（共用功能抬頭）
    if(!title) return;
    if(!page){
      title.replaceChildren();
      title.hidden=true;
      return;
    }
    window.PCMSUIText?.set?.(title,{vi:page.vi,zh:page.zh});
    title.hidden=false;
  }

  async function leaveActivePage(){
    if(!activePageName){
      window.PCMSUIFileDrop?.deactivatePage?.();
      window.PCMSUITableControls?.deactivatePage?.();
      window.PCMSUITable?.deactivatePage?.();
      return;
    }
    const leavingPageName=activePageName; // leavingPageName（正在離開的頁面名稱）
    window.PCMSUIFileDrop?.deactivatePage?.(leavingPageName);
    window.PCMSUITableControls?.deactivatePage?.(leavingPageName);
    window.PCMSUITable?.deactivatePage?.(leavingPageName);
    try{
      await runPageHooks(leavingPageName,'onLeave');
    }finally{
      activePageName='';
    }
  }

  async function enterPage(pageName){
    await leaveActivePage();
    activePageName=pageName;
    updateActivePageTitle(getPage(pageName));
    window.PCMSUIFileDrop?.activatePage?.(pageName);
    try{
      await runPageHooks(pageName,'onOpen');
      window.PCMSUITableControls?.activatePage?.(pageName);
      window.PCMSUITable?.activatePage?.(pageName);
    }catch(error){
      window.PCMSUIFileDrop?.deactivatePage?.(pageName);
      window.PCMSUITableControls?.deactivatePage?.(pageName);
      window.PCMSUITable?.deactivatePage?.(pageName);
      activePageName='';
      updateActivePageTitle(null);
      throw error;
    }
  }

  // resetActivePage（重設目前頁面）：返回首頁或登出時同步停止全域拖曳接收。
  function resetActivePage(){
    const previousPageName=activePageName; // previousPageName（重設前的頁面名稱）
    activePageName='';
    updateActivePageTitle(null);
    window.PCMSUIFileDrop?.deactivatePage?.(previousPageName);
    window.PCMSUITableControls?.deactivatePage?.(previousPageName);
    window.PCMSUITable?.deactivatePage?.(previousPageName);
  }

  resetPermissionsToDefaults();

  window.PCMSFeatures=Object.freeze({
    modules:FEATURE_MODULES,
    permissionKeys:PERMISSION_KEYS,
    permissionStructure:PERMISSION_STRUCTURE,
    defaultPermissions:DEFAULT_PERMISSIONS,
    getPage,
    getModule,
    getModules,
    getEntryOrder,
    ensurePageScripts,
    ensurePageData,
    isPageDataReady,
    isPageDataFresh,
    refreshPageDataInBackground,
    invalidateDataScopes,
    resetPageDataStates,
    ensureSpreadsheetTool,
    enterPage,
    leaveActivePage,
    resetActivePage
  });
  window.normalizeFeaturePermissions=normalizeFeaturePermissions;
  window.resetPermissionsToDefaults=resetPermissionsToDefaults;
  window.loadPermissions=loadPermissions;
})();
