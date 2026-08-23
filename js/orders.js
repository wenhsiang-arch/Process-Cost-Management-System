// ===== 訂單系統資料 =====
window.allOrders    = [];
window.allProcesses = [];
let ordersLoadPromise = null;
const processLoadPromises = new Map(); // processLoadPromises（各訂單工序載入工作）
const loadedProcessVersions = new Map(); // loadedProcessVersions（已載入訂單工序版本）
let progressRenderSequence = 0;
let progressRenderTimer = null;
let ordersImportProgressController = null; // ordersImportProgressController（訂單匯入共用進度視窗控制介面）
let orderFileDropTargetRegistered = false; // orderFileDropTargetRegistered（訂單全視窗匯入用途是否已登記）
let orderImportFieldsBound = false; // orderImportFieldsBound（訂單必要資料自動接續檢查是否已綁定）
let pendingOrderImportFile = null; // pendingOrderImportFile（等待必要資料完成的訂單檔案）
let pendingOrderImportInput = null; // pendingOrderImportInput（本次訂單檔案選擇控制）
const ordersSafeText=value=>window.PCMSSafe.text(value); // ordersSafeText（訂單畫面安全文字）
const ordersSafeAttr=value=>window.PCMSSafe.attribute(value); // ordersSafeAttr（訂單畫面安全屬性）
const ordersInlineArg=value=>window.PCMSSafe.inlineArgument(value); // ordersInlineArg（訂單行內事件安全參數）
const ordersPairHtml=(vi,zh)=>`<span class="ui-bilingual"><span class="ui-text-vi">${ordersSafeText(vi)}</span><span class="ui-text-zh">${ordersSafeText(zh)}</span></span>`; // ordersPairHtml（訂單畫面可切換雙語文字）

function ordersMessage(vi,zh,kind='info'){
  return window.PCMSUIComponents.alertDialog({message:{vi:String(vi||''),zh:String(zh||'')},kind});
}
function ordersConfirm(titleVi,titleZh,vi,zh){
  return window.PCMSUIComponents.confirmDialog({
    title:{vi:titleVi,zh:titleZh},
    body:window.PCMSUIComponents.createLanguageSections({vi:String(vi||''),zh:String(zh||'')})
  });
}
function ordersSplitMessages(messages){
  return messages.reduce((result,message)=>{
    const value=String(message||'');
    const separator=value.lastIndexOf(' / ');
    result.vi.push(separator>=0?value.slice(0,separator):value);
    result.zh.push(separator>=0?value.slice(separator+3):value);
    return result;
  },{vi:[],zh:[]});
}

// showOrderFileDropMessage（顯示訂單拖曳結果）：格式或數量不符時顯示雙語原因。
function showOrderFileDropMessage(detail){
  const message=detail?.message||{vi:'Không thể nhận tệp',zh:'無法接收檔案'}; // message（拖曳拒絕原因）
  const pair=window.PCMSUIText?.resolve?.(message)||{vi:'Không thể nhận tệp',zh:'無法接收檔案'}; // pair（拒絕原因雙語文字）
  void ordersMessage(pair.vi,pair.zh,'warning');
}

function orderImportPrerequisitesComplete(){
  return !!g('imp-ord-id')?.value.trim()&&!!g('imp-ord-client')?.value&&!!g('imp-ord-date')?.value;
}

// tryProcessPendingOrderImport（接續訂單檢查）：檔案先拖入時，等訂單資料填完整後才進入既有檢查。
async function tryProcessPendingOrderImport(){
  if(!pendingOrderImportFile||!orderImportPrerequisitesComplete()) return false;
  const file=pendingOrderImportFile; // file（等待處理的訂單檔案）
  const input=pendingOrderImportInput; // input（原始檔案選擇控制）
  pendingOrderImportFile=null;
  pendingOrderImportInput=null;
  await processImportOrderFile(file,input);
  return true;
}

async function queueOrderImportFile(file,input=null){
  if(!file) return false;
  pendingOrderImportFile=file;
  pendingOrderImportInput=input;
  const fileName=g('imp-filename');
  if(fileName) fileName.textContent=String(file.name||'');
  return tryProcessPendingOrderImport();
}

async function acceptOrderImportFiles(files){
  const file=Array.from(files||[])[0];
  if(!file) return false;
  const modal=g('m-import-order'); // modal（訂單匯入視窗）
  if(!modal?.classList.contains('open')) return openImportOrder({file});
  return queueOrderImportFile(file);
}

// registerOrderFileDropTarget（登記訂單全視窗匯入）：檔案拖入後仍必須完成訂單資料及原有內容檢查。
function registerOrderFileDropTarget(){
  const fileDrop=window.PCMSUIFileDrop; // fileDrop（全視窗拖曳共用介面）
  if(!fileDrop) return false;
  if(!orderFileDropTargetRegistered){
    fileDrop.register({
      id:'order-import', // order-import（一般訂單匯入用途）
      page:'progress',
      accept:['.xlsx','.xls'],
      maxFiles:1,
      enabled:()=>canManageOrders(),
      text:{vi:'Thả tệp để nhập đơn hàng',zh:'放開即可匯入訂單'},
      onDrop:acceptOrderImportFiles,
      onReject:showOrderFileDropMessage,
      onError:()=>showOrderFileDropMessage({message:{vi:'Không thể xử lý tệp đơn hàng',zh:'無法處理訂單檔案'}})
    });
    orderFileDropTargetRegistered=true;
  }
  if(!orderImportFieldsBound){
    ['imp-ord-id','imp-ord-client','imp-ord-date'].forEach(id=>g(id)?.addEventListener('change',()=>{ void tryProcessPendingOrderImport(); }));
    orderImportFieldsBound=true;
  }
  return true;
}
registerOrderFileDropTarget();

function usableOrders(){ return (window.allOrders||[]).filter(isOrderUsable); }
function resetOrderRuntimeCache(){
  processLoadPromises.clear();
  loadedProcessVersions.clear();
  clearTimeout(progressRenderTimer);
  progressRenderSequence++;
}
function setImportProgress(percent,vi,zh){
  const wrap=g('imp-progress-wrap');
  if(wrap) wrap.style.display='none';
  const value=Math.max(0,Math.min(100,Number(percent)||0)); // value（訂單匯入百分比進度）
  const textPair={vi:String(vi||''),zh:String(zh||'')}; // textPair（訂單匯入雙語進度文字）
  const detailPair={vi:'Vui lòng chờ, không đóng cửa sổ này.',zh:'請稍候，不要關閉此視窗。'}; // detailPair（訂單匯入雙語補充文字）
  if(!ordersImportProgressController){
    ordersImportProgressController=window.PCMSUIComponents.progressDialog({
      title:{vi:'Tiến độ nhập đơn hàng',zh:'訂單匯入進度'},
      value,
      text:textPair,
      detail:detailPair,
      onClose:()=>{ ordersImportProgressController=null; }
    });
  }else{
    ordersImportProgressController.update({value,text:textPair,detail:detailPair});
  }
  if(value>=100) ordersImportProgressController.complete(textPair,detailPair);
}
function closeOrdersImportProgress(){
  ordersImportProgressController?.close('program');
  ordersImportProgressController=null;
}
// ===== 載入訂單資料 =====
async function loadOrderData(){
  window.lastOrderReadMetrics={
    orderMode:'pending',orderDocuments:0,processDocuments:0,processQueries:0,
    processCacheHits:0,startedAt:Date.now()
  }; // lastOrderReadMetrics（最近一次訂單讀取量）
  await reloadOrders();
  fillOrderSelects();
  return {orders:window.allOrders,processes:window.allProcesses};
}

function recordOrderRead(metrics={}){
  const previous=window.lastOrderReadMetrics||{
    orderMode:'unknown',orderDocuments:0,processDocuments:0,processQueries:0,
    processCacheHits:0,startedAt:Date.now()
  };
  window.lastOrderReadMetrics=Object.freeze({
    ...previous,...metrics,
    orderDocuments:Number(metrics.orderDocuments??previous.orderDocuments)||0,
    processDocuments:Number(previous.processDocuments||0)+Number(metrics.addProcessDocuments||0),
    processQueries:Number(previous.processQueries||0)+Number(metrics.addProcessQueries||0),
    processCacheHits:Number(previous.processCacheHits||0)+Number(metrics.addProcessCacheHits||0),
    finishedAt:Date.now()
  });
}

function replaceLoadedOrderProcesses(orderId,items,version){
  window.allProcesses=[...(window.allProcesses||[]).filter(item=>item.orderId!==orderId),...(items||[])];
  loadedProcessVersions.set(String(orderId),String(version));
  const order=(window.allOrders||[]).find(item=>item.id===orderId);
  if(order){
    order.processCount=items.length;
    order.productCodes=[...new Set(items.map(item=>String(item.code||'')).filter(Boolean))];
  }
  return items;
}

