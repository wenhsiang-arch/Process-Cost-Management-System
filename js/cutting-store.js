// 裁帶模板儲存：模板清單放 Firestore（雲端資料庫），原始 Excel（表格檔）轉成分段後放 Firestore（雲端資料庫），並保留瀏覽器快取。
(function(){
  const META_KEY = 'cuttingTemplateBooks.v2';
  const DB_NAME = 'cuttingTemplateFiles';
  const DB_STORE = 'files';
  const CLOUD_COLLECTION = 'cuttingTemplates'; // cuttingTemplates（裁帶模板清單）
  const CHUNKS_COLLECTION = 'cuttingTemplateChunks'; // cuttingTemplateChunks（裁帶模板檔案分段）
  const CHUNK_CHAR_SIZE = 650000;
  const BATCH_LIMIT = 450;

  function nowText(){
    return new Date().toISOString();
  }

  function cloudReady(){
    return !!(
      window._collection &&
      window._getDocs &&
      window._doc &&
      window._getDoc &&
      window._setDoc &&
      window._deleteDoc &&
      window._query &&
      window._where &&
      window._writeBatch
    );
  }

  function readMeta(){
    try{
      const raw = localStorage.getItem(META_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    }catch(e){
      console.error('讀取裁帶模板清單失敗', e);
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

  function blobToBase64(blob){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const comma = text.indexOf(',');
        resolve(comma >= 0 ? text.slice(comma + 1) : text);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(base64, contentType){
    const sliceSize = 65536;
    const parts = [];
    for(let offset = 0; offset < base64.length; offset += sliceSize){
      const slice = base64.slice(offset, offset + sliceSize);
      const binary = atob(slice);
      const bytes = new Uint8Array(binary.length);
      for(let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      parts.push(bytes);
    }
    return new Blob(parts, {
      type: contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  function splitBase64(base64){
    const chunks = [];
    for(let i = 0; i < base64.length; i += CHUNK_CHAR_SIZE){
      chunks.push(base64.slice(i, i + CHUNK_CHAR_SIZE));
    }
    return chunks.length ? chunks : [''];
  }

  function chunkDocId(templateId, index){
    return `${templateId}_${String(index).padStart(5, '0')}`;
  }

  async function commitOperations(operations){
    let batch = window._writeBatch();
    let count = 0;
    for(const operation of operations){
      operation(batch);
      count += 1;
      if(count >= BATCH_LIMIT){
        await batch.commit();
        batch = window._writeBatch();
        count = 0;
      }
    }
    if(count > 0) await batch.commit();
  }

  async function queryTemplateChunks(templateId){
    const q = window._query(
      window._collection(CHUNKS_COLLECTION),
      window._where('templateId', '==', templateId)
    );
    const snap = await window._getDocs(q);
    return snap.docs
      .map(d => ({docId:d.id, ...d.data()}))
      .filter(row => Number.isInteger(Number(row.index)))
      .sort((a, b) => Number(a.index) - Number(b.index));
  }

  async function deleteTemplateChunks(templateId){
    const rows = await queryTemplateChunks(templateId);
    if(!rows.length) return true;
    await commitOperations(rows.map(row => batch => {
      batch.delete(window._doc(CHUNKS_COLLECTION, row.docId));
    }));
    return true;
  }

  async function cleanupExtraChunks(templateId, keepCount){
    const rows = await queryTemplateChunks(templateId);
    const extra = rows.filter(row => Number(row.index) >= keepCount);
    if(!extra.length) return true;
    await commitOperations(extra.map(row => batch => {
      batch.delete(window._doc(CHUNKS_COLLECTION, row.docId));
    }));
    return true;
  }

  function stripChunkOnlyFields(item){
    const copy = {...item};
    delete copy.data;
    return copy;
  }

  async function listCloudTemplates(){
    const snap = await window._getDocs(window._collection(CLOUD_COLLECTION));
    const items = snap.docs.map(d => stripChunkOnlyFields({id:d.id, ...d.data()}));
    items.sort((a, b) => String(a.createdAt || a.updatedAt || '').localeCompare(String(b.createdAt || b.updatedAt || '')));
    writeMeta(items);
    return items;
  }

  async function getCloudTemplate(id){
    if(!cloudReady()) return null;
    const snap = await window._getDoc(window._doc(CLOUD_COLLECTION, id));
    return snap.exists() ? stripChunkOnlyFields({id:snap.id, ...snap.data()}) : null;
  }

  async function saveCloudTemplate(book, file){
    const currentItems = await listCloudTemplates().catch(() => readMeta());
    const sameFile = currentItems.find(x => x.id === book.id || x.fileName === book.fileName);
    const id = sameFile?.id || book.id || `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const updatedAt = nowText();
    const next = {
      ...sameFile,
      ...book,
      id,
      fileName: file?.name || book.fileName || sameFile?.fileName || '',
      storageMode: 'firestoreChunks',
      chunkCollection: CHUNKS_COLLECTION,
      chunkSize: CHUNK_CHAR_SIZE,
      fileSize: file?.size || sameFile?.fileSize || book.fileSize || 0,
      contentType: file?.type || sameFile?.contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      createdAt: sameFile?.createdAt || book.createdAt || updatedAt,
      updatedAt
    };

    if(file){
      const base64 = await blobToBase64(file);
      const chunks = splitBase64(base64);
      next.chunkCount = chunks.length;
      next.base64Length = base64.length;

      const operations = chunks.map((data, index) => batch => {
        batch.set(window._doc(CHUNKS_COLLECTION, chunkDocId(id, index)), {
          templateId: id,
          index,
          data,
          updatedAt
        });
      });
      operations.push(batch => {
        batch.set(window._doc(CLOUD_COLLECTION, id), next);
      });
      await commitOperations(operations);
      await cleanupExtraChunks(id, chunks.length);
      await putFile(id, file);
    }else{
      await window._setDoc(window._doc(CLOUD_COLLECTION, id), next, {merge:false});
    }

    const localItems = readMeta();
    const idx = localItems.findIndex(x => x.id === id || x.fileName === next.fileName);
    if(idx >= 0) localItems[idx] = next;
    else localItems.push(next);
    writeMeta(localItems);
    return next;
  }

  async function removeCloudTemplate(id){
    await deleteTemplateChunks(id);
    await window._deleteDoc(window._doc(CLOUD_COLLECTION, id));
    const items = readMeta().filter(x => x.id !== id);
    writeMeta(items);
    await deleteFile(id);
    return true;
  }

  async function loadCloudTemplateFile(id){
    const item = await getCloudTemplate(id);
    if(!item || item.storageMode !== 'firestoreChunks') return null;
    const chunkCount = Number(item.chunkCount || 0);
    const rows = await queryTemplateChunks(id);
    if(chunkCount <= 0 || rows.length < chunkCount){
      throw new Error('Thiếu dữ liệu mẫu, vui lòng nhập lại mẫu. / 模板資料不完整，請重新匯入模板。');
    }
    const ordered = [];
    for(let i = 0; i < chunkCount; i++){
      const row = rows.find(x => Number(x.index) === i);
      if(!row || typeof row.data !== 'string'){
        throw new Error('Thiếu dữ liệu mẫu, vui lòng nhập lại mẫu. / 模板資料不完整，請重新匯入模板。');
      }
      ordered.push(row.data);
    }
    const base64 = ordered.join('');
    if(item.base64Length && base64.length !== Number(item.base64Length)){
      throw new Error('Dữ liệu mẫu không khớp, vui lòng nhập lại mẫu. / 模板資料不一致，請重新匯入模板。');
    }
    const blob = base64ToBlob(base64, item.contentType);
    await putFile(id, blob);
    return blob;
  }

  window.cuttingStore = {
    mode: 'firestoreChunks',
    async listTemplates(){
      if(cloudReady()){
        try{ return await listCloudTemplates(); }
        catch(e){ console.error('讀取雲端裁帶模板失敗', e); }
      }
      return readMeta();
    },
    async getTemplate(id){
      if(cloudReady()){
        try{
          const item = await getCloudTemplate(id);
          if(item) return item;
        }catch(e){ console.error('讀取雲端裁帶模板資料失敗', e); }
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
      if(!cloudReady()) return null;
      return loadCloudTemplateFile(id);
    }
  };
})();
