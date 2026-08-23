// product-model（款號資料模型）：統一處理款號正規化、匯入差異與產品群組候選判定。
(function(){
  'use strict';

  const PRODUCT_CODE_MAX_LENGTH=80;
  const CONTROL_CHARACTER_PATTERN=/[\u0000-\u001F\u007F-\u009F]/u;
  const FIXED_ID_PATTERN=/^(prd|prc|oit|grp)_[a-z0-9_-]{12,80}$/;
  const ID_PREFIXES=Object.freeze({product:'prd',process:'prc',orderItem:'oit',group:'grp'});
  const BASE64URL_ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function text(value){
    return String(value??'').trim().replace(/\s+/g,' ');
  }

  // normalizeProductCode（正規化款號代碼）：保留使用者大小寫，只統一 Unicode 與空白並拒絕控制字元。
  function normalizeProductCode(value){
    const normalized=text(value).normalize('NFKC');
    if(!normalized) throw new Error('Mã hàng không được để trống. / 款號代碼不得空白。');
    if(CONTROL_CHARACTER_PATTERN.test(normalized)) throw new Error('Mã hàng chứa ký tự điều khiển không hợp lệ. / 款號代碼含有不允許的控制字元。');
    if(Array.from(normalized).length>PRODUCT_CODE_MAX_LENGTH) throw new Error(`Mã hàng không được vượt quá ${PRODUCT_CODE_MAX_LENGTH} ký tự. / 款號代碼不得超過 ${PRODUCT_CODE_MAX_LENGTH} 字。`);
    return normalized;
  }

  // productCodeComparisonKey（款號比對鍵）：大小寫不敏感，但不改變正式顯示代碼。
  function productCodeComparisonKey(value){
    return normalizeProductCode(value).toLocaleUpperCase('en-US');
  }

  function utf8Bytes(value){
    if(typeof TextEncoder==='function') return Array.from(new TextEncoder().encode(value));
    const encoded=encodeURIComponent(value);
    const bytes=[];
    for(let index=0;index<encoded.length;index+=1){
      if(encoded[index]==='%'){
        bytes.push(Number.parseInt(encoded.slice(index+1,index+3),16));
        index+=2;
      }else bytes.push(encoded.charCodeAt(index));
    }
    return bytes;
  }

  function utf8Text(bytes){
    const encoded=bytes.map(byte=>`%${Number(byte).toString(16).padStart(2,'0')}`).join('');
    return decodeURIComponent(encoded);
  }

  function encodeBase64Url(value){
    const bytes=utf8Bytes(value);
    let output='';
    for(let index=0;index<bytes.length;index+=3){
      const first=bytes[index];
      const second=bytes[index+1];
      const third=bytes[index+2];
      output+=BASE64URL_ALPHABET[first>>2];
      output+=BASE64URL_ALPHABET[((first&3)<<4)|((second??0)>>4)];
      if(second!==undefined) output+=BASE64URL_ALPHABET[((second&15)<<2)|((third??0)>>6)];
      if(third!==undefined) output+=BASE64URL_ALPHABET[third&63];
    }
    return output;
  }

  function decodeBase64Url(value){
    const encoded=String(value||'');
    if(!encoded||encoded.length%4===1||!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Chỉ mục mã hàng không hợp lệ. / 款號索引格式不正確。');
    const bytes=[];
    for(let index=0;index<encoded.length;index+=4){
      const first=BASE64URL_ALPHABET.indexOf(encoded[index]);
      const second=BASE64URL_ALPHABET.indexOf(encoded[index+1]);
      const third=encoded[index+2]===undefined?-1:BASE64URL_ALPHABET.indexOf(encoded[index+2]);
      const fourth=encoded[index+3]===undefined?-1:BASE64URL_ALPHABET.indexOf(encoded[index+3]);
      if(first<0||second<0||third<-1||fourth<-1) throw new Error('Chỉ mục mã hàng không hợp lệ. / 款號索引格式不正確。');
      bytes.push((first<<2)|(second>>4));
      if(third>=0) bytes.push(((second&15)<<4)|(third>>2));
      if(fourth>=0) bytes.push(((third&3)<<6)|fourth);
    }
    return utf8Text(bytes);
  }

  // safeProductCodeKey（安全款號索引鍵）：可逆的 Base64URL，只編碼大小寫不敏感比對值。
  function safeProductCodeKey(value){ return `code_${encodeBase64Url(productCodeComparisonKey(value))}`; }
  function productCodeFromSafeKey(value){
    const key=String(value||'');
    if(!key.startsWith('code_')) throw new Error('Chỉ mục mã hàng không hợp lệ. / 款號索引格式不正確。');
    return decodeBase64Url(key.slice(5));
  }

  function identityPrefix(kind){
    const prefix=ID_PREFIXES[kind];
    if(!prefix) throw new Error('Loại mã định danh không hợp lệ. / 固定識別碼類型不正確。');
    return prefix;
  }

  function randomToken(){
    if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g,'').toLowerCase();
    if(globalThis.crypto?.getRandomValues){
      const bytes=new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
    }
    const first=Math.floor(Math.random()*Number.MAX_SAFE_INTEGER).toString(36);
    const second=Date.now().toString(36);
    return `${second}${first}${Math.random().toString(36).slice(2)}`.slice(0,40);
  }

  // createPermanentId（建立永久識別碼）：建立後只作身分，不從可修改欄位重新計算。
  function createPermanentId(kind,tokenProvider){
    const raw=typeof tokenProvider==='function'?tokenProvider(kind):tokenProvider;
    const token=String(raw||randomToken()).toLowerCase().replace(/[^a-z0-9_-]/g,'');
    if(token.length<12) throw new Error('Nguồn tạo mã định danh quá ngắn. / 固定識別碼來源長度不足。');
    return `${identityPrefix(kind)}_${token.slice(0,80)}`;
  }

  function fixedId(value,kind){
    const normalized=text(value).toLowerCase();
    if(!FIXED_ID_PATTERN.test(normalized)||(kind&& !normalized.startsWith(`${identityPrefix(kind)}_`))) return '';
    return normalized;
  }

  function hash64(bytes,seed){
    let hash=BigInt.asUintN(64,14695981039346656037n^BigInt(seed));
    for(const byte of bytes){
      hash^=BigInt(byte);
      hash=BigInt.asUintN(64,hash*1099511628211n);
    }
    return hash.toString(16).padStart(16,'0');
  }

  // deterministicLegacyId（可重跑舊資料識別碼）：相同來源永遠產生相同目標身分。
  function deterministicLegacyId(kind,sourceKey){
    const source=text(sourceKey).normalize('NFKC');
    if(!source) throw new Error('Thiếu nguồn dữ liệu cũ để tạo mã định danh. / 缺少建立固定識別碼的舊資料來源。');
    const bytes=utf8Bytes(`${kind}\u001f${source}`);
    return `${identityPrefix(kind)}_${hash64(bytes,0x9e3779b1)}${hash64(bytes,0x85ebca6b)}`;
  }

  function legacySourceKey(collection,documentId,detail=''){
    const sourceCollection=text(collection);
    const sourceDocument=text(documentId);
    const sourceDetail=text(detail);
    if(!sourceCollection||!sourceDocument) throw new Error('Thiếu đường dẫn nguồn dữ liệu cũ. / 缺少舊資料來源路徑。');
    return [sourceCollection,sourceDocument,sourceDetail].map(value=>encodeBase64Url(value.normalize('NFKC'))).join('.');
  }

  // buildLegacyMapping（舊資料對照契約）：保存來源與固定目標，供轉換重跑、續跑及驗證。
  function buildLegacyMapping(input={}){
    const sourceKey=text(input.sourceKey);
    const targetKind=text(input.targetKind);
    const targetId=fixedId(input.targetId,targetKind);
    if(!sourceKey||!targetId) throw new Error('Dữ liệu đối chiếu chuyển đổi không hợp lệ. / 資料轉換對照不正確。');
    const bytes=utf8Bytes(`mapping\u001f${sourceKey}\u001f${targetKind}`);
    const status=['mapped','validated','exception'].includes(input.status)?input.status:'mapped';
    return {
      mappingId:`map_${hash64(bytes,0x27d4eb2f)}${hash64(bytes,0x165667b1)}`,
      sourceType:text(input.sourceType),sourceKey,targetKind,targetId,
      migrationVersion:text(input.migrationVersion)||'product-master-v1',status,
      verifiedAt:Number(input.verifiedAt)||null,verificationResult:text(input.verificationResult)
    };
  }

  // buildMigrationException（資料轉換例外契約）：只記錄無法唯一判斷的來源與候選固定身分。
  function buildMigrationException(input={}){
    const sourceKey=text(input.sourceKey);
    const reasonCode=text(input.reasonCode);
    if(!sourceKey||!reasonCode) throw new Error('Thiếu nguồn hoặc nguyên nhân ngoại lệ chuyển đổi. / 缺少資料轉換例外來源或原因。');
    const bytes=utf8Bytes(`exception\u001f${sourceKey}\u001f${reasonCode}`);
    return {
      exceptionId:`exc_${hash64(bytes,0x94d049bb)}${hash64(bytes,0x369dea0f)}`,
      sourceType:text(input.sourceType),sourceKey,reasonCode,status:'unresolved',
      candidateIds:[...new Set((Array.isArray(input.candidateIds)?input.candidateIds:[]).map(text).filter(Boolean))].sort(),
      detail:text(input.detail).slice(0,1000),migrationVersion:text(input.migrationVersion)||'product-master-v1'
    };
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
    const normalized={
      no:processNo(operation.no),
      category:text(operation.category).toUpperCase(),
      zh:text(operation.zh),
      vi:text(operation.vi),
      sec:seconds(operation.sec)
    };
    const processId=fixedId(operation.processId,'process');
    if(processId) normalized.processId=processId;
    // sortOrder（內部相容排序值）永遠鏡像工序號；正式介面不再維護第二套排序。
    if(normalized.no) normalized.sortOrder=Number(normalized.no);
    if(operation.active===false) normalized.active=false;
    return normalized;
  }

  function compareOperationNumber(left,right){
    return Number(left?.no||0)-Number(right?.no||0);
  }

  // renumberOperations（依目前列順序重新編號）：只改可變工序號，固定 processId 永遠保留。
  function renumberOperations(operations=[]){
    return (Array.isArray(operations)?operations:[]).map((operation,index)=>({
      ...operation,
      no:String(index+1),
      sortOrder:index+1
    }));
  }

  // moveOperation（移動工序）：目標位置已存在時自動插入並順移，不產生重複工序號。
  function moveOperation(operations=[],targetProcessId,targetPosition){
    const rows=(Array.isArray(operations)?operations:[]).map(operation=>({...operation}));
    const target=fixedId(targetProcessId,'process');
    const fromIndex=rows.findIndex(operation=>fixedId(operation?.processId,'process')===target);
    if(fromIndex<0) throw new Error('Không tìm thấy công đoạn cần di chuyển. / 找不到要移動的工序。');
    const position=Math.max(1,Math.min(rows.length,Number.parseInt(String(targetPosition??''),10)||1));
    const [operation]=rows.splice(fromIndex,1);
    rows.splice(position-1,0,operation);
    return renumberOperations(rows);
  }

  function normalizeProduct(product={}){
    const normalized={
      code:text(product.code)?normalizeProductCode(product.code):'',
      client:text(product.client),
      zh:text(product.zh),
      vi:text(product.vi),
      sz:text(product.sz),
      ops:(Array.isArray(product.ops)?product.ops:[]).map(normalizeOperation).sort(compareOperationNumber)
    };
    const productId=fixedId(product.productId,'product');
    if(productId) normalized.productId=productId;
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
    const revision=Number(product.revision);
    if(Number.isInteger(revision)&&revision>0) normalized.revision=revision;
    if(product.active===false) normalized.active=false;
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
      ops:normalized.ops.map(operation=>({
        no:operation.no,category:operation.category,zh:operation.zh,vi:operation.vi,sec:operation.sec
      }))
    };
  }

  function sameProduct(left,right){
    return JSON.stringify(comparableProduct(left))===JSON.stringify(comparableProduct(right));
  }

  const FIELD_LABELS=Object.freeze({
    code:{vi:'Mã hàng',zh:'款號代碼'},
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
    ['code','client','zh','vi','sz'].forEach(field=>{
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
      .map(normalizeProduct).filter(item=>item.code).map(item=>[productCodeComparisonKey(item.code),item]));
    const result={newItems:[],sameItems:[],differentItems:[]};
    (Array.isArray(incomingItems)?incomingItems:[]).map(normalizeProduct).filter(item=>item.code).forEach(item=>{
      const existing=existingByCode.get(productCodeComparisonKey(item.code));
      if(!existing){ result.newItems.push(item); return; }
      const differences=compareProducts(existing,item);
      if(differences.length) result.differentItems.push({code:item.code,existing,incoming:item,differences});
      else result.sameItems.push(item);
    });
    return result;
  }

  // reconcileImportReplacement（建立匯入完整替代資料）：同工序號沿用固定身分，Excel 未出現的舊工序不留在目前主檔。
  function reconcileImportReplacement(existingInput,incomingInput){
    const existing=normalizeProduct(existingInput);
    const incoming=normalizeProduct(incomingInput);
    if(!existing.productId) throw new Error('Thiếu mã định danh sản phẩm hiện có. / 缺少既有款號固定識別碼。');
    if(productCodeComparisonKey(existing.code)!==productCodeComparisonKey(incoming.code)){
      throw new Error('Mã hàng nhập không khớp với sản phẩm cần ghi đè. / 匯入款號與要覆蓋的既有款號不一致。');
    }
    const existingByNo=new Map(existing.ops.map(operation=>[operation.no,operation]));
    return {
      productId:existing.productId,
      // 同款號匯入只覆蓋主檔內容；既有款號代碼本身永遠保留。
      code:existing.code,
      client:incoming.client,
      zh:incoming.zh,
      vi:incoming.vi,
      sz:incoming.sz,
      active:true,
      ops:incoming.ops.map((operation,index)=>{
        const current=existingByNo.get(operation.no);
        return {
          ...operation,
          ...(current?.processId?{processId:current.processId}:{}),
          sortOrder:index+1,
          active:true
        };
      })
    };
  }

  // buildImportImpact（建立匯入影響列）：只列出會改變目前主檔或既有報工顯示的工序。
  function buildImportImpact(existingInput,incomingInput){
    const existing=normalizeProduct(existingInput);
    const incoming=normalizeProduct(incomingInput);
    const replacement=reconcileImportReplacement(existing,incoming);
    const differences=compareProducts(existing,incoming);
    const productFields=new Set(['code','client','zh','vi','sz']);
    const productDifferences=differences.filter(item=>productFields.has(item.field));
    const beforeByNo=new Map(existing.ops.map(operation=>[operation.no,operation]));
    const afterByNo=new Map(replacement.ops.map(operation=>[operation.no,operation]));
    const operationNumbers=[...new Set([...beforeByNo.keys(),...afterByNo.keys()])]
      .sort((left,right)=>Number(left)-Number(right));
    const rows=[];
    operationNumbers.forEach(no=>{
      const before=beforeByNo.get(no)||null;
      const after=afterByNo.get(no)||null;
      const processDifferences=differences.filter(item=>item.operationNo===no);
      const processChanged=!before||!after||processDifferences.length>0;
      if(!processChanged&&!productDifferences.length) return;
      rows.push({
        productId:existing.productId,
        code:incoming.code,
        processNo:no,
        processId:before?.processId||after?.processId||'',
        before,
        after,
        kind:!before?'added':(!after?'removed':(processChanged?'changed':'product-changed')),
        productDifferences,
        processDifferences,
        requiresImpactCount:Boolean(before?.processId)
      });
    });
    return {
      existing,
      incoming,
      replacement,
      differences,
      productDifferences,
      rows,
      processChangeCount:rows.filter(row=>row.kind!=='product-changed').length
    };
  }

  function normalizedSignatureText(value){
    return text(value).normalize('NFKC').toLocaleLowerCase();
  }

  function groupProcessProfile(product){
    const item=normalizeProduct(product);
    return item.ops.map(operation=>({
      no:operation.no,
      vi:normalizedSignatureText(operation.vi),
      sec:Number(operation.sec)||0
    }));
  }

  function profileKey(profile){ return JSON.stringify(profile); }

  function compareProfiles(profile,baseline){
    const countDifferent=profile.length!==baseline.length;
    const profileByNo=new Map(profile.map(item=>[item.no,item]));
    const baselineByNo=new Map(baseline.map(item=>[item.no,item]));
    const numbers=[...new Set([...profileByNo.keys(),...baselineByNo.keys()])];
    let descriptionDifferent=false;
    let secondsDifferent=false;
    numbers.forEach(no=>{
      const current=profileByNo.get(no);
      const expected=baselineByNo.get(no);
      if(!current||!expected){ descriptionDifferent=true;secondsDifferent=true;return; }
      if(current.vi!==expected.vi) descriptionDifferent=true;
      if(current.sec!==expected.sec) secondsDifferent=true;
    });
    return {countDifferent,descriptionDifferent,secondsDifferent};
  }

  // compareGroupConsistency（群組一致性）：以最多款號採用的工序內容為基準；無多數時所有不同版本都提醒。
  function compareGroupConsistency(products=[]){
    const rows=(Array.isArray(products)?products:[]).filter(Boolean).map(product=>({product,profile:groupProcessProfile(product)}));
    const variants=new Map();
    rows.forEach(row=>{
      const key=profileKey(row.profile);
      const variant=variants.get(key)||{key,profile:row.profile,count:0};
      variant.count+=1;
      variants.set(key,variant);
    });
    const ranked=[...variants.values()].sort((left,right)=>right.count-left.count);
    const hasMajority=ranked.length<=1||(ranked[0]?.count||0)>(ranked[1]?.count||0);
    const baseline=ranked[0]?.profile||[];
    const global={countDifferent:false,descriptionDifferent:false,secondsDifferent:false};
    if(!hasMajority&&ranked.length>1){
      ranked.slice(1).forEach(variant=>{
        const differences=compareProfiles(variant.profile,baseline);
        Object.keys(global).forEach(key=>{ global[key]=global[key]||differences[key]; });
      });
    }
    return rows.map(row=>{
      const differences=hasMajority?compareProfiles(row.profile,baseline):{...global};
      return {productId:fixedId(row.product?.productId,'product'),code:text(row.product?.code),...differences,
        consistent:!differences.countDifferent&&!differences.descriptionDifferent&&!differences.secondsDifferent};
    });
  }

  // canonicalGroupSignature（標準群組候選特徵）：相容舊特徵，但正式比對不使用加工分類、中文品名及中文工序。
  function canonicalGroupSignature(value){
    let source=value;
    try{
      if(typeof source==='string') source=JSON.parse(source);
    }catch(_error){ return ''; }
    if(!source||typeof source!=='object'||!Array.isArray(source.operations)) return '';
    return JSON.stringify({
      client:normalizedSignatureText(source.client),
      vi:normalizedSignatureText(source.vi),
      operations:source.operations.map(operation=>({
        no:processNo(operation?.no),
        vi:normalizedSignatureText(operation?.vi)
      })).sort(compareOperationNumber)
    });
  }

  // groupSignature（群組候選特徵）：尺寸、秒數、加工分類、中文品名及中文工序不參與候選比對。
  function groupSignature(product){
    const item=normalizeProduct(product);
    return canonicalGroupSignature({
      client:item.client,
      vi:item.vi,
      operations:item.ops
    });
  }

  // matchesGroupSignature（符合既有群組特徵）：舊群組仍可沿用保存過的含中文特徵。
  function matchesGroupSignature(product,signature){
    return groupSignature(product)===canonicalGroupSignature(signature);
  }

  window.PCMSProductModel=Object.freeze({
    PRODUCT_CODE_MAX_LENGTH,
    normalizeProductCode,
    productCodeComparisonKey,
    safeProductCodeKey,
    productCodeFromSafeKey,
    createPermanentId,
    fixedId,
    deterministicLegacyId,
    legacySourceKey,
    buildLegacyMapping,
    buildMigrationException,
    normalizeOperation,
    renumberOperations,
    moveOperation,
    normalizeProduct,
    comparableProduct,
    sameProduct,
    compareProducts,
    classifyImport,
    reconcileImportReplacement,
    buildImportImpact,
    groupProcessProfile,
    compareGroupConsistency,
    groupSignature,
    matchesGroupSignature
  });
})();
