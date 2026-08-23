// product-master-store（款號主檔儲存核心）：建立固定身分、驗證資料並產生單一原子儲存計畫。
(function(){
  'use strict';

  const COLLECTIONS=Object.freeze({
    products:'products',codeIndex:'productCodeIndex',history:'productHistory',
    metadata:'system',logs:'operationLogs',legacyMappings:'productMasterLegacyMappings',
    migrationExceptions:'productMasterMigrationExceptions'
  });
  const PRODUCT_FIELDS=Object.freeze(['code','client','zh','vi','sz','active']);
  const PROCESS_FIELDS=Object.freeze(['no','sortOrder','category','zh','vi','sec','active']);
  const ALLOWED_CATEGORIES=new Set(['BL','SX','QC','DG']);

  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }
  function text(value){ return String(value??'').trim().replace(/\s+/g,' '); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function same(left,right){ return JSON.stringify(left)===JSON.stringify(right); }
  function positiveInteger(value){ return Number.isInteger(Number(value))&&Number(value)>0; }

  function actorData(actor={}){
    const uid=text(actor.uid||actor.userId||window.firebaseAuthUser?.uid);
    const name=text(actor.name||actor.userName||window.cu?.user||window.cu?.username||uid).slice(0,200);
    if(!uid) throw new Error('Phiên đăng nhập không hợp lệ. / 登入狀態無效。');
    return {uid,name};
  }

  function idFor(kind,{sourceKey='',tokenProvider}={}){
    return sourceKey
      ?model().deterministicLegacyId(kind,sourceKey)
      :model().createPermanentId(kind,tokenProvider);
  }

  function normalizeAndValidateOperation(operation,index,{sourceKey='',tokenProvider}={}){
    const normalized=model().normalizeOperation(operation);
    const processId=model().fixedId(operation?.processId,'process')
      ||idFor('process',{sourceKey,tokenProvider});
    const sortOrder=positiveInteger(normalized.sortOrder)?Number(normalized.sortOrder):index+1;
    if(!normalized.no) throw new Error(`Số công đoạn ở dòng ${index+1} không hợp lệ. / 第 ${index+1} 列工序號不正確。`);
    if(!ALLOWED_CATEGORIES.has(normalized.category)) throw new Error(`Phân loại công đoạn ${normalized.no} không hợp lệ. / 工序 ${normalized.no} 的分類不正確。`);
    if(!normalized.vi||normalized.vi.length>200||normalized.zh.length>200) throw new Error(`Tên công đoạn ${normalized.no} không hợp lệ. / 工序 ${normalized.no} 的名稱不正確。`);
    if(!Number.isInteger(normalized.sec)||normalized.sec<=0||normalized.sec>86400) throw new Error(`Giây công đoạn ${normalized.no} phải là số nguyên hợp lệ. / 工序 ${normalized.no} 秒數必須是有效整數。`);
    return {...normalized,processId,sortOrder,active:operation?.active!==false};
  }

  function normalizeAndValidateProduct(input={},options={}){
    const normalized=model().normalizeProduct(input);
    const productId=model().fixedId(input.productId,'product')
      ||idFor('product',{sourceKey:options.sourceKey,tokenProvider:options.tokenProvider});
    if(!normalized.code) throw new Error('Mã hàng không được để trống. / 款號代碼不得空白。');
    if(!normalized.client||normalized.client.length>200) throw new Error('Khách hàng của mã hàng không hợp lệ. / 款號客戶不正確。');
    if(!normalized.vi||normalized.vi.length>200||normalized.zh.length>200) throw new Error('Tên sản phẩm không hợp lệ. / 款號品名不正確。');
    if(normalized.sz.length>200) throw new Error('Kích thước không được vượt quá 200 ký tự. / 尺寸不得超過200字。');
    const operations=(Array.isArray(input.ops)?input.ops:[]).map((operation,index)=>{
      const processSource=options.processSourceKeys?.[index]
        ||(options.sourceKey?`${options.sourceKey}\u001fprocess\u001f${text(operation?.legacySourceKey||operation?.no||index+1)}`:'');
      return normalizeAndValidateOperation(operation,index,{sourceKey:processSource,tokenProvider:options.tokenProvider});
    });
    if(!operations.length||operations.length>99) throw new Error('Mỗi mã hàng phải có từ 1 đến 99 công đoạn. / 每個款號必須有1至99道工序。');
    const processIds=new Set();
    const processNumbers=new Set();
    const sortOrders=new Set();
    operations.forEach(operation=>{
      if(processIds.has(operation.processId)) throw new Error('Mã định danh công đoạn bị trùng. / 工序固定識別碼重複。');
      if(processNumbers.has(operation.no)) throw new Error(`Số công đoạn ${operation.no} bị trùng. / 工序號 ${operation.no} 重複。`);
      if(sortOrders.has(operation.sortOrder)) throw new Error(`Thứ tự công đoạn ${operation.sortOrder} bị trùng. / 工序排序 ${operation.sortOrder} 重複。`);
      processIds.add(operation.processId);
      processNumbers.add(operation.no);
      sortOrders.add(operation.sortOrder);
    });
    operations.sort((left,right)=>left.sortOrder-right.sortOrder||Number(left.no)-Number(right.no));
    return {
      productId,code:normalized.code,client:normalized.client,zh:normalized.zh,vi:normalized.vi,sz:normalized.sz,
      ops:operations,processIds:operations.map(operation=>operation.processId),active:input.active!==false
    };
  }

  function fieldMerge(path,field,base,current,draft,target,conflicts){
    const baseValue=base?.[field];
    const currentValue=current?.[field];
    const draftValue=draft?.[field];
    const localChanged=!same(baseValue,draftValue);
    const remoteChanged=!same(baseValue,currentValue);
    if(localChanged&&remoteChanged&&!same(currentValue,draftValue)){
      conflicts.push({path:`${path}${field}`,baseValue:clone(baseValue),currentValue:clone(currentValue),draftValue:clone(draftValue)});
      return;
    }
    if(localChanged) target[field]=clone(draftValue);
  }

  // mergeProductDraft（合併款號草稿）：不同欄位自動合併，同欄位同時異動才回報衝突。
  function mergeProductDraft(baseInput,currentInput,draftInput){
    const base=normalizeAndValidateProduct(baseInput,{tokenProvider:'baseidentity0000000000000000'});
    const current=normalizeAndValidateProduct(currentInput,{tokenProvider:'currentidentity000000000000'});
    const draft=normalizeAndValidateProduct(draftInput,{tokenProvider:'draftidentity00000000000000'});
    if(base.productId!==current.productId||base.productId!==draft.productId) throw new Error('Mã định danh sản phẩm đã thay đổi. / 款號固定識別碼已被更換。');
    const merged=clone(current);
    const conflicts=[];
    PRODUCT_FIELDS.forEach(field=>fieldMerge('product.',field,base,current,draft,merged,conflicts));
    const baseById=new Map(base.ops.map(item=>[item.processId,item]));
    const currentById=new Map(current.ops.map(item=>[item.processId,item]));
    const draftById=new Map(draft.ops.map(item=>[item.processId,item]));
    const mergedById=new Map(current.ops.map(item=>[item.processId,clone(item)]));
    const processIds=new Set([...baseById.keys(),...currentById.keys(),...draftById.keys()]);
    processIds.forEach(processId=>{
      const before=baseById.get(processId);
      const remote=currentById.get(processId);
      const local=draftById.get(processId);
      if(!before){
        if(local&&!remote) mergedById.set(processId,clone(local));
        else if(local&&remote&&!same(local,remote)) conflicts.push({path:`process.${processId}`,baseValue:null,currentValue:clone(remote),draftValue:clone(local)});
        return;
      }
      if(!local){
        conflicts.push({path:`process.${processId}`,baseValue:clone(before),currentValue:clone(remote),draftValue:null,reason:'process-removal-requires-reference-check'});
        return;
      }
      if(!remote){
        conflicts.push({path:`process.${processId}`,baseValue:clone(before),currentValue:null,draftValue:clone(local),reason:'process-missing'});
        return;
      }
      const target=mergedById.get(processId);
      PROCESS_FIELDS.forEach(field=>fieldMerge(`process.${processId}.`,field,before,remote,local,target,conflicts));
    });
    merged.ops=[...mergedById.values()].sort((left,right)=>left.sortOrder-right.sortOrder||Number(left.no)-Number(right.no));
    return {merged,conflicts,hasConflicts:conflicts.length>0};
  }

  function operationLog({action,product,actor,now,detailCount=0,note='',codeKey,historyId}){
    const importing=action==='productImport';
    return {
      permissionKey:importing?'summary':'productionProcessEdit',feature:importing?'products':'productionProcessEdit',
      action:importing?'productImport':'productMasterUpdate',status:'success',
      targetType:'product',targetId:product.productId,itemCount:1,detailCount,
      targetRevision:product.revision,targetCodeKey:codeKey,targetHistoryId:historyId,
      freshnessSequence:0,schemaVersion:3,
      note:text(note||`${product.productId} · ${product.code}`).slice(0,500),createdAt:now,
      createdByUid:actor.uid,createdBy:actor.name
    };
  }

  function documentPlan(product,{actor,now,action,previousCodeKey='',note=''}){
    const codeKey=model().safeProductCodeKey(product.code);
    const revision=Number(product.revision)||1;
    const versionId=`${product.productId}__${String(revision).padStart(8,'0')}`;
    const mutationId=`${String(now).padStart(16,'0')}__${product.productId}__${String(revision).padStart(8,'0')}`;
    const logId=`${mutationId}__${action}`;
    const savedProduct={...clone(product),codeKey,historyId:versionId,operationLogId:logId};
    const history={...clone(savedProduct),versionId,productRevision:revision,createdAt:now,createdByUid:actor.uid,createdBy:actor.name};
    // 款號代碼未改時沿用既有索引，避免增加交易寫入與安全規則運算量。
    const codeIndexWrites=!previousCodeKey||previousCodeKey!==codeKey?[{
      collection:COLLECTIONS.codeIndex,id:codeKey,
      data:{codeKey,code:product.code,productId:product.productId,operationLogId:logId,updatedAt:now,updatedByUid:actor.uid}
    }]:[];
    return {
      atomic:true,
      reads:[
        {collection:COLLECTIONS.products,id:product.productId},
        {collection:COLLECTIONS.codeIndex,id:codeKey},
        {collection:COLLECTIONS.metadata,id:'productsMeta'}
      ],
      writes:[
        {collection:COLLECTIONS.products,id:product.productId,data:clone(savedProduct)},
        ...codeIndexWrites,
        {collection:COLLECTIONS.history,id:versionId,data:history},
        {collection:COLLECTIONS.metadata,id:'productsMeta',data:{updatedAt:now,updatedByUid:actor.uid,lastProductId:product.productId,lastRevision:revision,operationLogId:logId},merge:true},
        {collection:COLLECTIONS.logs,id:logId,
          data:operationLog({action,product,actor,now,detailCount:product.ops.length,note,codeKey,historyId:versionId})}
      ],
      deletes:previousCodeKey&&previousCodeKey!==codeKey?[{collection:COLLECTIONS.codeIndex,id:previousCodeKey}]:[],
      product:clone(savedProduct),codeKey,versionId,logId
    };
  }

  function legacyMetadata(data={}){
    try{ return data?.data?JSON.parse(data.data):{}; }catch(_error){ return {}; }
  }
  function productCounts(items){
    const products=Array.isArray(items)?items:[];
    return {productCount:products.length,opCount:products.reduce((sum,item)=>sum+(Array.isArray(item?.ops)?item.ops.length:0),0)};
  }

  // finalizeFreshnessPlan（完成款號新舊版本計畫）：交易讀到最新版本後才分配連續序號，避免多電腦漏讀變更。
  function finalizeFreshnessPlan(planInput,metadataInput={},previousProduct=null,currentProducts=[]){
    const plan=clone(planInput);
    const direct=Number(metadataInput?.schemaVersion)===3?metadataInput:legacyMetadata(metadataInput);
    const fallback=productCounts(currentProducts);
    const baseProductCount=Number.isInteger(Number(direct.productCount))?Number(direct.productCount):fallback.productCount;
    const baseOpCount=Number.isInteger(Number(direct.opCount))?Number(direct.opCount):fallback.opCount;
    const sequence=Math.max(0,Math.trunc(Number(direct.changeSequence)||0))+1;
    const previousOps=Array.isArray(previousProduct?.ops)?previousProduct.ops.length:0;
    const productDelta=previousProduct?0:1;
    const opDelta=plan.product.ops.length-previousOps;
    const version=`pmv3-${String(plan.product.updatedAt)}-${String(sequence)}-${plan.product.productId.slice(-12)}`;
    const metaData={version,changeSequence:sequence,productCount:baseProductCount+productDelta,
      opCount:baseOpCount+opDelta,lastProductId:plan.product.productId,
      lastRevision:plan.product.revision,updatedAt:plan.product.updatedAt,updatedByUid:plan.product.updatedByUid,
      operationLogId:plan.logId,schemaVersion:3};
    plan.writes=plan.writes.map(write=>{
      if(write.collection===COLLECTIONS.metadata&&write.id==='productsMeta') return {...write,data:metaData,merge:false};
      if(write.collection===COLLECTIONS.logs&&write.id===plan.logId){
        return {...write,data:{...write.data,freshnessSequence:sequence}};
      }
      return write;
    });
    plan.freshness={version,sequence,metaData};
    return plan;
  }

  function prepareCreate(input,options={}){
    const actor=actorData(options.actor);
    const now=Number(options.now)||Date.now();
    const normalized=normalizeAndValidateProduct(input,options);
    const product={...normalized,revision:1,createdAt:now,createdByUid:actor.uid,createdBy:actor.name,
      updatedAt:now,updatedByUid:actor.uid,updatedBy:actor.name};
    return documentPlan(product,{actor,now,action:text(options.action)||'productCreate',note:options.note});
  }

  function prepareUpdate({base,current,draft,actor:actorInput,now:time,action='productUpdate',note=''}={}){
    const actor=actorData(actorInput);
    const now=Number(time)||Date.now();
    const result=mergeProductDraft(base,current,draft);
    if(result.hasConflicts) return {...result,plan:null};
    const normalized=normalizeAndValidateProduct(result.merged);
    const product={...normalized,revision:(Number(current?.revision)||1)+1,
      createdAt:Number(current?.createdAt)||Number(base?.createdAt)||now,
      createdByUid:text(current?.createdByUid||base?.createdByUid),createdBy:text(current?.createdBy||base?.createdBy),
      updatedAt:now,updatedByUid:actor.uid,updatedBy:actor.name};
    const previousCodeKey=model().safeProductCodeKey(current.code);
    return {...result,merged:product,plan:documentPlan(product,{actor,now,action:text(action)||'productUpdate',previousCodeKey,note})};
  }

  window.PCMSProductMasterStore=Object.freeze({
    COLLECTIONS,PRODUCT_FIELDS,PROCESS_FIELDS,normalizeAndValidateProduct,mergeProductDraft,prepareCreate,prepareUpdate,finalizeFreshnessPlan
  });
})();
