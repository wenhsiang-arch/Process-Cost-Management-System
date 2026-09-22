import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('js/order-production-progress.js',root),'utf8');

function row(id,data){return {id,data:()=>data};}
function snapshot(data){return {exists:()=>data!==undefined,data:()=>data};}

function runtime(options={}){
  let stored=null;
  let revision=1;
  let revisionUpdatedAt=1000;
  let registeredQty=25;
  let metaSequence=7;
  let productCategory='SX';
  let productSeconds=2;
  let totalUpdatedAt=1000;
  let now=Date.UTC(2026,8,21,22,5,0); // 台灣時間 2026-09-22 06:05。
  class RuntimeDate extends Date{
    constructor(value){super(value===undefined?now:value);}
    static now(){return now;}
  }
  const processCount=Math.max(1,Number(options.processCount)||1);
  const productionOps=Array.from({length:processCount},(_,index)=>({
    processId:`SX-${index+1}`,category:'SX',sec:2,active:true
  }));
  const counts={meta:0,versions:0,items:0,products:0,totals:0,cacheRead:0,cacheWrite:0};
  const concurrency={activeTotalQueries:0,maxActiveTotalQueries:0};
  const markerStore=options.markerStore||new Map();
  const window={
    currentUser:{uid:'user-a'},
    navigator:options.useLocks?{locks:{
      request(_name,callback){
        if(options.lockShouldThrow) throw new Error('不應等待更新鎖');
        return callback({name:_name,mode:'exclusive'});
      }
    }}:undefined,
    localStorage:{
      getItem:key=>markerStore.has(key)?markerStore.get(key):null,
      setItem:(key,value)=>markerStore.set(key,String(value)),
      removeItem:key=>markerStore.delete(key)
    },
    PCMSOrderItemStore:{processTotalId:(itemId,processId)=>`${itemId}__${processId}`},
    pcmsDataCache:{
      async read(){counts.cacheRead+=1;return stored?structuredClone(stored):null;},
      async write(_scope,_version,value){
        counts.cacheWrite+=1;
        if(options.cacheWriteFails) return false;
        stored=structuredClone(value);
        return true;
      },
      async remove(){stored=null;}
    },
    _collection:name=>name,
    _documentId:()=>({kind:'documentId'}),
    _where:(field,operator,value)=>({field,operator,value}),
    _orderBy:(field,direction)=>({kind:'orderBy',field,direction}),
    _query:(collection,...conditions)=>({collection,condition:conditions[0],conditions}),
    _docRef:(collection,id)=>({collection,id}),
    async _getDocs(reference){
      if(reference.collection==='orderProductionProgressVersions'){
        counts.versions+=1;
        if(options.versionPermissionDenied){
          const error=new Error('Missing or insufficient permissions.');
          error.code='permission-denied';
          throw error;
        }
        return {docs:options.hasNoProduction?[]:[row('ORDER-1',{orderId:'ORDER-1',revision,updatedAt:revisionUpdatedAt})]};
      }
      if(reference.collection==='orderItems'){
        counts.items+=1;
        return {docs:[row('ITEM-1',{orderItemId:'ITEM-1',orderId:'ORDER-1',productId:'PRODUCT-1',quantity:100,active:true})]};
      }
      if(reference.collection==='products'){
        counts.products+=1;
        const changeFilter=reference.conditions.find(condition=>condition?.field==='changeSequence');
        if(changeFilter&&metaSequence<=Number(changeFilter.value)) return {docs:[]};
        if(changeFilter&&options.changedProductUnrelated){
          return {docs:[row('PRODUCT-OTHER',{active:true,changeSequence:metaSequence,ops:[]})]};
        }
        const currentOps=productionOps.map((operation,index)=>index===0
          ?{...operation,category:productCategory,sec:productSeconds}:operation);
        return {docs:[row('PRODUCT-1',{active:true,changeSequence:metaSequence,ops:[...currentOps,
          {processId:'QC-1',category:'QC',sec:999,active:true}]})]};
      }
      if(reference.collection==='productionProcessTotals'){
        counts.totals+=1;
        concurrency.activeTotalQueries+=1;
        concurrency.maxActiveTotalQueries=Math.max(concurrency.maxActiveTotalQueries,concurrency.activeTotalQueries);
        if(options.totalQueryDelayMs) await new Promise(resolve=>setTimeout(resolve,options.totalQueryDelayMs));
        concurrency.activeTotalQueries-=1;
        const orderCondition=reference.conditions.find(condition=>condition?.field==='orderId');
        const updatedCondition=reference.conditions.find(condition=>condition?.field==='updatedAt');
        if(orderCondition?.operator==='=='){
          if(options.deltaIndexMissing){
            const error=new Error('The query requires an index.');error.code='failed-precondition';throw error;
          }
          if(totalUpdatedAt<=Number(updatedCondition?.value||0)) return {docs:[]};
          const changedIndexes=Array.isArray(options.changedProcessIndexes)?options.changedProcessIndexes:[0];
          return {docs:changedIndexes.map(index=>productionOps[index]).filter(Boolean).map(operation=>
            row(`ITEM-1__${operation.processId}`,{orderId:'ORDER-1',registeredQty,updatedAt:totalUpdatedAt}))};
        }
        if(orderCondition){
          if(options.hasNoProduction) return {docs:[]};
          return {docs:productionOps.map(operation=>row(`ITEM-1__${operation.processId}`,
            {orderId:'ORDER-1',registeredQty,updatedAt:totalUpdatedAt}))};
        }
        return {docs:reference.condition.value.map(totalId=>row(totalId,{orderId:'ORDER-1',registeredQty}))};
      }
      throw new Error(`未預期的集合：${reference.collection}`);
    },
    async _getDoc(reference){
      if(reference.collection==='system'){
        counts.meta+=1;
        return snapshot({changeSequence:metaSequence,updatedAt:metaSequence*100,trackingEpoch:'epoch-1',productCount:1,opCount:processCount+1});
      }
      throw new Error(`未預期的文件：${reference.collection}`);
    }
  };
  const context={window,console,Date:RuntimeDate,Map,Set,Object,Array,Math,Number,String,Promise,structuredClone,Intl,
    AbortController,setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(source,context);
  return {api:window.PCMSOrderProductionProgress,counts,concurrency,
    setRevision(value,updatedAt=revisionUpdatedAt+1000){revision=value;revisionUpdatedAt=Number(updatedAt);totalUpdatedAt=Number(updatedAt);},
    setRegisteredQty(value){registeredQty=value;},setNow(value){now=Number(value);},
    setProductChange({sequence=metaSequence+1,category=productCategory,seconds=productSeconds}={}){
      metaSequence=Number(sequence);productCategory=category;productSeconds=Number(seconds);
    },
    setVersionPermissionDenied(value){options.versionPermissionDenied=value===true;}};
}

test('只計算生產工序，沒有生產工序時顯示零百分比',()=>{
  const {api}=runtime();
  const items=[{orderItemId:'ITEM-1',productId:'PRODUCT-1',quantity:100}];
  const products={'PRODUCT-1':{ops:[
    {processId:'SX-1',category:'SX',sec:2,active:true},
    {processId:'BL-1',category:'BL',sec:100,active:true},
    {processId:'QC-1',category:'QC',sec:100,active:true},
    {processId:'DG-1',category:'DG',sec:100,active:true}
  ]}};
  const processes=api.productionProcesses(items,products);
  assert.equal(processes.length,1);
  assert.equal(processes[0].processId,'SX-1');
  assert.equal(api.calculate(processes,{'ITEM-1__SX-1':25}).percent,25);
  assert.equal(api.calculate([],{}).percent,0);
});

test('大量生產工序每三十筆合併查詢，不再建立大量同時請求',async()=>{
  const state=runtime({processCount:65});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,updatedAt:10,importStatus:'ready',lifecycleStatus:'active'}];
  const result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,25);
  assert.equal(state.counts.totals,3,'六十五道工序應只建立三次批次查詢');
  assert.equal(state.counts.items,1);
  assert.equal(state.counts.products,1);
});

