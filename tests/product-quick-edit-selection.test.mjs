import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const source=fs.readFileSync(new URL('js/product-quick-edit.js',root),'utf8');

function quickEdit({summaries}){
  const window={
    PCMSProductModel:{
      fixedId:value=>String(value??''),
      compareGroupConsistency:()=>[],
      groupRecommendation:()=>null
    },
    PCMSProcessGroupUI:{comparisonContext:()=>({summaries})}
  };
  vm.runInNewContext(source,{window,document:{},console,setTimeout,clearTimeout},{filename:'js/product-quick-edit.js'});
  return window.PCMSProductQuickEdit;
}

function product(productId,code,sec=30){
  return {productId,code,client:'SYLS',vi:'Sản phẩm',sz:'15MM',ops:[{processId:`${productId}-13`,no:13,vi:'May',sec,active:true}]};
}

test('已有群組只預選來源與一致款號，差異款號保留未勾選',()=>{
  const products=[product('p1','A'),product('p2','B'),product('p3','C',45)];
  const summaries=new Map([
    ['p1',{comparisonState:'consistent'}],
    ['p2',{comparisonState:'consistent'}],
    ['p3',{comparisonState:'different'}]
  ]);
  const targets=quickEdit({summaries}).buildTargets({
    field:'processSeconds',sourceProductId:'p1',sourceProcessId:'p1-13',products,
    group:{memberProductIds:['p1','p2','p3']}
  });
  assert.deepEqual(JSON.parse(JSON.stringify(targets.map(target=>[target.product.code,target.selected,target.disabled]))),[
    ['A',true,false],['B',true,false],['C',false,false]
  ]);
});

test('來源款號即使狀態未判定仍保持必要勾選',()=>{
  const products=[product('p1','A')];
  const targets=quickEdit({summaries:new Map()}).buildTargets({
    field:'processSeconds',sourceProductId:'p1',sourceProcessId:'p1-13',products,
    group:{memberProductIds:['p1']}
  });
  assert.equal(targets[0].selected,true);
  assert.equal(targets[0].required,true);
});
