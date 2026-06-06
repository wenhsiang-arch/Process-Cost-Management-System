// ===== 預設權限 =====
const DEFAULT_PERMISSIONS = {
  manager: {
    attendance:true, stats:true, employees:true,
    orders:true, progress:true, approval:true, replog:true,
    accounts:true, export:true, history:true, costlog:true,
    summary:true, detail:true, import:true, backup:true
  },
  clerk: {
    attendance:true, stats:true, employees:true,
    orders:true, progress:true, approval:false, replog:true,
    accounts:false, export:true, history:true, costlog:true,
    summary:true, detail:true, import:true, backup:true
  }
};

const PERM_LABELS = {
  attendance:'考勤管理 / Chấm công',
  stats:'員工產量統計 / Thống kê sản lượng',
  employees:'員工管理 / Quản lý nhân viên',
  orders:'匯入訂單 / Nhập đơn hàng',
  progress:'訂單進度 / Tiến độ đơn hàng',
  approval:'報工審批 / Duyệt báo công',
  replog:'報工紀錄 / Lịch sử báo công',
  summary:'款號總表 / Tổng hợp mã hàng',
  detail:'工序明細表 / Bảng chi tiết',
  import:'匯入資料 / Nhập dữ liệu',
  backup:'備份匯出 / Xuất dự phòng',
  export:'匯出報表 / Xuất báo cáo',
  history:'匯入記錄 / Lịch sử nhập',
  costlog:'成本變動記錄 / Lịch sử chi phí',
  accounts:'帳號管理 / Quản lý tài khoản'
};

const PERM_GROUPS = [
  { label:'人員管理 / Nhân sự', keys:['attendance','stats','employees'] },
  { label:'訂單管理 / Đơn hàng', keys:['orders','progress','approval','replog'] },
  { label:'工序表 / Công đoạn', keys:['summary','detail','import','backup'] },
  { label:'管理 / Quản lý', keys:['export','history','costlog','accounts'] }
];

// 當前權限設定（登入後從 Firebase 載入，載入前用預設值）
window.permissionSettings = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));

// ===== 載入權限設定 =====
async function loadPermissions(){
  try{
    const snap = await window._getDoc(window._doc('system','permissions'));
    if(snap.exists()){
      const data = JSON.parse(snap.data().data);
      window.permissionSettings = data;
    } else {
      window.permissionSettings = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
    }
  }catch(e){
    console.error('loadPermissions error:', e);
    window.permissionSettings = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
  }
}

// ===== 儲存權限設定 =====
async function savePermissions(){
  try{
    await window._setDoc(
      window._doc('system','permissions'),
      { data: JSON.stringify(window.permissionSettings) }
    );
    alert('✅ 權限設定已儲存套用 / Đã lưu cài đặt phân quyền');
    if(typeof uNav==='function') uNav();
  }catch(e){
    alert('❌ 儲存失敗：'+e.message);
  }
}

// ===== 渲染權限管理頁面 =====
function renderPermissions(){
  const wrap = g('perm-table-wrap'); if(!wrap) return;
  const roles = ['manager','clerk'];
  const roleLabels = { manager:'課長 / Quản lý', clerk:'文員 / Nhân viên văn phòng' };

  let html = '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html += '<thead><tr>';
  html += '<th style="position:sticky;top:0;background:var(--sf);padding:10px;text-align:left;border-bottom:2px solid var(--bd);color:var(--mu);font-weight:500;z-index:1">功能 / Chức năng</th>';
  roles.forEach(r=>{
    html += `<th style="position:sticky;top:0;background:var(--sf);padding:10px;text-align:center;border-bottom:2px solid var(--bd);color:var(--mu);font-weight:500;min-width:100px;z-index:1">${roleLabels[r]}</th>`;
  });
  html += '</tr></thead><tbody>';

  PERM_GROUPS.forEach(group=>{
    html += `<tr><td colspan="3" style="padding:8px 10px;background:var(--navy);color:rgba(255,255,255,.8);font-size:11px;font-weight:500;letter-spacing:.05em">${group.label}</td></tr>`;
    group.keys.forEach((key,i)=>{
      const bg = i%2===0 ? '' : 'background:#f8fafc';
      html += `<tr style="${bg}">`;
      html += `<td style="padding:10px 10px 10px 20px;border-bottom:1px solid var(--bd)">${PERM_LABELS[key]}</td>`;
      roles.forEach(r=>{
        const checked = (window.permissionSettings[r]&&window.permissionSettings[r][key]) ? 'checked' : '';
        html += `<td style="padding:10px;text-align:center;border-bottom:1px solid var(--bd)">
          <input type="checkbox" id="perm-${r}-${key}" ${checked}
            style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)">
        </td>`;
      });
      html += '</tr>';
    });
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ===== 套用（從勾選框讀取並儲存）=====
async function applyPermissions(){
  const keys = Object.keys(PERM_LABELS);
  const roles = ['manager','clerk'];
  const newSettings = {};
  roles.forEach(r=>{
    newSettings[r] = {};
    keys.forEach(key=>{
      const el = document.getElementById('perm-'+r+'-'+key);
      newSettings[r][key] = el ? el.checked : false;
    });
  });
  window.permissionSettings = newSettings;
  await savePermissions();
}
