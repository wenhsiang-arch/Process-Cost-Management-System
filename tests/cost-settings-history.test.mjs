import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）。
const source=fs.readFileSync(new URL('js/settings.js',root),'utf8'); // source（成本設定程式內容）。

function createSettingElement(value=''){
  return {
    value:String(value),
    textContent:'',
    className:'',
    style:{},
    removeAttribute(){},
    setAttribute(){},
    closest(){ return null; },
    focus(){}
  };
}

function createSettings(initial={}){
  const elements={
    'ss-sal':createSettingElement(initial.sal??300),
    'ss-ins':createSettingElement(initial.ins??30),
    'ss-meal':createSettingElement(initial.meal??20),
    'ss-tc':createSettingElement(initial.mc??350),
    'ss-hr':createSettingElement(initial.mh??2),
    'ss-usd':createSettingElement(initial.usd??25000),
    'ss-twd':createSettingElement(initial.twd??780),
    'ss-ws':createSettingElement(initial.ws??3000),
    'ss-eff':createSettingElement(initial.eff??80),
    'ct-tag':createSettingElement(),
    'ht-tag':createSettingElement(),
    'e-in':createSettingElement(),
    'e-mu':createSettingElement(),
    'e-time':createSettingElement()
  }; // elements（測試用成本設定畫面元件）。
  const context={
    console,
    document:{activeElement:null,createElement:()=>createSettingElement()},
    canOpenPage:()=>true,
    g:id=>elements[id]||null,
    rSum(){},rDet(){},rExp(){},rBk(){},rClog(){},
    safePositiveNumber(value,fallback=0){
      const number=Number(value); // number（轉換後數值）。
      return Number.isFinite(number)&&number>0?number:fallback;
    }
  };
  context.window=context;
  context.S={
    sal:300,ins:30,meal:20,mc:null,mh:2,usd:25000,twd:780,ws:3000,eff:80,
    ...initial
  };
  context.cLog=[];
  context.PCMSUIText={create:({vi,zh})=>({vi,zh})};
  context.PCMSUIComponents={
    alertDialog:async()=>true,
    showToast(){}
  };
  context.getH=()=>{
    const settings=context.S; // settings（目前成本設定）。
    if(Number(settings.mh)>0) return Number(settings.mh);
    if(Number(settings.mc)>0) return Number(settings.mc)/208;
    return (Number(settings.sal)+Number(settings.ins)+Number(settings.meal))/208;
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  return {context,elements};
}

test('成本設定載入完成後才建立已儲存比較基準',async()=>{
  const {context}=createSettings();
  let operationReads=0;
  let costReads=0;
  context.ensureOperationSettingsLoaded=async()=>{
    operationReads+=1;
    Object.assign(context.S,{usd:26000,twd:800,ws:3200,eff:85});
  };
  context.ensureCostSettingsLoaded=async()=>{
    costReads+=1;
    Object.assign(context.S,{sal:400,ins:40,meal:25,mh:3});
  };

  await context.loadCostSettingsPageData();
  context.S.sal=450;
  const changes=vm.runInContext(
    'buildCostSettingsHistoryChanges(savedCostSettingsHistoryBaseline,createCostSettingsHistorySnapshot())',
    context
  );

  assert.equal(operationReads,1);
  assert.equal(costReads,1);
  assert.equal(changes.length,1);
  assert.equal(changes[0].f,'平均薪資');
  assert.equal(changes[0].b,400);
  assert.equal(changes[0].a,450);
});

test('成本設定即時重算後，儲存仍會寫入共用歷史紀錄',async()=>{
  const {context,elements}=createSettings({sal:300,mh:2});
  const logged=[]; // logged（測試收到的共用歷史紀錄）。
  context.ensureOperationSettingsLoaded=async()=>{};
  context.ensureCostSettingsLoaded=async()=>{};
  context.saveSettingsToFB=async()=>true;
  context.saveCostLogToFB=async record=>{
    logged.push(record);
    return {id:`log-${logged.length}`,changes:record.changes};
  };

  await context.loadCostSettingsPageData();
  elements['ss-sal'].value='360';
  context.rAll();
  assert.equal(context.S.sal,360);

  await context.saveSt();
  await context.saveSt();

  assert.equal(logged.length,1);
  assert.deepEqual(
    Array.from(logged[0].changes,change=>({f:change.f,b:change.b,a:change.a})),
    [{f:'平均薪資',b:300,a:360}]
  );
});

test('成本設定儲存失敗時保留原比較基準供下次重試',async()=>{
  const {context,elements}=createSettings({usd:25000});
  const logged=[]; // logged（重試後收到的歷史紀錄）。
  context.ensureOperationSettingsLoaded=async()=>{};
  context.ensureCostSettingsLoaded=async()=>{};
  let shouldSave=false;
  context.saveSettingsToFB=async()=>shouldSave;
  context.saveCostLogToFB=async record=>{
    logged.push(record);
    return {id:'log-retry',changes:record.changes};
  };

  await context.loadCostSettingsPageData();
  elements['ss-usd'].value='26000';
  context.rAll();
  await context.saveSt();
  shouldSave=true;
  await context.saveSt();

  assert.equal(logged.length,1);
  const exchangeChange=logged[0].changes.find(change=>change.f==='匯率USD'); // exchangeChange（匯率變動紀錄）。
  assert.equal(exchangeChange.b,25000);
  assert.equal(exchangeChange.a,26000);
});
