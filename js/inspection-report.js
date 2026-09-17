// inspection-report（檢驗報告功能）：訂單頁小圖示匯出及同模組範本分頁，沿用共用介面元件。
(function(){
  'use strict';
  const TARGETS=Object.freeze({code:'C6',description:'C7',color:'F7',orderNo:'C8',quantity:'F8'});
  const state={uid:'',mounted:false,meta:null,pendingFile:null,pendingSheetName:'',saving:false,exporting:new Set()};
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
    const values=Object.entries(sheet).filter(([key])=>!key.startsWith('!'))
      .map(([,cell])=>normalizeText(cell?.v).toUpperCase());
    if(!values.includes('HUNTER')||!values.includes('WEBBING WORLD')){
      throw new Error('Mẫu phải giữ sẵn HUNTER và WEBBING WORLD.\n範本必須保留 HUNTER 與 WEBBING WORLD 固定文字。');
    }
    for(const address of Object.values(TARGETS)){
      if(sheet[address]?.f){
        throw new Error(`Ô ${address} không được chứa công thức.\n${address} 儲存格不可包含公式。`);
      }
    }
    return {sheetName:book.SheetNames[0],sheet};
  }
  async function readBook(file){
    await window.PCMSFeatures.ensureSpreadsheetTool();
    return window.XLSX.read(await file.arrayBuffer(),{type:'array',cellStyles:true});
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
                  <span class="ui-context-note ui-dual-copy"><strong>Chọn hoặc thả một tệp .xlsx</strong><span>選擇或拖入一個 .xlsx 檔案</span></span>
                </div>
              </button>
            </div>
            <div class="ui-command-actions inspection-report-actions">
              <details class="inspection-report-guide-disclosure" id="inspection-report-guide" data-ui-dismiss-outside data-ui-dismiss-on-content>
                <summary class="ui-command-action"><i class="ti ti-book" aria-hidden="true"></i><span class="ui-dual-copy"><strong>Hướng dẫn</strong><span>使用說明</span></span></summary>
                <div class="inspection-report-guide-panel ui-language-sections">
                  <div class="ui-language-section is-vi" lang="vi">Chọn hoặc thả tệp .xlsx rồi nhấn Lưu mẫu. Chữ cố định, phông chữ và định dạng trong mẫu được giữ nguyên; nội dung có sẵn ở C6, C7, F7, C8 và F8 sẽ được thay bằng dữ liệu đơn hàng khi xuất. Tại bảng đơn hàng phía trên, nhấn biểu tượng báo cáo, chọn tên và vị trí lưu; mỗi mã hàng có một trang tính.</div>
                  <div class="ui-language-section is-zh" lang="zh-Hant">選擇或拖入 .xlsx 範本，再按「儲存範本」。範本固定文字、字體與格式會保留；匯出時，C6、C7、F7、C8、F8 原有內容會以訂單資料替換。在上方訂單列表點報告圖示，選擇檔名與儲存位置；每個款號產生一個分頁。</div>
                </div>
              </details>
              <button type="button" class="ui-command-action is-primary is-condition-dependent" id="inspection-report-save" disabled>
                <i class="ti ti-device-floppy" aria-hidden="true"></i>
                <span class="ui-dual-copy"><strong>Lưu mẫu</strong><span>儲存範本</span></span>
              </button>
            </div>
          </div>
          <input type="file" id="inspection-report-file" accept=".xlsx" hidden>
        </section>
        <section class="ui-data-section">
          <div class="ui-section-header"><i class="ti ti-file-spreadsheet" aria-hidden="true"></i>
            <span class="ui-dual-copy"><strong>Mẫu đang sử dụng</strong><span>目前使用的範本</span></span>
          </div>
          <div class="inspection-report-status ui-table-frame" id="inspection-report-status" role="status"></div>
        </section>
      </div>`;
    g('inspection-report-drop').addEventListener('click',()=>g('inspection-report-file').click());
    g('inspection-report-file').addEventListener('change',event=>{
      const file=event.target.files?.[0];event.target.value='';if(file) void selectFile(file);
    });
    g('inspection-report-save').addEventListener('click',()=>void savePending());
    if(window.PCMSUIFileDrop){
      window.PCMSUIFileDrop.register({
        id:'inspection-report-template',page:'inspection-report-template',accept:['.xlsx'],maxFiles:1,
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
    const text=current
      ?pair(`Mẫu hiện tại: ${current.fileName} · ${new Date(current.updatedAt).toLocaleString('vi-VN')}`,
        `目前範本：${current.fileName} · ${new Date(current.updatedAt).toLocaleString('zh-TW')}`)
      :pair('Chưa có mẫu báo cáo.','尚未匯入品檢報告範本。');
    const icon=document.createElement('i');
    icon.className=current?'ti ti-circle-check':'ti ti-file-alert';
    icon.setAttribute('aria-hidden','true');
    const copy=document.createElement('div');copy.className='inspection-report-status-copy';
    copy.appendChild(window.PCMSUIText.create(text));
    if(pending){
      const line=document.createElement('div');
      line.appendChild(window.PCMSUIText.create(pair(`Đang chọn: ${pending.name}`,`目前選擇：${pending.name}`)));
      copy.appendChild(line);
    }
    host.append(icon,copy);
    const button=g('inspection-report-save');
    if(button)button.disabled=!pending||state.saving;
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
    if(!state.pendingFile||state.saving)return;
    const file=state.pendingFile;
    try{
      requirePermission();
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
      state.saving=true;renderStatus();
      state.meta=await window.PCMSInspectionReportStore.saveFile(file,state.pendingSheetName,current);
      state.pendingFile=null;state.pendingSheetName='';renderStatus();
      window.PCMSUIComponents.showToast({kind:'success',text:pair('Đã lưu mẫu báo cáo.','檢驗報告範本已儲存。')});
    }catch(error){
      console.error(error);const detail=splitError(error);await message(detail.vi,detail.zh,'danger');
      try{await refreshMeta();}catch(_){/* 原範本仍由雲端保留，畫面下一次開啟會再核對。 */}
    }finally{state.saving=false;renderStatus();}
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
    throw new Error('Cấu trúc mẫu không được hỗ trợ. Vui lòng dùng mẫu .xlsx đơn giản có năm ô đã định dạng.\n範本結構不支援；請使用五格已保留格式的單一工作表 .xlsx 範本。');
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
    const sourcePath=target.startsWith('/')?target.slice(1):`xl/${target}`;
    if(!/^xl\/worksheets\/[^/]+\.xml$/.test(sourcePath)) reportXmlError();
    const sheetXml=await getXml(sourcePath);
    if(rows.length>1){
      const filename=sourcePath.split('/').pop();
      const sheetRels=`xl/worksheets/_rels/${filename}.rels`;
      if(zip.file(sheetRels)) reportXmlError(); // 圖片、外部連結等依附檔不能直接共用。
    }
    const used=new Set(),sourceName=xmlAttribute(original,'name')||'';
    const names=rows.map(row=>normalizeSheetName(row.code,used));
    const originalId=Number(xmlAttribute(original,'sheetId'));
    if(!Number.isSafeInteger(originalId)||originalId<1) reportXmlError();
    const sheetTags=[],relations=[],overrides=[];
    for(let index=0;index<rows.length;index++){
      const path=index===0?sourcePath:`xl/worksheets/pcms_inspection_${index+1}.xml`;
      if(index>0&&zip.file(path)) reportXmlError();
      zip.file(path,fillSheetXml(sheetXml,rows[index],orderNo));
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
      // 工作表限定的列印範圍隨各款號分頁複製，避免只有第一頁有列印設定。
      const defined=workbook.match(/<definedNames\b[^>]*>[\s\S]*?<\/definedNames>/);
      if(defined){
        const local=[...defined[0].matchAll(/<definedName\b[^>]*\blocalSheetId="0"[^>]*>[\s\S]*?<\/definedName>/g)];
        const clones=[];
        for(let index=1;index<rows.length;index++) for(const match of local){
          clones.push(match[0].replace('localSheetId="0"',`localSheetId="${index}"`)
            .replaceAll(`'${sourceName.replaceAll("'","''")}'!`,`'${names[index].replaceAll("'","''")}'!`));
        }
        workbook=workbook.replace('</definedNames>',`${clones.join('')}</definedNames>`);
      }
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
      const template=await readBook(file);
      progress?.update({value:45,text:pair('Đang tạo từng trang tính','正在建立各款號分頁')});
      validateTemplateBook(template);
      const output=await buildReportBlob(file,String(order.orderId||''),rows);
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
