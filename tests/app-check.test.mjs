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
  const loadedVersion=html.match(/js\/firebase\.js\?v=([^"'&\s]+)/)?.[1];
  assert.equal(loadedVersion,'20260906-3');
});

test('正式寫入先核對靜態執行版本並依更新類型提醒或阻擋',()=>{
  const source=read('js/firebase.js');
  const manifest=JSON.parse(read('runtime-version.json'));
  const guardedVersion=source.match(/const RUNTIME_VERSION = '([^']+)'/)?.[1];
  assert.equal(guardedVersion,manifest.version);
  assert.equal(manifest.updateMode,'notice');
  assert.match(source,/url\.searchParams\.set\('_pcms_check',String\(Date\.now\(\)\)\)/);
  assert.match(source,/fetch\(runtimeVersionRequestUrl\(\),\{cache:'no-store'/);
  assert.match(source,/async function verifyRuntimeVersion\(options=\{\}\)/);
  assert.match(source,/async function setDoc\([^)]*\)\{[\s\S]*?await verifyRuntimeVersion\(\)/);
  assert.match(source,/async function runTransaction\([^)]*\)\{[\s\S]*?await verifyRuntimeVersion\(\)/);
  assert.match(source,/manifest\?\.updateMode==='notice'/);
  assert.match(source,/if\(manifest\?\.updateMode==='notice'\)\{\s*runtimeVersionStale=false;/);
  assert.match(source,/runtimeVersionStale=false;\s*setRuntimeUpdateStatus\('current'\)/);
  assert.doesNotMatch(source,/if\(runtimeVersionStale\)\{\s*const error=runtimeVersionError\('runtime-reload-required'/);
  assert.match(source,/setRuntimeUpdateStatus\('available',availableVersion\)/);
  assert.match(source,/requestUpdate:requestRuntimeUpdate/);
  assert.match(source,/runtime-reload-required/);
  assert.doesNotMatch(source,/getDoc\([^)]*runtime|runtimeVersion[^\n]*_getDoc/i);
});

test('瀏覽器圖示資源使用本機檔案且包含目前應用程式標記',()=>{
  const html=read('index.html');
  const iconCss=read('styles/vendor/tabler-icons.min.css');
  assert.match(html,/name="mobile-web-app-capable" content="yes"/);
  assert.match(html,/rel="icon"[^>]+href="icon-192\.png"/);
  assert.match(html,/href="styles\/vendor\/tabler-icons\.min\.css\?v=2\.47\.0"/);
  assert.doesNotMatch(html,/cdn\.jsdelivr\.net\/npm\/@tabler\/icons-webfont/);
  assert.match(iconCss,/fonts\/tabler-icons\.woff2\?v=2\.47\.0/);
  assert.doesNotMatch(iconCss,/fonts\/tabler-icons\.(?:eot|ttf|woff\?)/);
  assert.ok(fs.existsSync(new URL('styles/vendor/fonts/tabler-icons.woff2',root)));
  assert.ok(fs.existsSync(new URL('icon-192.png',root)));
});
