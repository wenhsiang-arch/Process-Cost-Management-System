// product-model（款號資料模型）：統一處理款號正規化、匯入差異與產品群組候選判定。
(function(){
  'use strict';

  function text(value){
    return String(value??'').trim().replace(/\s+/g,' ');
  }

  function processNo(value){
    const number=Number.parseInt(String(value??'').trim(),10);
    return Number.isInteger(number)&&number>0&&number<=99?String(number):'';
  }

  function seconds(value){
    const number=Number(value);
    return Number.isFinite(number)&&number>0?Number(number.toFixed(4)):0;
  }

  function normalizeOperation(operation={}){
    return {
      no:processNo(operation.no),
      category:text(operation.category).toUpperCase(),
      zh:text(operation.zh),
      vi:text(operation.vi),
      sec:seconds(operation.sec)
    };
  }

  function compareOperationNumber(left,right){
    return Number(left?.no||0)-Number(right?.no||0);
  }

  function normalizeProduct(product={}){
    const normalized={
      code:text(product.code),
      client:text(product.client),
      zh:text(product.zh),
      vi:text(product.vi),
      sz:text(product.sz),
      ops:(Array.isArray(product.ops)?product.ops:[]).map(normalizeOperation).sort(compareOperationNumber)
    };
    const groupId=text(product.groupId);
    if(groupId) normalized.groupId=groupId;
    if(Array.isArray(product.developmentOps)&&product.developmentOps.length){
      normalized.developmentOps=product.developmentOps.map(normalizeOperation).sort(compareOperationNumber);
    }
    const standardRevision=Number(product.standardRevision);
    if(Number.isInteger(standardRevision)&&standardRevision>0) normalized.standardRevision=standardRevision;
    const officialUpdatedAt=Number(product.officialUpdatedAt);
    if(Number.isFinite(officialUpdatedAt)&&officialUpdatedAt>0) normalized.officialUpdatedAt=officialUpdatedAt;
    const officialUpdatedBy=text(product.officialUpdatedBy);
    if(officialUpdatedBy) normalized.officialUpdatedBy=officialUpdatedBy;
    return normalized;
  }

  function comparableProduct(product){
    const normalized=normalizeProduct(product);
    return {
      code:normalized.code,
      client:normalized.client,
      zh:normalized.zh,
      vi:normalized.vi,
      sz:normalized.sz,
      ops:normalized.ops
    };
  }

  function sameProduct(left,right){
    return JSON.stringify(comparableProduct(left))===JSON.stringify(comparableProduct(right));
  }

  const FIELD_LABELS=Object.freeze({
    client:{vi:'Khách hàng',zh:'客人'},
    zh:{vi:'Tên tiếng Trung',zh:'中文名稱'},
    vi:{vi:'Tên tiếng Việt',zh:'越文名稱'},
    sz:{vi:'Kích thước',zh:'尺寸'},
    operationCount:{vi:'Số công đoạn',zh:'工序數量'},
    no:{vi:'Số công đoạn',zh:'工序號'},
    category:{vi:'Phân loại',zh:'加工分類'},
    operationZh:{vi:'Tên công đoạn Trung',zh:'工序中文'},
    operationVi:{vi:'Tên công đoạn Việt',zh:'工序越文'},
    sec:{vi:'Giây tiêu chuẩn',zh:'標準秒數'}
  });

  function difference(field,before,after,operationNo=''){
    return {field,operationNo,label:FIELD_LABELS[field],before,after};
  }

  function compareProducts(existing,incoming){
    const before=normalizeProduct(existing);
    const after=normalizeProduct(incoming);
    const differences=[];
    ['client','zh','vi','sz'].forEach(field=>{
      if(before[field]!==after[field]) differences.push(difference(field,before[field],after[field]));
    });
    if(before.ops.length!==after.ops.length){
      differences.push(difference('operationCount',before.ops.length,after.ops.length));
    }
    const beforeByNo=new Map(before.ops.map(item=>[item.no,item]));
    const afterByNo=new Map(after.ops.map(item=>[item.no,item]));
    const operationNumbers=[...new Set([...beforeByNo.keys(),...afterByNo.keys()])]
      .sort((left,right)=>Number(left)-Number(right));
    operationNumbers.forEach(no=>{
      const oldOperation=beforeByNo.get(no);
      const newOperation=afterByNo.get(no);
      if(!oldOperation||!newOperation){
        differences.push(difference('no',oldOperation?.no||'—',newOperation?.no||'—',no));
        return;
      }
      if(oldOperation.category!==newOperation.category) differences.push(difference('category',oldOperation.category,newOperation.category,no));
      if(oldOperation.zh!==newOperation.zh) differences.push(difference('operationZh',oldOperation.zh,newOperation.zh,no));
      if(oldOperation.vi!==newOperation.vi) differences.push(difference('operationVi',oldOperation.vi,newOperation.vi,no));
      if(oldOperation.sec!==newOperation.sec) differences.push(difference('sec',oldOperation.sec,newOperation.sec,no));
    });
    return differences;
  }

  function classifyImport(existingItems,incomingItems){
    const existingByCode=new Map((Array.isArray(existingItems)?existingItems:[])
      .map(normalizeProduct).filter(item=>item.code).map(item=>[item.code,item]));
    const result={newItems:[],sameItems:[],differentItems:[]};
    (Array.isArray(incomingItems)?incomingItems:[]).map(normalizeProduct).filter(item=>item.code).forEach(item=>{
      const existing=existingByCode.get(item.code);
      if(!existing){ result.newItems.push(item); return; }
      const differences=compareProducts(existing,item);
      if(differences.length) result.differentItems.push({code:item.code,existing,incoming:item,differences});
      else result.sameItems.push(item);
    });
    return result;
  }

  function normalizedSignatureText(value){
    return text(value).normalize('NFKC').toLocaleLowerCase();
  }

  // groupSignature（群組候選特徵）：尺寸與秒數不參與，避免不同尺寸及已修正秒數拆成不同產品。
  function groupSignature(product){
    const item=normalizeProduct(product);
    return JSON.stringify({
      client:normalizedSignatureText(item.client),
      zh:normalizedSignatureText(item.zh),
      vi:normalizedSignatureText(item.vi),
      operations:item.ops.map(operation=>({
        no:operation.no,
        category:operation.category,
        zh:normalizedSignatureText(operation.zh),
        vi:normalizedSignatureText(operation.vi)
      }))
    });
  }

  window.PCMSProductModel=Object.freeze({
    normalizeOperation,
    normalizeProduct,
    comparableProduct,
    sameProduct,
    compareProducts,
    classifyImport,
    groupSignature
  });
})();
