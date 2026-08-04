// ===== rolePermissions（角色功能權限）管理 =====
const DEFAULT_PERMISSIONS = {
  manager: {
    attendance:true, stats:true, employees:true,
    progress:true, approval:true, replog:true, sync:true,
    accounts:false, export:true, costlog:true,
    summary:true, orderImport:true,
    cutting:true, efficiency:false
  },
  clerk: {
    attendance:true, stats:true, employees:true,
    progress:true, approval:false, replog:true, sync:false,
    accounts:false, export:true, costlog:true,
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
  export:'Xuất báo cáo / 匯出報表',
  costlog:'Lịch sử chi phí / 成本變動記錄',
  accounts:'Quản lý tài khoản / 帳號管理',
  efficiency:'Báo cáo hiệu suất / 效率報表',
  orderImport:'Nhập và điều chỉnh đơn hàng / 訂單匯入與調整'
};

const PERM_GROUPS = [
  { label:'Nhân sự / 人員管理', keys:['attendance','stats','employees'] },
  { label:'Đơn hàng / 訂單管理', keys:['progress','orderImport','approval','replog','sync'] },
  { label:'Công đoạn / 工序表', keys:['summary','cutting'] },
  { label:'Quản lý / 管理', keys:['export','costlog','accounts','efficiency'] }
];

const PERMISSION_KEYS = Object.keys(PERM_LABELS);
window.permissionSettings = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
window.rolePermissionsReady = {manager:false,clerk:false};

function normalizeFeaturePermissions(features,defaults){
  const normalized={};
  PERMISSION_KEYS.forEach(key=>{
    normalized[key]=features&&typeof features[key]==='boolean'?features[key]:(defaults[key]===true);
  });
  // 帳號管理只允許 admin（管理員），課長與文員固定關閉。
  normalized.accounts=false;
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

function renderPermissions(){
  const wrap=g('perm-table-wrap');
  if(!wrap) return;
  const roles=['manager','clerk'];
  const roleLabels={manager:'Trưởng bộ phận / 課長',clerk:'Nhân viên văn phòng / 文員'};

  let html='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">';
  roles.forEach(role=>{
    const ready=window.rolePermissionsReady?.[role]===true;
    html+=`<span class="tg ${ready?'tg2':'tr2'}">${roleLabels[role]}：${ready?'Đã thiết lập / 已設定':'Chưa lưu / 尚未儲存'}</span>`;
  });
  html+='</div>';
  html+='<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html+='<thead><tr>';
  html+='<th style="position:sticky;top:0;background:var(--sf);padding:10px;text-align:left;border-bottom:2px solid var(--bd);color:var(--mu);font-weight:500;z-index:1">Chức năng<br><span style="font-size:10px;font-weight:400">功能</span></th>';
  roles.forEach(role=>{
    html+=`<th style="position:sticky;top:0;background:var(--sf);padding:10px;text-align:center;border-bottom:2px solid var(--bd);color:var(--mu);font-weight:500;min-width:120px;z-index:1">${roleLabels[role]}</th>`;
  });
  html+='</tr></thead><tbody>';

  PERM_GROUPS.forEach(group=>{
    html+=`<tr><td colspan="3" style="padding:8px 10px;background:var(--navy);color:rgba(255,255,255,.8);font-size:11px;font-weight:500;letter-spacing:.05em">${group.label}</td></tr>`;
    group.keys.forEach((key,index)=>{
      const isAdminOnly=key==='accounts';
      html+=`<tr style="${index%2===0?'':'background:#f8fafc'}">`;
      html+=`<td style="padding:10px 10px 10px 20px;border-bottom:1px solid var(--bd)">${PERM_LABELS[key]}${isAdminOnly?' <span class="tg tr2" style="margin-left:6px">Chỉ quản trị viên / 僅管理員</span>':''}</td>`;
      roles.forEach(role=>{
        const checked=window.permissionSettings?.[role]?.[key]===true&&!isAdminOnly?'checked':'';
        html+=`<td style="padding:10px;text-align:center;border-bottom:1px solid var(--bd)">
          <input type="checkbox" id="perm-${role}-${key}" ${checked} ${isAdminOnly?'disabled':''}
            style="width:16px;height:16px;cursor:${isAdminOnly?'not-allowed':'pointer'};accent-color:var(--accent)">
        </td>`;
      });
      html+='</tr>';
    });
  });

  html+='</tbody></table>';
  wrap.innerHTML=html;
}

async function applyPermissions(){
  if(!isAdm()) return;
  const newSettings={manager:{},clerk:{}};
  ['manager','clerk'].forEach(role=>{
    PERMISSION_KEYS.forEach(key=>{
      const el=document.getElementById('perm-'+role+'-'+key);
      newSettings[role][key]=key==='accounts'?false:(el?.checked===true);
    });
  });
  window.permissionSettings=newSettings;
  await savePermissions();
}
