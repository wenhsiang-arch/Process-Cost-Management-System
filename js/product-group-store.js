// product-group-store（款號群組資料核心）：群組只保存 productId 範圍，不保存另一份款號或工序正式值。
(function(){
  'use strict';

  const COLLECTION='productGroups';
  const MEMBER_COLLECTION='productGroupMembers';
  const MAX_MEMBERS=200;

  function model(){
    if(!window.PCMSProductModel) throw new Error('Thiếu mô hình dữ liệu mã hàng. / 缺少款號資料模型。');
    return window.PCMSProductModel;
  }
  function text(value){ return String(value??'').trim().replace(/\s+/g,' '); }
  function uniqueProductIds(values){
    return [...new Set((Array.isArray(values)?values:[]).map(value=>model().fixedId(value,'product')).filter(Boolean))];
  }

  function normalizeGroup(input={},options={}){
    const groupId=model().fixedId(input.groupId,'group')
      ||(options.sourceKey?model().deterministicLegacyId('group',options.sourceKey):model().createPermanentId('group',options.tokenProvider));
    const name=text(input.name);
    const memberProductIds=uniqueProductIds(input.memberProductIds);
    if(!name||name.length>200) throw new Error('Tên nhóm phải từ 1 đến 200 ký tự. / 群組名稱須為1至200字。');
    if(memberProductIds.length<1||memberProductIds.length>MAX_MEMBERS) throw new Error(`Nhóm phải có từ 1 đến ${MAX_MEMBERS} mã hàng. / 群組必須有1至${MAX_MEMBERS}個款號。`);
    return {groupId,name,memberProductIds,active:input.active!==false,revision:Math.max(1,Math.trunc(Number(input.revision)||1))};
  }

  function memberIndexDocuments(group){
    return group.memberProductIds.map(productId=>({id:productId,data:{productId,groupId:group.groupId}}));
  }

  function membershipChange(currentInput,nextProductIds){
    const current=normalizeGroup(currentInput);
    const next=uniqueProductIds(nextProductIds);
    if(next.length<1||next.length>MAX_MEMBERS) throw new Error(`Nhóm phải có từ 1 đến ${MAX_MEMBERS} mã hàng. / 群組必須有1至${MAX_MEMBERS}個款號。`);
    const beforeSet=new Set(current.memberProductIds);
    const nextSet=new Set(next);
    return {
      group:{...current,memberProductIds:next},
      added:next.filter(productId=>!beforeSet.has(productId)),
      removed:current.memberProductIds.filter(productId=>!nextSet.has(productId))
    };
  }

  function groupForProduct(groups,productId){
    const target=model().fixedId(productId,'product');
    return (Array.isArray(groups)?groups:[]).find(group=>group.active!==false&&group.memberProductIds?.includes(target))||null;
  }

  window.PCMSProductGroupStore=Object.freeze({
    COLLECTION,MEMBER_COLLECTION,MAX_MEMBERS,normalizeGroup,memberIndexDocuments,membershipChange,groupForProduct
  });
})();
