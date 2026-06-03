// ============================
// Firebase 共用設定
// Production Reporting System v1.0
// ============================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBBrlo1gVMQmne4gT92lx4KwnRBVt4QSh4",
  authDomain: "process-cost-management-system.firebaseapp.com",
  projectId: "process-cost-management-system",
  storageBucket: "process-cost-management-system.firebasestorage.app",
  messagingSenderId: "162743929598",
  appId: "1:162743929598:web:3170fa1c39a12829c7f3af"
};

// 系統版本
const SYSTEM_VERSION = "2.0.0";

// Firebase 集合名稱（訂單系統專用，不影響工序表）
const COLLECTIONS = {
  // 工序表（唯讀，只查詢）
  PRODUCTS: "system",          // 原有工序表

  // 訂單系統（新）
  ORDERS: "v2_orders",         // 訂單
  ORDER_PROCESSES: "v2_orderProcesses", // 訂單工序清單
  EMPLOYEES: "v2_employees",   // 員工帳號
  REPORTS: "v2_reports",       // 報工記錄
  ADMIN_ACCOUNTS: "v2_accounts", // 後台帳號（管理員/課長/班長/文員）
  SETTINGS: "v2_settings",     // 系統設定
  OPERATION_LOG: "v2_opLog",   // 操作記錄
};

// 角色定義
const ROLES = {
  ADMIN: "admin",       // 管理員
  MANAGER: "manager",   // 課長
  LEADER: "leader",     // 班長
  CLERK: "clerk",       // 文員
  USER: "user",         // 員工（report.html 專用）
};

// 部門清單（中文：越文）
const DEPARTMENTS = {
  "備料": "Bị liệu",
  "普工": "Phổ thông",
  "電腦針車": "May điện tử",
  "平車": "May bằng",
  "品檢": "QC",
  "包裝": "Đóng gói"
};

// 日期格式化（越南格式 日/月/年）
function fmtDate(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function fmtDateTime(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  return `${fmtDate(d)} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
