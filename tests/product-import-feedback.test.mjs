import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');

function loadResolver(){
  const context={window:{},TextEncoder,console};
  vm.createContext(context);
  vm.runInContext(read('js/product-model.js'),context);
  vm.runInContext(read('js/product-resolver.js'),context);
  return context.window;
}

test('款號主檔工序缺少固定識別碼時指出款號、工序號與名稱',()=>{
  const window=loadResolver();
  const productId=window.PCMSProductModel.deterministicLegacyId('product','missing-process-id-product');
  assert.throws(()=>window.PCMSProductResolver.buildCatalog([{
    productId,
    code:'HA3104-BN',
    client:'HA',
    zh:'測試款號',
    vi:'Mã thử nghiệm',
    sz:'M',
    ops:[{no:'11',category:'DG',zh:'包裝',vi:'Đóng gói',sec:25}]
  }]),error=>{
    assert.match(error.message,/Dữ liệu mã hàng hiện có > Mã hàng HA3104-BN > Công đoạn số 11 “Đóng gói”/);
    assert.match(error.message,/目前款號資料 > 款號 HA3104-BN > 工序 11「包裝」/);
    assert.match(error.message,/缺少工序固定識別碼/);
    return true;
  });
});

test('款號匯入提示視窗使用可視畫面置中規則',()=>{
  const css=read('styles/features/products.css');
  assert.match(css,/#m-detail-import\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?align-items:\s*center;/);
  assert.match(css,/#m-detail-import \.md\s*\{[\s\S]*?max-height:\s*calc\(100vh/);
});
