// formal-apply（正式轉換套用）：只使用已驗證的本機快照，並以 updateTime（最後更新時間）阻止覆寫擷取後的異動。
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  MIGRATION_COLLECTIONS,applyMigrationPlan,assertMigrationPlanIntegrity,clone,
  migrationWritePath,parseCliArguments,printJson,text
} from './shared.mjs';
import {
  FORMAL_DATABASE_ID,FORMAL_MAINTENANCE_CONFIRMATION,FORMAL_MAINTENANCE_ROLES,FORMAL_PROJECT_ID,
  FORMAL_WRITE_CONFIRMATION,assertFormalMaintenance,createFormalFirestoreClient,decodeFirestoreDocument,
  encodeFirestoreFields,verifyFormalSnapshot
} from './formal-capture.mjs';

function documentResourceName(client,write){
  const collection=text(write.collection),id=text(write.id);
  if(!collection||!id||collection.includes('/')||id.includes('/')) throw new Error('正式寫入文件路徑不正確。');
  return `projects/${client.projectId}/databases/${client.databaseId}/documents/${collection}/${id}`;
}
function updateMaskFieldPath(value){
  const field=text(value);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(field)?field:`\`${field.replace(/\\/g,'\\\\').replace(/`/g,'\\`')}\``;
}
function restPrecondition(condition,pathValue){
  if(condition?.exists===false) return {exists:false};
  if(condition?.exists===true&&text(condition.updateTime)) return {updateTime:text(condition.updateTime)};
  throw new Error(`${pathValue} 缺少可執行的 updateTime（最後更新時間）前置條件。`);
}
function restWrite(client,write,condition){
  const pathValue=migrationWritePath(write),result={update:{name:documentResourceName(client,write),fields:encodeFirestoreFields(write.data)},
    currentDocument:restPrecondition(condition,pathValue)};
  if(write.merge===true) result.updateMask={fieldPaths:Object.keys(write.data||{}).map(updateMaskFieldPath)};
  return result;
}

export function createFormalMigrationRepository(client,envelope){
  const plan=envelope?.plan;assertMigrationPlanIntegrity(plan);
  const original=clone(envelope.preconditions||{}),current=new Map();
  function expected(write){ return current.get(migrationWritePath(write))||original[migrationWritePath(write)]; }
  return {
    async list(){ throw new Error('Formal Apply（正式套用）禁止重新完整讀取正式來源。'); },
    async get(collection,id){
      const pathValue=`${text(collection)}/${text(id)}`,condition=current.get(pathValue)||original[pathValue];
      if(!condition) throw new Error(`${pathValue} 不在已驗證的 Migration Plan（資料轉換計畫）內。`);
      const raw=await client.getDocument(collection,id);
      if(!raw){
        if(condition.exists===true) throw new Error(`${pathValue} 在擷取後被刪除，已停止正式轉換。`);
        return null;
      }
      const data=decodeFirestoreDocument(raw);
      const resumableRun=collection===MIGRATION_COLLECTIONS.runs&&data.planHash===plan.planHash
        &&['running','resuming','interrupted'].includes(text(data.status));
      if(condition.exists===false&&!resumableRun) throw new Error(`${pathValue} 在擷取後被新增，已停止正式轉換。`);
      if(condition.exists===true&&condition.updateTime!==text(raw.updateTime)){
        throw new Error(`${pathValue} 在擷取後已變更，已停止正式轉換。`);
      }
      current.set(pathValue,{exists:true,updateTime:text(raw.updateTime)});
      return data;
    },
    async commit(writes){
      if(!Array.isArray(writes)||!writes.length||writes.length>500) throw new Error('正式批次寫入數量不正確。');
      const restWrites=writes.map(write=>{
        const condition=expected(write);
        if(!condition) throw new Error(`${migrationWritePath(write)} 缺少已驗證的寫入前置條件。`);
        return restWrite(client,write,condition);
      });
      const response=await client.commit(restWrites),results=response.writeResults||[];
      if(results.length!==writes.length) throw new Error('正式批次回傳的寫入結果數量不一致。');
      writes.forEach((write,index)=>{
        const updateTime=text(results[index]?.updateTime);
        if(!updateTime) throw new Error(`${migrationWritePath(write)} 缺少正式寫入時間。`);
        current.set(migrationWritePath(write),{exists:true,updateTime});
      });
    }
  };
}

export async function applyFormalSnapshot(client,snapshotDirectory,options={}){
  if(client.projectId!==FORMAL_PROJECT_ID||text(options.confirmProject)!==FORMAL_PROJECT_ID){
    throw new Error('正式寫入專案未再次確認。');
  }
  if(text(options.confirmWrite)!==FORMAL_WRITE_CONFIRMATION) throw new Error('缺少正式 Migration（資料轉換）寫入確認。');
  if(text(options.exclusiveAdminConfirmation)!==FORMAL_MAINTENANCE_CONFIRMATION){
    throw new Error('尚未確認正式寫入期間沒有使用者或其他管理員操作。');
  }
  const verified=verifyFormalSnapshot(snapshotDirectory),{manifest,envelope}=verified,plan=envelope.plan;
  if(manifest.projectId!==client.projectId||text(options.confirmPlanHash)!==manifest.planHash){
    throw new Error('正式 Migration Plan Hash（資料轉換計畫雜湊）未再次確認。');
  }
  const currentRoles=await client.listCollection('rolePermissions');
  const maintenance=assertFormalMaintenance(currentRoles,{exclusiveAdminConfirmation:options.exclusiveAdminConfirmation});
  const changedRoles=FORMAL_MAINTENANCE_ROLES.filter(role=>maintenance[role]?.updateTime!==envelope.maintenanceRoles?.[role]?.updateTime);
  if(changedRoles.length) throw new Error(`Maintenance（維護狀態）在擷取後曾變更：${changedRoles.join(', ')}`);
  const repository=createFormalMigrationRepository(client,envelope);
  const result=await applyMigrationPlan(repository,plan,{batchSize:options.batchSize,onProgress:options.onProgress,
    sourceHash:manifest.sourceHash,sourceDocumentCount:manifest.sourceDocumentCount});
  return {...result,projectId:manifest.projectId,sourceHash:manifest.sourceHash,planHash:manifest.planHash,
    sourceDocumentCount:manifest.sourceDocumentCount,writeCount:manifest.writeCount,exceptionCount:manifest.exceptionCount};
}

async function runCli(){
  const args=parseCliArguments(),projectId=text(args.project);
  if(projectId!==FORMAL_PROJECT_ID||text(args['confirm-project'])!==FORMAL_PROJECT_ID){
    throw new Error('必須明確指定並再次確認正式專案。');
  }
  const client=createFormalFirestoreClient({credentialPath:args.credential,projectId,databaseId:FORMAL_DATABASE_ID});
  const result=await applyFormalSnapshot(client,path.resolve(text(args.snapshot)),{
    confirmProject:args['confirm-project'],confirmPlanHash:args['confirm-plan-hash'],confirmWrite:args['confirm-write'],
    exclusiveAdminConfirmation:args['confirm-exclusive-admin'],batchSize:Number(args['batch-size']),
    onProgress:progress=>printJson({status:'running',...progress})
  });
  printJson({ok:true,...result});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runCli().catch(error=>{ printJson({ok:false,error:text(error?.message)});process.exitCode=1; });
}