test('沒有產能版本且確認沒有任何累計時直接顯示零，不讀取每道工序',async()=>{
  const state=runtime({processCount:300,hasNoProduction:true});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  const result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,0);
  assert.equal(state.counts.totals,1,'只用一次按訂單檢查，不按三百道工序建立十次查詢');
});

test('三百道生產工序固定合併成十次查詢，不會逐道讀取',async()=>{
  const state=runtime({processCount:300});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await state.api.load(orders);
  assert.equal(state.counts.totals,10);
});

test('工序累計最多同時執行三批',async()=>{
  const state=runtime({processCount:300,totalQueryDelayMs:5});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await state.api.load(orders);
  assert.equal(state.counts.totals,10);
  assert.equal(state.concurrency.maxActiveTotalQueries,3);
});

test('沒有未出貨訂單時不讀取雲端或建立每日嘗試',async()=>{
  const state=runtime();
  const result=await state.api.load([]);
  assert.equal(result.size,0);
  assert.deepEqual(state.counts,{meta:0,versions:0,items:0,products:0,totals:0,cacheRead:0,cacheWrite:0});
});

test('全部訂單已完成時直接使用雲端快照，不讀取版本、款號或工序',async()=>{
  const state=runtime();
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active',
    productionProgressCompleted:true,productionProgressSnapshotPercent:79}];
  const result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,79);
  assert.equal(result.get('ORDER-1').completed,true);
  assert.deepEqual(state.counts,{meta:0,versions:0,items:0,products:0,totals:0,cacheRead:0,cacheWrite:0});
});

