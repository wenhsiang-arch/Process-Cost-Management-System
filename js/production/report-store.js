// report-store（產能紀錄查詢程式）：歷史資料只依日期與頁面按需讀取。
(function(){
  'use strict';

  const COLLECTION_NAME = 'productionEntries'; // COLLECTION_NAME（產能登記集合名稱）
  const PAGE_SIZE = 50; // PAGE_SIZE（每頁筆數）
  const EXACT_PAGE_SIZE = 200; // EXACT_PAGE_SIZE（單日完整查詢每次讀取筆數）
  let historyCursor = null; // historyCursor（歷史查詢游標）
  let historySignature = ''; // historySignature（目前查詢條件）
  const exactPromises = new Map(); // exactPromises（相同單日查詢共用工作）

  function normalizeDate(value){ return String(value || '').trim(); }
  function normalizeEmployeeId(value){
    return window.PCMSProductionEmployees?.normalizeEmployeeId?.(value) || String(value || '').trim().toUpperCase();
  }

  function sortRows(rows){
    return rows.slice().sort((a,b)=>{
      const dateCompare = String(b.productionDate || '').localeCompare(String(a.productionDate || ''));
      return dateCompare || (Number(b.createdAt)||0)-(Number(a.createdAt)||0);
    });
  }

  async function loadExactRows(key,conditions){
    if(exactPromises.has(key)) return exactPromises.get(key);
    const promise = (async()=>{
      const rows = [];
      let cursor = null;
      do{
        const queryConditions = conditions.slice();
        if(cursor) queryConditions.push(window._startAfter(cursor));
        queryConditions.push(window._limit(EXACT_PAGE_SIZE));
        const snapshot = await window._getDocs(window._query(window._collection(COLLECTION_NAME),...queryConditions));
        rows.push(...snapshot.docs.map(item=>({id:item.id,...item.data()})));
        cursor = snapshot.size === EXACT_PAGE_SIZE ? snapshot.docs[snapshot.docs.length-1] : null;
      }while(cursor);
      return sortRows(rows);
    })().finally(()=>exactPromises.delete(key));
    exactPromises.set(key,promise);
    return promise;
  }

  async function loadDaily(employeeId,productionDate){
    const normalizedEmployeeId = normalizeEmployeeId(employeeId);
    const normalizedDate = normalizeDate(productionDate);
    if(!normalizedEmployeeId || !normalizedDate) return [];
    const rows = await loadExactRows(`employee:${normalizedEmployeeId}:${normalizedDate}`,[
      window._where('employeeId','==',normalizedEmployeeId),
      window._where('productionDate','==',normalizedDate)
    ]);
    return rows.filter(item=>item.status === 'active');
  }

  async function loadDay(productionDate,options={}){
    const normalizedDate = normalizeDate(productionDate);
    if(!normalizedDate) return [];
    const rows = await loadExactRows(`date:${normalizedDate}`,[
      window._where('productionDate','==',normalizedDate)
    ]);
    return options.activeOnly === false ? rows : rows.filter(item=>item.status === 'active');
  }

  function buildSignature(filters){
    return JSON.stringify({
      from:normalizeDate(filters?.from),
      to:normalizeDate(filters?.to),
      employeeId:normalizeEmployeeId(filters?.employeeId)
    });
  }

  async function loadHistory(filters={},options={}){
    const from = normalizeDate(filters.from);
    const to = normalizeDate(filters.to);
    if(!from || !to || from > to) throw new Error('Khoảng ngày không hợp lệ. / 日期範圍不正確。');
    const employeeId = normalizeEmployeeId(filters.employeeId);
    const signature = buildSignature({from,to,employeeId});
    if(options.loadMore !== true || signature !== historySignature){
      historyCursor = null;
      historySignature = signature;
    }
    const conditions = [
      window._where('productionDate','>=',from),
      window._where('productionDate','<=',to)
    ];
    if(employeeId) conditions.unshift(window._where('employeeId','==',employeeId));
    conditions.push(window._orderBy('productionDate','desc'));
    if(historyCursor) conditions.push(window._startAfter(historyCursor));
    conditions.push(window._limit(PAGE_SIZE));
    const snapshot = await window._getDocs(window._query(window._collection(COLLECTION_NAME),...conditions));
    historyCursor = snapshot.docs.length ? snapshot.docs[snapshot.docs.length-1] : null;
    const rows = sortRows(snapshot.docs.map(item=>({id:item.id,...item.data()})));
    return {rows,hasMore:snapshot.size === PAGE_SIZE,pageSize:PAGE_SIZE};
  }

  function filterRows(rows,filters={}){
    const orderNeedle = String(filters.order || '').trim().toLocaleLowerCase();
    const productNeedle = String(filters.product || '').trim().toLocaleLowerCase();
    const processNeedle = String(filters.process || '').trim().toLocaleLowerCase();
    const status = String(filters.status || '').trim();
    return (Array.isArray(rows)?rows:[]).filter(item=>{
      if(orderNeedle && !String(item.orderNo || '').toLocaleLowerCase().includes(orderNeedle)) return false;
      if(productNeedle && !String(item.productCode || '').toLocaleLowerCase().includes(productNeedle)) return false;
      if(processNeedle && ![item.processNo,item.processNameVi,item.processNameZh,item.supplementReason].some(value=>String(value || '').toLocaleLowerCase().includes(processNeedle))) return false;
      if(status && item.status !== status) return false;
      return true;
    });
  }

  function reset(){ historyCursor = null; historySignature = ''; exactPromises.clear(); }

  window.PCMSProductionReports = Object.freeze({loadDaily,loadDay,loadHistory,filterRows,reset,pageSize:PAGE_SIZE});
})();
