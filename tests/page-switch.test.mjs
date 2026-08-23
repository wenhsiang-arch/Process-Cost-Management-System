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
  window.PCMSFeatures.invalidateDataScopes(['productionEntries']);
  assert.equal(window.PCMSFeatures.isPageDataFresh('progress'),true);
  // 訂單畫面會以目前款號主檔解析名稱與工序，因此 products（款號）異動也是直接相關來源。
  window.PCMSFeatures.invalidateDataScopes(['products']);
  assert.equal(window.PCMSFeatures.isPageDataFresh('progress'),false);
  await window.PCMSFeatures.refreshPageDataInBackground('progress');
  assert.equal(settingReads,2);
  assert.equal(orderReads,2);
});

test('產能登記只在開頁後載入且重複切換沿用同頁資料',async()=>{
  const window=createFeatures();
  let productionReads=0;
  window.loadProductionEntryData=async()=>{ productionReads+=1; };
  await window.PCMSFeatures.ensurePageData('production-entry');
  await window.PCMSFeatures.ensurePageData('production-entry');
  assert.equal(productionReads,1);
  window.PCMSFeatures.invalidateDataScopes(['cuttingTemplates']);
  assert.equal(window.PCMSFeatures.isPageDataFresh('production-entry'),true);
  window.PCMSFeatures.invalidateDataScopes(['productionEntries']);
  assert.equal(window.PCMSFeatures.isPageDataFresh('production-entry'),false);
});
