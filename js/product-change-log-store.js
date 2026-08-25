// product-change-log-store（款號修改流水帳核心）：建立操作摘要、完整前後快照及直接明細。
(function(){
  'use strict';

  const BATCH_COLLECTION='productChangeBatches';
  const ITEM_COLLECTION='productChangeItems';
  const LOG_COLLECTION='operationLogs';
  const SCHEMA_VERSION=1;
  const MODES=new Set(['single','group','import']);
  const FINAL_STATUSES=new Set(['success','partial','failed']);
  const PRODUCT_FIELDS=['client','zh','vi','sz'];
  const PROCESS_FIELDS=['no','category','zh','vi','sec'];

  function text(value){ return String(value??'').trim().replace(/\s+/g,' '); }
  function productCodeKey(value){ return text(value).normalize('NFKC').toLocaleUpperCase(); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function count(value){ const parsed=Math.trunc(Number(value)||0);return Math.max(0,parsed); }
  function actorData(input={}){
    const uid=text(input.uid||input.userId||window.firebaseAuthUser?.uid);
    const name=text(input.name||input.userName||window.cu?.user||window.cu?.username||uid).slice(0,200);
    if(!uid) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    return {uid,name};
  }
  function token(value){
    return text(value).toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,40);
  }
  function batchIdFor(now,provided=''){
    const explicit=text(provided);
    if(explicit) return explicit;
    const random=token(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
    return `pcb_${Math.max(1,Math.trunc(Number(now)||Date.now()))}_${random||'change'}`;
  }
  function operationLogId(batchId,phase){ return `${text(batchId)}__${phase}`; }
  function itemId(batchId,productId){ return `${text(batchId)}__${text(productId)}`; }

  function operationSnapshot(operation={}){
    return {
      processId:text(operation.processId),no:text(operation.no),category:text(operation.category),
      zh:text(operation.zh),vi:text(operation.vi),sec:Math.max(1,Math.trunc(Number(operation.sec)||0)),
      sortOrder:Math.max(1,Math.trunc(Number(operation.sortOrder)||Number(operation.no)||1)),
      active:operation.active!==false
    };
  }
  function productSnapshot(product){
    if(!product) return null;
    return {
      productId:text(product.productId),code:text(product.code),client:text(product.client),zh:text(product.zh),
      vi:text(product.vi),sz:text(product.sz),ops:(Array.isArray(product.ops)?product.ops:[]).map(operationSnapshot),
      processIds:(Array.isArray(product.processIds)?product.processIds:product.ops?.map(item=>item.processId)||[]).map(text),
      active:product.active!==false,revision:Math.max(1,Math.trunc(Number(product.revision)||1)),
      codeKey:text(product.codeKey),trackingEpoch:text(product.trackingEpoch),lastChangeBatchId:text(product.lastChangeBatchId),
      createdAt:Math.max(1,Math.trunc(Number(product.createdAt)||1)),createdByUid:text(product.createdByUid),createdBy:text(product.createdBy),
      updatedAt:Math.max(1,Math.trunc(Number(product.updatedAt)||1)),updatedByUid:text(product.updatedByUid),updatedBy:text(product.updatedBy)
    };
  }

  function processLabel(operation){ return text(operation?.vi||operation?.zh); }
  function change(scope,field,before,after,operation=null){
    return {
      scope,field,processId:text(operation?.processId),processNo:text(operation?.no),processName:processLabel(operation),
      before:before===undefined||before===null?'':before,after:after===undefined||after===null?'':after
    };
  }
  function calculateChanges(beforeInput,afterInput){
    const before=productSnapshot(beforeInput),after=productSnapshot(afterInput),changes=[];
    if(!before&&after){
      changes.push(change('product','created','',after.code));
      after.ops.forEach(operation=>changes.push(change('process','created','',`${operation.vi||operation.zh} · ${operation.sec}`,operation)));
      return changes;
    }
    if(before&&!after){
      changes.push(change('product','removed',before.code,''));
      return changes;
    }
    if(!before||!after) return changes;
    PRODUCT_FIELDS.forEach(field=>{
      if(before[field]!==after[field]) changes.push(change('product',field,before[field],after[field]));
    });
    const beforeById=new Map(before.ops.map(item=>[item.processId,item]));
    const afterById=new Map(after.ops.map(item=>[item.processId,item]));
    const processIds=[...new Set([...beforeById.keys(),...afterById.keys()])];
    processIds.forEach(processId=>{
      const oldOperation=beforeById.get(processId),newOperation=afterById.get(processId);
      if(!oldOperation&&newOperation){
        changes.push(change('process','created','',`${newOperation.vi||newOperation.zh} · ${newOperation.sec}`,newOperation));
        return;
      }
      if(oldOperation&&!newOperation){
        changes.push(change('process','removed',`${oldOperation.vi||oldOperation.zh} · ${oldOperation.sec}`,'',oldOperation));
        return;
      }
      PROCESS_FIELDS.forEach(field=>{
        if(oldOperation[field]!==newOperation[field]) changes.push(change('process',field,oldOperation[field],newOperation[field],newOperation));
      });
    });
    return changes;
  }

  function beginBatch(input={}){
    const actor=actorData(input.actor),now=Math.max(1,Math.trunc(Number(input.now)||Date.now()));
    const mode=MODES.has(input.mode)?input.mode:'single';
    const batchId=batchIdFor(now,input.batchId),trackingEpoch=text(input.trackingEpoch);
    if(!trackingEpoch) throw new Error('Thiếu mốc bắt đầu nhật ký mã hàng. / 缺少款號流水帳起始標記。');
    const targetCount=Math.max(1,count(input.targetCount));
    const requestedPermission=text(input.writePermissionKey||input.permissionKey);
    const writePermissionKey=mode==='import'
      ?'summary'
      :(requestedPermission==='processSecondsEdit'?'processSecondsEdit':'productionProcessEdit');
    const batch={
      batchId,trackingEpoch,mode,status:'running',action:text(input.action||mode).slice(0,100),
      writePermissionKey,targetCount,
      completedCount:0,successCount:0,failureCount:0,unprocessedCount:0,
      fileName:text(input.fileName).slice(0,300),createdAt:now,createdByUid:actor.uid,createdBy:actor.name,
      updatedAt:now,schemaVersion:SCHEMA_VERSION
    };
    const startLogId=operationLogId(batchId,'start');
    const startLog={
      permissionKey:'productsMain',feature:'products',action:'productChangeBatchStart',status:'success',
      targetType:'productChangeBatch',targetId:batchId,batchId,mode,itemCount:targetCount,detailCount:0,
      fileName:batch.fileName,note:text(input.note||batch.action).slice(0,500),createdAt:now,
      createdByUid:actor.uid,createdBy:actor.name,operationLogId:startLogId,schemaVersion:4
    };
    return {batch,startLogId,startLog};
  }

  function detail(input={}){
    const actor=actorData(input.actor),now=Math.max(1,Math.trunc(Number(input.now)||Date.now()));
    const before=productSnapshot(input.before),after=productSnapshot(input.after);
    const productId=text(input.productId||after?.productId||before?.productId);
    if(!productId) throw new Error('Thiếu mã định danh sản phẩm. / 缺少款號固定識別碼。');
    const status=['success','failed','unprocessed'].includes(input.status)?input.status:'success';
    return {
      batchId:text(input.batchId),trackingEpoch:text(input.trackingEpoch),productId,
      productCode:text(input.productCode||after?.code||before?.code),
      productCodeKey:productCodeKey(input.productCode||after?.code||before?.code),
      mode:MODES.has(input.mode)?input.mode:'single',status,
      before,after,changes:status==='success'?calculateChanges(before,after):[],
      error:text(input.error).slice(0,500),createdAt:now,createdByUid:actor.uid,createdBy:actor.name,schemaVersion:SCHEMA_VERSION
    };
  }

  function finalizeBatch(batchInput={},countsInput={},options={}){
    const batch=clone(batchInput),actor=actorData(options.actor),now=Math.max(1,Math.trunc(Number(options.now)||Date.now()));
    const successCount=count(countsInput.successCount),failureCount=count(countsInput.failureCount);
    const unprocessedCount=count(countsInput.unprocessedCount);
    const completedCount=successCount+failureCount+unprocessedCount;
    if(completedCount!==count(batch.targetCount)) throw new Error('Kết quả nhật ký không khớp số mục tiêu. / 流水帳結果與目標數量不一致。');
    const status=failureCount||unprocessedCount?(successCount?'partial':'failed'):'success';
    if(!FINAL_STATUSES.has(status)) throw new Error('Trạng thái nhật ký không hợp lệ. / 流水帳狀態不正確。');
    const finalized={...batch,status,completedCount,successCount,failureCount,unprocessedCount,updatedAt:now,completedAt:now};
    const resultLogId=operationLogId(batch.batchId,'result');
    const resultLog={
      permissionKey:'productsMain',feature:'products',action:'productChangeBatchResult',status,
      targetType:'productChangeBatch',targetId:batch.batchId,batchId:batch.batchId,mode:batch.mode,
      itemCount:batch.targetCount,detailCount:completedCount,successCount,failureCount,unprocessedCount,
      fileName:text(batch.fileName).slice(0,300),note:text(options.note||batch.action).slice(0,500),createdAt:now,
      createdByUid:actor.uid,createdBy:actor.name,operationLogId:resultLogId,schemaVersion:4
    };
    return {batch:finalized,resultLogId,resultLog};
  }

  window.PCMSProductChangeLogStore=Object.freeze({
    BATCH_COLLECTION,ITEM_COLLECTION,LOG_COLLECTION,SCHEMA_VERSION,itemId,operationLogId,
    productSnapshot,calculateChanges,beginBatch,detail,finalizeBatch
  });
})();
