// cuttingStore（裁帶資料儲存）：模板清單放 Firebase（雲端服務），原始 Excel（表格檔）放 Firebase Storage（雲端檔案儲存），本機 IndexedDB（瀏覽器資料庫）保留快取。
(function(){
  const META_KEY = 'cuttingTemplateBooks.v2';
  const DB_NAME = 'cuttingTemplateFiles';
  const DB_STORE = 'files';
  const CLOUD_COLLECTION = 'cuttingTemplates';
  const STORAGE_ROOT = 'cutting-templates';

  function nowText(){
    return new Date().toISOString();
  }

  function cloudReady(){
    return !!(window._collection && window._getDocs && window._doc && window._setDoc && window._deleteDoc && window._storageRef && window._uploadBytes && window._getBlob && window._deleteObject);
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

  function safeStorageName(value){
    return String(value || 'template.xlsx').replace(/[\\/:*?"<>|#\[\]]/g, '_');
  }

  function templateStoragePath(id, fileName){
    return `${STORAGE_ROOT}/${safeStorageName(id)}/${safeStorageName(fileName)}`;
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

  async function listCloudTemplates(){
    const snap = await window._getDocs(window._collection(CLOUD_COLLECTION));
    const items = snap.docs.map(d => ({id:d.id, ...d.data()}));
    items.sort((a, b) => String(a.createdAt || a.updatedAt || '').localeCompare(String(b.createdAt || b.updatedAt || '')));
    writeMeta(items);
    return items;
  }

  async function getCloudTemplate(id){
    if(!cloudReady()) return null;
    const snap = await window._getDoc(window._doc(CLOUD_COLLECTION, id));
    return snap.exists() ? {id:snap.id, ...snap.data()} : null;
  }

  async function saveCloudTemplate(book, file){
    const currentItems = await listCloudTemplates().catch(() => readMeta());
    const sameFile = currentItems.find(x => x.id === book.id || x.fileName === book.fileName);
    const id = sameFile?.id || book.id || `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const updatedAt = nowText();
    const storagePath = file ? templateStoragePath(id, file.name || book.fileName) : (sameFile?.storagePath || book.storagePath || '');
    const next = {
      ...sameFile,
      ...book,
      id,
      fileName: file?.name || book.fileName || sameFile?.fileName || '',
      storageMode: 'firebaseStorage',
      storagePath,
      fileSize: file?.size || sameFile?.fileSize || book.fileSize || 0,
      createdAt: sameFile?.createdAt || book.createdAt || updatedAt,
      updatedAt
    };

    if(file){
      await window._uploadBytes(window._storageRef(storagePath), file, {
        contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      await putFile(id, file);
    }
    await window._setDoc(window._doc(CLOUD_COLLECTION, id), next, {merge:false});
    const localItems = readMeta();
    const idx = localItems.findIndex(x => x.id === id || x.fileName === next.fileName);
    if(idx >= 0) localItems[idx] = next;
    else localItems.push(next);
    writeMeta(localItems);
    return next;
  }

  async function removeCloudTemplate(id){
    const item = await getCloudTemplate(id) || readMeta().find(x => x.id === id) || null;
    if(item?.storagePath){
      try{
        await window._deleteObject(window._storageRef(item.storagePath));
      }catch(e){
        if(!/object-not-found/i.test(String(e?.code || e?.message || ''))) throw e;
      }
    }
    await window._deleteDoc(window._doc(CLOUD_COLLECTION, id));
    const items = readMeta().filter(x => x.id !== id);
    writeMeta(items);
    await deleteFile(id);
    return true;
  }

  window.cuttingStore = {
    mode: 'firebaseStorage',
    async listTemplates(){
      if(cloudReady()){
        try{ return await listCloudTemplates(); }
        catch(e){ console.error('讀取雲端裁帶模板失敗：', e); }
      }
      return readMeta();
    },
    async getTemplate(id){
      if(cloudReady()){
        try{
          const item = await getCloudTemplate(id);
          if(item) return item;
        }catch(e){ console.error('讀取雲端裁帶模板資料失敗：', e); }
      }
      return readMeta().find(x => x.id === id) || null;
    },
    async saveTemplateBook(book, file){
      if(cloudReady()){
        return saveCloudTemplate(book, file);
      }
      const items = readMeta();
      const id = book.id || `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const next = {...book, id, updatedAt:nowText(), storageMode:'indexedDB'};
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
      if(cloudReady()){
        return removeCloudTemplate(id);
      }
      const items = readMeta().filter(x => x.id !== id);
      writeMeta(items);
      await deleteFile(id);
      return true;
    },
    async getTemplateFile(id){
      const cached = await getFile(id);
      if(cached) return cached;
      const item = await this.getTemplate(id);
      if(!item?.storagePath || !cloudReady()) return null;
      const blob = await window._getBlob(window._storageRef(item.storagePath));
      await putFile(id, blob);
      return blob;
    }
  };
})();
