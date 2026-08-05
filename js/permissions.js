// ===== rolePermissions（角色功能權限）管理 =====

// 權限欄位、層級與安全預設值統一由 features.js（中央功能清單程式）提供。
const PERMISSION_KEYS = window.PCMSFeatures.permissionKeys;
const PERMISSION_STRUCTURE = window.PCMSFeatures.permissionStructure;
const DEFAULT_PERMISSIONS = window.PCMSFeatures.defaultPermissions;
const normalizeFeaturePermissions = window.normalizeFeaturePermissions;

async function savePermissions(){
  if(!isAdm()){
    alert('Chỉ quản trị viên mới có thể lưu quyền / 只有管理員可以儲存權限');
    return false;
  }
  if(typeof window.firebaseSaveRolePermissions!=='function'){
    alert('Dịch vụ Firebase chưa sẵn sàng / Firebase（雲端資料庫）服務尚未就緒');
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
    window.rolePermissionsReady=Object.fromEntries(CONFIGURABLE_ROLES.map(role=>[role,true]));
    renderPermissions();
    alert('Đã lưu và áp dụng quyền / 權限設定已儲存套用');
    if(typeof uNav==='function') uNav();
    return true;
  }catch(e){
    console.error('Không thể lưu rolePermissions / 無法儲存角色功能權限：',e);
    alert('Lưu quyền thất bại / 儲存權限失敗\n\n'+(e?.message||''));
    return false;
  }
}

// selectPermissionRole（選擇權限角色）。
function selectPermissionRole(role){
  if(role!=='admin'&&!CONFIGURABLE_ROLES.includes(role)) return;
  window.selectedPermissionRole=role;
  renderPermissions();
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

// permissionSwitchHtml（權限開關畫面）。
function permissionSwitchHtml(role,key,options={}){
  const isAdmin=role==='admin';
  const fixed=options.fixed===true||isAdmin;
  const disabled=fixed||options.disabled===true;
  const checked=fixed?isAdmin||options.fixedChecked===true:permissionValue(role,key);
  return `<label class="permission-switch${disabled?' is-disabled':''}">
    <input type="checkbox" ${checked?'checked':''} ${disabled?'disabled':''}
      ${disabled?'':`onchange="setPermissionValue('${role}','${key}',this.checked)"`}>
    <span></span>
  </label>`;
}

function permissionFixedBadge(){
  return '<span class="permission-fixed">Chỉ quản trị viên / 僅管理員</span>';
}

// renderRestrictionRows（顯示有需要才存在的限制項目）。
function renderRestrictionRows(role,restrictions,parentEnabled){
  if(!restrictions?.length) return '';
  return `<div class="permission-restrictions">
    <div class="permission-level-label">Mục hạn chế / 限制項目</div>
    ${restrictions.map(item=>`
      <div class="permission-row permission-restriction${parentEnabled?'':' is-disabled'}">
        <div class="permission-row-copy"><strong>${item.vi}</strong><span>${item.zh}</span></div>
        ${permissionSwitchHtml(role,item.key,{disabled:!parentEnabled})}
      </div>`).join('')}
  </div>`;
}

function renderPermissionModule(role,module){
  const isAdmin=role==='admin';
  const moduleFixed=module.adminOnly===true;
  const moduleEnabled=isAdmin||(module.mainKey&&permissionValue(role,module.mainKey));
  const fixedForRole=moduleFixed&&!isAdmin;
  const moduleClass=moduleEnabled&&!fixedForRole?'':' is-off';
  const mainSwitch=moduleFixed
    ? permissionSwitchHtml(role,'accounts',{fixed:true,fixedChecked:isAdmin})
    : permissionSwitchHtml(role,module.mainKey);

  let body='';
  if(module.pages?.length){
    body=`<div class="permission-module-body">
      <div class="permission-level-label">Trang chức năng / 功能分頁</div>
      ${module.pages.map(page=>{
        const pageFixed=page.adminOnly===true;
        const pageEnabled=isAdmin||(!pageFixed&&moduleEnabled&&permissionValue(role,page.key));
        const pageSwitch=pageFixed
          ? permissionSwitchHtml(role,page.key,{fixed:true,fixedChecked:isAdmin})
          : permissionSwitchHtml(role,page.key,{disabled:!moduleEnabled});
        return `<div class="permission-page${pageEnabled?'':' is-off'}">
          <div class="permission-row${moduleEnabled?'':' is-disabled'}">
            <div class="permission-row-copy"><strong>${page.vi}</strong><span>${page.zh}</span></div>
            ${pageFixed?permissionFixedBadge():''}${pageSwitch}
          </div>
          ${renderRestrictionRows(role,page.restrictions,pageEnabled)}
        </div>`;
      }).join('')}
    </div>`;
  }else if(module.restrictions?.length){
    body=`<div class="permission-module-body">${renderRestrictionRows(role,module.restrictions,moduleEnabled)}</div>`;
  }

  return `<section class="permission-module${moduleClass}">
    <div class="permission-module-head">
      <div class="permission-module-title"><i class="ti ${module.icon}"></i><div><strong>${module.vi}</strong><span>${module.zh}</span></div></div>
      ${moduleFixed?permissionFixedBadge():''}${mainSwitch}
    </div>
    ${moduleEnabled&&!fixedForRole?body:`<div class="permission-paused">Chức năng chính đang tắt, các mục bên dưới tạm dừng. / 主功能已關閉，下層設定暫停。</div>`}
  </section>`;
}

function renderPermissions(){
  const wrap=g('perm-table-wrap');
  if(!wrap) return;
  const selected=window.selectedPermissionRole||'manager';
  const roles=['admin',...CONFIGURABLE_ROLES];
  const roleTabs=roles.map(role=>{
    const active=role===selected;
    const ready=role==='admin'||window.rolePermissionsReady?.[role]===true;
    return `<button type="button" class="permission-role-card${active?' active':''}" onclick="selectPermissionRole('${role}')">
      <i class="ti ${role==='admin'?'ti-shield-lock':'ti-user-cog'}"></i>
      <span><strong>${permissionRoleLabel(role).split(' / ')[0]}</strong><small>${permissionRoleLabel(role).split(' / ')[1]||''}</small></span>
      <em class="${ready?'ready':'pending'}">${role==='admin'?'Cố định / 固定':ready?'Đã thiết lập / 已設定':'Chưa thiết lập / 尚未設定'}</em>
    </button>`;
  }).join('');

  wrap.innerHTML=`
    <div class="permission-role-tabs">${roleTabs}</div>
    <div class="permission-selected-title">
      <div><strong>${permissionRoleLabel(selected)}</strong><span>${selected==='admin'?'Quyền hệ thống cố định / 系統固定權限':'Thiết lập đầy đủ theo chức năng / 依功能完整設定'}</span></div>
    </div>
    <div class="permission-tree">${PERMISSION_STRUCTURE.map(module=>renderPermissionModule(selected,module)).join('')}</div>`;
}

async function applyPermissions(){
  if(!isAdm()) return;
  CONFIGURABLE_ROLES.forEach(role=>{
    window.permissionSettings[role]=normalizeFeaturePermissions(window.permissionSettings[role],DEFAULT_PERMISSIONS[role]);
  });
  await savePermissions();
}
