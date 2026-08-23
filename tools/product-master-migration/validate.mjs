// validate（轉換驗證）：核對固定身分、訂單關聯、累計數量及未鎖定摘要沒有主檔快照。
import {parseCliArguments,printJson,validateRepository,withEmulatorRepository} from './shared.mjs';

export async function runValidation(repository,options={}){ return validateRepository(repository,options); }

if(import.meta.url===new URL(process.argv[1],`file://${process.cwd()}/`).href){
  const args=parseCliArguments();
  await withEmulatorRepository(async repository=>{
    const result=await runValidation(repository,{runId:args['run-id']});printJson(result);
    if(!result.ok) process.exitCode=2;
  },{projectId:args.project});
}
