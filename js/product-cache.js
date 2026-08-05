// product-cache（款號快取）：保存完整本機款號，雲端版本改變時只合併有變動的款號。
(function(){
  const CACHE_SCOPE='products'; // CACHE_SCOPE（款號快取範圍）
  const CACHE_SCHEMA_VERSION=2; // CACHE_SCHEMA_VERSION（款號快取格式版本）
  const LEGACY_KEYS=['pcmsProductsCache','pcmsProductsCacheVersion']; // LEGACY_KEYS（舊款號快取鍵）

  function normalizeItems(items){
    return (Array.isArray(items)?items:[])
      .filter(item=>String(item?.code||'').trim())
      .map(item=>({...item,code:String(item.code).trim(),ops:Array.isArray(item.ops)?item.ops:[]}))
      .sort((a,b)=>a.code.localeCompare(b.code));
  }

  function clearLegacyStorage(){
    try{ LEGACY_KEYS.forEach(key=>localStorage.removeItem(key)); }catch(e){}
  }

  async function read(){
    clearLegacyStorage();
    const record=await window.pcmsDataCache?.read(CACHE_SCOPE);
    if(!record||record.schemaVersion!==CACHE_SCHEMA_VERSION||!Array.isArray(record.items)) return null;
    return {
      schemaVersion:CACHE_SCHEMA_VERSION,
      version:String(record.version||''),
      sequence:Number(record.sequence)||0,
      items:normalizeItems(record.items)
    };
  }

  async function write(items,meta){
    const record={
      schemaVersion:CACHE_SCHEMA_VERSION,
      version:String(meta?.version||''),
      sequence:Number(meta?.changeSequence)||0,
      items:normalizeItems(items)
    };
    return window.pcmsDataCache?.write(CACHE_SCOPE,record.version,record);
  }

  async function remove(){
    clearLegacyStorage();
    await window.pcmsDataCache?.remove(CACHE_SCOPE);
  }

  // planChanges（規劃增量更新）：序號必須連續，最後保留每個款號的最新動作。
  function planChanges(logs,startSequence){
    let expected=Number(startSequence)||0;
    const actions=new Map(); // actions（每個款號最後一次變更動作）
    const ordered=[...(Array.isArray(logs)?logs:[])].sort((a,b)=>Number(a.sequence)-Number(b.sequence));
    for(const log of ordered){
      const sequence=Number(log?.sequence);
      if(!Number.isInteger(sequence)||sequence!==expected+1){
        return {valid:false,sequence:expected,changedCodes:[],deletedCodes:[]};
      }
      expected=sequence;
      (Array.isArray(log.changedCodes)?log.changedCodes:[]).forEach(code=>{
        const normalized=String(code||'').trim();
        if(normalized) actions.set(normalized,'changed');
      });
      (Array.isArray(log.deletedCodes)?log.deletedCodes:[]).forEach(code=>{
        const normalized=String(code||'').trim();
        if(normalized) actions.set(normalized,'deleted');
      });
    }
    return {
      valid:true,
      sequence:expected,
      changedCodes:[...actions].filter(([,action])=>action==='changed').map(([code])=>code),
      deletedCodes:[...actions].filter(([,action])=>action==='deleted').map(([code])=>code)
    };
  }

  function merge(baseItems,changedItems,deletedCodes=[]){
    const merged=new Map(normalizeItems(baseItems).map(item=>[item.code,item]));
    deletedCodes.forEach(code=>merged.delete(String(code||'').trim()));
    normalizeItems(changedItems).forEach(item=>merged.set(item.code,item));
    return normalizeItems([...merged.values()]);
  }

  window.PCMSProductCache=Object.freeze({
    schemaVersion:CACHE_SCHEMA_VERSION,
    read,
    write,
    remove,
    planChanges,
    merge,
    normalizeItems
  });
})();