test('另一台電腦以訂單完成快照覆蓋舊本機百分比，顯示同一個實際進度',async()=>{
  const state=runtime();
  const normal=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  let result=await state.api.load(normal);
  assert.equal(result.get('ORDER-1').percent,25);
  const before={...state.counts};
  result=await state.api.load([{...normal[0],productionProgressCompleted:true,productionProgressSnapshotPercent:79}]);
  assert.equal(result.get('ORDER-1').percent,79);
  assert.equal(result.get('ORDER-1').completed,true);
  assert.deepEqual(state.counts,before,'完成狀態不得增加任何雲端進度讀取');
});

test('同一更新週期同時觸發不同畫面範圍仍共用一次載入',async()=>{
  const state=runtime();
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await Promise.all([state.api.load(orders),state.api.load([]),state.api.load(orders)]);
  assert.deepEqual(state.counts,{meta:1,versions:1,items:1,products:1,totals:1,cacheRead:1,cacheWrite:1});
});

test('大型快取寫入失敗後同一頁面當日不得重新讀取',async()=>{
  const state=runtime({cacheWriteFails:true});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  let result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,25);
  assert.equal(state.api.status().state,'failed');
  result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,25);
  assert.deepEqual(state.counts,{meta:1,versions:1,items:1,products:1,totals:1,cacheRead:1,cacheWrite:1});
});

test('大型快取寫入失敗後重新整理仍由每日標記阻止重讀',async()=>{
  const markerStore=new Map();
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  const first=runtime({cacheWriteFails:true,markerStore});
  await first.api.load(orders);
  const reloaded=runtime({cacheWriteFails:true,markerStore});
  const result=await reloaded.api.load(orders);
  assert.equal(result.get('ORDER-1'),null);
  assert.equal(reloaded.api.status().state,'failed');
  assert.deepEqual(reloaded.counts,{meta:0,versions:0,items:0,products:0,totals:0,cacheRead:1,cacheWrite:0});
});

test('已有舊快取但本期保存失敗時，同一頁面仍保留本期新結果',async()=>{
  const options={};
  const state=runtime(options);
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  let result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,25);

  state.setNow(Date.UTC(2026,8,22,22,0,0));
  state.setRevision(2);
  state.setRegisteredQty(60);
  options.cacheWriteFails=true;
  result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,60);
  result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,60,'不得被前一期的持久快取覆蓋');
  assert.equal(state.counts.totals,2,'保存失敗後不得再次讀取工序累計');
});

