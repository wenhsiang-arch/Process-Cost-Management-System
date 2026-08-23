// order-item-store（訂單項目資料核心）：每一行訂單使用獨立固定身分，只保存訂單自己的欄位。
(function(){
  'use strict';

  const COLLECTION='orderItems';
  const TOTAL_COLLECTION='productionProcessTotals';
  const ORDER_OWNED_FIELDS=Object.freeze([
    'po','color','description','dueDate','completionDate','shipDate','actualShipDate','remark','notes'
  ]);

  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }
  function text(value){ return String(value??'').trim(); }
  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function positiveQuantity(value){
    const number=Number(value);
    if(!Number.isSafeInteger(number)||number<=0) throw new Error('Số lượng đơn hàng phải là số nguyên dương. / 訂單數量必須是正整數。');
    return number;
  }

  function orderItemIdFor(row,index,options={}){
    const existing=model().fixedId(row?.orderItemId,'orderItem');
    if(existing) return existing;
    const sourceKey=options.sourceKeys?.[index]
      ||(options.sourceKey?`${options.sourceKey}\u001forder-item\u001f${text(row?.legacySourceKey||row?.sourceRowId||index+1)}`:'');
    return sourceKey
      ?model().deterministicLegacyId('orderItem',sourceKey)
      :model().createPermanentId('orderItem',options.tokenProvider);
  }

  function normalizeOrderItem(orderId,row,index,options={}){
    const normalizedOrderId=text(orderId||row?.orderId);
    const productId=model().fixedId(row?.productId,'product');
    if(!normalizedOrderId) throw new Error('Thiếu đơn hàng của dòng chi tiết. / 訂單項目缺少訂單識別碼。');
    if(!productId) throw new Error(`Dòng ${index+1} thiếu mã định danh sản phẩm. / 第 ${index+1} 行缺少款號固定識別碼。`);
    const item={
      orderItemId:orderItemIdFor(row,index,options),orderId:normalizedOrderId,productId,
      quantity:positiveQuantity(row?.quantity??row?.qty??row?.orderQty),lineNumber:Number(row?.lineNumber)||index+1,
      active:row?.active!==false
    };
    ORDER_OWNED_FIELDS.forEach(field=>{
      if(row?.[field]!==undefined&&row?.[field]!==null&&row?.[field]!=='') item[field]=clone(row[field]);
    });
    return item;
  }

  // prepareOrderItems（建立訂單項目）：相同 productId 可以重複，每一行仍有自己的 orderItemId。
  function prepareOrderItems(orderId,rows,options={}){
    const items=(Array.isArray(rows)?rows:[]).map((row,index)=>normalizeOrderItem(orderId,row,index,options));
    if(!items.length) throw new Error('Đơn hàng không có dòng chi tiết. / 訂單沒有明細項目。');
    const identities=new Set();
    items.forEach(item=>{
      if(identities.has(item.orderItemId)) throw new Error('Mã định danh dòng đơn hàng bị trùng. / 訂單項目固定識別碼重複。');
      identities.add(item.orderItemId);
    });
    return items;
  }

  function processTotalId(orderItemId,processId){
    const itemId=model().fixedId(orderItemId,'orderItem');
    const operationId=model().fixedId(processId,'process');
    if(!itemId||!operationId) throw new Error('Mã liên kết sản lượng không hợp lệ. / 產能累計關聯識別碼不正確。');
    return `${itemId}__${operationId}`;
  }

  function validateQuantityChange(item,nextQuantity,processTotals=[]){
    const quantity=positiveQuantity(nextQuantity);
    const maximumRegistered=(Array.isArray(processTotals)?processTotals:[])
      .filter(total=>text(total?.orderItemId)===text(item?.orderItemId))
      .reduce((maximum,total)=>Math.max(maximum,Number(total?.registeredQty)||0),0);
    if(quantity<maximumRegistered) throw new Error(`Số lượng mới không được nhỏ hơn ${maximumRegistered} sản phẩm đã đăng ký. / 新訂單量不得低於已登記的 ${maximumRegistered} 件。`);
    return {...clone(item),quantity};
  }

  window.PCMSOrderItemStore=Object.freeze({
    COLLECTION,TOTAL_COLLECTION,ORDER_OWNED_FIELDS,normalizeOrderItem,prepareOrderItems,processTotalId,validateQuantityChange
  });
})();
