// ===== rolePermissions（角色功能權限）管理 =====

// 權限欄位、層級與安全預設值統一由 features.js（中央功能清單程式）提供。
const PERMISSION_KEYS = window.PCMSFeatures.permissionKeys;
const PERMISSION_STRUCTURE = window.PCMSFeatures.permissionStructure;
const DEFAULT_PERMISSIONS = window.PCMSFeatures.defaultPermissions;
const normalizeFeaturePermissions = window.normalizeFeaturePermissions;
function permissionsMessage(vi,zh,kind='info'){
  return window.PCMSUIComponents.alertDialog({message:{vi:String(vi||''),zh:String(zh||'')},kind});
}

async function savePermissions(){
  if(!isAdm()){
    await permissionsMessage('Chỉ quản trị viên mới có thể lưu quyền.','只有管理員可以儲存權限。','warning');
    return false;
  }
  if(typeof window.firebaseSaveRolePermissions!=='function'){
    await permissionsMessage('Dịch vụ dữ liệu đám mây chưa sẵn sàng.','雲端資料庫服務尚未就緒。','warning');
    return false;
  }
  const now=Date.now();
  const updatedBy=String(window.cu?.user||window.firebaseAuthUser?.uid||'admin').slice(0,100);
  const payload={};
  CONFIGURABLE_ROLES.forEach(role=>{
    payload[role]={
      role,
      active:true,
      features:normalizeFeaturePermissions(window.permissionSettings[role],DEFAULT_PERMISSIONS[role]),
      updatedAt:now,
      updatedBy
    };
  });
  try{
    await window.firebaseSaveRolePermissions(payload);
    try{
      await window.PCMSHistory?.saveOperationLog?.({
        permissionKey:'systemMonitor',feature:'accounts',action:'rolePermissionsUpdate',status:'success',
        itemCount:CONFIGURABLE_ROLES.length,detailCount:PERMISSION_KEYS.length,
        note:'Cập nhật quyền vai trò / 更新角色權限'
      });
    }catch(logError){ console.warn('無法寫入角色權限操作紀錄：',logError); }
    window.rolePermissionsReady=Object.fromEntries(CONFIGURABLE_ROLES.map(role=>[role,true]));
    renderPermissions();
    window.PCMSUIComponents.showToast({kind:'success',text:{vi:'Đã lưu và áp dụng quyền.',zh:'權限設定已儲存套用。'}});
    if(typeof uNav==='function') uNav();
    return true;
  }catch(e){
    console.error('Không thể lưu rolePermissions / 無法儲存角色功能權限：',e);
    await permissionsMessage('Lưu quyền thất bại.','儲存權限失敗。','danger');
    return false;
  }
}

// setPermissionValue（設定單項權限）：父層關閉只暫停下層，不清除既有設定。
function setPermissionValue(role,key,checked){
  if(!CONFIGURABLE_ROLES.includes(role)||!PERMISSION_KEYS.includes(key)) return;
  window.permissionSettings[role][key]=checked===true;
  renderPermissions();
}

function permissionRoleLabel(role){
  return ROLE_LABEL[role]||role;
}

function permissionValue(role,key){
  return role==='admin'||window.permissionSettings?.[role]?.[key]===true;
}

function permissionSafeText(value){
  return window.PCMSSafe?.text?window.PCMSSafe.text(value):String(value??'');
}

function permissionSafeAttribute(value){
  return window.PCMSSafe?.attribute?window.PCMSSafe.attribute(value):permissionSafeText(value);
}

function permissionInlineArgument(value){
  return window.PCMSSafe?.inlineArgument?window.PCMSSafe.inlineArgument(value):JSON.stringify(String(value??''));
}

function permissionLabelParts(value){
  const parts=String(value||'').split(' / '); // parts（越文與中文角色名稱）
  return {vi:parts[0]||'',zh:parts.slice(1).join(' / ')||''};
}

