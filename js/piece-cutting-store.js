// piece-cutting-store（裁片出單資料層）：單一正式主檔、分塊儲存、版本檢查與瀏覽器檔案快取。
(function(){
  const TEMPLATE_COLLECTION='pieceCuttingTemplates';
  const CHUNK_COLLECTION='pieceCuttingTemplateChunks';
  const TEMPLATE_ID='main';
  const CACHE_DB='pcmsPieceCuttingCache';
  const CACHE_STORE='files';
  const CACHE_KEY='main';
  const CHUNK_CHAR_SIZE=650000;
  const MAX_FILE_BYTES=100*1024*1024;
  const MAX_CHUNKS=Math.ceil((MAX_FILE_BYTES*4/3)/CHUNK_CHAR_SIZE)+1;
  const DEFAULT_CONTENT_TYPE='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  let metaState={loaded:false,value:null,promise:null,requestId:0};

  function cloudReady(){
    return !!(window._doc&&window._getDoc&&window._newDocRef&&window._writeBatch&&window.firebaseAuthUser?.uid);
  }

  function requireCloud(){
    if(!cloudReady()) throw new Error('Chưa thể kết nối dữ liệu mẫu cắt chi tiết.\n尚無法連接裁片主檔資料。');
  }

  function openCache(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(CACHE_DB,1);
      request.onupgradeneeded=()=>{
        if(!request.result.objectStoreNames.contains(CACHE_STORE)) request.result.createObjectStore(CACHE_STORE);
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }

  async function cacheGet(){
    if(!('indexedDB' in window)) return null;
    const database=await openCache();
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction(CACHE_STORE,'readonly');
      const request=transaction.objectStore(CACHE_STORE).get(CACHE_KEY);
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error);
      transaction.oncomplete=()=>database.close();
    });
  }

  async function cachePut(blob,meta){
    if(!('indexedDB' in window)) return false;
    const database=await openCache();
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction(CACHE_STORE,'readwrite');
      transaction.objectStore(CACHE_STORE).put({blob,meta,cachedAt:Date.now()},CACHE_KEY);
      transaction.oncomplete=()=>{ database.close(); resolve(true); };
      transaction.onerror=()=>{ database.close(); reject(transaction.error); };
    });
  }

  async function cacheDelete(){
    if(!('indexedDB' in window)) return false;
    const database=await openCache();
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction(CACHE_STORE,'readwrite');
      transaction.objectStore(CACHE_STORE).delete(CACHE_KEY);
      transaction.oncomplete=()=>{ database.close(); resolve(true); };
      transaction.onerror=()=>{ database.close(); reject(transaction.error); };
    });
  }

  async function sha256Hex(blob){
    if(!window.crypto?.subtle) throw new Error('Trình duyệt không hỗ trợ kiểm tra tệp an toàn.\n瀏覽器不支援安全檔案驗證。');
    const digest=await window.crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  }

  function blobToBase64(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||'').split(',').pop()||'');
      reader.onerror=()=>reject(reader.error||new Error('Không thể đọc tệp / 無法讀取檔案'));
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(base64,contentType){
    const parts=[];
    for(let offset=0;offset<base64.length;offset+=65536){
      const binary=atob(base64.slice(offset,offset+65536));
      const bytes=new Uint8Array(binary.length);
      for(let index=0;index<binary.length;index+=1) bytes[index]=binary.charCodeAt(index);
      parts.push(bytes);
    }
    return new Blob(parts,{type:contentType||DEFAULT_CONTENT_TYPE});
  }

  function splitBase64(value){
    const chunks=[];
    for(let offset=0;offset<value.length;offset+=CHUNK_CHAR_SIZE) chunks.push(value.slice(offset,offset+CHUNK_CHAR_SIZE));
    return chunks.length?chunks:[''];
  }

  function chunkId(index){
    return `${TEMPLATE_ID}_${String(index).padStart(5,'0')}`;
  }

  function normalizeMeta(snapshot){
    if(!snapshot?.exists?.()) return null;
    const value=snapshot.data()||{};
    return {id:snapshot.id,...value};
  }

  async function loadMeta(options={}){
    requireCloud();
    if(options.force!==true&&metaState.loaded) return metaState.value;
    if(options.force!==true&&metaState.promise) return metaState.promise;
    const requestId=metaState.requestId+1;
    metaState.requestId=requestId;
    const promise=(async()=>{
      try{
        const value=normalizeMeta(await window._getDoc(window._doc(TEMPLATE_COLLECTION,TEMPLATE_ID)));
        if(requestId!==metaState.requestId) return metaState.value;
        metaState={...metaState,loaded:true,value};
        return value;
      }catch(error){
        if(requestId!==metaState.requestId&&metaState.loaded) return metaState.value;
        throw error;
      }finally{
        if(requestId===metaState.requestId) metaState={...metaState,promise:null};
      }
    })();
    metaState={...metaState,promise};
    return promise;
  }

  async function loadChunks(meta,onProgress){
    const chunkCount=Number(meta?.chunkCount)||0;
    if(chunkCount<1||chunkCount>MAX_CHUNKS) throw new Error('Số phần của tệp mẫu không hợp lệ.\n裁片主檔分塊數量無效。');
    const values=[];
    for(let index=0;index<chunkCount;index+=1){
      const snapshot=await window._getDoc(window._doc(CHUNK_COLLECTION,chunkId(index)));
      if(!snapshot.exists()) throw new Error(`Thiếu phần ${index+1} của tệp mẫu.\n裁片主檔缺少第 ${index+1} 段。`);
      const chunk=snapshot.data()||{};
      if(chunk.templateId!==TEMPLATE_ID||Number(chunk.index)!==index||chunk.contentHash!==meta.contentHash){
        throw new Error(`Phần ${index+1} của tệp mẫu không khớp phiên bản.\n裁片主檔第 ${index+1} 段版本不一致。`);
      }
      values.push(String(chunk.data||''));
      if(typeof onProgress==='function') onProgress({current:index+1,total:chunkCount});
    }
    const blob=base64ToBlob(values.join(''),meta.contentType);
    if(blob.size!==Number(meta.fileSize)) throw new Error('Kích thước tệp mẫu không khớp.\n裁片主檔大小驗證不一致。');
    if(await sha256Hex(blob)!==meta.contentHash) throw new Error('Nội dung tệp mẫu không khớp mã kiểm tra.\n裁片主檔內容驗證不一致。');
    await cachePut(blob,meta).catch(error=>console.warn('裁片主檔瀏覽器快取寫入失敗',error));
    return {blob,meta,source:'cloud'};
  }

  async function loadTemplateFile(meta,onProgress){
    if(!meta) return null;
    const cached=await cacheGet().catch(()=>null);
    if(cached?.blob instanceof Blob&&cached.meta?.contentHash===meta.contentHash&&cached.blob.size===Number(meta.fileSize)){
      return {blob:cached.blob,meta,source:'cache'};
    }
    return loadChunks(meta,onProgress);
  }

  function validateTemplateFile(file){
    const name=String(file?.name||'');
    if(!(file instanceof Blob)||!name) throw new Error('Vui lòng chọn tệp mẫu Excel.\n請選擇 Excel（表格檔）裁片主檔。');
    if(!/\.xlsx$/i.test(name)) throw new Error('Mẫu cắt chi tiết chỉ nhận tệp .xlsx.\n裁片主檔只接受 .xlsx 檔案。');
    if(file.size<1) throw new Error('Tệp mẫu không có nội dung.\n裁片主檔沒有內容。');
    if(file.size>MAX_FILE_BYTES) throw new Error('Tệp mẫu vượt quá giới hạn 100 MB.\n裁片主檔超過 100 MB 上限。');
  }

  function logFor(input){
    const log=window.PCMSHistory?.buildOperationLog?.(input);
    if(!log) throw new Error('Chức năng lịch sử chưa sẵn sàng.\n歷史紀錄功能尚未就緒。');
    return log;
  }

  async function saveTemplate(file,summary={},onProgress){
    requireCloud();
    validateTemplateFile(file);
    const current=await loadMeta({force:true});
    if(typeof onProgress==='function') onProgress({stage:'hash',percent:8});
    const [contentHash,base64]=await Promise.all([sha256Hex(file),blobToBase64(file)]);
    const chunks=splitBase64(base64);
    if(chunks.length>MAX_CHUNKS) throw new Error('Tệp mẫu có quá nhiều phần dữ liệu.\n裁片主檔分塊數量超過安全上限。');
    const now=Date.now();
    const user=window.firebaseAuthUser;
    const meta={
      templateId:TEMPLATE_ID,
      schemaVersion:1,
      fileName:String(file.name).slice(0,300),
      fileSize:file.size,
      contentType:file.type||DEFAULT_CONTENT_TYPE,
      contentHash,
      chunkCount:chunks.length,
      createdAt:Number(current?.createdAt)||now,
      updatedAt:now,
      updatedByUid:user.uid,
      updatedBy:String(window.cu?.user||user.displayName||user.email||user.uid).slice(0,200),
      summary:{
        sheetName:String(summary.sheetName||'').slice(0,200),
        productCount:Number(summary.productCount)||0,
        sizeCount:Number(summary.sizeCount)||0,
        materialCount:Number(summary.materialCount)||0,
        pieceCount:Number(summary.pieceCount)||0,
        imageGroupCount:Number(summary.imageGroupCount)||0
      }
    };
    const log=logFor({
      permissionKey:'cutting',feature:'pieceCutting',action:'pieceCuttingTemplateImport',status:'success',
      itemCount:meta.summary.productCount,detailCount:meta.summary.pieceCount,fileName:meta.fileName,
      overwriteCount:current?1:0,note:`${chunks.length} chunks`
    });
    const logReference=window._newDocRef('operationLogs');
    const batch=window._writeBatch();
    chunks.forEach((data,index)=>batch.set(window._doc(CHUNK_COLLECTION,chunkId(index)),{
      templateId:TEMPLATE_ID,index,data,contentHash,updatedAt:now
    }));
    const oldCount=Number(current?.chunkCount)||0;
    for(let index=chunks.length;index<oldCount;index+=1) batch.delete(window._doc(CHUNK_COLLECTION,chunkId(index)));
    batch.set(window._doc(TEMPLATE_COLLECTION,TEMPLATE_ID),meta);
    batch.set(logReference,log);
    if(typeof onProgress==='function') onProgress({stage:'upload',percent:55,total:chunks.length});
    await batch.commit();
    const savedLog={id:logReference.id,...log};
    window.PCMSHistory.rememberOperationLog(savedLog);
    await cachePut(file,meta).catch(error=>console.warn('裁片主檔瀏覽器快取寫入失敗',error));
    metaState={loaded:true,value:{id:TEMPLATE_ID,...meta},promise:null,requestId:metaState.requestId+1};
    if(typeof onProgress==='function') onProgress({stage:'done',percent:100,total:chunks.length});
    return metaState.value;
  }

  async function removeTemplate(){
    requireCloud();
    const current=await loadMeta({force:true});
    if(!current){ await cacheDelete().catch(()=>false); return false; }
    const log=logFor({
      permissionKey:'cutting',feature:'pieceCutting',action:'pieceCuttingTemplateDelete',status:'success',
      itemCount:Number(current.summary?.productCount)||0,detailCount:Number(current.summary?.pieceCount)||0,
      fileName:current.fileName||'',note:`${Number(current.chunkCount)||0} chunks`
    });
    const logReference=window._newDocRef('operationLogs');
    const batch=window._writeBatch();
    for(let index=0;index<(Number(current.chunkCount)||0);index+=1) batch.delete(window._doc(CHUNK_COLLECTION,chunkId(index)));
    batch.delete(window._doc(TEMPLATE_COLLECTION,TEMPLATE_ID));
    batch.set(logReference,log);
    await batch.commit();
    window.PCMSHistory.rememberOperationLog({id:logReference.id,...log});
    await cacheDelete().catch(()=>false);
    metaState={loaded:true,value:null,promise:null,requestId:metaState.requestId+1};
    return true;
  }

  function resetSession(){
    metaState={loaded:false,value:null,promise:null,requestId:metaState.requestId+1};
  }

  window.PCMSPieceCuttingStore=Object.freeze({
    TEMPLATE_ID,CHUNK_CHAR_SIZE,MAX_FILE_BYTES,MAX_CHUNKS,
    loadMeta,loadTemplateFile,saveTemplate,removeTemplate,resetSession,
    sha256Hex,blobToBase64,base64ToBlob,splitBase64,chunkId
  });
})();
