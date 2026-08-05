// order-process-cache（訂單工序快取）：每張訂單分開保存，避免一張訂單變動就重讀全部工序。
(function(){
  'use strict';

  const SCOPE_PREFIX='orderProcesses:'; // SCOPE_PREFIX（訂單工序快取範圍前綴）

  function scopeFor(orderId){
    return SCOPE_PREFIX+encodeURIComponent(String(orderId||'').trim());
  }

  function normalize(items){
    return (Array.isArray(items)?items:[])
      .filter(item=>item&&String(item.orderId||'').trim())
      .map(item=>({...item,id:String(item.id||'')}));
  }

  async function read(orderId,version){
    if(!orderId||!version) return null;
    const data=await window.pcmsDataCache?.read(scopeFor(orderId),String(version));
    return Array.isArray(data)?normalize(data):null;
  }

  async function write(orderId,version,items){
    if(!orderId||!version) return false;
    return window.pcmsDataCache?.write(scopeFor(orderId),String(version),normalize(items));
  }

  async function remove(orderId){
    if(!orderId) return;
    await window.pcmsDataCache?.remove(scopeFor(orderId));
  }

  function replace(allItems,orderId,items){
    const target=String(orderId||'');
    return [
      ...(Array.isArray(allItems)?allItems:[]).filter(item=>String(item?.orderId||'')!==target),
      ...normalize(items)
    ];
  }

  window.PCMSOrderProcessCache=Object.freeze({read,write,remove,replace,normalize,scopeFor});
})();
