// report-store（產能紀錄查詢程式）：歷史資料只依日期與頁面按需讀取。
(function(){
  'use strict';

  const COLLECTION_NAME = 'productionEntries'; // COLLECTION_NAME（產能登記集合名稱）
  const PAGE_SIZE = 50; // PAGE_SIZE（每頁筆數）
  const EXACT_PAGE_SIZE = 200; // EXACT_PAGE_SIZE（精確條件完整查詢每次讀取筆數）
  let historyCursor = null; // historyCursor（歷史查詢游標）
  let historySignature = ''; // historySignature（目前查詢條件）
  const exactPromises = new Map(); // exactPromises（相同單日查詢共用工作）

  function normalizeDate(value){ return String(value || '').trim(); }
  function normalizeEmployeeId(value){
    return window.PCMSProductionEmployees?.normalizeEmployeeId?.(value) || String(value || '').trim().toUpperCase();
  }
  function normalizeSearch(value){ return String(value ?? '').trim().toLocaleLowerCase(); }
  function searchTokens(value){ return normalizeSearch(value).split(/\s+/).filter(Boolean); }
  function searchableRowText(item){
    const dateParts = String(item.productionDate || '').split('-');
    const displayDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : '';
    const statusText = item.status === 'active'
      ? 'active hiệu lực 有效'
      : item.status === 'voided' ? 'voided đã hủy 已作廢' : item.status;
    return [
      item.productionDate,displayDate,item.employeeId,item.displayEmployeeName,item.employeeName,item.department,
      item.orderNo,item.productCode,item.processNo,item.processNameVi,item.processNameZh,item.supplementReason,
      item.quantity,item.supplementHours,item.orderQuantitySnapshot,item.processSecSnapshot,item.hourlyCapacitySnapshot,
      item.displayEfficiency,statusText
    ].map(normalizeSearch).join(' ');
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

  async function loadDaily(employeeId,productionDate,options={}){
    const normalizedEmployeeId = normalizeEmployeeId(employeeId);
    const normalizedDate = normalizeDate(productionDate);
    if(!normalizedEmployeeId || !normalizedDate) return [];
    const rows = await loadExactRows(`employee:${normalizedEmployeeId}:${normalizedDate}`,[
      window._where('employeeId','==',normalizedEmployeeId),
      window._where('productionDate','==',normalizedDate)
    ]);
    return options.activeOnly === false ? rows : rows.filter(item=>item.status === 'active');
  }

  async function loadDay(productionDate,options={}){
    const normalizedDate = normalizeDate(productionDate);
    if(!normalizedDate) return [];
    const rows = await loadExactRows(`date:${normalizedDate}`,[
      window._where('productionDate','==',normalizedDate)
    ]);
    return options.activeOnly === false ? rows : rows.filter(item=>item.status === 'active');
  }

  async function loadProcess(orderProcessId,options={}){
    const processId = String(orderProcessId || '').trim();
    if(!processId) return [];
    const rows = await loadExactRows(`process:${processId}`,[
      window._where('orderProcessId','==',processId)
    ]);
    return options.activeOnly === false ? rows : rows.filter(item=>item.status === 'active');
  }

  async function loadRange(fromValue,toValue,options={}){
    const from = normalizeDate(fromValue);
    const to = normalizeDate(toValue);
    if(!from || !to || from > to) throw new Error('Khoảng ngày không hợp lệ. / 日期範圍不正確。');
    const rows = await loadExactRows(`range:${from}:${to}`,[
      window._where('productionDate','>=',from),
      window._where('productionDate','<=',to),
      window._orderBy('productionDate','desc')
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
    const tokens = searchTokens(filters.search);
    const orderNeedle = String(filters.order || '').trim().toLocaleLowerCase();
    const productNeedle = String(filters.product || '').trim().toLocaleLowerCase();
    const processNeedle = String(filters.process || '').trim().toLocaleLowerCase();
    const status = String(filters.status || '').trim();
    return (Array.isArray(rows)?rows:[]).filter(item=>{
      if(tokens.length){
        const searchable = searchableRowText(item);
        if(!tokens.every(token=>searchable.includes(token))) return false;
      }
      if(orderNeedle && !String(item.orderNo || '').toLocaleLowerCase().includes(orderNeedle)) return false;
      if(productNeedle && !String(item.productCode || '').toLocaleLowerCase().includes(productNeedle)) return false;
      if(processNeedle && ![item.processNo,item.processNameVi,item.processNameZh,item.supplementReason].some(value=>String(value || '').toLocaleLowerCase().includes(processNeedle))) return false;
      if(status && item.status !== status) return false;
      return true;
    });
  }

  function reset(){ historyCursor = null; historySignature = ''; exactPromises.clear(); }

  window.PCMSProductionReports = Object.freeze({loadDaily,loadDay,loadProcess,loadRange,loadHistory,filterRows,reset,pageSize:PAGE_SIZE});
})();
