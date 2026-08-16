// report-store（產能紀錄查詢程式）：歷史資料只依日期與頁面按需讀取。
(function(){
  'use strict';

  const COLLECTION_NAME = 'productionEntries'; // COLLECTION_NAME（產能登記集合名稱）
  const MONTH_COLLECTION_NAME = 'productionMonths'; // MONTH_COLLECTION_NAME（唯一月份狀態與版本來源）
  const PAGE_SIZE = 50; // PAGE_SIZE（每頁筆數）
  const EXACT_PAGE_SIZE = 200; // EXACT_PAGE_SIZE（精確條件完整查詢每次讀取筆數）
  const CACHE_PREFIX = 'productionEntriesQuery:'; // CACHE_PREFIX（依查詢條件分開保存的產能紀錄快取）
  let historyCursor = null; // historyCursor（歷史查詢游標）
  let historySignature = ''; // historySignature（目前查詢條件）
  const exactPromises = new Map(); // exactPromises（相同單日查詢共用工作）
  const exactCache = new Map(); // exactCache（目前工作階段已完成的精確查詢）

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

  function monthsBetween(fromValue,toValue){
    const from=normalizeDate(fromValue).slice(0,7);
    const to=normalizeDate(toValue).slice(0,7);
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(from)||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(to)||from>to) return [];
    const result=[];
    let [year,month]=from.split('-').map(Number);
    while(result.length<240){
      const value=`${year}-${String(month).padStart(2,'0')}`;
      result.push(value);
      if(value===to) break;
      month+=1;
      if(month===13){ year+=1;month=1; }
    }
    return result;
  }

  async function readMonthVersions(months){
    const normalized=[...new Set((months||[]).map(value=>String(value||'').trim()).filter(Boolean))];
    const snapshots=await Promise.all(normalized.map(month=>window._getDoc(window._docRef(MONTH_COLLECTION_NAME,month))));
    return snapshots.map((snapshot,index)=>`${normalized[index]}:${snapshot.exists()?String(snapshot.data()?.entriesVersion||'0'):'0'}`).join('|');
  }

  function persistentScope(key){ return `${CACHE_PREFIX}${encodeURIComponent(key)}`; }

  async function loadExactRows(key,conditions,options={}){
    const months=Array.isArray(options.months)?options.months:[];
    const cacheable=months.length>0;
    const suppliedVersion=typeof options.version==='string';
    const version=suppliedVersion?options.version:(cacheable?await readMonthVersions(months):'uncached');
    const promiseKey=`${version}|${key}`;
    if(cacheable&&options.force!==true&&exactCache.has(promiseKey)) return exactCache.get(promiseKey).map(item=>({...item}));
    if(exactPromises.has(promiseKey)) return exactPromises.get(promiseKey);
    const promise = (async()=>{
      const scope=persistentScope(key);
      if(cacheable&&options.force===true) await window.pcmsDataCache?.remove(scope);
      if(cacheable&&options.force!==true&&window.pcmsDataCache){
        const cached=await window.pcmsDataCache.read(scope,version);
        if(Array.isArray(cached)){
          const rows=sortRows(cached);
          exactCache.set(promiseKey,rows);
          return rows.map(item=>({...item}));
        }
      }
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
      const sorted=sortRows(rows);
      window.PCMSUsageMetrics?.recordFullLoad?.({scope:COLLECTION_NAME});
      if(!cacheable) return sorted.map(item=>({...item}));
      if(suppliedVersion){
        await window.pcmsDataCache?.write(scope,version,sorted);
        exactCache.set(promiseKey,sorted);
        return sorted.map(item=>({...item}));
      }
      const latestVersion=await readMonthVersions(months);
      if(latestVersion!==version&&options.retry!==false){
        return loadExactRows(key,conditions,{...options,force:true,retry:false});
      }
      await window.pcmsDataCache?.write(scope,latestVersion,sorted);
      exactCache.set(`${latestVersion}|${key}`,sorted);
      return sorted.map(item=>({...item}));
    })().finally(()=>exactPromises.delete(promiseKey));
    exactPromises.set(promiseKey,promise);
    return promise;
  }

  async function loadDaily(employeeId,productionDate,options={}){
    const normalizedEmployeeId = normalizeEmployeeId(employeeId);
    const normalizedDate = normalizeDate(productionDate);
    if(!normalizedEmployeeId || !normalizedDate) return [];
    const rows = await loadExactRows(`employee:${normalizedEmployeeId}:${normalizedDate}`,[
      window._where('employeeId','==',normalizedEmployeeId),
      window._where('productionDate','==',normalizedDate)
    ],{...options,months:monthsBetween(normalizedDate,normalizedDate)});
    return options.activeOnly === false ? rows : rows.filter(item=>item.status === 'active');
  }

  async function loadEmployeeRange(employeeId,fromValue,toValue,options={}){
    const normalizedEmployeeId = normalizeEmployeeId(employeeId);
    const from = normalizeDate(fromValue);
    const to = normalizeDate(toValue);
    if(!normalizedEmployeeId || !from || !to || from > to){
      throw new Error('Khoảng ngày của nhân viên không hợp lệ. / 員工日期範圍不正確。');
    }
    const rows = await loadExactRows(`employeeRange:${normalizedEmployeeId}:${from}:${to}`,[
      window._where('employeeId','==',normalizedEmployeeId),
      window._where('productionDate','>=',from),
      window._where('productionDate','<=',to),
      window._orderBy('productionDate','desc')
    ],{...options,months:monthsBetween(from,to)});
    return options.activeOnly === false ? rows : rows.filter(item=>item.status === 'active');
  }

  async function loadDay(productionDate,options={}){
    const normalizedDate = normalizeDate(productionDate);
    if(!normalizedDate) return [];
    const rows = await loadExactRows(`date:${normalizedDate}`,[
      window._where('productionDate','==',normalizedDate)
    ],{...options,months:monthsBetween(normalizedDate,normalizedDate)});
    return options.activeOnly === false ? rows : rows.filter(item=>item.status === 'active');
  }

  async function loadProcess(orderProcessId,options={}){
    const processId = String(orderProcessId || '').trim();
    if(!processId) return [];
    const rows = await loadExactRows(`process:${processId}`,[
      window._where('orderProcessId','==',processId)
    ],options);
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
    ],{...options,months:monthsBetween(from,to)});
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

  function reset(){ historyCursor = null; historySignature = ''; exactPromises.clear(); exactCache.clear(); }

  window.PCMSProductionReports = Object.freeze({loadDaily,loadEmployeeRange,loadDay,loadProcess,loadRange,loadHistory,filterRows,reset,pageSize:PAGE_SIZE});
})();