function hasOrderProcessesLoaded(orderId){
  return loadedProcessVersions.has(String(orderId));
}

async function ensureOrderProcessesLoaded(orderId,options={}){
  const target=String(orderId||'');
  if(!target) return [];
  if(processLoadPromises.has(target)) return processLoadPromises.get(target);
  const promise=(async()=>{
    try{
      const order=(window.allOrders||[]).find(item=>item.id===target);
      if(options.force!==true&&hasOrderProcessesLoaded(target)){
        recordOrderRead({addProcessCacheHits:1});
        return (window.allProcesses||[]).filter(item=>item.orderId===target);
      }
      if(!window.PCMSOrderService?.loadProcessViews){
        throw new Error('Dịch vụ dòng đơn hàng chưa sẵn sàng. / 訂單項目服務尚未載入。');
      }
      const rows=await window.PCMSOrderService.loadProcessViews(target,{order});
      recordOrderRead({orderMode:'fixed-order-items',addProcessQueries:1,addProcessDocuments:rows.length});
      return replaceLoadedOrderProcesses(target,rows,`current-product-master-${Date.now()}`);
    }catch(e){
      console.error('ensureOrderProcessesLoaded（載入指定訂單工序）失敗：',e);
      throw e;
    }finally{
      processLoadPromises.delete(target);
    }
  })();
  processLoadPromises.set(target,promise);
  return promise;
}

async function reloadProcesses(options={}){
  const orderId=String(options.orderId||g('prog-sel')?.value||'');
  if(!orderId) return window.allProcesses;
  await ensureOrderProcessesLoaded(orderId,options);
  return window.allProcesses;
}

function fillOrderSelects(){
  ['prog-sel'].forEach(id=>{
    const sel=g(id); if(!sel) return;
    while(sel.options.length>1) sel.remove(1);
    usableOrders().forEach(o=>{
      const opt=document.createElement('option');
      opt.value=o.id;
      opt.textContent=`${o.orderId} · ${fmtVN(o.dueDate)}`;
      sel.appendChild(opt);
    });
  });
}

// ===== 匯入訂單 =====
const ORDER_IMPORT_CODE_HEADERS=new Set([
  'ITEMNO','ITEMNUMBER','ITEM','SKU','STYLE','MODEL','MAHANG','款號','货号'
]); // ORDER_IMPORT_CODE_HEADERS（訂單款號表頭）：與裁帶訂單使用相同核准名稱。
const ORDER_IMPORT_QTY_HEADERS=new Set([
  'QTY','QUANTITY','ORDERQTY','PCS','SLPOPCS','SOLUONG','SOLUONGPCS','SL','數量','数量','訂單數量'
]); // ORDER_IMPORT_QTY_HEADERS（訂單數量表頭）：PCS 是表頭名稱，不是數量內容。
const ORDER_IMPORT_TOTAL_LABELS=new Set([
  'TOTAL','TOTALQTY','TOTALQUANTITY','GRANDTOTAL','TONG','TONGCONG','TONGSOLUONG','總計','合計','總數量'
]); // ORDER_IMPORT_TOTAL_LABELS（訂單總數量標示）
const ORDER_IMPORT_DESC_HEADERS=new Set(['DESC','DESCRIPTION','MOTA','說明','描述']); // ORDER_IMPORT_DESC_HEADERS（訂單說明表頭）
const ORDER_IMPORT_COLOR_HEADERS=new Set(['COLOR','COLOUR','MAU','顏色','颜色']); // ORDER_IMPORT_COLOR_HEADERS（訂單顏色表頭）
const ORDER_IMPORT_PO_HEADERS=new Set(['PO','PONO','PURCHASEORDER','SOPO','採購單','採購單號']); // ORDER_IMPORT_PO_HEADERS（訂單項目 PO 表頭）
const ORDER_IMPORT_DUE_DATE_HEADERS=new Set(['DUEDATE','DELIVERYDATE','NGAYGIAO','交期','交貨日期']); // ORDER_IMPORT_DUE_DATE_HEADERS（訂單項目交期表頭）
const ORDER_IMPORT_COMPLETION_DATE_HEADERS=new Set(['COMPLETIONDATE','FINISHDATE','完成日期']); // ORDER_IMPORT_COMPLETION_DATE_HEADERS（完成日期表頭）
const ORDER_IMPORT_SHIP_DATE_HEADERS=new Set(['SHIPDATE','SHIPPINGDATE','出貨日期']); // ORDER_IMPORT_SHIP_DATE_HEADERS（出貨日期表頭）
const ORDER_IMPORT_REMARK_HEADERS=new Set(['REMARK','REMARKS','NOTE','NOTES','GCHU','備註','备注']); // ORDER_IMPORT_REMARK_HEADERS（備註表頭）

function normalizeOrderImportHeader(value){
  return String(value??'').trim().replace(/\s+/g,'').toUpperCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9\u4E00-\u9FFF]/g,'');
}

window.document?.addEventListener?.('pcms:productmasterchange',()=>{
  window.allProcesses=[];
  loadedProcessVersions.clear();
  processLoadPromises.clear();
});

function normalizeOrderImportCode(value){ return String(value??'').trim().toUpperCase(); }

function orderImportHeaderParts(value){
  return String(value??'').split(/[\r\n\/|｜]+/).map(normalizeOrderImportHeader).filter(Boolean);
}

function matchesOrderImportHeader(value,accepted){
  return orderImportHeaderParts(value).some(part=>accepted.has(part));
}

function findGeneralOrderHeader(rows){
  for(let rowIndex=0;rowIndex<Math.min(rows.length,35);rowIndex++){
    const row=rows[rowIndex]||[];
    const codeIndexes=[];
    const qtyIndexes=[];
    row.forEach((value,cellIndex)=>{
      if(matchesOrderImportHeader(value,ORDER_IMPORT_CODE_HEADERS)) codeIndexes.push(cellIndex);
      if(matchesOrderImportHeader(value,ORDER_IMPORT_QTY_HEADERS)) qtyIndexes.push(cellIndex);
    });
    if(codeIndexes.length&&qtyIndexes.length){
      if(codeIndexes.length===1&&qtyIndexes.length===1&&codeIndexes[0]!==qtyIndexes[0]){
        return {ok:true,row:rowIndex,codeIdx:codeIndexes[0],qtyIdx:qtyIndexes[0]};
      }
      return {
        ok:false,
        error:'Không thể xác định duy nhất tiêu đề mã hàng và số lượng đơn hàng. / 無法唯一確認款號與訂單數量表頭。'
      };
    }
  }
  return {
    ok:false,
    error:'Không tìm thấy tiêu đề mã hàng và số lượng đơn hàng. / 找不到款號與訂單數量表頭，請確認 ITEM、STYLE、PCS 或訂單數量等表頭。'
  };
}

function parseGeneralOrderQuantity(value){
  const rawText=String(value??'').trim();
  if(rawText==='') return {ok:false,kind:'blank',rawText};
  if(typeof value==='number'){
    if(!Number.isFinite(value)) return {ok:false,kind:'invalid',rawText};
    if(value===0) return {ok:false,kind:'zero',rawText};
    if(value<0) return {ok:false,kind:'negative',rawText};
    if(!Number.isInteger(value)) return {ok:false,kind:'decimal',rawText};
    if(!Number.isSafeInteger(value)) return {ok:false,kind:'unsafe',rawText};
    return {ok:true,value,rawText};
  }
  if(!/^\d+$/.test(rawText)){
    const numericValue=Number(rawText);
    if(Number.isFinite(numericValue)&&numericValue<0) return {ok:false,kind:'negative',rawText};
    if(Number.isFinite(numericValue)&&!Number.isInteger(numericValue)) return {ok:false,kind:'decimal',rawText};
    return {ok:false,kind:'invalid',rawText};
  }
  const integerValue=Number(rawText);
  if(integerValue===0) return {ok:false,kind:'zero',rawText};
  if(!Number.isSafeInteger(integerValue)) return {ok:false,kind:'unsafe',rawText};
  return {ok:true,value:integerValue,rawText};
}

function generalOrderQuantityReason(result){
  const shown=result.rawText||'（空白）';
  const reasons={
    blank:`Số lượng đơn hàng đang trống. / 訂單數量空白。`,
    zero:`Số lượng đơn hàng bằng 0. / 訂單數量為 0。`,
    negative:`Số lượng đơn hàng là số âm: ${shown}. / 訂單數量為負數：${shown}。`,
    decimal:`Số lượng đơn hàng có số thập phân: ${shown}. / 訂單數量含有小數：${shown}。`,
    unsafe:`Số lượng đơn hàng vượt quá phạm vi an toàn: ${shown}. / 訂單數量超出安全範圍：${shown}。`,
    invalid:`Số lượng đơn hàng không hợp lệ: ${shown}. / 訂單數量內容無效：${shown}。`
  };
  return reasons[result.kind]||reasons.invalid;
}

