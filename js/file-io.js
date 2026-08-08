// file-io（檔案儲存共用程式）：統一選擇儲存位置、取消與安全寫入。
(function(){
  const SPREADSHEET_FILE_TYPE = Object.freeze({
    description:'Tệp Excel / Excel 表格檔',
    // application/vnd.openxmlformats-officedocument.spreadsheetml.sheet（Excel 表格檔內容類型）
    accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}
  }); // SPREADSHEET_FILE_TYPE（表格檔選擇類型）

  async function notifyUnsupported(handler){
    if(typeof handler==='function') await handler();
  }

  async function chooseSaveHandle(options={}){
    if(typeof window.showSaveFilePicker!=='function'){
      await notifyUnsupported(options.onUnsupported);
      return null;
    }
    try{
      return await window.showSaveFilePicker({
        suggestedName:String(options.suggestedName||''),
        types:Array.isArray(options.types)?options.types:[],
        excludeAcceptAllOption:options.excludeAcceptAllOption!==false
      });
    }catch(error){
      if(error?.name==='AbortError') return null;
      if(error?.name==='SecurityError'||error?.name==='NotAllowedError'){
        await notifyUnsupported(options.onUnsupported);
        return null;
      }
      throw error;
    }
  }

  async function writeToHandle(fileHandle,fileData){
    if(!fileHandle?.createWritable) throw new Error('Không thể ghi tệp / 無法寫入檔案');
    const writable=await fileHandle.createWritable(); // writable（可寫入檔案串流）
    let completed=false; // completed（是否完整寫入）
    try{
      await writable.write(fileData);
      await writable.close();
      completed=true;
    }finally{
      if(!completed){
        try{ await writable.abort(); }catch(_){ }
      }
    }
  }

  function workbookToBlob(workbook,spreadsheetTool){
    if(!spreadsheetTool?.write) throw new Error('Công cụ Excel chưa sẵn sàng / Excel 表格工具尚未就緒');
    const workbookBytes=spreadsheetTool.write(workbook,{bookType:'xlsx',type:'array'}); // workbookBytes（活頁簿位元資料）
    return new Blob([workbookBytes],{
      type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  async function writeWorkbookToHandle(fileHandle,workbook,spreadsheetTool){
    return writeToHandle(fileHandle,workbookToBlob(workbook,spreadsheetTool));
  }

  window.PCMSFileIO=Object.freeze({
    spreadsheetFileType:SPREADSHEET_FILE_TYPE,
    chooseSaveHandle,
    writeToHandle,
    workbookToBlob,
    writeWorkbookToHandle
  });
})();
