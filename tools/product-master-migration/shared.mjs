// 一次性 Product Master（款號主檔）轉換共用核心：只建立固定身分與原始關聯，不複製主檔顯示快照。
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';

export const MIGRATION_VERSION='product-master-v2';
export const DEFAULT_RUN_ID='pmrun_product_master_v2_cutover';
export const SOURCE_COLLECTIONS=Object.freeze([
  'products','productGroups','productGroupMembers','orders','orderItems','orderProcesses','productionEntries','productionAttendance',
  'productionProcessTotals','productionSupplementTotals','productionDaySummaries',
  'productionEmployeeMonths','productionMonths','productMasterLegacyMappings',
  'productMasterMigrationExceptions','productMasterMigrationRuns'
]);
export const MIGRATION_COLLECTIONS=Object.freeze({
  mappings:'productMasterLegacyMappings',exceptions:'productMasterMigrationExceptions',runs:'productMasterMigrationRuns',
  logs:'operationLogs'
});

const ID_PREFIXES=Object.freeze({product:'prd',process:'prc',orderItem:'oit',group:'grp'});
const FIXED_ID_PATTERN=/^(prd|prc|oit|grp)_[a-z0-9_-]{12,80}$/;
const BASE64URL_ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ORDER_OWNED_FIELDS=Object.freeze([
  'po','color','description','dueDate','completionDate','shipDate','actualShipDate','remark','notes'
]);
const SNAPSHOT_FIELDS=new Set([
  'code','productCode','productName','productNameZh','productNameVi','productClient','size','sz',
  'processNo','processSortOrder','processCategory','processName','processNameZh','processNameVi',
  'processSec','processSeconds','processSecSnapshot','hourlyCapacity','hourlyCapacitySnapshot','workStdSec'
]);

// 正式文件只保留目前 Runtime（執行程式）與 Rules（安全規則）共同採用的欄位；
// Migration（資料轉換）來源與版本只寫入專用對照、例外及執行紀錄集合。
export const FORMAL_DOCUMENT_KEYS=Object.freeze({
  product:Object.freeze([
    'productId','code','client','zh','vi','sz','ops','processIds','active','revision','codeKey','historyId',
    'operationLogId','createdAt','createdByUid','createdBy','updatedAt','updatedByUid','updatedBy'
  ]),
  productCodeIndex:Object.freeze(['codeKey','code','productId','operationLogId','updatedAt','updatedByUid']),
  productHistory:Object.freeze([
    'productId','code','client','zh','vi','sz','ops','processIds','active','revision','codeKey','historyId',
    'operationLogId','createdAt','createdByUid','createdBy','updatedAt','updatedByUid','updatedBy','versionId','productRevision'
  ]),
  productOperationLog:Object.freeze([
    'permissionKey','feature','action','status','targetType','targetId','targetRevision','targetCodeKey',
    'targetHistoryId','freshnessSequence','itemCount','detailCount','note','createdAt','createdByUid','createdBy','schemaVersion'
  ]),
  productsMeta:Object.freeze([
    'version','changeSequence','productCount','opCount','lastProductId','lastRevision','updatedAt','updatedByUid',
    'operationLogId','schemaVersion'
  ]),
  productGroup:Object.freeze([
    'groupId','name','memberProductIds','active','revision','createdAt','createdByUid','createdBy','updatedAt',
    'updatedByUid','operationLogId'
  ]),
  productGroupMember:Object.freeze(['productId','groupId','createdAt','createdByUid','operationLogId']),
  productGroupOperationLog:Object.freeze([
    'permissionKey','feature','action','status','targetType','targetId','itemCount','detailCount','note','createdAt',
    'createdByUid','createdBy','operationLogId','schemaVersion'
  ]),
  order:Object.freeze([
    'orderId','client','dueDate','completionDate','shipDate','actualShipDate','remark','notes','importLockId','itemCount',
    'totalQty','importStatus','lifecycleStatus','schemaVersion','createdAt','createdByUid','createdBy','importCompletedAt',
    'updatedAt','updatedByUid','operationLogId'
  ]),
  orderImportLock:Object.freeze([
    'lockId','orderNo','orderDocumentId','status','completedBatches','totalBatches','createdAt','createdByUid','createdBy',
    'completedAt','updatedAt','updatedByUid','operationLogId'
  ]),
  orderOperationLog:Object.freeze([
    'permissionKey','feature','action','status','targetType','targetId','itemCount','detailCount','fileName','note','createdAt',
    'createdByUid','createdBy','operationLogId','schemaVersion'
  ]),
  migrationOperationLog:Object.freeze([
    'permissionKey','feature','action','status','targetType','targetId','itemCount','detailCount','note','createdAt',
    'createdByUid','createdBy','operationLogId','schemaVersion','migrationVersion','planHash','sourceHash',
    'sourceDocumentCount','plannedWriteCount','mappingCount','exceptionCount','productCount','groupCount','orderCount',
    'orderItemCount','entryCount','daySummaryCount','monthSummaryCount'
  ])
});

export function text(value){ return String(value??'').trim().replace(/\s+/g,' '); }
export function clone(value){ return value===undefined?undefined:JSON.parse(JSON.stringify(value)); }
function number(value){ const parsed=Number(value);return Number.isFinite(parsed)?parsed:0; }
function integer(value){ const parsed=Number(value);return Number.isSafeInteger(parsed)?parsed:0; }
function positiveInteger(value){ const parsed=integer(value);return parsed>0?parsed:0; }
function round(value,digits=4){ const factor=10**digits;return Math.round((number(value)+Number.EPSILON)*factor)/factor; }
function normalizeKey(value){ return text(value).normalize('NFKC').toLocaleUpperCase('en-US'); }
function comparableProductCode(value){ return normalizeKey(value).replace(/[^\p{L}\p{N}]/gu,''); }
function differsByOneCodeCharacter(left,right){
  const first=comparableProductCode(left),second=comparableProductCode(right);
  if(!first||first.length!==second.length) return false;
  let differences=0;
  for(let index=0;index<first.length;index+=1){
    if(first[index]!==second[index]&&(differences+=1)>1) return false;
  }
  return differences===1;
}
function document(value){ return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; }
function rowId(row){ return text(row?.id); }
function dataRows(source,name){ return Array.isArray(source?.[name])?source[name]:[]; }
function sortedUnique(values){ return [...new Set(values.map(text).filter(Boolean))].sort(); }