test('版本資料無法讀取時保留舊資料且當日不再自動重試',async()=>{
  const state=runtime({versionPermissionDenied:true});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,updatedAt:10,importStatus:'ready',lifecycleStatus:'active'}];
  let result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1'),null);
  assert.equal(state.counts.totals,0,'版本檢查失敗時不得退回讀取全部工序累計');
  assert.equal(state.api.status().state,'failed');

  result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1'),null);
  assert.equal(state.counts.versions,1,'同一更新週期失敗後不得再次自動嘗試');
  assert.equal(state.counts.meta,1);
  assert.equal(state.counts.totals,0);
});

test('台灣時間每日六點後只更新一次，隔日才重新核對版本',async()=>{
  const state=runtime();
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,updatedAt:10,importStatus:'ready',lifecycleStatus:'active'}];
  let result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,25);
  assert.deepEqual(state.counts,{meta:1,versions:1,items:1,products:1,totals:1,cacheRead:1,cacheWrite:1});

  result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,25);
  assert.deepEqual(state.counts,{meta:1,versions:1,items:1,products:1,totals:1,cacheRead:1,cacheWrite:1});

  state.setRevision(2);
  state.setRegisteredQty(60);
  result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,25,'同一週期內即使雲端變動也沿用當日快取');
  assert.deepEqual(state.counts,{meta:1,versions:1,items:1,products:1,totals:1,cacheRead:1,cacheWrite:1});

  state.setNow(Date.UTC(2026,8,22,22,0,0)); // 台灣時間隔日 06:00。
  result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,60);
  assert.deepEqual(state.counts,{meta:2,versions:2,items:1,products:1,totals:2,cacheRead:2,cacheWrite:2});
});

test('隔日沒有款號或報工變動時只核對小型版本，不重讀工序累計',async()=>{
  const state=runtime({processCount:300});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await state.api.load(orders);
  state.setNow(Date.UTC(2026,8,22,22,0,0));
  const result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,25);
  assert.equal(state.api.readStats().metaDocuments,1);
  assert.equal(state.api.readStats().versionDocuments,1);
  assert.equal(state.api.readStats().itemDocuments,0);
  assert.equal(state.api.readStats().productDocuments,0);
  assert.equal(state.api.readStats().totalDocuments,0);
  assert.equal(state.api.readStats().estimatedReads,2);
});

test('自動更新後仍有一次獨立手動更新，第二次手動不再讀取雲端',async()=>{
  const state=runtime();
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  let result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,25);
  assert.equal(state.api.manualStatus().available,true);

  state.setRevision(2);
  state.setRegisteredQty(60);
  const manual=await state.api.manualRefresh(orders);
  assert.equal(manual.reason,'success');
  assert.equal(manual.attempted,true);
  assert.equal(manual.values.get('ORDER-1').percent,60);
  assert.equal(state.api.manualStatus().available,false);
  assert.deepEqual(state.counts,{meta:2,versions:2,items:1,products:1,totals:2,cacheRead:2,cacheWrite:2});

  const repeated=await state.api.manualRefresh(orders);
  assert.equal(repeated.reason,'already-attempted');
  assert.equal(repeated.values.get('ORDER-1').percent,60);
  assert.deepEqual(state.counts,{meta:2,versions:2,items:1,products:1,totals:2,cacheRead:2,cacheWrite:2});
});

test('自動更新失敗不會占用手動機會',async()=>{
  const state=runtime({versionPermissionDenied:true});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await state.api.load(orders);
  assert.equal(state.api.status().state,'failed');
  assert.equal(state.api.manualStatus().available,true);

  state.setVersionPermissionDenied(false);
  const manual=await state.api.manualRefresh(orders);
  assert.equal(manual.reason,'success');
  assert.equal(manual.values.get('ORDER-1').percent,25);
  assert.equal(state.api.manualStatus().available,false);
});

