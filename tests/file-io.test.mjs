import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url); // root（專案根目錄）
const source=fs.readFileSync(new URL('js/file-io.js',root),'utf8'); // source（檔案儲存共用程式內容）

function createFileIo(picker){
  const window={};
  if(picker) window.showSaveFilePicker=picker;
  const context={window,Blob};
  vm.createContext(context);
  vm.runInContext(source,context);
  return window.PCMSFileIO;
}

test('瀏覽器不支援儲存位置時停止並顯示提示',async()=>{
  const fileIo=createFileIo();
  let notices=0;
  const result=await fileIo.chooseSaveHandle({
    suggestedName:'test.xlsx',
    onUnsupported:()=>{ notices+=1; }
  });
  assert.equal(result,null);
  assert.equal(notices,1);
});
test('使用者取消儲存位置時不建立檔案',async()=>{
  const error=new Error('cancel');
  error.name='AbortError';
  const fileIo=createFileIo(async()=>{ throw error; });
  let notices=0;
  const result=await fileIo.chooseSaveHandle({onUnsupported:()=>{ notices+=1; }});
  assert.equal(result,null);
  assert.equal(notices,0);
});

test('寫入成功時關閉檔案且不執行中止',async()=>{
  const fileIo=createFileIo();
  const calls=[];
  const handle={createWritable:async()=>({
    write:async value=>{ calls.push(['write',value]); },
    close:async()=>{ calls.push(['close']); },
    abort:async()=>{ calls.push(['abort']); }
  })};
  await fileIo.writeToHandle(handle,'complete-file');
  assert.deepEqual(calls,[['write','complete-file'],['close']]);
});

test('寫入失敗時中止未完成檔案',async()=>{
  const fileIo=createFileIo();
  const calls=[];
  const handle={createWritable:async()=>({
    write:async()=>{ calls.push('write'); throw new Error('write failed'); },
    close:async()=>{ calls.push('close'); },
    abort:async()=>{ calls.push('abort'); }
  })};
  await assert.rejects(()=>fileIo.writeToHandle(handle,'broken-file'),/write failed/);
  assert.deepEqual(calls,['write','abort']);
});
