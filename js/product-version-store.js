// product-version-store（款號版本資料存取）：每次正式異動保存可獨立下載的完整款號快照。
(function(){
  'use strict';

  const VERSION_COLLECTION='productVersions';
  const CHUNK_COLLECTION='productVersionChunks';
  const BASELINE_ID='baseline';
  const MAX_CHUNK_BYTES=480000;
  const MAX_VERSION_WRITES=450;
  let baselinePromise=null;

  function currentUserId(){ return String(window.firebaseAuthUser?.uid||''); }
  function currentUserName(){ return String(window.cu?.user||window.cu?.username||window.firebaseAuthUser?.displayName||''); }

  function jsonBytes(value){
    const content=typeof value==='string'?value:JSON.stringify(value);
    return typeof TextEncoder==='function'?new TextEncoder().encode(content).length:content.length*3;
  }

  function makeChunks(items){
    const chunks=[];
    let current=[];
    let currentBytes=2;
    (Array.isArray(items)?items:[]).forEach(item=>{
      const normalized=window.PCMSProductModel.normalizeProduct(item);
      const itemText=JSON.stringify(normalized);
      const itemBytes=jsonBytes(itemText)+(current.length?1:0);
      if(itemBytes>MAX_CHUNK_BYTES) throw new Error(`Mã hàng ${normalized.code} vượt quá giới hạn dữ liệu. / 款號 ${normalized.code} 的資料超過安全上限。`);
      if(current.length&&currentBytes+itemBytes>MAX_CHUNK_BYTES){
        chunks.push(current);
        current=[];
        currentBytes=2;
      }
      current.push(normalized);
      currentBytes+=itemBytes;
    });
    if(current.length||!chunks.length) chunks.push(current);
    return chunks;
  }

  function buildSnapshot(versionId,items,details={}){
    const normalizedItems=(Array.isArray(items)?items:[]).map(window.PCMSProductModel.normalizeProduct)
      .filter(item=>item.code).sort((a,b)=>a.code.localeCompare(b.code));
    const chunkItems=makeChunks(normalizedItems);
    if(chunkItems.length>MAX_VERSION_WRITES) throw new Error('Phiên bản mã hàng có quá nhiều khối dữ liệu. / 款號版本的資料區塊過多。');
    const now=Number(details.createdAt)||Date.now();
    const record={
      versionId:String(versionId),
      sequence:Number(details.sequence)||0,
      productVersion:String(details.productVersion||''),
      type:String(details.type||'snapshot'),
      action:String(details.action||'update'),
      status:'ready',
      productCount:normalizedItems.length,
      opCount:normalizedItems.reduce((sum,item)=>sum+item.ops.length,0),
      chunkCount:chunkItems.length,
      reason:String(details.reason||'').slice(0,500),
      fileName:String(details.fileName||'').slice(0,300),
      createdAt:now,
      createdByUid:String(details.createdByUid||currentUserId()),
      createdBy:String(details.createdBy||currentUserName()).slice(0,200)
    };
    const chunks=chunkItems.map((chunk,index)=>({
      chunkId:`${record.versionId}-${String(index).padStart(4,'0')}`,
      versionId:record.versionId,
      chunkIndex:index,
      itemCount:chunk.length,
      data:JSON.stringify(chunk),
      createdAt:now,
      createdByUid:record.createdByUid
    }));
    return {record,chunks,items:normalizedItems};
  }

  async function ensureBaseline(items,meta){
    if(baselinePromise) return baselinePromise;
    baselinePromise=(async()=>{
      const reference=window._docRef(VERSION_COLLECTION,BASELINE_ID);
      const existing=await window._getDoc(reference);
      if(existing.exists()) return {id:existing.id,...existing.data()};
      const snapshot=buildSnapshot(BASELINE_ID,items,{
        sequence:Number(meta?.changeSequence)||0,
        productVersion:String(meta?.version||''),
        type:'baseline',
        action:'baseline',
        reason:'Khởi tạo lịch sử phiên bản / 建立版本歷史基準'
      });
      const batch=window._writeBatch();
      batch.set(reference,snapshot.record);
      snapshot.chunks.forEach(chunk=>batch.set(window._docRef(CHUNK_COLLECTION,chunk.chunkId),chunk));
      try{
        await batch.commit();
      }catch(error){
        const concurrent=await window._getDoc(reference);
        if(concurrent.exists()) return {id:concurrent.id,...concurrent.data()};
        throw error;
      }
      return snapshot.record;
    })().finally(()=>{ baselinePromise=null; });
    return baselinePromise;
  }

  async function listVersions(maximum=100){
    const count=Math.max(1,Math.min(Number(maximum)||100,200));
    const snapshot=await window._getDocs(window._query(
      window._collection(VERSION_COLLECTION),window._orderBy('sequence','desc'),window._limit(count)
    ));
    return snapshot.docs.map(item=>({id:item.id,...item.data()}));
  }

  async function loadSnapshot(versionId){
    const id=String(versionId||'').trim();
    if(!id) throw new Error('Thiếu phiên bản mã hàng. / 缺少款號版本。');
    const versionSnapshot=await window._getDoc(window._docRef(VERSION_COLLECTION,id));
    if(!versionSnapshot.exists()) throw new Error('Không tìm thấy phiên bản mã hàng. / 找不到款號版本。');
    const version={id:versionSnapshot.id,...versionSnapshot.data()};
    if(version.status!=='ready') throw new Error('Phiên bản này chưa hoàn tất. / 此版本尚未完成。');
    const chunkSnapshot=await window._getDocs(window._query(
      window._collection(CHUNK_COLLECTION),window._where('versionId','==',id)
    ));
    const chunks=chunkSnapshot.docs.map(item=>item.data()).sort((a,b)=>Number(a.chunkIndex)-Number(b.chunkIndex));
    if(chunks.length!==Number(version.chunkCount)) throw new Error('Phiên bản thiếu khối dữ liệu. / 版本資料區塊不完整。');
    const items=[];
    chunks.forEach(chunk=>{
      const parsed=JSON.parse(String(chunk.data||'[]'));
      if(!Array.isArray(parsed)) throw new Error('Định dạng phiên bản không hợp lệ. / 版本資料格式錯誤。');
      parsed.forEach(item=>items.push(window.PCMSProductModel.normalizeProduct(item)));
    });
    return {version,items};
  }

  window.PCMSProductVersionStore=Object.freeze({
    VERSION_COLLECTION,
    CHUNK_COLLECTION,
    BASELINE_ID,
    buildSnapshot,
    ensureBaseline,
    listVersions,
    loadSnapshot
  });
})();