function generalOrderError(sheetName,rowNumber,message){
  const separator=String(message||'').lastIndexOf(' / ');
  const vi=separator>=0?message.slice(0,separator):message;
  const zh=separator>=0?message.slice(separator+3):message;
  const viLocation=rowNumber?`Trang tính ${sheetName}, dòng ${rowNumber}`:`Trang tính ${sheetName}`;
  const zhLocation=rowNumber?`工作表 ${sheetName}，第 ${rowNumber} 列`:`工作表 ${sheetName}`;
  return `${viLocation}: ${vi} / ${zhLocation}：${zh}`;
}

function generalOrderFormulaAt(formulaRows,rowIndex,columnIndex){
  return String(formulaRows?.[rowIndex]?.[columnIndex]||'').trim();
}

function generalOrderExcelColumnIndex(letters){
  let value=0;
  for(const letter of String(letters||'').toUpperCase()){
    const code=letter.charCodeAt(0)-64;
    if(code<1||code>26) return -1;
    value=value*26+code;
  }
  return value-1;
}

function isGeneralOrderTotalFormula(formula,qtyColumnIndex,headerRowIndex,totalRowIndex){
  const compact=String(formula||'').replace(/\s+/g,'');
  const match=compact.match(/^=?SUM\((?:(?:'[^']+'|[^!(),]+)!)?\$?([A-Z]+)\$?(\d+):(?:(?:'[^']+'|[^!(),]+)!)?\$?([A-Z]+)\$?(\d+)\)$/i);
  if(!match) return false;
  return generalOrderExcelColumnIndex(match[1])===qtyColumnIndex
    &&generalOrderExcelColumnIndex(match[3])===qtyColumnIndex
    &&Number(match[2])>=headerRowIndex+2
    &&Number(match[2])<=Number(match[4])
    &&Number(match[4])===totalRowIndex;
}

function generalOrderRowHasTotalLabel(row,qtyColumnIndex){
  return (row||[]).some((value,columnIndex)=>columnIndex!==qtyColumnIndex
    &&ORDER_IMPORT_TOTAL_LABELS.has(normalizeOrderImportHeader(value)));
}

function parseGeneralOrderRows(rows,sheetName='-',options={}){
  const header=findGeneralOrderHeader(rows);
  if(!header.ok) return {items:[],errors:[generalOrderError(sheetName,0,header.error)],header:null,totalQuantity:null};
  const formulaRows=Array.isArray(options.formulaRows)?options.formulaRows:[];
  const candidates=[];
  const errors=[];
  let totalRowNumber=0;
  let totalQuantity=null;
  for(let rowIndex=header.row+1;rowIndex<rows.length;rowIndex++){
    const row=rows[rowIndex]||[];
    const rawCode=row[header.codeIdx];
    const rawQty=row[header.qtyIdx];
    const code=normalizeOrderImportCode(rawCode);
    const quantityText=String(rawQty??'').trim();
    if(!code&&!quantityText) continue;
    const rowNumber=rowIndex+1;
    if(matchesOrderImportHeader(rawCode,ORDER_IMPORT_CODE_HEADERS)
      &&matchesOrderImportHeader(rawQty,ORDER_IMPORT_QTY_HEADERS)) continue;
    const totalFormula=generalOrderFormulaAt(formulaRows,rowIndex,header.qtyIdx);
    const codeIsTotal=ORDER_IMPORT_TOTAL_LABELS.has(normalizeOrderImportHeader(rawCode));
    const hasTotalLabel=generalOrderRowHasTotalLabel(row,header.qtyIdx);
    const hasTotalFormula=isGeneralOrderTotalFormula(totalFormula,header.qtyIdx,header.row,rowIndex);
    const isTotalRow=(hasTotalFormula&&(!code||codeIsTotal))||(!code&&hasTotalLabel);
    if(isTotalRow){
      if(totalRowNumber){
        errors.push(generalOrderError(sheetName,rowNumber,`Tệp có nhiều dòng tổng số lượng. / 訂單檔案出現多個總數量列。`));
        continue;
      }
      totalRowNumber=rowNumber;
      const quantityResult=parseGeneralOrderQuantity(rawQty);
      if(!quantityResult.ok){
        errors.push(generalOrderError(sheetName,rowNumber,`Dòng tổng số lượng không hợp lệ. / 總數量列的數量無效。`));
        continue;
      }
      totalQuantity=quantityResult.value;
      const detailTotal=candidates.reduce((sum,item)=>sum+item.qty,0);
      if(totalQuantity!==detailTotal){
        errors.push(generalOrderError(sheetName,rowNumber,
          `Tổng số lượng là ${totalQuantity}, nhưng tổng chi tiết là ${detailTotal}. / 總數量為 ${totalQuantity}，但款號明細加總為 ${detailTotal}。`));
      }
      continue;
    }
    if(totalRowNumber){
      errors.push(generalOrderError(sheetName,rowNumber,`Vẫn còn dữ liệu sau dòng tổng số lượng. / 總數量列後面仍有訂單資料。`));
      continue;
    }
    if(!code){
      errors.push(generalOrderError(sheetName,rowNumber,
        `Có số lượng ${quantityText} nhưng mã hàng đang trống. / 有訂單數量「${quantityText}」，但款號空白。`));
      continue;
    }
    const quantityResult=parseGeneralOrderQuantity(rawQty);
    if(!quantityResult.ok){
      errors.push(generalOrderError(sheetName,rowNumber,generalOrderQuantityReason(quantityResult)));
      continue;
    }
    candidates.push({code,qty:quantityResult.value,rowIndex,rowNumber});
  }
  // 同一訂單可有多行相同款號；每一列由 orderItemId（訂單項目識別碼）保持獨立，不自動合併。
  const items=candidates;
  if(!items.length&&!errors.length){
    errors.push(generalOrderError(sheetName,0,`Không tìm thấy dữ liệu mã hàng và số lượng. / 找不到款號與訂單數量資料。`));
  }
  return {items,errors,header,totalQuantity};
}

function findGeneralOrderOptionalHeader(headerRow,accepted){
  return (headerRow||[]).findIndex(value=>matchesOrderImportHeader(value,accepted));
}

function normalizeGeneralOrderOptionalDate(value){
  if(value===undefined||value===null||String(value).trim()==='') return undefined;
  if(typeof value==='number'&&window.XLSX?.SSF?.parse_date_code){
    const parsed=window.XLSX.SSF.parse_date_code(value);
    if(parsed) return new Date(parsed.y,parsed.m-1,parsed.d).getTime();
  }
  const timestamp=new Date(value).getTime();
  if(!Number.isFinite(timestamp)) throw new Error('Ngày không hợp lệ. / 日期不正確。');
  return timestamp;
}

window.PCMSOrderImportValidation=Object.freeze({
  parseRows:parseGeneralOrderRows,
  parseQuantity:parseGeneralOrderQuantity
}); // PCMSOrderImportValidation（一般訂單辨識檢查介面）：供獨立測試驗收。

async function openImportOrder(options={}){
  if(!canManageOrders()) return;
  closeOrdersImportProgress();
  if(window.ensureProductsLoaded){
    const ok=await ensureProductsLoaded({requireMeta:true});
    if(!ok){ await ordersMessage('Không thể tải bảng công đoạn. Vui lòng thử lại.','無法載入工序資料，請稍後再試。','danger'); return; }
  }
  g('imp-ord-id').value=''; g('imp-ord-date').value='';
  g('imp-file').value=''; g('imp-filename').textContent='';
  g('imp-step1').style.display='block'; g('imp-step2').style.display='none';
  g('imp-skip-msg').style.display='none';
  g('imp-progress-wrap').style.display='none';
  g('imp-cleanup-btn').style.display='none';
  window._impData=null;
  pendingOrderImportFile=null;
  pendingOrderImportInput=null;
  const clientSel=g('imp-ord-client');
  if(clientSel){
    clientSel.innerHTML='<option value="">-- Chọn khách hàng / 選擇客戶 --</option>';
    const clients=[...new Set((window.D||[]).map(p=>p.client).filter(Boolean))].sort();
    clients.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; clientSel.appendChild(o); });
  }
  om('m-import-order');
  if(options.file) await queueOrderImportFile(options.file);
}

