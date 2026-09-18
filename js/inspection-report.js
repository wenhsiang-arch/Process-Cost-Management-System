// inspection-report（檢驗報告功能）：訂單頁小圖示匯出及同模組範本分頁，沿用共用介面元件。
(function(){
  'use strict';
  const TARGETS=Object.freeze({code:'C6',description:'C7',color:'F7',orderNo:'C8',quantity:'F8'});
  const state={uid:'',mounted:false,meta:null,pendingFile:null,pendingSheetName:'',saving:false,downloading:false,deleting:false,exporting:new Set()};
  const g=id=>document.getElementById(id);
  const pair=(vi,zh)=>({vi,zh});
  const message=(vi,zh,kind='warning')=>window.PCMSUIComponents.alertDialog({kind,message:pair(vi,zh)});
  const splitError=error=>{
    const parts=String(error?.message||error||'').split('\n');
    return pair(parts[0]||'Không thể xử lý báo cáo.',parts[1]||'無法處理檢驗報告。');
  };
  function requirePermission(){
    if(typeof window.canOpenPage==='function'&&!window.canOpenPage('progress')){
      throw new Error('Không có quyền dùng dữ liệu đơn hàng.\n沒有訂單資料使用權限。');
    }
  }
  function isHunter(value){return String(value||'').trim().toUpperCase()==='HUNTER';}
  function normalizeText(value){return String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();}
  function sameText(left,right){return normalizeText(left).toUpperCase()===normalizeText(right).toUpperCase();}
  function validateTemplateBook(book){
    if(!Array.isArray(book?.SheetNames)||book.SheetNames.length!==1){
      throw new Error('Mẫu phải có đúng một trang tính.\n範本必須剛好只有一個工作表。');
    }
    const sheet=book.Sheets?.[book.SheetNames[0]];
    if(!sheet) throw new Error('Không đọc được trang tính mẫu.\n無法讀取範本工作表。');
    for(const address of Object.values(TARGETS)){
      if(sheet[address]?.f){
        throw new Error(`Ô ${address} không được chứa công thức.\n${address} 儲存格不可包含公式。`);
      }
      if(!sheet[address]||normalizeText(sheet[address].v)===''){
        throw new Error(`Ô ${address} cần có chữ hoặc số mẫu.\n${address} 儲存格需要有範例文字或數字。`);
      }
    }
    return {sheetName:book.SheetNames[0],sheet};
  }
  async function readBook(file){
    await window.PCMSFeatures.ensureSpreadsheetTool();
    return window.XLSX.read(await file.arrayBuffer(),{type:'array',cellStyles:true});
  }
  // convertLegacyTemplate（舊版範本本機轉換）：只在 .xls 時使用，原檔仍照原格式儲存與下載。
  async function convertLegacyTemplate(file,fileName){
    if(!/\.xls$/i.test(String(fileName||file?.name||'')))return file;
    const endpoint='http://127.0.0.1:8767/convert';
    let response;
    try{
      response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/vnd.ms-excel'},
        body:await file.arrayBuffer(),signal:AbortSignal.timeout(60000)});
    }catch(error){
      throw new Error('Không kết nối được công cụ chuyển mẫu. Hãy mở tệp khởi động công cụ trên máy rồi thử lại.\n無法連接本機範本轉換工具，請先開啟「啟動品檢報告轉換工具.bat」再重試。');
    }
    if(!response.ok){
      throw new Error('Không thể chuyển tệp .xls mà vẫn giữ định dạng. Mẫu gốc không bị thay đổi.\n無法保留格式並轉換 .xls，原始範本未被修改。');
    }
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength<1||bytes.byteLength>20*1024*1024){
      throw new Error('Tệp sau chuyển đổi không hợp lệ.\n轉換後的檔案不正確。');
    }
    return new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function renderRoot(){
    const root=g('inspection-report-root');
    if(!root||state.mounted) return;
    root.innerHTML=`
      <div class="inspection-report-page ui-work-panel">
        <section class="inspection-report-operation ui-operation-panel">
          <div class="ui-command-row inspection-report-command-row">
            <div class="ui-context-grid is-single inspection-report-upload">
              <button type="button" class="ui-context-item ui-file-picker" id="inspection-report-drop">
                <i class="ti ti-file-spreadsheet" aria-hidden="true"></i>
                <div>
                  <span class="ui-dual-copy"><strong>Tệp mẫu báo cáo</strong><span>報告範本檔案</span></span>
                  <span class="ui-context-note ui-dual-copy" id="inspection-report-file-note"><strong>Chọn hoặc thả tệp .xls / .xlsx</strong><span>選擇或拖入 .xls／.xlsx 檔案</span></span>
                </div>
              </button>
            </div>
            <div class="ui-command-actions inspection-report-actions">
              <details class="inspection-report-guide-disclosure" id="inspection-report-guide" data-ui-dismiss-outside data-ui-dismiss-on-content>
                <summary class="ui-command-action"><i class="ti ti-book" aria-hidden="true"></i><span class="ui-dual-copy"><strong>Hướng dẫn</strong><span>使用說明</span></span></summary>
                <div class="inspection-report-guide-panel ui-language-sections">
                  <div class="ui-language-section is-vi" lang="vi">Chọn hoặc thả mẫu .xls / .xlsx rồi nhấn Lưu mẫu. Năm ô C6, C7, F7, C8, F8 cần có chữ hoặc số mẫu; khi xuất, hệ thống thay nội dung bằng dữ liệu đơn hàng và giữ định dạng của từng ô. Mẫu .xls được tự chuyển trên máy. Tại bảng đơn hàng phía trên, nhấn biểu tượng báo cáo, chọn tên và vị trí lưu; mỗi mã hàng có một trang tính.</div>
                  <div class="ui-language-section is-zh" lang="zh-Hant">選擇或拖入 .xls／.xlsx 範本，再按「儲存範本」。C6、C7、F7、C8、F8 五格須有範例文字或數字；匯出時以訂單資料替換內容，保留各格格式。舊版 .xls 由本機自動轉換。在上方訂單列表點報告圖示，選擇檔名與儲存位置；每個款號產生一個分頁。</div>
                </div>
              </details>
              <button type="button" class="ui-command-action is-primary is-condition-dependent" id="inspection-report-save" disabled>
                <i class="ti ti-device-floppy" aria-hidden="true"></i>
                <span class="ui-dual-copy"><strong>Lưu mẫu</strong><span>儲存範本</span></span>
              </button>
              <button type="button" class="ui-command-action is-danger" id="inspection-report-cancel" disabled>
                <i class="ti ti-eraser" aria-hidden="true"></i>
                <span class="ui-dual-copy"><strong>Hủy tệp đã chọn</strong><span>取消匯入檔案</span></span>
              </button>
            </div>
          </div>
          <input type="file" id="inspection-report-file" accept=".xls,.xlsx" hidden>
        </section>
        <section class="ui-data-section">
          <div class="ui-section-header"><i class="ti ti-file-spreadsheet" aria-hidden="true"></i>
            <span class="ui-dual-copy"><strong>Mẫu đang sử dụng</strong><span>目前使用的範本</span></span>
          </div>
          <div class="inspection-report-status ui-table-frame"><div class="ui-table-scroll" data-ui-floating-scroll="only">
            <table id="inspection-report-table" class="ui-table inspection-report-table" data-ui-table-controls="auto" data-ui-table-sort="none" data-ui-table-sticky="original">
              <thead><tr>
                <th><span class="ui-dual-copy"><strong>Tệp mẫu</strong><span>範本檔案</span></span></th>
                <th><span class="ui-dual-copy"><strong>Dung lượng</strong><span>檔案大小</span></span></th>
                <th><span class="ui-dual-copy"><strong>Cập nhật</strong><span>更新時間</span></span></th>
                <th><span class="ui-dual-copy"><strong>Trạng thái</strong><span>狀態</span></span></th>
                <th><span class="ui-dual-copy"><strong>Thao tác</strong><span>操作</span></span></th>
              </tr></thead><tbody id="inspection-report-status" role="status"></tbody>
            </table>
          </div></div>
        </section>
      </div>`;
    g('inspection-report-drop').addEventListener('click',()=>g('inspection-report-file').click());
    g('inspection-report-file').addEventListener('change',event=>{
      const file=event.target.files?.[0];event.target.value='';if(file) void selectFile(file);
    });
    g('inspection-report-save').addEventListener('click',()=>void savePending());
    g('inspection-report-cancel').addEventListener('click',cancelPending);
    g('inspection-report-status').addEventListener('click',event=>{
      if(event.target.closest('#inspection-report-download')) void downloadOriginal();
      if(event.target.closest('#inspection-report-delete')) void deleteSaved();
    });
    if(window.PCMSUIFileDrop){
      window.PCMSUIFileDrop.register({
        id:'inspection-report-template',page:'inspection-report-template',accept:['.xls','.xlsx'],maxFiles:1,
        text:pair('Thả tệp mẫu báo cáo','放開即可匯入報告範本'),onDrop:files=>selectFile(files[0]),
        onReject:detail=>{const value=window.PCMSUIText.resolve(detail?.message||pair('Không thể nhận tệp.','無法接收檔案。'));void message(value.vi,value.zh);}
      });
    }
    state.mounted=true;
    renderStatus();
  }
  function renderStatus(){
    const host=g('inspection-report-status');if(!host)return;
    host.replaceChildren();
    const current=state.meta;
    const pending=state.pendingFile;
    const fileNote=g('inspection-report-file-note');
    if(fileNote){
      fileNote.querySelector('strong').textContent=pending?`Đang chọn: ${pending.name}`:'Chọn hoặc thả tệp .xls / .xlsx';
      fileNote.querySelector('span').textContent=pending?`目前選擇：${pending.name}`:'選擇或拖入 .xls／.xlsx 檔案';
      fileNote.dataset.uiNeutralTitle=pending?.name||'';
    }
    if(!current){
      const row=document.createElement('tr');
      const cell=document.createElement('td');cell.colSpan=5;cell.className='inspection-report-empty';
      cell.appendChild(window.PCMSUIText.create(pair('Chưa có mẫu báo cáo.','尚未匯入品檢報告範本。')));
      row.appendChild(cell);host.appendChild(row);
    }else{
      const row=document.createElement('tr');
      const fileCell=document.createElement('td');fileCell.className='inspection-report-file-cell';
      const fileName=document.createElement('strong');fileName.textContent=current.fileName||'—';
      fileName.dataset.uiNeutralTitle=current.fileName||'';fileCell.appendChild(fileName);
      const sizeCell=document.createElement('td');sizeCell.textContent=`${(Number(current.fileSize||0)/1024).toLocaleString('en-US',{maximumFractionDigits:0})} KB`;
      const dateCell=document.createElement('td');dateCell.textContent=new Date(current.updatedAt).toLocaleString('vi-VN',{hour12:false});
      const statusCell=document.createElement('td');statusCell.appendChild(window.PCMSUIText.create(pair('Đã lưu','已儲存')));
      const actionsCell=document.createElement('td');actionsCell.className='inspection-report-row-actions';
      actionsCell.innerHTML=`<div class="inspection-report-action-group">
        <button type="button" id="inspection-report-download" class="inspection-report-row-button">
          <i class="ti ti-file-download" aria-hidden="true"></i><span class="ui-dual-copy"><strong>Tải file gốc</strong><span>下載原始檔</span></span>
        </button>
        <button type="button" id="inspection-report-delete" class="inspection-report-row-button is-danger">
          <i class="ti ti-trash" aria-hidden="true"></i><span class="ui-dual-copy"><strong>Xóa</strong><span>刪除</span></span>
        </button></div>`;
      row.append(fileCell,sizeCell,dateCell,statusCell,actionsCell);host.appendChild(row);
    }
    const button=g('inspection-report-save');
    const busy=state.saving||state.downloading||state.deleting;
    const picker=g('inspection-report-drop');if(picker)picker.disabled=busy;
    if(button){
      button.disabled=!pending||busy;
      button.classList.toggle('is-ready',!!pending);
    }
    const cancel=g('inspection-report-cancel');if(cancel)cancel.disabled=!pending||busy;
    const download=g('inspection-report-download');if(download)download.disabled=busy;
    const remove=g('inspection-report-delete');if(remove)remove.disabled=busy;
  }
  function cancelPending(){
    if(state.saving||state.downloading||state.deleting||!state.pendingFile)return;
    state.pendingFile=null;state.pendingSheetName='';g('inspection-report-file').value='';renderStatus();
  }
  async function refreshMeta(){
    const rows=await window.PCMSInspectionReportStore.listActive();
    if(rows.length>1){
      state.meta=null;renderStatus();
      await message('Hiện có hai mẫu báo cáo. Vui lòng kiểm tra.','目前存在兩個範本，請檢查。','danger');
      return null;
    }
    state.meta=rows[0]||null;
    renderStatus();
    return state.meta;
  }
  async function selectFile(file){
    if(state.saving||state.downloading||state.deleting)return;
    try{
      requirePermission();
      window.PCMSInspectionReportStore.validateFile(file);
      const analysis=validateTemplateBook(await readBook(file));
      state.pendingFile=file;state.pendingSheetName=analysis.sheetName;renderStatus();
    }catch(error){
      state.pendingFile=null;state.pendingSheetName='';renderStatus();
      const detail=splitError(error);await message(detail.vi,detail.zh,'danger');
    }
  }
  async function savePending(){
    if(!state.pendingFile||state.saving||state.downloading||state.deleting)return;
    const file=state.pendingFile;
    try{
      requirePermission();
      state.saving=true;renderStatus();
      const current=await window.PCMSInspectionReportStore.loadOnly();
      if(current){
        const same=current.fileName===file.name;
        const confirmed=await window.PCMSUIComponents.confirmDialog({
          title:pair('Xác nhận thay mẫu','確認替換範本'),
          body:window.PCMSUIComponents.createLanguageSections(pair(
            same?`Tệp ${file.name} đã có. Bạn có muốn ghi đè mẫu hiện tại không?`:
              `Mẫu hiện tại: ${current.fileName}. Tệp mới: ${file.name}. Bạn có muốn thay mẫu hiện tại không?`,
            same?`已存在同名範本「${file.name}」，確定覆蓋目前範本嗎？`:
              `目前範本：${current.fileName}；新檔案：${file.name}。確定替換目前範本嗎？`
          ))
        });
        if(!confirmed)return;
      }
      state.meta=await window.PCMSInspectionReportStore.saveFile(file,state.pendingSheetName,current);
      state.pendingFile=null;state.pendingSheetName='';renderStatus();
      window.PCMSUIComponents.showToast({kind:'success',text:pair('Đã lưu mẫu báo cáo.','檢驗報告範本已儲存。')});
    }catch(error){
      console.error(error);const detail=splitError(error);await message(detail.vi,detail.zh,'danger');
      try{await refreshMeta();}catch(_){/* 原範本仍由雲端保留，畫面下一次開啟會再核對。 */}
    }finally{state.saving=false;renderStatus();}
  }
  async function downloadOriginal(){
    if(!state.meta||state.saving||state.downloading||state.deleting)return;
    const expected=state.meta;
    try{
      requirePermission();
      state.downloading=true;renderStatus();
      const handle=await window.PCMSFileIO.chooseSaveHandle({
        id:'inspection-report-original',suggestedName:String(expected.fileName||'report-template.xlsx'),
        types:[/\.xls$/i.test(String(expected.fileName||''))?{
          description:'Tệp Excel cũ / 舊版 Excel 表格檔',accept:{'application/vnd.ms-excel':['.xls']}
        }:window.PCMSFileIO.spreadsheetFileType],
        onUnsupported:()=>message('Trình duyệt này không hỗ trợ chọn vị trí lưu.','此瀏覽器不支援選擇儲存位置。','warning')
      });
      if(!handle)return;
      const current=await window.PCMSInspectionReportStore.loadOnly();
      if(!current||current.id!==expected.id||current.contentHash!==expected.contentHash
        ||Number(current.updatedAt)!==Number(expected.updatedAt)){
        throw new Error('Mẫu đã được thay đổi. Hãy kiểm tra rồi tải lại.\n範本已變更，請重新檢查後下載。');
      }
      const file=await window.PCMSInspectionReportStore.loadFile(current);
      await window.PCMSFileIO.writeToHandle(handle,file);
      window.PCMSUIComponents.showToast({kind:'success',text:pair('Đã lưu file mẫu gốc.','已儲存原始範本檔。')});
      try{
        await window.PCMSHistory.saveOperationLog({permissionKey:'progress',feature:'inspectionReport',
          action:'inspectionTemplateDownload',status:'success',itemCount:1,detailCount:Number(current.chunkCount)||0,
          fileName:String(handle.name||current.fileName)});
      }catch(logError){
        console.error(logError);
        await message('Đã lưu tệp nhưng không thể ghi lịch sử thao tác.','檔案已儲存，但操作紀錄寫入失敗。','warning');
      }
    }catch(error){
      console.error(error);const detail=splitError(error);await message(detail.vi,detail.zh,'danger');
      try{await refreshMeta();}catch(_){/* 只更新本頁狀態，不動既有範本。 */}
    }finally{state.downloading=false;renderStatus();}
  }
  async function deleteSaved(){
    if(!state.meta||state.saving||state.downloading||state.deleting)return;
    const expected=state.meta;
    try{
      requirePermission();state.deleting=true;renderStatus();
      const confirmed=await window.PCMSUIComponents.confirmDialog({
        title:pair('Xóa vĩnh viễn mẫu báo cáo','永久刪除報告範本'),
        body:window.PCMSUIComponents.createLanguageSections(pair(
          `Sẽ xóa vĩnh viễn tệp ${expected.fileName}. Không thể hoàn tác; hãy tải file gốc trước nếu cần giữ lại.`,
          `將永久刪除「${expected.fileName}」。此操作無法復原；如需保留，請先下載原始檔。`
        ))
      });
      if(!confirmed)return;
      await window.PCMSInspectionReportStore.removeFile(expected);
      state.meta=null;renderStatus();
      window.PCMSUIComponents.showToast({kind:'success',text:pair('Đã xóa mẫu báo cáo.','已刪除報告範本。')});
    }catch(error){
      console.error(error);const detail=splitError(error);await message(detail.vi,detail.zh,'danger');
      try{await refreshMeta();}catch(_){/* 保留畫面原狀供重新檢查。 */}
    }finally{state.deleting=false;renderStatus();}
  }
  function normalizeSheetName(value,used){
    const base=String(value||'').replace(/[\[\]:*?/\\\x00-\x1f]/g,'_').replace(/^'+|'+$/g,'').trim()||'Item';
    let candidate=base.slice(0,31),number=2;
    while(used.has(candidate.toUpperCase())){
      const suffix=`_${number++}`;candidate=base.slice(0,31-suffix.length)+suffix;
    }
    used.add(candidate.toUpperCase());return candidate;
  }
  async function loadProductCodes(items){
    const byId=new Map((window.D||[]).filter(row=>row?.productId&&row?.code)
      .map(row=>[String(row.productId),String(row.code)]));
    const missing=[...new Set(items.map(item=>String(item.productId||'')))].filter(id=>id&&!byId.has(id));
    for(let offset=0;offset<missing.length;offset+=10){
      const group=missing.slice(offset,offset+10);
      const snapshots=await Promise.all(group.map(id=>window._getDoc(window._doc('products',id))));
      snapshots.forEach((snapshot,index)=>{if(snapshot.exists()&&snapshot.data()?.code)byId.set(group[index],String(snapshot.data().code));});
    }
    return byId;
  }
  async function rowsForOrder(order){
    const items=(await window.PCMSOrderService.loadOrderItems(order.id)).filter(item=>item.active!==false);
    if(!items.length)throw new Error('Đơn hàng không có mã hàng.\n訂單沒有款號明細。');
    const codes=await loadProductCodes(items),byCode=new Map();
    for(const item of items){
      const code=normalizeText(codes.get(String(item.productId)));
      const description=normalizeText(item.description),color=normalizeText(item.color),quantity=Number(item.quantity);
      if(!code||!description||!color||!Number.isSafeInteger(quantity)||quantity<=0){
        throw new Error(`Dòng ${item.lineNumber||'?'} thiếu mã, mô tả tiếng Anh, màu tiếng Anh hoặc số lượng.\n第 ${item.lineNumber||'?'} 列缺少款號、英文描述、英文顏色或有效數量。`);
      }
      const key=code.toUpperCase(),previous=byCode.get(key);
      if(previous){
        if(!sameText(previous.description,description)||!sameText(previous.color,color)){
          throw new Error(`Mã ${code} có mô tả hoặc màu khác nhau. Hãy kiểm tra đơn hàng.\n款號 ${code} 的描述或顏色不一致，請先核對訂單。`);
        }
        if(!Number.isSafeInteger(previous.quantity+quantity))throw new Error('Tổng số lượng vượt giới hạn.\n合計數量超出安全範圍。');
        previous.quantity+=quantity;previous.lineCount++;
      }else byCode.set(key,{code,description,color,quantity,lineCount:1});
    }
    return [...byCode.values()];
  }
  // 以下僅改動必要的工作表 XML（試算表結構），原始 styles.xml（範本樣式檔）完全不重寫。
  const xmlEscape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const xmlAttribute=(tag,name)=>tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
  function reportXmlError(){
    throw new Error('Không thể giữ đầy đủ định dạng mẫu. Vui lòng kiểm tra năm ô cần điền và tệp gốc.\n無法完整保留範本格式，請檢查五個填寫格與原始檔。');
  }
  function setXmlCell(sheetXml,address,value,numeric=false){
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(String(value))) reportXmlError();
    const rowNumber=address.match(/\d+$/)?.[0];
    const data=sheetXml.match(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/);
    if(!data) reportXmlError();
    const rowPattern=new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*>[\\s\\S]*?<\\/row>`);
    const row=data[0].match(rowPattern);
    if(!row) reportXmlError();
    const cellPattern=new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
    const cell=row[0].match(cellPattern);
    if(!cell||/<f(?:\s|>)/.test(cell[0])) reportXmlError();
    const opening=cell[0].match(/^<c\b[^>]*?(?:\/>|>)/)?.[0];
    if(!opening) reportXmlError();
    const attributes=opening.replace(/\/?\>$/,'').replace(/\s+t="[^"]*"/,'');
    const replacement=numeric
      ?`${attributes} t="n"><v>${Number(value)}</v></c>`
      :`${attributes} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    return sheetXml.replace(data[0],data[0].replace(row[0],row[0].replace(cell[0],replacement)));
  }
  function fillSheetXml(source,row,orderNo){
    let xml=source;
    for(const [address,value,numeric] of [
      [TARGETS.code,row.code,false],[TARGETS.description,row.description,false],
      [TARGETS.color,row.color,false],[TARGETS.orderNo,orderNo,false],
      [TARGETS.quantity,row.quantity,true]
    ]) xml=setXmlCell(xml,address,value,numeric);
    return xml;
  }
  async function buildReportBlob(templateFile,orderNo,rows){
    if(!rows?.length) reportXmlError();
    const Zip=await window.PCMSFeatures.ensureInspectionReportZipTool();
    const zip=await Zip.loadAsync(await templateFile.arrayBuffer(),{checkCRC32:true});
    const getXml=async path=>{
      const part=zip.file(path);
      if(!part) reportXmlError();
      const xml=await part.async('string');
      if(xml.length>10_000_000) reportXmlError();
      return xml;
    };
    let workbook=await getXml('xl/workbook.xml');
    let relationships=await getXml('xl/_rels/workbook.xml.rels');
    let types=await getXml('[Content_Types].xml');
    if(!zip.file('xl/styles.xml')) reportXmlError();
    const sheets=workbook.match(/<sheets\b[^>]*>[\s\S]*?<\/sheets>/);
    const tags=sheets?.[0].match(/<sheet\b[^>]*\/>/g);
    if(!sheets||tags?.length!==1) reportXmlError();
    const original=tags[0],relationId=xmlAttribute(original,'r:id');
    const relation=relationships.match(/<Relationship\b[^>]*\/>/g)?.find(tag=>xmlAttribute(tag,'Id')===relationId);
    const target=relation&&xmlAttribute(relation,'Target');
    if(!target||!xmlAttribute(relation,'Type')?.endsWith('/worksheet')) reportXmlError();
    const sourcePath=target.startsWith('/')?target.slice(1):
      new URL(target,'https://template.local/xl/workbook.xml').pathname.slice(1);
    if(!/^xl\/worksheets\/[^/]+\.xml$/.test(sourcePath)) reportXmlError();
    const sheetXml=await getXml(sourcePath);
    const filename=sourcePath.split('/').pop();
    const sheetRels=`xl/worksheets/_rels/${filename}.rels`;
    const sourceRels=zip.file(sheetRels)?await getXml(sheetRels):null;
    const used=new Set(),sourceName=xmlAttribute(original,'name')||'';
    const names=rows.map(row=>normalizeSheetName(row.code,used));
    const originalId=Number(xmlAttribute(original,'sheetId'));
    if(!Number.isSafeInteger(originalId)||originalId<1) reportXmlError();
    const sheetTags=[],relations=[],overrides=[];
    for(let index=0;index<rows.length;index++){
      const path=index===0?sourcePath:`xl/worksheets/pcms_inspection_${index+1}.xml`;
      if(index>0&&zip.file(path)) reportXmlError();
      zip.file(path,fillSheetXml(sheetXml,rows[index],orderNo));
      // 工作表的列印設定等關聯與範本同時複製；相對目標仍由相同 worksheets 目錄解析。
      if(index>0&&sourceRels){
        const cloneRels=`xl/worksheets/_rels/${path.split('/').pop()}.rels`;
        if(zip.file(cloneRels))reportXmlError();
        zip.file(cloneRels,sourceRels);
      }
      const id=index===0?relationId:`pcmsInspection${index+1}`;
      if(index>0&&relationships.includes(`Id="${id}"`)) reportXmlError();
      // 保留原標籤上的 xmlns:r（關聯命名空間）與其他屬性；部分範本只在此標籤宣告。
      const tag=original.replace(/(\bname=")[^"]*(")/,(_,left,right)=>left+xmlEscape(names[index])+right)
        .replace(/(\bsheetId=")[^"]*(")/,(_,left,right)=>left+(originalId+index)+right)
        .replace(/(\br:id=")[^"]*(")/,(_,left,right)=>left+id+right);
      sheetTags.push(tag);
      if(index>0){
        relations.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/${path.slice(3)}"/>`);
        overrides.push(`<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
      }
    }
    workbook=workbook.replace(sheets[0],sheets[0].replace(original,sheetTags.join('')));
    if(relations.length){
      if(!/<\/Relationships>/.test(relationships)||!/<\/Types>/.test(types)) reportXmlError();
      relationships=relationships.replace('</Relationships>',`${relations.join('')}</Relationships>`);
      types=types.replace('</Types>',`${overrides.join('')}</Types>`);
    }
    // 原分頁改名後列印範圍也須更新；多款號時再複製各頁的專屬列印設定。
    const defined=workbook.match(/<definedNames\b[^>]*>[\s\S]*?<\/definedNames>/);
    if(defined){
      const local=[...defined[0].matchAll(/<definedName\b[^>]*\blocalSheetId="0"[^>]*>[\s\S]*?<\/definedName>/g)];
      const rename=(text,index)=>text.replaceAll(`'${sourceName.replaceAll("'","''")}'!`,
        `'${names[index].replaceAll("'","''")}'!`);
      const clones=[];
      for(let index=1;index<rows.length;index++) for(const match of local){
        clones.push(rename(match[0].replace('localSheetId="0"',`localSheetId="${index}"`),index));
      }
      workbook=workbook.replace(defined[0],rename(defined[0],0).replace('</definedNames>',
        `${clones.join('')}</definedNames>`));
    }
    zip.file('xl/workbook.xml',workbook);
    zip.file('xl/_rels/workbook.xml.rels',relationships);
    zip.file('[Content_Types].xml',types);
    const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
    return new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  async function exportOrder(orderId){
    if(state.exporting.has(orderId))return;
    state.exporting.add(orderId);
    let progress=null;
    try{
      requirePermission();
      const orderSnapshot=await window._getDoc(window._doc('orders',String(orderId||'')));
      const order=orderSnapshot.exists()?{id:orderSnapshot.id,...orderSnapshot.data()}:null;
      if(!order||!isHunter(order.client)||order.importStatus!=='ready'||order.lifecycleStatus!=='active'){
        throw new Error('Đơn HUNTER này không còn ở trạng thái có thể xuất.\n這筆 HUNTER 訂單目前不可匯出。');
      }
      const meta=await window.PCMSInspectionReportStore.loadOnly();
      if(!meta)throw new Error('Chưa có mẫu báo cáo. Vui lòng nhập mẫu trước.\n尚無檢驗報告範本，請先匯入。');
      const rows=await rowsForOrder(order);
      const suggested=`${String(order.orderId||'order').replace(/[\\/:*?"<>|]/g,'_')}-inspection-report.xlsx`;
      const handle=await window.PCMSFileIO.chooseSaveHandle({
        id:'inspection-report-export',suggestedName:suggested,types:[window.PCMSFileIO.spreadsheetFileType],
        onUnsupported:()=>message('Trình duyệt này không hỗ trợ chọn vị trí lưu.','此瀏覽器不支援選擇儲存位置。','warning')
      });
      if(!handle)return;
      progress=window.PCMSUIComponents.progressDialog({title:pair('Xuất báo cáo kiểm tra','匯出檢驗報告'),value:5,
        text:pair('Đang tạo tệp Excel','正在產生 Excel 表格檔'),detail:pair('Vui lòng chờ.','請稍候。'),allowClose:false});
      const file=await window.PCMSInspectionReportStore.loadFile(meta);
      const converted=await convertLegacyTemplate(file,meta.fileName);
      const template=await readBook(converted);
      progress?.update({value:45,text:pair('Đang tạo từng trang tính','正在建立各款號分頁')});
      validateTemplateBook(template);
      const output=await buildReportBlob(converted,String(order.orderId||''),rows);
      progress?.update({value:85,text:pair('Đang lưu tệp','正在儲存檔案')});
      await window.PCMSFileIO.writeToHandle(handle,output);
      progress?.close?.();progress=null;
      window.PCMSUIComponents.showToast({kind:'success',text:pair(
        `Đã lưu báo cáo gồm ${rows.length} trang tính.`,`已儲存檢驗報告，共 ${rows.length} 個款號分頁。`
      )});
      try{
        await window.PCMSHistory.saveOperationLog({permissionKey:'progress',feature:'inspectionReport',
          action:'inspectionReportExcelExport',status:'success',itemCount:rows.length,
          detailCount:rows.reduce((sum,row)=>sum+row.lineCount,0),fileName:String(handle.name||suggested),note:String(order.orderId||'')});
      }catch(logError){
        console.error(logError);
        await message('Đã lưu tệp nhưng không thể ghi lịch sử thao tác.','檔案已儲存，但操作紀錄寫入失敗。','warning');
      }
    }catch(error){
      console.error(error);progress?.close?.();
      const detail=splitError(error);await message(detail.vi,detail.zh,'danger');
    }finally{state.exporting.delete(orderId);}
  }
  async function inspectionReportInit(){
    requirePermission();
    const uid=String(window.firebaseAuthUser?.uid||'');
    if(state.uid!==uid){state.uid=uid;state.pendingFile=null;state.pendingSheetName='';state.meta=null;}
    renderRoot();
    try{await refreshMeta();}catch(error){const detail=splitError(error);await message(detail.vi,detail.zh,'danger');}
  }
  function inspectionReportLeave(){state.pendingFile=null;state.pendingSheetName='';g('inspection-report-guide')?.removeAttribute('open');renderStatus();}
  window.inspectionReportInit=inspectionReportInit;
  window.inspectionReportLeave=inspectionReportLeave;
  window.PCMSInspectionReport=Object.freeze({exportOrder,validateTemplateBook,rowsForOrder,buildReportBlob,normalizeSheetName});
})();
