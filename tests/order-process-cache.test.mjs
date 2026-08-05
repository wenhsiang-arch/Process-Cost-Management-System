import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const records=new Map(); // records（測試用快取資料）
const dataCache={
  async read(scope,version){
    const record=records.get(scope);
    return record&&record.version===String(version)?record.data:null;
  },
  async write(scope,version,data){ records.set(scope,{version:String(version),data}); return true; },
  async remove(scope){ records.delete(scope); }
};
const source=fs.readFileSync(new URL('../js/order-process-cache.js',import.meta.url),'utf8');
const context={window:{pcmsDataCache:dataCache},encodeURIComponent};
vm.createContext(context);
vm.runInContext(source,context);
const cache=context.window.PCMSOrderProcessCache; // cache（訂單工序快取工具）

test('訂單工序快取依訂單與版本隔離',async()=>{
  await cache.write('ORDER-A','v1',[{id:'1',orderId:'ORDER-A',code:'A'}]);
  assert.equal((await cache.read('ORDER-A','v1')).length,1);
  assert.equal(await cache.read('ORDER-A','v2'),null);
  assert.equal(await cache.read('ORDER-B','v1'),null);
});

test('只取代指定訂單的工序',()=>{
  const result=cache.replace(
    [{id:'1',orderId:'ORDER-A'},{id:'2',orderId:'ORDER-B'}],
    'ORDER-A',
    [{id:'3',orderId:'ORDER-A'}]
  );
  assert.deepEqual(Array.from(result,item=>item.id).sort(),['2','3']);
});
