// cuttingStore（裁帶資料儲存）：保存模板分析資料，原始 Excel（表格檔）存 IndexedDB（瀏覽器資料庫）。
(function(){
  const META_KEY = 'cuttingTemplateBooks.v2';
  const DB_NAME = 'cuttingTemplateFiles';
  const DB_STORE = 'files';

  function nowText(){
    return new Date().toISOString();
  }

  function readMeta(){
    try{
      const raw = localStorage.getItem(META_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    }catch(e){
      console.error('讀取裁帶模板建檔資料失敗：', e);
      return [];
    }
  }

  function writeMeta(items){
    localStorage.setItem(META_KEY, JSON.stringify(items));
  }

  function openDb(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putFile(id, blob){
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(blob, id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getFile(id){
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteFile(id){
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  window.cuttingStore = {
    mode: 'local',
    async listTemplates(){
      return readMeta();
    },
    async saveTemplateBook(book, file){
      const items = readMeta();
      const id = book.id || `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const next = {
        ...book,
        id,
        updatedAt: nowText(),
        storageMode: 'indexedDB'
      };
      const idx = items.findIndex(x => x.id === id || x.fileName === next.fileName);
      if(idx >= 0){
        next.id = items[idx].id;
        items[idx] = {...items[idx], ...next};
      } else {
        items.push(next);
      }
      if(file) await putFile(next.id, file);
      writeMeta(items);
      return next;
    },
    async removeTemplate(id){
      const items = readMeta().filter(x => x.id !== id);
      writeMeta(items);
      await deleteFile(id);
      return true;
    },
    async getTemplateFile(id){
      return getFile(id);
    }
  };
})();
