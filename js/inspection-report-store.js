// inspection-report-store（檢驗報告範本資料層）：只保存一份有效範本，不建立瀏覽器持久快取。
(function(){
  'use strict';
  const TEMPLATE_COLLECTION='inspectionReportTemplates';
  const CHUNK_COLLECTION='inspectionReportTemplateChunks';
  const TEMPLATE_ID='main';
  const CHUNK_CHARS=650000;
  const MAX_BYTES=5*1024*1024;
  const MAX_CHUNKS=12;
  const CONTENT_TYPE='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function requireCloud(){
    if(!window.firebaseAuthUser?.uid||!window._getDocs||!window._getDoc||!window._runTransaction){
      throw new Error('Chưa thể kết nối mẫu báo cáo.\n尚無法連接檢驗報告範本。');
    }
  }
  function chunkId(index){return `${TEMPLATE_ID}_${String(index).padStart(5,'0')}`;}
  function splitBase64(value){
    const chunks=[];
    for(let index=0;index<value.length;index+=CHUNK_CHARS) chunks.push(value.slice(index,index+CHUNK_CHARS));
    return chunks;
  }
  async function hashBlob(blob){
    if(!window.crypto?.subtle) throw new Error('Trình duyệt không hỗ trợ kiểm tra tệp.\n瀏覽器不支援檔案驗證。');
    const digest=await window.crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  }
  function blobToBase64(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||'').split(',').pop()||'');
      reader.onerror=()=>reject(reader.error||new Error('Không thể đọc tệp.\n無法讀取檔案。'));
      reader.readAsDataURL(blob);
    });
  }
  function base64ToBlob(value){
    const parts=[];
    for(let offset=0;offset<value.length;offset+=65536){
      const binary=atob(value.slice(offset,offset+65536));
      const bytes=new Uint8Array(binary.length);
      for(let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
      parts.push(bytes);
    }
    return new Blob(parts,{type:CONTENT_TYPE});
  }
  function validateFile(file){
    if(!(file instanceof Blob)||!String(file.name||'').match(/\.xlsx$/i)){
      throw new Error('Chỉ nhận mẫu Excel .xlsx.\n範本只接受 .xlsx 表格檔。');
    }
    if(file.size<1||file.size>MAX_BYTES){
      throw new Error('Mẫu phải lớn hơn 0 và không vượt 5 MB.\n範本必須有內容且不超過 5 MB。');
    }
  }
  // listActive（列出最多兩份範本）：第二份只用於阻止匯出，不自行猜測要選哪份。
  async function listActive(){
    requireCloud();
    const query=window._query(window._collection(TEMPLATE_COLLECTION),window._limit(2));
    const snapshot=await window._getDocs(query);
    return (snapshot.docs||[]).map(doc=>({id:doc.id,...doc.data()}));
  }
  async function loadOnly(){
    const rows=await listActive();
    if(rows.length>1) throw new Error('Hiện có hai mẫu báo cáo. Vui lòng kiểm tra.\n目前存在兩個範本，請檢查。');
    return rows[0]||null;
  }
  async function loadFile(meta){
    requireCloud();
    if(!meta||meta.id!==TEMPLATE_ID||meta.templateId!==TEMPLATE_ID){
      throw new Error('Mẫu báo cáo không hợp lệ.\n檢驗報告範本不正確。');
    }
    const count=Number(meta.chunkCount);
    if(!Number.isInteger(count)||count<1||count>MAX_CHUNKS){
      throw new Error('Số phần của mẫu không hợp lệ.\n範本分段數量不正確。');
    }
    const pieces=[];
    for(let index=0;index<count;index++){
      const snapshot=await window._getDoc(window._doc(CHUNK_COLLECTION,chunkId(index)));
      const item=snapshot.exists()?snapshot.data():null;
      if(!item||item.templateId!==TEMPLATE_ID||item.index!==index||item.contentHash!==meta.contentHash){
        throw new Error('Mẫu đã thay đổi hoặc thiếu nội dung. Hãy thử lại.\n範本已變更或內容不完整，請重試。');
      }
      pieces.push(String(item.data||''));
    }
    const blob=base64ToBlob(pieces.join(''));
    if(blob.size!==Number(meta.fileSize)||await hashBlob(blob)!==meta.contentHash){
      throw new Error('Nội dung mẫu không khớp.\n範本內容驗證不一致。');
    }
    return blob;
  }
  async function saveFile(file,sheetName,expectedMeta=null){
    requireCloud();validateFile(file);
    const current=await loadOnly();
    if(current&&current.id!==TEMPLATE_ID) throw new Error('Mẫu báo cáo không đúng vị trí.\n檢驗報告範本位置不正確。');
    const [contentHash,base64]=await Promise.all([hashBlob(file),blobToBase64(file)]);
    const chunks=splitBase64(base64);
    if(chunks.length<1||chunks.length>MAX_CHUNKS) throw new Error('Mẫu có quá nhiều phần.\n範本分段過多。');
    const now=Date.now();
    const actor=window.firebaseAuthUser;
    const meta={
      templateId:TEMPLATE_ID,schemaVersion:1,fileName:String(file.name).slice(0,300),fileSize:file.size,
      contentType:CONTENT_TYPE,contentHash,chunkCount:chunks.length,sheetName:String(sheetName||'').slice(0,200),
      createdAt:Number(current?.createdAt)||now,updatedAt:now,updatedByUid:actor.uid,
      updatedBy:String(window.cu?.user||actor.displayName||actor.email||actor.uid).slice(0,200)
    };
    const log=window.PCMSHistory?.buildOperationLog?.({
      permissionKey:'progress',feature:'inspectionReport',action:'inspectionTemplateImport',status:'success',
      itemCount:1,detailCount:chunks.length,overwriteCount:current?1:0,fileName:meta.fileName,
      note:current?`Replace ${current.fileName}`:'First template'
    });
    if(!log) throw new Error('Không thể ghi lịch sử thao tác.\n無法建立操作紀錄。');
    const logRef=window._newDocRef('operationLogs');
    // 同一交易重新核對範本版本，避免其他使用者在確認視窗後先行替換而被無聲覆蓋。
    await window._runTransaction(async transaction=>{
      const metaRef=window._doc(TEMPLATE_COLLECTION,TEMPLATE_ID);
      const snapshot=await transaction.get(metaRef);
      const latest=snapshot.exists()?snapshot.data():null;
      if(String(latest?.contentHash||'')!==String(expectedMeta?.contentHash||'')
        ||Number(latest?.updatedAt||0)!==Number(expectedMeta?.updatedAt||0)
        ||String(latest?.fileName||'')!==String(expectedMeta?.fileName||'')){
        throw new Error('Mẫu đã được người khác thay đổi. Hãy kiểm tra rồi xác nhận lại.\n範本已由其他人更改，請重新檢查並確認。');
      }
      chunks.forEach((data,index)=>transaction.set(window._doc(CHUNK_COLLECTION,chunkId(index)),{
        templateId:TEMPLATE_ID,index,data,contentHash,updatedAt:now
      }));
      for(let index=chunks.length;index<Number(latest?.chunkCount||0);index++) transaction.delete(window._doc(CHUNK_COLLECTION,chunkId(index)));
      transaction.set(metaRef,meta);
      transaction.set(logRef,log);
    });
    window.PCMSHistory.rememberOperationLog({id:logRef.id,...log});
    return {id:TEMPLATE_ID,...meta};
  }
  // removeFile（刪除範本）：主檔、全部分段與不可修改的操作紀錄同一交易完成。
  async function removeFile(expectedMeta){
    requireCloud();
    if(expectedMeta?.id!==TEMPLATE_ID||expectedMeta?.templateId!==TEMPLATE_ID){
      throw new Error('Mẫu báo cáo không hợp lệ.\n檢驗報告範本不正確。');
    }
    const current=await loadOnly();
    if(!current||current.id!==TEMPLATE_ID){
      throw new Error('Mẫu không còn tồn tại. Hãy tải lại trang.\n範本已不存在，請重新整理頁面。');
    }
    const actor=window.firebaseAuthUser;
    const log=window.PCMSHistory?.buildOperationLog?.({
      permissionKey:'progress',feature:'inspectionReport',action:'inspectionTemplateDelete',status:'success',
      itemCount:1,detailCount:Number(current.chunkCount)||0,fileName:String(current.fileName||'')
    });
    if(!log) throw new Error('Không thể ghi lịch sử thao tác.\n無法建立操作紀錄。');
    const logRef=window._newDocRef('operationLogs');
    await window._runTransaction(async transaction=>{
      const metaRef=window._doc(TEMPLATE_COLLECTION,TEMPLATE_ID);
      const snapshot=await transaction.get(metaRef);
      const latest=snapshot.exists()?snapshot.data():null;
      if(!latest||String(latest.contentHash)!==String(expectedMeta.contentHash)
        ||Number(latest.updatedAt)!==Number(expectedMeta.updatedAt)
        ||String(latest.fileName)!==String(expectedMeta.fileName)){
        throw new Error('Mẫu đã được thay đổi. Hãy kiểm tra rồi xác nhận lại.\n範本已變更，請重新檢查並確認。');
      }
      const count=Number(latest.chunkCount);
      if(!Number.isInteger(count)||count<1||count>MAX_CHUNKS){
        throw new Error('Số phần của mẫu không hợp lệ.\n範本分段數量不正確。');
      }
      for(let index=0;index<count;index++) transaction.delete(window._doc(CHUNK_COLLECTION,chunkId(index)));
      transaction.delete(metaRef);
      transaction.set(logRef,log);
    });
    window.PCMSHistory.rememberOperationLog({id:logRef.id,...log});
    return {fileName:current.fileName,deletedByUid:actor.uid};
  }
  window.PCMSInspectionReportStore=Object.freeze({
    TEMPLATE_ID,CHUNK_CHARS,MAX_BYTES,MAX_CHUNKS,validateFile,listActive,loadOnly,loadFile,saveFile,removeFile,
    hashBlob,splitBase64,chunkId
  });
})();
