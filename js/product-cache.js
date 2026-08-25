// product-cache（款號快取）：保存完整本機款號；雲端版本改變時重新讀取目前主檔。
(function(){
  const CACHE_SCOPE='products'; // CACHE_SCOPE（款號快取範圍）
  const CACHE_SCHEMA_VERSION=4; // CACHE_SCHEMA_VERSION（款號快取格式版本）：新流水帳追蹤起點。

  function normalizeItems(items){
    return (Array.isArray(items)?items:[])
      .filter(item=>String(item?.code||'').trim())
      .map(item=>({...item,code:String(item.code).trim(),ops:Array.isArray(item.ops)?item.ops:[]}))
      .sort((a,b)=>a.code.localeCompare(b.code));
  }

  async function read(){
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
    await window.pcmsDataCache?.remove(CACHE_SCOPE);
  }

  window.PCMSProductCache=Object.freeze({
    schemaVersion:CACHE_SCHEMA_VERSION,
    read,
    write,
    remove,
    normalizeItems
  });
})();
