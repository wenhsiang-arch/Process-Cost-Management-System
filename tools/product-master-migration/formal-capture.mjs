// formal-capture（正式來源擷取）：在維護狀態下只讀一次正式來源，同步保存 Before Image（修改前副本）與轉換計畫。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {
  MIGRATION_VERSION,SOURCE_COLLECTIONS,assertMigrationPlanIntegrity,buildMigrationPlan,
  migrationWritePath,parseCliArguments,printJson,stableHash,text
} from './shared.mjs';

export const FORMAL_PROJECT_ID='process-cost-management-system';
export const FORMAL_DATABASE_ID='(default)';
export const FORMAL_SNAPSHOT_FORMAT_VERSION=1;
export const FORMAL_MAINTENANCE_CONFIRMATION='NO_USER_OR_ADMIN_WRITES';
export const FORMAL_WRITE_CONFIRMATION='MIGRATE_PRODUCT_MASTER_V2';
export const FORMAL_MAINTENANCE_ROLES=Object.freeze([
  'manager','clerk','productionDevelopment','productionControl','sales'
]);
export const FORMAL_CAPTURE_COLLECTIONS=Object.freeze([...new Set([
  ...SOURCE_COLLECTIONS,
  'orderImportLocks','rolePermissions',
  'performanceBonusMonths','performanceBonusPrivateMonths','performanceBonusSnapshots',
  'performanceBonusSnapshotChunks','performanceBonusAdjustments'
])]);

function safeObject(value){ return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; }
function safeFileName(value){
  const result=text(value).replace(/[^A-Za-z0-9_.-]/g,'_');
  if(!result) throw new Error('無法建立安全的備份檔名。');
  return result;
}
function normalizeRawDocument(value){
  const raw=safeObject(value);
  return {name:text(raw.name),createTime:text(raw.createTime),updateTime:text(raw.updateTime),fields:safeObject(raw.fields)};
}
function documentIdFromName(name){ return text(name).split('/').filter(Boolean).at(-1)||''; }
function documentPathFromName(name){
  const marker='/documents/',value=text(name),index=value.indexOf(marker);
  return index>=0?value.slice(index+marker.length):'';
}
function sha256Buffer(value){ return crypto.createHash('sha256').update(value).digest('hex'); }
function fileSha256(filePath){ return sha256Buffer(fs.readFileSync(filePath)); }
function json(value){ return `${JSON.stringify(value,null,2)}\n`; }
function ensureNewDirectory(directory){
  const resolved=path.resolve(directory);
  if(fs.existsSync(resolved)) throw new Error(`備份目錄已存在，禁止覆蓋：${resolved}`);
  fs.mkdirSync(resolved,{recursive:true});
  return resolved;
}
function writeAtomic(filePath,content){
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  const partial=`${filePath}.partial`;
  if(fs.existsSync(partial)) throw new Error(`發現未完成暫存檔，請先人工確認：${partial}`);
  fs.writeFileSync(partial,content,{encoding:'utf8',flag:'wx'});
  fs.renameSync(partial,filePath);
}
function relativeManifestPath(root,filePath){ return path.relative(root,filePath).split(path.sep).join('/'); }
function readJson(filePath){ return JSON.parse(fs.readFileSync(filePath,'utf8')); }
function readJsonLines(filePath){
  const content=fs.readFileSync(filePath,'utf8').trim();
  return content?content.split(/\r?\n/).map(line=>JSON.parse(line)):[];
}

export function decodeFirestoreValue(value){
  const field=safeObject(value);
  if('nullValue' in field) return null;
  if('booleanValue' in field) return field.booleanValue===true;
  if('integerValue' in field){
    const parsed=Number(field.integerValue);
    return Number.isSafeInteger(parsed)?parsed:text(field.integerValue);
  }
  if('doubleValue' in field) return Number(field.doubleValue);
  if('timestampValue' in field) return text(field.timestampValue);
  if('stringValue' in field) return String(field.stringValue??'');
  if('bytesValue' in field) return String(field.bytesValue??'');
  if('referenceValue' in field) return String(field.referenceValue??'');
  if('geoPointValue' in field) return {...safeObject(field.geoPointValue)};
  if('arrayValue' in field) return (field.arrayValue?.values||[]).map(decodeFirestoreValue);
  if('mapValue' in field) return decodeFirestoreFields(field.mapValue?.fields||{});
  return null;
}

