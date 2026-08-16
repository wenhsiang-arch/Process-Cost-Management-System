// analysis-export（生產分析輸出程式）：只列印目前畫面結果並建立操作紀錄，不提供檔案匯出。
(function(){
  'use strict';

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

  window.PCMSProductionAnalysisExport=Object.freeze({printRows});
})();