test('手動更新失敗仍消耗當期手動機會且不重複讀取',async()=>{
  const state=runtime({versionPermissionDenied:true});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  const first=await state.api.manualRefresh(orders);
  assert.equal(first.reason,'failed');
  assert.equal(state.api.manualStatus().available,false);
  const before={...state.counts};
  const repeated=await state.api.manualRefresh(orders);
  assert.equal(repeated.reason,'already-attempted');
  assert.equal(state.counts.meta,before.meta);
  assert.equal(state.counts.versions,before.versions);
  assert.equal(state.counts.totals,before.totals);
});

test('沒有未出貨訂單時不消耗手動更新機會',async()=>{
  const state=runtime();
  const result=await state.api.manualRefresh([]);
  assert.equal(result.reason,'no-orders');
  assert.equal(result.attempted,false);
  assert.equal(state.api.manualStatus().available,true);
  assert.deepEqual(state.counts,{meta:0,versions:0,items:0,products:0,totals:0,cacheRead:0,cacheWrite:0});
});

test('今日自動額度已使用時，重新登入不等待手動更新鎖或讀取雲端',async()=>{
  const options={useLocks:true,lockShouldThrow:false};
  const state=runtime(options);
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await state.api.load(orders);
  const before={...state.counts};
  state.api.clearSession();
  options.lockShouldThrow=true;
  const cached=await state.api.load(orders);
  assert.equal(cached.get('ORDER-1').percent,25);
  assert.equal(state.counts.meta,before.meta);
  assert.equal(state.counts.versions,before.versions);
  assert.equal(state.counts.items,before.items);
  assert.equal(state.counts.products,before.products);
  assert.equal(state.counts.totals,before.totals);
  assert.equal(state.counts.cacheRead,before.cacheRead+1,'重新登入只讀一次本機快取');
});

test('更新週期固定以台灣時間早上六點切換',()=>{
  const {api}=runtime();
  assert.equal(api.refreshPeriodKey(Date.UTC(2026,8,21,21,59,59)),'2026-09-21');
  assert.equal(api.refreshPeriodKey(Date.UTC(2026,8,21,22,0,0)),'2026-09-22');
});

test('修改一般訂單欄位時間不會使生產結構快取失效',()=>{
  const {api}=runtime();
  const before=api.orderToken({totalQty:100,itemCount:2,updatedAt:10,importStatus:'ready',lifecycleStatus:'active'});
  const after=api.orderToken({totalQty:100,itemCount:2,updatedAt:999,importStatus:'ready',lifecycleStatus:'active'});
  assert.equal(before,after);
});

test('大型訂單新增報工後只讀變動工序，不再重讀全部工序',async()=>{
  const state=runtime({processCount:300,changedProcessIndexes:[17]});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await state.api.load(orders);
  assert.equal(state.counts.totals,10);
  state.setNow(Date.UTC(2026,8,22,22,0,0));
  state.setRevision(2,2000);
  state.setRegisteredQty(60);
  const result=await state.api.load(orders);
  assert.equal(state.counts.totals,11,'第二次更新只增加一次訂單增量查詢');
  assert.equal(state.api.readStats().totalDocuments,1,'三百道工序只回傳一筆變動累計');
  assert.ok(result.get('ORDER-1').percent>25&&result.get('ORDER-1').percent<26);
});

test('同一道工序連續多次報工仍只讀一筆目前累計',async()=>{
  const state=runtime({processCount:100,changedProcessIndexes:[0]});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await state.api.load(orders);
  state.setNow(Date.UTC(2026,8,22,22,0,0));
  state.setRevision(51,9000);
  state.setRegisteredQty(75);
  await state.api.load(orders);
  assert.equal(state.api.readStats().totalDocuments,1);
  assert.equal(state.api.readStats().totalQueries,1);
});

