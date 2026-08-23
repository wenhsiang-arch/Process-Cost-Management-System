// product-seconds-adapter（工序秒數快速修改轉接）：沿用單一 Product Master 儲存流程，不提供舊修改模式。
(function(){
  'use strict';

  function text(value){ return String(value??'').trim(); }
  function allowed(){
    return window.cu?.role==='admin'||window.cu?.features?.processSecondsEdit===true;
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
  async function open(input={}){
    if(!allowed()){
      await window.PCMSUIComponents.alertDialog({kind:'warning',message:{vi:'Bạn không có quyền sửa giây công đoạn.',zh:'你沒有修改工序秒數的權限。'}});
      return false;
    }
    await window.ensureProductsLoaded?.({requireMeta:true});
    await window.PCMSProductGroupRuntime?.load?.();
    const product=productByIdentity(input);
    const operation=operationFor(product,input);
    if(!product||!operation){
      await window.PCMSUIComponents.alertDialog({kind:'danger',message:{vi:'Không tìm thấy công đoạn trong bảng mã hàng hiện tại.',zh:'目前款號主檔找不到這道工序。'}});
      return false;
    }
    return window.PCMSProductQuickEdit.open({
      field:'processSeconds',value:Number(operation.sec)||0,sourceProductId:product.productId,sourceProcessId:operation.processId,
      products:window.D||[],group:window.PCMSProductGroupRuntime?.groupForProduct?.(product.productId)||null,
      onSaved:input.onSaved,onClose:input.onClose
    });
  }
  function createButton(input={}){
    const button=document.createElement('button');
    button.type='button';button.className='process-seconds-edit-button';button.disabled=!allowed();
    button.textContent=String(input.value??'—');
    if(!button.disabled) button.addEventListener('click',event=>{ event.stopPropagation();void open(input); });
    return button;
  }

  window.PCMSQuickProcessSeconds=Object.freeze({open,createButton,allowed});
})();
