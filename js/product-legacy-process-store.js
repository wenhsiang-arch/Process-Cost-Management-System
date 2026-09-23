// product-legacy-process-store（舊工序參照資料）：只保存仍被既有產能引用、但已不在正式款號表中的工序。
(function(){
  'use strict';

  const COLLECTION='productLegacyProcesses';
  const SCHEMA_VERSION=1;
  const cache=new Map();
  const inflight=new Map();

  function text(value){ return String(value??'').trim().replace(/\s+/g,' '); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }
  function documentId(productId,processId){
    const product=model().fixedId(productId,'product');
    const process=model().fixedId(processId,'process');
    if(!product||!process) throw new Error('Liên kết công đoạn cũ không hợp lệ. / 舊工序參照不正確。');
    return `${product}__${process}`;
  }
  function normalize(input={}){
    const productId=model().fixedId(input.productId,'product');
    const processId=model().fixedId(input.processId,'process');
    const operation=model().normalizeOperation(input);
    if(!productId||!processId||!operation.no||!operation.vi||!(Number(operation.sec)>0)){
      throw new Error('Dữ liệu tham chiếu công đoạn cũ không hợp lệ. / 舊工序參照資料不正確。');
    }
    return {
      legacyProcessId:documentId(productId,processId),productId,processId,
      productCode:text(input.productCode).slice(0,80),no:operation.no,category:operation.category,
      zh:operation.zh.slice(0,200),vi:operation.vi.slice(0,200),sec:operation.sec,
      sourceBatchId:text(input.sourceBatchId).slice(0,200),createdAt:Math.max(1,Math.trunc(Number(input.createdAt)||Date.now())),
      createdByUid:text(input.createdByUid).slice(0,200),createdBy:text(input.createdBy).slice(0,200),schemaVersion:SCHEMA_VERSION
    };
  }
  function build({product,operation,batch,actor,now}={}){
    return normalize({
      productId:product?.productId,processId:operation?.processId,productCode:product?.code,
      no:operation?.no,category:operation?.category,zh:operation?.zh,vi:operation?.vi,sec:operation?.sec,
      sourceBatchId:batch?.batchId,createdAt:now,createdByUid:actor?.uid,createdBy:actor?.name
    });
  }
  async function loadByReferences(references=[]){
    if(typeof window._getDoc!=='function'||typeof window._docRef!=='function'){
      throw new Error('Dịch vụ đọc công đoạn cũ chưa sẵn sàng. / 舊工序讀取服務尚未載入。');
    }
    const unique=new Map();
    (Array.isArray(references)?references:[]).forEach(reference=>{
      try{ unique.set(documentId(reference?.productId,reference?.processId),reference); }catch(_error){ /* 無效參照交由解析器回報 */ }
    });
    const results=[];
    await Promise.all([...unique.keys()].map(async id=>{
      if(cache.has(id)){ results.push(clone(cache.get(id))); return; }
      if(!inflight.has(id)){
        inflight.set(id,(async()=>{
          const snapshot=await window._getDoc(window._docRef(COLLECTION,id));
          const value=snapshot.exists()?normalize(snapshot.data()):null;
          cache.set(id,value);
          return value;
        })().finally(()=>inflight.delete(id)));
      }
      const value=await inflight.get(id);
      if(value) results.push(clone(value));
    }));
    return results;
  }
  function prime(items=[]){
    (Array.isArray(items)?items:[]).forEach(item=>{
      const normalized=normalize(item);
      cache.set(normalized.legacyProcessId,normalized);
    });
  }
  function clear(){ cache.clear();inflight.clear(); }

  window.PCMSProductLegacyProcessStore=Object.freeze({COLLECTION,SCHEMA_VERSION,documentId,normalize,build,loadByReferences,prime,clear});
})();
