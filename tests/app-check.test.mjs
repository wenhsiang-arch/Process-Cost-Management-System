import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const read=file=>fs.readFileSync(new URL(file,root),'utf8');

test('正式網站使用背景評分型 App Check 且先於 Firebase 服務初始化',()=>{
  const source=read('js/firebase.js');
  const appPosition=source.indexOf('const app = initializeApp(firebaseConfig)');
  const appCheckPosition=source.indexOf('initializeAppCheck(app,{');
  const firestorePosition=source.indexOf('const db = getFirestore(app)');

  assert.match(source,/firebase-app-check\.js/);
  assert.match(source,/ReCaptchaEnterpriseProvider/);
  assert.match(source,/const APP_CHECK_SITE_KEY = '[A-Za-z0-9_-]{20,}';/);
  assert.match(source,/const APP_CHECK_PRODUCTION_HOSTNAME = 'wenhsiang-arch\.github\.io';/);
  assert.match(source,/location\.protocol === 'https:'/);
  assert.match(source,/provider:new ReCaptchaEnterpriseProvider\(APP_CHECK_SITE_KEY\)/);
  assert.match(source,/isTokenAutoRefreshEnabled:true/);
  assert.doesNotMatch(source,/ReCaptchaV3Provider|RecaptchaVerifier|CHECKBOX|challenge/i);
  assert.ok(appPosition>=0&&appPosition<appCheckPosition);
  assert.ok(appCheckPosition<firestorePosition);
});

test('主頁載入新版 App Check 核心程式',()=>{
  const html=read('index.html');
  assert.match(html,/js\/firebase\.js\?v=20260824-4/);
});

test('正式寫入先核對靜態執行版本且不消耗 Firestore Reads',()=>{
  const source=read('js/firebase.js');
  const manifest=JSON.parse(read('runtime-version.json'));
  assert.equal(manifest.version,'20260824-4');
  assert.match(source,/const RUNTIME_VERSION = '20260824-4'/);
  assert.match(source,/fetch\(RUNTIME_VERSION_URL,\{cache:'no-store'/);
  assert.match(source,/async function verifyRuntimeVersion\(\)/);
  assert.match(source,/async function setDoc\([^)]*\)\{[\s\S]*?await verifyRuntimeVersion\(\)/);
  assert.match(source,/async function runTransaction\([^)]*\)\{[\s\S]*?await verifyRuntimeVersion\(\)/);
  assert.match(source,/runtime-reload-required/);
  assert.doesNotMatch(source,/getDoc\([^)]*runtime|runtimeVersion[^\n]*_getDoc/i);
});
