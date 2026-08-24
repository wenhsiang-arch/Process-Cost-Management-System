// product-seconds-adapter（款號主檔快速修改轉接）：生產登記只在點擊欄位時準備群組；已有群組只載入該群組，未有群組才建立推薦清單，並沿用正式儲存流程。
(function(){
  'use strict';

  let activeOpenPromise=null;

  function text(value){ return String(value??'').trim(); }
  function allowed(field=''){
    if(field==='code') return false;
    if(window.cu?.role==='admin') return true;
    if(field==='processSeconds') return window.cu?.features?.processSecondsEdit===true;
    return window.cu?.features?.productionProcessEdit===true;
  }
  function productByIdentity(input={}){
    const productId=text(input.productId);
    const code=text(input.code);
    return (Array.isArray(window.D)?window.D:[]).find(item=>(productId&&item.productId===productId)||(code&&text(item.code)===code))||null;
  }
  function operationFor(product,input={}){
    const processId=text(input.processId);
    const processNo=text(input.processNo);
    return (product?.ops||[]).find(item=>(processId&&item.processId===processId)||(processNo&&text(item.no)===processNo))||null;
  }
  function missingMessage(field){
    return String(field||'').startsWith('process')
      ?{vi:'Không tìm thấy công đoạn trong bảng mã hàng hiện tại.',zh:'目前款號主檔找不到這道工序。'}
      :{vi:'Không tìm thấy mã hàng trong bảng mã hàng hiện tại.',zh:'目前款號主檔找不到這個款號。'};
  }
  function deniedMessage(field){
    return field==='processSeconds'
      ?{vi:'Bạn không có quyền sửa giây công đoạn.',zh:'你沒有修改工序秒數的權限。'}
      :{vi:'Bạn không có quyền sửa bảng mã hàng.',zh:'你沒有修改款號主檔的權限。'};
  }

  function errorPair(error){
    return window.PCMSUIText?.errorPair?.(error)||window.PCMSUIText?.fromError?.(error)
      ||{vi:String(error?.message||error||'Không rõ nguyên nhân'),zh:String(error?.message||error||'原因不明')};
  }

  async function openPrepared(input={}){
    const field=text(input.field)||'processSeconds';
    if(!allowed(field)){
      await window.PCMSUIComponents.alertDialog({kind:'warning',message:deniedMessage(field)});
      return false;
    }
    try{
      const prepared=await window.PCMSProductQuickEdit.runOpenPreparation(async progress=>{
        progress.update({value:20,indeterminate:true,text:{vi:'Đang tải bảng mã hàng hiện tại...',zh:'正在載入目前款號主檔…'},detail:{vi:'Vui lòng chờ, không cần bấm lại.',zh:'請稍候，不需要重複點擊。'}});
        await window.ensureProductsLoaded?.({requireMeta:true});
        const product=productByIdentity(input);
        const operation=String(field).startsWith('process')?operationFor(product,input):null;
        if(!product||(String(field).startsWith('process')&&!operation)) return {missing:true,product,operation};
        progress.update({value:60,indeterminate:true,text:{vi:'Đang kiểm tra nhóm của mã hàng...',zh:'正在確認款號所屬群組…'},detail:{vi:'Có nhóm thì chỉ mở nhóm hiện tại; chưa có nhóm mới chuẩn bị đề xuất.',zh:'已有群組只開啟目前群組；沒有群組才準備推薦。'}});
        const groupInput={sourceProductId:product.productId};
        await window.PCMSProductQuickEdit.prepareGroupContext(groupInput,progress);
        progress.update({value:90,indeterminate:true,text:{vi:'Đang mở bảng chỉnh sửa...',zh:'正在開啟修改面板…'}});
        return {product,operation,groupInput};
      });
      if(prepared.missing){
        await window.PCMSUIComponents.alertDialog({kind:'danger',message:missingMessage(field)});
        return false;
      }
      const {product,operation,groupInput}=prepared;
      const currentValue={
        client:product.client,zh:product.zh,vi:product.vi,sz:product.sz,
        processNo:operation?.no,processCategory:operation?.category,
        processNameZh:operation?.zh,processNameVi:operation?.vi,processSeconds:operation?.sec
      }[field];
      return window.PCMSProductQuickEdit.open({
        field,value:input.value??currentValue,sourceProductId:product.productId,sourceProcessId:operation?.processId||'',
        products:window.D||[],group:groupInput.group||null,candidatePlan:groupInput.candidatePlan||null,groupContextPrepared:true,
        onSaved:input.onSaved,onClose:input.onClose
      });
    }catch(error){
      await window.PCMSUIComponents.alertDialog({kind:'danger',message:errorPair(error)});
      return false;
    }
  }

  function open(input={}){
    if(activeOpenPromise) return activeOpenPromise;
    const pending=Promise.resolve().then(()=>openPrepared(input));
    activeOpenPromise=pending;
    pending.finally(()=>{ if(activeOpenPromise===pending) activeOpenPromise=null; });
    return pending;
  }

  function createButton(input={}){
    const field=text(input.field)||'processSeconds';
    const button=document.createElement('button');
    button.type='button';
    button.className=field==='processSeconds'?'process-seconds-edit-button':'product-master-entry-edit-button';
    button.disabled=!allowed(field);
    button.textContent=String(input.value??'—');
    if(!button.disabled) button.addEventListener('click',async event=>{
      event.stopPropagation();
      button.disabled=true;
      try{ await open({...input,field}); }
      finally{ button.disabled=!allowed(field); }
    });
    return button;
  }

  window.PCMSQuickProductMaster=Object.freeze({open,createButton,allowed});
  window.PCMSQuickProcessSeconds=Object.freeze({
    open:input=>open({...input,field:'processSeconds'}),
    createButton:input=>createButton({...input,field:'processSeconds'}),
    allowed:()=>allowed('processSeconds')
  });
})();