export function decodeFirestoreFields(fields={}){
  return Object.fromEntries(Object.entries(safeObject(fields)).map(([key,value])=>[key,decodeFirestoreValue(value)]));
}

export function decodeFirestoreDocument(raw){
  const value=normalizeRawDocument(raw),id=documentIdFromName(value.name);
  if(!id) throw new Error('Firestore（雲端資料庫）文件缺少識別碼。');
  return {id,...decodeFirestoreFields(value.fields)};
}

export function encodeFirestoreValue(value){
  if(value===null) return {nullValue:null};
  if(typeof value==='boolean') return {booleanValue:value};
  if(typeof value==='number'){
    if(Number.isSafeInteger(value)) return {integerValue:String(value)};
    if(Number.isNaN(value)) return {doubleValue:'NaN'};
    if(value===Infinity) return {doubleValue:'Infinity'};
    if(value===-Infinity) return {doubleValue:'-Infinity'};
    return {doubleValue:value};
  }
  if(typeof value==='string') return {stringValue:value};
  if(Array.isArray(value)) return {arrayValue:{values:value.map(encodeFirestoreValue)}};
  if(value&&typeof value==='object') return {mapValue:{fields:encodeFirestoreFields(value)}};
  throw new Error(`不支援的 Firestore（雲端資料庫）欄位型別：${typeof value}`);
}

export function encodeFirestoreFields(value={}){
  return Object.fromEntries(Object.entries(safeObject(value))
    .filter(([,item])=>item!==undefined).map(([key,item])=>[key,encodeFirestoreValue(item)]));
}

function base64url(value){ return Buffer.from(value).toString('base64url'); }
function validateCredential(key,projectId){
  if(key?.type!=='service_account'||!text(key.private_key)||!text(key.client_email)){
    throw new Error('Service Account（服務帳戶）憑證格式不正確。');
  }
  if(text(key.project_id)!==projectId) throw new Error('Service Account（服務帳戶）所屬專案不正確。');
}