function utf8Bytes(value){ return Array.from(new TextEncoder().encode(value)); }
function encodeBase64Url(value){
  const bytes=utf8Bytes(value);let output='';
  for(let index=0;index<bytes.length;index+=3){
    const first=bytes[index],second=bytes[index+1],third=bytes[index+2];
    output+=BASE64URL_ALPHABET[first>>2];
    output+=BASE64URL_ALPHABET[((first&3)<<4)|((second??0)>>4)];
    if(second!==undefined) output+=BASE64URL_ALPHABET[((second&15)<<2)|((third??0)>>6)];
    if(third!==undefined) output+=BASE64URL_ALPHABET[third&63];
  }
  return output;
}
function identityPrefix(kind){
  const prefix=ID_PREFIXES[kind];
  if(!prefix) throw new Error(`不支援的固定識別碼類型：${kind}`);
  return prefix;
}
function hash64(bytes,seed){
  let hash=BigInt.asUintN(64,14695981039346656037n^BigInt(seed));
  for(const byte of bytes){ hash^=BigInt(byte);hash=BigInt.asUintN(64,hash*1099511628211n); }
  return hash.toString(16).padStart(16,'0');
}
export function fixedId(value,kind=''){
  const normalized=text(value).toLowerCase();
  return FIXED_ID_PATTERN.test(normalized)&&(!kind||normalized.startsWith(`${identityPrefix(kind)}_`))?normalized:'';
}
export function deterministicLegacyId(kind,sourceKey){
  const source=text(sourceKey).normalize('NFKC');
  if(!source) throw new Error('缺少建立固定識別碼的舊資料來源。');
  const bytes=utf8Bytes(`${kind}\u001f${source}`);
  return `${identityPrefix(kind)}_${hash64(bytes,0x9e3779b1)}${hash64(bytes,0x85ebca6b)}`;
}
export function legacySourceKey(collection,documentId,detail=''){
  const values=[text(collection),text(documentId),text(detail)];
  if(!values[0]||!values[1]) throw new Error('缺少舊資料來源路徑。');
  return values.map(value=>encodeBase64Url(value.normalize('NFKC'))).join('.');
}
export function safeProductCodeKey(value){
  const normalized=normalizeKey(value);
  if(!normalized) throw new Error('款號代碼不得空白。');
  return `code_${encodeBase64Url(normalized)}`;
}
export function stableHash(value){
  function canonical(input){
    if(Array.isArray(input)) return `[${input.map(canonical).join(',')}]`;
    if(input&&typeof input==='object') return `{${Object.keys(input).sort().map(key=>`${JSON.stringify(key)}:${canonical(input[key])}`).join(',')}}`;
    return JSON.stringify(input??null);
  }
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function buildLegacyMapping(input={}){
  const sourceKey=text(input.sourceKey),targetKind=text(input.targetKind),targetId=fixedId(input.targetId,targetKind);
  if(!sourceKey||!targetId) throw new Error('資料轉換對照不正確。');
  const bytes=utf8Bytes(`mapping\u001f${sourceKey}\u001f${targetKind}`);
  return {mappingId:`map_${hash64(bytes,0x27d4eb2f)}${hash64(bytes,0x165667b1)}`,
    sourceType:text(input.sourceType),sourceKey,targetKind,targetId,migrationVersion:MIGRATION_VERSION,
    status:text(input.status)||'mapped',verifiedAt:null,verificationResult:''};
}
export function buildMigrationException(input={}){
  const sourceKey=text(input.sourceKey),reasonCode=text(input.reasonCode);
  if(!sourceKey||!reasonCode) throw new Error('缺少資料轉換例外來源或原因。');
  const bytes=utf8Bytes(`exception\u001f${sourceKey}\u001f${reasonCode}`);
  return {exceptionId:`exc_${hash64(bytes,0x94d049bb)}${hash64(bytes,0x369dea0f)}`,
    sourceType:text(input.sourceType),sourceKey,reasonCode,status:'unresolved',
    candidateIds:sortedUnique(Array.isArray(input.candidateIds)?input.candidateIds:[]),
    detail:text(input.detail).slice(0,1000),migrationVersion:MIGRATION_VERSION};
}

function timestamp(value){
  if(value===null||value===undefined||value==='') return null;
  if(typeof value?.toMillis==='function') return Math.round(value.toMillis());
  if(number(value?.seconds)>0) return Math.round(number(value.seconds)*1000+number(value.nanoseconds)/1e6);
  const numeric=number(value);
  if(numeric>1e12) return Math.round(numeric);
  if(numeric>1e9) return Math.round(numeric*1000);
  const parsed=new Date(value).getTime();
  return Number.isFinite(parsed)&&parsed>0?parsed:null;
}
function productionDate(value){
  const raw=text(value);
  if(/^20\d{2}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(raw)) return raw;
  const parsed=timestamp(value);
  return parsed?new Date(parsed).toISOString().slice(0,10):'';
}
function processNumber(value){
  const parsed=Number.parseInt(text(value),10);
  return Number.isInteger(parsed)&&parsed>0&&parsed<=99?String(parsed):'';
}
function sourceActor(options={}){
  return {uid:text(options.actorUid)||'migration-tool',name:text(options.actorName)||'資料轉換工具',now:Math.max(1,Math.round(number(options.now)||Date.now()))};
}
function exceptionFor(exceptions,input){
  const value=buildMigrationException(input);exceptions.set(value.exceptionId,value);return value;
}
function mappingFor(mappings,input){
  const value=buildLegacyMapping(input);mappings.set(value.mappingId,value);return value;
}
export function migrationWritePath(write){
  const collection=text(write?.collection),id=text(write?.id);
  if(!collection||!id) throw new Error('資料轉換寫入缺少 Collection（資料集合）或文件識別碼。');
  return `${collection}/${id}`;
}
function writeKey(write){ return migrationWritePath(write); }
export function migrationCompletionLogId(runId){ return `${text(runId)||DEFAULT_RUN_ID}__complete`; }

export function calculateMigrationPlanHash(writes=[]){
  return stableHash({migrationVersion:MIGRATION_VERSION,writes:writes.map(write=>[
    text(write?.phase),text(write?.collection),text(write?.id),document(write?.data)
  ])});
}

export function assertMigrationPlanIntegrity(plan){
  if(!plan||typeof plan!=='object') throw new Error('Migration Plan（資料轉換計畫）不存在。');
  if(text(plan.migrationVersion||plan.manifest?.migrationVersion)!==MIGRATION_VERSION){
    throw new Error('Migration Plan（資料轉換計畫）版本不正確。');
  }
  if(!Array.isArray(plan.writes)||!plan.writes.length) throw new Error('Migration Plan（資料轉換計畫）沒有寫入內容。');
  const paths=new Set();
  plan.writes.forEach(write=>{
    const pathValue=migrationWritePath(write);
    if(paths.has(pathValue)) throw new Error(`Migration Plan（資料轉換計畫）含重複文件：${pathValue}`);
    if(write.merge!==true&&write.merge!==false) throw new Error(`Migration Plan（資料轉換計畫）的寫入模式不正確：${pathValue}`);
    paths.add(pathValue);
  });
  const expected=calculateMigrationPlanHash(plan.writes);
  if(text(plan.planHash)!==expected) throw new Error('Migration Plan Hash（資料轉換計畫雜湊）不一致。');
  return true;
}

export async function readSource(repository,collections=SOURCE_COLLECTIONS){
  const source={};
  for(const name of collections) source[name]=await repository.list(name);
  return source;
}

export async function inventoryRepository(repository){
  const source=await readSource(repository);
  const counts=Object.fromEntries(SOURCE_COLLECTIONS.map(name=>[name,dataRows(source,name).length]));
  const estimatedDocumentReads=Object.values(counts).reduce((sum,value)=>sum+value,0);
  const relationships={
    legacyProducts:dataRows(source,'products').filter(row=>!fixedId(row.productId,'product')&&row.deleted!==true).length,
    legacyOrders:dataRows(source,'orders').filter(row=>Number(row.schemaVersion)!==2).length,
    legacyEntries:dataRows(source,'productionEntries').filter(row=>Number(row.schemaVersion)!==2).length,
    existingFixedProducts:dataRows(source,'products').filter(row=>fixedId(row.productId,'product')).length,
    existingOrderItems:dataRows(source,'orderItems').filter(row=>fixedId(row.orderItemId||row.id,'orderItem')).length
  };
  return {migrationVersion:MIGRATION_VERSION,source,report:{counts,relationships,estimatedDocumentReads}};
}

function productRootRows(source){
  const rows=dataRows(source,'products');
  const generatedTargets=new Set(rows.filter(row=>!fixedId(row.productId,'product')
      &&(row.deleted!==true||fixedId(row.retiredToProductId,'product')))
    .map(row=>fixedId(row.retiredToProductId,'product')||deterministicLegacyId('product',legacySourceKey('products',row.id))));
  return rows.filter(row=>{
    if(row.deleted===true&&!fixedId(row.retiredToProductId,'product')) return false;
    const target=fixedId(row.productId,'product');
    return !(target&&generatedTargets.has(target));
  });
}
function normalizeOperation(operation,index,productSource){
  const no=processNumber(operation.no??operation.processNo??operation.number);
  const processSource=legacySourceKey('products',productSource,`process:${index+1}`);
  return {
    processId:fixedId(operation.processId,'process')||deterministicLegacyId('process',processSource),
    no,sortOrder:positiveInteger(operation.sortOrder)||index+1,category:text(operation.category).toUpperCase(),
    zh:text(operation.zh??operation.processNameZh??operation.nameZh),
    vi:text(operation.vi??operation.processNameVi??operation.nameVi),
    sec:round(operation.sec??operation.processSec??operation.seconds),active:operation.active!==false,
    sourceKey:processSource
  };
}
function normalizedProduct(row,actor){
  const sourceKey=legacySourceKey('products',row.id);
  const productId=fixedId(row.productId,'product')||fixedId(row.retiredToProductId,'product')||deterministicLegacyId('product',sourceKey);
  const operations=(Array.isArray(row.ops)?row.ops:[]).map((operation,index)=>normalizeOperation(operation,index,row.id));
  const createdAt=Math.min(timestamp(row.createdAt)||actor.now,actor.now);
  return {sourceRow:row,sourceKey,productId,code:text(row.code||row.id),codeKey:safeProductCodeKey(row.code||row.id),
    client:text(row.client),zh:text(row.zh),vi:text(row.vi),sz:text(row.sz),operations,
    product:{productId,code:text(row.code||row.id),codeKey:safeProductCodeKey(row.code||row.id),client:text(row.client),
      zh:text(row.zh),vi:text(row.vi),sz:text(row.sz),ops:operations.map(({sourceKey:ignored,...operation})=>operation),
      processIds:operations.map(operation=>operation.processId),active:row.active!==false,revision:positiveInteger(row.revision)||1,
      createdAt,createdByUid:text(row.createdByUid)||actor.uid,
      createdBy:text(row.createdBy)||actor.name,updatedAt:actor.now,updatedByUid:actor.uid,updatedBy:actor.name}}
}
function validateProductCandidate(candidate){
  if(!candidate.code||!candidate.client||!candidate.vi||!candidate.operations.length) return 'incomplete-product-master';
  const numbers=candidate.operations.map(operation=>operation.no);
  if(numbers.some(value=>!value)||new Set(numbers).size!==numbers.length) return 'ambiguous-product-process-number';
  if(candidate.operations.some(operation=>!operation.vi||operation.sec<=0)) return 'incomplete-product-master-process';
  return '';
}
function candidateByCode(products){
  const map=new Map();
  products.forEach(product=>{
    const key=normalizeKey(product.code);const values=map.get(key)||[];values.push(product);map.set(key,values);
  });
  return map;
}
function legacyProcessIdentity(row){
  const zh=text(row.processZh??row.processNameZh),vi=text(row.processVi??row.processNameVi);
  const sec=round(row.processSec??row.processSeconds??row.processSecSnapshot??row.workStdSec);
  return zh&&vi&&sec>0?{zh:normalizeKey(zh),vi:normalizeKey(vi),sec}:null;
}
function legacyProcessCandidates(product,row){
  const operations=Array.isArray(product?.operations)?product.operations:[];
  const identity=legacyProcessIdentity(row);
  if(identity){
    const identityMatches=operations.filter(operation=>normalizeKey(operation.zh)===identity.zh
      &&normalizeKey(operation.vi)===identity.vi&&round(operation.sec)===identity.sec);
    // 工序號是可修改欄位；舊名稱與秒數若能在目前主檔唯一命中，優先用來恢復同一道工序的固定身分。
    if(identityMatches.length===1) return identityMatches;
  }
  const no=processNumber(row.processNo??row.no);
  return no?operations.filter(operation=>operation.no===no):[];
}
function supportsLegacyOrderProcesses(product,rows){
  return rows.length>0&&rows.every(row=>legacyProcessCandidates(product,row).length===1);
}
function orderProductCandidates(code,rows,validProducts,productsByCode){
  const exact=productsByCode.get(normalizeKey(code))||[];
  if(exact.length) return exact;
  const comparable=comparableProductCode(code);
  const punctuationMatches=comparable?validProducts.filter(product=>comparableProductCode(product.code)===comparable):[];
  if(punctuationMatches.length) return punctuationMatches;
  const sample=rows[0],sampleZh=normalizeKey(sample?.zh??sample?.productNameZh),sampleSize=normalizeKey(sample?.sz??sample?.size);
  if(!sampleZh||!sampleSize) return [];
  // 只接受「一個字元不同＋名稱尺寸相同＋全部舊工序可唯一連結」的唯一候選；不做一般模糊猜測。
  return validProducts.filter(product=>differsByOneCodeCharacter(code,product.code)
    &&normalizeKey(product.zh)===sampleZh&&normalizeKey(product.sz)===sampleSize
    &&supportsLegacyOrderProcesses(product,rows));
}
function groupRootRows(source){
  const rows=dataRows(source,'productGroups');
  const generatedTargets=new Set(rows.filter(row=>!fixedId(row.groupId,'group')
      &&(row.deleted!==true||fixedId(row.retiredToGroupId,'group')))
    .map(row=>fixedId(row.retiredToGroupId,'group')||deterministicLegacyId('group',legacySourceKey('productGroups',row.id))));
  return rows.filter(row=>{
    if(row.deleted===true&&!fixedId(row.retiredToGroupId,'group')) return false;
    const target=fixedId(row.groupId,'group');
    return !(target&&generatedTargets.has(target));
  });
}
function explicitLineIdentity(row){
  const fixed=fixedId(row.orderItemId,'orderItem');
  if(fixed) return `fixed:${fixed}`;
  for(const field of ['sourceRowId','legacyItemId','lineNumber','rowNumber','itemIndex']){
    if(text(row[field])) return `${field}:${text(row[field])}`;
  }
  return '';
}
function orderOwnedValue(row,field){
  if(field==='description') return row.description??row.desc;
  return row[field];
}
function orderLineFingerprint(row,orderDocumentId){
  const values=[orderDocumentId,normalizeKey(row.code??row.productCode),positiveInteger(row.orderQty??row.quantity??row.qty)];
  ORDER_OWNED_FIELDS.forEach(field=>values.push(field.toLowerCase().includes('date')?timestamp(orderOwnedValue(row,field)):normalizeKey(orderOwnedValue(row,field))));
  return stableHash(values).slice(0,32);
}
function matchOrderDocument(process,ordersById,ordersByNumber){
  const direct=text(process.orderDocumentId||process.orderId);
  if(ordersById.has(direct)) return ordersById.get(direct);
  const candidates=ordersByNumber.get(normalizeKey(process.orderNo||process.orderId))||[];
  return candidates.length===1?candidates[0]:null;
}
function canonicalOrderHeader(row,items,actor,operationLogId){
  const dueDate=timestamp(row.dueDate)||items.map(item=>timestamp(item.dueDate)).find(Boolean)||null;
  const totalQty=items.reduce((sum,item)=>sum+positiveInteger(item.quantity),0);
  const sourceOrderId=text(row.orderId||row.orderNo||row.id);
  const createdAt=Math.min(timestamp(row.createdAt)||actor.now,actor.now);
  return {orderId:sourceOrderId,client:text(row.client||row.customer),dueDate,
    completionDate:timestamp(row.completionDate),shipDate:timestamp(row.shipDate),actualShipDate:timestamp(row.actualShipDate),
    remark:text(row.remark).slice(0,500),notes:text(row.notes).slice(0,500),
    importLockId:text(row.importLockId)||`migration_${stableHash(row.id).slice(0,32)}`,
    itemCount:items.length,totalQty,importStatus:'ready',lifecycleStatus:text(row.lifecycleStatus)==='archived'?'archived':'active',
    schemaVersion:2,createdAt,createdByUid:text(row.createdByUid)||actor.uid,
    createdBy:text(row.createdBy)||actor.name,importCompletedAt:timestamp(row.importCompletedAt)||actor.now,
    updatedAt:actor.now,updatedByUid:actor.uid,operationLogId};
}

function buildDayAndMonthDocuments(entries,attendanceRows,actor){
  const attendanceByKey=new Map(attendanceRows.map(row=>{
    const date=productionDate(row.attendanceDate||row.productionDate||row.date);
    return [`${date}__${text(row.employeeId).toUpperCase()}`,row];
  }).filter(([key])=>!key.startsWith('__')));
  const dayKeys=new Set(attendanceByKey.keys());
  entries.filter(entry=>entry.status==='active').forEach(entry=>dayKeys.add(`${entry.productionDate}__${entry.employeeId}`));
  const dayDocuments=[];
  [...dayKeys].sort().forEach(key=>{
    const [date,...employeeParts]=key.split('__');const employeeId=employeeParts.join('__');
    if(!date||!employeeId) return;
    const attendance=attendanceByKey.get(key)||{};
    const active=entries.filter(entry=>entry.status==='active'&&entry.productionDate===date&&entry.employeeId===employeeId);
    const processMap=new Map();let supplementHours=0;
    active.forEach(entry=>{
      if(entry.recordType==='supplement'){ supplementHours+=number(entry.supplementHours);return; }
      const processKey=`${entry.orderItemId}__${entry.processId}`;const current=processMap.get(processKey)||{
        key:processKey,orderId:entry.orderId,orderItemId:entry.orderItemId,productId:entry.productId,processId:entry.processId,quantity:0};
      current.quantity+=positiveInteger(entry.quantity);processMap.set(processKey,current);
    });
    const normalHours=round(Math.max(0,number(attendance.normalHours)),2),overtimeHours=round(Math.max(0,number(attendance.overtimeHours)),2);
    const last=active.slice().sort((a,b)=>number(a.createdAt)-number(b.createdAt)||text(a.id).localeCompare(text(b.id))).at(-1);
    dayDocuments.push({summaryId:key,month:date.slice(0,7),productionDate:date,employeeId,
      employeeName:text(attendance.employeeName||last?.employeeName).slice(0,100),department:text(attendance.department||last?.department).slice(0,100),
      normalHours,overtimeHours,attendanceHours:round(normalHours+overtimeHours,2),activeEntryCount:active.length,
      activeStandardEntryCount:active.filter(entry=>entry.recordType==='standard').length,
      activeSupplementHours:round(supplementHours,4),processes:[...processMap.values()].sort((a,b)=>a.key.localeCompare(b.key)),
      metricComplete:true,revision:Math.max(1,active.length),lastEntryId:text(last?.id),lastMutation:'migration',
      updatedAt:actor.now,updatedByUid:actor.uid,updatedBy:actor.name,schemaVersion:3});
  });
  const months=new Map();
  dayDocuments.forEach(day=>{
    const id=`${day.month}__${day.employeeId}`;const current=months.get(id)||{monthSummaryId:id,month:day.month,
      employeeId:day.employeeId,employeeName:day.employeeName,department:day.department,days:{},attendanceHours:0,
      supplementHours:0,activeEntryCount:0,workedDayCount:0,summaryComplete:true,revision:0,lastDayId:'',lastDayRevision:0,
      lastMutation:'migration',updatedAt:actor.now,updatedByUid:actor.uid,updatedBy:actor.name,schemaVersion:3};
    current.days[`d${day.productionDate.slice(8,10)}`]={productionDate:day.productionDate,normalHours:day.normalHours,
      overtimeHours:day.overtimeHours,attendanceHours:day.attendanceHours,supplementHours:day.activeSupplementHours,
      activeEntryCount:day.activeEntryCount,activeStandardEntryCount:day.activeStandardEntryCount,
      processes:clone(day.processes),dayRevision:day.revision};
    current.attendanceHours=round(current.attendanceHours+day.attendanceHours,2);
    current.supplementHours=round(current.supplementHours+day.activeSupplementHours,4);
    current.activeEntryCount+=day.activeEntryCount;current.workedDayCount+=day.attendanceHours>0?1:0;
    current.revision+=1;current.lastDayId=day.summaryId;current.lastDayRevision=day.revision;
    months.set(id,current);
  });
  return {dayDocuments,monthDocuments:[...months.values()].sort((a,b)=>a.monthSummaryId.localeCompare(b.monthSummaryId))};
}

export function buildMigrationPlan(source,options={}){
  const actor=sourceActor(options),runId=text(options.runId)||DEFAULT_RUN_ID;
  const migrationOperationLogId=migrationCompletionLogId(runId);
  const mappings=new Map(),exceptions=new Map(),writes=new Map();
  const addWrite=(phase,collection,id,data,merge=false,atomicKey='')=>{
    const value={phase,collection,id:text(id),data:clone(data),merge:merge===true,atomicKey:text(atomicKey)};
    writes.set(writeKey(value),value);return value;
  };

  const roots=productRootRows(source).map(row=>normalizedProduct(row,actor));
  const productsByCode=candidateByCode(roots);
  const validProducts=[];
  roots.forEach(candidate=>{
    const sameCode=productsByCode.get(normalizeKey(candidate.code))||[];
    const reason=sameCode.length>1?'ambiguous-product-code':validateProductCandidate(candidate);
    if(reason){
      exceptionFor(exceptions,{sourceType:'product',sourceKey:candidate.sourceKey,reasonCode:reason,
        candidateIds:sameCode.map(item=>item.productId),detail:`products/${candidate.sourceRow.id} 無法唯一轉成正式款號。`});return;
    }
    const historyId=`${candidate.productId}__${String(candidate.product.revision).padStart(8,'0')}`;
    const operationLogId=migrationOperationLogId;
    const atomicKey=`product:${candidate.productId}`;
    candidate.product={...candidate.product,historyId,operationLogId};
    validProducts.push(candidate);
    mappingFor(mappings,{sourceType:'product',sourceKey:candidate.sourceKey,targetKind:'product',targetId:candidate.productId});
    candidate.operations.forEach(operation=>mappingFor(mappings,{sourceType:'process',sourceKey:operation.sourceKey,
      targetKind:'process',targetId:operation.processId}));
    addWrite('products','products',candidate.productId,candidate.product,false,atomicKey);
    addWrite('products','productCodeIndex',candidate.codeKey,{codeKey:candidate.codeKey,code:candidate.code,
      productId:candidate.productId,operationLogId,updatedAt:actor.now,updatedByUid:actor.uid},false,atomicKey);
    addWrite('products','productHistory',historyId,{...clone(candidate.product),versionId:historyId,
      productRevision:candidate.product.revision,createdAt:actor.now,createdByUid:actor.uid,createdBy:actor.name},false,atomicKey);
    if(candidate.sourceRow.id!==candidate.productId){
      addWrite('products','products',candidate.sourceRow.id,{deleted:true,retiredToProductId:candidate.productId,
        retiredAt:actor.now,retiredByUid:actor.uid,migrationVersion:MIGRATION_VERSION},true,atomicKey);
    }
  });
  const usableProductsByCode=candidateByCode(validProducts);

  const preliminaryGroups=[];
  groupRootRows(source).forEach(row=>{
    const sourceKey=legacySourceKey('productGroups',row.id);
    const groupId=fixedId(row.groupId,'group')||fixedId(row.retiredToGroupId,'group')||deterministicLegacyId('group',sourceKey);
    const resolvedIds=[];let invalid=false;
    if(Array.isArray(row.memberProductIds)&&row.memberProductIds.length){
      row.memberProductIds.forEach(value=>{
        const productId=fixedId(value,'product');
        if(!productId||!validProducts.some(product=>product.productId===productId)) invalid=true;
        else resolvedIds.push(productId);
      });
    }else{
      const codes=Array.isArray(row.memberCodes)?row.memberCodes:Array.isArray(row.members)?row.members:[];
      codes.forEach(value=>{
        const code=typeof value==='object'?value.code:value;
        const candidates=usableProductsByCode.get(normalizeKey(code))||[];
        if(candidates.length!==1) invalid=true;else resolvedIds.push(candidates[0].productId);
      });
    }
    const memberProductIds=sortedUnique(resolvedIds),name=text(row.name||row.groupName);
    if(invalid||!name||memberProductIds.length<2||memberProductIds.length>200){
      exceptionFor(exceptions,{sourceType:'productGroup',sourceKey,reasonCode:invalid?'missing-or-ambiguous-group-product':'invalid-product-group',
        candidateIds:memberProductIds,detail:`productGroups/${row.id} 無法唯一轉成固定款號群組。`});return;
    }
    preliminaryGroups.push({sourceRow:row,sourceKey,groupId,name,memberProductIds,active:row.active!==false});
  });
  const groupOwners=new Map();
  preliminaryGroups.filter(group=>group.active).forEach(group=>group.memberProductIds.forEach(productId=>{
    const owners=groupOwners.get(productId)||[];owners.push(group);groupOwners.set(productId,owners);
  }));
  const convertedGroups=[];
  preliminaryGroups.forEach(group=>{
    const conflicts=group.memberProductIds.flatMap(productId=>(groupOwners.get(productId)||[]).filter(owner=>owner.groupId!==group.groupId));
    if(conflicts.length){
      exceptionFor(exceptions,{sourceType:'productGroup',sourceKey:group.sourceKey,reasonCode:'product-in-multiple-active-groups',
        candidateIds:[group.groupId,...conflicts.map(item=>item.groupId)],detail:'同一款號同時出現在多個啟用群組，無法自動選擇。'});return;
    }
    const operationLogId=migrationOperationLogId,atomicKey=`group:${group.groupId}`;
    const saved={groupId:group.groupId,name:group.name,memberProductIds:group.memberProductIds,active:group.active,
      revision:positiveInteger(group.sourceRow.revision)||1,createdAt:Math.min(timestamp(group.sourceRow.createdAt)||actor.now,actor.now),
      createdByUid:text(group.sourceRow.createdByUid)||actor.uid,createdBy:text(group.sourceRow.createdBy)||actor.name,
      updatedAt:actor.now,updatedByUid:actor.uid,operationLogId};
    convertedGroups.push(saved);mappingFor(mappings,{sourceType:'productGroup',sourceKey:group.sourceKey,targetKind:'group',targetId:group.groupId});
    addWrite('groups','productGroups',group.groupId,saved,false,atomicKey);
    group.memberProductIds.forEach(productId=>addWrite('groups','productGroupMembers',productId,{productId,groupId:group.groupId,
      createdAt:actor.now,createdByUid:actor.uid,operationLogId},false,atomicKey));
    if(group.sourceRow.id!==group.groupId) addWrite('groups','productGroups',group.sourceRow.id,{deleted:true,
      retiredToGroupId:group.groupId,retiredAt:actor.now,retiredByUid:actor.uid,migrationVersion:MIGRATION_VERSION},true,atomicKey);
  });

  const orderRows=dataRows(source,'orders');
  const ordersById=new Map(orderRows.map(row=>[row.id,row]));
  const ordersByNumber=new Map();
  orderRows.forEach(row=>{
    const key=normalizeKey(row.orderId||row.orderNo||row.id),values=ordersByNumber.get(key)||[];values.push(row);ordersByNumber.set(key,values);
  });
  const processRowsByOrder=new Map();
  dataRows(source,'orderProcesses').forEach(row=>{
    const order=matchOrderDocument(row,ordersById,ordersByNumber);
    if(!order){
      exceptionFor(exceptions,{sourceType:'orderProcess',sourceKey:legacySourceKey('orderProcesses',row.id),
        reasonCode:'missing-or-ambiguous-order',detail:`orderProcesses/${row.id} 找不到唯一訂單。`});return;
    }
    const rows=processRowsByOrder.get(order.id)||[];rows.push(row);processRowsByOrder.set(order.id,rows);
  });
  const processRowsByProductCode=new Map();
  processRowsByOrder.forEach(rows=>rows.forEach(row=>{
    const key=normalizeKey(row.code??row.productCode),values=processRowsByProductCode.get(key)||[];
    values.push(row);processRowsByProductCode.set(key,values);
  }));
  const resolvedLegacyProductIds=new Map();

  const existingItems=dataRows(source,'orderItems').filter(row=>fixedId(row.orderItemId||row.id,'orderItem'));
  const itemsById=new Map();
  existingItems.forEach((row,index)=>{
    const id=fixedId(row.orderItemId||row.id,'orderItem');itemsById.set(id,{...clone(row),id,orderItemId:id,lineNumber:positiveInteger(row.lineNumber)||index+1});
  });
  const processLinks=new Map();
  const convertedOrders=[];
  orderRows.forEach(order=>{
    const rows=processRowsByOrder.get(order.id)||[];
    const existingForOrder=[...itemsById.values()].filter(item=>text(item.orderId)===order.id);
    const groups=new Map();
    rows.forEach(row=>{
      const explicit=explicitLineIdentity(row);
      const key=explicit||`fingerprint:${orderLineFingerprint(row,order.id)}`;
      const group=groups.get(key)||{key,explicit,rows:[]};group.rows.push(row);groups.set(key,group);
    });
    const orderItems=[];
    [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key)).forEach((group,index)=>{
      const sample=group.rows[0];
      const repeatedProcessNumbers=group.rows.map(row=>processNumber(row.processNo??row.no)).filter(Boolean);
      if(!group.explicit&&new Set(repeatedProcessNumbers).size!==repeatedProcessNumbers.length){
        group.rows.forEach(row=>exceptionFor(exceptions,{sourceType:'orderProcess',sourceKey:legacySourceKey('orderProcesses',row.id),
          reasonCode:'ambiguous-identical-order-lines',detail:'相同訂單條件出現重複工序，缺少可分辨的原始行識別。'}));return;
      }
      const legacyCode=sample.code??sample.productCode;
      const productCandidates=orderProductCandidates(legacyCode,
        processRowsByProductCode.get(normalizeKey(legacyCode))||group.rows,validProducts,usableProductsByCode);
      if(productCandidates.length!==1){
        group.rows.forEach(row=>exceptionFor(exceptions,{sourceType:'orderProcess',sourceKey:legacySourceKey('orderProcesses',row.id),
          reasonCode:productCandidates.length?'ambiguous-order-product':'missing-order-product',
          candidateIds:productCandidates.map(item=>item.productId),detail:'訂單項目無法唯一連結款號主檔。'}));return;
      }
      const product=productCandidates[0];
      const legacyCodeKey=normalizeKey(legacyCode),previousProductId=resolvedLegacyProductIds.get(legacyCodeKey);
      if(previousProductId&&previousProductId!==product.productId){
        group.rows.forEach(row=>exceptionFor(exceptions,{sourceType:'orderProcess',sourceKey:legacySourceKey('orderProcesses',row.id),
          reasonCode:'ambiguous-order-product',candidateIds:[previousProductId,product.productId],
          detail:'同一舊款號在不同訂單中連結到不同目前款號。'}));return;
      }
      resolvedLegacyProductIds.set(legacyCodeKey,product.productId);
      const matchingExisting=existingForOrder.filter(item=>item.productId===product.productId
        &&(!group.explicit||fixedId(sample.orderItemId,'orderItem')===item.orderItemId));
      if(matchingExisting.length>1){
        group.rows.forEach(row=>exceptionFor(exceptions,{sourceType:'orderProcess',sourceKey:legacySourceKey('orderProcesses',row.id),
          reasonCode:'ambiguous-existing-order-item',candidateIds:matchingExisting.map(item=>item.orderItemId),detail:'找到多筆既有訂單項目。'}));return;
      }
      const itemSource=legacySourceKey('orders',order.id,`item:${group.key}`);
      const orderItemId=fixedId(sample.orderItemId,'orderItem')||matchingExisting[0]?.orderItemId||deterministicLegacyId('orderItem',itemSource);
      const item={orderItemId,orderId:order.id,productId:product.productId,
        quantity:positiveInteger(sample.orderQty??sample.quantity??sample.qty),
        lineNumber:positiveInteger(sample.lineNumber)||index+1,active:sample.active!==false,revision:positiveInteger(matchingExisting[0]?.revision)||1,
        createdAt:Math.min(timestamp(matchingExisting[0]?.createdAt||sample.createdAt)||actor.now,actor.now),
        createdByUid:text(matchingExisting[0]?.createdByUid||sample.createdByUid)||actor.uid,
        updatedAt:actor.now,updatedByUid:actor.uid};
      ORDER_OWNED_FIELDS.forEach(field=>{
        const value=orderOwnedValue(sample,field);
        if(value!==undefined&&value!==null&&value!=='') item[field]=field.toLowerCase().includes('date')?timestamp(value):clone(value);
      });
      if(!item.quantity){
        group.rows.forEach(row=>exceptionFor(exceptions,{sourceType:'orderProcess',sourceKey:legacySourceKey('orderProcesses',row.id),
          reasonCode:'invalid-order-item-quantity',detail:'訂單項目數量不是正整數。'}));return;
      }
      itemsById.set(orderItemId,item);orderItems.push(item);
      mappingFor(mappings,{sourceType:'orderItem',sourceKey:itemSource,targetKind:'orderItem',targetId:orderItemId});
      group.rows.forEach(row=>{
        const operations=legacyProcessCandidates(product,row);
        if(operations.length!==1){
          exceptionFor(exceptions,{sourceType:'orderProcess',sourceKey:legacySourceKey('orderProcesses',row.id),
            reasonCode:operations.length?'ambiguous-product-master-process':'missing-product-master-process',
            candidateIds:operations.map(operation=>operation.processId),
            detail:'不得使用訂單舊快照代替缺少的正式款號工序。'});return;
        }
        processLinks.set(row.id,{order,orderItem:item,product,operation:operations[0],legacyProcess:row});
      });
    });
    if(!orderItems.length&&Number(order.schemaVersion)===2&&existingForOrder.length) orderItems.push(...existingForOrder);
    if(!orderItems.length) return;
    const operationLogId=migrationOperationLogId,atomicKey=`order:${order.id}`;
    const header=canonicalOrderHeader(order,orderItems,actor,operationLogId);
    if(!header.client||!header.dueDate){
      exceptionFor(exceptions,{sourceType:'order',sourceKey:legacySourceKey('orders',order.id),
        reasonCode:!header.client?'missing-order-client':'missing-order-due-date',detail:'訂單自己的必要表頭資料不完整。'});return;
    }
    convertedOrders.push({...header,id:order.id});addWrite('orders','orders',order.id,header,false,atomicKey);
    const totalBatches=Math.max(1,Math.ceil(orderItems.length/400));
    addWrite('orders','orderImportLocks',header.importLockId,{
      lockId:header.importLockId,orderNo:header.orderId,orderDocumentId:order.id,status:'ready',completedBatches:totalBatches,
      totalBatches,createdAt:header.createdAt,createdByUid:header.createdByUid,createdBy:header.createdBy,
      completedAt:actor.now,updatedAt:actor.now,updatedByUid:actor.uid,operationLogId
    },false,atomicKey);
    // 訂單項目可先分批寫入；訂單主檔與匯入鎖最後同批切成 ready（可用）狀態。
    orderItems.forEach(item=>addWrite('orderItems','orderItems',item.orderItemId,item));
  });

  const entryRows=dataRows(source,'productionEntries');
  const convertedEntries=[];
  const linkCandidates=[...processLinks.entries()].map(([id,link])=>({id,...link}));
  entryRows.forEach(row=>{
    const entrySource=legacySourceKey('productionEntries',row.id);
    const date=productionDate(row.productionDate||row.date),employeeId=text(row.employeeId||row.employeeCode).toUpperCase();
    const isSupplement=text(row.recordType)==='supplement'||text(row.processNo)==='0';
    if(!date||!employeeId){
      exceptionFor(exceptions,{sourceType:'productionEntry',sourceKey:entrySource,reasonCode:'invalid-entry-identity',detail:'生產日期或員工工號不正確。'});return;
    }
    let link=processLinks.get(text(row.orderProcessId));
    if(!link&&!isSupplement){
      const orderIdentity=normalizeKey(row.orderId||row.orderNo),code=normalizeKey(row.productCode||row.code),no=processNumber(row.processNo);
      const resolvedProductId=resolvedLegacyProductIds.get(code)
        ||(usableProductsByCode.get(code)?.length===1?usableProductsByCode.get(code)[0].productId:'');
      const matches=linkCandidates.filter(candidate=>(normalizeKey(candidate.order.id)===orderIdentity
        ||normalizeKey(candidate.order.orderId||candidate.order.orderNo)===orderIdentity)
        &&candidate.product.productId===resolvedProductId
        &&processNumber(candidate.legacyProcess?.processNo??candidate.operation.no)===no);
      if(matches.length===1) link=matches[0];
      else{
        exceptionFor(exceptions,{sourceType:'productionEntry',sourceKey:entrySource,
          reasonCode:matches.length?'ambiguous-entry-order-item-process':'missing-entry-order-item-process',
          candidateIds:matches.map(item=>item.orderItem.orderItemId),detail:'產能無法唯一連結訂單項目與正式工序。'});return;
      }
    }
    const attendance=dataRows(source,'productionAttendance').find(item=>productionDate(item.attendanceDate||item.productionDate)===date
      &&text(item.employeeId).toUpperCase()===employeeId)||{};
    const common={id:row.id,productionDate:date,employeeId,
      employeeName:text(row.employeeName||attendance.employeeName).slice(0,100),department:text(row.department||attendance.department).slice(0,100),
      orderId:text(link?.order?.id||row.orderId),orderItemId:text(link?.orderItem?.orderItemId||row.orderItemId),
      productId:text(link?.product?.productId||row.productId),status:text(row.status)==='voided'?'voided':'active',
      revision:positiveInteger(row.revision)||1,createdAt:timestamp(row.createdAt)||actor.now,
      createdByUid:text(row.createdByUid)||actor.uid,createdBy:text(row.createdBy)||actor.name,
      updatedAt:timestamp(row.updatedAt)||actor.now,updatedByUid:text(row.updatedByUid)||actor.uid,updatedBy:text(row.updatedBy)||actor.name,
      schemaVersion:2};
    let entry;
    if(isSupplement){
      const hours=round(row.supplementHours??row.hours,2);
      if(hours<=0){ exceptionFor(exceptions,{sourceType:'productionEntry',sourceKey:entrySource,
        reasonCode:'invalid-supplement-hours',detail:'補充工時不正確。'});return; }
      entry={...common,recordType:'supplement',processNo:'0',supplementReason:text(row.supplementReason||row.reason).slice(0,200),
        supplementHours:hours,calculationVersion:'supplement-hours-v2'};
    }else{
      const quantity=positiveInteger(row.quantity??row.qty);
      if(!quantity){ exceptionFor(exceptions,{sourceType:'productionEntry',sourceKey:entrySource,
        reasonCode:'invalid-entry-quantity',detail:'產能數量不是正整數。'});return; }
      entry={...common,recordType:'standard',orderId:link.order.id,orderItemId:link.orderItem.orderItemId,
        productId:link.product.productId,processId:link.operation.processId,quantity,calculationVersion:'product-resolver-v2'};
    }
    if(entry.status==='voided') Object.assign(entry,{voidedAt:timestamp(row.voidedAt)||entry.updatedAt,
      voidedByUid:text(row.voidedByUid)||entry.updatedByUid,voidedBy:text(row.voidedBy)||entry.updatedBy,
      voidReason:text(row.voidReason).slice(0,500)});
    convertedEntries.push(entry);const {id,...stored}=entry;addWrite('entries','productionEntries',id,stored);
  });

  const activeStandard=convertedEntries.filter(entry=>entry.status==='active'&&entry.recordType==='standard');
  const totals=new Map();
  activeStandard.forEach(entry=>{
    const id=`${entry.orderItemId}__${entry.processId}`,item=itemsById.get(entry.orderItemId);
    if(!item) return;
    const current=totals.get(id)||{orderItemId:item.orderItemId,orderId:item.orderId,productId:item.productId,processId:entry.processId,
      orderQty:item.quantity,registeredQty:0,updatedAt:actor.now,updatedByUid:actor.uid,lastMutation:'create',lastDelta:0,
      lastEntryId:'',schemaVersion:2};
    current.registeredQty+=entry.quantity;current.lastDelta=entry.quantity;current.lastEntryId=entry.id;totals.set(id,current);
  });
  totals.forEach((total,id)=>{
    if(total.registeredQty>total.orderQty){
      exceptionFor(exceptions,{sourceType:'productionProcessTotal',sourceKey:legacySourceKey('productionProcessTotals',id),
        reasonCode:'registered-quantity-exceeds-order-item',detail:`累計 ${total.registeredQty} 超過訂單項目 ${total.orderQty}。`});return;
    }
    addWrite('totals','productionProcessTotals',id,total);
  });
  const supplementTotals=new Map();
  convertedEntries.filter(entry=>entry.status==='active'&&entry.recordType==='supplement').forEach(entry=>{
    const id=`${entry.productionDate}__${entry.employeeId}`;const current=supplementTotals.get(id)||{productionDate:entry.productionDate,
      employeeId:entry.employeeId,activeHours:0,lastEntryId:'',lastMutation:'create',lastDelta:0,updatedAt:actor.now,
      updatedByUid:actor.uid,schemaVersion:2};
    current.activeHours=round(current.activeHours+entry.supplementHours,2);current.lastEntryId=entry.id;
    current.lastDelta=entry.supplementHours;supplementTotals.set(id,current);
  });
  supplementTotals.forEach((total,id)=>addWrite('totals','productionSupplementTotals',id,total));

  const summaries=buildDayAndMonthDocuments(convertedEntries,dataRows(source,'productionAttendance'),actor);
  summaries.dayDocuments.forEach(day=>addWrite('summaries','productionDaySummaries',day.summaryId,day));
  summaries.monthDocuments.forEach(month=>addWrite('summaries','productionEmployeeMonths',month.monthSummaryId,month));
  const monthIds=sortedUnique(summaries.monthDocuments.map(item=>item.month));
  monthIds.forEach(month=>{
    const token=`migration-${MIGRATION_VERSION}-${stableHash({month,entries:convertedEntries.filter(entry=>entry.productionDate.startsWith(month)).map(entry=>entry.id)}).slice(0,20)}`;
    addWrite('summaries','productionMonths',month,{month,status:'open',summaryReady:true,entriesVersion:token,
      attendanceVersion:token,summaryVersion:token,revision:1,updatedAt:actor.now,updatedByUid:actor.uid,
      updatedBy:actor.name,schemaVersion:3});
  });

  // Legacy Mapping（舊資料對照）完整保留在本機 Manifest（轉換清單），不寫入正式雲端集合。
  exceptions.forEach(exception=>addWrite('exceptions',MIGRATION_COLLECTIONS.exceptions,exception.exceptionId,exception));
  dataRows(source,MIGRATION_COLLECTIONS.exceptions).filter(exception=>exception.status==='unresolved'&&!exceptions.has(exception.id))
    .forEach(exception=>addWrite('exceptions',MIGRATION_COLLECTIONS.exceptions,exception.id,{
      status:'resolved',resolvedAt:actor.now,resolution:'replanned-without-exception',migrationVersion:MIGRATION_VERSION
    },true));
  const lastProduct=validProducts.at(-1);
  if(lastProduct){
    const meta={version:`pmv3-migration-${actor.now}`,changeSequence:validProducts.length,productCount:validProducts.length,
      opCount:validProducts.reduce((sum,item)=>sum+item.operations.length,0),
      lastProductId:lastProduct.productId,lastRevision:lastProduct.product.revision,
      updatedAt:actor.now,updatedByUid:actor.uid,operationLogId:lastProduct.product.operationLogId,schemaVersion:3};
    addWrite('control','system','productsMeta',meta,false,`product:${lastProduct.productId}`);
  }

  const phaseOrder=['products','groups','orderItems','orders','entries','totals','summaries','mappings','exceptions','control'];
  const orderedWrites=[...writes.values()].sort((left,right)=>phaseOrder.indexOf(left.phase)-phaseOrder.indexOf(right.phase)
    ||left.collection.localeCompare(right.collection)||left.id.localeCompare(right.id));
  const counts=Object.fromEntries(phaseOrder.map(phase=>[phase,orderedWrites.filter(write=>write.phase===phase).length]));
  const manifest={runId,migrationVersion:MIGRATION_VERSION,status:exceptions.size?'planned-with-exceptions':'planned',
    sourceCounts:Object.fromEntries(SOURCE_COLLECTIONS.map(name=>[name,dataRows(source,name).length])),targetWriteCounts:counts,
    mappingCount:mappings.size,exceptionCount:exceptions.size,productCount:validProducts.length,groupCount:convertedGroups.length,orderCount:convertedOrders.length,
    orderItemCount:itemsById.size,entryCount:convertedEntries.length,daySummaryCount:summaries.dayDocuments.length,
    monthSummaryCount:summaries.monthDocuments.length,createdAt:actor.now,createdByUid:actor.uid};
  const planHash=calculateMigrationPlanHash(orderedWrites);
  return {runId,planHash,manifest,writes:orderedWrites,mappings:[...mappings.values()],exceptions:[...exceptions.values()]};
}

