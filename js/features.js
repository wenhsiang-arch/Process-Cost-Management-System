// features（功能中央清單）：統一管理導覽、頁面、權限、程式依賴、資料載入與進入頁面動作。
(function(){
  const SCRIPT_URLS = Object.freeze({
    settings:'js/settings.js?v=20260806-2',
    productCache:'js/product-cache.js?v=20260806-1',
    orderProcessCache:'js/order-process-cache.js?v=20260806-1',
    summary:'js/summary.js?v=20260805-1',
    data:'js/data.js?v=20260806-5',
    cuttingStore:'js/cutting-store.js?v=20260804-4',
    cutting:'js/cutting.js?v=20260806-5',
    accounts:'js/accounts.js?v=20260806-4',
    orders:'js/orders.js?v=20260806-3',
    sync:'js/sync.js?v=20260806-2',
    permissions:'js/permissions.js?v=20260806-5'
  }); // SCRIPT_URLS（功能程式網址）：修改功能檔時只更新對應版本。

  const STYLE_URLS = Object.freeze({
    cutting:'styles/features/cutting.css?v=20260808-1'
  }); // STYLE_URLS（功能樣式網址）：功能開啟時才載入自己的畫面樣式。

  const FEATURE_MODULES = Object.freeze([
    {
      id:'orders',navId:'progress',navGroup:'primary',icon:'ti-chart-bar',mainKey:'progress',
      vi:'Dữ liệu đơn hàng',zh:'訂單資料',
      pages:[
        {
          page:'progress',feature:'progress',icon:'ti-chart-bar',vi:'Dữ liệu đơn hàng',zh:'訂單資料',
          // data（資料與報表程式）目前仍提供訂單明細共用的工序分類文字；待後續拆出共用工具。
          scripts:['productCache','orderProcessCache','data','orders'],
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
          scripts:['productCache','summary','data'],
          dataLoaders:[
            'ensureOperationSettingsLoaded',
            {name:'ensureCostSettingsLoaded',when:'costView'},
            {
              name:'ensureImportHistoryLoaded',optional:true,fallbackTarget:'impHist',
              vi:'Lịch sử nhập mã hàng',zh:'款號匯入歷史'
            }, // optional（附屬資料）：歷史讀取失敗時不阻止款號主功能開啟。
            'ensureProductsLoaded'
          ],
          onOpen:['rSum'],
          restrictions:[
            {key:'costView',vi:'Hiển thị giá công sản phẩm',zh:'顯示產品工價'}
          ]
        }
      ]
    },
    {
      id:'cutting',navId:'cutting',navGroup:'primary',icon:'ti-scissors',mainKey:'cutting',
      vi:'Thống kê dây cắt',zh:'裁帶統計',
      pages:[
        {
          page:'cutting',feature:'cutting',icon:'ti-scissors',vi:'Thống kê dây cắt',zh:'裁帶統計',
          styles:['cutting'],scripts:['cuttingStore','cutting'],dataLoaders:[],onOpen:['cuttingInit']
        }
      ]
    },
    {
      id:'sync',navId:'sync',navGroup:'management',icon:'ti-refresh',mainKey:'sync',
      vi:'Đồng bộ giây công đoạn',zh:'工序秒數同步',
      pages:[
        {
          page:'sync',feature:'sync',icon:'ti-refresh',vi:'Đồng bộ giây công đoạn',zh:'工序秒數同步',
          scripts:['orderProcessCache','orders','sync'],
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
          scripts:['summary','data','settings'],
          dataLoaders:['ensureOperationSettingsLoaded','ensureCostSettingsLoaded'],
          onOpen:['rAll']
        },
        {
          page:'costlog',feature:'costlog',icon:'ti-file-analytics',vi:'Lịch sử chi phí',zh:'成本變動記錄',
          scripts:['data'],dataLoaders:['ensureCostLogLoaded'],onOpen:['rClog']
        },
        {
          page:'export',feature:'export',icon:'ti-download',vi:'Xuất giá công sản phẩm',zh:'產品工價匯出',
          scripts:['productCache','data'],
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
          scripts:['accounts'],dataLoaders:[],onOpen:['loadAccounts']
        },
        {
          page:'permissions',adminOnly:true,icon:'ti-shield-check',vi:'Phân quyền',zh:'權限管理',
          scripts:['permissions'],dataLoaders:[],onOpen:['renderPermissions']
        }
      ]
    }
  ]); // FEATURE_MODULES（中央功能清單）：權限頁與系統頁面共用同一份來源。

  const PERMISSION_KEYS = Object.freeze([
    'progress','orderImport','productsMain','summary','costView','cutting','sync',
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
  let spreadsheetToolPromise = null; // spreadsheetToolPromise（Excel 表格工具載入工作）
  let activePageName = ''; // activePageName（目前功能頁面）

  function getPage(name){ return pageMap.get(name)||null; }
  function getModule(name){ return moduleMap.get(name)||null; }
  function getModules(){ return FEATURE_MODULES.slice(); }
  function getEntryOrder(){ return ['progress','summary','cutting','sync','costlog','export']; }

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

  async function leaveActivePage(){
    if(!activePageName){
      window.PCMSUIFileDrop?.deactivatePage?.();
      return;
    }
    const leavingPageName=activePageName; // leavingPageName（正在離開的頁面名稱）
    window.PCMSUIFileDrop?.deactivatePage?.(leavingPageName);
    try{
      await runPageHooks(leavingPageName,'onLeave');
    }finally{
      activePageName='';
    }
  }

  async function enterPage(pageName){
    await leaveActivePage();
    activePageName=pageName;
    window.PCMSUIFileDrop?.activatePage?.(pageName);
    try{
      await runPageHooks(pageName,'onOpen');
    }catch(error){
      window.PCMSUIFileDrop?.deactivatePage?.(pageName);
      activePageName='';
      throw error;
    }
  }

  // resetActivePage（重設目前頁面）：返回首頁或登出時同步停止全域拖曳接收。
  function resetActivePage(){
    const previousPageName=activePageName; // previousPageName（重設前的頁面名稱）
    activePageName='';
    window.PCMSUIFileDrop?.deactivatePage?.(previousPageName);
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
    ensureSpreadsheetTool,
    enterPage,
    leaveActivePage,
    resetActivePage
  });
  window.normalizeFeaturePermissions=normalizeFeaturePermissions;
  window.resetPermissionsToDefaults=resetPermissionsToDefaults;
  window.loadPermissions=loadPermissions;
})();
