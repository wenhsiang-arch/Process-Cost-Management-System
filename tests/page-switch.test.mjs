import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const source=fs.readFileSync(new URL('js/features.js',root),'utf8'); // source（中央功能程式內容）

function createFeatures(){
  const window={};
  const context={
    window,
    CONFIGURABLE_ROLES:['manager','clerk','productionDevelopment','productionControl','sales'],
    console,
    Date
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  return window;
}

test('功能頁資料完成後重複切換不再次執行載入',async()=>{
  const window=createFeatures();
  let settingReads=0;
  let orderReads=0;
  window.ensureOperationSettingsLoaded=async()=>{ settingReads+=1; };
  window.loadOrderData=async()=>{ orderReads+=1; };
  await window.PCMSFeatures.ensurePageData('progress');
  await window.PCMSFeatures.ensurePageData('progress');
  assert.equal(settingReads,1);
  assert.equal(orderReads,1);
  assert.equal(window.PCMSFeatures.isPageDataReady('progress'),true);
});
test('只有相關資料異動才讓對應功能在背景重新檢查',async()=>{
  const window=createFeatures();
  let settingReads=0;
  let orderReads=0;
  window.ensureOperationSettingsLoaded=async()=>{ settingReads+=1; };
  window.loadOrderData=async()=>{ orderReads+=1; };
  await window.PCMSFeatures.ensurePageData('progress');
  window.PCMSFeatures.invalidateDataScopes(['products']);
  assert.equal(window.PCMSFeatures.isPageDataFresh('progress'),true);
  window.PCMSFeatures.invalidateDataScopes(['orders']);
  assert.equal(window.PCMSFeatures.isPageDataFresh('progress'),false);
  await window.PCMSFeatures.refreshPageDataInBackground('progress');
  assert.equal(settingReads,2);
  assert.equal(orderReads,2);
});