function atomicMigrationBatches(writes,requestedSize){
  const units=[],unitsByKey=new Map();
  writes.forEach(write=>{
    const key=text(write.atomicKey)||`write:${writeKey(write)}`;
    if(!unitsByKey.has(key)){ const unit=[];unitsByKey.set(key,unit);units.push(unit); }
    unitsByKey.get(key).push(write);
  });
  const largestUnit=units.reduce((largest,unit)=>Math.max(largest,unit.length),0);
  if(largestUnit>499) throw new Error(`同成同敗的資料群組共有 ${largestUnit} 筆，超過單次 499 筆資料上限。`);
  const batchSize=Math.min(499,Math.max(requestedSize,largestUnit,1)),batches=[];
  let current=[];
  units.forEach(unit=>{
    if(current.length&&current.length+unit.length>batchSize){ batches.push(current);current=[]; }
    current.push(...unit);
  });
  if(current.length) batches.push(current);
  return {batchSize,batches};
}

export async function applyMigrationPlan(repository,plan,options={}){
  const requestedBatchSize=Math.min(400,Math.max(1,positiveInteger(options.batchSize)||300));
  const {batchSize,batches}=atomicMigrationBatches(plan.writes,requestedBatchSize);
  const sourceDocumentCount=positiveInteger(options.sourceDocumentCount)
    ||Object.values(plan.manifest.sourceCounts||{}).reduce((sum,value)=>sum+Math.max(0,integer(value)),0);
  const sourceHash=text(options.sourceHash)||stableHash(plan.manifest.sourceCounts||{});
  const audit={sourceHash,sourceDocumentCount};
  const current=await repository.get(MIGRATION_COLLECTIONS.runs,plan.runId);
  if(current?.status==='complete'&&current.migrationVersion===MIGRATION_VERSION){
    return {runId:plan.runId,status:'complete',alreadyComplete:true,completedBatches:number(current.completedBatches),totalBatches:number(current.totalBatches)};
  }
  const canResume=current?.planHash===plan.planHash;
  let completedBatches=canResume?Math.min(batches.length,Math.max(0,integer(current.completedBatches))):0;
  const startedAt=number(current?.startedAt)||Date.now();
  await repository.commit([{collection:MIGRATION_COLLECTIONS.runs,id:plan.runId,data:{...plan.manifest,...audit,planHash:plan.planHash,
    status:completedBatches?'resuming':current?'restarting':'running',batchSize,totalBatches:batches.length,completedBatches,
    startedAt,updatedAt:Date.now()},merge:false}]);
  try{
    for(let index=completedBatches;index<batches.length;index+=1){
      const checkpoint={collection:MIGRATION_COLLECTIONS.runs,id:plan.runId,data:{...plan.manifest,...audit,planHash:plan.planHash,
        status:'running',batchSize,totalBatches:batches.length,completedBatches:index+1,lastPhase:batches[index].at(-1)?.phase||'',
        startedAt,updatedAt:Date.now()},merge:false};
      await repository.commit([...batches[index],checkpoint]);
      completedBatches=index+1;
      options.onProgress?.({completedBatches,totalBatches:batches.length,lastPhase:checkpoint.data.lastPhase});
      if(positiveInteger(options.failAfterBatches)===completedBatches) throw new Error('測試用批次中斷。');
    }
  }catch(error){
    await repository.commit([{collection:MIGRATION_COLLECTIONS.runs,id:plan.runId,data:{...plan.manifest,...audit,planHash:plan.planHash,
      status:'interrupted',batchSize,totalBatches:batches.length,completedBatches,startedAt,updatedAt:Date.now(),
      error:text(error.message).slice(0,1000)},merge:false}]);
    throw error;
  }
  const completedAt=Date.now(),logId=migrationCompletionLogId(plan.runId);
  const log={permissionKey:'productionProcessEdit',feature:'productMasterMigration',action:'identityMigration',status:'success',
    targetType:'migrationRun',targetId:plan.runId,itemCount:sourceDocumentCount,detailCount:plan.writes.length,
    note:`${MIGRATION_VERSION}；本機對照 ${number(plan.manifest.mappingCount)} 筆；例外 ${plan.exceptions.length} 筆`,
    createdAt:completedAt,createdByUid:text(plan.manifest.createdByUid)||'migration-tool',createdBy:'資料轉換工具',
    operationLogId:logId,schemaVersion:2,migrationVersion:MIGRATION_VERSION,planHash:plan.planHash,sourceHash,
    sourceDocumentCount,plannedWriteCount:plan.writes.length,mappingCount:number(plan.manifest.mappingCount),
    exceptionCount:plan.exceptions.length,productCount:number(plan.manifest.productCount),groupCount:number(plan.manifest.groupCount),
    orderCount:number(plan.manifest.orderCount),orderItemCount:number(plan.manifest.orderItemCount),entryCount:number(plan.manifest.entryCount),
    daySummaryCount:number(plan.manifest.daySummaryCount),monthSummaryCount:number(plan.manifest.monthSummaryCount)};
  await repository.commit([
    {collection:MIGRATION_COLLECTIONS.logs,id:logId,data:log,merge:false},
    {collection:MIGRATION_COLLECTIONS.runs,id:plan.runId,data:{...plan.manifest,...audit,planHash:plan.planHash,status:'complete',
      batchSize,totalBatches:batches.length,completedBatches:batches.length,startedAt,completedAt,updatedAt:completedAt,
      operationLogId:logId},merge:false}
  ]);
  return {runId:plan.runId,status:'complete',alreadyComplete:false,completedBatches:batches.length,totalBatches:batches.length,
    exceptionCount:plan.exceptions.length};
}