async function reloadOrders(options={}){
  if(ordersLoadPromise) return ordersLoadPromise;
  ordersLoadPromise=(async()=>{
    try{
      if(typeof window.firebaseLoadCachedCollection==='function'){
        window.allOrders=await window.firebaseLoadCachedCollection(COL.orders,COL.orders,options);
      }else{
        const snap=await window._getDocs(window._collection(COL.orders));
        window.allOrders=snap.docs.map(d=>({id:d.id,...d.data()}));
      }
      window.allOrders.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      const readMetrics=window.lastCollectionReadMetrics;
      if(readMetrics?.scope===COL.orders){
        recordOrderRead({orderMode:readMetrics.mode,orderDocuments:readMetrics.documentReads});
      }
      fillOrderSelects();
      return window.allOrders;
    }finally{
      ordersLoadPromise=null;
    }
  })();
  return ordersLoadPromise;
}

function closeImportOrder(){
  closeOrdersImportProgress();
  window._impData=null;
  pendingOrderImportFile=null;
  pendingOrderImportInput=null;
  g('imp-file').value='';
  g('imp-filename').textContent='';
  cm('m-import-order');
}

async function handleImportFile(input){
  const file=input.files[0]; if(!file) return;
  registerOrderFileDropTarget();
  return window.PCMSUIFileDrop?.receiveFiles?.(input.files,{targetId:'order-import',source:'picker'});
}

async function processImportOrderFile(file,input){
  const ordId=g('imp-ord-id').value.trim();
  const client=g('imp-ord-client')?.value||'';
  const dueDate=g('imp-ord-date').value;
  if(!ordId){ await ordersMessage('Vui lòng nhập số đơn hàng.','請先填寫訂單編號。','warning'); if(input) input.value=''; return; }
  if(!client){ await ordersMessage('Vui lòng chọn khách hàng.','請先選擇客戶。','warning'); if(input) input.value=''; return; }
  if(!dueDate){ await ordersMessage('Vui lòng nhập ngày xuất hàng.','請先填寫出貨日期。','warning'); if(input) input.value=''; return; }
  if(!/\.(xlsx|xls)$/i.test(String(file?.name||''))){
    await ordersMessage('Chỉ hỗ trợ tệp đơn hàng .xlsx hoặc .xls.','訂單只支援 .xlsx 或 .xls 表格檔。','warning');
    if(input) input.value='';
    return;
  }
  try{
    await window.PCMSFeatures.ensureSpreadsheetTool();
  }catch(error){
    await ordersMessage('Không thể tải công cụ bảng tính.','無法載入表格檔工具。','danger');
    if(input) input.value='';
    return;
  }
  g('imp-filename').textContent=file.name;
  const reader=new FileReader();
  reader.onload=async function(e){
    try{
      const wb=XLSX.read(e.target.result,{type:'binary'});
      if(!Array.isArray(wb.SheetNames)||wb.SheetNames.length!==1){
        await ordersMessage(
          `Tệp đơn hàng phải có đúng 1 trang tính; hiện có ${wb.SheetNames?.length||0}.`,
          `訂單檔案只能有 1 個工作表；目前有 ${wb.SheetNames?.length||0} 個。`,
          'danger'
        );
        window._impData=null;
        return;
      }
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      const formulaRows=rows.map((row,rowIndex)=>(row||[]).map((_,columnIndex)=>{
        const address=XLSX.utils.encode_cell({r:rowIndex,c:columnIndex});
        return String(ws[address]?.f||'');
      }));
      const parsed=parseGeneralOrderRows(rows,wb.SheetNames[0],{formulaRows});
      const matched=[], skipped=[], errors=[...parsed.errors];
      const headerRow=parsed.header?rows[parsed.header.row]||[]:[];
      const iDesc=findGeneralOrderOptionalHeader(headerRow,ORDER_IMPORT_DESC_HEADERS);
      const iColor=findGeneralOrderOptionalHeader(headerRow,ORDER_IMPORT_COLOR_HEADERS);
      const iPo=findGeneralOrderOptionalHeader(headerRow,ORDER_IMPORT_PO_HEADERS);
      const iDueDate=findGeneralOrderOptionalHeader(headerRow,ORDER_IMPORT_DUE_DATE_HEADERS);
      const iCompletionDate=findGeneralOrderOptionalHeader(headerRow,ORDER_IMPORT_COMPLETION_DATE_HEADERS);
      const iShipDate=findGeneralOrderOptionalHeader(headerRow,ORDER_IMPORT_SHIP_DATE_HEADERS);
      const iRemark=findGeneralOrderOptionalHeader(headerRow,ORDER_IMPORT_REMARK_HEADERS);
      const productsByCode=new Map((window.D||[]).map(product=>[normalizeOrderImportCode(product.code),product]));
      parsed.items.forEach(item=>{
        const sourceRow=rows[item.rowIndex]||[];
        const prod=productsByCode.get(item.code);
        if(prod){
          try{
            matched.push({
              productId:prod.productId,code:item.code,lineNumber:item.rowNumber,sourceRowId:item.rowNumber,
              po:iPo>=0?String(sourceRow[iPo]||'').trim():'',
              description:iDesc>=0?String(sourceRow[iDesc]||'').trim():'',
              desc:iDesc>=0?String(sourceRow[iDesc]||'').trim():'',
              color:iColor>=0?String(sourceRow[iColor]||'').trim():'',
              dueDate:iDueDate>=0?normalizeGeneralOrderOptionalDate(sourceRow[iDueDate]):undefined,
              completionDate:iCompletionDate>=0?normalizeGeneralOrderOptionalDate(sourceRow[iCompletionDate]):undefined,
              shipDate:iShipDate>=0?normalizeGeneralOrderOptionalDate(sourceRow[iShipDate]):undefined,
              remark:iRemark>=0?String(sourceRow[iRemark]||'').trim():'',
              quantity:item.qty,qty:item.qty,
              ops:prod.ops||[],zh:prod.zh||'',sz:prod.sz||''
            });
          }catch(error){
            errors.push(generalOrderError(wb.SheetNames[0],item.rowNumber,String(error.message||error)));
          }
        }else{
          errors.push(generalOrderError(wb.SheetNames[0],item.rowNumber,
            `Không tìm thấy mã hàng ${item.code} trong bảng công đoạn. / 工序總表找不到款號 ${item.code}。`));
        }
      });
      if(errors.length){
        const grouped=ordersSplitMessages(errors.slice(0,15));
        await ordersMessage(grouped.vi.join('\n'),grouped.zh.join('\n'),'danger');
        window._impData=null;
        return;
      }
      window._impData={ordId,dueDate,matched,skipped};
      g('imp-step2').style.display='block';
      const _ioMsg=document.getElementById('imp-order-ok');
      if(_ioMsg) _ioMsg.innerHTML=`<i class="ti ti-check"></i><div class="ui-language-sections"><div class="ui-language-section">Tìm thấy <b>${matched.length}</b> mã hàng, tổng cộng <b>${matched.reduce((a,m)=>a+m.ops.length,0)}</b> công đoạn.</div><div class="ui-language-section">找到 <b>${matched.length}</b> 個款號，共 <b>${matched.reduce((a,m)=>a+m.ops.length,0)}</b> 道工序。</div></div>`;
      if(skipped.length>0){
        const sm=g('imp-skip-msg'); sm.style.display='flex';
        const skippedText=`${ordersSafeText(skipped.slice(0,5).join('、'))}${skipped.length>5?'...':''}`;
        sm.innerHTML=`<i class="ti ti-alert-triangle"></i><div class="ui-language-sections"><div class="ui-language-section">Bỏ qua ${skipped.length} mã hàng vì không tìm thấy trong bảng công đoạn: ${skippedText}</div><div class="ui-language-section">工序表找不到以下 ${skipped.length} 個款號，已跳過：${skippedText}</div></div>`;
      }
      const tb=g('imp-preview-tb'); tb.innerHTML='';
      matched.forEach(m=>{
        const tr=document.createElement('tr');
        tr.innerHTML=`<td><b>${ordersSafeText(m.code)}</b></td><td>${ordersSafeText(m.desc)}</td><td>${ordersSafeText(m.color)}</td><td>${m.qty.toLocaleString()}</td><td>${m.ops.length}</td><td><span class="tg tg2">Có thể nhập<br>可匯入</span></td>`;
        tb.appendChild(tr);
      });
      skipped.forEach(s=>{
        const tr=document.createElement('tr');
        tr.innerHTML=`<td><b>${ordersSafeText(s)}</b></td><td colspan="4">-</td><td><span class="tg tr2">Không tìm thấy công đoạn<br>找不到工序</span></td>`;
        tb.appendChild(tr);
      });
    }catch(err){
      console.error('Không thể đọc tệp đơn hàng / 訂單檔案讀取失敗',err);
      await ordersMessage('Không thể đọc tệp đơn hàng. Vui lòng kiểm tra định dạng tệp.','訂單檔案讀取失敗，請檢查檔案格式。','danger');
    }
  };
  reader.readAsBinaryString(file);
}