// permissionMatrixRows（權限矩陣資料列）：一般權限只顯示母功能與分頁，第三欄只顯示敏感權限。
function permissionMatrixRows(){
  const rows=[]; // rows（權限矩陣資料列）
  PERMISSION_STRUCTURE.forEach(module=>{
    const moduleGroup=String(module.id||module.mainKey||module.vi);
    const mainPageGroup=`${moduleGroup}:main`;
    rows.push({
      type:'main',module,key:module.mainKey,adminOnly:module.adminOnly===true,parentKeys:[],
      moduleGroup,pageGroup:mainPageGroup,
      pageVi:'Toàn bộ',pageZh:'全部',itemVi:'',itemZh:''
    });
    (module.restrictions||[]).forEach(item=>rows.push({
      type:'sensitive',module,item,key:item.key,sensitive:true,
      adminOnly:module.adminOnly===true,parentKeys:[module.mainKey],
      moduleGroup,pageGroup:mainPageGroup,
      pageVi:'Toàn bộ',pageZh:'全部',itemVi:item.vi,itemZh:item.zh
    }));
    (module.pages||[]).forEach(page=>{
      const pageGroup=`${moduleGroup}:page:${page.key}`;
      rows.push({
        type:'page',module,page,key:page.key,
        adminOnly:module.adminOnly===true||page.adminOnly===true,
        parentKeys:[module.mainKey],
        moduleGroup,pageGroup,
        pageVi:page.vi,pageZh:page.zh,itemVi:'',itemZh:''
      });
      (page.restrictions||[]).forEach(item=>rows.push({
        type:'sensitive',module,page,item,key:item.key,sensitive:true,
        adminOnly:module.adminOnly===true||page.adminOnly===true,
        parentKeys:[module.mainKey,page.key],
        moduleGroup,pageGroup,
        pageVi:page.vi,pageZh:page.zh,itemVi:item.vi,itemZh:item.zh
      }));
    });
  });
  return rows;
}

function permissionParentEnabled(role,row){
  if(role==='admin') return true;
  if(row.adminOnly===true) return false;
  return row.parentKeys.every(key=>permissionValue(role,key));
}

function permissionRowEnabled(role,row){
  if(role==='admin') return true;
  if(row.adminOnly===true||!permissionParentEnabled(role,row)) return false;
  return permissionValue(role,row.key);
}

function permissionRowDiffers(row){
  if(row.adminOnly===true) return false;
  return new Set(CONFIGURABLE_ROLES.map(role=>permissionRowEnabled(role,row))).size>1;
}

// permissionMatrixCellHtml（權限矩陣勾選格）：管理員固定，下層只在父層開啟時可操作。
function permissionMatrixCellHtml(role,row){
  const isAdmin=role==='admin';
  const roleLabel=permissionRoleLabel(role); // roleLabel（角色雙語名稱）
  if(!isAdmin&&(row.adminOnly===true||!PERMISSION_KEYS.includes(row.key))){
    return `<span class="permission-matrix-locked" title="Chỉ quản trị viên / 僅管理員" aria-label="${permissionSafeAttribute(roleLabel)}：Chỉ quản trị viên / 僅管理員"><i class="ti ti-lock"></i></span>`;
  }
  const parentEnabled=permissionParentEnabled(role,row); // parentEnabled（上層權限是否開啟）
  const disabled=isAdmin||!parentEnabled;
  const checked=isAdmin||permissionValue(role,row.key);
  const rowLabel=row.sensitive
    ? `${row.itemVi} / ${row.itemZh}`
    : row.type==='main'
      ? `${row.module.vi} / ${row.module.zh}`
      : `${row.pageVi} / ${row.pageZh}`;
  const label=disabled&&!isAdmin
    ? `${roleLabel}：Tạm dừng do quyền cấp trên / 因上層權限而暫停`
    : `${roleLabel}：${rowLabel}`;
  const roleArgument=permissionInlineArgument(role); // roleArgument（安全角色事件參數）
  const keyArgument=permissionInlineArgument(row.key); // keyArgument（安全權限事件參數）
  return `<label class="permission-matrix-check${disabled?' is-disabled':''}${isAdmin?' is-fixed':''}" title="${permissionSafeAttribute(label)}">
    <input type="checkbox" ${checked?'checked':''} ${disabled?'disabled':''}
      aria-label="${permissionSafeAttribute(label)}"
      ${disabled?'':`onchange="setPermissionValue(${roleArgument},${keyArgument},this.checked)"`}>
    <span class="permission-matrix-checkmark" aria-hidden="true"></span>
  </label>`;
}

function permissionMatrixCopy(vi,zh,extraClass=''){
  return `<span class="permission-matrix-copy${extraClass?' '+extraClass:''}"><strong>${permissionSafeText(vi)}</strong><span>${permissionSafeText(zh)}</span></span>`;
}

function permissionMatrixRoleHeader(role){
  const labels=permissionLabelParts(permissionRoleLabel(role)); // labels（角色雙語標題）
  const ready=role==='admin'||window.rolePermissionsReady?.[role]===true;
  const status=role==='admin'
    ? {vi:'Cố định',zh:'固定'}
    : ready?{vi:'Đã thiết lập',zh:'已設定'}:{vi:'Chưa thiết lập',zh:'尚未設定'};
  return `<th scope="col" class="permission-matrix-role-head${ready?'':' is-pending'}">
    ${permissionMatrixCopy(labels.vi,labels.zh)}
    <span class="permission-matrix-role-status"><span>${status.vi}</span><span>${status.zh}</span></span>
  </th>`;
}