function forbiddenSnapshotKeys(value,pathValue='',found=[]){
  if(Array.isArray(value)){ value.forEach((item,index)=>forbiddenSnapshotKeys(item,`${pathValue}[${index}]`,found));return found; }
  if(!value||typeof value!=='object') return found;
  Object.entries(value).forEach(([key,item])=>{
    if(SNAPSHOT_FIELDS.has(key)) found.push(`${pathValue}.${key}`);
    forbiddenSnapshotKeys(item,`${pathValue}.${key}`,found);
  });
  return found;
}
function documentData(row){ const {id:ignored,...data}=document(row);return data; }
function exactDocumentErrors(label,value,keys){
  const actual=Object.keys(document(value)).sort(),expected=[...keys].sort();
  const missing=expected.filter(key=>!actual.includes(key)),unexpected=actual.filter(key=>!expected.includes(key));
  const errors=[];
  if(missing.length) errors.push(`${label} 缺少正式欄位：${missing.join(', ')}`);
  if(unexpected.length) errors.push(`${label} 含非正式欄位：${unexpected.join(', ')}`);
  return errors;
}
export async function validateRepository(repository,options={}){
  const runId=text(options.runId)||DEFAULT_RUN_ID,completionLogId=migrationCompletionLogId(runId),errors=[],warnings=[];
  const [products,groups,groupMembers,orders,items,entries,totals,days,months,exceptions,run,migrationLog]=await Promise.all([
    repository.list('products'),repository.list('productGroups'),repository.list('productGroupMembers'),repository.list('orders'),repository.list('orderItems'),repository.list('productionEntries'),
    repository.list('productionProcessTotals'),repository.list('productionDaySummaries'),repository.list('productionEmployeeMonths'),
    repository.list(MIGRATION_COLLECTIONS.exceptions),repository.get(MIGRATION_COLLECTIONS.runs,runId),
    repository.get(MIGRATION_COLLECTIONS.logs,completionLogId)
  ]);
  const activeProducts=products.filter(row=>row.deleted!==true),productsById=new Map(activeProducts.map(row=>[row.id,row]));
  for(const row of activeProducts){
    errors.push(...exactDocumentErrors(`products/${row.id}`,documentData(row),FORMAL_DOCUMENT_KEYS.product));
    if(fixedId(row.productId,'product')!==row.id) errors.push(`products/${row.id} 的固定識別碼不正確。`);
    (Array.isArray(row.ops)?row.ops:[]).forEach(operation=>{
      if(!fixedId(operation.processId,'process')) errors.push(`products/${row.id} 含有無效工序識別碼。`);
    });
    if(stableHash(row.processIds||[])!==stableHash((row.ops||[]).map(operation=>operation.processId))){
      errors.push(`products/${row.id} 的工序識別碼清單不一致。`);
    }
    if(row.operationLogId!==completionLogId) errors.push(`products/${row.id} 未連到本次資料轉換完成紀錄。`);
    const index=await repository.get('productCodeIndex',row.codeKey);
    if(!index) errors.push(`productCodeIndex/${row.codeKey} 不存在。`);
    else{
      errors.push(...exactDocumentErrors(`productCodeIndex/${row.codeKey}`,index,FORMAL_DOCUMENT_KEYS.productCodeIndex));
      if(index.productId!==row.id||index.operationLogId!==row.operationLogId) errors.push(`productCodeIndex/${row.codeKey} 的款號或操作紀錄不一致。`);
    }
    const history=await repository.get('productHistory',row.historyId);
    if(!history) errors.push(`productHistory/${row.historyId} 不存在。`);
    else{
      errors.push(...exactDocumentErrors(`productHistory/${row.historyId}`,history,FORMAL_DOCUMENT_KEYS.productHistory));
      if(history.productId!==row.id||history.productRevision!==row.revision||history.operationLogId!==row.operationLogId){
        errors.push(`productHistory/${row.historyId} 的款號版本或操作紀錄不一致。`);
      }
    }
  }
  const metadata=await repository.get('system','productsMeta');
  if(activeProducts.length&&!metadata) errors.push('system/productsMeta 不存在。');
  else if(metadata){
    errors.push(...exactDocumentErrors('system/productsMeta',metadata,FORMAL_DOCUMENT_KEYS.productsMeta));
    if(number(metadata.productCount)!==activeProducts.length) errors.push('system/productsMeta 的款號數量不一致。');
    if(number(metadata.opCount)!==activeProducts.reduce((sum,row)=>sum+(row.ops||[]).length,0)) errors.push('system/productsMeta 的工序數量不一致。');
    if(metadata.operationLogId!==completionLogId) errors.push('system/productsMeta 未連到本次資料轉換完成紀錄。');
  }
  const groupMembersById=new Map(groupMembers.map(row=>[row.id,row]));
  for(const group of groups.filter(row=>row.deleted!==true)){
    errors.push(...exactDocumentErrors(`productGroups/${group.id}`,documentData(group),FORMAL_DOCUMENT_KEYS.productGroup));
    if(fixedId(group.groupId,'group')!==group.id) errors.push(`productGroups/${group.id} 的固定識別碼不正確。`);
    if(group.operationLogId!==completionLogId) errors.push(`productGroups/${group.id} 未連到本次資料轉換完成紀錄。`);
    (Array.isArray(group.memberProductIds)?group.memberProductIds:[]).forEach(productId=>{
      if(!productsById.has(productId)) errors.push(`productGroups/${group.id} 找不到 products/${productId}。`);
      const member=groupMembersById.get(productId);
      if(member?.groupId!==group.id) errors.push(`productGroupMembers/${productId} 的群組索引不一致。`);
      else{
        errors.push(...exactDocumentErrors(`productGroupMembers/${productId}`,documentData(member),FORMAL_DOCUMENT_KEYS.productGroupMember));
        if(member.operationLogId!==group.operationLogId) errors.push(`productGroupMembers/${productId} 的操作紀錄不一致。`);
      }
    });
  }
  const itemsById=new Map(items.map(row=>[row.id,row]));
  items.forEach(row=>{
    if(fixedId(row.orderItemId,'orderItem')!==row.id) errors.push(`orderItems/${row.id} 的固定識別碼不正確。`);
    if(!productsById.has(row.productId)) errors.push(`orderItems/${row.id} 找不到 products/${row.productId}。`);
  });
  for(const order of orders.filter(row=>Number(row.schemaVersion)===2)){
    errors.push(...exactDocumentErrors(`orders/${order.id}`,documentData(order),FORMAL_DOCUMENT_KEYS.order));
    if(order.operationLogId!==completionLogId) errors.push(`orders/${order.id} 未連到本次資料轉換完成紀錄。`);
    const linked=items.filter(item=>item.orderId===order.id);
    if(linked.length!==number(order.itemCount)) errors.push(`orders/${order.id} 的項目數不一致。`);
    if(linked.reduce((sum,item)=>sum+number(item.quantity),0)!==number(order.totalQty)) errors.push(`orders/${order.id} 的數量合計不一致。`);
    const lock=await repository.get('orderImportLocks',order.importLockId);
    if(!lock) errors.push(`orderImportLocks/${order.importLockId} 不存在。`);
    else{
      errors.push(...exactDocumentErrors(`orderImportLocks/${order.importLockId}`,lock,FORMAL_DOCUMENT_KEYS.orderImportLock));
      if(lock.orderDocumentId!==order.id||lock.status!=='ready'||lock.operationLogId!==order.operationLogId){
        errors.push(`orderImportLocks/${order.importLockId} 的訂單或操作紀錄不一致。`);
      }
    }
  }
  const expectedTotals=new Map();
  entries.filter(entry=>Number(entry.schemaVersion)===2&&entry.recordType==='standard'&&entry.status==='active').forEach(entry=>{
    const item=itemsById.get(entry.orderItemId),product=productsById.get(entry.productId);
    if(!item||item.orderId!==entry.orderId||item.productId!==entry.productId) errors.push(`productionEntries/${entry.id} 的訂單項目關聯不正確。`);
    if(!product||(product.ops||[]).every(operation=>operation.processId!==entry.processId)) errors.push(`productionEntries/${entry.id} 找不到目前正式工序。`);
    const forbidden=forbiddenSnapshotKeys(entry,'entry');
    if(forbidden.length) errors.push(`productionEntries/${entry.id} 仍含款號快照欄位：${forbidden.join(', ')}`);
    const id=`${entry.orderItemId}__${entry.processId}`;expectedTotals.set(id,(expectedTotals.get(id)||0)+number(entry.quantity));
  });
  const totalsById=new Map(totals.filter(row=>Number(row.schemaVersion)===2).map(row=>[row.id,row]));
  expectedTotals.forEach((quantity,id)=>{
    if(number(totalsById.get(id)?.registeredQty)!==quantity) errors.push(`productionProcessTotals/${id} 的累計數量不一致。`);
  });
  [...days,...months].filter(row=>Number(row.schemaVersion)===3).forEach(row=>{
    const forbidden=forbiddenSnapshotKeys(row,'summary');
    if(forbidden.length) errors.push(`${row.id} 的未鎖定摘要仍含主檔快照：${forbidden.join(', ')}`);
  });
  if(!run||run.status!=='complete') errors.push(`${MIGRATION_COLLECTIONS.runs}/${runId} 尚未完成。`);
  if(!migrationLog) errors.push(`${MIGRATION_COLLECTIONS.logs}/${completionLogId} 不存在。`);
  else{
    errors.push(...exactDocumentErrors(`${MIGRATION_COLLECTIONS.logs}/${completionLogId}`,migrationLog,FORMAL_DOCUMENT_KEYS.migrationOperationLog));
    if(migrationLog.operationLogId!==completionLogId||migrationLog.targetType!=='migrationRun'||migrationLog.targetId!==runId){
      errors.push(`${MIGRATION_COLLECTIONS.logs}/${completionLogId} 的轉換執行關聯不一致。`);
    }
    if(migrationLog.planHash!==run?.planHash||migrationLog.sourceHash!==run?.sourceHash){
      errors.push(`${MIGRATION_COLLECTIONS.logs}/${completionLogId} 的 Plan／Source Hash（計畫／來源雜湊）不一致。`);
    }
    const plannedWriteCount=Object.values(run?.targetWriteCounts||{}).reduce((sum,value)=>sum+Math.max(0,integer(value)),0);
    if(number(migrationLog.plannedWriteCount)!==plannedWriteCount||number(migrationLog.mappingCount)!==number(run?.mappingCount)){
      errors.push(`${MIGRATION_COLLECTIONS.logs}/${completionLogId} 的寫入或本機對照數量不一致。`);
    }
  }
  const unresolved=exceptions.filter(row=>row.status==='unresolved');
  if(unresolved.length) warnings.push(`仍有 ${unresolved.length} 筆真正無法唯一判斷的資料。`);
  return {ok:errors.length===0&&unresolved.length===0,structurallyValid:errors.length===0,errors,warnings,
    counts:{activeProducts:activeProducts.length,groups:groups.filter(row=>row.deleted!==true).length,orders:orders.filter(row=>Number(row.schemaVersion)===2).length,
      orderItems:items.length,entries:entries.filter(row=>Number(row.schemaVersion)===2).length,totals:totalsById.size,
      daySummaries:days.filter(row=>Number(row.schemaVersion)===3).length,
      monthSummaries:months.filter(row=>Number(row.schemaVersion)===3).length,exceptions:unresolved.length}};
}