async function confirmImportOrder(){
  const d=window._impData;
  if(!d||!d.matched.length){ await ordersMessage('Vui lòng tải tệp đơn hàng trước.','請先上傳訂單表格檔。','warning'); return; }
  if(!canManageOrders()) return;
  d.ordId = g('imp-ord-id').value.trim();
  const btn=g('imp-confirm-btn');
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i><span class="ui-bilingual"><span class="ui-text-vi">Đang nhập</span><span class="ui-text-zh">匯入中</span></span>';
  try{
    if(!window.PCMSOrderService?.importOrder){
      throw new Error('Dịch vụ dòng đơn hàng chưa sẵn sàng. / 訂單項目服務尚未載入。');
    }
    {
      const imported=await window.PCMSOrderService.importOrder({
        orderId:d.ordId,client:g('imp-ord-client')?.value||'',dueDate:d.dueDate,actualShipDate:d.dueDate
      },d.matched,{
        fileName:g('imp-filename')?.textContent||'',
        onProgress:progress=>setImportProgress(Math.round(progress.completedBatches/progress.totalBatches*100),
          `Đang nhập đợt ${progress.completedBatches}/${progress.totalBatches}.`,
          `正在匯入第 ${progress.completedBatches}/${progress.totalBatches} 批。`)
      });
      setImportProgress(100,'Nhập đơn hàng hoàn tất.','訂單匯入完成。');
      window.allOrders.unshift({...imported,items:undefined});
      closeImportOrder();
      renderOrders();renderProgress();
      await ordersMessage(
        `Nhập đơn hàng thành công!\nĐơn hàng: ${d.ordId}\nDòng chi tiết: ${d.matched.length}`,
        `訂單匯入成功！\n訂單：${d.ordId}\n明細列：${d.matched.length}`,
        'success'
      );
      return;
    }
  }catch(err){
    closeOrdersImportProgress();
    console.error('Nhập đơn hàng thất bại / 訂單匯入失敗',err);
    await ordersMessage(
      'Nhập đơn hàng thất bại. Có thể nhập lại cùng tệp để tiếp tục an toàn.',
      '訂單匯入失敗，可重新匯入同一檔案安全續跑。',
      'danger'
    );
  }
  finally{ btn.disabled=false; btn.innerHTML='<i class="ti ti-check"></i><span class="ui-bilingual"><span class="ui-text-vi">Xác nhận nhập</span><span class="ui-text-zh">確認匯入</span></span>'; }
}

async function cleanupFailedOrder(orderId,orderNo,silent=false){
  if(silent) return false;
  await ordersMessage(
    `Hãy nhập lại cùng tệp của đơn ${orderNo}; hệ thống sẽ tiếp tục từ dữ liệu đã hoàn tất.`,
    `請重新匯入訂單 ${orderNo} 的同一檔案，系統會從已完成資料安全續跑。`,
    'info'
  );
  return false;
}
function retryFailedImportCleanup(){
  return ordersMessage('Hãy nhập lại cùng tệp để tiếp tục.','請重新匯入同一檔案以安全續跑。','info');
}

// ===== 訂單列表 =====
function toggleOrderManager(){
  const panel=g('order-manager-panel');
  if(!panel) return;
  const open=panel.classList.toggle('open');
  const button=panel.querySelector('.order-manager-toggle');
  if(button) button.setAttribute('aria-expanded',open?'true':'false');
  if(open) renderOrders();
}

function renderOrders(){
  const q=(g('ord-q')?.value||'').toLowerCase();
  const statusFilter=(g('ord-status-filter')?.value||'active');
  const tb=g('ord-tb'); if(!tb) return;
  const empty=g('ord-empty');
  tb.innerHTML='';
  const list=window.allOrders.filter(o=>{
    const life=o.lifecycleStatus||'active';
    const statusMatch=statusFilter==='all'
      ||(statusFilter==='archived'&&(life==='archived'||life==='deleting'))
      ||(statusFilter==='active'&&life==='active');
    return statusMatch&&(!q||o.orderId.toLowerCase().includes(q));
  });
  if(!list.length){ if(empty) empty.style.display='block'; return; }
  if(empty) empty.style.display='none';
  list.forEach(o=>{
    const tr=document.createElement('tr');
    const idArg=ordersInlineArg(o.id);
    const orderArg=ordersInlineArg(o.orderId);
    const statusPair=o.lifecycleStatus==='archived'
      ? {vi:'Đã xóa (lưu trữ)',zh:'已刪除（封存）'}
      : (o.lifecycleStatus==='deleting'
        ? {vi:'Đang xóa vĩnh viễn',zh:'永久刪除中'}
        : (o.importStatus==='failed'
          ? {vi:'Nhập thất bại',zh:'匯入失敗'}
          : (o.importStatus==='importing'?{vi:'Đang nhập',zh:'匯入中'}:{vi:'Đang sử dụng',zh:'使用中'})));
    tr.innerHTML=`
      <td><b style="color:var(--navy)">${ordersSafeText(o.orderId)}</b></td>
      <td>${o.itemCount||0}</td>
      <td>${(o.totalQty||0).toLocaleString()}</td>
      <td>${fmtVN(o.dueDate)}</td>
      <td style="min-width:120px">
        <div class="orders-state${o.importStatus==='failed'||o.lifecycleStatus==='deleting'?' is-danger':''}">${ordersPairHtml(statusPair.vi,statusPair.zh)}</div>
      </td>
      <td><div class="orders-row-actions">
        ${isOrderUsable(o)?`<button class="btn bsm" onclick="viewOrderProgress(${idArg})"><i class="ti ti-chart-bar"></i></button>`:''}
        ${isOrderUsable(o)?`<button class="btn bsm bd2" title="Xóa (Lưu trữ) / 刪除（封存）" onclick="openOrderDeleteWarning('archive',${idArg},${orderArg})"><i class="ti ti-trash"></i></button>`:''}
        ${o.lifecycleStatus==='archived'&&canManageOrders()?`<button class="btn bsm" onclick="restoreArchivedOrder(${idArg},${orderArg})"><i class="ti ti-restore"></i>Khôi phục / 還原</button>`:''}
      </div></td>`;
    tb.appendChild(tr);
  });
  fillOrderSelects();
}

function viewOrderProgress(id){
  g('prog-sel').value=id; sp('progress'); renderProgress();
}

async function getOrderDeleteData(id,name){
  const itemSnap=await window._getDocs(window._query(window._collection('orderItems'),window._where('orderId','==',id)));
  return {id,name,items:itemSnap.docs};
}

function openOrderDeleteWarning(mode,id,name){
  if(mode!=='archive'){
    void ordersMessage('Hệ thống không xóa vĩnh viễn đơn hàng chính thức.','系統不永久刪除正式訂單。','warning');
    return;
  }
  window._orderDeleteRequest={mode,id,name};
  const archive=mode==='archive';
  const titlePair=archive?{vi:'Xóa (Lưu trữ)',zh:'刪除（封存）'}:{vi:'Xóa vĩnh viễn',zh:'永久刪除'};
  g('order-delete-warning-title').innerHTML=`<i class="ti ${archive?'ti-trash':'ti-database-off'}"></i><span class="ui-bilingual"><span class="ui-text-vi">${titlePair.vi}</span><span class="ui-text-zh">${titlePair.zh}</span></span>`;
  g('order-delete-warning-text').innerHTML=archive
    ?'<div class="ui-language-sections"><div class="ui-language-section">Xóa (Lưu trữ) sẽ ẩn đơn hàng, nhưng giữ dữ liệu đơn hàng và công đoạn.</div><div class="ui-language-section">刪除（封存）會隱藏訂單，但保留訂單與工序資料。</div></div>'
    :'<div class="ui-language-sections"><div class="ui-language-section">Xóa vĩnh viễn sẽ xóa đơn hàng, công đoạn và lịch sử điều chỉnh. Không thể khôi phục.</div><div class="ui-language-section">永久刪除會移除訂單、工序及數量調整紀錄，無法復原。</div></div>';
  om('m-order-delete-warning');
}

function closeOrderDeleteWarning(){
  window._orderDeleteRequest=null;
  cm('m-order-delete-warning');
}

function continueOrderDelete(){
  const request=window._orderDeleteRequest;
  if(!request) return;
  cm('m-order-delete-warning');
  openOrderDelete(request.mode,request.id,request.name);
}

