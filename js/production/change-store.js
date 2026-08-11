// change-store（產能日期變動索引）：只記錄哪位員工哪一天有變動，供生產分析增量更新。
(function(){
  'use strict';

  const COLLECTION_NAME='productionDayChanges';
  const PAGE_SIZE=200;
  const OVERLAP_MS=60*1000;

  function normalizeText(value){ return String(value||'').trim(); }
  function normalizeEmployeeId(value){
    return window.PCMSProductionEmployees?.normalizeEmployeeId?.(value)
      || normalizeText(value).toUpperCase();
  }
  function validDate(value){ return /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value); }
  function documentId(productionDate,employeeId){ return `${productionDate}__${employeeId}`; }
  function normalizeChanges(changes){
    const unique=new Map();
    (Array.isArray(changes)?changes:[]).forEach(item=>{
      const productionDate=normalizeText(item?.productionDate||item?.attendanceDate);
      const employeeId=normalizeEmployeeId(item?.employeeId);
      if(!validDate(productionDate)||!employeeId) return;
      unique.set(documentId(productionDate,employeeId),{productionDate,employeeId});
    });
    return [...unique.values()];
  }
  function timestampMillis(value){
    if(value&&typeof value.toMillis==='function') return value.toMillis();
    const parsed=value instanceof Date?value.getTime():Number(value);
    return Number.isFinite(parsed)&&parsed>0?parsed:0;
  }

  async function mark(changes){
    const rows=normalizeChanges(changes);
    const uid=normalizeText(window.firebaseAuthUser?.uid);
    if(!rows.length||!uid||!window._writeBatch||!window._serverTimestamp) return false;
    const batch=window._writeBatch();
    rows.forEach(row=>{
      const id=documentId(row.productionDate,row.employeeId);
      batch.set(window._docRef(COLLECTION_NAME,id),{
        changeId:id,
        productionDate:row.productionDate,
        employeeId:row.employeeId,
        changedAt:window._serverTimestamp(),
        changedByUid:uid,
        schemaVersion:1
      },{merge:true});
    });
    await batch.commit();
    return true;
  }

  // markSafely（安全寫入變動索引）：索引失敗只會使分析改用完整更新，不可阻擋正式產能資料。
  async function markSafely(changes){
    try{ return await mark(changes); }
    catch(error){
      console.warn('無法更新 productionDayChanges（產能日期變動索引），分析將在需要時完整更新：',error);
      return false;
    }
  }

  async function loadSince(lastChangedAtMs){
    const threshold=Math.max(0,Number(lastChangedAtMs)||0)-OVERLAP_MS;
    const rows=[];
    let cursor=null;
    do{
      const conditions=[
        window._where('changedAt','>',new Date(threshold)),
        window._orderBy('changedAt','asc')
      ];
      if(cursor) conditions.push(window._startAfter(cursor));
      conditions.push(window._limit(PAGE_SIZE));
      const snapshot=await window._getDocs(window._query(window._collection(COLLECTION_NAME),...conditions));
      rows.push(...snapshot.docs.map(item=>{
        const data=item.data();
        return {id:item.id,...data,changedAtMs:timestampMillis(data.changedAt)};
      }));
      cursor=snapshot.size===PAGE_SIZE?snapshot.docs[snapshot.docs.length-1]:null;
    }while(cursor);
    const newest=rows.reduce((max,item)=>Math.max(max,item.changedAtMs||0),Number(lastChangedAtMs)||0);
    return {rows,cursorMs:newest,hasNew:rows.some(item=>(item.changedAtMs||0)>(Number(lastChangedAtMs)||0))};
  }

  async function latestCursor(){
    const snapshot=await window._getDocs(window._query(
      window._collection(COLLECTION_NAME),window._orderBy('changedAt','desc'),window._limit(1)
    ));
    if(snapshot.empty) return 0;
    return timestampMillis(snapshot.docs[0].data()?.changedAt);
  }

  window.PCMSProductionChanges=Object.freeze({mark,markSafely,loadSince,latestCursor,documentId});
})();
