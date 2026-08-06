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
  where
} = firestoreSdk;

const projectId = 'demo-pcms-security-tests';
const rulesPath = path.join(projectRoot, 'firestore.rules');
const firestoreRules = await readFile(rulesPath, 'utf8');

let testEnvironment;

const allFeatureKeys = [
  'progress', 'accounts', 'export', 'costView', 'costlog', 'productsMain',
  'summary', 'orderImport', 'cutting', 'sync', 'costMain', 'settings'
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
        'progress'
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
        importStatus: 'ready'
      }),
      setDoc(doc(database, 'orderProcesses', 'PROCESS-001'), {
        orderId: 'ORDER-001',
        orderNo: 'ORDER-001',
        code: 'P-001',
        orderQty: 100
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

test('已淘汰資料路徑即使管理員也不能存取', async () => {
  const database = context('admin-user', 'admin@example.com').firestore();

  await assertFails(getDoc(doc(database, 'reports', 'legacy-report')));
  await assertFails(deleteDoc(doc(database, 'reports', 'legacy-report')));
});

test('測試資料建立正確且沒有使用正式專案', () => {
  assert.equal(projectId.startsWith('demo-'), true);
});
