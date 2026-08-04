// ===== rolePermissions（角色功能權限）管理 =====
const DEFAULT_PERMISSIONS = {
  manager: {
    attendance:true, stats:true, employees:true,
    progress:true, approval:true, replog:true, sync:true,
    accounts:false, export:true, costView:false, costlog:false,
    summary:true, orderImport:true,
    cutting:true, efficiency:false
  },
  clerk: {
    attendance:true, stats:true, employees:true,
    progress:true, approval:false, replog:true, sync:false,
    accounts:false, export:true, costView:false, costlog:false,
    summary:true, orderImport:true,
    cutting:true, efficiency:false
  }
};

const PERM_LABELS = {
  attendance:'Chấm công / 考勤管理',
  stats:'Thống kê sản lượng / 員工產量統計',
  employees:'Quản lý nhân viên / 員工管理',
  sync:'Đồng bộ giây công đoạn / 工序秒數同步',
  progress:'Tiến độ đơn hàng / 訂單進度',
  approval:'Duyệt báo công / 報工審批',
  replog:'Lịch sử báo công / 報工紀錄',
  summary:'Tổng hợp mã hàng / 款號總表',
  cutting:'Thống kê dây cắt / 裁帶統計',
  settings:'Cài đặt chi phí / 成本設定',
  export:'Xuất báo cáo / 匯出報表',
  costView:'Xem giá công và tiền lương / 查看工價與工資',
  costlog:'Lịch sử chi phí / 成本變動記錄',
  accounts:'Quản lý tài khoản / 帳號管理',
  permissions:'Phân quyền / 權限管理',
  efficiency:'Báo cáo hiệu suất / 效率報表',
  orderImport:'Nhập và điều chỉnh đơn hàng / 訂單匯入與調整'
};

const PERM_GROUPS = [
  { id:'personnel',label:'Nhân sự / 人員管理',keys:['attendance','stats','employees'] },
  { id:'orders',label:'Đơn hàng / 訂單管理',keys:['progress','orderImport','approval','replog','sync'] },
  { id:'process',label:'Công đoạn / 工序表',keys:['summary','cutting'] },
  { id:'management',label:'Quản lý / 管理',keys:['settings','export','costView','costlog','accounts','permissions','efficiency'] }
];

// PERMISSION_KEYS（可儲存權限欄位）必須與 Firestore Rules（雲端資料庫安全規則）一致。
const PERMISSION_KEYS = [
  'attendance','stats','employees','progress','approval','replog','accounts',
  'export','costView','costlog','summary','orderImport','cutting','efficiency','sync'
];
const ADMIN_ONLY_KEYS = new Set(['settings','accounts','permissions']);
window.permissionSettings = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
window.rolePermissionsReady = {manager:false,clerk:false};

function normalizeFeaturePermissions(features,defaults){
  const normalized={};
  PERMISSION_KEYS.forEach(key=>{
    normalized[key]=features&&typeof features[key]==='boolean'?features[key]:(defaults[key]===true);
  });
  // accounts（帳號管理）固定只允許 admin（管理員）。
  normalized.accounts=false;
  // costlog（成本變動記錄）必須同時具備 costView（查看工價）權限。
  if(normalized.costView!==true) normalized.costlog=false;
  return normalized;
}

function resetPermissionsToDefaults(){
  window.permissionSettings=JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
  window.rolePermissionsReady={manager:false,clerk:false};
}

