import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/product-change-log-store.js',import.meta.url),'utf8');
const pageSource=fs.readFileSync(new URL('../js/product-change-log.js',import.meta.url),'utf8');
const htmlSource=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const styleSource=fs.readFileSync(new URL('../styles/features/product-change-log.css',import.meta.url),'utf8');
const context={window:{firebaseAuthUser:{uid:'u1'},cu:{user:'Người dùng'}},console};
vm.createContext(context);vm.runInContext(source,context);
const store=context.window.PCMSProductChangeLogStore;
const actor={uid:'u1',name:'Người dùng'};
const operation=(id,no,name,sec)=>({processId:id,no:String(no),sortOrder:no,category:'SX',vi:name,zh:'',sec,active:true});
const product=(id,code,ops)=>({productId:id,code,client:'C1',zh:'',vi:code,sz:'M',ops,processIds:ops.map(item=>item.processId),
  active:true,revision:1,codeKey:`code_${code}`,trackingEpoch:'epoch-1',lastChangeBatchId:'batch-1',createdAt:1,createdByUid:'u1',
  createdBy:'Người dùng',updatedAt:1,updatedByUid:'u1',updatedBy:'Người dùng'});

test('單款修改摘要只有一層，明細列出工序號、名稱與秒數前後值',()=>{
  const before=product('prd_product000001','P-001',[operation('prc_process000001',1,'May',60)]);
  const after={...before,revision:2,updatedAt:2,ops:[operation('prc_process000001',1,'May mới',50)]};
  const batch=store.beginBatch({batchId:'batch-1',trackingEpoch:'epoch-1',mode:'single',targetCount:1,actor,now:2});
  const detail=store.detail({batchId:'batch-1',trackingEpoch:'epoch-1',mode:'single',before,after,actor,now:2});
  assert.equal(batch.batch.mode,'single');
  assert.equal(detail.changes.some(item=>item.field==='vi'&&item.processNo==='1'&&item.processName==='May mới'),true);
  assert.equal(detail.changes.some(item=>item.field==='sec'&&item.before===60&&item.after===50),true);
  assert.equal(detail.productCodeKey,'P-001');
});

test('群組十款仍共用一筆主摘要，每款只建立直接明細',()=>{
  const batch=store.beginBatch({batchId:'batch-group',trackingEpoch:'epoch-1',mode:'group',targetCount:10,actor,now:10});
  const final=store.finalizeBatch(batch.batch,{successCount:10,failureCount:0,unprocessedCount:0},{actor,now:20});
  assert.equal(final.batch.targetCount,10);
  assert.equal(final.batch.completedCount,10);
  assert.equal(final.batch.status,'success');
  assert.equal(final.resultLog.itemCount,10);
});

test('Excel 匯入保存整套前後工序，支援十一道變十道或十二道',()=>{
  const beforeOps=Array.from({length:11},(_,index)=>operation(`prc_process${String(index+1).padStart(6,'0')}`,index+1,`Old ${index+1}`,20+index));
  const afterOps=Array.from({length:12},(_,index)=>operation(index<10?beforeOps[index].processId:`prc_newprocess${index}`,index+1,`New ${index+1}`,30+index));
  const before=product('prd_product000001','A產品',beforeOps);
  const after={...product('prd_product000001','A產品',afterOps),revision:2,updatedAt:2};
  const detail=store.detail({batchId:'batch-import',trackingEpoch:'epoch-1',mode:'import',before,after,actor,now:2});
  assert.equal(detail.before.ops.length,11);
  assert.equal(detail.after.ops.length,12);
  assert.equal(detail.changes.some(item=>item.field==='removed'),true);
  assert.equal(detail.changes.some(item=>item.field==='created'),true);
});

