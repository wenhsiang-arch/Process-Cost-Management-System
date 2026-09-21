// ===== 訂單系統資料 =====
window.allOrders    = [];
window.allProcesses = [];
let ordersLoadPromise = null;
const processLoadPromises = new Map(); // processLoadPromises（各訂單工序載入工作）
const loadedProcessVersions = new Map(); // loadedProcessVersions（已載入訂單工序版本）
let progressRenderSequence = 0;
let ordersImportProgressController = null; // ordersImportProgressController（訂單匯入共用進度視窗控制介面）
const inspectionReportExportRequests = new Set(); // inspectionReportExportRequests（匯出入口執行中的訂單，避免載入程式期間連點）
let orderFileDropTargetRegistered = false; // orderFileDropTargetRegistered（訂單全視窗匯入用途是否已登記）
let orderImportFieldsBound = false; // orderImportFieldsBound（訂單必要資料自動接續檢查是否已綁定）
let pendingOrderImportFile = null; // pendingOrderImportFile（等待必要資料完成的訂單檔案）
let pendingOrderImportInput = null; // pendingOrderImportInput（本次訂單檔案選擇控制）
let orderImportFileSequence = 0; // orderImportFileSequence（目前檔案選擇序號）：舊檔讀取完成後不得覆蓋新預覽。
const ordersSafeText=value=>window.PCMSSafe.text(value); // ordersSafeText（訂單畫面安全文字）
const ordersSafeAttr=value=>window.PCMSSafe.attribute(value); // ordersSafeAttr（訂單畫面安全屬性）
const ordersInlineArg=value=>window.PCMSSafe.inlineArgument(value); // ordersInlineArg（訂單行內事件安全參數）
const ordersPairHtml=(vi,zh)=>`<span class="ui-bilingual"><span class="ui-text-vi">${ordersSafeText(vi)}</span><span class="ui-text-zh">${ordersSafeText(zh)}</span></span>`; // ordersPairHtml（訂單畫面可切換雙語文字）

