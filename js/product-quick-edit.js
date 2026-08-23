// product-quick-edit（款號快速修改介面）：不同欄位共用同一視窗與 Product Master Service 儲存流程。
(function(){
  'use strict';

  const FIELD_CONFIG=Object.freeze({
    code:{scope:'product',vi:'Mã hàng',zh:'款號代碼',type:'text',perProduct:true,maxLength:80},
    client:{scope:'product',vi:'Khách hàng',zh:'款號客戶',type:'text',maxLength:200},
    zh:{scope:'product',vi:'Tên tiếng Trung',zh:'中文品名',type:'text',maxLength:200},
    vi:{scope:'product',vi:'Tên tiếng Việt',zh:'越文品名',type:'text',maxLength:200},
    sz:{scope:'product',vi:'Kích thước',zh:'尺寸',type:'text',maxLength:200},
    processNo:{scope:'process',vi:'Số công đoạn',zh:'工序號',type:'number',min:1,max:99},
    processSortOrder:{scope:'process',vi:'Thứ tự công đoạn',zh:'工序排序',type:'number',min:1,max:999},
    processCategory:{scope:'process',vi:'Phân loại',zh:'分類',type:'select'},
    processNameZh:{scope:'process',vi:'Tên công đoạn Trung',zh:'工序中文',type:'text',maxLength:200},
    processNameVi:{scope:'process',vi:'Tên công đoạn Việt',zh:'工序越文',type:'text',maxLength:200},
    processSeconds:{scope:'process',vi:'Giây tiêu chuẩn',zh:'標準秒數',type:'number',min:1,max:86400}
  });

  function text(value){ return String(value??'').trim(); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function safe(value){
    if(window.PCMSSafe?.text) return window.PCMSSafe.text(value);
    return String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  }
  function dual(vi,zh){ return `<span class="ui-dual-copy"><strong>${safe(vi)}</strong><span>${safe(zh)}</span></span>`; }
  function model(){ return window.PCMSProductModel; }
  function service(){ return window.PCMSProductMasterService; }
  function ui(){ return window.PCMSUIComponents; }
  function allowed(field=''){
    if(window.cu?.role==='admin') return true;
    if(field==='processSeconds') return window.cu?.features?.processSecondsEdit===true;
    return window.cu?.features?.productionProcessEdit===true;
  }
  function productId(value){ return model().fixedId(value,'product'); }
  function processId(value){ return model().fixedId(value,'process'); }

  function fieldValue(product,operation,field){
    const values={
      code:product.code,client:product.client,zh:product.zh,vi:product.vi,sz:product.sz,
      processNo:operation?.no,processSortOrder:operation?.sortOrder,processCategory:operation?.category,
      processNameZh:operation?.zh,processNameVi:operation?.vi,processSeconds:operation?.sec
    };
    return values[field]??'';
  }

  // buildTargets（建立群組修改目標）：相同工序號才自動匹配，無法匹配時不猜測且預設不選。
  function buildTargets({field,sourceProductId,sourceProcessId='',products=[],group=null}={}){
    const config=FIELD_CONFIG[field];
    if(!config) throw new Error('Trường sửa nhanh không hợp lệ. / 快速修改欄位不正確。');
    const source=(Array.isArray(products)?products:[]).find(product=>productId(product?.productId)===productId(sourceProductId));
    if(!source) throw new Error('Không tìm thấy mã hàng cần sửa. / 找不到要修改的款號。');
    const memberIds=group?.memberProductIds?.length?new Set(group.memberProductIds.map(productId)) : new Set([source.productId]);
    memberIds.add(source.productId);
    const members=products.filter(product=>memberIds.has(productId(product?.productId)));
    const sourceOperation=config.scope==='process'
      ?(source.ops||[]).find(operation=>processId(operation?.processId)===processId(sourceProcessId))
      :null;
    if(config.scope==='process'&&!sourceOperation) throw new Error('Không tìm thấy công đoạn cần sửa. / 找不到要修改的工序。');
    return members.map(product=>{
      let operation=null;
      if(config.scope==='process'){
        operation=product.productId===source.productId
          ?sourceOperation
          :(product.ops||[]).find(item=>String(item.no)===String(sourceOperation.no)&&item.active!==false);
      }
      return {
        product,operation,matched:config.scope==='product'||!!operation,
        selected:config.scope==='product'||!!operation,
        value:fieldValue(product,operation,field)
      };
    });
  }

  function commonInput(config,sourceValue){
    if(config.type==='select') return `<select data-common-value><option value="BL">BL</option><option value="SX">SX</option><option value="QC">QC</option><option value="DG">DG</option></select>`;
    const limits=config.type==='number'?` min="${config.min}" max="${config.max}" step="1" inputmode="numeric"`:'';
    const maximum=config.maxLength?` maxlength="${config.maxLength}"`:'';
    return `<input data-common-value type="${config.type}"${limits}${maximum} value="${safe(sourceValue)}">`;
  }

  function processOptions(product,selected=''){
    return `<option value="">Chọn công đoạn / 選擇工序</option>${(product.ops||[]).filter(operation=>operation.active!==false).map(operation=>
      `<option value="${safe(operation.processId)}"${operation.processId===selected?' selected':''}>${safe(operation.no)} · ${safe(operation.vi||operation.zh)}</option>`).join('')}`;
  }

  async function open(input={}){
    if(!allowed(input.field)){
      await ui().alertDialog({message:{vi:'Bạn không có quyền sửa mã hàng.',zh:'你沒有修改款號的權限。'},kind:'warning'});
      return false;
    }
    const config=FIELD_CONFIG[input.field];
    const products=Array.isArray(input.products)?input.products:window.D||[];
    const targets=buildTargets({...input,products});
    const sourceTarget=targets.find(target=>target.product.productId===input.sourceProductId)||targets[0];
    const body=document.createElement('div');
    body.className='product-quick-edit';
    const editor=config.perProduct?'':`<section class="product-quick-value"><label>${dual(config.vi,config.zh)}${commonInput(config,sourceTarget.value)}</label></section>`;
    body.innerHTML=`${editor}<div class="ui-notice is-info"><i class="ti ti-checkbox"></i>${dual('Nhóm hiện tại được chọn sẵn toàn bộ; bỏ chọn mã không muốn sửa.','目前群組預設全選；取消不想修改的款號即可。')}</div>
      <div class="ui-table-frame"><div class="ui-table-scroll"><table class="ui-table product-quick-table"><thead><tr>
        <th>${dual('Chọn','選擇')}</th><th>${dual('Mã hàng','款號')}</th><th>${dual('Kích thước','尺寸')}</th>
        <th>${dual(config.scope==='process'?'Công đoạn':'Giá trị hiện tại',config.scope==='process'?'工序':'目前內容')}</th>
        ${config.perProduct?`<th>${dual('Mã hàng mới','新款號')}</th>`:''}<th>${dual('Trạng thái','狀態')}</th>
      </tr></thead><tbody data-target-body></tbody></table></div></div>`;
    const rowsHost=body.querySelector('[data-target-body]');
    targets.forEach((target,index)=>{
      const row=document.createElement('tr');
      row.dataset.index=String(index);
      row.dataset.productId=target.product.productId;
      row.dataset.processId=target.operation?.processId||'';
      const current=config.scope==='process'
        ?(target.operation?`${safe(target.operation.no)} · ${safe(target.operation.vi||target.operation.zh)}`:`<select data-process-select>${processOptions(target.product)}</select>`)
        :safe(target.value);
      row.innerHTML=`<td><input type="checkbox" data-select${target.selected?' checked':''}${target.matched?'':' disabled'}></td>
        <td><b>${safe(target.product.code)}</b></td><td>${safe(target.product.sz||'—')}</td><td>${current}</td>
        ${config.perProduct?`<td><input type="text" maxlength="80" data-row-value value="${safe(target.value)}"></td>`:''}
        <td data-status>${target.matched?dual('Sẵn sàng','可修改'):dual('Chưa khớp; hãy chọn công đoạn','尚未匹配，請選擇工序')}</td>`;
      rowsHost.appendChild(row);
    });
    if(config.type==='select'&&!config.perProduct) body.querySelector('[data-common-value]').value=String(sourceTarget.value);
    rowsHost.addEventListener('change',event=>{
      const select=event.target.closest('[data-process-select]');
      if(!select) return;
      const row=select.closest('tr');
      const checkbox=row.querySelector('[data-select]');
      row.dataset.processId=select.value;
      checkbox.disabled=!select.value;
      checkbox.checked=!!select.value;
      row.querySelector('[data-status]').innerHTML=select.value?dual('Đã xác nhận','已確認'):dual('Chưa khớp; hãy chọn công đoạn','尚未匹配，請選擇工序');
    });
    let finished=false;
    ui().openDialog({
      title:{vi:`Sửa nhanh: ${config.vi}`,zh:`快速修改：${config.zh}`},body,size:'large',
      actions:[
        {text:{vi:'Hủy',zh:'取消'}},
        {text:{vi:'Lưu mục đã chọn',zh:'儲存已選項目'},icon:'ti-device-floppy',kind:'primary',onClick:async()=>{
          const commonValue=config.perProduct?null:body.querySelector('[data-common-value]')?.value;
          const requests=[];
          rowsHost.querySelectorAll('tr').forEach(row=>{
            const checkbox=row.querySelector('[data-select]');
            if(!checkbox.checked||checkbox.disabled||row.dataset.saved==='true') return;
            const target=targets[Number(row.dataset.index)];
            const value=config.perProduct?row.querySelector('[data-row-value]')?.value:commonValue;
            const fieldInput={field:input.field,value,processId:row.dataset.processId};
            requests.push({base:clone(target.product),draft:service().draftWithField(target.product,fieldInput),row});
          });
          if(!requests.length){
            await ui().alertDialog({message:{vi:'Chưa chọn mục cần sửa.',zh:'尚未選擇要修改的項目。'},kind:'warning',keepPrevious:true});
            return false;
          }
          const result=await service().saveManyDrafts(requests.map(request=>({base:request.base,draft:request.draft,action:'productGroupQuickEdit'})));
          result.results.forEach((item,index)=>{
            const request=requests[index];
            const status=request.row.querySelector('[data-status]');
            if(item.ok){
              request.row.dataset.saved='true';
              request.row.querySelector('[data-select]').disabled=true;
              status.innerHTML=dual('Đã lưu','已儲存');
            }else status.innerHTML=dual('Lưu thất bại; có thể thử lại','儲存失敗，可重試');
          });
          if(result.failures.length){
            await ui().alertDialog({message:{
              vi:`Đã lưu ${result.successes.length} mã; ${result.failures.length} mã thất bại và chỉ các mục thất bại sẽ được thử lại.`,
              zh:`已儲存 ${result.successes.length} 個款號；${result.failures.length} 個失敗，下次只重試失敗項目。`
            },kind:'warning',keepPrevious:true});
            return false;
          }
          finished=true;
          await input.onSaved?.(result);
          ui().showToast?.({kind:'success',text:{vi:'Đã cập nhật mục đã chọn.',zh:'已更新所選項目。'}});
          return true;
        }}
      ],
      onError:error=>ui().alertDialog({message:window.PCMSUIText?.errorPair?.(error)||{vi:String(error.message||error),zh:String(error.message||error)},kind:'danger',keepPrevious:true}),
      onClose:()=>{ if(!finished) input.onClose?.(); }
    });
    return true;
  }

  function createTrigger(input={}){
    const button=document.createElement('button');
    button.type='button';
    button.className='product-quick-edit-trigger';
    button.disabled=!allowed(input.field);
    button.textContent=String(input.value??'—');
    if(!button.disabled) button.addEventListener('click',event=>{ event.stopPropagation();void open(input); });
    return button;
  }

  window.PCMSProductQuickEdit=Object.freeze({FIELD_CONFIG,buildTargets,open,createTrigger,allowed});
})();