function permissionMatrixRowHtml(row,roles,layout={}){
  const differs=permissionRowDiffers(row);
  const searchText=[row.module.vi,row.module.zh,row.pageVi,row.pageZh,row.itemVi,row.itemZh].join(' ').toLocaleLowerCase();
  const rowClasses=[
    'permission-matrix-row',
    row.type==='main'?'is-module-start':'',
    row.sensitive?'is-sensitive':''
  ].filter(Boolean).join(' ');
  const moduleSpan=Number(layout.moduleSpan||0);
  const pageSpan=Number(layout.pageSpan||0);
  const moduleIcon=moduleSpan?`<i class="ti ${permissionSafeAttribute(row.module.icon)}"></i>`:'';
  const itemIcon=row.sensitive?'<i class="ti ti-lock permission-matrix-sensitive-icon" aria-hidden="true"></i>':'';
  const moduleCell=moduleSpan
    ? `<td class="permission-matrix-module-cell" rowspan="${moduleSpan}"><div class="permission-matrix-module-copy">${moduleIcon}${permissionMatrixCopy(row.module.vi,row.module.zh)}</div></td>`
    : '';
  const pageCell=pageSpan
    ? `<td class="permission-matrix-page-cell" rowspan="${pageSpan}">${permissionMatrixCopy(row.pageVi,row.pageZh)}</td>`
    : '';
  const itemCell=row.sensitive
    ? `<td class="permission-matrix-item-cell"><div class="permission-matrix-item-copy">${itemIcon}${permissionMatrixCopy(row.itemVi,row.itemZh)}</div></td>`
    : '<td class="permission-matrix-item-cell is-empty" aria-label="Không có quyền nhạy cảm / 無敏感權限"></td>';
  return `<tr class="${rowClasses}" data-search="${permissionSafeAttribute(searchText)}" data-different="${differs?'true':'false'}" data-sensitive="${row.sensitive?'true':'false'}">
    ${moduleCell}
    ${pageCell}
    ${itemCell}
    ${roles.map(role=>`<td class="permission-matrix-role-cell">${permissionMatrixCellHtml(role,row)}</td>`).join('')}
  </tr>`;
}

function permissionMatrixVisibleRows(rows){
  const query=String(window.permissionMatrixQuery||'').trim().toLocaleLowerCase();
  const mode=window.permissionMatrixFilter||'all';
  return rows.filter(row=>{
    const searchText=[row.module.vi,row.module.zh,row.pageVi,row.pageZh,row.itemVi,row.itemZh].join(' ').toLocaleLowerCase();
    const matchesQuery=!query||searchText.includes(query);
    const matchesMode=mode==='all'
      ||(mode==='differences'&&permissionRowDiffers(row))
      ||(mode==='sensitive'&&row.sensitive===true);
    return matchesQuery&&matchesMode;
  });
}

function permissionMatrixBodyHtml(rows,roles){
  const moduleSpans=new Map();
  const pageSpans=new Map();
  rows.forEach(row=>{
    moduleSpans.set(row.moduleGroup,(moduleSpans.get(row.moduleGroup)||0)+1);
    pageSpans.set(row.pageGroup,(pageSpans.get(row.pageGroup)||0)+1);
  });
  const renderedModules=new Set();
  const renderedPages=new Set();
  return rows.map(row=>{
    const layout={moduleSpan:0,pageSpan:0};
    if(!renderedModules.has(row.moduleGroup)){
      layout.moduleSpan=moduleSpans.get(row.moduleGroup)||1;
      renderedModules.add(row.moduleGroup);
    }
    if(!renderedPages.has(row.pageGroup)){
      layout.pageSpan=pageSpans.get(row.pageGroup)||1;
      renderedPages.add(row.pageGroup);
    }
    return permissionMatrixRowHtml(row,roles,layout);
  }).join('');
}

function updatePermissionMatrixFilterButtons(){
  const active=window.permissionMatrixFilter||'all';
  document.querySelectorAll('#perm-table-wrap [data-permission-filter]').forEach(button=>{
    const selected=button.dataset.permissionFilter===active;
    button.classList.toggle('is-active',selected);
    button.setAttribute('aria-pressed',String(selected));
  });
}

function applyPermissionMatrixFilters(){
  const wrap=g('perm-table-wrap');
  if(!wrap) return;
  const roles=['admin',...CONFIGURABLE_ROLES];
  const visibleRows=permissionMatrixVisibleRows(permissionMatrixRows());
  const body=g('permission-matrix-body');
  if(body) body.innerHTML=permissionMatrixBodyHtml(visibleRows,roles);
  const visibleCount=visibleRows.length;
  const empty=g('permission-matrix-empty');
  if(empty) empty.hidden=visibleCount>0;
  const visible=g('permission-matrix-visible-count');
  if(visible) visible.textContent=String(visibleCount);
  const visibleZh=g('permission-matrix-visible-count-zh');
  if(visibleZh) visibleZh.textContent=String(visibleCount);
  updatePermissionMatrixFilterButtons();
}