function ordersMessage(vi,zh,kind='info'){
  return window.PCMSUIComponents.alertDialog({message:{vi:String(vi||''),zh:String(zh||'')},kind});
}
function ordersConfirm(titleVi,titleZh,vi,zh,options={}){
  return window.PCMSUIComponents.confirmDialog({
    title:{vi:titleVi,zh:titleZh},
    body:window.PCMSUIComponents.createLanguageSections({vi:String(vi||''),zh:String(zh||'')}),
    confirmText:options.confirmText,kind:options.kind
  });
}
function createOrderGuideSection(language,title,items){
  const section=document.createElement('section');
  const heading=document.createElement('h3');
  const list=document.createElement('ol');
  section.className=`ui-language-section is-${language}`;
  section.lang=language==='zh'?'zh-Hant':'vi';
  heading.textContent=title;
  items.forEach(item=>{
    const row=document.createElement('li');
    const label=document.createElement('b');
    label.textContent=item.label;
    row.append(label,document.createTextNode(item.text));
    list.appendChild(row);
  });
  section.append(heading,list);
  return section;
}
function openOrderGuide(){
  const body=document.createElement('div');
  body.className='orders-user-guide-dialog ui-language-sections';
  body.append(
    createOrderGuideSection('vi','Hướng dẫn sử dụng đơn hàng',[
      {label:'Lưu trữ: ',text:'Nút cấm chuyển đơn khỏi danh sách đang dùng nhưng vẫn giữ dữ liệu; có thể xem và khôi phục trong mục Đơn hàng đã lưu trữ.'},
      {label:'Đã xuất hàng: ',text:'Chọn ngày xuất thực tế, sau đó nhấn nút xe tải để chuyển đơn sang mục Đơn hàng đã xuất; có thể hủy xác nhận tại đó để đưa đơn trở lại.'},
      {label:'Xuất báo cáo: ',text:'Đơn HUNTER có nút bảng tính để xuất báo cáo kiểm tra; trước khi xuất phải chọn tên tệp và vị trí lưu.'},
      {label:'Màu ngày PO: ',text:'Màu xanh đậm là còn không quá 14 ngày; màu đỏ là đã quá hạn nhưng chưa xuất; màu thường là còn trên 14 ngày.'},
      {label:'Tiến độ sản xuất: ',text:'Mỗi tài khoản trên mỗi máy chỉ tự động cập nhật một lần trong kỳ từ 06:00 hôm nay đến 05:59 hôm sau; thay đổi sau lần cập nhật sẽ hiển thị trong kỳ kế tiếp.'}
    ]),
    createOrderGuideSection('zh','訂單頁使用說明',[
      {label:'封存：',text:'禁止符號會將訂單移出使用中清單，但資料仍會保留；可到「已封存訂單」查看及還原。'},
      {label:'已出貨：',text:'先選擇實際出貨日，再按貨車按鈕移到「已出貨訂單」；可在該分頁取消確認並移回主表。'},
      {label:'報表匯出：',text:'HUNTER 訂單會顯示表格檔按鈕，可匯出檢驗報告；匯出前需選擇檔名與儲存位置。'},
      {label:'PO 日期顏色：',text:'深藍色代表剩餘 14 天以內；紅色代表已逾期且尚未出貨；一般字色代表超過 14 天。'},
      {label:'生產進度：',text:'每個帳號在每台電腦，每個「當日 06:00 至隔日 05:59」週期只自動更新一次；更新後才新增的產能會在下一個週期顯示。'}
    ])
  );
  return window.PCMSUIComponents.alertDialog({
    title:{vi:'Hướng dẫn',zh:'使用說明'},body,size:'large'
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
  resetOrderImportPreview();
  const message=detail?.message||{vi:'Không thể nhận tệp',zh:'無法接收檔案'}; // message（拖曳拒絕原因）
  const pair=window.PCMSUIText?.resolve?.(message)||{vi:'Không thể nhận tệp',zh:'無法接收檔案'}; // pair（拒絕原因雙語文字）
  void ordersMessage(pair.vi,pair.zh,'warning');
}

function orderImportPrerequisitesComplete(){
  return !!g('imp-ord-id')?.value.trim()&&!!g('imp-ord-client')?.value&&!!g('imp-ord-date')?.value;
}

// resetOrderImportPreview（清除舊檔預覽）：任何新選檔或拒絕結果都不能沿用上一份可匯入資料。
function resetOrderImportPreview(){
  orderImportFileSequence++;
  window._impData=null;
  pendingOrderImportFile=null;
  pendingOrderImportInput=null;
  const preview=g('imp-step2');
  if(preview) preview.style.display='none';
  const rows=g('imp-preview-tb');
  if(rows) rows.replaceChildren();
  const confirm=g('imp-confirm-btn');
  if(confirm) confirm.disabled=true;
  const fileName=g('imp-filename');
  if(fileName) fileName.textContent='';
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
  resetOrderImportPreview();
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
// orderShipmentStatus（訂單出貨狀態）：舊訂單缺少欄位時安全視為尚未確認出貨。
function orderShipmentStatus(order){ return order?.shipmentStatus==='shipped'?'shipped':'pending'; }
// orderDueDateClass（PO 交期提示）：以本機日曆日判斷，避免時分與日光節約時間造成誤判。
function orderDueDateClass(dueDate,now=Date.now()){
  const due=new Date(Number(dueDate));
  const current=new Date(Number(now));
  if(Number.isNaN(due.getTime())||Number.isNaN(current.getTime())) return '';
  const dayValue=date=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
  const remainingDays=Math.round((dayValue(due)-dayValue(current))/86400000);
  if(remainingDays<0) return ' is-overdue';
  if(remainingDays<=14) return ' is-due-soon';
  return '';
}
// updatePendingQuantitySummary（更新未出貨總數量）：只加總目前已載入訂單，不因畫面搜尋或選單篩選而改變。
function updatePendingQuantitySummary(orders){
  const total=(orders||[]).reduce((sum,order)=>sum+(Number(order?.totalQty)||0),0);
  const display=Math.max(0,total).toLocaleString('en-US');
  ['orders-pending-quantity-vi','orders-pending-quantity-zh'].forEach(id=>{const node=g(id);if(node)node.textContent=display;});
  return total;
}
function resetOrderRuntimeCache(){
  processLoadPromises.clear();
  loadedProcessVersions.clear();
  progressRenderSequence++;
}
function setImportProgress(percent,vi,zh){
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
    usableOrders().filter(o=>orderShipmentStatus(o)==='pending').forEach(o=>{
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
  resetOrderImportPreview();
  if(window.ensureProductsLoaded){
    const ok=await ensureProductsLoaded({requireMeta:true});
    if(!ok){ await ordersMessage('Không thể tải bảng công đoạn. Vui lòng thử lại.','無法載入工序資料，請稍後再試。','danger'); return; }
  }
  g('imp-ord-id').value=''; g('imp-ord-date').value='';
  g('imp-file').value='';
  g('imp-step1').style.display='block'; g('imp-step2').style.display='none';
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
  resetOrderImportPreview();
  pendingOrderImportFile=null;
  pendingOrderImportInput=null;
  g('imp-file').value='';
  cm('m-import-order');
}

async function handleImportFile(input){
  const file=input.files[0]; if(!file) return;
  resetOrderImportPreview();
  registerOrderFileDropTarget();
  return window.PCMSUIFileDrop?.receiveFiles?.(input.files,{targetId:'order-import',source:'picker'});
}

async function processImportOrderFile(file,input,selection=orderImportFileSequence){
  const client=g('imp-ord-client')?.value||'';
  const ordId=g('imp-ord-id').value.trim();
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
    if(selection!==orderImportFileSequence) return;
    await ordersMessage('Không thể tải công cụ bảng tính.','無法載入表格檔工具。','danger');
    if(input) input.value='';
    return;
  }
  if(selection!==orderImportFileSequence) return;
  g('imp-filename').textContent=file.name;
  const reader=new FileReader();
  reader.onload=async function(e){
    if(selection!==orderImportFileSequence) return;
    try{
      const wb=XLSX.read(e.target.result,{type:'binary'});
      if(!Array.isArray(wb.SheetNames)||wb.SheetNames.length!==1){
        await ordersMessage(
          `Tệp đơn hàng phải có đúng 1 trang tính; hiện có ${wb.SheetNames?.length||0}.`,
          `訂單檔案只能有 1 個工作表；目前有 ${wb.SheetNames?.length||0} 個。`,
          'danger'
        );
        return;
      }
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      const formulaRows=rows.map((row,rowIndex)=>(row||[]).map((_,columnIndex)=>{
        const address=XLSX.utils.encode_cell({r:rowIndex,c:columnIndex});
        return String(ws[address]?.f||'');
      }));
      const parsed=parseGeneralOrderRows(rows,wb.SheetNames[0],{formulaRows});
      const matched=[], errors=[...parsed.errors];
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
        return;
      }
      if(selection!==orderImportFileSequence) return;
      window._impData={matched};
      g('imp-step2').style.display='block';
      g('imp-confirm-btn').disabled=matched.length===0;
      const _ioMsg=document.getElementById('imp-order-ok');
      if(_ioMsg) _ioMsg.innerHTML=`<i class="ti ti-check"></i><div class="ui-language-sections"><div class="ui-language-section">Tìm thấy <b>${matched.length}</b> mã hàng, tổng cộng <b>${matched.reduce((a,m)=>a+m.ops.length,0)}</b> công đoạn.</div><div class="ui-language-section">找到 <b>${matched.length}</b> 個款號，共 <b>${matched.reduce((a,m)=>a+m.ops.length,0)}</b> 道工序。</div></div>`;
      const tb=g('imp-preview-tb'); tb.innerHTML='';
      matched.forEach(m=>{
        const tr=document.createElement('tr');
        tr.innerHTML=`<td><b>${ordersSafeText(m.code)}</b></td><td>${ordersSafeText(m.desc)}</td><td>${ordersSafeText(m.color)}</td><td>${m.qty.toLocaleString()}</td><td>${m.ops.length}</td><td><span class="tg tg2">Có thể nhập<br>可匯入</span></td>`;
        tb.appendChild(tr);
      });
    }catch(err){
      if(selection!==orderImportFileSequence) return;
      console.error('Không thể đọc tệp đơn hàng / 訂單檔案讀取失敗',err);
      await ordersMessage('Không thể đọc tệp đơn hàng. Vui lòng kiểm tra định dạng tệp.','訂單檔案讀取失敗，請檢查檔案格式。','danger');
    }
  };
  reader.onerror=async function(){
    if(selection!==orderImportFileSequence) return;
    await ordersMessage('Không thể đọc tệp đơn hàng. Vui lòng thử lại.','無法讀取訂單檔案，請重試。','danger');
  };
  reader.readAsBinaryString(file);
}

async function confirmImportOrder(){
  const d=window._impData;
  if(!d||!d.matched.length){ await ordersMessage('Vui lòng tải tệp đơn hàng trước.','請先上傳訂單表格檔。','warning'); return; }
  if(!canManageOrders()) return;
  const orderId=g('imp-ord-id').value.trim();
  const dueDate=g('imp-ord-date').value;
  if(!orderId||!g('imp-ord-client')?.value||!dueDate){
    await ordersMessage('Vui lòng điền đủ số đơn, khách hàng và ngày giao hàng.','請填妥訂單號碼、客戶及交期。','warning');
    return;
  }
  const btn=g('imp-confirm-btn');
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i><span class="ui-bilingual"><span class="ui-text-vi">Đang nhập</span><span class="ui-text-zh">匯入中</span></span>';
  try{
    if(!window.PCMSOrderService?.importOrder){
      throw new Error('Dịch vụ dòng đơn hàng chưa sẵn sàng. / 訂單項目服務尚未載入。');
    }
    {
      const imported=await window.PCMSOrderService.importOrder({
        orderId,client:g('imp-ord-client')?.value||'',dueDate
      },d.matched,{
        fileName:g('imp-filename')?.textContent||'',
        onProgress:progress=>setImportProgress(Math.min(95,Math.round(progress.completedItems/progress.totalItems*95)),
          progress.phase==='finalizing'?'Đang xác nhận hoàn tất đơn hàng.':`Đã lưu ${progress.completedItems}/${progress.totalItems} dòng.`,
          progress.phase==='finalizing'?'正在確認整張訂單完成。':`已儲存 ${progress.completedItems}/${progress.totalItems} 筆明細。`)
      });
      setImportProgress(100,'Nhập đơn hàng hoàn tất.','訂單匯入完成。');
      window.allOrders.unshift({...imported,items:undefined});
      closeImportOrder();
      renderProgress();
      await ordersMessage(
        `Nhập đơn hàng thành công!\nĐơn hàng: ${orderId}\nDòng chi tiết: ${d.matched.length}`,
        `訂單匯入成功！\n訂單：${orderId}\n明細列：${d.matched.length}`,
        'success'
      );
      return;
    }
  }catch(err){
    closeOrdersImportProgress();
    console.error('Nhập đơn hàng thất bại / 訂單匯入失敗',err);
    btn.disabled=!window._impData;
    btn.innerHTML='<i class="ti ti-check"></i><span class="ui-bilingual"><span class="ui-text-vi">Xác nhận nhập</span><span class="ui-text-zh">確認匯入</span></span>';
    const message=orderImportErrorMessage(err); // message（具體匯入錯誤與已確認進度）
    await ordersMessage(
      message.vi,message.zh,
      'danger'
    );
  }
  finally{ btn.disabled=!window._impData; btn.innerHTML='<i class="ti ti-check"></i><span class="ui-bilingual"><span class="ui-text-vi">Xác nhận nhập</span><span class="ui-text-zh">確認匯入</span></span>'; }
}

// orderImportErrorMessage（匯入錯誤說明）：只顯示正式雙語原因，不直接顯示雲端英文錯誤。
function orderImportErrorMessage(error){
  const messages={
    'permission-denied':{vi:'Cơ sở dữ liệu từ chối thao tác. Cần kiểm tra quyền hoặc quy tắc bảo mật trước khi thử lại.',
      zh:'雲端拒絕此操作，需先檢查權限或安全規則，再重新嘗試。'},
    'unauthenticated':{vi:'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại.',
      zh:'登入已失效，請重新登入後再試。'},
    'unavailable':{vi:'Kết nối bị gián đoạn. Hãy thử lại khi kết nối ổn định.',
      zh:'連線中斷，請在連線恢復後重試。'},
    'deadline-exceeded':{vi:'Chưa xác nhận được kết quả. Hãy kiểm tra danh sách đơn rồi thử lại.',
      zh:'結果尚未確認，請查看訂單清單後再試。'},
    'aborted':{vi:'Trạng thái đơn đã thay đổi. Hãy thử lại.',
      zh:'訂單狀態已變更，請重試。'},
    'resource-exhausted':{vi:'Đã đạt giới hạn dịch vụ. Hãy kiểm tra hạn mức trước khi thử lại.',
      zh:'雲端服務已達用量限制，請先確認額度再重試。'}
  };
  const code=String(error?.code||'').replace(/^firestore\//,''); // code（雲端錯誤代碼）
  let pair=error?.orderImportMessage||messages[code];
  if(!pair&&String(error?.message||'').includes(' / ')){
    const split=ordersSplitMessages([error.message]);pair={vi:split.vi[0],zh:split.zh[0]};
  }
  pair=pair||{vi:'Không thể hoàn tất nhập đơn. Giữ lại tệp và kiểm tra nguyên nhân trước khi thử lại.',
    zh:'訂單未能完成匯入，請保留檔案並確認原因後再重試。'};
  if(error?.orderImportCleanup==='done') return {
    vi:`${pair.vi}\nDữ liệu nhập dở đã được dọn sạch; có thể nhập lại.`,
    zh:`${pair.zh}\n未完成的匯入資料已清理，可重新匯入。`
  };
  if(error?.orderImportCleanup==='pending') return {
    vi:`${pair.vi}\nChưa dọn sạch được dữ liệu nhập dở. Hãy kết nối lại rồi thử nhập; hệ thống sẽ dọn trước.`,
    zh:`${pair.zh}\n未完成資料尚未清理；連線恢復後重試，系統會先清理。`
  };
  const progress=error?.orderImportProgress; // progress（本次已收到確認的明細進度）
  if(!progress||progress.phase==='checking') return pair;
  return {
    vi:`${pair.vi}\nChưa xác nhận được trạng thái cuối. Hãy kiểm tra danh sách đơn trước khi thử lại.`,
    zh:`${pair.zh}\n最終狀態尚未確認，請查看訂單清單後再試。`
  };
}

// ===== 訂單狀態操作 =====
function openOrderDeleteWarning(id,name){
  window._orderDeleteRequest={id,name};
  g('order-delete-warning-title').innerHTML='<i class="ti ti-ban"></i><span class="ui-bilingual"><span class="ui-text-vi">Xóa (Lưu trữ)</span><span class="ui-text-zh">刪除（封存）</span></span>';
  g('order-delete-warning-text').innerHTML='<div class="ui-language-sections"><div class="ui-language-section">Xóa (Lưu trữ) sẽ ẩn đơn hàng, nhưng giữ dữ liệu đơn hàng và công đoạn.</div><div class="ui-language-section">刪除（封存）會隱藏訂單，但保留訂單與工序資料。</div></div>';
  om('m-order-delete-warning');
}

// exportInspectionReportFromOrder（從上方訂單與工序資料表匯出檢驗報告）：按下時才載入功能程式與範本。
async function exportInspectionReportFromOrder(orderId,button){
  if(typeof canOpenPage==='function'&&!canOpenPage('progress')) return;
  const key=String(orderId||'');
  if(inspectionReportExportRequests.has(key))return;
  inspectionReportExportRequests.add(key);
  if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
  let progress=null;
  try{
    progress=window.PCMSUIComponents.progressDialog({
      title:{vi:'Xuất báo cáo kiểm tra',zh:'匯出檢驗報告'},indeterminate:true,
      text:{vi:'Đang mở chức năng xuất báo cáo',zh:'正在開啟報告匯出功能'},
      detail:{vi:'Vui lòng chờ.',zh:'請稍候。'},allowClose:false
    });
    await window.PCMSFeatures.ensurePageScripts('inspection-report-template');
    await window.PCMSInspectionReport.exportOrder(orderId,progress);
  }catch(error){
    console.error('Không thể mở báo cáo kiểm tra / 無法開啟檢驗報告',error);
    await ordersMessage('Không thể mở chức năng xuất báo cáo kiểm tra.','無法開啟檢驗報告匯出功能。','danger');
  }finally{
    progress?.close?.();
    inspectionReportExportRequests.delete(key);
    if(button){button.disabled=false;button.removeAttribute('aria-busy');}
  }
}

function closeOrderDeleteWarning(){
  window._orderDeleteRequest=null;
  cm('m-order-delete-warning');
}

function continueOrderDelete(){
  const request=window._orderDeleteRequest;
  if(!request) return;
  cm('m-order-delete-warning');
  openOrderDelete(request.id,request.name);
}

function openOrderDelete(id,name){
  const order=window.allOrders.find(row=>row.id===id);
  if(!order||!isOrderUsable(order)){
    void ordersMessage('Trạng thái đơn đã thay đổi. Hãy tải lại danh sách.','訂單狀態已變更，請重新整理清單。','warning');
    return;
  }
  window._orderDeleteData={id,name};
  window._orderDeleteRequest=null;
  g('order-delete-id').value=id;
  g('order-delete-name').value=name;
  g('order-delete-confirm').value='';
  g('order-delete-title').innerHTML='<i class="ti ti-ban"></i><span class="ui-bilingual"><span class="ui-text-vi">Xóa (Lưu trữ)</span><span class="ui-text-zh">刪除（封存）</span></span>';
  g('order-delete-summary').innerHTML=`<div class="ui-language-sections"><div class="ui-language-section"><div><b>Đơn hàng:</b> ${ordersSafeText(name)}</div><div><b>Dòng chi tiết:</b> ${Number(order.itemCount)||0}</div></div><div class="ui-language-section"><div><b>訂單：</b>${ordersSafeText(name)}</div><div><b>明細列：</b>${Number(order.itemCount)||0}</div></div></div>`;
  updateOrderDeleteButtons();
  om('m-order-delete');
}

function closeOrderDeleteModal(){
  window._orderDeleteData=null;
  cm('m-order-delete');
}

function updateOrderDeleteButtons(){
  const data=window._orderDeleteData;
  const matched=!!data&&g('order-delete-confirm').value.trim()===data.name;
  g('order-archive-btn').disabled=!matched;
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
    fillOrderSelects(); renderProgress(); window.renderShippedOrders?.();
    await ordersMessage('Đã xóa (lưu trữ) đơn hàng. Toàn bộ lịch sử vẫn được giữ lại.','訂單已刪除（封存），全部歷史資料均保留。','success');
  }catch(e){
    console.error('Không thể lưu trữ đơn hàng / 訂單封存失敗',e);
    await ordersMessage('Không thể xóa (lưu trữ) đơn hàng.','訂單刪除（封存）失敗。','danger');
  }
}

// ===== 訂單進度 =====

// 未完成匯入只使用已載入的訂單清單提醒，不額外查詢雲端或把未完成訂單當成可用工序。
function renderOrderImportIssues(){
  const issues=(window.allOrders||[]).filter(order=>(!order.lifecycleStatus||order.lifecycleStatus==='active')
    &&(order.importStatus==='failed'||order.importStatus==='importing'));
  if(!issues.length)return '';
  const details=issues.map(order=>{
    const status=order.importStatus==='failed'
      ?ordersPairHtml('Nhập thất bại','匯入失敗')
      :ordersPairHtml('Đang nhập','匯入中');
    return `<span class="orders-import-issue"><strong>${ordersSafeText(order.orderId||'—')}</strong><span class="orders-state${order.importStatus==='failed'?' is-danger':''}">${status}</span></span>`;
  }).join('');
  return `<div class="orders-import-issues ui-notice is-warning" role="status">
    <i class="ti ti-alert-circle" aria-hidden="true"></i>
    <div><div>${ordersPairHtml('Đơn nhập chưa hoàn tất','匯入未完成的訂單')}</div>
      <div class="orders-import-issue-list">${details}</div>
      <div class="orders-import-issue-help">${ordersPairHtml('Vui lòng kiểm tra kết quả nhập; đơn chưa hoàn tất không có công đoạn.',
        '請檢查匯入結果；未完成的訂單不會顯示工序。')}</div>
    </div>
  </div>`;
}

function renderOrderProductionProgressState(orderId,state){
  const host=g(`order-production-progress-${orderId}`);
  if(!host) return;
  if(!state){
    host.classList.remove('is-loading');host.classList.add('is-error');
    host.removeAttribute('aria-busy');
    host.replaceChildren(window.PCMSUIText?.create?.({vi:'Chưa có dữ liệu tiến độ',zh:'尚無進度資料'})||document.createTextNode('—'));
    return;
  }
  const percent=Math.max(0,Math.min(100,Number(state?.percent)||0));
  const shown=percent.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:1});
  host.classList.remove('is-loading','is-error');
  host.removeAttribute('aria-busy');
  host.innerHTML=`<div class="orders-production-progress-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ordersSafeAttr(percent.toFixed(1))}">
      <div class="orders-production-progress-fill" style="width:${ordersSafeAttr(percent.toFixed(1))}%"></div>
      <span class="orders-production-progress-value">${ordersSafeText(shown)}%</span>
    </div>`;
}

function formatOrderProgressRefreshTime(timestamp){
  if(!Number(timestamp)) return '';
  return new Intl.DateTimeFormat('zh-TW',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).format(new Date(Number(timestamp)));
}

function renderOrderProgressRefreshStatus(status){
  const host=g('orders-progress-refresh-status');
  if(!host) return;
  const time=formatOrderProgressRefreshTime(status?.refreshedAt);
  const failed=status?.state==='failed';
  host.classList.toggle('is-failed',failed);
  const copy=failed
    ?(time?{vi:`Cập nhật hôm nay thất bại · Dữ liệu lần trước: ${time}`,zh:`今日更新失敗・上次更新：${time}`}
      :{vi:'Cập nhật hôm nay thất bại · Chưa có dữ liệu tiến độ',zh:'今日更新失敗・尚無進度資料'})
    :(time?{vi:`Cập nhật gần nhất: ${time}`,zh:`最後更新：${time}`}
      :{vi:'Chưa cập nhật tiến độ',zh:'尚未更新進度'});
  host.replaceChildren(window.PCMSUIText?.create?.(copy)||document.createTextNode(copy.zh));
}

function renderOrderProductionProgressLoading(){
  return `<div class="ui-progress is-indeterminate orders-production-progress-loading" aria-hidden="true">
      <div class="ui-progress-track"><div class="ui-progress-bar"></div></div>
      <div class="orders-production-progress-loading-copy">${ordersPairHtml('Đang tính','計算中')}</div>
    </div>`;
}

async function refreshOrderProductionProgress(orders,renderSequence){
  if(!window.PCMSOrderProductionProgress?.load) return;
  try{
    const values=await window.PCMSOrderProductionProgress.load(orders);
    if(renderSequence!==progressRenderSequence) return;
    orders.forEach(order=>renderOrderProductionProgressState(order.id,values.get(order.id)));
    renderOrderProgressRefreshStatus(window.PCMSOrderProductionProgress.status?.());
  }catch(error){
    if(renderSequence!==progressRenderSequence) return;
    orders.forEach(order=>{
      const host=g(`order-production-progress-${order.id}`);
      if(!host) return;
      host.classList.remove('is-loading');host.classList.add('is-error');
      host.removeAttribute('aria-busy');
      host.replaceChildren(window.PCMSUIText?.create?.({vi:'Không thể tính',zh:'無法計算'})||document.createTextNode('—'));
    });
    console.error('Không thể tải tiến độ sản xuất / 無法載入生產進度',error);
  }
}

async function renderProgress(){
  const renderSequence=++progressRenderSequence;
  const ordId=g('prog-sel')?.value;
  const content=g('prog-content'); if(!content) return;
  content.innerHTML='<div class="ui-empty-state"><i class="ti ti-loader-2"></i><div>Đang tải...</div><div>載入中...</div></div>';
  try{
    let orders=usableOrders().filter(order=>orderShipmentStatus(order)==='pending');
    const progressOrders=orders.slice(); // 每日進度更新固定涵蓋全部未出貨訂單；訂單選單只影響畫面顯示。
    updatePendingQuantitySummary(orders);
    if(ordId) orders=orders.filter(order=>order.id===ordId);
    if(renderSequence!==progressRenderSequence) return;
    const list=orders.slice();
    const sortDate=order=>Number(order.actualShipDate)||Number(order.dueDate)||Number.MAX_SAFE_INTEGER; // sortDate（主表排序日期）：優先實際出貨日，未設定時使用 PO 交期。
    list.sort((a,b)=>sortDate(a)-sortDate(b)||(Number(a.dueDate)||0)-(Number(b.dueDate)||0)||String(a.orderId||'').localeCompare(String(b.orderId||'')));
    const issueNotice=renderOrderImportIssues();
    if(!list.length){
      content.innerHTML=issueNotice+(issueNotice
        ?'<div class="ui-empty-state"><i class="ti ti-inbox"></i><div>Không có đơn hàng có thể sử dụng</div><div>目前沒有可使用的訂單</div></div>'
        :'<div class="ui-empty-state"><i class="ti ti-inbox"></i><div>Không có đơn hàng</div><div>尚無訂單</div></div>');
      void refreshOrderProductionProgress(progressOrders,renderSequence);
      return;
    }
    let html='<div class="orders-table-wrap ui-table-scroll" data-ui-floating-scroll="only"><table class="orders-progress-table ui-table" id="orders-progress-table" data-ui-table-layout="special" data-ui-table-sticky="original"><thead><tr>';
    html+=`<th data-orders-column="index">#</th>`;
    html+=`<th data-orders-column="client">${ordersPairHtml('Khách hàng','客人')}</th>`;
    html+=`<th data-orders-column="orderId">${ordersPairHtml('Số đơn hàng','訂單號碼')}</th>`;
    html+=`<th data-orders-column="quantity" class="ui-table-number-cell">${ordersPairHtml('Số lượng','數量')}</th>`;
    html+=`<th data-orders-column="productionProgress">${ordersPairHtml('Tiến độ','生產進度')}</th>`;
    html+=`<th data-orders-column="dueDate">${ordersPairHtml('Theo PO','出貨日期PO')}</th>`;
    html+=`<th data-orders-column="shipDate">${ordersPairHtml('Xuất hàng','實際出貨日')}</th>`;
    html+=`<th data-orders-column="remark">${ordersPairHtml('Ghi chú','備註')}</th>`;
    html+=`<th data-orders-column="action">${ordersPairHtml('Thao tác','操作')}</th>`;
    html+='</tr></thead><tbody>';
    list.forEach((o,idx)=>{
      const totalQty=o.totalQty||0;
      const actualShipDateVal=o.actualShipDate?formatLocalDate(o.actualShipDate):'';
      const idArg=ordersInlineArg(o.id);
      const orderArg=ordersInlineArg(o.orderId);
      const remarkArg=ordersInlineArg(o.remark||'');
      const safeId=ordersSafeAttr(o.id);
      const remarkVal=ordersSafeAttr(o.remark||'');
      const dueDateClass=orderDueDateClass(o.dueDate);
      html+=`<tr class="orders-progress-row">
        <td class="orders-row-index">${idx+1}</td>
        <td><b>${ordersSafeText(o.client||'-')}</b></td>
        <td class="orders-order-id">${ordersSafeText(o.orderId)}</td>
        <td class="ui-table-number-cell">${totalQty.toLocaleString()}</td>
        <td><div class="orders-production-progress is-loading" id="order-production-progress-${safeId}" aria-busy="true">
          ${renderOrderProductionProgressLoading()}</div></td>
        <td><span class="orders-po-date${dueDateClass}">${ordersSafeText(fmtVN(o.dueDate))}</span></td>
        <td onclick="event.stopPropagation()"><input class="orders-date-input" id="prog-ship-date-${safeId}" type="date" value="${ordersSafeAttr(actualShipDateVal)}" onchange="saveActualShipDate(${idArg},this.value,this)"></td>
        <td class="orders-remark-cell${o.remark?' has-value':''}" onclick="event.stopPropagation();openRemarkEdit(${idArg},${remarkArg})" data-ui-neutral-title title="${remarkVal}">${o.remark?ordersSafeText(o.remark):ordersPairHtml('Ghi chú...','備註...')}</td>
        <td onclick="event.stopPropagation()"><div class="orders-progress-actions">
          <button class="btn bsm bd2" title="Xóa (Lưu trữ) / 刪除（封存）" onclick="openOrderDeleteWarning(${idArg},${orderArg})"><i class="ti ti-ban"></i></button>
          <button type="button" class="btn bsm orders-shipment-confirm" title="Xác nhận xuất hàng / 確認出貨" onclick="confirmOrderShipment(${idArg},${orderArg})"><i class="ti ti-truck-delivery" aria-hidden="true"></i></button>
          ${String(o.client||'').trim().toUpperCase()==='HUNTER'?`<button type="button" class="btn bsm bd2 orders-inspection-export" data-inspection-order-id="${safeId}"><i class="ti ti-file-spreadsheet" aria-hidden="true"></i></button>`:''}
        </div></td>
      </tr>`;
    });
    html+='</tbody></table></div>';
    content.innerHTML=issueNotice+html;
    void refreshOrderProductionProgress(progressOrders,renderSequence);
    content.querySelectorAll?.('.orders-inspection-export').forEach(button=>{
      const label={vi:'Xuất báo cáo kiểm tra',zh:'匯出檢驗報告'};
      window.PCMSUIText?.setLocalizedAttribute?.(button,'title',label);
      window.PCMSUIText?.setLocalizedAttribute?.(button,'aria-label',label);
      button.addEventListener('click',event=>{event.stopPropagation();void exportInspectionReportFromOrder(button.dataset.inspectionOrderId,button);});
    });
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
  body.innerHTML='<div class="orders-process-status ui-helper-text ui-bilingual"><span class="ui-text-vi">Đang tải công đoạn...</span><span class="ui-text-zh">正在載入工序...</span></div>';
  try{
    await ensureOrderProcessesLoaded(ordId);
  }catch(error){
    console.error('Không thể tải công đoạn / 工序載入失敗',error);
    body.innerHTML='<div class="orders-process-status is-danger ui-helper-text ui-status-text ui-bilingual"><span class="ui-text-vi">Không thể tải công đoạn.</span><span class="ui-text-zh">工序載入失敗。</span></div>';
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
    const descriptionText=`${cp[0].po?`PO ${cp[0].po} · `:''}${cp[0].desc||''} ${cp[0].color||''}`; // descriptionText（訂單描述全文）：畫面與滑鼠提示共用同一原始資料，不依語言拆分。
    html+=`<div class="orders-item-group">
      <div class="orders-item-toggle" onclick="toggleProgCodeDetail(${ordArg},${itemArg},${detailArg})">
        <i id="${ordersSafeAttr(detailId)}-icon" class="ti ti-chevron-right" style="color:var(--accent)"></i>
        <b>${ordersSafeText(code)}</b><span class="orders-item-description" data-ui-neutral-title title="${ordersSafeAttr(descriptionText)}">${ordersSafeText(descriptionText)}</span>
        <span class="orders-item-summary">
          ${ordersPairHtml(`${cp.length} công đoạn · ${(cp[0].orderQty||0).toLocaleString()} sản phẩm`,`${cp.length} 道工序 · ${(cp[0].orderQty||0).toLocaleString()} 件`)}
          ${canManageOrders()?`<button class="btn bsm" title="Điều chỉnh SL / 調整數量" aria-label="Điều chỉnh SL / 調整數量" onclick="event.stopPropagation();openOrderQtyAdjust(${ordArg},${itemArg})"><i class="ti ti-edit"></i></button>`:''}
        </span>
      </div>
      <div id="${ordersSafeAttr(detailId)}" style="display:none"></div>
    </div>`;
  });
  body.innerHTML=html||'<div class="orders-process-status ui-helper-text ui-bilingual"><span class="ui-text-vi">Chưa có dữ liệu công đoạn.</span><span class="ui-text-zh">尚無工序資料。</span></div>';
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
      <td>${ordersSafeText(p.processNo)}</td>
      <td>${ordersSafeText(p.processCategory||'—')} · ${ordersSafeText(processCategoryLabel(p.processCategory))}</td>
      <td>${ordersSafeText(p.processVi||p.processZh||'')}</td>
      <td class="ui-table-number-cell">${(p.orderQty||0).toLocaleString()}</td>
      <td class="ui-table-number-cell">${(p.workStdSec||p.processSec||0).toLocaleString()}</td>
      <td class="ui-table-number-cell">${(p.slPerHour||0).toLocaleString()}</td>
    </tr>`;
  }).join('');
  detail.innerHTML=`<table class="orders-detail-table ui-table" data-ui-table-layout="special"><thead><tr>
    <th data-orders-column="processNo">${ordersPairHtml('Số CĐ','工序號')}</th>
    <th data-orders-column="category">${ordersPairHtml('Phân loại','加工分類')}</th>
    <th data-orders-column="name">${ordersPairHtml('Tên CĐ','工序名稱')}</th>
    <th data-orders-column="quantity" class="ui-table-number-cell">${ordersPairHtml('SL đơn','訂單量')}</th>
    <th data-orders-column="seconds" class="ui-table-number-cell">${ordersPairHtml('Giây công đoạn hiện tại','目前主檔工序秒數')}</th>
    <th data-orders-column="hourlyQty" class="ui-table-number-cell">${ordersPairHtml('SL tiêu chuẩn/giờ','標準產量/時')}</th>
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
      return `<tr><td>${ordersSafeText(r.targetId||'—')}</td><td>—</td><td>${Number(quantity.before||0).toLocaleString()}</td><td>${Number(quantity.after||0).toLocaleString()}</td><td>${ordersSafeText(r.note||'')}</td><td>${ordersSafeText(r.createdBy||'')}<br><span class="orders-history-time ui-helper-text">${ordersSafeText(fmtTimeVN(r.createdAt))}</span></td></tr>`;
    }).join(''):'<tr><td colspan="6"><div class="ui-language-sections"><div class="ui-language-section is-vi">Chưa có dữ liệu</div><div class="ui-language-section is-zh">尚無資料</div></div></td></tr>';
  }
  const moreButton=g('order-adjust-history-more'); // moreButton（載入更多按鈕）
  if(moreButton) moreButton.hidden=!window.PCMSHistory?.hasMore?.('operationLogs',{permissionKey:'progress',actions:['orderItemQuantityUpdate'],limit:50});
}