export function createMemoryRepository(seed={}){
  let state=new Map();
  Object.entries(seed).forEach(([collection,rows])=>{
    const values=new Map();
    (Array.isArray(rows)?rows:Object.entries(rows||{}).map(([id,data])=>({id,...data}))).forEach(row=>{
      const {id,...data}=row;values.set(text(id),clone(data));
    });state.set(collection,values);
  });
  function collection(name,target=state){ if(!target.has(name)) target.set(name,new Map());return target.get(name); }
  return {
    async list(name){ return [...collection(name).entries()].map(([id,data])=>({id,...clone(data)})).sort((a,b)=>a.id.localeCompare(b.id)); },
    async get(name,id){ const value=collection(name).get(text(id));return value===undefined?null:clone(value); },
    async commit(writes){
      const next=new Map([...state.entries()].map(([name,values])=>[name,new Map([...values.entries()].map(([id,data])=>[id,clone(data)]))]));
      for(const write of writes){
        const values=collection(write.collection,next),current=values.get(text(write.id));
        values.set(text(write.id),write.merge?{...clone(current||{}),...clone(write.data)}:clone(write.data));
      }
      state=next;
    },
    dump(){ return Object.fromEntries([...state.entries()].map(([name,values])=>[name,[...values.entries()].map(([id,data])=>({id,...clone(data)}))])); }
  };
}