function setPermissionMatrixFilter(filter){
  if(!['all','differences','sensitive'].includes(filter)) return;
  window.permissionMatrixFilter=filter;
  applyPermissionMatrixFilters();
}

function setPermissionMatrixQuery(value){
  window.permissionMatrixQuery=String(value||'');
  applyPermissionMatrixFilters();
}

function renderPermissions(){
  const wrap=g('perm-table-wrap');
  if(!wrap) return;
  const roles=['admin',...CONFIGURABLE_ROLES];
  const rows=permissionMatrixRows();
  const configurableRows=rows.filter(row=>row.adminOnly!==true&&PERMISSION_KEYS.includes(row.key));
  const availableCount=configurableRows.length*CONFIGURABLE_ROLES.length; // availableCount（可設定權限格總數）
  const enabledCount=configurableRows.reduce((total,row)=>
    total+CONFIGURABLE_ROLES.filter(role=>permissionRowEnabled(role,row)).length,0); // enabledCount（目前有效權限數）
  const pendingCount=CONFIGURABLE_ROLES.filter(role=>window.rolePermissionsReady?.[role]!==true).length; // pendingCount（尚未建立權限文件的角色數）
  const query=permissionSafeAttribute(window.permissionMatrixQuery||'');
  window.permissionMatrixFilter=window.permissionMatrixFilter||'all';

  wrap.innerHTML=`
    <div class="permission-matrix-toolbar">
      <label class="permission-matrix-search">
        ${permissionMatrixCopy('Tìm quyền','搜尋權限')}
        <span class="permission-matrix-search-control"><i class="ti ti-search" aria-hidden="true"></i><input type="search" value="${query}" placeholder="Nhập chức năng / 輸入功能" oninput="setPermissionMatrixQuery(this.value)"></span>
      </label>
      <div class="permission-matrix-filters" role="group" aria-label="Bộ lọc quyền / 權限篩選">
        <button type="button" data-permission-filter="all" onclick="setPermissionMatrixFilter('all')" aria-pressed="false">${permissionMatrixCopy('Tất cả','全部')}</button>
        <button type="button" data-permission-filter="differences" onclick="setPermissionMatrixFilter('differences')" aria-pressed="false">${permissionMatrixCopy('Khác biệt','只看差異')}</button>
        <button type="button" data-permission-filter="sensitive" onclick="setPermissionMatrixFilter('sensitive')" aria-pressed="false">${permissionMatrixCopy('Nhạy cảm','敏感資料')}</button>
      </div>
    </div>
    <div class="permission-matrix-shell">
      <table class="permission-matrix-table ui-table" id="permission-matrix-table" data-ui-table-layout="special" data-ui-table-sticky="original">
        <colgroup>
          <col class="permission-matrix-col-module"><col class="permission-matrix-col-page"><col class="permission-matrix-col-item">
          ${roles.map(()=>'<col class="permission-matrix-col-role">').join('')}
        </colgroup>
        <thead><tr>
          <th scope="col">${permissionMatrixCopy('Chức năng chính','母功能')}</th>
          <th scope="col">${permissionMatrixCopy('Trang con','子分頁')}</th>
          <th scope="col">${permissionMatrixCopy('Quyền nhạy cảm','敏感權限')}</th>
          ${roles.map(permissionMatrixRoleHeader).join('')}
        </tr></thead>
        <tbody id="permission-matrix-body"></tbody>
        <tbody>
          <tr class="permission-matrix-empty" id="permission-matrix-empty" hidden><td colspan="${roles.length+3}">
            ${permissionMatrixCopy('Không tìm thấy quyền phù hợp.','找不到符合條件的權限。')}
          </td></tr>
        </tbody>
      </table>
    </div>
    <div class="permission-matrix-footer">
      <div>Đang hiển thị <strong id="permission-matrix-visible-count">${rows.length}</strong> mục · Đã bật ${enabledCount} / ${availableCount}</div>
      <div>目前顯示 <strong id="permission-matrix-visible-count-zh">${rows.length}</strong> 項 · 已開啟 ${enabledCount}／${availableCount}${pendingCount?` · ${pendingCount} 個職務尚未設定`:''}</div>
    </div>`;
  applyPermissionMatrixFilters();
}

async function applyPermissions(){
  if(!isAdm()) return;
  CONFIGURABLE_ROLES.forEach(role=>{
    window.permissionSettings[role]=normalizeFeaturePermissions(window.permissionSettings[role],DEFAULT_PERMISSIONS[role]);
  });
  await savePermissions();
}
