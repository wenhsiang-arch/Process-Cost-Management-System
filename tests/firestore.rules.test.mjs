/*
  Firestore Security Rules automated tests（雲端資料庫安全規則自動測試）

  技術字串翻譯：
  - initializeTestEnvironment（建立本機測試環境）
  - assertSucceeds（確認操作允許）
  - assertFails（確認操作拒絕）
  - authenticatedContext（建立已登入測試身分）
  - unauthenticatedContext（建立未登入測試身分）
  - withSecurityRulesDisabled（只在本機建立測試前置資料）
  - test / before / after（測試／測試前／測試後）

  所有測試使用 demo-pcms-security-tests（安全測試示範專案），不連正式 Firebase（雲端資料庫）。
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

const projectRoot = path.resolve(import.meta.dirname, '..');
const toolsRoot = process.env.PCMS_FIREBASE_TOOLS_ROOT
  || 'D:\\JAVA(開發系統用)\\Firebase-Tools';
const toolsRequire = createRequire(path.join(toolsRoot, 'package.json'));

async function importTool(packageName) {
  const resolvedPath = toolsRequire.resolve(packageName);
  return import(pathToFileURL(resolvedPath).href);
}

const rulesTesting = await importTool('@firebase/rules-unit-testing');
const firestoreSdk = await importTool('firebase/firestore');

const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = rulesTesting;

const {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch
} = firestoreSdk;

const projectId = 'demo-pcms-security-tests';
const rulesPath = path.join(projectRoot, 'firestore.rules');
const firestoreRules = await readFile(rulesPath, 'utf8');

let testEnvironment;

const allFeatureKeys = [
  'progress', 'accounts', 'export', 'costView', 'costlog', 'productsMain',
  'summary', 'orderImport', 'cutting', 'sync', 'costMain', 'settings',
  'productionMain', 'productionEntry', 'productionRecords', 'productionEmployees'
];

function featureMap(enabledKeys = []) {
  const enabled = new Set(enabledKeys);
  return Object.fromEntries(allFeatureKeys.map((key) => [key, enabled.has(key)]));
}

function googleToken(email) {
  return {
    email,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' }
  };
}

function userAccess(role, username) {
  return {
    username,
    role,
    active: true,
    updatedAt: 1785945600000,
    updatedBy: 'security-test'
  };
}

// emailUserAccess（電子信箱預先核准帳號資料）：模擬正式環境由電子信箱文件綁定 Firebase UID（使用者識別碼）。
function emailUserAccess(email, role, username, options = {}) {
  return {
    ...userAccess(role, username),
    email,
    authUid: String(options.authUid || ''),
    googleDisplayName: username,
    createdAt: 1785945600000,
    ...(options.active === false ? { active: false } : {}),
    ...(options.lastLoginAt ? { lastLoginAt: options.lastLoginAt } : {})
  };
}

// migrateEmailApproval（以同一批次把電子信箱核准資料轉成 UID 權限資料）
async function migrateEmailApproval(database, item, changes = {}) {
  const invitation = emailUserAccess(item.email, item.role, item.name, item.options);
  const migrated = {
    ...invitation,
    authUid: item.uid,
    googleDisplayName: item.name,
    lastLoginAt: 1785945602000,
    ...changes
  }; // migrated（轉換後的 UID 權限資料）
  const batch = writeBatch(database);
  batch.set(doc(database, 'userAccess', item.uid), migrated);
  batch.delete(doc(database, 'userAccess', item.email));
  await batch.commit();
}

function rolePermissions(role, enabledKeys) {
  return {
    role,
    active: true,
    features: featureMap(enabledKeys),
    updatedAt: 1785945600000,
    updatedBy: 'security-test'
  };
}

function context(uid, email) {
  return testEnvironment.authenticatedContext(uid, googleToken(email));
}

function productionEntryData(options = {}) {
  const quantity = Number(options.quantity ?? 40);
  const now = Number(options.now ?? 1785945601000);
  const uid = String(options.uid || 'clerk-user');
  const username = String(options.username || '文員測試');
  return {
    recordType: 'standard',
    productionDate: String(options.productionDate || '2026-08-08'),
    employeeId: String(options.employeeId || 'M91234'),
    employeeName: String(options.employeeName || 'Nguyễn An'),
    department: 'May',
    orderProcessId: 'PROCESS-001',
    orderId: 'ORDER-001',
    orderNo: 'ORDER-001',
    productCode: 'P-001',
    processNo: '1',
    processNameVi: 'May thân',
    processNameZh: '車身',
    processSecSnapshot: 48,
    hourlyCapacitySnapshot: 63,
    orderQtySnapshot: 100,
    quantity,
    status: 'active',
    revision: Number(options.revision || 1),
    createdAt: Number(options.createdAt || now),
    createdByUid: String(options.createdByUid || uid),
    createdBy: String(options.createdBy || username),
    updatedAt: now,
    updatedByUid: uid,
    updatedBy: username,
    schemaVersion: 1,
    calculationVersion: 'hourly-capacity-v1',
    ...(options.extra || {})
  };
}

function productionTotalData(entryId, registeredQty, mutation = 'create', delta = registeredQty, options = {}) {
  return {
    orderProcessId: 'PROCESS-001',
    orderId: 'ORDER-001',
    orderNo: 'ORDER-001',
    productCode: 'P-001',
    processNo: '1',
    orderQty: 100,
    registeredQty,
    updatedAt: Number(options.now || 1785945601000),
    updatedByUid: String(options.uid || 'clerk-user'),
    lastEntryId: entryId,
    lastMutation: mutation,
    lastDelta: delta,
    schemaVersion: 1
  };
}

function productionOperationLog(action, uid, username, now, note) {
  return {
    permissionKey: 'productionRecords',
    feature: 'production',
    action,
    status: 'success',
    createdAt: now,
    createdByUid: uid,
    createdBy: username,
    itemCount: 1,
    detailCount: 1,
    changes: [{ field: 'quantity', before: 40, after: 60 }],
    note
  };
}

async function seedBaseData() {
  await testEnvironment.withSecurityRulesDisabled(async (securityContext) => {
    const database = securityContext.firestore();

    await Promise.all([
      setDoc(doc(database, 'userAccess', 'admin-user'), userAccess('admin', '管理員測試')),
      setDoc(doc(database, 'userAccess', 'manager-user'), userAccess('manager', '課長測試')),
      setDoc(doc(database, 'userAccess', 'clerk-user'), userAccess('clerk', '文員測試')),
      setDoc(doc(database, 'userAccess', 'development-user'), userAccess('productionDevelopment', '開發測試')),
      setDoc(doc(database, 'userAccess', 'control-user'), userAccess('productionControl', '生管測試')),
      setDoc(doc(database, 'userAccess', 'sales-user'), userAccess('sales', '業務測試')),
      setDoc(doc(database, 'userAccess', 'leader-user'), userAccess('leader', '已淘汰班長測試')),
      setDoc(doc(database, 'userAccess', 'employee-user'), userAccess('employee', '已淘汰員工測試')),
      setDoc(doc(database, 'rolePermissions', 'manager'), rolePermissions('manager', [
        'productsMain', 'summary'
      ])),
      setDoc(doc(database, 'rolePermissions', 'clerk'), rolePermissions('clerk', [
        'progress', 'productionMain', 'productionEntry', 'productionRecords', 'productionEmployees'
      ])),
      setDoc(doc(database, 'rolePermissions', 'productionDevelopment'), rolePermissions(
        'productionDevelopment', ['cutting']
      )),
      setDoc(doc(database, 'rolePermissions', 'productionControl'), rolePermissions(
        'productionControl', ['sync']
      )),
      setDoc(doc(database, 'rolePermissions', 'sales'), rolePermissions(
        'sales', []
      )),
      setDoc(doc(database, 'products', 'P-001'), {
        code: 'P-001',
        ops: []
      }),
      setDoc(doc(database, 'system', 'operationSettings'), {
        data: JSON.stringify({ usd: 25400, twd: 780, ws: 3000, eff: 80 })
      }),
      setDoc(doc(database, 'system', 'costSettings'), {
        data: JSON.stringify({ sal: 9000000, ins: 1500000, meal: 900000 })
      }),
      setDoc(doc(database, 'productChanges', 'change-001'), {
        sequence: 1,
        fromVersion: 'version-001',
        toVersion: 'version-002',
        changedCodes: ['P-001'],
        deletedCodes: [],
        createdAt: 1785945600000,
        createdByUid: 'manager-user',
        createdBy: '課長測試'
      }),
      setDoc(doc(database, 'orders', 'ORDER-001'), {
        orderId: 'ORDER-001',
        itemCount: 1,
        totalQty: 100,
        processCount: 1,
        productCodes: ['P-001'],
        processVersion: 'process-version-001',
        importStatus: 'ready',
        lifecycleStatus: 'active'
      }),
      setDoc(doc(database, 'orderProcesses', 'PROCESS-001'), {
        orderId: 'ORDER-001',
        orderNo: 'ORDER-001',
        code: 'P-001',
        orderQty: 100,
        processNo: '1',
        processVi: 'May thân',
        processZh: '車身',
        processSec: 48,
        workStdSec: 48,
        slPerHour: 63
      }),
      setDoc(doc(database, 'productionEmployees', 'M91234'), {
        employeeId: 'M91234',
        name: 'Nguyễn An',
        department: 'May',
        active: true,
        createdAt: 1785945600000,
        createdByUid: 'admin-user',
        createdBy: '管理員測試',
        updatedAt: 1785945600000,
        updatedByUid: 'admin-user',
        updatedBy: '管理員測試',
        schemaVersion: 1
      }),
      setDoc(doc(database, 'productionEmployees', 'M90001'), {
        employeeId: 'M90001',
        name: 'Trần Bình',
        department: 'May',
        active: true,
        createdAt: 1785945600000,
        createdByUid: 'admin-user',
        createdBy: '管理員測試',
        updatedAt: 1785945600000,
        updatedByUid: 'admin-user',
        updatedBy: '管理員測試',
        schemaVersion: 1
      }),
      setDoc(doc(database, 'userAccess', 'other-user'), userAccess('clerk', '其他使用者')),
      setDoc(doc(database, 'reports', 'legacy-report'), { value: 'denied' }),
      setDoc(doc(database, 'operationLogs', 'product-import-log'), {
        permissionKey: 'summary',
        feature: 'products',
        action: 'productImport',
        status: 'success',
        createdAt: 1785945600000,
        createdByUid: 'manager-user',
        createdBy: '課長測試',
        itemCount: 2,
        detailCount: 10
      }),
      setDoc(doc(database, 'operationLogs', 'cost-change-log'), {
        permissionKey: 'costlog',
        feature: 'cost',
        action: 'costSettingsUpdate',
        status: 'success',
        createdAt: 1785945600001,
        createdByUid: 'admin-user',
        createdBy: '管理員測試',
        itemCount: 1,
        detailCount: 0,
        changes: [{ field: '平均時薪', before: 0, after: 100 }]
      }),
      setDoc(doc(database, 'operationLogs', 'cutting-template-log'), {
        permissionKey: 'cutting',
        feature: 'cutting',
        action: 'cuttingTemplateImport',
        status: 'success',
        createdAt: 1785945600002,
        createdByUid: 'development-user',
        createdBy: '開發測試',
        itemCount: 5,
        detailCount: 70,
        fileName: 'cutting-template.xlsx'
      })
    ]);
  });
}

test.before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: firestoreRules
    }
  });
});

test.after(async () => {
  if (testEnvironment) {
    await testEnvironment.cleanup();
  }
});

test.beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedBaseData();
});

test('未登入者不能讀取或寫入正式資料', async () => {
  const database = testEnvironment.unauthenticatedContext().firestore();

  await assertFails(getDoc(doc(database, 'products', 'P-001')));
  await assertFails(getDocs(collection(database, 'orders')));
  await assertFails(getDoc(doc(database, 'userAccess', 'admin-user')));
  await assertFails(setDoc(doc(database, 'products', 'P-002'), {
    code: 'P-002',
    ops: []
  }));
});

test('管理員只可使用規則明確列出的路徑', async () => {
  const database = context('admin-user', 'admin@example.com').firestore();

  await assertSucceeds(getDoc(doc(database, 'products', 'P-001')));
  await assertSucceeds(getDoc(doc(database, 'orders', 'ORDER-001')));
  await assertSucceeds(setDoc(doc(database, 'products', 'P-ADMIN'), {
    code: 'P-ADMIN',
    ops: []
  }));
  await assertFails(getDoc(doc(database, 'unknownCollection', 'unknown-document')));
});

test('課長只能讀取已開放的款號功能', async () => {
  const database = context('manager-user', 'manager@example.com').firestore();

  await assertSucceeds(getDoc(doc(database, 'products', 'P-001')));
  await assertFails(getDoc(doc(database, 'orders', 'ORDER-001')));
});

test('文員可讀取訂單及匯入所需款號但不能修改款號', async () => {
  const database = context('clerk-user', 'clerk@example.com').firestore();

  await assertSucceeds(getDoc(doc(database, 'orders', 'ORDER-001')));
  await assertSucceeds(getDoc(doc(database, 'products', 'P-001')));
  await assertFails(setDoc(doc(database, 'products', 'P-CLERK'), {
    code: 'P-CLERK',
    ops: []
  }));
});

test('訂單資料分頁開啟後可使用匯入、調整、鎖定與操作紀錄', async () => {
  const database = context('clerk-user', 'clerk@example.com').firestore();

  await assertSucceeds(setDoc(doc(database, 'orders', 'ORDER-CLERK'), {
    orderId: 'ORDER-CLERK',
    itemCount: 1,
    totalQty: 80,
    importStatus: 'ready'
  }));
  await assertSucceeds(setDoc(doc(database, 'orderAdjustments', 'ADJUST-CLERK'), {
    orderId: 'ORDER-001',
    createdAt: 1785945600200,
    createdBy: '文員測試'
  }));
  await assertSucceeds(setDoc(doc(database, 'orderLocks', 'LOCK-CLERK'), {
    status: 'ready'
  }));
  await assertSucceeds(setDoc(doc(database, 'operationLogs', 'order-import-log'), {
    permissionKey: 'progress',
    feature: 'orders',
    action: 'orderImport',
    status: 'success',
    createdAt: 1785945600200,
    createdByUid: 'clerk-user',
    createdBy: '文員測試',
    itemCount: 1,
    detailCount: 3
  }));
});

test('訂單工序只允許具有訂單權限的角色讀取', async () => {
  const clerkDatabase = context('clerk-user', 'clerk@example.com').firestore();
  const managerDatabase = context('manager-user', 'manager@example.com').firestore();

  await assertSucceeds(getDocs(query(
    collection(clerkDatabase, 'orderProcesses'),
    where('orderId', '==', 'ORDER-001')
  )));
  await assertFails(getDoc(doc(managerDatabase, 'orderProcesses', 'PROCESS-001')));
});

test('產能員工名冊依專屬權限讀寫且只能停用不能刪除', async () => {
  const clerkDatabase = context('clerk-user', 'clerk@example.com').firestore();
  const managerDatabase = context('manager-user', 'manager@example.com').firestore();
  await assertSucceeds(getDoc(doc(clerkDatabase, 'productionEmployees', 'M91234')));
  await assertFails(getDoc(doc(managerDatabase, 'productionEmployees', 'M91234')));
  const employee = {
    employeeId: 'M95555',
    name: 'Lê Hoa',
    department: 'Đóng gói',
    active: true,
    createdAt: 1785945603000,
    createdByUid: 'clerk-user',
    createdBy: '文員測試',
    updatedAt: 1785945603000,
    updatedByUid: 'clerk-user',
    updatedBy: '文員測試',
    schemaVersion: 1
  };
  await assertSucceeds(setDoc(doc(clerkDatabase, 'productionEmployees', 'M95555'), employee));
  await assertSucceeds(updateDoc(doc(clerkDatabase, 'productionEmployees', 'M95555'), {
    active: false,
    updatedAt: 1785945604000,
    updatedByUid: 'clerk-user',
    updatedBy: '文員測試'
  }));
  await assertFails(deleteDoc(doc(clerkDatabase, 'productionEmployees', 'M95555')));
});

test('生產登記與工序累計必須同一交易寫入且不能超過訂單數量', async () => {
  const database = context('clerk-user', 'clerk@example.com').firestore();
  const validBatch = writeBatch(database);
  validBatch.set(doc(database, 'productionEntries', 'ENTRY-001'), productionEntryData({quantity:40}));
  validBatch.set(doc(database, 'productionProcessTotals', 'PROCESS-001'), productionTotalData('ENTRY-001',40));
  await assertSucceeds(validBatch.commit());
  const totalSnapshot = await getDoc(doc(database, 'productionProcessTotals', 'PROCESS-001'));
  assert.equal(totalSnapshot.data().registeredQty,40);

  await assertFails(setDoc(
    doc(database, 'productionEntries', 'ENTRY-WITHOUT-TOTAL'),
    productionEntryData({quantity:10,now:1785945602000})
  ));

  await testEnvironment.withSecurityRulesDisabled(async securityContext=>{
    await deleteDoc(doc(securityContext.firestore(), 'productionProcessTotals', 'PROCESS-001'));
  });
  const overBatch = writeBatch(database);
  overBatch.set(doc(database, 'productionEntries', 'ENTRY-OVER'), productionEntryData({quantity:101,now:1785945603000}));
  overBatch.set(doc(database, 'productionProcessTotals', 'PROCESS-001'), productionTotalData('ENTRY-OVER',101,'create',101,{now:1785945603000}));
  await assertFails(overBatch.commit());
});

test('不同員工與不同時間的同工序登記共用訂單數量上限', async () => {
  const database = context('clerk-user', 'clerk@example.com').firestore();
  const firstBatch = writeBatch(database);
  firstBatch.set(doc(database, 'productionEntries', 'ENTRY-A'), productionEntryData({quantity:60,now:1785945601000}));
  firstBatch.set(doc(database, 'productionProcessTotals', 'PROCESS-001'), productionTotalData('ENTRY-A',60));
  await assertSucceeds(firstBatch.commit());

  const secondBatch = writeBatch(database);
  secondBatch.set(doc(database, 'productionEntries', 'ENTRY-B'), productionEntryData({
    quantity:40,now:1785945602000,employeeId:'M90001',employeeName:'Trần Bình'
  }));
  secondBatch.set(doc(database, 'productionProcessTotals', 'PROCESS-001'), productionTotalData('ENTRY-B',100,'create',40,{now:1785945602000}));
  await assertSucceeds(secondBatch.commit());

  const thirdBatch = writeBatch(database);
  thirdBatch.set(doc(database, 'productionEntries', 'ENTRY-C'), productionEntryData({quantity:1,now:1785945603000}));
  thirdBatch.set(doc(database, 'productionProcessTotals', 'PROCESS-001'), productionTotalData('ENTRY-C',101,'create',1,{now:1785945603000}));
  await assertFails(thirdBatch.commit());
});

test('生產紀錄修改與作廢會同步調整工序累計並禁止正式刪除', async () => {
  const database = context('clerk-user', 'clerk@example.com').firestore();
  const initial = productionEntryData({quantity:40,now:1785945601000});
  const createBatch = writeBatch(database);
  createBatch.set(doc(database, 'productionEntries', 'ENTRY-EDIT'), initial);
  createBatch.set(doc(database, 'productionProcessTotals', 'PROCESS-001'), productionTotalData('ENTRY-EDIT',40));
  await assertSucceeds(createBatch.commit());

  const edited = {
    ...initial,
    quantity: 60,
    revision: 2,
    updatedAt: 1785945602000,
    updatedByUid: 'clerk-user',
    updatedBy: '文員測試'
  };
  const editBatch = writeBatch(database);
  editBatch.set(doc(database, 'productionEntries', 'ENTRY-EDIT'), edited);
  editBatch.set(doc(database, 'productionProcessTotals', 'PROCESS-001'), productionTotalData('ENTRY-EDIT',60,'update',20,{now:1785945602000}));
  editBatch.set(doc(database, 'operationLogs', 'PRODUCTION-EDIT-LOG'), productionOperationLog(
    'productionEntryUpdate','clerk-user','文員測試',1785945602000,'更正當日產量'
  ));
  await assertSucceeds(editBatch.commit());

  await assertFails(updateDoc(doc(database, 'productionEntries', 'ENTRY-EDIT'), {
    quantity: 70,
    revision: 3,
    updatedAt: 1785945602500,
    updatedByUid: 'clerk-user',
    updatedBy: '文員測試'
  }));

  const voided = {
    ...edited,
    status: 'voided',
    revision: 3,
    voidedAt: 1785945603000,
    voidedByUid: 'clerk-user',
    voidedBy: '文員測試',
    voidReason: '重複登記',
    updatedAt: 1785945603000,
    updatedByUid: 'clerk-user',
    updatedBy: '文員測試'
  };
  const voidBatch = writeBatch(database);
  voidBatch.set(doc(database, 'productionEntries', 'ENTRY-EDIT'), voided);
  voidBatch.set(doc(database, 'productionProcessTotals', 'PROCESS-001'), productionTotalData('ENTRY-EDIT',0,'void',-60,{now:1785945603000}));
  voidBatch.set(doc(database, 'operationLogs', 'PRODUCTION-VOID-LOG'), productionOperationLog(
    'productionEntryVoid','clerk-user','文員測試',1785945603000,'重複登記'
  ));
  await assertSucceeds(voidBatch.commit());
  await assertFails(deleteDoc(doc(database, 'productionEntries', 'ENTRY-EDIT')));
  const totalSnapshot = await getDoc(doc(database, 'productionProcessTotals', 'PROCESS-001'));
  assert.equal(totalSnapshot.data().registeredQty,0);
});

test('訂單摘要的工序快取欄位必須符合格式', async () => {
  const clerkDatabase = context('clerk-user', 'clerk@example.com').firestore();

  await assertSucceeds(setDoc(doc(clerkDatabase, 'orders', 'ORDER-VALID'), {
    orderId: 'ORDER-VALID',
    itemCount: 1,
    totalQty: 50,
    processCount: 3,
    productCodes: ['P-001'],
    processVersion: 'process-version-002',
    importStatus: 'ready'
  }));
  await assertFails(setDoc(doc(clerkDatabase, 'orders', 'ORDER-INVALID'), {
    orderId: 'ORDER-INVALID',
    itemCount: 1,
    totalQty: 50,
    processCount: -1,
    productCodes: ['P-001'],
    processVersion: 'process-version-003',
    importStatus: 'ready'
  }));
});

test('生管依設定權限存取訂單且不能讀取款號', async () => {
  const controlDatabase = context('control-user', 'control@example.com').firestore();

  await assertSucceeds(getDoc(doc(controlDatabase, 'orders', 'ORDER-001')));
  await assertFails(getDoc(doc(controlDatabase, 'products', 'P-001')));
});

test('工序秒數同步只能修改同步欄位', async () => {
  const database = context('control-user', 'control@example.com').firestore();

  await assertSucceeds(updateDoc(doc(database, 'orders', 'ORDER-001'), {
    lifecycleStatus: 'syncingSeconds',
    secondSyncJobId: 'SYNC-001',
    secondSyncStartedAt: 1785945600300,
    secondSyncBy: '生管測試'
  }));
  await assertSucceeds(updateDoc(doc(database, 'orderProcesses', 'PROCESS-001'), {
    workStdSec: 30,
    processSec: 30,
    quoteSnapshotSec: 30,
    slPerHour: 100,
    secondSyncedAt: 1785945600300,
    secondSyncedBy: '生管測試'
  }));
  await assertFails(updateDoc(doc(database, 'orders', 'ORDER-001'), {
    totalQty: 999
  }));
  await assertFails(updateDoc(doc(database, 'orderProcesses', 'PROCESS-001'), {
    orderQty: 999
  }));
});

test('開發與業務角色只依各自設定的功能權限存取資料', async () => {
  const developmentDatabase = context('development-user', 'development@example.com').firestore();
  const salesDatabase = context('sales-user', 'sales@example.com').firestore();
  const adminDatabase = context('admin-user', 'admin@example.com').firestore();

  await assertSucceeds(getDoc(doc(developmentDatabase, 'products', 'P-001')));
  await assertFails(getDoc(doc(developmentDatabase, 'orders', 'ORDER-001')));
  await assertFails(getDoc(doc(salesDatabase, 'products', 'P-001')));
  await assertFails(getDoc(doc(salesDatabase, 'orders', 'ORDER-001')));
  await assertSucceeds(updateDoc(doc(adminDatabase, 'rolePermissions', 'sales'), {
    features: featureMap(['productsMain', 'summary']),
    updatedAt: 1785945600100,
    updatedBy: 'admin-user'
  }));
  await assertSucceeds(getDoc(doc(salesDatabase, 'products', 'P-001')));
});

test('款號工價只由敏感資料子開關開放', async () => {
  const managerDatabase = context('manager-user', 'manager@example.com').firestore();
  const adminDatabase = context('admin-user', 'admin@example.com').firestore();

  await assertFails(getDoc(doc(managerDatabase, 'system', 'costSettings')));
  await assertSucceeds(updateDoc(doc(adminDatabase, 'rolePermissions', 'manager'), {
    features: featureMap(['productsMain', 'summary', 'costView']),
    updatedAt: 1785945600400,
    updatedBy: 'admin-user'
  }));
  await assertSucceeds(getDoc(doc(managerDatabase, 'system', 'costSettings')));
});

test('成本設定與成本歷史使用各自的分頁權限', async () => {
  const salesDatabase = context('sales-user', 'sales@example.com').firestore();
  const adminDatabase = context('admin-user', 'admin@example.com').firestore();

  await assertSucceeds(updateDoc(doc(adminDatabase, 'rolePermissions', 'sales'), {
    features: featureMap(['costMain', 'settings']),
    updatedAt: 1785945600500,
    updatedBy: 'admin-user'
  }));
  await assertSucceeds(getDoc(doc(salesDatabase, 'system', 'costSettings')));
  await assertSucceeds(setDoc(doc(salesDatabase, 'system', 'operationSettings'), {
    data: JSON.stringify({ usd: 25500, twd: 790, ws: 3000, eff: 80 })
  }));
  await assertSucceeds(setDoc(doc(salesDatabase, 'system', 'costSettings'), {
    data: JSON.stringify({ sal: 9100000, ins: 1500000, meal: 900000 })
  }));
  await assertSucceeds(setDoc(doc(salesDatabase, 'operationLogs', 'sales-cost-change'), {
    permissionKey: 'costlog',
    feature: 'cost',
    action: 'costSettingsUpdate',
    status: 'success',
    createdAt: 1785945600500,
    createdByUid: 'sales-user',
    createdBy: '業務測試',
    itemCount: 1,
    detailCount: 0,
    changes: [{ field: '平均薪資', before: 9000000, after: 9100000 }]
  }));
  await assertFails(getDoc(doc(salesDatabase, 'operationLogs', 'sales-cost-change')));
  await assertSucceeds(updateDoc(doc(adminDatabase, 'rolePermissions', 'sales'), {
    features: featureMap(['costMain', 'settings', 'costlog']),
    updatedAt: 1785945600501,
    updatedBy: 'admin-user'
  }));
  await assertSucceeds(getDoc(doc(salesDatabase, 'operationLogs', 'sales-cost-change')));
});

test('已淘汰班長與員工角色不能使用桌機資料', async () => {
  const leaderDatabase = context('leader-user', 'leader@example.com').firestore();
  const employeeDatabase = context('employee-user', 'employee@example.com').firestore();

  await assertFails(getDoc(doc(leaderDatabase, 'orders', 'ORDER-001')));
  await assertFails(getDoc(doc(employeeDatabase, 'products', 'P-001')));
});

test('一般角色只能讀取自己的使用者權限文件', async () => {
  const database = context('manager-user', 'manager@example.com').firestore();

  await assertSucceeds(getDoc(doc(database, 'userAccess', 'manager-user')));
  await assertFails(getDoc(doc(database, 'userAccess', 'other-user')));
  await assertFails(getDocs(collection(database, 'userAccess')));
});

test('管理員可管理電子信箱邀請及已轉換的 UID 帳號', async () => {
  const database = context('admin-user', 'admin@example.com').firestore();
  const invitationEmail = 'new-manager@example.com';
  const canonicalUid = 'canonical-manager-user';
  const invitation = emailUserAccess(invitationEmail, 'manager', '新課長邀請');
  const canonical = {
    ...emailUserAccess(invitationEmail, 'manager', '已登入課長'),
    authUid: canonicalUid,
    lastLoginAt: 1785945602000
  };

  await assertSucceeds(setDoc(doc(database, 'userAccess', invitationEmail), invitation));
  await assertSucceeds(updateDoc(doc(database, 'userAccess', invitationEmail), {
    username: '新課長邀請更新',
    updatedAt: 1785945603000
  }));
  await assertSucceeds(setDoc(doc(database, 'userAccess', canonicalUid), canonical));
  await assertSucceeds(updateDoc(doc(database, 'userAccess', canonicalUid), {
    username: '已登入課長更新',
    updatedAt: 1785945604000
  }));
  await assertSucceeds(deleteDoc(doc(database, 'userAccess', invitationEmail)));
  await assertSucceeds(deleteDoc(doc(database, 'userAccess', canonicalUid)));
});

test('管理員不能寫入錯誤角色權限格式', async () => {
  const database = context('admin-user', 'admin@example.com').firestore();
  const invalidFeatures = featureMap(['productsMain', 'summary', 'accounts']);

  await assertFails(updateDoc(doc(database, 'rolePermissions', 'manager'), {
    features: invalidFeatures,
    updatedAt: 1785945600001,
    updatedBy: 'admin-user'
  }));
});

test('款號寫入必須包含有效款號與工序陣列', async () => {
  const database = context('manager-user', 'manager@example.com').firestore();

  await assertSucceeds(setDoc(doc(database, 'products', 'P-VALID'), {
    code: 'P-VALID',
    ops: []
  }));
  await assertFails(setDoc(doc(database, 'products', 'P-INVALID'), {
    code: 'P-INVALID'
  }));
});

test('款號增量紀錄依款號讀取權限開放', async () => {
  const managerDatabase = context('manager-user', 'manager@example.com').firestore();
  const clerkDatabase = context('clerk-user', 'clerk@example.com').firestore();
  const controlDatabase = context('control-user', 'control@example.com').firestore();

  await assertSucceeds(getDoc(doc(managerDatabase, 'productChanges', 'change-001')));
  await assertSucceeds(getDocs(collection(clerkDatabase, 'productChanges')));
  await assertFails(getDoc(doc(controlDatabase, 'productChanges', 'change-001')));
});

test('款號增量紀錄只能由可修改款號的本人建立且不可改寫', async () => {
  const managerDatabase = context('manager-user', 'manager@example.com').firestore();
  const clerkDatabase = context('clerk-user', 'clerk@example.com').firestore();
  const validChange = {
    sequence: 2,
    fromVersion: 'version-002',
    toVersion: 'version-003',
    changedCodes: ['P-002'],
    deletedCodes: [],
    createdAt: 1785945600100,
    createdByUid: 'manager-user',
    createdBy: '課長測試'
  };

  await assertSucceeds(setDoc(doc(managerDatabase, 'productChanges', 'change-002'), validChange));
  await assertFails(setDoc(doc(managerDatabase, 'productChanges', 'forged-change'), {
    ...validChange,
    createdByUid: 'admin-user'
  }));
  await assertFails(setDoc(doc(clerkDatabase, 'productChanges', 'clerk-change'), {
    ...validChange,
    createdByUid: 'clerk-user',
    createdBy: '文員測試'
  }));
  await assertFails(updateDoc(doc(managerDatabase, 'productChanges', 'change-001'), {
    changedCodes: ['P-999']
  }));
  await assertFails(deleteDoc(doc(managerDatabase, 'productChanges', 'change-001')));
});

test('操作紀錄只能依已授權功能查詢', async () => {
  const database = context('manager-user', 'manager@example.com').firestore();

  await assertSucceeds(getDoc(doc(database, 'operationLogs', 'product-import-log')));
  await assertFails(getDoc(doc(database, 'operationLogs', 'cost-change-log')));
  await assertSucceeds(getDocs(query(
    collection(database, 'operationLogs'),
    where('permissionKey', '==', 'summary'),
    orderBy('createdAt', 'desc'),
    limit(50)
  )));
  await assertSucceeds(getDocs(query(
    collection(database, 'operationLogs'),
    where('permissionKey', '==', 'summary'),
    where('action', '==', 'productImport'),
    orderBy('createdAt', 'desc'),
    limit(50)
  )));
  await assertFails(getDocs(collection(database, 'operationLogs')));
});

test('操作紀錄只能由本人建立且建立後不可修改或刪除', async () => {
  const database = context('manager-user', 'manager@example.com').firestore();
  const validLog = {
    permissionKey: 'summary',
    feature: 'products',
    action: 'productImport',
    status: 'success',
    createdAt: 1785945600100,
    createdByUid: 'manager-user',
    createdBy: '課長測試',
    itemCount: 1,
    detailCount: 3
  };

  await assertSucceeds(setDoc(doc(database, 'operationLogs', 'new-log'), validLog));
  await assertFails(setDoc(doc(database, 'operationLogs', 'forged-log'), {
    ...validLog,
    createdByUid: 'admin-user'
  }));
  await assertFails(updateDoc(doc(database, 'operationLogs', 'product-import-log'), {
    itemCount: 999
  }));
  await assertFails(deleteDoc(doc(database, 'operationLogs', 'product-import-log')));
});

test('裁帶分頁開啟後可建立並讀取模板操作紀錄', async () => {
  const database = context('development-user', 'development@example.com').firestore();
  const unauthorizedDatabase = context('manager-user', 'manager@example.com').firestore(); // unauthorizedDatabase（未開啟裁帶權限的測試資料庫）
  const validLog = {
    permissionKey: 'cutting',
    feature: 'cutting',
    action: 'cuttingTemplateImport',
    status: 'success',
    createdAt: 1785945600600,
    createdByUid: 'development-user',
    createdBy: '開發測試',
    itemCount: 8,
    detailCount: 120,
    fileName: 'cutting-template.xlsx'
  };

  await assertSucceeds(setDoc(doc(database, 'operationLogs', 'new-cutting-log'), validLog));
  await assertSucceeds(setDoc(doc(database, 'operationLogs', 'new-cutting-delete-log'), {
    ...validLog,
    action: 'cuttingTemplateDelete', // cuttingTemplateDelete（刪除裁帶模板）
    createdAt: 1785945600601,
    itemCount: 8,
    detailCount: 120,
    note: 'cutting-template-id'
  }));
  await assertFails(setDoc(doc(database, 'operationLogs', 'invalid-cutting-delete-log'), {
    ...validLog,
    action: 'cuttingDeleteUnknown', // cuttingDeleteUnknown（未核准的裁帶刪除動作）
    createdAt: 1785945600602
  }));
  await assertFails(setDoc(doc(unauthorizedDatabase, 'operationLogs', 'unauthorized-cutting-delete-log'), {
    ...validLog,
    action: 'cuttingTemplateDelete', // cuttingTemplateDelete（刪除裁帶模板）
    createdAt: 1785945600603,
    createdByUid: 'manager-user',
    createdBy: '課長測試'
  }));
  await assertSucceeds(getDoc(doc(database, 'operationLogs', 'new-cutting-log')));
  await assertSucceeds(getDoc(doc(database, 'operationLogs', 'new-cutting-delete-log')));
  await assertSucceeds(getDocs(query(
    collection(database, 'operationLogs'),
    where('permissionKey', '==', 'cutting'),
    orderBy('createdAt', 'desc'),
    limit(50)
  )));
});

test('全部非管理員角色首次登入自動轉成 UID 並依裁帶權限建立與讀取操作紀錄', async () => {
  const roleCases = [
    { role: 'manager', uid: 'manager-email-user', email: 'manager-email@example.com', name: '課長電子信箱測試' },
    { role: 'clerk', uid: 'clerk-email-user', email: 'clerk-email@example.com', name: '文員電子信箱測試' },
    { role: 'productionDevelopment', uid: 'development-email-user', email: 'development-email@example.com', name: '開發電子信箱測試' },
    { role: 'productionControl', uid: 'control-email-user', email: 'control-email@example.com', name: '生管電子信箱測試' },
    { role: 'sales', uid: 'sales-email-user', email: 'sales-email@example.com', name: '業務電子信箱測試' }
  ]; // roleCases（全部可設定角色的電子信箱帳號案例）

  await testEnvironment.withSecurityRulesDisabled(async (securityContext) => {
    const database = securityContext.firestore();
    await Promise.all(roleCases.flatMap((item) => [
      setDoc(
        doc(database, 'userAccess', item.email),
        emailUserAccess(item.email, item.role, item.name)
      ),
      setDoc(doc(database, 'rolePermissions', item.role), rolePermissions(item.role, []))
    ]));
  });

  for (const item of roleCases) {
    const database = context(item.uid, item.email).firestore();
    await assertSucceeds(migrateEmailApproval(database, item));
    const uidSnapshot = await assertSucceeds(getDoc(doc(database, 'userAccess', item.uid)));
    const emailSnapshot = await assertSucceeds(getDoc(doc(database, 'userAccess', item.email)));
    assert.equal(uidSnapshot.exists(), true);
    assert.equal(uidSnapshot.data().authUid, item.uid);
    assert.equal(emailSnapshot.exists(), false);
  }

  for (const [index, item] of roleCases.entries()) {
    const database = context(item.uid, item.email).firestore();
    await assertFails(setDoc(doc(database, 'operationLogs', `email-denied-${index}`), {
      permissionKey: 'cutting',
      feature: 'cutting',
      action: 'cuttingTemplateImport',
      status: 'success',
      createdAt: 1785945601000 + index,
      createdByUid: item.uid,
      createdBy: item.name,
      itemCount: 1,
      detailCount: 1,
      fileName: `email-denied-${index}.xlsx`
    }));
  }

  await testEnvironment.withSecurityRulesDisabled(async (securityContext) => {
    const database = securityContext.firestore();
    await Promise.all(roleCases.map((item) => setDoc(
      doc(database, 'rolePermissions', item.role),
      rolePermissions(item.role, ['cutting'])
    )));
  });

  for (const [index, item] of roleCases.entries()) {
    const database = context(item.uid, item.email).firestore();
    const logId = `email-allowed-${index}`; // logId（本次操作紀錄識別碼）
    await assertSucceeds(setDoc(doc(database, 'operationLogs', logId), {
      permissionKey: 'cutting',
      feature: 'cutting',
      action: 'cuttingTemplateImport',
      status: 'success',
      createdAt: 1785945602000 + index,
      createdByUid: item.uid,
      createdBy: item.name,
      itemCount: 8,
      detailCount: 120,
      fileName: `email-allowed-${index}.xlsx`
    }));
    await assertSucceeds(getDoc(doc(database, 'operationLogs', logId)));
  }
});

test('電子信箱轉 UID 必須本人、啟用且不可提升角色或留下重複文件', async () => {
  const approved = {
    role: 'manager', uid: 'approved-migration-user',
    email: 'approved-migration@example.com', name: '核准轉換測試'
  };
  const inactive = {
    role: 'clerk', uid: 'inactive-migration-user',
    email: 'inactive-migration@example.com', name: '停用轉換測試',
    options: { active: false }
  };

  await testEnvironment.withSecurityRulesDisabled(async (securityContext) => {
    const database = securityContext.firestore();
    await Promise.all([
      setDoc(doc(database, 'userAccess', approved.email), emailUserAccess(approved.email, approved.role, approved.name)),
      setDoc(doc(database, 'userAccess', inactive.email), emailUserAccess(inactive.email, inactive.role, inactive.name, inactive.options))
    ]);
  });

  const approvedDatabase = context(approved.uid, approved.email).firestore();
  await assertFails(setDoc(doc(approvedDatabase, 'userAccess', approved.uid), {
    ...emailUserAccess(approved.email, approved.role, approved.name),
    authUid: approved.uid,
    lastLoginAt: 1785945602000
  }));
  await assertFails(migrateEmailApproval(approvedDatabase, approved, { role: 'admin' }));

  const wrongUserDatabase = context('wrong-migration-user', 'wrong-migration@example.com').firestore();
  await assertFails(migrateEmailApproval(wrongUserDatabase, {
    ...approved,
    uid: 'wrong-migration-user'
  }));

  const inactiveDatabase = context(inactive.uid, inactive.email).firestore();
  await assertFails(migrateEmailApproval(inactiveDatabase, inactive));
  await assertSucceeds(migrateEmailApproval(approvedDatabase, approved));

  const duplicateEmailSnapshot = await assertSucceeds(
    getDoc(doc(approvedDatabase, 'userAccess', approved.email))
  );
  assert.equal(duplicateEmailSnapshot.exists(), false);
});

test('已淘汰資料路徑即使管理員也不能存取', async () => {
  const database = context('admin-user', 'admin@example.com').firestore();

  await assertFails(getDoc(doc(database, 'reports', 'legacy-report')));
  await assertFails(deleteDoc(doc(database, 'reports', 'legacy-report')));
});

test('資料版本只能由對應功能更新且不能刪除', async () => {
  const clerkDatabase = context('clerk-user', 'clerk@example.com').firestore(); // clerkDatabase（文員測試資料庫）
  const managerDatabase = context('manager-user', 'manager@example.com').firestore(); // managerDatabase（課長測試資料庫）
  const guestDatabase = testEnvironment.unauthenticatedContext().firestore(); // guestDatabase（未登入測試資料庫）
  const versionsRef = doc(clerkDatabase, 'system', 'dataVersions'); // versionsRef（資料版本文件位置）

  await assertSucceeds(setDoc(versionsRef, {
    updatedAt: 1785945603000,
    updatedBy: 'clerk-user',
    orders: 'orders-version-001',
    orderProcesses: 'process-version-001'
  }));
  await assertSucceeds(getDoc(doc(managerDatabase, 'system', 'dataVersions')));
  await assertFails(getDoc(doc(guestDatabase, 'system', 'dataVersions')));
  await assertSucceeds(updateDoc(versionsRef, {
    updatedAt: 1785945603001,
    updatedBy: 'clerk-user',
    orders: 'orders-version-002'
  }));
  await assertFails(updateDoc(doc(managerDatabase, 'system', 'dataVersions'), {
    updatedAt: 1785945603002,
    updatedBy: 'manager-user',
    orders: 'orders-version-003'
  }));
  await assertFails(updateDoc(versionsRef, {
    updatedAt: 1785945603003,
    updatedBy: 'clerk-user',
    unknownVersion: 'unknown-version-001'
  }));
  await assertFails(deleteDoc(versionsRef));
});

test('訂單資料與資料版本可以同批成功且任一拒絕時整批取消', async () => {
  const database = context('clerk-user', 'clerk@example.com').firestore(); // database（文員測試資料庫）
  const successOrderRef = doc(database, 'orders', 'ORDER-ATOMIC-SUCCESS'); // successOrderRef（原子成功訂單）
  const versionsRef = doc(database, 'system', 'dataVersions'); // versionsRef（資料版本文件）
  const successBatch = writeBatch(database); // successBatch（資料與版本成功批次）
  successBatch.set(successOrderRef, {
    orderId: 'ORDER-ATOMIC-SUCCESS',
    itemCount: 1,
    totalQty: 20,
    importStatus: 'ready'
  });
  successBatch.set(versionsRef, {
    updatedAt: 1785945603100,
    updatedBy: 'clerk-user',
    orders: 'orders-atomic-success'
  }, { merge: true });
  await assertSucceeds(successBatch.commit());

  const rejectedOrderRef = doc(database, 'orders', 'ORDER-ATOMIC-REJECTED'); // rejectedOrderRef（應整批取消的訂單）
  const rejectedBatch = writeBatch(database); // rejectedBatch（包含非法版本欄位的批次）
  rejectedBatch.set(rejectedOrderRef, {
    orderId: 'ORDER-ATOMIC-REJECTED',
    itemCount: 1,
    totalQty: 30,
    importStatus: 'ready'
  });
  rejectedBatch.set(versionsRef, {
    updatedAt: 1785945603200,
    updatedBy: 'clerk-user',
    unknownVersion: 'must-be-rejected'
  }, { merge: true });
  await assertFails(rejectedBatch.commit());

  await testEnvironment.withSecurityRulesDisabled(async securityContext => {
    const snapshot = await getDoc(doc(securityContext.firestore(), 'orders', 'ORDER-ATOMIC-REJECTED'));
    assert.equal(snapshot.exists(), false);
  });
});

test('款號版本資料依款號權限讀寫', async () => {
  const managerDatabase = context('manager-user', 'manager@example.com').firestore(); // managerDatabase（課長測試資料庫）
  const clerkDatabase = context('clerk-user', 'clerk@example.com').firestore(); // clerkDatabase（文員測試資料庫）
  const salesDatabase = context('sales-user', 'sales@example.com').firestore(); // salesDatabase（業務測試資料庫）
  const metaRef = doc(managerDatabase, 'system', 'productsMeta'); // metaRef（款號版本文件位置）

  await assertSucceeds(setDoc(metaRef, {
    data: JSON.stringify({ version: 'products-version-001', sequence: 1 })
  }));
  await assertSucceeds(getDoc(doc(clerkDatabase, 'system', 'productsMeta')));
  await assertFails(getDoc(doc(salesDatabase, 'system', 'productsMeta')));
  await assertFails(setDoc(doc(clerkDatabase, 'system', 'productsMeta'), {
    data: JSON.stringify({ version: 'forged-version-001', sequence: 2 })
  }));
});

test('裁帶權限可管理共用模板且模板分段必須符合格式', async () => {
  const developmentDatabase = context('development-user', 'development@example.com').firestore(); // developmentDatabase（開發測試資料庫）
  const managerDatabase = context('manager-user', 'manager@example.com').firestore(); // managerDatabase（課長測試資料庫）
  const guestDatabase = testEnvironment.unauthenticatedContext().firestore(); // guestDatabase（未登入測試資料庫）
  const templateRef = doc(developmentDatabase, 'cuttingTemplates', 'TEMPLATE-TEST-001'); // templateRef（裁帶模板文件位置）
  const chunkRef = doc(developmentDatabase, 'cuttingTemplateChunks', 'TEMPLATE-TEST-001-0'); // chunkRef（裁帶模板分段位置）

  await assertSucceeds(setDoc(templateRef, {
    name: 'Mẫu thử / 測試模板',
    fileName: 'cutting-template-test.xlsx',
    fileSize: 100,
    chunkCount: 1,
    updatedAt: '2026-08-07T00:00:00.000Z'
  }));
  await assertSucceeds(getDoc(templateRef));
  await assertFails(getDoc(doc(managerDatabase, 'cuttingTemplates', 'TEMPLATE-TEST-001')));
  await assertFails(getDoc(doc(guestDatabase, 'cuttingTemplates', 'TEMPLATE-TEST-001')));
  await assertSucceeds(setDoc(chunkRef, {
    templateId: 'TEMPLATE-TEST-001',
    index: 0,
    data: 'base64-test-data',
    updatedAt: '2026-08-07T00:00:00.000Z'
  }));
  await assertFails(setDoc(doc(developmentDatabase, 'cuttingTemplateChunks', 'INVALID-CHUNK'), {
    templateId: 'TEMPLATE-TEST-001',
    index: 0,
    data: 'base64-test-data',
    updatedAt: '2026-08-07T00:00:00.000Z',
    extraField: true
  }));
  await assertFails(getDoc(doc(managerDatabase, 'cuttingTemplateChunks', 'TEMPLATE-TEST-001-0')));
  await assertSucceeds(deleteDoc(chunkRef));
  await assertSucceeds(deleteDoc(templateRef));
});

test('工序秒數同步紀錄只由同步功能使用且只有管理員可刪除', async () => {
  const controlDatabase = context('control-user', 'control@example.com').firestore(); // controlDatabase（生管測試資料庫）
  const managerDatabase = context('manager-user', 'manager@example.com').firestore(); // managerDatabase（課長測試資料庫）
  const adminDatabase = context('admin-user', 'admin@example.com').firestore(); // adminDatabase（管理員測試資料庫）
  const syncRef = doc(controlDatabase, 'secondSyncLogs', 'SYNC-TEST-001'); // syncRef（同步紀錄文件位置）

  await assertSucceeds(setDoc(syncRef, {
    jobId: 'SYNC-TEST-001',
    status: 'running',
    updatedAt: 1785945604000
  }));
  await assertSucceeds(getDoc(syncRef));
  await assertSucceeds(updateDoc(syncRef, {
    status: 'completed',
    updatedAt: 1785945604001
  }));
  await assertFails(getDoc(doc(managerDatabase, 'secondSyncLogs', 'SYNC-TEST-001')));
  await assertFails(setDoc(doc(managerDatabase, 'secondSyncLogs', 'SYNC-FORGED-001'), {
    status: 'running'
  }));
  await assertFails(deleteDoc(syncRef));
  await assertSucceeds(deleteDoc(doc(adminDatabase, 'secondSyncLogs', 'SYNC-TEST-001')));
});

test('訂單調整紀錄不可改寫且匯入鎖定只供訂單功能使用', async () => {
  const clerkDatabase = context('clerk-user', 'clerk@example.com').firestore(); // clerkDatabase（文員測試資料庫）
  const managerDatabase = context('manager-user', 'manager@example.com').firestore(); // managerDatabase（課長測試資料庫）
  const adjustmentRef = doc(clerkDatabase, 'orderAdjustments', 'ADJUST-TEST-001'); // adjustmentRef（訂單調整紀錄位置）
  const lockRef = doc(clerkDatabase, 'orderLocks', 'LOCK-TEST-001'); // lockRef（訂單匯入鎖定位置）

  await assertSucceeds(setDoc(adjustmentRef, {
    orderId: 'ORDER-001',
    beforeQty: 100,
    afterQty: 80,
    createdAt: 1785945605000,
    createdBy: '文員測試'
  }));
  await assertSucceeds(getDoc(adjustmentRef));
  await assertFails(getDoc(doc(managerDatabase, 'orderAdjustments', 'ADJUST-TEST-001')));
  await assertFails(updateDoc(adjustmentRef, { afterQty: 60 }));
  await assertFails(deleteDoc(adjustmentRef));

  await assertSucceeds(setDoc(lockRef, {
    orderId: 'ORDER-001',
    status: 'locked',
    updatedAt: 1785945605001
  }));
  await assertSucceeds(updateDoc(lockRef, {
    status: 'ready',
    updatedAt: 1785945605002
  }));
  await assertFails(getDoc(doc(managerDatabase, 'orderLocks', 'LOCK-TEST-001')));
  await assertFails(updateDoc(doc(managerDatabase, 'orderLocks', 'LOCK-TEST-001'), {
    status: 'forged'
  }));
  await assertSucceeds(deleteDoc(lockRef));
});

test('測試資料建立正確且沒有使用正式專案', () => {
  assert.equal(projectId.startsWith('demo-'), true);
});