function loadDependency(name){
  const root=text(process.env.PCMS_FIREBASE_TOOLS_ROOT);
  if(!root) throw new Error('缺少 PCMS_FIREBASE_TOOLS_ROOT，無法載入本機 Firebase 模擬器套件。');
  const require=createRequire(import.meta.url);
  const resolved=require.resolve(name,{paths:[path.join(root,'node_modules')]});
  return require(resolved);
}
export function createFirestoreRepository(database,firestoreApi){
  const {collection,getDocs,doc,getDoc,writeBatch}=firestoreApi;
  return {
    async list(name){ const snapshot=await getDocs(collection(database,name));return snapshot.docs.map(item=>({id:item.id,...item.data()})).sort((a,b)=>a.id.localeCompare(b.id)); },
    async get(name,id){ const snapshot=await getDoc(doc(database,name,text(id)));return snapshot.exists()?snapshot.data():null; },
    async commit(writes){
      if(writes.length>500) throw new Error('單批寫入超過 Firebase 上限。');
      const batch=writeBatch(database);writes.forEach(write=>batch.set(doc(database,write.collection,text(write.id)),clone(write.data),write.merge?{merge:true}:undefined));
      await batch.commit();
    }
  };
}
export async function withEmulatorRepository(callback,options={}){
  const emulatorHost=text(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId=text(options.projectId||process.env.GCLOUD_PROJECT||process.env.FIREBASE_PROJECT_ID||'demo-pcms-product-master-migration');
  if(!emulatorHost||!projectId.startsWith('demo-')) throw new Error('本工具只允許連線 demo 專案的 Firestore Emulator（本機模擬器）。');
  const [host,portText]=emulatorHost.split(':');
  const testing=loadDependency('@firebase/rules-unit-testing'),firestoreApi=loadDependency('firebase/firestore');
  const environment=await testing.initializeTestEnvironment({projectId,firestore:{host,port:Number(portText)||8080}});
  try{
    if(options.clear===true) await environment.clearFirestore();
    return await environment.withSecurityRulesDisabled(context=>callback(createFirestoreRepository(context.firestore(),firestoreApi),environment));
  }finally{ await environment.cleanup(); }
}

export function parseCliArguments(argv=process.argv.slice(2)){
  const result={};
  for(let index=0;index<argv.length;index+=1){
    const raw=argv[index];if(!raw.startsWith('--')) continue;
    const [key,inline]=raw.slice(2).split('=',2);
    if(inline!==undefined) result[key]=inline;
    else if(argv[index+1]&&!argv[index+1].startsWith('--')) result[key]=argv[++index];
    else result[key]=true;
  }
  return result;
}
export function printJson(value){ process.stdout.write(`${JSON.stringify(value,null,2)}\n`); }
