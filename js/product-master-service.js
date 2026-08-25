// product-master-service（款號主檔服務）：完整編輯、快速修改、群組批次與匯入共用的原子交易入口。
(function(){
  'use strict';

  const GROUP_LOG_PERMISSION='productionProcessEdit';

  function text(value){ return String(value??'').trim().replace(/\s+/g,' '); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }
  function store(){
    if(!window.PCMSProductMasterStore) throw new Error('Dịch vụ lưu mã hàng chưa sẵn sàng. / 款號主檔儲存核心尚未載入。');
    return window.PCMSProductMasterStore;
  }
  function groupStore(){
    if(!window.PCMSProductGroupStore) throw new Error('Dịch vụ nhóm mã hàng chưa sẵn sàng. / 款號群組資料核心尚未載入。');
    return window.PCMSProductGroupStore;
  }
  function changeStore(){
    if(!window.PCMSProductChangeLogStore) throw new Error('Dịch vụ sổ thay đổi mã hàng chưa sẵn sàng. / 款號修改流水帳尚未載入。');
    return window.PCMSProductChangeLogStore;
  }
  function requireCloud(){
    if(typeof window._runTransaction!=='function'||typeof window._docRef!=='function'){
      throw new Error('Dịch vụ cơ sở dữ liệu chưa sẵn sàng. / 雲端資料庫服務尚未載入。');
    }
  }
  function actor(input={}){
    const uid=text(input.uid||input.userId||window.firebaseAuthUser?.uid);
    const name=text(input.name||input.userName||window.cu?.user||window.cu?.username||uid).slice(0,200);
    if(!uid) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    return {uid,name};
  }
  function reference(item){ return window._docRef(item.collection,item.id); }
  function referenceKey(item){ return `${item.collection}/${item.id}`; }

  async function readPlan(transaction,plan,additional=[],seeded=new Map()){
    const unique=new Map();
    [...(plan.reads||[]),...additional].forEach(item=>{
      if(!seeded.has(referenceKey(item))) unique.set(referenceKey(item),item);
    });
    const items=[...unique.values()];
    const snapshots=await Promise.all(items.map(item=>transaction.get(reference(item))));
    return new Map([...seeded,...items.map((item,index)=>[referenceKey(item),snapshots[index]])]);
  }

  function snapshotFor(snapshots,collection,id){ return snapshots.get(`${collection}/${id}`); }

  function applyPlan(transaction,plan){
    (plan.writes||[]).forEach(write=>transaction.set(reference(write),clone(write.data),write.merge?{merge:true}:undefined));
    (plan.deletes||[]).forEach(item=>transaction.delete(reference(item)));
  }

  function verifyActiveBatch(snapshot,batch,currentActor){
    if(!snapshot?.exists?.()) throw new Error('Không tìm thấy thao tác sổ thay đổi. / 找不到流水帳操作。');
    const remote=snapshot.data();
    if(text(remote?.batchId)!==text(batch?.batchId)||text(remote?.trackingEpoch)!==text(batch?.trackingEpoch)
      ||remote?.status!=='running'||text(remote?.createdByUid)!==currentActor.uid){
      throw new Error('Thao tác sổ thay đổi không còn hiệu lực. / 流水帳操作已失效。');
    }
  }

  async function beginChangeBatch(options={}){
    requireCloud();
    const currentActor=actor(options.actor),now=Number(options.now)||Date.now();
    let prepared;
    await window._runTransaction(async transaction=>{
      const metaReference=window._docRef(store().COLLECTIONS.metadata,'productsMeta');
      const metaSnapshot=await transaction.get(metaReference);
      const meta=metaSnapshot.exists()?metaSnapshot.data():null;
      if(Number(meta?.schemaVersion)!==4||!text(meta?.trackingEpoch)){
        throw new Error('Mốc theo dõi mã hàng chưa được đặt lại. / 款號追蹤起點尚未重設。');
      }
      prepared=changeStore().beginBatch({...options,actor:currentActor,now,trackingEpoch:meta.trackingEpoch});
      const batchReference=window._docRef(changeStore().BATCH_COLLECTION,prepared.batch.batchId);
      const batchSnapshot=await transaction.get(batchReference);
      if(batchSnapshot.exists()) throw new Error('Mã thao tác sổ thay đổi đã tồn tại. / 流水帳操作識別碼已存在。');
      transaction.set(batchReference,prepared.batch);
      transaction.set(window._docRef(changeStore().LOG_COLLECTION,prepared.startLogId),prepared.startLog);
    },{skipDataVersions:true});
    return clone(prepared.batch);
  }

  async function recordBatchItem(batch,input={},options={}){
    const currentActor=actor(options.actor),now=Number(options.now)||Date.now();
    const detail=changeStore().detail({...input,batchId:batch.batchId,trackingEpoch:batch.trackingEpoch,
      mode:batch.mode,actor:currentActor,now});
    await window._runTransaction(async transaction=>{
      const batchReference=window._docRef(changeStore().BATCH_COLLECTION,batch.batchId);
      const itemReference=window._docRef(changeStore().ITEM_COLLECTION,changeStore().itemId(batch.batchId,detail.productId));
      const [batchSnapshot,itemSnapshot]=await Promise.all([transaction.get(batchReference),transaction.get(itemReference)]);
      verifyActiveBatch(batchSnapshot,batch,currentActor);
      if(itemSnapshot.exists()) return;
      transaction.set(itemReference,detail);
    },{skipDataVersions:true});
    return detail;
  }

  async function finalizeChangeBatch(batch,counts,options={}){
    const currentActor=actor(options.actor),now=Number(options.now)||Date.now();
    let result;
    await window._runTransaction(async transaction=>{
      const batchReference=window._docRef(changeStore().BATCH_COLLECTION,batch.batchId);
      const batchSnapshot=await transaction.get(batchReference);
      verifyActiveBatch(batchSnapshot,batch,currentActor);
      result=changeStore().finalizeBatch({batchId:batch.batchId,...batchSnapshot.data()},counts,{...options,actor:currentActor,now});
      transaction.set(batchReference,result.batch);
      transaction.set(window._docRef(changeStore().LOG_COLLECTION,result.resultLogId),result.resultLog);
    },{skipDataVersions:true});
    return clone(result.batch);
  }

  function verifyCodeOwner(snapshot,productId){
    if(!snapshot?.exists?.()) return;
    if(text(snapshot.data()?.productId)!==productId){
      throw new Error('Mã hàng đã được sử dụng bởi sản phẩm khác. / 款號代碼已由另一個款號使用。');
    }
  }

  function publishProducts(products){
    if(!Array.isArray(window.D)) return;
    const saved=(Array.isArray(products)?products:[]).filter(item=>item?.productId);
    saved.forEach(product=>{
      const index=window.D.findIndex(item=>text(item?.productId)===product.productId);
      if(index>=0) window.D[index]=clone(product);
      else window.D.push(clone(product));
    });
    if(!saved.length) return;
    ['rSum','rDet','rExp','rBk'].forEach(name=>window[name]?.());
    window.PCMSFeatures?.invalidateDataScopes?.(['products']);
    window.document?.dispatchEvent?.(new CustomEvent('pcms:productmasterchange',{
      detail:{productId:saved[0].productId,productIds:saved.map(product=>product.productId)}
    }));
  }
  function publishProduct(product){ publishProducts([product]); }

  function conflictError(result){
    const error=new Error('Dữ liệu đã được người khác sửa ở cùng trường. / 相同欄位已由其他人修改。');
    error.code='product-field-conflict';
    error.conflicts=clone(result.conflicts||[]);
    return error;
  }

  async function recordAndFinalizeFailure(batch,item,options,error){
    try{
      await recordBatchItem(batch,item,options);
      await finalizeChangeBatch(batch,{successCount:0,failureCount:1,unprocessedCount:0},options);
    }catch(ledgerError){
      const combined=new Error('Không thể hoàn tất sổ thay đổi mã hàng; vui lòng kiểm tra lại trước khi thao tác tiếp. / 款號修改流水帳未能完整結案，請先檢查後再繼續操作。');
      combined.code='product-change-ledger-incomplete';
      combined.operationError=error;
      combined.ledgerError=ledgerError;
      throw combined;
    }
    throw error;
  }

  async function createProductInBatch(input,options={}){
    requireCloud();
    const currentActor=actor(options.actor);
    const now=Number(options.now)||Date.now();
    const preparedPlan=store().prepareCreate(input,{...options,actor:currentActor,now});
    let plan=preparedPlan;
    await window._runTransaction(async transaction=>{
      const snapshots=await readPlan(transaction,preparedPlan);
      const productSnapshot=snapshotFor(snapshots,store().COLLECTIONS.products,plan.product.productId);
      if(productSnapshot?.exists?.()) throw new Error('Mã định danh sản phẩm đã tồn tại. / 款號固定識別碼已存在。');
      const codeSnapshot=snapshotFor(snapshots,store().COLLECTIONS.codeIndex,plan.codeKey);
      if(codeSnapshot?.exists?.()) throw new Error('Mã hàng đã tồn tại. / 款號代碼已存在。');
      const metaSnapshot=snapshotFor(snapshots,store().COLLECTIONS.metadata,'productsMeta');
      verifyActiveBatch(snapshotFor(snapshots,store().COLLECTIONS.batches,plan.batchId),options.batch,currentActor);
      plan=store().finalizeFreshnessPlan(preparedPlan,metaSnapshot?.exists?.()?metaSnapshot.data():{},null,window.D||[]);
      applyPlan(transaction,plan);
    },{skipDataVersions:true});
    if(options.publish!==false) publishProduct(plan.product);
    return clone(plan.product);
  }

  async function createProduct(input,options={}){
    if(options.batch) return createProductInBatch(input,options);
    const mode=options.mode||(options.action==='productImport'?'import':'single');
    const batch=await beginChangeBatch({...options,mode,targetCount:1,action:options.action||'productCreate',
      writePermissionKey:mode==='import'?'summary':'productionProcessEdit'});
    try{
      const product=await createProductInBatch(input,{...options,batch});
      await finalizeChangeBatch(batch,{successCount:1,failureCount:0,unprocessedCount:0},options);
      return product;
    }catch(error){
      return recordAndFinalizeFailure(batch,{status:'failed',productId:model().fixedId(input?.productId,'product')||`failed_${batch.batchId}`,
        productCode:text(input?.code),before:null,after:null,error:error?.message},options,error);
    }
  }

  async function saveDraftInBatch({base,draft,actor:actorInput,now:time,action='productUpdate',note='',publish=true,batch}={}){
    requireCloud();
    const currentActor=actor(actorInput);
    const now=Number(time)||Date.now();
    const productId=model().fixedId(base?.productId||draft?.productId,'product');
    if(!productId) throw new Error('Thiếu mã định danh sản phẩm. / 缺少款號固定識別碼。');
    let saved;
    await window._runTransaction(async transaction=>{
      const productReference=window._docRef(store().COLLECTIONS.products,productId);
      const productSnapshot=await transaction.get(productReference);
      if(!productSnapshot.exists()) throw new Error('Không tìm thấy mã hàng cần sửa. / 找不到要修改的款號。');
      const current={productId,...productSnapshot.data()};
      const prepared=store().prepareUpdate({base,current,draft,actor:currentActor,now,action,note,batch});
      if(prepared.hasConflicts) throw conflictError(prepared);
      let plan=prepared.plan;
      const additional=(plan.deletes||[]).filter(item=>item.collection===store().COLLECTIONS.codeIndex);
      const seeded=new Map([[`${store().COLLECTIONS.products}/${productId}`,productSnapshot]]);
      const snapshots=await readPlan(transaction,plan,additional,seeded);
      verifyCodeOwner(snapshotFor(snapshots,store().COLLECTIONS.codeIndex,plan.codeKey),productId);
      for(const item of additional){
        const oldIndex=snapshotFor(snapshots,item.collection,item.id);
        if(oldIndex?.exists?.()) verifyCodeOwner(oldIndex,productId);
      }
      const metaSnapshot=snapshotFor(snapshots,store().COLLECTIONS.metadata,'productsMeta');
      verifyActiveBatch(snapshotFor(snapshots,store().COLLECTIONS.batches,plan.batchId),batch,currentActor);
      plan=store().finalizeFreshnessPlan(plan,metaSnapshot?.exists?.()?metaSnapshot.data():{},current,window.D||[]);
      applyPlan(transaction,plan);
      saved=plan.product;
    },{skipDataVersions:true});
    if(publish!==false) publishProduct(saved);
    return clone(saved);
  }

  async function saveDraft(input={}){
    if(input.batch) return saveDraftInBatch(input);
    const batch=await beginChangeBatch({actor:input.actor,now:input.now,mode:'single',targetCount:1,action:input.action||'productUpdate',
      writePermissionKey:'productionProcessEdit'});
    try{
      const product=await saveDraftInBatch({...input,batch});
      await finalizeChangeBatch(batch,{successCount:1,failureCount:0,unprocessedCount:0},{actor:input.actor});
      return product;
    }catch(error){
      return recordAndFinalizeFailure(batch,{status:'failed',productId:text(input?.base?.productId||input?.draft?.productId),
        productCode:text(input?.base?.code||input?.draft?.code),before:input?.base,after:null,error:error?.message},{actor:input.actor},error);
    }
  }

  // replaceImportedProduct（覆蓋單一既有款號）：以預覽時修訂號防止等待確認期間的新修改被蓋掉。
  async function replaceImportedProductInBatch(request={},options={}){
    requireCloud();
    const currentActor=actor(options.actor);
    const now=Number(options.now)||Date.now();
    const expectedProductId=model().fixedId(request?.existing?.productId||request?.productId,'product');
    const expectedRevision=Number(request?.existing?.revision||request?.expectedRevision)||0;
    if(!expectedProductId) throw new Error('Thiếu mã định danh sản phẩm cần ghi đè. / 缺少要覆蓋的款號固定識別碼。');
    let saved;
    await window._runTransaction(async transaction=>{
      const productReference=window._docRef(store().COLLECTIONS.products,expectedProductId);
      const productSnapshot=await transaction.get(productReference);
      if(!productSnapshot.exists()) throw new Error('Không tìm thấy mã hàng cần ghi đè. / 找不到要覆蓋的款號。');
      const current={productId:expectedProductId,...productSnapshot.data()};
      if(expectedRevision&&Number(current.revision)!==expectedRevision){
        const error=new Error('Mã hàng đã thay đổi sau khi xem trước; vui lòng đọc lại tệp. / 款號在預覽後已被修改，請重新讀取檔案。');
        error.code='product-import-preview-stale';
        throw error;
      }
      let plan=store().prepareImportReplacement({
        current,
        incoming:request.incoming,
        actor:currentActor,
        now,
        note:text(options.fileName||options.note),
        tokenProvider:options.tokenProvider,
        batch:options.batch
      }).plan;
      const additional=(plan.deletes||[]).filter(item=>item.collection===store().COLLECTIONS.codeIndex);
      const seeded=new Map([[`${store().COLLECTIONS.products}/${expectedProductId}`,productSnapshot]]);
      const snapshots=await readPlan(transaction,plan,additional,seeded);
      verifyCodeOwner(snapshotFor(snapshots,store().COLLECTIONS.codeIndex,plan.codeKey),expectedProductId);
      for(const item of additional){
        const oldIndex=snapshotFor(snapshots,item.collection,item.id);
        if(oldIndex?.exists?.()) verifyCodeOwner(oldIndex,expectedProductId);
      }
      const metaSnapshot=snapshotFor(snapshots,store().COLLECTIONS.metadata,'productsMeta');
      verifyActiveBatch(snapshotFor(snapshots,store().COLLECTIONS.batches,plan.batchId),options.batch,currentActor);
      plan=store().finalizeFreshnessPlan(plan,metaSnapshot?.exists?.()?metaSnapshot.data():{},current,window.D||[]);
      applyPlan(transaction,plan);
      saved=plan.product;
    },{skipDataVersions:true});
    if(options.publish!==false) publishProduct(saved);
    return clone(saved);
  }

  async function replaceImportedProduct(request={},options={}){
    if(options.batch) return replaceImportedProductInBatch(request,options);
    const batch=await beginChangeBatch({...options,mode:'import',targetCount:1,action:'productImport',writePermissionKey:'summary'});
    try{
      const product=await replaceImportedProductInBatch(request,{...options,batch});
      await finalizeChangeBatch(batch,{successCount:1,failureCount:0,unprocessedCount:0},options);
      return product;
    }catch(error){
      return recordAndFinalizeFailure(batch,{status:'failed',productId:text(request?.existing?.productId||request?.productId),
        productCode:text(request?.incoming?.code||request?.existing?.code),before:request?.existing,after:null,error:error?.message},options,error);
    }
  }

  function draftWithField(product,{field,value,processId=''}){
    const draft=clone(product);
    if(processId){
      const target=model().fixedId(processId,'process');
      const operation=draft.ops?.find(item=>model().fixedId(item?.processId,'process')===target);
      if(!operation) throw new Error('Không tìm thấy công đoạn cần sửa. / 找不到要修改的工序。');
      const processFields={processNo:'no',processCategory:'category',processNameZh:'zh',processNameVi:'vi',processSeconds:'sec'};
      const actualField=processFields[field]||field;
      if(!store().PROCESS_FIELDS.includes(actualField)) throw new Error('Trường công đoạn không được phép sửa. / 不允許修改此工序欄位。');
      if(field==='processNo') draft.ops=model().moveOperation(draft.ops,target,value);
      else operation[actualField]=value;
    }else{
      if(!store().EDITABLE_PRODUCT_FIELDS.includes(field)) throw new Error('Trường mã hàng không được phép sửa. / 不允許修改此款號欄位。');
      draft[field]=value;
    }
    return draft;
  }

  async function saveField(input={}){
    const base=clone(input.product);
    const draft=draftWithField(base,input);
    return saveDraft({base,draft,actor:input.actor,action:'productQuickEdit',note:input.note});
  }

  // saveManyDrafts（群組批次儲存）：每個 Product 各自原子成功，失敗項目可單獨重試。
  async function saveManyDrafts(requests,options={}){
    const results=[];
    const rows=Array.isArray(requests)?requests:[];
    if(!rows.length) return {results,successes:[],failures:[],batch:null};
    const batch=options.batch||await beginChangeBatch({...options,mode:rows.length>1?'group':'single',targetCount:rows.length,
      action:rows.length>1?'productGroupQuickEdit':text(rows[0]?.action)||'productUpdate',
      writePermissionKey:'productionProcessEdit'});
    for(let index=0;index<rows.length;index+=1){
      const request=rows[index];
      await options.onProgress?.({phase:'start',index,completed:index,total:rows.length,productId:text(request?.base?.productId)});
      try{
        const product=await saveDraftInBatch({...request,actor:options.actor||request.actor,
          action:request.action||'productGroupQuickEdit',publish:false,batch});
        results.push({ok:true,productId:product.productId,product});
        await options.onProgress?.({phase:'complete',index,completed:index+1,total:rows.length,productId:product.productId,product});
      }catch(error){
        results.push({ok:false,productId:text(request?.base?.productId||request?.draft?.productId),error});
        await recordBatchItem(batch,{status:'failed',productId:text(request?.base?.productId||request?.draft?.productId),
          productCode:text(request?.base?.code||request?.draft?.code),before:request?.base,after:null,error:error?.message},
          {actor:options.actor||request.actor});
        await options.onProgress?.({phase:'failed',index,completed:index+1,total:rows.length,productId:text(request?.base?.productId),error});
      }
    }
    const successes=results.filter(item=>item.ok);
    if(successes.length&&options.publish!==false) publishProducts(successes.map(item=>item.product));
    const failures=results.filter(item=>!item.ok);
    if(!options.batch) await finalizeChangeBatch(batch,{successCount:successes.length,failureCount:failures.length,unprocessedCount:0},options);
    return {results,successes,failures,batch};
  }

  async function importProducts(products,options={}){
    const results=[];
    const rows=Array.isArray(products)?products:[];
    if(!rows.length) return {results,successes:[],failures:[],remaining:0,batch:null};
    const batch=options.batch||await beginChangeBatch({...options,mode:'import',targetCount:rows.length,action:'productImport',writePermissionKey:'summary'});
    for(let index=0;index<rows.length;index+=1){
      const request=rows[index]||{};
      const mode=request.mode==='replace'?'replace':'create';
      const item=request.incoming||request.product||request;
      await options.onProgress?.({phase:'start',index,completed:index,total:rows.length,mode,code:text(item?.code)});
      try{
        const commonOptions={
          actor:options.actor,action:'productImport',note:text(options.fileName||options.note),
          sourceKey:options.sourceKeys?.[index],processSourceKeys:options.processSourceKeys?.[index],
          tokenProvider:options.tokenProvider,publish:false,batch
        };
        const product=mode==='replace'
          ?await replaceImportedProductInBatch({...request,incoming:item},commonOptions)
          :await createProductInBatch(item,commonOptions);
        const result={ok:true,index,mode,code:text(item?.code),productId:product.productId,product};
        results.push(result);
        await options.onProgress?.({phase:'complete',index,completed:index+1,total:rows.length,mode,code:result.code,product});
      }catch(error){
        const failed={ok:false,index,mode,code:text(item?.code),error};
        results.push(failed);
        await recordBatchItem(batch,{status:'failed',productId:text(request?.existing?.productId||request?.productId)||`failed_${index+1}`,
          productCode:text(item?.code),before:request?.existing||null,after:null,error:error?.message},options);
        await options.onProgress?.({phase:'failed',index,completed:index,total:rows.length,mode,code:failed.code,error});
        if(options.stopOnFailure!==false) break;
      }
    }
    const successes=results.filter(item=>item.ok);
    const failures=results.filter(item=>!item.ok);
    const remaining=Math.max(0,rows.length-results.length);
    if(remaining){
      for(let index=results.length;index<rows.length;index+=1){
        const request=rows[index]||{},item=request.incoming||request.product||request;
        await recordBatchItem(batch,{status:'unprocessed',productId:text(request?.existing?.productId||request?.productId)||`unprocessed_${index+1}`,
          productCode:text(item?.code),before:request?.existing||null,after:null,error:'not-processed-after-failure'},options);
      }
    }
    publishProducts(successes.map(item=>item.product));
    if(!options.batch) await finalizeChangeBatch(batch,{successCount:successes.length,failureCount:failures.length,
      unprocessedCount:remaining},options);
    return {results,successes,failures,remaining,batch};
  }

  function groupLog(action,group,currentActor,now,detailCount,note=''){
    const logId=`${String(now).padStart(16,'0')}__${group.groupId}__${action}`;
    return {logId,data:{
      permissionKey:GROUP_LOG_PERMISSION,feature:'productionProcessEdit',action,status:'success',
      targetType:'productGroup',targetId:group.groupId,itemCount:group.memberProductIds.length,detailCount,
      note:text(note||`${group.groupId} · ${group.name}`).slice(0,500),createdAt:now,
      createdByUid:currentActor.uid,createdBy:currentActor.name,operationLogId:logId,schemaVersion:2
    }};
  }

  async function createGroup(input,options={}){
    requireCloud();
    const currentActor=actor(options.actor);
    const now=Number(options.now)||Date.now();
    const group=groupStore().normalizeGroup(input,options);
    const log=groupLog('productGroupCreate',group,currentActor,now,group.memberProductIds.length);
    await window._runTransaction(async transaction=>{
      const groupReference=window._docRef(groupStore().COLLECTION,group.groupId);
      const memberReferences=group.memberProductIds.map(productId=>window._docRef(groupStore().MEMBER_COLLECTION,productId));
      const snapshots=await Promise.all([groupReference,...memberReferences].map(item=>transaction.get(item)));
      if(snapshots[0].exists()) throw new Error('Mã định danh nhóm đã tồn tại. / 群組固定識別碼已存在。');
      if(snapshots.slice(1).some(snapshot=>snapshot.exists())) throw new Error('Có mã hàng đã thuộc nhóm khác. / 有款號已屬於其他群組。');
      transaction.set(groupReference,{...group,revision:1,createdAt:now,createdByUid:currentActor.uid,createdBy:currentActor.name,
        updatedAt:now,updatedByUid:currentActor.uid,operationLogId:log.logId});
      groupStore().memberIndexDocuments(group).forEach(item=>transaction.set(window._docRef(groupStore().MEMBER_COLLECTION,item.id),{
        ...item.data,createdAt:now,createdByUid:currentActor.uid,operationLogId:log.logId
      }));
      transaction.set(window._docRef(store().COLLECTIONS.logs,log.logId),log.data);
    },{skipDataVersions:true});
    return clone({...group,revision:1,createdAt:now,createdByUid:currentActor.uid,createdBy:currentActor.name,
      updatedAt:now,updatedByUid:currentActor.uid,operationLogId:log.logId});
  }

  function sameGroupState(leftInput,rightInput){
    const left=groupStore().normalizeGroup(leftInput);
    const right=groupStore().normalizeGroup(rightInput);
    return left.name===right.name&&left.active===right.active
      &&left.memberProductIds.join('|')===right.memberProductIds.join('|')
      &&left.revision===right.revision;
  }

  // updateGroup（更新群組）：改名或停用不會改變款號、工序固定身分，也不提供工序合併。
  async function updateGroup(currentInput,patch={},options={}){
    requireCloud();
    const currentActor=actor(options.actor);
    const now=Number(options.now)||Date.now();
    const current=groupStore().normalizeGroup(currentInput);
    const next=groupStore().normalizeGroup({...currentInput,...patch,groupId:current.groupId,memberProductIds:current.memberProductIds});
    const nextRevision=current.revision+1;
    const saved={...next,revision:nextRevision,updatedAt:now,updatedByUid:currentActor.uid};
    const action=current.active!==next.active?'productGroupStateUpdate':'productGroupRename';
    const log=groupLog(action,saved,currentActor,now,current.active!==next.active?current.memberProductIds.length:1);
    await window._runTransaction(async transaction=>{
      const groupReference=window._docRef(groupStore().COLLECTION,current.groupId);
      const memberReferences=current.memberProductIds.map(productId=>window._docRef(groupStore().MEMBER_COLLECTION,productId));
      const snapshots=await Promise.all([groupReference,...memberReferences].map(item=>transaction.get(item)));
      if(!snapshots[0].exists()) throw new Error('Không tìm thấy nhóm cần sửa. / 找不到要修改的群組。');
      const remote={groupId:current.groupId,...snapshots[0].data()};
      if(!sameGroupState(remote,currentInput)) throw new Error('Nhóm đã được người khác cập nhật. / 群組已由其他人更新。');
      if(!current.active&&next.active){
        snapshots.slice(1).forEach(snapshot=>{
          if(snapshot.exists()&&text(snapshot.data()?.groupId)!==current.groupId){
            throw new Error('Có mã hàng đã thuộc nhóm khác. / 有款號已屬於其他群組。');
          }
        });
      }
      transaction.set(groupReference,{name:saved.name,active:saved.active,revision:saved.revision,
        updatedAt:now,updatedByUid:currentActor.uid,operationLogId:log.logId},{merge:true});
      if(current.active&&!next.active){
        current.memberProductIds.forEach((productId,index)=>{
          const snapshot=snapshots[index+1];
          if(!snapshot.exists()||text(snapshot.data()?.groupId)===current.groupId) transaction.delete(memberReferences[index]);
        });
      }else if(!current.active&&next.active){
        current.memberProductIds.forEach(productId=>transaction.set(window._docRef(groupStore().MEMBER_COLLECTION,productId),{
          productId,groupId:current.groupId,createdAt:now,createdByUid:currentActor.uid,operationLogId:log.logId
        }));
      }
      transaction.set(window._docRef(store().COLLECTIONS.logs,log.logId),log.data);
    },{skipDataVersions:true});
    return clone({...saved,operationLogId:log.logId});
  }

  async function updateGroupMembers(currentInput,nextProductIds,options={}){
    requireCloud();
    const currentActor=actor(options.actor);
    const now=Number(options.now)||Date.now();
    const change=groupStore().membershipChange(currentInput,nextProductIds);
    const allProductIds=[...new Set([...change.group.memberProductIds,...change.removed])];
    const log=groupLog('productGroupMembersUpdate',change.group,currentActor,now,change.added.length+change.removed.length);
    await window._runTransaction(async transaction=>{
      const groupReference=window._docRef(groupStore().COLLECTION,change.group.groupId);
      const memberReferences=allProductIds.map(productId=>window._docRef(groupStore().MEMBER_COLLECTION,productId));
      const snapshots=await Promise.all([groupReference,...memberReferences].map(item=>transaction.get(item)));
      if(!snapshots[0].exists()) throw new Error('Không tìm thấy nhóm cần sửa. / 找不到要修改的群組。');
      const remote=groupStore().normalizeGroup({groupId:change.group.groupId,...snapshots[0].data()});
      if(!sameGroupState(remote,currentInput)){
        throw new Error('Nhóm đã được người khác cập nhật. / 群組已由其他人更新。');
      }
      allProductIds.forEach((productId,index)=>{
        const snapshot=snapshots[index+1];
        if(snapshot.exists()&&text(snapshot.data()?.groupId)!==change.group.groupId){
          throw new Error('Có mã hàng đã thuộc nhóm khác. / 有款號已屬於其他群組。');
        }
      });
      transaction.set(groupReference,{memberProductIds:change.group.memberProductIds,revision:change.group.revision+1,
        updatedAt:now,updatedByUid:currentActor.uid,operationLogId:log.logId},{merge:true});
      change.added.forEach(productId=>transaction.set(window._docRef(groupStore().MEMBER_COLLECTION,productId),{
        productId,groupId:change.group.groupId,createdAt:now,createdByUid:currentActor.uid,operationLogId:log.logId
      }));
      change.removed.forEach(productId=>transaction.delete(window._docRef(groupStore().MEMBER_COLLECTION,productId)));
      transaction.set(window._docRef(store().COLLECTIONS.logs,log.logId),log.data);
    },{skipDataVersions:true});
    return {...change,group:{...change.group,revision:change.group.revision+1,updatedAt:now,
      updatedByUid:currentActor.uid,operationLogId:log.logId}};
  }

  window.PCMSProductMasterService=Object.freeze({
    createProduct,saveDraft,saveField,saveManyDrafts,replaceImportedProduct,importProducts,draftWithField,
    createGroup,updateGroup,updateGroupMembers,beginChangeBatch,finalizeChangeBatch
  });
})();
