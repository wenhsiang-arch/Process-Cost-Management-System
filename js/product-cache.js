// product-cache（款號快取）：保存完整本機款號，並以唯一遞增序號合併雲端差異。
(function(){
  const CACHE_SCOPE='products'; // CACHE_SCOPE（款號快取範圍）
  const CACHE_SCHEMA_VERSION=4; // CACHE_SCHEMA_VERSION（款號快取格式版本）：新流水帳追蹤起點。

  function normalizeItems(items){
    return (Array.isArray(items)?items:[])
      .filter(item=>String(item?.productId||'').trim()&&String(item?.code||'').trim()&&item?.active!==false&&!item?.deleted)
      .map(item=>({...item,code:String(item.code).trim(),ops:Array.isArray(item.ops)?item.ops:[]}))
      .sort((a,b)=>a.code.localeCompare(b.code));
  }

  function normalizeDeletedProductIds(value){
    return [...new Set((Array.isArray(value)?value:[]).map(item=>String(item||'').trim()).filter(Boolean))];
  }

  function countSnapshot(items){
    const normalized=normalizeItems(items);
    return {
      items:normalized,
      productCount:normalized.length,
      opCount:normalized.reduce((sum,item)=>sum+item.ops.length,0)
    };
  }

  function sameSyncPosition(left,right){
    return !!left&&!!right
      && String(left.version||'')!==''
      && String(left.version)===String(right.version||'')
      && Number.isInteger(Number(left.changeSequence))
      && Number(left.changeSequence)===Number(right.changeSequence)
      && String(left.trackingEpoch||'')!==''
      && String(left.trackingEpoch)===String(right.trackingEpoch||'');
  }

  // validateAuthoritativeSnapshot（驗證正式查詢結果）：合法 0 筆必須同時通過查詢、雲端來源、同步位置及筆數驗證。
  function validateAuthoritativeSnapshot(input={}){
    const counted=countSnapshot(input.items);
    if(input.querySucceeded!==true) return {...counted,ok:false,legalEmpty:false,reason:'query-failed'};
    if(input.fromServer!==true) return {...counted,ok:false,legalEmpty:false,reason:'query-not-authoritative'};
    if(!sameSyncPosition(input.beforeMeta,input.afterMeta)){
      return {...counted,ok:false,legalEmpty:false,reason:'sync-position-changed'};
    }
    const expectedProductCount=Number(input.afterMeta?.productCount);
    const expectedOpCount=Number(input.afterMeta?.opCount);
    if(!Number.isInteger(expectedProductCount)||expectedProductCount<0
      ||!Number.isInteger(expectedOpCount)||expectedOpCount<0){
      return {...counted,ok:false,legalEmpty:false,reason:'invalid-meta-counts'};
    }
    if(counted.productCount!==expectedProductCount||counted.opCount!==expectedOpCount){
      return {...counted,ok:false,legalEmpty:false,reason:'incomplete-snapshot'};
    }
    return {...counted,ok:true,legalEmpty:expectedProductCount===0,reason:'verified'};
  }

  // createLatestRequestGate（最新請求閘門）：較舊請求即使較晚返回，也不能發布結果。
  function createLatestRequestGate(){
    let latestRequestId=0;
    return Object.freeze({
      begin(){ latestRequestId+=1; return latestRequestId; },
      isLatest(requestId){ return Number(requestId)===latestRequestId; },
      invalidate(){ latestRequestId+=1; return latestRequestId; },
      current(){ return latestRequestId; }
    });
  }

  function canIncrementallySync(cache,meta){
    const cacheSequence=Number(cache?.sequence);
    const startSequence=Number(meta?.incrementalStartSequence);
    return !!cache
      && Number(meta?.incrementalSchemaVersion)===1
      && Number.isInteger(cacheSequence)&&cacheSequence>=0
      && Number.isInteger(startSequence)&&startSequence>=0
      && cacheSequence>=startSequence
      && cacheSequence<=Number(meta?.changeSequence)
      && String(cache.trackingEpoch||'')!==''
      && String(cache.trackingEpoch)===String(meta?.trackingEpoch||'');
  }

  function merge(baseItems,changedItems,deletedIds=[]){
    const itemsById=new Map(normalizeItems(baseItems).map(item=>[String(item.productId),item]));
    normalizeDeletedProductIds(deletedIds).forEach(productId=>itemsById.delete(productId));
    (Array.isArray(changedItems)?changedItems:[]).forEach(item=>{
      const productId=String(item?.productId||'').trim();
      if(!productId) return;
      if(item?.active===false||item?.deleted||!String(item?.code||'').trim()) itemsById.delete(productId);
      else itemsById.set(productId,item);
    });
    return normalizeItems([...itemsById.values()]);
  }

  async function read(){
    const record=await window.pcmsDataCache?.read(CACHE_SCOPE);
    if(!record||record.schemaVersion!==CACHE_SCHEMA_VERSION||!Array.isArray(record.items)) return null;
    return {
      schemaVersion:CACHE_SCHEMA_VERSION,
      version:String(record.version||''),
      sequence:Number(record.sequence)||0,
      trackingEpoch:String(record.trackingEpoch||''),
      items:normalizeItems(record.items)
    };
  }

  async function write(items,meta){
    const record={
      schemaVersion:CACHE_SCHEMA_VERSION,
      version:String(meta?.version||''),
      sequence:Number(meta?.changeSequence)||0,
      trackingEpoch:String(meta?.trackingEpoch||''),
      items:normalizeItems(items)
    };
    return window.pcmsDataCache?.write(CACHE_SCOPE,record.version,record);
  }

  async function remove(){
    await window.pcmsDataCache?.remove(CACHE_SCOPE);
  }

  window.PCMSProductCache=Object.freeze({
    schemaVersion:CACHE_SCHEMA_VERSION,
    read,
    write,
    remove,
    normalizeItems,
    normalizeDeletedProductIds,
    countSnapshot,
    sameSyncPosition,
    validateAuthoritativeSnapshot,
    createLatestRequestGate,
    canIncrementallySync,
    merge
  });
})();