async function loadPermissions(){
  if(typeof window.firebaseLoadRolePermissions!=='function'){
    resetPermissionsToDefaults();
    return window.rolePermissionsReady;
  }
  try{
    const saved=await window.firebaseLoadRolePermissions();
    ['manager','clerk'].forEach(role=>{
      const doc=saved?.[role];
      window.rolePermissionsReady[role]=!!(doc&&doc.active===true&&doc.role===role);
      window.permissionSettings[role]=normalizeFeaturePermissions(doc?.features,DEFAULT_PERMISSIONS[role]);
    });
    return {...window.rolePermissionsReady};
  }catch(e){
    console.error('Không thể tải rolePermissions / 無法載入角色功能權限：',e);
    resetPermissionsToDefaults();
    return {...window.rolePermissionsReady};
  }
}

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
  ['manager','clerk'].forEach(role=>{
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
    window.rolePermissionsReady={manager:true,clerk:true};
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

function assignableGroupKeys(group){
  return group.keys.filter(key=>!ADMIN_ONLY_KEYS.has(key));
}

function updateGroupCheckbox(role,group){
  const box=document.getElementById(`perm-group-${role}-${group.id}`);
  if(!box) return;
  const children=assignableGroupKeys(group)
    .map(key=>document.getElementById(`perm-${role}-${key}`))
    .filter(Boolean);
  const checkedCount=children.filter(item=>item.checked).length;
  box.checked=children.length>0&&checkedCount===children.length;
  box.indeterminate=checkedCount>0&&checkedCount<children.length;
}

function syncCostPermissionUi(role){
  const costView=document.getElementById(`perm-${role}-costView`);
  const costLog=document.getElementById(`perm-${role}-costlog`);
  if(!costView||!costLog) return;
  if(!costView.checked) costLog.checked=false;
  costLog.disabled=!costView.checked;
  costLog.style.cursor=costLog.disabled?'not-allowed':'pointer';
  costLog.closest('td')?.classList.toggle('perm-disabled-cell',costLog.disabled);
}

function refreshPermissionGroupStates(){
  ['manager','clerk'].forEach(role=>{
    syncCostPermissionUi(role);
    PERM_GROUPS.forEach(group=>updateGroupCheckbox(role,group));
  });
}

function togglePermissionGroup(role,groupId,checked){
  const group=PERM_GROUPS.find(item=>item.id===groupId);
  if(!group) return;
  const costViewBox=document.getElementById(`perm-${role}-costView`);
  if(group.keys.includes('costView')&&costViewBox) costViewBox.checked=checked;
  syncCostPermissionUi(role);
  assignableGroupKeys(group).forEach(key=>{
    const box=document.getElementById(`perm-${role}-${key}`);
    if(box&&!box.disabled) box.checked=checked;
  });
  // costView（查看工價）關閉時，costlog（成本變動記錄）必須同步關閉。
  syncCostPermissionUi(role);
  PERM_GROUPS.forEach(item=>updateGroupCheckbox(role,item));
}

function onPermissionItemChanged(role,key){
  if(key==='costView') syncCostPermissionUi(role);
  PERM_GROUPS.forEach(group=>updateGroupCheckbox(role,group));
}

function fixedPermissionBadge(key){
  return ADMIN_ONLY_KEYS.has(key)
    ? ' <span class="tg tr2" style="margin-left:6px">Chỉ quản trị viên / 僅管理員</span>'
    : '';
}

function renderPermissions(){
  const wrap=g('perm-table-wrap');
  if(!wrap) return;
  const editableRoles=['manager','clerk'];
  const columns=['admin',...editableRoles];
  const roleLabels={
    admin:'Quản trị viên<br><span style="font-size:10px;font-weight:400">管理員（固定）</span>',
    manager:'Trưởng bộ phận<br><span style="font-size:10px;font-weight:400">課長</span>',
    clerk:'Nhân viên văn phòng<br><span style="font-size:10px;font-weight:400">文員</span>'
  };

  let html='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">';
  editableRoles.forEach(role=>{
    const ready=window.rolePermissionsReady?.[role]===true;
    html+=`<span class="tg ${ready?'tg2':'tr2'}">${role==='manager'?'Trưởng bộ phận / 課長':'Nhân viên văn phòng / 文員'}：${ready?'Đã thiết lập / 已設定':'Chưa lưu / 尚未儲存'}</span>`;
  });
  html+='</div>';
  html+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:650px">';
  html+='<thead><tr>';
  html+='<th style="position:sticky;top:0;background:var(--sf);padding:10px;text-align:left;border-bottom:2px solid var(--bd);color:var(--mu);font-weight:500;z-index:1">Chức năng<br><span style="font-size:10px;font-weight:400">功能</span></th>';
  columns.forEach(role=>{
    html+=`<th style="position:sticky;top:0;background:var(--sf);padding:10px;text-align:center;border-bottom:2px solid var(--bd);color:var(--mu);font-weight:500;min-width:130px;z-index:1">${roleLabels[role]}</th>`;
  });
  html+='</tr></thead><tbody>';

  PERM_GROUPS.forEach(group=>{
    html+=`<tr><td style="padding:9px 10px;background:var(--navy);color:rgba(255,255,255,.88);font-size:12px;font-weight:600;letter-spacing:.04em">${group.label}</td>`;
    columns.forEach(role=>{
      const disabled=role==='admin';
      html+=`<td style="padding:9px 10px;text-align:center;background:var(--navy)">
        <input type="checkbox" id="perm-group-${role}-${group.id}" ${disabled?'checked disabled':''}
          ${disabled?'':'onchange="togglePermissionGroup(\''+role+'\',\''+group.id+'\',this.checked)"'}
          title="Bật hoặc tắt toàn bộ nhóm / 開啟或關閉整個分類"
          style="width:18px;height:18px;cursor:${disabled?'not-allowed':'pointer'};accent-color:var(--accent)">
      </td>`;
    });
    html+='</tr>';
    group.keys.forEach((key,index)=>{
      const adminOnly=ADMIN_ONLY_KEYS.has(key);
      html+=`<tr style="${index%2===0?'':'background:#f8fafc'}">`;
      html+=`<td style="padding:10px 10px 10px 20px;border-bottom:1px solid var(--bd)">${PERM_LABELS[key]}${fixedPermissionBadge(key)}</td>`;
      columns.forEach(role=>{
        const isAdmin=role==='admin';
        const disabled=isAdmin||adminOnly;
        const checked=isAdmin||(window.permissionSettings?.[role]?.[key]===true&&!adminOnly);
        html+=`<td style="padding:10px;text-align:center;border-bottom:1px solid var(--bd);opacity:${disabled&&!isAdmin?'.48':'1'}">
          <input type="checkbox" id="perm-${role}-${key}" ${checked?'checked':''} ${disabled?'disabled':''}
            ${disabled?'':'onchange="onPermissionItemChanged(\''+role+'\',\''+key+'\')"'}
            style="width:17px;height:17px;cursor:${disabled?'not-allowed':'pointer'};accent-color:var(--accent)">
        </td>`;
      });
      html+='</tr>';
    });
  });

  html+='</tbody></table></div>';
  html+=`<div style="margin-top:14px;padding:12px 14px;border:1px solid var(--bd);border-radius:10px;background:#f8fafc;font-size:12px;color:var(--mu)">
    <strong style="display:block;color:var(--navy);margin-bottom:6px">Quyền cố định của hệ thống / 系統固定權限</strong>
    <div>Quản trị viên: luôn có toàn bộ quyền, không thể tắt tại đây.<br>管理員：固定擁有全部權限，無法在此關閉。</div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:9px;opacity:.6"><input type="checkbox" disabled style="width:16px;height:16px">Điện thoại tổ trưởng / 班長手機端（Tạm dừng / 暫停）</label>
    <label style="display:flex;align-items:center;gap:8px;margin-top:7px;opacity:.6"><input type="checkbox" disabled style="width:16px;height:16px">Điện thoại nhân viên / 員工手機端（Tạm dừng / 暫停）</label>
  </div>`;
  wrap.innerHTML=html;
  refreshPermissionGroupStates();
}

async function applyPermissions(){
  if(!isAdm()) return;
  const newSettings={manager:{},clerk:{}};
  ['manager','clerk'].forEach(role=>{
    PERMISSION_KEYS.forEach(key=>{
      const el=document.getElementById('perm-'+role+'-'+key);
      newSettings[role][key]=key==='accounts'?false:(el?.checked===true);
    });
    if(newSettings[role].costView!==true) newSettings[role].costlog=false;
  });
  window.permissionSettings=newSettings;
  await savePermissions();
}