export function createFormalFirestoreClient(options={}){
  const credentialPath=path.resolve(text(options.credentialPath));
  const projectId=text(options.projectId)||FORMAL_PROJECT_ID,databaseId=text(options.databaseId)||FORMAL_DATABASE_ID;
  if(!credentialPath||!fs.existsSync(credentialPath)) throw new Error('找不到 Service Account（服務帳戶）憑證。');
  const key=readJson(credentialPath);validateCredential(key,projectId);
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  if(typeof fetchImpl!=='function') throw new Error('目前 Node.js（執行環境）不支援安全網路請求。');
  let cachedToken='',expiresAt=0;
  async function accessToken(){
    if(cachedToken&&Date.now()<expiresAt-60000) return cachedToken;
    const now=Math.floor(Date.now()/1000),header=base64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const payload=base64url(JSON.stringify({iss:key.client_email,scope:'https://www.googleapis.com/auth/datastore',
      aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
    const unsigned=`${header}.${payload}`;
    const signature=crypto.sign('RSA-SHA256',Buffer.from(unsigned),key.private_key).toString('base64url');
    const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
        grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`
      })});
    if(!response.ok) throw new Error(`Service Account（服務帳戶）驗證失敗（HTTP ${response.status}）。`);
    const body=await response.json();cachedToken=text(body.access_token);expiresAt=Date.now()+Number(body.expires_in||3600)*1000;
    if(!cachedToken) throw new Error('Service Account（服務帳戶）沒有取得存取權杖。');
    return cachedToken;
  }
  const root=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents`;
  async function request(url,requestOptions={}){
    const token=await accessToken(),response=await fetchImpl(url,{...requestOptions,
      headers:{authorization:`Bearer ${token}`,...requestOptions.headers}});
    return response;
  }
  return {
    projectId,databaseId,
    async listCollection(collectionId){
      const documents=[],seenTokens=new Set();let pageToken='';
      do{
        const url=new URL(`${root}/${encodeURIComponent(text(collectionId))}`);url.searchParams.set('pageSize','1000');
        if(pageToken) url.searchParams.set('pageToken',pageToken);
        const response=await request(url);
        if(!response.ok) throw new Error(`${collectionId} 正式唯讀擷取失敗（HTTP ${response.status}）。`);
        const body=await response.json();documents.push(...(body.documents||[]).map(normalizeRawDocument));
        pageToken=text(body.nextPageToken);
        if(pageToken&&seenTokens.has(pageToken)) throw new Error(`${collectionId} 的分頁權杖重複，已停止擷取。`);
        if(pageToken) seenTokens.add(pageToken);
      }while(pageToken);
      return documents.sort((left,right)=>left.name.localeCompare(right.name));
    },
    async getDocument(collectionId,documentId){
      const response=await request(`${root}/${encodeURIComponent(text(collectionId))}/${encodeURIComponent(text(documentId))}`);
      if(response.status===404) return null;
      if(!response.ok) throw new Error(`${collectionId}/${documentId} 正式唯讀擷取失敗（HTTP ${response.status}）。`);
      return normalizeRawDocument(await response.json());
    },
    async findDocumentsByIds(collectionId,documentIds){
      const ids=[...new Set((documentIds||[]).map(text).filter(Boolean))].sort(),documents=[];let estimatedReads=0;
      for(let index=0;index<ids.length;index+=30){
        const values=ids.slice(index,index+30).map(id=>({referenceValue:`projects/${projectId}/databases/${databaseId}/documents/${collectionId}/${id}`}));
        const response=await request(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:runQuery`,{
          method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId}],where:{fieldFilter:{
            field:{fieldPath:'__name__'},op:'IN',value:{arrayValue:{values}}
          }}}})
        });
        if(!response.ok) throw new Error(`${collectionId} 目標文件唯讀預檢失敗（HTTP ${response.status}）。`);
        const body=await response.json(),matches=(Array.isArray(body)?body:[body]).map(item=>item?.document).filter(Boolean).map(normalizeRawDocument);
        documents.push(...matches);estimatedReads+=Math.max(1,matches.length);
      }
      return {documents:documents.sort((left,right)=>left.name.localeCompare(right.name)),estimatedReads};
    },
    async commit(restWrites){
      const response=await request(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:commit`,{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({writes:restWrites})
      });
      if(!response.ok) throw new Error(`正式 Migration（資料轉換）批次寫入失敗（HTTP ${response.status}）。`);
      return response.json();
    }
  };
}

export function assertFormalMaintenance(roleDocuments,options={}){
  if(options.exclusiveAdminConfirmation!==FORMAL_MAINTENANCE_CONFIRMATION){
    throw new Error('尚未確認維護期間沒有使用者或其他管理員寫入。');
  }
  const byId=new Map((roleDocuments||[]).map(raw=>[documentIdFromName(raw.name),decodeFirestoreDocument(raw)]));
  const invalid=FORMAL_MAINTENANCE_ROLES.filter(role=>{
    const value=byId.get(role);return !value||value.role!==role||value.active!==false;
  });
  if(invalid.length) throw new Error(`Maintenance（維護模式）尚未完整生效：${invalid.join(', ')}`);
  return Object.fromEntries(FORMAL_MAINTENANCE_ROLES.map(role=>{
    const raw=(roleDocuments||[]).find(item=>documentIdFromName(item.name)===role);
    return [role,{active:false,updateTime:text(raw?.updateTime)}];
  }));
}

function writeCollectionSnapshot(root,collectionName,documents){
  const filePath=path.join(root,'before-image',`${safeFileName(collectionName)}.jsonl`);
  const content=documents.length?`${documents.map(item=>JSON.stringify(normalizeRawDocument(item))).join('\n')}\n`:'';
  writeAtomic(filePath,content);
  return {file:relativeManifestPath(root,filePath),count:documents.length,sha256:fileSha256(filePath)};
}
function capturedDocumentDescriptor(root,file,raw){
  return {exists:true,updateTime:text(raw.updateTime),beforeImageFile:relativeManifestPath(root,file),documentHash:stableHash(normalizeRawDocument(raw))};
}
function snapshotSourceHash(collections,targetCollections,pointDocuments){
  return stableHash({collections:Object.fromEntries(Object.entries(collections).sort(([left],[right])=>left.localeCompare(right))
    .map(([name,value])=>[name,{count:value.count,sha256:value.sha256}])),
  targetCollections:Object.fromEntries(Object.entries(targetCollections).sort(([left],[right])=>left.localeCompare(right))
    .map(([name,value])=>[name,{requestedCount:value.requestedCount,count:value.count,sha256:value.sha256}])),
  pointDocuments:Object.fromEntries(Object.entries(pointDocuments).sort(([left],[right])=>left.localeCompare(right))
    .map(([name,value])=>[name,{exists:value.exists,sha256:value.sha256||''}]))});
}

export async function captureFormalSnapshot(client,options={}){
  const projectId=text(options.projectId)||client.projectId,databaseId=text(options.databaseId)||client.databaseId;
  if(projectId!==FORMAL_PROJECT_ID||client.projectId!==projectId) throw new Error('正式來源專案確認不一致。');
  const roleDocuments=await client.listCollection('rolePermissions');
  const maintenanceRoles=assertFormalMaintenance(roleDocuments,{exclusiveAdminConfirmation:options.exclusiveAdminConfirmation});
  const outputDirectory=ensureNewDirectory(options.outputDirectory),capturedAt=Number(options.now)||Date.now();
  const collectionReports={},capturedByPath=new Map(),decodedByCollection={},source={};
  for(const collectionName of FORMAL_CAPTURE_COLLECTIONS){
    const documents=collectionName==='rolePermissions'?roleDocuments:await client.listCollection(collectionName);
    const report=writeCollectionSnapshot(outputDirectory,collectionName,documents);collectionReports[collectionName]=report;
    const filePath=path.join(outputDirectory,...report.file.split('/'));
    documents.forEach(raw=>{
      const documentPath=documentPathFromName(raw.name);
      if(!documentPath) throw new Error(`${collectionName} 含無效文件路徑。`);
      capturedByPath.set(documentPath,{raw,filePath});
    });
    decodedByCollection[collectionName]=documents.map(decodeFirestoreDocument);
    if(SOURCE_COLLECTIONS.includes(collectionName)) source[collectionName]=decodedByCollection[collectionName];
  }
  const pointDocuments={};
  const productsMeta=await client.getDocument('system','productsMeta');
  const productsMetaFile=path.join(outputDirectory,'before-image','system__productsMeta.json');
  writeAtomic(productsMetaFile,json(productsMeta?normalizeRawDocument(productsMeta):null));
  pointDocuments['system/productsMeta']={file:relativeManifestPath(outputDirectory,productsMetaFile),exists:!!productsMeta,
    sha256:fileSha256(productsMetaFile),updateTime:text(productsMeta?.updateTime)};
  if(productsMeta) capturedByPath.set('system/productsMeta',{raw:productsMeta,filePath:productsMetaFile});

  const lockedMonths=(decodedByCollection.performanceBonusMonths||[]).filter(row=>['locked','exported','paid'].includes(text(row.status)));
  if(lockedMonths.length) throw new Error(`發現 ${lockedMonths.length} 個已鎖定、已匯出或已付款月份，禁止按未鎖定資料轉換。`);
  const plan=buildMigrationPlan(source,{now:capturedAt,actorUid:'migration-tool',actorName:'資料轉換工具'});
  assertMigrationPlanIntegrity(plan);
  const controlWrites=[
    {collection:'productMasterMigrationRuns',id:plan.runId},
    {collection:'operationLogs',id:`${plan.runId}__complete`}
  ];
  const allPlannedWrites=[...plan.writes,...controlWrites],unknownByCollection=new Map(),targetCollectionReports={};
  allPlannedWrites.forEach(write=>{
    const writePath=migrationWritePath(write),captured=capturedByPath.get(writePath),collectionName=text(write.collection);
    if(captured||collectionReports[collectionName]) return; // 已完整擷取的 Collection（資料集合）可直接判定該 ID 當時不存在。
    const ids=unknownByCollection.get(collectionName)||new Set();ids.add(text(write.id));unknownByCollection.set(collectionName,ids);
  });
  let targetLookupReads=0;
  for(const [collectionName,ids] of unknownByCollection){
    const lookup=await client.findDocumentsByIds(collectionName,[...ids]);targetLookupReads+=Number(lookup.estimatedReads)||0;
    const report=writeCollectionSnapshot(outputDirectory,`targets__${collectionName}`,lookup.documents);
    targetCollectionReports[collectionName]={...report,requestedCount:ids.size,estimatedDocumentReads:Number(lookup.estimatedReads)||0};
    const filePath=path.join(outputDirectory,...report.file.split('/'));
    lookup.documents.forEach(raw=>{
      const writePath=documentPathFromName(raw.name);
      if(!ids.has(documentIdFromName(raw.name))) throw new Error(`${collectionName} 目標唯讀預檢回傳未要求的文件。`);
      capturedByPath.set(writePath,{raw,filePath});
    });
  }
  const preconditions={};
  allPlannedWrites.forEach(write=>{
    const writePath=migrationWritePath(write),captured=capturedByPath.get(writePath);
    if(captured) preconditions[writePath]=capturedDocumentDescriptor(outputDirectory,captured.filePath,captured.raw);
    else{
      if(write.merge===true) throw new Error(`Merge（合併更新）缺少修改前副本：${writePath}`);
      preconditions[writePath]={exists:false};
    }
  });
  const sourceHash=snapshotSourceHash(collectionReports,targetCollectionReports,pointDocuments),preconditionsHash=stableHash(preconditions);
  const envelope={kind:'pcms-product-master-migration-plan',formatVersion:FORMAL_SNAPSHOT_FORMAT_VERSION,
    projectId,databaseId,migrationVersion:MIGRATION_VERSION,capturedAt,capturedAtIso:new Date(capturedAt).toISOString(),
    sourceHash,preconditionsHash,maintenanceRoles,plan:{...plan,migrationVersion:MIGRATION_VERSION},preconditions};
  const planFile=path.join(outputDirectory,'migration-plan.json');writeAtomic(planFile,json(envelope));
  const exceptionFile=path.join(outputDirectory,'exception-report.json');writeAtomic(exceptionFile,json(plan.exceptions));
  const sourceDocumentCount=SOURCE_COLLECTIONS.reduce((sum,name)=>sum+(collectionReports[name]?.count||0),0);
  const capturedDocumentCount=Object.values(collectionReports).reduce((sum,item)=>sum+item.count,0)
    +Object.values(targetCollectionReports).reduce((sum,item)=>sum+item.count,0)+(productsMeta?1:0);
  const estimatedReads=Object.values(collectionReports).reduce((sum,item)=>sum+Math.max(1,item.count),0)+1+targetLookupReads;
  const manifest={kind:'pcms-product-master-before-image',formatVersion:FORMAL_SNAPSHOT_FORMAT_VERSION,
    projectId,databaseId,migrationVersion:MIGRATION_VERSION,runId:plan.runId,capturedAt,capturedAtIso:new Date(capturedAt).toISOString(),
    maintenanceRoles,sourceHash,preconditionsHash,planHash:plan.planHash,sourceDocumentCount,capturedDocumentCount,
    estimatedDocumentReads:estimatedReads,writeCount:plan.writes.length,exceptionCount:plan.exceptions.length,
    collections:collectionReports,targetCollections:targetCollectionReports,pointDocuments,
    planFile:{file:relativeManifestPath(outputDirectory,planFile),sha256:fileSha256(planFile)},
    exceptionFile:{file:relativeManifestPath(outputDirectory,exceptionFile),sha256:fileSha256(exceptionFile)}};
  const manifestFile=path.join(outputDirectory,'migration-manifest.json');writeAtomic(manifestFile,json(manifest));
  return {outputDirectory,manifest,envelope};
}

function resolveManifestFile(root,relativePath){
  const resolved=path.resolve(root,...text(relativePath).split('/'));
  const relative=path.relative(root,resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative)) throw new Error('Snapshot（快照）檔案路徑超出備份目錄。');
  return resolved;
}

export function verifyFormalSnapshot(snapshotDirectory){
  const root=path.resolve(snapshotDirectory),manifestPath=path.join(root,'migration-manifest.json');
  if(!fs.existsSync(manifestPath)) throw new Error('找不到 Migration Manifest（資料轉換清單）。');
  const manifest=readJson(manifestPath);
  if(manifest.kind!=='pcms-product-master-before-image'||manifest.formatVersion!==FORMAL_SNAPSHOT_FORMAT_VERSION){
    throw new Error('Migration Manifest（資料轉換清單）格式不正確。');
  }
  if(manifest.projectId!==FORMAL_PROJECT_ID||manifest.migrationVersion!==MIGRATION_VERSION){
    throw new Error('Migration Manifest（資料轉換清單）的專案或版本不正確。');
  }
  const beforeImages=new Map();
  for(const [collectionName,descriptor] of Object.entries({...manifest.collections,...manifest.targetCollections})){
    const filePath=resolveManifestFile(root,descriptor.file);
    if(!fs.existsSync(filePath)||fileSha256(filePath)!==descriptor.sha256) throw new Error(`${collectionName} Before Image（修改前副本）Hash 不一致。`);
    const rows=readJsonLines(filePath);
    if(rows.length!==descriptor.count) throw new Error(`${collectionName} Before Image（修改前副本）數量不一致。`);
    rows.forEach(raw=>beforeImages.set(documentPathFromName(raw.name),{raw:normalizeRawDocument(raw),file:descriptor.file}));
  }
  for(const [documentPath,descriptor] of Object.entries(manifest.pointDocuments||{})){
    const filePath=resolveManifestFile(root,descriptor.file);
    if(!fs.existsSync(filePath)||fileSha256(filePath)!==descriptor.sha256) throw new Error(`${documentPath} Before Image（修改前副本）Hash 不一致。`);
    const raw=readJson(filePath);
    if(descriptor.exists){
      if(!raw) throw new Error(`${documentPath} Before Image（修改前副本）遺失。`);
      beforeImages.set(documentPath,{raw:normalizeRawDocument(raw),file:descriptor.file});
    }else if(raw!==null) throw new Error(`${documentPath} Before Image（修改前副本）存在狀態不一致。`);
  }
  if(snapshotSourceHash(manifest.collections||{},manifest.targetCollections||{},manifest.pointDocuments||{})!==manifest.sourceHash){
    throw new Error('Before Image Source Hash（修改前副本來源雜湊）不一致。');
  }
  const planPath=resolveManifestFile(root,manifest.planFile?.file);
  if(!fs.existsSync(planPath)||fileSha256(planPath)!==manifest.planFile?.sha256) throw new Error('Migration Plan（資料轉換計畫）檔案 Hash 不一致。');
  const exceptionPath=resolveManifestFile(root,manifest.exceptionFile?.file);
  if(!fs.existsSync(exceptionPath)||fileSha256(exceptionPath)!==manifest.exceptionFile?.sha256) throw new Error('Exception Report（例外報告）檔案 Hash 不一致。');
  const envelope=readJson(planPath),plan=envelope.plan;
  assertMigrationPlanIntegrity(plan);
  if(envelope.projectId!==manifest.projectId||envelope.sourceHash!==manifest.sourceHash||plan.planHash!==manifest.planHash){
    throw new Error('Migration Plan（資料轉換計畫）與 Manifest（轉換清單）不一致。');
  }
  if(stableHash(envelope.preconditions)!==manifest.preconditionsHash) throw new Error('寫入前置條件 Hash（雜湊）不一致。');
  const verificationWrites=[...plan.writes,
    {collection:'productMasterMigrationRuns',id:plan.runId,merge:false},
    {collection:'operationLogs',id:`${plan.runId}__complete`,merge:false}
  ];
  const writePaths=new Set(verificationWrites.map(migrationWritePath));
  if(writePaths.size!==Object.keys(envelope.preconditions||{}).length) throw new Error('Migration Plan（資料轉換計畫）的前置條件數量不一致。');
  verificationWrites.forEach(write=>{
    const writePath=migrationWritePath(write),condition=envelope.preconditions?.[writePath];
    if(!condition||typeof condition.exists!=='boolean') throw new Error(`${writePath} 缺少寫入前置條件。`);
    const captured=beforeImages.get(writePath);
    if(condition.exists){
      if(!captured||condition.beforeImageFile!==captured.file||condition.updateTime!==captured.raw.updateTime
        ||condition.documentHash!==stableHash(captured.raw)) throw new Error(`${writePath} 的修改前副本關聯不一致。`);
    }else if(captured) throw new Error(`${writePath} 已存在，但轉換計畫要求建立新文件。`);
    if(write.merge===true&&condition.exists!==true) throw new Error(`${writePath} 的 Merge（合併更新）缺少既有文件保護。`);
  });
  return {root,manifest,envelope};
}

function defaultFormalOutputDirectory(){
  const profile=text(process.env.USERPROFILE);
  if(!profile) throw new Error('找不到使用者資料夾，請明確指定 --output。');
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  return path.join(profile,'PCMS-Formal-Backups','product-master-migration',stamp);
}
function assertApprovedOutputDirectory(outputDirectory){
  const profile=text(process.env.USERPROFILE);
  if(!profile) throw new Error('找不到使用者資料夾。');
  const approvedRoot=path.resolve(profile,'PCMS-Formal-Backups','product-master-migration'),resolved=path.resolve(outputDirectory);
  const relative=path.relative(approvedRoot,resolved);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)) throw new Error('正式備份輸出位置不在已核准的專用資料夾內。');
  return resolved;
}

async function runCli(){
  const args=parseCliArguments(),projectId=text(args.project);
  if(projectId!==FORMAL_PROJECT_ID||text(args['confirm-project'])!==FORMAL_PROJECT_ID){
    throw new Error('必須明確指定並再次確認正式專案。');
  }
  const exclusiveAdminConfirmation=text(args['confirm-exclusive-admin']);
  if(exclusiveAdminConfirmation!==FORMAL_MAINTENANCE_CONFIRMATION) throw new Error('尚未確認正式寫入已停止。');
  const outputDirectory=assertApprovedOutputDirectory(args.output||defaultFormalOutputDirectory());
  const client=createFormalFirestoreClient({credentialPath:args.credential,projectId});
  const result=await captureFormalSnapshot(client,{projectId,outputDirectory,exclusiveAdminConfirmation});
  printJson({ok:true,outputDirectory:result.outputDirectory,sourceDocumentCount:result.manifest.sourceDocumentCount,
    capturedDocumentCount:result.manifest.capturedDocumentCount,estimatedDocumentReads:result.manifest.estimatedDocumentReads,
    sourceHash:result.manifest.sourceHash,planHash:result.manifest.planHash,writeCount:result.manifest.writeCount,
    exceptionCount:result.manifest.exceptionCount});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runCli().catch(error=>{ printJson({ok:false,error:text(error?.message)});process.exitCode=1; });
}