async function openOrderDelete(mode,id,name){
  try{
    const data=await getOrderDeleteData(id,name);
    data.mode=mode;
    window._orderDeleteData=data;
    window._orderDeleteRequest=null;
    g('order-delete-id').value=id;
    g('order-delete-name').value=name;
    g('order-delete-confirm').value='';
    const archive=mode==='archive';
    const titlePair=archive?{vi:'Xóa (Lưu trữ)',zh:'刪除（封存）'}:{vi:'Xóa vĩnh viễn',zh:'永久刪除'};
    g('order-delete-title').innerHTML=`<i class="ti ${archive?'ti-trash':'ti-database-off'}"></i><span class="ui-bilingual"><span class="ui-text-vi">${titlePair.vi}</span><span class="ui-text-zh">${titlePair.zh}</span></span>`;
    g('order-delete-summary').innerHTML=`<div class="ui-language-sections"><div class="ui-language-section"><div><b>Đơn hàng:</b> ${ordersSafeText(name)}</div><div><b>Dòng chi tiết:</b> ${data.items.length}</div></div><div class="ui-language-section"><div><b>訂單：</b>${ordersSafeText(name)}</div><div><b>明細列：</b>${data.items.length}</div></div></div>`;
    g('order-archive-btn').style.display=archive?'':'none';
    g('order-purge-btn').style.display=archive?'none':'';
    updateOrderDeleteButtons();
    om('m-order-delete');
  }catch(e){
    console.error('Không thể tải dữ liệu xóa đơn hàng / 載入訂單刪除資料失敗',e);
    await ordersMessage('Không thể tải dữ liệu cần xóa.','載入刪除資料失敗。','danger');
  }
}

function closeOrderDeleteModal(){
  window._orderDeleteData=null;
  cm('m-order-delete');
}

function updateOrderDeleteButtons(){
  const data=window._orderDeleteData;
  const matched=!!data&&g('order-delete-confirm').value.trim()===data.name;
  g('order-archive-btn').disabled=!matched||data?.mode!=='archive';
  g('order-purge-btn').disabled=!matched||data?.mode!=='purge'||window.cu?.role!=='admin';
}

async function confirmArchiveOrder(){
  const data=window._orderDeleteData;
  if(!data||g('order-delete-confirm').value.trim()!==data.name) return;
  try{
    if(!window.PCMSOrderService?.setLifecycle) throw new Error('Dịch vụ đơn hàng chưa sẵn sàng. / 訂單服務尚未載入。');
    const saved=await window.PCMSOrderService.setLifecycle(data.id,'archived',{note:data.name});
    const o=window.allOrders.find(x=>x.id===data.id);
    if(o) Object.assign(o,saved);
    closeOrderDeleteModal();
    fillOrderSelects(); renderOrders(); renderProgress();
    await ordersMessage('Đã xóa (lưu trữ) đơn hàng. Toàn bộ lịch sử vẫn được giữ lại.','訂單已刪除（封存），全部歷史資料均保留。','success');
  }catch(e){
    console.error('Không thể lưu trữ đơn hàng / 訂單封存失敗',e);
    await ordersMessage('Không thể xóa (lưu trữ) đơn hàng.','訂單刪除（封存）失敗。','danger');
  }
}

async function restoreArchivedOrder(id,name){
  if(!canManageOrders()||!(await ordersConfirm(
    'Khôi phục đơn hàng','還原訂單',
    `Khôi phục đơn hàng「${name}」?`,
    `還原訂單「${name}」？`
  ))) return;
  try{
    if(!window.PCMSOrderService?.setLifecycle) throw new Error('Dịch vụ đơn hàng chưa sẵn sàng. / 訂單服務尚未載入。');
    const saved=await window.PCMSOrderService.setLifecycle(id,'active',{note:name});
    const o=window.allOrders.find(x=>x.id===id);
    if(o) Object.assign(o,saved);
    fillOrderSelects(); renderOrders(); renderProgress();
  }catch(e){
    console.error('Không thể khôi phục đơn hàng / 訂單還原失敗',e);
    await ordersMessage('Không thể khôi phục đơn hàng.','訂單還原失敗。','danger');
  }
}

async function confirmPurgeOrder(){
  await ordersMessage('Hệ thống không xóa vĩnh viễn đơn hàng chính thức.','系統不永久刪除正式訂單。','warning');
}

// ===== 訂單進度 =====
function scheduleProgressRender(){
  clearTimeout(progressRenderTimer);
  progressRenderTimer=setTimeout(()=>renderProgress(),250);
}

async function loadProcessesForOrderSearch(orders,codeQuery,renderSequence){
  const matchedOrderIds=new Set();
  const legacyOrders=[];
  orders.forEach(order=>{
    if(Array.isArray(order.productCodes)){
      if(order.productCodes.some(code=>String(code||'').toLowerCase().includes(codeQuery))){
        matchedOrderIds.add(order.id);
      }
    }else{
      legacyOrders.push(order);
    }
  });
  for(let offset=0;offset<legacyOrders.length;offset+=5){
    const group=legacyOrders.slice(offset,offset+5);
    const results=await Promise.all(group.map(order=>ensureOrderProcessesLoaded(order.id)));
    if(renderSequence!==progressRenderSequence) return null;
    results.forEach((items,index)=>{
      if(items.some(item=>String(item.code||'').toLowerCase().includes(codeQuery))){
        matchedOrderIds.add(group[index].id);
      }
    });
  }
  return matchedOrderIds;
}

async function renderProgress(){
  const renderSequence=++progressRenderSequence;
  const ordId=g('prog-sel')?.value;
  const codeQuery=(g('prog-code-q')?.value||'').trim().toLowerCase();
  const content=g('prog-content'); if(!content) return;
  content.innerHTML='<div class="ui-empty-state"><i class="ti ti-loader-2"></i><div>Đang tải...</div><div>載入中...</div></div>';
  try{
    const now=Date.now();
    const twoMonths=60*24*60*60*1000;
    let orders=usableOrders().filter(order=>{
      const actualShipDate=order.actualShipDate||(order.dueDate||null);
      return !actualShipDate||(actualShipDate+twoMonths)>now;
    });
    if(ordId) orders=orders.filter(order=>order.id===ordId);
    if(ordId) await ensureOrderProcessesLoaded(ordId);
    if(renderSequence!==progressRenderSequence) return;
    if(codeQuery){
      const matchedOrderIds=await loadProcessesForOrderSearch(orders,codeQuery,renderSequence);
      if(!matchedOrderIds||renderSequence!==progressRenderSequence) return;
      orders=orders.filter(order=>matchedOrderIds.has(order.id));
    }
    const allProcs=window.allProcesses||[];
    const progMap={};
    allProcs.forEach(p=>{
      if(!progMap[p.orderId]) progMap[p.orderId]={procs:[]};
      progMap[p.orderId].procs.push(p);
    });
    let list=orders.map(o=>{
      const pm=progMap[o.id]||{procs:[]};
      const actualShipDate=o.actualShipDate||(o.dueDate||null);
      const processCount=Number.isInteger(Number(o.processCount))
        ? Number(o.processCount)
        : (hasOrderProcessesLoaded(o.id)?pm.procs.length:null);
      return{...o,processCount,pm,actualShipDate};
    });
    list.sort((a,b)=>(a.actualShipDate||0)-(b.actualShipDate||0));
    if(!list.length){
      content.innerHTML='<div class="ui-empty-state"><i class="ti ti-inbox"></i><div>Không có đơn hàng</div><div>尚無訂單</div></div>';
      return;
    }
    const thS='padding:6px 8px;text-align:left;background:var(--sf);border-bottom:1px solid var(--bd);white-space:nowrap;font-size:11px;font-weight:500;color:var(--mu)';
    let html='<div class="orders-table-wrap ui-table-scroll" data-ui-floating-scroll="only"><table class="orders-progress-table ui-table" id="orders-progress-table" data-ui-table-layout="special" data-ui-table-sticky="original"><thead><tr>';
    html+=`<th style="${thS};width:36px">No</th>`;
    html+=`<th style="${thS};width:80px">${ordersPairHtml('Khách hàng','客人')}</th>`;
    html+=`<th style="${thS};width:110px">${ordersPairHtml('Số đơn hàng','訂單號碼')}</th>`;
    html+=`<th style="${thS};width:70px">${ordersPairHtml('Số lượng','數量')}</th>`;
    html+=`<th style="${thS};width:100px">${ordersPairHtml('Số công đoạn','工序數')}</th>`;
    html+=`<th style="${thS};width:90px">${ordersPairHtml('Theo PO','出貨日期PO')}</th>`;
    html+=`<th style="${thS};width:120px">${ordersPairHtml('Hoàn thành','實際完成日')}</th>`;
    html+=`<th style="${thS};width:120px">${ordersPairHtml('Xuất hàng','實際出貨日')}</th>`;
    html+=`<th style="${thS}">${ordersPairHtml('Ghi chú','備註')}</th>`;
    html+=`<th style="${thS};width:60px"></th>`;
    html+='</tr></thead><tbody>';
    list.forEach((o,idx)=>{
      const totalQty=o.totalQty||0;
      const actualCompleteDateVal=o.actualCompleteDate?formatLocalDate(o.actualCompleteDate):'';
      const actualShipDateVal=o.actualShipDate?formatLocalDate(o.actualShipDate):(o.dueDate?formatLocalDate(o.dueDate):'');
      const idArg=ordersInlineArg(o.id);
      const orderArg=ordersInlineArg(o.orderId);
      const remarkArg=ordersInlineArg(o.remark||'');
      const safeId=ordersSafeAttr(o.id);
      const remarkVal=ordersSafeAttr(o.remark||'');
      html+=`<tr class="orders-progress-row" onclick="toggleProgDetail(${idArg})">
        <td style="color:var(--mu);padding:6px 8px;font-size:12px">${idx+1}</td>
        <td style="padding:6px 8px;font-size:12px"><b>${ordersSafeText(o.client||'-')}</b></td>
        <td style="font-family:var(--font-mono,monospace);font-size:11px;padding:6px 8px">${ordersSafeText(o.orderId)}</td>
        <td style="padding:6px 8px;font-size:12px">${totalQty.toLocaleString()}</td>
        <td style="padding:6px 8px;font-size:12px">${o.processCount===null?'—':o.processCount.toLocaleString()}</td>
        <td>${fmtVN(o.dueDate)}</td>
        <td onclick="event.stopPropagation()"><input class="orders-date-input" type="date" value="${ordersSafeAttr(actualCompleteDateVal)}" onchange="saveProgField(${idArg},'actualCompleteDate',this.value)"></td>
        <td onclick="event.stopPropagation()"><input class="orders-date-input" type="date" value="${ordersSafeAttr(actualShipDateVal)}" onchange="saveProgField(${idArg},'actualShipDate',this.value,true)"></td>
        <td onclick="event.stopPropagation();openRemarkEdit(${idArg},${remarkArg})" title="${remarkVal}" style="cursor:pointer;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 8px;font-size:12px;color:${o.remark?'var(--navy)':'var(--mu)'}">${o.remark?ordersSafeText(o.remark):ordersPairHtml('Ghi chú...','備註...')}</td>
        <td style="padding:6px 8px" onclick="event.stopPropagation()">
          <button class="btn bsm bd2" title="Xóa (Lưu trữ) / 刪除（封存）" onclick="openOrderDeleteWarning('archive',${idArg},${orderArg})"><i class="ti ti-trash"></i></button>
          ${window.cu?.role==='admin'?`<button class="btn bsm bd2" style="background:var(--errl);color:var(--err)" title="Xóa vĩnh viễn / 永久刪除" onclick="openOrderDeleteWarning('purge',${idArg},${orderArg})"><i class="ti ti-database-off"></i></button>`:''}
        </td>
      </tr>
      <tr id="prog-detail-${safeId}" style="display:none">
        <td colspan="10" style="padding:0;background:var(--bg)">
          <div id="prog-detail-body-${safeId}" style="padding:10px 16px"></div>
        </td>
      </tr>`;
    });
    html+='</tbody></table></div>';
    content.innerHTML=html;
    if(codeQuery) list.forEach(o=>toggleProgDetail(o.id));
  }catch(e){
    content.innerHTML='<div class="ui-empty-state is-danger"><i class="ti ti-alert-circle"></i><div>Không thể tải dữ liệu.</div><div>資料載入失敗。</div></div>';
    console.error('renderProgress error:',e);
  }
}