test('增量索引尚未可用時安全退回完整讀取',async()=>{
  const state=runtime({processCount:65,changedProcessIndexes:[0],deltaIndexMissing:true});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await state.api.load(orders);
  state.setNow(Date.UTC(2026,8,22,22,0,0));
  state.setRevision(2,2000);
  state.setRegisteredQty(60);
  const result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,60);
  assert.equal(state.api.readStats().totalDocuments,65);
  assert.equal(state.api.readStats().totalQueries,3);
});

test('只修改既有 SX 秒數時沿用完成數量，不重讀產能累計',async()=>{
  const state=runtime({processCount:2});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await state.api.load(orders);
  state.setNow(Date.UTC(2026,8,22,22,0,0));
  state.setProductChange({sequence:8,category:'SX',seconds:9});
  await state.api.load(orders);
  assert.equal(state.api.readStats().productDocuments,1);
  assert.equal(state.api.readStats().totalDocuments,0);
  assert.equal(state.api.readStats().totalQueries,0);
});

test('SX 改為 TC 時移出生產進度且不重讀產能',async()=>{
  const state=runtime();
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await state.api.load(orders);
  state.setNow(Date.UTC(2026,8,22,22,0,0));
  state.setProductChange({sequence:8,category:'TC',seconds:2});
  const result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,0);
  assert.equal(state.api.readStats().totalDocuments,0);
});

test('TC 改為 SX 時只讀新納入工序的累計',async()=>{
  const state=runtime();
  state.setProductChange({sequence:7,category:'TC',seconds:2});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  let result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,0);
  state.setNow(Date.UTC(2026,8,22,22,0,0));
  state.setProductChange({sequence:8,category:'SX',seconds:2});
  result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,25);
  assert.equal(state.api.readStats().totalDocuments,1);
});

test('不相關款號變更不重算訂單產能',async()=>{
  const state=runtime({changedProductUnrelated:true});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  await state.api.load(orders);
  state.setNow(Date.UTC(2026,8,22,22,0,0));
  state.setProductChange({sequence:8});
  const result=await state.api.load(orders);
  assert.equal(result.get('ORDER-1').percent,25);
  assert.equal(state.api.readStats().productDocuments,1,'只讀一筆有變動但不相關的款號');
  assert.equal(state.api.readStats().totalDocuments,0);
});

test('更新依實際流程回報八個使用者可辨識階段',async()=>{
  const state=runtime({processCount:65,totalQueryDelayMs:2});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  const events=[];
  await state.api.load(orders,{onProgress:event=>events.push({...event})});
  const phases=[...new Set(events.map(event=>event.phase))];
  assert.deepEqual(phases,[
    'checkingVersions','checkingProducts','loadingProcesses','loadingTotals',
    'processingLegacy','calculating','savingCache','complete'
  ]);
  assert.equal(events.at(-1).state,'complete');
  assert.equal(events.at(-1).completed,1);
  assert.equal(events.at(-1).total,1);
});

test('批次讀取回報完成數與耗時供畫面估算倒數',async()=>{
  const state=runtime({processCount:65,totalQueryDelayMs:2});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  const events=[];
  await state.api.load(orders,{onProgress:event=>events.push({...event})});
  const totals=events.filter(event=>event.phase==='loadingTotals');
  assert.ok(totals.some(event=>event.total===3&&event.completed===1));
  assert.ok(totals.some(event=>event.total===3&&event.completed===3));
  assert.ok(totals.every(event=>event.elapsedMs>=0));
});

test('更新失敗回報當時階段且不虛報完成',async()=>{
  const state=runtime({versionPermissionDenied:true});
  const orders=[{id:'ORDER-1',totalQty:100,itemCount:1,importStatus:'ready',lifecycleStatus:'active'}];
  const events=[];
  await state.api.load(orders,{onProgress:event=>events.push({...event})});
  assert.equal(events.at(-1).state,'failed');
  assert.equal(events.at(-1).phase,'checkingVersions');
  assert.equal(events.some(event=>event.state==='complete'),false);
});
