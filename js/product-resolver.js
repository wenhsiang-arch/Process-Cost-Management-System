// product-resolver（款號解析器）：以固定識別碼批次取得目前款號主檔，未鎖定資料不使用文字快照備援。
(function(){
  'use strict';

  function text(value){ return String(value??'').trim(); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }

  function collectProductIds(rows){
    return [...new Set((Array.isArray(rows)?rows:[]).map(row=>model().fixedId(row?.productId,'product')).filter(Boolean))].sort();
  }

  function buildCatalog(products){
    const productsById=new Map();
    const processOwners=new Map();
    (Array.isArray(products)?products:[]).forEach(source=>{
      const product=model().normalizeProduct(source);
      const productId=model().fixedId(source?.productId,'product');
      if(!productId) throw new Error('Mã hàng thiếu mã định danh cố định. / 款號缺少固定識別碼。');
      if(productsById.has(productId)) throw new Error(`Mã định danh sản phẩm ${productId} bị trùng. / 款號固定識別碼 ${productId} 重複。`);
      const normalized={...clone(source),...product,productId};
      normalized.ops=(source.ops||[]).map(model().normalizeOperation);
      normalized.ops.forEach(operation=>{
        const processId=model().fixedId(operation.processId,'process');
        if(!processId) throw new Error(`Mã hàng ${product.code} có công đoạn thiếu mã định danh. / 款號 ${product.code} 有工序缺少固定識別碼。`);
        if(processOwners.has(processId)) throw new Error(`Mã định danh công đoạn ${processId} bị trùng. / 工序固定識別碼 ${processId} 重複。`);
        operation.processId=processId;
        processOwners.set(processId,productId);
      });
      productsById.set(productId,normalized);
    });
    return {productsById,processOwners};
  }

  // resolveReference（解析固定關聯）：找不到目前正式工序時回報例外，不退回舊款號或訂單快照。
  function legacyKey(productId,processId){ return `${productId}__${processId}`; }
  function buildLegacyCatalog(items=[]){
    const result=new Map();
    (Array.isArray(items)?items:[]).forEach(item=>{
      const productId=model().fixedId(item?.productId,'product');
      const processId=model().fixedId(item?.processId,'process');
      if(!productId||!processId) return;
      const process=model().normalizeOperation({...item,processId,active:true});
      if(!process.no||!process.vi||!(Number(process.sec)>0)) return;
      result.set(legacyKey(productId,processId),{...process,processId,active:true,legacy:true});
    });
    return result;
  }

  function resolveReference(reference,catalog,legacyProcesses=new Map()){
    const productId=model().fixedId(reference?.productId,'product');
    const processId=model().fixedId(reference?.processId,'process');
    if(!productId) return {ok:false,code:'missing-product-id',reference:clone(reference)};
    const product=catalog.productsById.get(productId);
    if(!product) return {ok:false,code:'product-not-found',productId,reference:clone(reference)};
    if(!processId) return {ok:true,product:clone(product),process:null};
    const owner=catalog.processOwners.get(processId);
    if(!owner){
      const legacy=legacyProcesses.get(legacyKey(productId,processId));
      if(legacy) return {ok:true,product:clone(product),process:clone(legacy),legacy:true};
      return {ok:false,code:'process-not-found',productId,processId,reference:clone(reference)};
    }
    if(owner!==productId) return {ok:false,code:'process-product-mismatch',productId,processId,reference:clone(reference)};
    const process=product.ops.find(item=>item.processId===processId);
    if(!process||process.active===false) return {ok:false,code:'process-inactive',productId,processId,reference:clone(reference)};
    return {ok:true,product:clone(product),process:clone(process)};
  }

  function resolvedDisplay(reference,resolved,efficiencyCore,workSeconds){
    const product=resolved.product;
    const process=resolved.process;
    return {
      productId:product.productId,productCode:product.code,productClient:product.client,
      productNameZh:product.zh,productNameVi:product.vi,size:product.sz,
      processId:process?.processId||'',processNo:process?.no||'',processSortOrder:process?.sortOrder||null,
      processCategory:process?.category||'',processNameZh:process?.zh||'',processNameVi:process?.vi||'',
      processSeconds:process?.sec||null,
      hourlyCapacity:process&&efficiencyCore?efficiencyCore.hourlyCapacity(process.sec,workSeconds):null,
      orderId:text(reference?.orderId),orderItemId:text(reference?.orderItemId)
    };
  }

  function resolveRows(rows,products,options={}){
    const catalog=buildCatalog(products);
    const legacyProcesses=options.legacyProcesses instanceof Map
      ?options.legacyProcesses
      :buildLegacyCatalog(options.legacyProcesses||[]);
    const resolvedRows=[];
    const exceptions=[];
    (Array.isArray(rows)?rows:[]).forEach((row,index)=>{
      const resolved=resolveReference(row,catalog,legacyProcesses);
      if(!resolved.ok){ exceptions.push({index,...resolved}); return; }
      resolvedRows.push({source:clone(row),resolved,display:resolvedDisplay(row,resolved,options.efficiencyCore,options.workSeconds)});
    });
    return {rows:resolvedRows,exceptions,catalog};
  }

  // create（建立解析工作階段）：相同批次共用 Promise，且一次先去重全部 productId。
  function create({loadProductsByIds,loadLegacyProcessesByReferences,efficiencyCore,workSeconds}={}){
    if(typeof loadProductsByIds!=='function') throw new Error('Thiếu phương thức tải dữ liệu mã hàng. / 缺少款號資料載入方法。');
    const cache=new Map();
    const inflight=new Map();
    const legacyCache=new Map();
    const legacyInflight=new Map();
    const legacyLoader=typeof loadLegacyProcessesByReferences==='function'
      ?loadLegacyProcessesByReferences
      :(references=>window.PCMSProductLegacyProcessStore?.loadByReferences?.(references)||Promise.resolve([]));
    async function load(productIds){
      const missing=[...new Set(productIds)].filter(productId=>!cache.has(productId)).sort();
      if(!missing.length) return missing;
      const key=missing.join('|');
      if(!inflight.has(key)){
        inflight.set(key,(async()=>{
          const products=await loadProductsByIds(missing.slice());
          buildCatalog(products);
          products.forEach(product=>cache.set(model().fixedId(product.productId,'product'),clone(product)));
        })().finally(()=>inflight.delete(key)));
      }
      await inflight.get(key);
      return missing;
    }
    async function loadLegacy(references){
      const missing=(Array.isArray(references)?references:[]).filter(reference=>{
        const productId=model().fixedId(reference?.productId,'product');
        const processId=model().fixedId(reference?.processId,'process');
        return productId&&processId&&!legacyCache.has(legacyKey(productId,processId));
      });
      if(!missing.length) return;
      const keys=[...new Set(missing.map(reference=>legacyKey(reference.productId,reference.processId)))].sort();
      const key=keys.join('|');
      if(!legacyInflight.has(key)){
        legacyInflight.set(key,(async()=>{
          const items=await legacyLoader(missing.map(clone));
          buildLegacyCatalog(items).forEach((value,itemKey)=>legacyCache.set(itemKey,value));
          keys.forEach(itemKey=>{ if(!legacyCache.has(itemKey)) legacyCache.set(itemKey,null); });
        })().finally(()=>legacyInflight.delete(key)));
      }
      await legacyInflight.get(key);
    }
    async function resolve(sourceRows){
      const productIds=collectProductIds(sourceRows);
      await load(productIds);
      const products=productIds.map(productId=>cache.get(productId)).filter(Boolean);
      let result=resolveRows(sourceRows,products,{efficiencyCore,workSeconds,legacyProcesses:legacyCache});
      const missing=result.exceptions.filter(item=>item.code==='process-not-found').map(item=>item.reference);
      if(missing.length){
        await loadLegacy(missing);
        result=resolveRows(sourceRows,products,{efficiencyCore,workSeconds,legacyProcesses:legacyCache});
      }
      return result;
    }
    function clear(){ cache.clear(); inflight.clear();legacyCache.clear();legacyInflight.clear(); }
    return Object.freeze({resolve,load,clear,cachedProductIds:()=>[...cache.keys()].sort()});
  }

  window.PCMSProductResolver=Object.freeze({collectProductIds,buildCatalog,buildLegacyCatalog,resolveReference,resolveRows,create});
})();