async function saveProgField(ordId, field, value, isShipDate=false){
  try{
    const update={[field]: (field==='remark')?value:(value?new Date(value).getTime():null)};
    if(!window.PCMSOrderService?.updateOrder) throw new Error('Dịch vụ đơn hàng chưa sẵn sàng. / 訂單服務尚未載入。');
    await window.PCMSOrderService.updateOrder(ordId,update,{note:isShipDate?'actualShipDate':field});
    const o=window.allOrders.find(x=>x.id===ordId);
    if(o) o[field]=update[field];
  }catch(e){
    console.error('Không thể lưu tiến độ đơn hàng / 訂單進度儲存失敗',e);
    await ordersMessage('Không thể lưu thay đổi tiến độ.','進度變更儲存失敗。','danger');
  }
}

async function openRemarkEdit(ordId, current){
  const val=await window.PCMSUIComponents.promptDialog({
    title:{vi:'Chỉnh sửa ghi chú',zh:'編輯備註'},
    label:{vi:'Ghi chú',zh:'備註'},
    value:current||'',
    multiline:true,
    maxLength:500
  });
  if(val===null) return;
  await saveProgField(ordId,'remark',val);
  renderProgress();
}

async function toggleProgDetail(ordId){
  const row=document.getElementById('prog-detail-'+ordId);
  const btn=document.getElementById('prog-btn-'+ordId);
  if(!row) return;
  const isOpen=row.style.display!=='none';
  if(isOpen){
    row.style.display='none';
    if(btn) btn.innerHTML='<i class="ti ti-chevron-down"></i>';
    return;
  }
  row.style.display='';
  if(btn) btn.innerHTML='<i class="ti ti-chevron-up"></i>';
  const body=document.getElementById('prog-detail-body-'+ordId);
  if(!body) return;
  body.innerHTML='<div class="ui-language-sections" style="color:var(--mu);font-size:12px"><div class="ui-language-section">Đang tải công đoạn...</div><div class="ui-language-section">正在載入工序...</div></div>';
  try{
    await ensureOrderProcessesLoaded(ordId);
  }catch(error){
    console.error('Không thể tải công đoạn / 工序載入失敗',error);
    body.innerHTML='<div class="ui-language-sections" style="color:var(--err);font-size:12px"><div class="ui-language-section">Không thể tải công đoạn.</div><div class="ui-language-section">工序載入失敗。</div></div>';
    return;
  }
  if(row.style.display==='none') return;
  const codeQuery=(g('prog-code-q')?.value||'').trim().toLowerCase();
  const procs=(window.allProcesses||[]).filter(p=>p.orderId===ordId);
  const byItem={};
  procs.forEach(p=>{
    if(codeQuery&&!String(p.code||'').toLowerCase().includes(codeQuery)) return;
    const key=p.orderItemId||p.code;
    if(!byItem[key]) byItem[key]=[];
    byItem[key].push(p);
  });
  let html='';
  Object.entries(byItem).forEach(([itemIdentity,cp])=>{
    const code=cp[0]?.code||'—';
    const detailId='prog-item-'+ordId+'-'+encodeURIComponent(itemIdentity).replace(/%/g,'_');
    const ordArg=ordersInlineArg(ordId);
    const itemArg=ordersInlineArg(itemIdentity);
    const detailArg=ordersInlineArg(detailId);
    html+=`<div style="margin-bottom:10px">
      <div onclick="toggleProgCodeDetail(${ordArg},${itemArg},${detailArg})" style="cursor:pointer;font-size:12px;font-weight:500;color:var(--navy);padding:8px 4px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:8px;white-space:nowrap">
        <i id="${ordersSafeAttr(detailId)}-icon" class="ti ti-chevron-right" style="color:var(--accent)"></i>
        <b>${ordersSafeText(code)}</b><span style="font-size:11px;color:var(--mu);overflow:hidden;text-overflow:ellipsis;min-width:80px;max-width:320px">${ordersSafeText(cp[0].po?`PO ${cp[0].po} · `:'')}${ordersSafeText(cp[0].desc||'')} ${ordersSafeText(cp[0].color||'')}</span>
        <span style="margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;color:var(--accent);min-width:0">
          ${ordersPairHtml(`${cp.length} công đoạn · ${(cp[0].orderQty||0).toLocaleString()} sản phẩm`,`${cp.length} 道工序 · ${(cp[0].orderQty||0).toLocaleString()} 件`)}
          ${canManageOrders()?`<button class="btn bsm" title="Điều chỉnh SL / 調整數量" aria-label="Điều chỉnh SL / 調整數量" onclick="event.stopPropagation();openOrderQtyAdjust(${ordArg},${itemArg})"><i class="ti ti-edit"></i></button>`:''}
        </span>
      </div>
      <div id="${ordersSafeAttr(detailId)}" style="display:none"></div>
    </div>`;
  });
  body.innerHTML=html||'<div class="ui-language-sections" style="color:var(--mu);font-size:12px"><div class="ui-language-section">Chưa có dữ liệu công đoạn.</div><div class="ui-language-section">尚無工序資料。</div></div>';
}

