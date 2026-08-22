import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

test('系統維護按鈕位於重新顯示左側並沿用雙語操作方塊',()=>{
  const html=read('index.html');
  const maintenance=html.indexOf('id="permissions-maintenance-action"');
  const refresh=html.indexOf('id="permissions-refresh-action"');
  const apply=html.indexOf('id="permissions-apply-action"');
  assert.ok(maintenance>=0&&refresh>maintenance&&apply>refresh);
  assert.match(html,/permissions-maintenance-action[\s\S]*?Bảo trì hệ thống[\s\S]*?系統維護/);
});

test('維護切換保留權限內容並一次更新全部可設定角色',()=>{
  const source=read('js/permissions.js');
  assert.match(source,/function isSystemMaintenanceActive\(\)/);
  assert.match(source,/async function toggleSystemMaintenance\(\)/);
  assert.match(source,/activeOverride:!activating/);
  assert.match(source,/features:normalizeFeaturePermissions\(window\.permissionSettings\[role\]/);
  assert.match(source,/CONFIGURABLE_ROLES\.forEach\(role=>\{[\s\S]*?payload\[role\]/);
  assert.match(source,/const active=typeof options\.activeOverride==='boolean'[\s\S]*?:!isSystemMaintenanceActive\(\)/);
  assert.match(source,/Tạm dừng[\s\S]*?已暫停/);
});

test('維護、維護中儲存及重新開放不會清除角色權限',async()=>{
  const roles=['manager','clerk'];
  const savedPayloads=[];
  const defaults=Object.fromEntries(roles.map(role=>[role,{productsMain:false,summary:false}]));
  const window={
    PCMSFeatures:{permissionKeys:['productsMain','summary'],permissionStructure:[],defaultPermissions:defaults},
    normalizeFeaturePermissions:(features,fallback)=>({...fallback,...features}),
    PCMSUIComponents:{
      alertDialog:async()=>true,confirmDialog:async()=>true,createLanguageSections:value=>value,
      showToast:()=>{}
    },
    PCMSUIText:{setLocalizedAttribute:()=>{}},
    permissionSettings:{
      manager:{productsMain:false,summary:true},
      clerk:{productsMain:true,summary:false}
    },
    rolePermissionDocumentsReady:Object.fromEntries(roles.map(role=>[role,true])),
    rolePermissionActive:Object.fromEntries(roles.map(role=>[role,true])),
    rolePermissionsReady:Object.fromEntries(roles.map(role=>[role,true])),
    firebaseSaveRolePermissions:async payload=>savedPayloads.push(structuredClone(payload)),
    PCMSHistory:{saveOperationLog:async()=>{}},
    cu:{role:'admin',user:'admin-test'}
  };
  const context=vm.createContext({
    window,CONFIGURABLE_ROLES:roles,ROLE_LABEL:{admin:'admin',manager:'manager',clerk:'clerk'},
    isAdm:()=>true,g:()=>null,uNav:()=>{},console
  });
  vm.runInContext(read('js/permissions.js'),context);

  assert.equal(await context.toggleSystemMaintenance(),true);
  assert.deepEqual(roles.map(role=>savedPayloads.at(-1)[role].active),[false,false]);
  assert.equal(savedPayloads.at(-1).manager.features.summary,true);
  assert.equal(savedPayloads.at(-1).clerk.features.productsMain,true);

  window.permissionSettings.manager.summary=false;
  assert.equal(await context.applyPermissions(),undefined);
  assert.deepEqual(roles.map(role=>savedPayloads.at(-1)[role].active),[false,false]);
  assert.equal(savedPayloads.at(-1).manager.features.summary,false);

  assert.equal(await context.toggleSystemMaintenance(),true);
  assert.deepEqual(roles.map(role=>savedPayloads.at(-1)[role].active),[true,true]);
  assert.equal(savedPayloads.at(-1).clerk.features.productsMain,true);
});

test('款號母權限只在舊文件缺少欄位時推導',()=>{
  const source=read('js/features.js');
  assert.match(source,/typeof features\.productsMain!=='boolean'/);
  assert.doesNotMatch(source,/normalized\.productsMain=normalized\.productsMain===true\s*\|\|/);
});

test('非管理員登入與在線使用期間都受維護狀態攔截',()=>{
  const auth=read('js/auth.js');
  const firebase=read('js/firebase.js');
  assert.match(auth,/startRolePermissionMonitor\(window\.cu\.role\)/);
  assert.match(auth,/stopRolePermissionMonitor\(\);[\s\S]*?clearInterval\(idleIv\)/);
  assert.match(auth,/error\.code=maintenance\?'system-maintenance':'role-permissions-not-ready'/);
  assert.match(auth,/Hệ thống đang bảo trì, vui lòng thử lại sau\. \/ 系統維護中，請稍後再試。/);
  assert.match(firebase,/increment,serverTimestamp,onSnapshot/);
  assert.match(firebase,/window\.firebaseSubscribeRolePermission[\s\S]*?onSnapshot\(doc\(db,'rolePermissions',role\)/);
  assert.match(firebase,/recordCloudRead\?\.\(\{queryCount:1,documentReads:1\}\)/);
});

test('現行安全規則已用角色 active 狀態阻擋非管理員資料權限',()=>{
  const rules=read('firestore.rules');
  assert.match(rules,/function configuredRoleHasFeature\(feature\)[\s\S]*?rolePermission\.active == true/);
  assert.match(rules,/function hasFeature\(feature\)[\s\S]*?isAdmin\(\) \|\|/);
  assert.match(rules,/match \/rolePermissions\/\{roleId\}[\s\S]*?allow create, update: if isAdmin\(\)/);
});
