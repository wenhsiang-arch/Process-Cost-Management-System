// product-seconds-adapter（款號主檔快速修改轉接）：生產登記只在點擊欄位時載入所屬群組並沿用正式儲存流程。
(function(){
  'use strict';

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

  async function open(input={}){
    const field=text(input.field)||'processSeconds';
    if(!allowed(field)){
      await window.PCMSUIComponents.alertDialog({kind:'warning',message:deniedMessage(field)});
      return false;
    }
    await window.ensureProductsLoaded?.({requireMeta:true});
    const product=productByIdentity(input);
    const operation=String(field).startsWith('process')?operationFor(product,input):null;
    if(!product||(String(field).startsWith('process')&&!operation)){
      await window.PCMSUIComponents.alertDialog({kind:'danger',message:missingMessage(field)});
      return false;
    }
    await window.PCMSProductGroupRuntime?.loadForProduct?.(product.productId);
    const currentValue={
      client:product.client,zh:product.zh,vi:product.vi,sz:product.sz,
      processNo:operation?.no,processCategory:operation?.category,
      processNameZh:operation?.zh,processNameVi:operation?.vi,processSeconds:operation?.sec
    }[field];
    return window.PCMSProductQuickEdit.open({
      field,value:input.value??currentValue,sourceProductId:product.productId,sourceProcessId:operation?.processId||'',
      products:window.D||[],group:window.PCMSProductGroupRuntime?.groupForProduct?.(product.productId)||null,
      onSaved:input.onSaved,onClose:input.onClose
    });
  }

  function createButton(input={}){
    const field=text(input.field)||'processSeconds';
    const button=document.createElement('button');
    button.type='button';
    button.className=field==='processSeconds'?'process-seconds-edit-button':'product-master-entry-edit-button';
    button.disabled=!allowed(field);
    button.textContent=String(input.value??'—');
    if(!button.disabled) button.addEventListener('click',event=>{ event.stopPropagation();void open({...input,field}); });
    return button;
  }

  window.PCMSQuickProductMaster=Object.freeze({open,createButton,allowed});
  window.PCMSQuickProcessSeconds=Object.freeze({
    open:input=>open({...input,field:'processSeconds'}),
    createButton:input=>createButton({...input,field:'processSeconds'}),
    allowed:()=>allowed('processSeconds')
  });
})();
