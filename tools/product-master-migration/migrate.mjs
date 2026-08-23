// migrate（一次性轉換）：分批補齊固定身分、訂單項目關聯與原始摘要；不複製主檔顯示快照。
import {applyMigrationPlan,buildMigrationPlan,inventoryRepository,parseCliArguments,printJson,withEmulatorRepository} from './shared.mjs';

export async function runMigration(repository,options={}){
  const inventory=await inventoryRepository(repository);
  const plan=buildMigrationPlan(inventory.source,options);
  const result=await applyMigrationPlan(repository,plan,options);
  return {...result,planHash:plan.planHash,manifest:plan.manifest,exceptions:plan.exceptions};
}

if(import.meta.url===new URL(process.argv[1],`file://${process.cwd()}/`).href){
  const args=parseCliArguments();
  const options={runId:args['run-id'],batchSize:Number(args['batch-size']),failAfterBatches:Number(args['fail-after-batches'])};
  await withEmulatorRepository(async repository=>printJson(await runMigration(repository,options)),{projectId:args.project});
}
