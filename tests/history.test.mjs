import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const source=fs.readFileSync(new URL('js/history.js',root),'utf8'); // source（歷史紀錄共用程式內容）

function docs(count,prefix,start=0){
  return Array.from({length:count},(_,index)=>({
    id:`${prefix}-${start+index}`,
    data:()=>({createdAt:10000-start-index,action:'productImport',permissionKey:'summary'})
  }));
}

function createHistory(){
  const reads={operationLogs:0,orderAdjustments:0};
  const writes=[];
  const window={
    firebaseAuthUser:{uid:'user-001',displayName:'測試人員'},
    cu:{user:'測試人員',role:'admin'},
    permissionSettings:{},
    isAdm:()=>true,
    _collection:name=>name,
    _where:(field,operator,value)=>({type:'where',field,operator,value}),
    _orderBy:(field,direction)=>({type:'orderBy',field,direction}),
    _limit:value=>({type:'limit',value}),
    _startAfter:value=>({type:'startAfter',value}),
    _query:(collectionName,...constraints)=>({collectionName,constraints}),
    _getDocs:async statement=>{
      const name=statement.collectionName;
      reads[name]+=1;
      const rows=name==='orderAdjustments'
        ? (reads[name]===1?docs(50,'adjust'):docs(2,'adjust',50))
        : docs(2,'operation');
      return {docs:rows,size:rows.length,empty:rows.length===0};
    },
    _newDocRef:name=>({id:'new-log-001',path:`${name}/new-log-001`}),
    _setDoc:async(reference,data,options)=>{ writes.push({reference,data,options}); }
  };
  const context={window,console};
  vm.createContext(context);
  vm.runInContext(source,context);
  return {history:window.PCMSHistory,window,reads,writes};
}

test('相同操作歷史在同一工作階段只查詢一次',async()=>{
  const {history,reads}=createHistory();
  const options={permissionKey:'summary',actions:['productImport'],limit:50};
  const first=await history.loadOperationLogs(options);
  const second=await history.loadOperationLogs(options);
  assert.equal(first.length,2);
  assert.equal(second.length,2);
  assert.equal(reads.operationLogs,1);
  await history.loadOperationLogs({...options,force:true});
  assert.equal(reads.operationLogs,2);
});
test('操作紀錄由共用程式建立固定操作者與數量欄位',async()=>{
  const {history,writes}=createHistory();
  const saved=await history.saveOperationLog({
    permissionKey:'summary',feature:'products',action:'productImport',itemCount:3,detailCount:8
  });
  assert.equal(saved.id,'new-log-001');
  assert.equal(saved.createdByUid,'user-001');
  assert.equal(saved.itemCount,3);
  assert.equal(saved.detailCount,8);
  assert.equal(writes.length,1);
  assert.equal(writes[0].data.action,'productImport');
});

test('訂單調整歷史使用五十筆游標繼續載入',async()=>{
  const {history,reads}=createHistory();
  const first=await history.loadOrderAdjustments({limit:50});
  assert.equal(first.length,50);
  assert.equal(history.hasMore('orderAdjustments',{limit:50}),true);
  const second=await history.loadOrderAdjustments({limit:50,loadMore:true});
  assert.equal(second.length,52);
  assert.equal(reads.orderAdjustments,2);
  assert.equal(history.hasMore('orderAdjustments',{limit:50}),false);
});