async function saveActualShipDate(ordId,value,input){
  if(input) input.disabled=true;
  try{
    if(!window.PCMSOrderService?.setActualShipDate) throw new Error('Dịch vụ đơn hàng chưa sẵn sàng. / 訂單服務尚未載入。');
    const saved=await window.PCMSOrderService.setActualShipDate(ordId,value,{note:'actualShipDate'});
    const order=window.allOrders.find(item=>item.id===ordId);if(order)Object.assign(order,saved);
    await renderProgress();
    window.PCMSUIComponents.showToast({text:{vi:'Đã lưu ngày xuất hàng thực tế.',zh:'已儲存實際出貨日。'},kind:'success'});
  }catch(error){
    console.error('Không thể lưu ngày xuất hàng / 無法儲存實際出貨日：',error);
    if(input) input.disabled=false;
    await ordersMessage('Không thể lưu ngày xuất hàng thực tế.','無法儲存實際出貨日。','danger');
    await renderProgress();
  }
}

function chooseShipmentConfirmationDate(orderNo,initialDate){
  return new Promise(resolve=>{
    let settled=false;
    const body=document.createElement('div');
    const question=document.createElement('div');
    const field=document.createElement('div');
    const input=document.createElement('input');
    field.className='ui-dialog-field';field.hidden=true;
    field.append(window.PCMSUIText.create({vi:'Ngày xuất hàng thực tế',zh:'實際出貨日'},{tagName:'label'}));
    input.type='date';input.required=true;input.value=initialDate;field.append(input);
    const updateQuestion=()=>question.replaceChildren(window.PCMSUIComponents.createLanguageSections({
      vi:`Xác nhận đơn ${orderNo} đã xuất ngày ${input.value}?`,zh:`確認訂單 ${orderNo} 已於 ${input.value} 出貨？`
    }));
    input.addEventListener('input',updateQuestion);updateQuestion();body.append(question,field);
    window.PCMSUIComponents.openDialog({
      title:{vi:'Xác nhận xuất hàng',zh:'確認出貨'},body,
      actions:[
        {text:{vi:'Hủy',zh:'取消'},onClick:()=>{settled=true;resolve(null);}},
        {text:{vi:'Chọn ngày',zh:'選擇日期'},close:false,onClick:()=>{
          field.hidden=false;setTimeout(()=>{input.focus();input.showPicker?.();},0);return false;
        }},
        {text:{vi:'Xác nhận',zh:'確認'},kind:'primary',onClick:()=>{
          if(!input.reportValidity()) return false;
          settled=true;resolve(input.value);return true;
        }}
      ],
      onClose:()=>{if(!settled)resolve(null);}
    });
  });
}

async function confirmOrderShipment(orderId,orderNo){
  if((typeof canOpenPage==='function'&&!canOpenPage('progress'))||!window.PCMSOrderService?.setShipmentStatus) return;
  const input=g(`prog-ship-date-${orderId}`);
  const dateValue=input?.value||formatLocalDate(new Date());
  const confirmedDate=await chooseShipmentConfirmationDate(orderNo,dateValue);
  if(!confirmedDate) return;
  try{
    const saved=await window.PCMSOrderService.setShipmentStatus(orderId,'shipped',{actualShipDate:confirmedDate,note:orderNo});
    const order=window.allOrders.find(item=>item.id===orderId);if(order)Object.assign(order,saved);
    fillOrderSelects();await renderProgress();window.renderShippedOrders?.();
    await ordersMessage('Đã chuyển đơn sang mục đã xuất hàng.','訂單已移至已出貨訂單。','success');
  }catch(error){
    console.error('Không thể xác nhận xuất hàng / 無法確認出貨：',error);
    await ordersMessage('Không thể xác nhận xuất hàng.','無法確認出貨。','danger');
  }
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
