// product-group-runtime（款號群組載入介面）：只在群組功能實際開啟後讀取小型群組資料。
(function(){
  'use strict';

  let groups=[];
  let loaded=false;
  let loadingPromise=null;
  const productLookups=new Map();

  function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
  function store(){
    if(!window.PCMSProductGroupStore) throw new Error('Dịch vụ nhóm mã hàng chưa sẵn sàng. / 款號群組資料核心尚未載入。');
    return window.PCMSProductGroupStore;
  }
  function service(){
    if(!window.PCMSProductMasterService) throw new Error('Dịch vụ mã hàng chưa sẵn sàng. / 款號主檔服務尚未載入。');
    return window.PCMSProductMasterService;
  }
  function normalizeRows(rows){
    return (Array.isArray(rows)?rows:[]).filter(row=>row?.deleted!==true).map(row=>store().normalizeGroup(row))
      .sort((left,right)=>left.name.localeCompare(right.name,'vi',{numeric:true,sensitivity:'base'}));
  }
  function products(){ return Array.isArray(window.D)?window.D:[]; }
  function productId(value){ return window.PCMSProductModel?.fixedId?.(value,'product')||''; }
  function productByIdentity(value){
    const identity=String(value??'').trim();
    return products().find(item=>productId(item?.productId)===productId(identity)||String(item?.code||'').trim()===identity)||null;
  }
  function view(group){
    const row=clone(group);
    const members=(row.memberProductIds||[]).map(id=>productByIdentity(id)).filter(Boolean);
    row.memberCodes=members.map(item=>item.code).filter(Boolean);
    // signature（群組特徵）只供舊群組畫面的推薦提示使用，每次由目前主檔計算，不保存成另一份正式資料。
    row.signature=members[0]&&window.PCMSProductModel?.groupSignature
      ?window.PCMSProductModel.groupSignature(members[0])
      :null;
    return row;
  }
  function publish(){
    window.productMasterGroups=clone(groups);
    document.dispatchEvent?.(new CustomEvent('pcms:productgroupschange',{detail:{count:groups.length}}));
    return clone(groups);
  }
  function upsert(group){
    const normalized=store().normalizeGroup(group);
    const index=groups.findIndex(item=>item.groupId===normalized.groupId);
    if(index>=0) groups[index]=normalized;
    else groups.push(normalized);
    groups=normalizeRows(groups);
    publish();
    return clone(normalized);
  }
  function documentRows(snapshot){
    return (snapshot?.docs||[]).map(item=>({groupId:item.id,...item.data()}));
  }

  async function load(options={}){
    if(loaded&&!options.force) return clone(groups);
    if(loadingPromise&&!options.force) return loadingPromise;
    if(typeof window._getDocs!=='function'||typeof window._collection!=='function'){
      throw new Error('Dịch vụ cơ sở dữ liệu chưa sẵn sàng. / 雲端資料庫服務尚未載入。');
    }
    const promise=(async()=>{
      const snapshot=await window._getDocs(window._collection(store().COLLECTION));
      groups=normalizeRows(documentRows(snapshot));
      loaded=true;
      productLookups.clear();
      return publish();
    })();
    loadingPromise=promise;
    try{ return await promise; }
    finally{ if(loadingPromise===promise) loadingPromise=null; }
  }

  // loadForProduct（只載入單一款號所屬群組）：生產登記點擊編輯時最多讀取會員索引與群組各一筆。
  async function loadForProduct(identity){
    const product=productByIdentity(identity);
    const target=productId(product?.productId||identity);
    if(!target) return null;
    const current=groupForProduct(target);
    if(current||loaded) return current;
    if(productLookups.has(target)) return productLookups.get(target);
    if(typeof window._getDoc!=='function'||typeof window._docRef!=='function'){
      throw new Error('Dịch vụ cơ sở dữ liệu chưa sẵn sàng. / 雲端資料庫服務尚未載入。');
    }
    const promise=(async()=>{
      const memberSnapshot=await window._getDoc(window._docRef(store().MEMBER_COLLECTION,target));
      if(!memberSnapshot?.exists?.()) return null;
      const groupId=String(memberSnapshot.data()?.groupId||'').trim();
      if(!groupId) return null;
      const groupSnapshot=await window._getDoc(window._docRef(store().COLLECTION,groupId));
      if(!groupSnapshot?.exists?.()) return null;
      const saved=upsert({groupId:groupSnapshot.id,...groupSnapshot.data()});
      return view(saved);
    })();
    productLookups.set(target,promise);
    try{ return await promise; }
    catch(error){ productLookups.delete(target);throw error; }
  }

  function all(options={}){
    const rows=options.includeInactive===true?groups:groups.filter(group=>group.active!==false);
    return clone(rows);
  }
  function groupForProduct(identity){
    const product=productByIdentity(identity);
    return clone(store().groupForProduct(groups,product?.productId||identity));
  }
  function listGroups(){ return groups.filter(group=>group.active!==false).map(view); }
  function findCandidates(identity){
    const source=productByIdentity(identity);
    if(!source) return [];
    const recommendation=item=>window.PCMSProductModel.groupRecommendation(source,item);
    return products().filter(item=>item.productId!==source.productId&&recommendation(item).eligible)
      .sort((left,right)=>{
        const leftGroup=Boolean(groupForProduct(left.productId));
        const rightGroup=Boolean(groupForProduct(right.productId));
        if(leftGroup!==rightGroup) return leftGroup?1:-1;
        const leftResult=recommendation(left);
        const rightResult=recommendation(right);
        if(leftResult.exact!==rightResult.exact) return leftResult.exact?-1:1;
        return String(left.sz||'').localeCompare(String(right.sz||''),'zh-Hant',{numeric:true,sensitivity:'base'})
          ||String(left.code||'').localeCompare(String(right.code||''),'zh-Hant',{numeric:true,sensitivity:'base'});
      });
  }
  // candidatePlan（群組候選選取計畫）：只固定來源款號；各尺寸的一致候選由共用群組介面依正確基準預設勾選。
  function candidatePlan(identity){
    const source=productByIdentity(identity);
    if(!source) return {source:null,candidates:[],selectedCodes:[],disabledCodes:[]};
    const candidates=findCandidates(source.productId);
    const selectedCodes=[source.code];
    const disabledCodes=[];
    candidates.forEach(candidate=>{
      const assigned=groupForProduct(candidate.productId||candidate.code);
      if(assigned){ disabledCodes.push(candidate.code);return; }
    });
    return {source:clone(source),candidates:clone(candidates),selectedCodes,disabledCodes};
  }

  // prepareQuickEdit（準備快速修改群組內容）：已有群組只讀取並回傳該群組；沒有群組才載入群組清單並建立推薦。
  async function prepareQuickEdit(identity){
    const source=productByIdentity(identity);
    if(!source) return {source:null,group:null,plan:{source:null,candidates:[],selectedCodes:[],disabledCodes:[]}};
    const current=groupForProduct(source.productId);
    if(current) return {source:clone(source),group:current,plan:null};
    const direct=await loadForProduct(source.productId);
    if(direct) return {source:clone(source),group:direct,plan:null};
    await load();
    const loadedGroup=groupForProduct(source.productId);
    if(loadedGroup) return {source:clone(source),group:loadedGroup,plan:null};
    return {source:clone(source),group:null,plan:candidatePlan(source.productId)};
  }
  function invalidate(){ loaded=false;loadingPromise=null;groups=[];productLookups.clear();window.productMasterGroups=[]; }

  async function create(input,options={}){
    const memberProductIds=input.memberProductIds||(input.memberCodes||[]).map(code=>productByIdentity(code)?.productId).filter(Boolean);
    return view(upsert(await service().createGroup({...input,memberProductIds},options)));
  }
  async function update(current,patch,options={}){ return upsert(await service().updateGroup(current,patch,options)); }
  async function rename(current,name,options={}){ return view(await update(current,{name},options)); }
  async function setActive(current,active,options={}){ return update(current,{active:active===true},options); }
  async function updateMembers(current,memberProductIds,options={}){
    const result=await service().updateGroupMembers(current,memberProductIds,options);
    upsert(result.group);
    return clone(result);
  }
  function currentGroup(groupId){ return groups.find(item=>item.groupId===String(groupId||''))||null; }
  async function createGroup(input,options={}){ return create(input,options); }
  async function renameGroup(input,options={}){
    const current=currentGroup(input?.groupId);
    if(!current) throw new Error('Không tìm thấy nhóm cần đổi tên. / 找不到要改名的群組。');
    const group=await rename(current,input.name,options);
    return {group,name:group.name,changed:true};
  }
  async function updateGroupMembers(input,options={}){
    const current=currentGroup(input?.groupId);
    if(!current) throw new Error('Không tìm thấy nhóm cần sửa. / 找不到要修改的群組。');
    const nextIds=(input.memberProductIds||(input.memberCodes||[]).map(code=>productByIdentity(code)?.productId)).filter(Boolean);
    const result=await updateMembers(current,nextIds,options);
    return {...result,group:view(result.group)};
  }
  async function deleteGroup(groupId,options={}){
    const current=currentGroup(groupId);
    if(!current) throw new Error('Không tìm thấy nhóm cần ngừng sử dụng. / 找不到要停用的群組。');
    const saved=await setActive(current,false,options);
    return {group:view(saved),memberCodes:view(current).memberCodes,logSaved:true};
  }

  window.PCMSProductGroupRuntime=Object.freeze({load,loadGroups:load,loadForProduct,prepareQuickEdit,all,listGroups,groupForProduct,findCandidates,candidatePlan,invalidate,
    create,createGroup,update,rename,renameGroup,setActive,updateMembers,updateGroupMembers,deleteGroup});
  window.loadProductMasterGroups=options=>load(options);
})();
