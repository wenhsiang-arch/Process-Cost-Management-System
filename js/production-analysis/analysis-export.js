// analysis-export（生產分析匯出程式）：統一處理篩選結果的 Excel（表格檔）匯出、列印與操作紀錄。
(function(){
  'use strict';

  function safeSpreadsheetValue(value){
    if(typeof value!=='string') return value??'';
    return /^[=+\-@]/.test(value)?`'${value}`:value;
  }
  function bilingualAlert(vi,zh,kind='warning'){
    return window.PCMSUIComponents?.alertDialog?.({
      title:{vi:kind==='danger'?'Lỗi':'Thông báo',zh:kind==='danger'?'錯誤':'提示'},
      message:{vi,zh},kind
    });
  }
  async function writeLog(action,itemCount,fileName,note){
    if(!window.PCMSHistory?.saveOperationLog) throw new Error('Chưa thể ghi lịch sử thao tác. / 尚無法寫入操作紀錄。');
    return window.PCMSHistory.saveOperationLog({
      permissionKey:'productionAnalysis',feature:'productionAnalysis',action,status:'success',
      itemCount,detailCount:itemCount,fileName,note
    });
  }
  function suggestedFileName(prefix){
    const date=new Date().toLocaleDateString('zh-TW').replace(/\//g,'-');
    return `${prefix}_${date}.xlsx`;
  }
  function buildWorkbook(options,spreadsheetTool){
    const columns=Array.isArray(options.columns)?options.columns:[];
    const metadata=[
      ['Báo cáo / 報表',options.title||''],
      ['Phạm vi / 篩選範圍',options.filterSummary||''],
      ['Thời gian xuất / 匯出時間',new Date().toLocaleString('zh-TW')],
      []
    ];
    const header=columns.map(column=>`${column.vi}\n${column.zh}`);
    const body=(options.rows||[]).map(row=>columns.map(column=>{
      const raw=typeof column.value==='function'?column.value(row):row?.[column.key];
      return safeSpreadsheetValue(raw);
    }));
    const sheet=spreadsheetTool.utils.aoa_to_sheet([...metadata,header,...body]);
    const headerRow=metadata.length;
    const lastColumn=Math.max(0,columns.length-1);
    const lastRow=Math.max(headerRow,headerRow+body.length);
    sheet['!freeze']={xSplit:0,ySplit:headerRow+1,topLeftCell:`A${headerRow+2}`,activePane:'bottomLeft'};
    if(columns.length) sheet['!autofilter']={ref:spreadsheetTool.utils.encode_range({s:{r:headerRow,c:0},e:{r:lastRow,c:lastColumn}})};
    sheet['!cols']=columns.map(column=>({wch:Number(column.width)||16}));
    for(let column=0;column<columns.length;column+=1){
      const cell=sheet[spreadsheetTool.utils.encode_cell({r:headerRow,c:column})];
      if(cell) cell.s={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'1A3A5C'}},alignment:{horizontal:'center',vertical:'center',wrapText:true}};
    }
    const explanationRows=[
      ['Mục / 項目','Nội dung / 內容'],
      ['Phiên bản tính toán / 計算版本',window.PCMSProductionAnalysisCalculations?.calculationVersion||'production-analysis-v1'],
      ...(options.explanations||[]).map(item=>[safeSpreadsheetValue(item.label),safeSpreadsheetValue(item.content)])
    ];
    const explanationSheet=spreadsheetTool.utils.aoa_to_sheet(explanationRows);
    explanationSheet['!cols']=[{wch:28},{wch:100}];
    const workbook=spreadsheetTool.utils.book_new();
    spreadsheetTool.utils.book_append_sheet(workbook,sheet,'Báo cáo_報表');
    spreadsheetTool.utils.book_append_sheet(workbook,explanationSheet,'Cách tính_計算說明');
    return workbook;
  }
  async function exportWorkbook(options={}){
    const fileName=suggestedFileName(options.filePrefix||'生產分析');
    const saveHandle=await window.PCMSFileIO.chooseSaveHandle({
      suggestedName:fileName,types:[window.PCMSFileIO.spreadsheetFileType],
      onUnsupported:()=>bilingualAlert(
        'Trình duyệt này không hỗ trợ chọn vị trí lưu. Đã dừng xuất tệp.',
        '此瀏覽器不支援選擇儲存位置，已停止匯出。','danger'
      )
    });
    if(!saveHandle) return {cancelled:true};
    try{
      const spreadsheetTool=await window.PCMSFeatures.ensureSpreadsheetTool();
      const workbook=buildWorkbook(options,spreadsheetTool);
      await window.PCMSFileIO.writeWorkbookToHandle(saveHandle,workbook,spreadsheetTool);
      try{
        await writeLog('productionAnalysisExport',(options.rows||[]).length,saveHandle.name||fileName,options.filterSummary||'');
      }catch(logError){
        await bilingualAlert(
          'Tệp đã được lưu nhưng lịch sử xuất chưa ghi thành công. Vui lòng báo quản trị viên.',
          '檔案已儲存，但匯出操作紀錄未成功，請通知管理員。','danger'
        );
        return {saved:true,logged:false,error:logError};
      }
      window.PCMSUIComponents?.showToast?.({
        kind:'success',message:{vi:'Đã xuất báo cáo phân tích sản xuất.',zh:'生產分析報表已匯出。'}
      });
      return {saved:true,logged:true};
    }catch(error){
      await bilingualAlert('Không thể xuất báo cáo. Vui lòng thử lại.',`無法匯出報表：${error?.message||'請重試。'}`,'danger');
      return {saved:false,error};
    }
  }

  function appendCell(document,row,value,tagName='td'){
    const cell=document.createElement(tagName);
    cell.textContent=String(value??'');
    row.appendChild(cell);
  }
  function addPrintStyles(document){
    const style=document.createElement('style');
    style.textContent='@page{size:A4 landscape;margin:10mm}body{font-family:Arial,"Microsoft JhengHei",sans-serif;color:#1e293b;font-size:10px}h1{font-size:18px;margin:0 0 4px}.meta{margin:0 0 10px;color:#475569}table{width:100%;border-collapse:collapse;table-layout:auto}th,td{border:1px solid #94a3b8;padding:4px;vertical-align:top}th{background:#dbeafe;font-weight:700}tr{break-inside:avoid}.formula{margin-top:12px;white-space:pre-wrap}.handwrite{height:34px;min-width:80px}';
    document.head.appendChild(style);
  }
  async function printRows(options={}){
    const printWindow=window.open('','_blank');
    if(!printWindow){
      await bilingualAlert('Trình duyệt đã chặn cửa sổ in. Vui lòng cho phép cửa sổ bật lên.','瀏覽器已阻擋列印視窗，請允許彈出視窗。','danger');
      return {printed:false};
    }
    printWindow.opener=null;
    const document=printWindow.document;
    document.title=options.title||'生產分析報表';
    addPrintStyles(document);
    const title=document.createElement('h1');
    title.textContent=options.title||'';
    const meta=document.createElement('div');
    meta.className='meta';
    meta.textContent=`${options.filterSummary||''} · ${new Date().toLocaleString('zh-TW')}`;
    document.body.append(title,meta);
    const table=document.createElement('table');
    const head=document.createElement('thead');
    const headRow=document.createElement('tr');
    (options.columns||[]).forEach(column=>appendCell(document,headRow,`${column.vi}\n${column.zh}`,'th'));
    (options.handwritingColumns||[]).forEach(column=>appendCell(document,headRow,`${column.vi}\n${column.zh}`,'th'));
    head.appendChild(headRow);
    table.appendChild(head);
    const body=document.createElement('tbody');
    (options.rows||[]).forEach(data=>{
      const row=document.createElement('tr');
      (options.columns||[]).forEach(column=>appendCell(document,row,typeof column.value==='function'?column.value(data):data?.[column.key]));
      (options.handwritingColumns||[]).forEach(()=>{
        const cell=document.createElement('td');
        cell.className='handwrite';
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.appendChild(body);
    document.body.appendChild(table);
    if(options.formulaAppendix){
      const formula=document.createElement('div');
      formula.className='formula';
      formula.textContent=options.formulaAppendix;
      document.body.appendChild(formula);
    }
    printWindow.focus();
    printWindow.print();
    try{
      await writeLog('productionAnalysisPrint',(options.rows||[]).length,'',options.filterSummary||'');
    }catch(error){
      await bilingualAlert('Đã mở bản in nhưng lịch sử thao tác chưa ghi thành công.','已開啟列印，但操作紀錄未成功寫入。','danger');
      return {printed:true,logged:false,error};
    }
    return {printed:true,logged:true};
  }

  window.PCMSProductionAnalysisExport=Object.freeze({exportWorkbook,printRows,safeSpreadsheetValue});
})();
