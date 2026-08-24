import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));

function load(){
  let reads=0;
  const rows=[];
  const window={
    _collection:name=>name,
    _getDocs:async()=>{ reads+=1; return {docs:rows.map(row=>({id:row.groupId,data:()=>clone(row)}))}; },
    PCMSProductMasterService:{
      createGroup:async input=>({...input,groupId:'grp_created',revision:1,active:true}),
      updateGroup:async(current,patch)=>({...current,...patch,revision:current.revision+1}),
      updateGroupMembers:async(current,memberProductIds)=>({group:{...current,memberProductIds,revision:current.revision+1},added:[],removed:[]})
    }
  };
  const document={dispatchEvent:()=>{}};
  const context={window,document,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},TextEncoder,console};
  vm.createContext(context);
  ['js/product-model.js','js/product-group-store.js','js/product-group-runtime.js'].forEach(path=>vm.runInContext(read(path),context));
  return {window,rows,reads:()=>reads};
}

test('群組只在實際載入時讀取一次且固定以 productId 查找',async()=>{
  const setup=load();
  const first=setup.window.PCMSProductModel.deterministicLegacyId('product','P1');
  const second=setup.window.PCMSProductModel.deterministicLegacyId('product','P2');
  setup.window.D=[
    setup.window.PCMSProductModel.normalizeProduct({productId:first,code:'P1',client:'C1',vi:'Mẫu A',zh:'款A',sz:'S',ops:[{processId:setup.window.PCMSProductModel.deterministicLegacyId('process','P1-1'),op:'1',vi:'May',zh:'車縫',sec:60}]}),
    setup.window.PCMSProductModel.normalizeProduct({productId:second,code:'P2',client:'C1',vi:'Mẫu A',zh:'款A',sz:'M',ops:[{processId:setup.window.PCMSProductModel.deterministicLegacyId('process','P2-1'),op:'1',vi:'May',zh:'車縫',sec:60}]})
  ];
  setup.rows.push({groupId:'grp_1234567890123456',name:'Nhóm A',memberProductIds:[first,second],active:true,revision:1});
  assert.equal(setup.reads(),0);
  await setup.window.PCMSProductGroupRuntime.load();
  await setup.window.PCMSProductGroupRuntime.load();
  assert.equal(setup.reads(),1);
  assert.equal(setup.window.PCMSProductGroupRuntime.groupForProduct(first).groupId,'grp_1234567890123456');
  assert.equal(setup.window.PCMSProductGroupRuntime.listGroups()[0].signature,setup.window.PCMSProductModel.groupSignature(setup.window.D[0]));
});

test('群組建立、改名、停用及成員調整會更新同一份頁面狀態',async()=>{
  const setup=load();
  const first=setup.window.PCMSProductModel.deterministicLegacyId('product','P1');
  const second=setup.window.PCMSProductModel.deterministicLegacyId('product','P2');
  const third=setup.window.PCMSProductModel.deterministicLegacyId('product','P3');
  const created=await setup.window.PCMSProductGroupRuntime.create({name:'Nhóm A',memberProductIds:[first,second]});
  const renamed=await setup.window.PCMSProductGroupRuntime.rename(created,'Nhóm B');
  const changed=await setup.window.PCMSProductGroupRuntime.updateMembers(renamed,[first,third]);
  await setup.window.PCMSProductGroupRuntime.setActive(changed.group,false);
  assert.equal(setup.window.PCMSProductGroupRuntime.all({includeInactive:true})[0].name,'Nhóm B');
  assert.equal(setup.window.PCMSProductGroupRuntime.all().length,0);
});

test('建立群組候選會列出同客人與同越文品名，完全一致優先且已分組款號保留在最後供比對',async()=>{
  const setup=load();
  const model=setup.window.PCMSProductModel;
  const product=(code,ops,vi='Vòng cổ')=>model.normalizeProduct({
    productId:model.deterministicLegacyId('product',code),code,client:'BK',vi,sz:'M',
    ops:ops.map((item,index)=>({processId:model.deterministicLegacyId('process',`${code}-${index}`),no:String(index+1),vi:item.vi,zh:item.vi,sec:item.sec,category:'SX'}))
  });
  const standard=[{vi:'May',sec:60},{vi:'Kiểm tra',sec:30}];
  const source=product('P1',standard);
  const exact=product('P2',standard);
  const different=product('P3',[{vi:'May khác',sec:60}]);
  const grouped=product('P4',standard);
  const otherName=product('P5',standard,'Tên khác');
  const groupedSecond=product('P6',standard);
  setup.window.D=[source,exact,different,grouped,otherName,groupedSecond];
  setup.rows.push({groupId:'grp_existing_123456',name:'Nhóm cũ',memberProductIds:[grouped.productId,groupedSecond.productId],active:true,revision:1});
  await setup.window.PCMSProductGroupRuntime.load();
  const candidates=setup.window.PCMSProductGroupRuntime.findCandidates(source.productId);
  assert.deepEqual(Array.from(candidates,item=>item.code),['P2','P3','P4','P6']);
  assert.equal(model.groupRecommendation(source,candidates[0]).exact,true);
  assert.equal(model.groupRecommendation(source,candidates[1]).countDifferent,true);
  assert.equal(setup.window.PCMSProductGroupRuntime.groupForProduct(candidates[2].productId).groupId,'grp_existing_123456');
  const plan=setup.window.PCMSProductGroupRuntime.candidatePlan(source.productId);
  assert.deepEqual(Array.from(plan.selectedCodes),['P1','P2']);
  assert.deepEqual(Array.from(plan.disabledCodes),['P4','P6']);
  assert.equal(plan.selectedCodes.includes('P3'),false);
});