test('款號搜尋直接查找全部流水帳明細，點開批次時才載入該批內容',()=>{
  assert.match(pageSource,/productCodeCandidates\(inputValue\)/);
  assert.match(pageSource,/_where\('productCodeKey',keys\.length===1\?'==':'in'/);
  assert.match(pageSource,/_where\('productCodeKey','>=',key\)/);
  assert.match(pageSource,/_where\('productCodeKey','<=',`\$\{key\}\\uf8ff`\)/);
  assert.match(pageSource,/_where\('batchId','==',batchId\)/);
  assert.match(pageSource,/_limit\(PAGE_SIZE\)/);
  assert.match(pageSource,/addEventListener\('keydown',handleSearchKeydown\)/);
  assert.doesNotMatch(pageSource,/setTimeout\(searchByProductCode/);
});

test('載入更多固定在流水帳標題右側且沒有下一批時隱藏',()=>{
  const header=htmlSource.match(/<div class="ui-section-header product-change-list-header">([\s\S]*?)<\/div>/)?.[1]||'';
  assert.match(header,/id="product-change-more" hidden/);
  assert.match(header,/Tải thêm[\s\S]*?載入更多/);
  assert.doesNotMatch(htmlSource,/product-change-more-row/);
  assert.match(styleSource,/product-change-more-button\{[^}]*margin-left:auto/);
  assert.match(styleSource,/product-change-more-button\[hidden\]\{display:none!important\}/);
  assert.match(pageSource,/more\.hidden=state\.done/);
  assert.match(pageSource,/const PAGE_SIZE=50/);
});

test('修改明細在原摘要列下方獨立展開並可由摘要或固定抬頭收合',()=>{
  assert.match(pageSource,/openBatchIds:new Set\(\)/);
  assert.match(pageSource,/state\.openBatchIds\.add\(batchId\)/);
  assert.match(pageSource,/state\.openBatchIds\.delete\(batchId\)/);
  assert.match(pageSource,/expanded\?detailRow\(row\):''/);
  assert.match(pageSource,/data-product-change-close=/);
  assert.match(pageSource,/aria-expanded="\$\{expanded\}"/);
  assert.doesNotMatch(htmlSource,/id="product-change-details"/);
  assert.match(styleSource,/\.product-change-detail-toolbar\{[^}]*position:sticky/);
  assert.match(pageSource,/class="ui-button is-compact product-change-detail-close"/);
  assert.match(styleSource,/\.product-change-detail-close\{[^}]*align-self:end;[^}]*justify-self:end/);
  assert.match(styleSource,/\.product-change-view\{[^}]*min-width:132px;[^}]*justify-content:center/);
});

test('明細每次最多讀取一百筆並使用游標載入更多，同頁重開沿用記憶內容',()=>{
  assert.match(pageSource,/const DETAIL_PAGE_SIZE=100/);
  assert.match(pageSource,/_startAfter\(detailState\.cursor\)/);
  assert.match(pageSource,/_limit\(DETAIL_PAGE_SIZE\)/);
  assert.match(pageSource,/Tải thêm chi tiết','載入更多明細/);
  assert.match(pageSource,/if\(!state\.details\.get\(batchId\)\?\.items\.length\) await loadDetailPage\(batchId\)/);
  assert.doesNotMatch(pageSource,/_limit\(5000\)/);
});

test('已載入明細支援本機搜尋與自然排序且中文名稱不作為主要排序欄',()=>{
  assert.match(pageSource,/Tìm trong chi tiết đã tải/);
  assert.match(pageSource,/搜尋已載入明細/);
  assert.match(pageSource,/new Intl\.Collator\('vi',\{numeric:true,sensitivity:'base'\}\)/);
  assert.match(pageSource,/const productOrder=\{client:0,vi:1,sz:2,zh:3/);
  assert.match(pageSource,/const processOrder=\{no:0,vi:1,sec:2,category:3,zh:4/);
  assert.match(pageSource,/change\.scope==='process'&&\(field==='vi'\|\|field==='zh'\)/);
  assert.match(pageSource,/PCMSUISearchDropdown\?\.scoreText/);
  assert.match(pageSource,/handleTableKeydown/);
});

test('Excel 匯入仍保留每款整套套用前後工序比較',()=>{
  assert.match(pageSource,/Toàn bộ công đoạn trước','套用前全部工序/);
  assert.match(pageSource,/Toàn bộ công đoạn sau','套用後全部工序/);
  assert.match(pageSource,/processTable\(before,after,'before'\)/);
  assert.match(pageSource,/processTable\(after,before,'after'\)/);
  assert.match(styleSource,/\.product-change-process-table td\.is-changed/);
  assert.match(styleSource,/\.product-change-process-table tr\.is-added td/);
  assert.match(styleSource,/\.product-change-process-table tr\.is-removed td/);
});
