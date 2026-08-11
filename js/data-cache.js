// ===== data-cache（資料快取）共用管理 =====
// IndexedDB（瀏覽器本機資料庫）保存同一台電腦的功能資料；1 GB（十億位元組）是動態上限，不會預先占用。
(function(){
  'use strict';

  const DATABASE_NAME = 'pcms-data-cache-v1'; // DATABASE_NAME（資料庫名稱）
  const STORE_NAME = 'entries';                // STORE_NAME（資料儲存區名稱）
  const DATABASE_VERSION = 2;                  // DATABASE_VERSION（資料庫結構版本）：第 2 版清除舊敏感快取。
  const MAX_CACHE_BYTES = 1024 * 1024 * 1024;  // MAX_CACHE_BYTES（快取容量上限）：1 GB（十億位元組）
  let databasePromise = null;
  let persistenceRequested = false;

  function reportCacheEvent(scope,event){
    window.PCMSUsageMetrics?.recordCache?.({scope,event});
  }

  function currentUserId(){
    const authUid=window.cu?.authUid||'';
    return authUid&&window.firebaseAuthUser?.uid===authUid?String(authUid):'';
  }

  function cacheKey(userId,scope){
    return `${location.origin}|${userId}|${scope}`;
  }

  function estimateBytes(value){
    try{
      return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    }catch(e){
      return 0;
    }
  }

  function requestToPromise(request){
    return new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB（瀏覽器本機資料庫）操作失敗'));
    });
  }

  function transactionDone(transaction){
    return new Promise((resolve,reject)=>{
      transaction.oncomplete=()=>resolve();
      transaction.onerror=()=>reject(transaction.error||new Error('IndexedDB（瀏覽器本機資料庫）交易失敗'));
      transaction.onabort=()=>reject(transaction.error||new Error('IndexedDB（瀏覽器本機資料庫）交易已中止'));
    });
  }

  function openDatabase(){
    if(!('indexedDB' in window)) return Promise.resolve(null);
    if(databasePromise) return databasePromise;
    databasePromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open(DATABASE_NAME,DATABASE_VERSION);
      request.onupgradeneeded=()=>{
        const database=request.result;
        let store;
        if(!database.objectStoreNames.contains(STORE_NAME)){
          store=database.createObjectStore(STORE_NAME,{keyPath:'key'});
          store.createIndex('lastAccessedAt','lastAccessedAt',{unique:false});
          store.createIndex('userId','userId',{unique:false});
        }else{
          store=request.transaction.objectStore(STORE_NAME);
        }
        // settings（舊合併設定）與 cLog（成本記錄）曾包含敏感金額，升級時全部清除。
        if(request.oldVersion<2&&store){
          const cursorRequest=store.openCursor();
          cursorRequest.onsuccess=()=>{
            const cursor=cursorRequest.result;
            if(!cursor) return;
            if(cursor.value?.scope==='settings'||cursor.value?.scope==='cLog') cursor.delete();
            cursor.continue();
          };
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('無法開啟 IndexedDB（瀏覽器本機資料庫）'));
    }).catch(error=>{
      databasePromise=null;
      console.warn('data-cache（資料快取）無法啟用：',error);
      return null;
    });
    return databasePromise;
  }

  async function requestPersistentStorage(){
    if(persistenceRequested) return false;
    persistenceRequested=true;
    try{
      if(navigator.storage?.persist) return await navigator.storage.persist();
    }catch(e){
      console.warn('persistent storage（永久儲存）申請失敗：',e);
    }
    return false;
  }

  async function listEntries(database){
    const transaction=database.transaction(STORE_NAME,'readonly');
    return requestToPromise(transaction.objectStore(STORE_NAME).getAll());
  }

  async function removeKeys(database,keys){
    if(!keys.length) return;
    const transaction=database.transaction(STORE_NAME,'readwrite');
    const store=transaction.objectStore(STORE_NAME);
    keys.forEach(key=>store.delete(key));
    await transactionDone(transaction);
  }

  async function makeRoom(database,incomingBytes,protectedKey){
    if(incomingBytes>MAX_CACHE_BYTES) return false;
    const entries=await listEntries(database);
    let used=entries.reduce((sum,item)=>sum+(Number(item.byteSize)||0),0);
    const current=entries.find(item=>item.key===protectedKey);
    if(current) used-=Number(current.byteSize)||0;
    if(used+incomingBytes<=MAX_CACHE_BYTES) return true;

    const removable=entries
      .filter(item=>item.key!==protectedKey)
      .sort((a,b)=>(Number(a.lastAccessedAt)||0)-(Number(b.lastAccessedAt)||0));
    const remove=[];
    for(const item of removable){
      remove.push(item.key);
      used-=Number(item.byteSize)||0;
      if(used+incomingBytes<=MAX_CACHE_BYTES) break;
    }
    await removeKeys(database,remove);
    return used+incomingBytes<=MAX_CACHE_BYTES;
  }

  async function read(scope,expectedVersion){
    const userId=currentUserId();
    if(!userId||!scope) return null;
    const database=await openDatabase();
    if(!database){ reportCacheEvent(scope,'miss'); return null; }
    try{
      const key=cacheKey(userId,scope);
      const transaction=database.transaction(STORE_NAME,'readwrite');
      const store=transaction.objectStore(STORE_NAME);
      const entry=await requestToPromise(store.get(key));
      if(!entry){ await transactionDone(transaction); reportCacheEvent(scope,'miss'); return null; }
      if(expectedVersion!==undefined&&String(entry.version||'')!==String(expectedVersion||'')){
        store.delete(key);
        await transactionDone(transaction);
        reportCacheEvent(scope,'miss');
        return null;
      }
      entry.lastAccessedAt=Date.now();
      store.put(entry);
      await transactionDone(transaction);
      reportCacheEvent(scope,'hit');
      return entry.data;
    }catch(error){
      console.warn(`讀取 ${scope} data-cache（資料快取）失敗：`,error);
      reportCacheEvent(scope,'miss');
      return null;
    }
  }

  // readEntry（讀取完整快取項目）：供需要自行比對版本及進行增量更新的功能使用。
  async function readEntry(scope,options={}){
    const userId=currentUserId();
    if(!userId||!scope) return null;
    const database=await openDatabase();
    if(!database){ reportCacheEvent(scope,'miss'); return null; }
    try{
      const key=cacheKey(userId,scope);
      const transaction=database.transaction(STORE_NAME,options.touch===false?'readonly':'readwrite');
      const store=transaction.objectStore(STORE_NAME);
      const entry=await requestToPromise(store.get(key));
      if(entry&&options.touch!==false){
        entry.lastAccessedAt=Date.now();
        store.put(entry);
      }
      await transactionDone(transaction);
      reportCacheEvent(scope,entry?'hit':'miss');
      return entry?{
        scope:entry.scope,
        version:String(entry.version||''),
        data:entry.data,
        byteSize:Number(entry.byteSize)||0,
        savedAt:Number(entry.savedAt)||0,
        lastAccessedAt:Number(entry.lastAccessedAt)||0
      }:null;
    }catch(error){
      console.warn(`讀取 ${scope} 完整 data-cache（資料快取）項目失敗：`,error);
      reportCacheEvent(scope,'miss');
      return null;
    }
  }

  async function write(scope,version,data){
    const userId=currentUserId();
    if(!userId||!scope) return false;
    const database=await openDatabase();
    if(!database) return false;
    const byteSize=estimateBytes(data);
    const key=cacheKey(userId,scope);
    try{
      const hasRoom=await makeRoom(database,byteSize,key);
      if(!hasRoom) return false;
      const now=Date.now();
      const transaction=database.transaction(STORE_NAME,'readwrite');
      transaction.objectStore(STORE_NAME).put({
        key,userId,scope,version:String(version||''),data,byteSize,
        savedAt:now,lastAccessedAt:now
      });
      await transactionDone(transaction);
      reportCacheEvent(scope,'write');
      return true;
    }catch(error){
      console.warn(`寫入 ${scope} data-cache（資料快取）失敗：`,error);
      return false;
    }
  }

  async function removeForUser(userId,scope){
    const normalizedUserId=String(userId||'').trim(); // normalizedUserId（指定的使用者識別碼）
    if(!normalizedUserId||!scope) return;
    const database=await openDatabase();
    if(!database) return;
    try{ await removeKeys(database,[cacheKey(normalizedUserId,scope)]); }
    catch(error){ console.warn(`清除 ${scope} data-cache（資料快取）失敗：`,error); }
  }

  async function remove(scope){
    const userId=currentUserId();
    if(!userId||!scope) return;
    return removeForUser(userId,scope);
  }

  async function usage(){
    const userId=currentUserId();
    const database=await openDatabase();
    if(!userId||!database) return {usedBytes:0,maxBytes:MAX_CACHE_BYTES};
    try{
      const entries=await listEntries(database);
      const usedBytes=entries
        .filter(item=>item.userId===userId)
        .reduce((sum,item)=>sum+(Number(item.byteSize)||0),0);
      return {usedBytes,maxBytes:MAX_CACHE_BYTES};
    }catch(e){
      return {usedBytes:0,maxBytes:MAX_CACHE_BYTES};
    }
  }

  // inspect（檢查快取狀態）：只回傳目前 UID 的中繼資料，不回傳業務資料內容。
  async function inspect(){
    const userId=currentUserId();
    const database=await openDatabase();
    if(!userId||!database) return [];
    try{
      const entries=await listEntries(database);
      return entries
        .filter(item=>item.userId===userId)
        .map(item=>({
          scope:String(item.scope||''),
          version:String(item.version||''),
          byteSize:Number(item.byteSize)||0,
          savedAt:Number(item.savedAt)||0,
          lastAccessedAt:Number(item.lastAccessedAt)||0,
          itemCount:Array.isArray(item.data)
            ? item.data.length
            : Array.isArray(item.data?.entries)||Array.isArray(item.data?.attendance)
              ? (Array.isArray(item.data?.entries)?item.data.entries.length:0)
                +(Array.isArray(item.data?.attendance)?item.data.attendance.length:0)
              : null
        }))
        .sort((a,b)=>b.lastAccessedAt-a.lastAccessedAt);
    }catch(error){
      console.warn('檢查 data-cache（資料快取）狀態失敗：',error);
      return [];
    }
  }

  window.pcmsDataCache={
    read,readEntry,write,remove,removeForUser,usage,inspect,requestPersistentStorage,
    maxBytes:MAX_CACHE_BYTES
  };
})();
