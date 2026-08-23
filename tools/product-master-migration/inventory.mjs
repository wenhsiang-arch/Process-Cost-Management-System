// inventory（只讀盤點）：只連本機模擬器並列出來源集合數量與舊／新架構分布。
import {inventoryRepository,parseCliArguments,printJson,withEmulatorRepository} from './shared.mjs';

export async function runInventory(repository){
  const {source:ignored,report}=await inventoryRepository(repository);
  return report;
}

if(import.meta.url===new URL(process.argv[1],`file://${process.cwd()}/`).href){
  const args=parseCliArguments();
  await withEmulatorRepository(async repository=>printJson(await runInventory(repository)),{projectId:args.project});
}