function toggleProgCodeDetail(ordId,itemIdentity,detailId){
  const detail=document.getElementById(detailId), icon=document.getElementById(detailId+'-icon');
  if(!detail) return;
  if(detail.style.display!=='none'){
    detail.style.display='none';
    if(icon) icon.className='ti ti-chevron-right';
    return;
  }
  const cp=(window.allProcesses||[]).filter(p=>p.orderId===ordId&&(p.orderItemId||p.code)===itemIdentity);
  const procRows=cp.sort((a,b)=>compareProcessNo(a.processNo,b.processNo)).map(p=>{
    return`<tr>
      <td style="padding:3px 6px;font-size:12px">${ordersSafeText(p.processNo)}</td>
      <td style="padding:3px 6px;font-size:12px">${ordersSafeText(p.processCategory||'—')} · ${ordersSafeText(processCategoryLabel(p.processCategory))}</td>
      <td style="padding:3px 6px;font-size:12px">${ordersSafeText(p.processVi||p.processZh||'')}</td>
      <td style="padding:3px 6px;text-align:right;font-size:12px">${(p.orderQty||0).toLocaleString()}</td>
      <td style="padding:3px 6px;text-align:right;font-size:12px">${(p.workStdSec||p.processSec||0).toLocaleString()}</td>
      <td style="padding:3px 6px;text-align:right;font-size:12px">${(p.slPerHour||0).toLocaleString()}</td>
    </tr>`;
  }).join('');
  detail.innerHTML=`<table class="orders-detail-table ui-table" data-ui-table-layout="special" style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--sf)">
    <th style="padding:4px 6px;text-align:left;width:60px;font-size:11px">Số CĐ<br><span style="font-weight:400;color:var(--mu)">工序號</span></th>
    <th style="padding:4px 6px;text-align:left;width:90px;font-size:11px">Phân loại<br><span style="font-weight:400;color:var(--mu)">加工分類</span></th>
    <th style="padding:4px 6px;text-align:left;font-size:11px">Tên CĐ<br><span style="font-weight:400;color:var(--mu)">工序名稱</span></th>
    <th style="padding:4px 6px;text-align:right;width:70px;font-size:11px">SL đơn<br><span style="font-weight:400;color:var(--mu)">訂單量</span></th>
    <th style="padding:4px 6px;text-align:right;width:115px;font-size:11px">Giây công đoạn của đơn<br><span style="font-weight:400;color:var(--mu)">訂單工序快照秒數</span></th>
    <th style="padding:4px 6px;text-align:right;width:90px;font-size:11px">SL tiêu chuẩn/giờ<br><span style="font-weight:400;color:var(--mu)">標準產量/時</span></th>
  </tr></thead><tbody>${procRows}</tbody></table>`;
  detail.style.display='';
  if(icon) icon.className='ti ti-chevron-down';
}

async function openOrderQtyAdjust(orderId,itemIdentity){
  if(!canManageOrders()) return;
  const procs=(window.allProcesses||[]).filter(p=>p.orderId===orderId&&(p.orderItemId||p.code)===itemIdentity);
  if(!procs.length) return;
  const order=window.allOrders.find(o=>o.id===orderId);
  const current=procs[0].orderQty||0;
  const minimum=1;
  g('adj-order-id').value=orderId; g('adj-code').value=itemIdentity;
  g('adj-new-qty').value=current; g('adj-reason').value='';
  g('adj-summary').innerHTML=`<div class="ui-language-sections"><div class="ui-language-section"><div>Đơn hàng: <b>${ordersSafeText(order?.orderId||'')}</b></div><div>Mã hàng: <b>${ordersSafeText(procs[0].code)}</b></div><div>PO / Màu: <b>${ordersSafeText(procs[0].po||'—')} / ${ordersSafeText(procs[0].color||'—')}</b></div><div>Số lượng hiện tại: <b>${current.toLocaleString()}</b></div><div>Số lượng tối thiểu: <b>${minimum.toLocaleString()}</b></div><div>Công đoạn bị ảnh hưởng: <b>${procs.length}</b></div></div><div class="ui-language-section"><div>訂單：<b>${ordersSafeText(order?.orderId||'')}</b></div><div>款號：<b>${ordersSafeText(procs[0].code)}</b></div><div>PO／顏色：<b>${ordersSafeText(procs[0].po||'—')} / ${ordersSafeText(procs[0].color||'—')}</b></div><div>目前數量：<b>${current.toLocaleString()}</b></div><div>最低可調整數量：<b>${minimum.toLocaleString()}</b></div><div>影響工序：<b>${procs.length}</b></div></div></div>`;
  om('m-order-qty-adjust');
}

async function confirmOrderQtyAdjust(){
  if(!canManageOrders()) return;
  const orderId=g('adj-order-id').value, itemIdentity=g('adj-code').value;
  const newQty=Number(g('adj-new-qty').value), reason=g('adj-reason').value.trim();
  if(!Number.isInteger(newQty)||newQty<=0||!reason){
    await ordersMessage('Vui lòng nhập số lượng nguyên dương và lý do.','請輸入正整數數量與調整原因。','warning');
    return;
  }
  try{
    if(!window.PCMSOrderService?.updateItemQuantity) throw new Error('Dịch vụ dòng đơn hàng chưa sẵn sàng. / 訂單項目服務尚未載入。');
    const process=(window.allProcesses||[]).find(item=>item.orderId===orderId&&item.orderItemId===itemIdentity);
    if(!process?.orderItemId) throw new Error('Không tìm thấy dòng đơn hàng. / 找不到訂單項目。');
    await window.PCMSOrderService.updateItemQuantity({
      orderItemId:process.orderItemId,orderId,productId:process.productId,quantity:process.orderQty,
      revision:process.orderItemRevision||1
    },newQty,{reason});
    cm('m-order-qty-adjust');
    await reloadOrders();
    await reloadProcesses({orderId,force:true});
    renderProgress();
    await ordersMessage('Điều chỉnh số lượng thành công.','訂單數量調整成功。','success');
  }catch(e){
    console.error('Không thể điều chỉnh số lượng / 無法調整訂單數量',e);
    await ordersMessage('Không thể điều chỉnh số lượng.','無法調整訂單數量。','danger');
  }
}

async function openOrderAdjustmentHistory(){
  if(!canManageOrders()) return;
  try{
    if(!window.PCMSHistory?.loadOperationLogs){
      throw new Error('Chức năng lịch sử chưa sẵn sàng / 歷史功能尚未就緒');
    }
    const rows=await window.PCMSHistory.loadOperationLogs({permissionKey:'progress',actions:['orderItemQuantityUpdate'],limit:50});
    renderOrderAdjustmentHistory(rows);
    om('m-order-adjust-history');
  }catch(error){
    console.error('Không thể tải lịch sử điều chỉnh / 無法載入訂單調整歷史：',error);
    await ordersMessage('Không thể tải lịch sử điều chỉnh.','無法載入訂單調整歷史。','danger');
  }
}

function renderOrderAdjustmentHistory(rows){
  const body=g('order-adjust-history'); // body（訂單調整歷史表格內容）
  if(body){
    body.innerHTML=rows.length?rows.map(r=>{
      const quantity=(r.changes||[]).find(change=>change.field==='quantity')||{};
      return `<tr><td>${ordersSafeText(r.targetId||'—')}</td><td>—</td><td>${Number(quantity.before||0).toLocaleString()}</td><td>${Number(quantity.after||0).toLocaleString()}</td><td>${ordersSafeText(r.note||'')}</td><td>${ordersSafeText(r.createdBy||'')}<br><span style="font-size:10px;color:var(--mu)">${ordersSafeText(fmtTimeVN(r.createdAt))}</span></td></tr>`;
    }).join(''):'<tr><td colspan="6"><div class="ui-language-sections"><div class="ui-language-section is-vi">Chưa có dữ liệu</div><div class="ui-language-section is-zh">尚無資料</div></div></td></tr>';
  }
  const moreButton=g('order-adjust-history-more'); // moreButton（載入更多按鈕）
  if(moreButton) moreButton.hidden=!window.PCMSHistory?.hasMore?.('operationLogs',{permissionKey:'progress',actions:['orderItemQuantityUpdate'],limit:50});
}

async function loadMoreOrderAdjustmentHistory(){
  if(!canManageOrders()||!window.PCMSHistory?.loadOperationLogs) return;
  const button=g('order-adjust-history-more'); // button（載入更多按鈕）
  if(button) button.disabled=true;
  try{
    const rows=await window.PCMSHistory.loadOperationLogs({permissionKey:'progress',actions:['orderItemQuantityUpdate'],limit:50,loadMore:true});
    renderOrderAdjustmentHistory(rows);
  }catch(error){
    console.error('Không thể tải thêm lịch sử điều chỉnh / 無法載入更多訂單調整歷史：',error);
    await ordersMessage('Không thể tải thêm lịch sử.','無法載入更多歷史紀錄。','danger');
  }finally{
    if(button) button.disabled=false;
  }
}
