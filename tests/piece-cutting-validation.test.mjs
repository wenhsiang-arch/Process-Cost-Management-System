import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('js/piece-cutting.js',root),'utf8');
const serverSource=fs.readFileSync(new URL('local-piece-cutting-server.ps1',root),'utf8');
const styleSource=fs.readFileSync(new URL('styles/features/piece-cutting.css',root),'utf8');

function encodeCell({r,c}){
  let column='';
  for(let value=c+1;value>0;value=Math.floor((value-1)/26)) column=String.fromCharCode(65+((value-1)%26))+column;
  return `${column}${r+1}`;
}

function validation(){
  const XLSX={utils:{encode_cell:encodeCell,sheet_to_json:sheet=>sheet.rows}};
  const context={window:{},document:{},console,XLSX,File:function(){}};
  vm.createContext(context);
  vm.runInContext(source,context);
  return context.window.PCMSPieceCuttingValidation;
}

function workbook(){
  const rows=[
    ['MÃ HÀNG','SIZE','TÊN VẬT LIỆU','BỘ PHẬN CẮT','SỐ KIỆN','GHI CHÚ','HÌNH ẢNH'],
    ['HA-XS','XS','Vải nylon','Miếng trên',2,'',''],
    ['HA-S','S','','Miếng dưới',1,'ghi chú',''],
    ['','','Vải lưới','Miếng lưới',3,'','']
  ];
  const sheet={rows,'C2':{v:'Vải nylon'},'C4':{v:'Vải lưới'},'!merges':[
    {s:{r:1,c:2},e:{r:2,c:2}},
    {s:{r:1,c:6},e:{r:3,c:6}}
  ]};
  return {SheetNames:['Mẫu'],Sheets:{Mẫu:sheet}};
}

function secondSheet(code='HB-M',size='M',part='Miếng trên'){
  const rows=[
    ['MÃ HÀNG','SIZE','TÊN VẬT LIỆU','BỘ PHẬN CẮT','SỐ KIỆN','GHI CHÚ','HÌNH ẢNH'],
    [code,size,'Vải nylon',part,4,'','']
  ];
  return {rows,'C2':{v:'Vải nylon'},'!merges':[{s:{r:1,c:6},e:{r:1,c:6}}]};
}

test('固定 A 至 G 表頭、合併布料與圖片群組可正確辨識',()=>{
  const result=validation().analyzeTemplateWorkbook('mau.xlsx',workbook());
  assert.equal(result.productCount,2);
  assert.equal(result.sizeCount,2);
  assert.equal(result.materialCount,2);
  assert.equal(result.pieceCount,3);
  assert.equal(result.imageGroupCount,1);
  assert.deepEqual(Array.from(result.groups[0].products,item=>item.code),['HA-XS','HA-S']);
  assert.equal(result.groups[0].pieces[1].material,'Vải nylon');
});

test('圖片群組內款號空格不會沿用上一個款號',()=>{
  const result=validation().analyzeTemplateWorkbook('mau.xlsx',workbook());
  assert.equal(result.groups[0].products.length,2);
  assert.equal(result.groups[0].pieces.length,3);
  assert.equal(result.groups[0].products.some(item=>item.rowNumber===4),false);
});

test('同一圖片群組的不同款號依訂單數量乘以 SỐ KIỆN 後自動加總',()=>{
  const api=validation();
  const analysis={groups:[{
    key:'G2:G4',products:[{code:'HA-A',size:'S'},{code:'HA-B',size:'S'}],
    pieces:[{material:'Vải nylon',part:'Miếng thân',pieces:2,note:'',imageGroupKey:'G2:G4'}]
  }]};
  const result=api.buildExportModel(analysis,[{code:'HA-A',qty:10},{code:'HA-B',qty:20}],'PO#1');
  assert.equal(result.materials.length,1);
  assert.equal(result.materials[0].imageGroupKey,'G2:G4');
  assert.deepEqual(Array.from(result.materials[0].codes),['HA-A','HA-B']);
  assert.equal(result.materials[0].parts.length,1);
  assert.equal(result.materials[0].parts[0].quantities.S,60);
  assert.equal(result.totalPieces,60);
});

test('不同訂單的相同款號合併數量並保留訂單來源',()=>{
  const api=validation();
  const analysis={groups:[{
    key:'G2:G4',products:[{code:'HA-A',size:'S'}],
    pieces:[{material:'Vải nylon',part:'Miếng thân',pieces:2,note:'Cắt cùng chiều',imageGroupKey:'G2:G4'}]
  }]};
  const result=api.buildExportModel(analysis,[
    {code:'HA-A',qty:10,fileName:'PO-1.xlsx',orderLabel:'PO#1'},
    {code:'HA-A',qty:20,fileName:'PO-2.xlsx',orderLabel:'PO#2'}
  ],'PO#1 + PO#2');
  assert.equal(result.materials[0].parts[0].quantities.S,60);
  assert.equal(result.orderLabel,'PO#1 + PO#2');
  assert.equal(result.matched.length,2);
  assert.equal(result.materials[0].products[0].code,'HA-A');
});

test('備註保留款號、尺寸、裁片與內容，空白備註不建立明細',()=>{
  const api=validation();
  const analysis={groups:[{
    key:'G2:G4',products:[{code:'HA-A',size:'S'},{code:'HA-B',size:'M'}],pieces:[
      {material:'Vải nylon',part:'Miếng thân',pieces:1,note:'Cắt cùng chiều',imageGroupKey:'G2:G4'},
      {material:'Vải nylon',part:'Miếng lót',pieces:1,note:'',imageGroupKey:'G2:G4'}
    ]
  }]};
  const result=api.buildExportModel(analysis,[{code:'HA-A',qty:10},{code:'HA-B',qty:20}],'PO#1');
  const noted=result.materials[0].parts.find(part=>part.part==='Miếng thân');
  const blank=result.materials[0].parts.find(part=>part.part==='Miếng lót');
  assert.deepEqual(Array.from(noted.noteEntries,item=>[item.code,item.size,item.part,item.note]),[
    ['HA-A','S','Miếng thân','Cắt cùng chiều'],['HA-B','M','Miếng thân','Cắt cùng chiều']
  ]);
  assert.equal(blank.noteEntries.length,0);
});

test('相同布料但圖片群組不同時必須分成不同工作頁',()=>{
  const api=validation();
  const analysis={groups:[
    {key:'G2:G4',products:[{code:'HA-A',size:'S'}],pieces:[{material:'Vải nylon',part:'Miếng thân',pieces:1,note:'',imageGroupKey:'G2:G4'}]},
    {key:'G5:G7',products:[{code:'HB-A',size:'M'}],pieces:[{material:'Vải nylon',part:'Miếng thân',pieces:1,note:'',imageGroupKey:'G5:G7'}]}
  ]};
  const result=api.buildExportModel(analysis,[{code:'HA-A',qty:10},{code:'HB-A',qty:20}],'PO#2');
  assert.equal(result.materialCount,1);
  assert.equal(result.materialGroupCount,2);
  assert.deepEqual(Array.from(result.materials,item=>item.imageGroupKey),['G2:G4','G5:G7']);
  assert.equal(result.totalPieces,30);
});

test('同一圖片群組使用不同布料時仍各自分頁',()=>{
  const api=validation();
  const analysis={groups:[{
    key:'G2:G4',products:[{code:'HA-A',size:'S'}],pieces:[
      {material:'Vải nylon',part:'Miếng thân',pieces:1,note:'',imageGroupKey:'G2:G4'},
      {material:'EPE 5MM',part:'Miếng lót',pieces:2,note:'',imageGroupKey:'G2:G4'}
    ]
  }]};
  const result=api.buildExportModel(analysis,[{code:'HA-A',qty:10}],'PO#3');
  assert.equal(result.materialCount,2);
  assert.equal(result.materialGroupCount,2);
  assert.deepEqual(Array.from(result.materials,item=>item.imageGroupKey),['G2:G4','G2:G4']);
  assert.equal(result.totalPieces,30);
});

test('不同尺寸保持不同數量欄，訂單沒有的款號不輸出',()=>{
  const api=validation();
  const analysis={groups:[{
    key:'G2:G4',products:[{code:'HA-S',size:'S'},{code:'HA-M',size:'M'}],
    pieces:[{material:'Vải nylon',part:'Miếng thân',pieces:1,note:'',imageGroupKey:'G2:G4'}]
  }]};
  const result=api.buildExportModel(analysis,[{code:'HA-S',qty:15},{code:'NO-MASTER',qty:8}],'PO#2');
  assert.deepEqual(Array.from(result.materials[0].sizes),['S']);
  assert.equal(result.materials[0].parts[0].quantities.S,15);
  assert.deepEqual(Array.from(result.missing,item=>item.code),['NO-MASTER']);
});

test('缺少完整固定表頭時拒絕主檔',()=>{
  const book=workbook();
  book.Sheets.Mẫu.rows[0][3]='其他欄位';
  assert.throws(()=>validation().analyzeTemplateWorkbook('mau.xlsx',book),error=>{
    assert.match(error.issues.join('\n'),/找不到 A 至 G 七個固定表頭/);
    return true;
  });
});

test('主檔讀取全部非空白分頁並用分頁序號隔離圖片群組',()=>{
  const book=workbook();
  book.SheetNames.push('Khách B','空白');
  book.Sheets['Khách B']=secondSheet();
  book.Sheets['空白']={rows:[[],['','','']]};
  const result=validation().analyzeTemplateWorkbook('mau.xlsx',book);
  assert.deepEqual(Array.from(result.sheetNames),['Mẫu','Khách B']);
  assert.equal(result.productCount,3);
  assert.equal(result.pieceCount,4);
  assert.deepEqual(Array.from(result.groups,item=>item.key),['S1!G2:G4','S2!G2:G2']);
});

test('任一非空白分頁缺少固定表頭時拒絕整份主檔',()=>{
  const book=workbook();
  book.SheetNames.push('說明頁');
  book.Sheets['說明頁']={rows:[['這不是空白頁']]};
  assert.throws(()=>validation().analyzeTemplateWorkbook('mau.xlsx',book),error=>{
    assert.match(error.issues.join('\n'),/工作表「說明頁」：找不到 A 至 G 七個固定表頭/);
    return true;
  });
});

test('同一款號在相同或不同分頁重複都拒絕並顯示兩個位置',()=>{
  const book=workbook();
  book.SheetNames.push('Khách B');
  book.Sheets['Khách B']=secondSheet('HA-XS','XS');
  assert.throws(()=>validation().analyzeTemplateWorkbook('mau.xlsx',book),error=>{
    const details=error.issues.join('\n');
    assert.match(details,/款號 HA-XS/);
    assert.match(details,/工作表「Mẫu」第 2 列重複/);
    assert.match(details,/工作表「Khách B」第 2 列/);
    return true;
  });
});

test('同一圖片群組內相同布料與裁片名稱重複時拒絕',()=>{
  const rows=[
    ['MÃ HÀNG','SIZE','TÊN VẬT LIỆU','BỘ PHẬN CẮT','SỐ KIỆN','GHI CHÚ','HÌNH ẢNH'],
    ['HA-S','S','Vải nylon','Miếng thân',1,'',''],
    ['','','','Miếng thân',2,'','']
  ];
  const sheet={rows,'C2':{v:'Vải nylon'},'!merges':[
    {s:{r:1,c:2},e:{r:2,c:2}},{s:{r:1,c:6},e:{r:2,c:6}}
  ]};
  assert.throws(()=>validation().analyzeTemplateWorkbook('mau.xlsx',{SheetNames:['Mẫu'],Sheets:{Mẫu:sheet}}),error=>{
    assert.match(error.issues.join('\n'),/請合併成一列並填寫正確的 SỐ KIỆN/);
    return true;
  });
});

test('不同圖片群組可使用相同布料與裁片名稱',()=>{
  const book=workbook();
  book.SheetNames.push('Khách B');
  book.Sheets['Khách B']=secondSheet('HB-M','M','Miếng trên');
  const result=validation().analyzeTemplateWorkbook('mau.xlsx',book);
  assert.equal(result.productCount,3);
  assert.equal(result.groups.length,2);
});

test('訂單編號辨識沿用 ORDER NO 與右側欄位規則',()=>{
  const numbers=validation().findOrderNumbers([
    ['ORDER NO:','2609-001'],
    ['ORDER NUMBER 2609-001']
  ]);
  assert.deepEqual(Array.from(numbers),['2609-001']);
});

test('不同檔名但訂單號相同時兩個檔案都列為錯誤',()=>{
  const api=validation();
  const records=[
    {id:'a',fileName:'PO-A.xlsx',sheetName:'Sheet1',orderNumbers:['2609-001'],orderLabel:'PO#2609-001'},
    {id:'b',fileName:'PO-A-copy.xlsx',sheetName:'Sheet1',orderNumbers:['2609-001'],orderLabel:'PO#2609-001'},
    {id:'c',fileName:'PO-B.xlsx',sheetName:'Sheet1',orderNumbers:['2609-002'],orderLabel:'PO#2609-002'}
  ];
  const errors=api.findDuplicateOrderErrors(records);
  assert.equal(errors.size,2);
  assert.equal(errors.get('a')[0].code,'2609-001');
  assert.match(errors.get('b')[0].detailReasonZh,/同時出現在多個檔案/);
  assert.equal(errors.has('c'),false);
});

test('缺少主檔款號會去重列出並同時阻擋畫面與匯出入口',()=>{
  const api=validation();
  assert.deepEqual(Array.from(api.missingMasterCodes({missing:[{code:'NO-1'},{code:'no-1'},{code:'NO-2'}]})),['NO-1','NO-2']);
  assert.match(source,/!model\?\.missing\?\.length/);
  assert.match(source,/if\(await showMissingMasterWarning\(state\.exportModel\)\) return/);
  assert.match(source,/在裁片主檔所有工作表中都找不到/);
});

test('更換登入工作階段時清除訂單與歷史但不刪除裝置主檔快取',()=>{
  assert.match(source,/state\.authSession!==window\.firebaseAuthUser/);
  assert.match(source,/function resetUserState\(authSession\)/);
  assert.match(source,/state\.orderItems=\[\]/);
  assert.match(source,/state\.history=\[\]/);
  assert.match(source,/PCMSPieceCuttingStore\?\.resetSession\?\.\(\)/);
  assert.doesNotMatch(source,/cacheDelete\(\)[\s\S]*resetUserState/);
});

test('訂單選擇與拖曳支援多檔，單檔可移除且錯誤不混入計算',()=>{
  assert.match(source,/id="pc-order-input"[^>]*multiple/);
  assert.match(source,/maxFiles:100/);
  assert.match(source,/const validRecords=state\.orderFiles\.filter\(record=>!effectiveOrderErrors\(record\)\.length\)/);
  assert.match(source,/data-order-file-id/);
  assert.match(source,/系統不會以檔名代替訂單號/);
});

test('裁片訂單頁沿用共用操作框架並提供專用工具說明與四項摘要',()=>{
  assert.match(source,/class="pc-command-row ui-command-row"/);
  assert.match(source,/class="pc-summary-row ui-summary-row"/);
  assert.match(source,/class="pc-data-section ui-data-section pc-results-section"/);
  assert.match(source,/id="pc-total"/);
  assert.match(source,/id="pc-pass"/);
  assert.match(source,/id="pc-missing"/);
  assert.match(source,/id="pc-error"/);
  assert.match(source,/Công cụ chuyển đổi PDF chi tiết cắt/);
  assert.match(source,/Khởi động công cụ PDF cắt chi tiết\.bat/);
  assert.match(source,/function clearCurrentOrders\(\)/);
  assert.match(source,/g\('pc-clear-current'\)\.addEventListener\('click',clearCurrentOrders\)/);
  assert.match(styleSource,/\.pc-guide-panel\{/);
  assert.match(styleSource,/#pg-piece-cutting,\.piece-cutting-page\{min-width:0\}/);
});

test('裁片圖片只依 Excel 明確旋轉與裁切設定產生顯示內容',()=>{
  assert.match(serverSource,/Get-XmlNumber \$xfrm 'rot' 0\)\/60000\.0/);
  assert.match(serverSource,/Get-XmlNumber \$srcRect 'l' 0/);
  assert.match(serverSource,/Save-DisplayedTemplateImage \$source \$target \$rotationDegrees \$cropLeft \$cropTop \$cropRight \$cropBottom/);
  assert.match(serverSource,/if\(\[Math\]::Abs\(\$angle\)-lt 0\.001\)\{\$display=\$cropped/);
  assert.doesNotMatch(serverSource,/Width\s*-gt\s*.*Height[\s\S]{0,120}RotateFlip/);
});

test('裁片圖片快取第三版保存分頁身分並以顯示內容驗證碼分組',()=>{
  assert.match(serverSource,/version=3;contentHash=\$hash/);
  assert.match(serverSource,/\[int\]\$index\.version-eq 3/);
  assert.match(serverSource,/function Get-WorkbookSheets/);
  assert.match(serverSource,/sheetIndex=\[int\]\$sheetInfo\.sheetIndex/);
  assert.match(serverSource,/\^S\(\?<sheet>\[0-9\]\+\)!G/);
  assert.match(serverSource,/\$image\.sheetIndex-eq\[int\]\$range\.sheetIndex/);
  assert.match(serverSource,/hash=\(Get-ImageHash \$Target\)/);
  assert.match(serverSource,/Normalize-Key \(\[string\]\$material\.material\)\)\+'\|'\+\(\[string\]\$image\.hash\)/);
});

test('A4 固定抬頭、備註、照片與全版字級已套用',()=>{
  assert.match(serverSource,/Draw-BoxText \$graphics 'MÃ HÀNG'/);
  assert.match(serverSource,/Draw-BoxText \$graphics 'ĐƠN HÀNG'/);
  assert.match(serverSource,/\$title=New-Font 46 Bold/);
  assert.match(serverSource,/\$head=New-Font 22 Bold/);
  assert.match(serverSource,/\$sizeFont=New-Font 29 Bold/);
  assert.match(serverSource,/\$quantity14=New-Font 29 Bold/);
  assert.match(serverSource,/\$noteHeaders=@\('MÃ HÀNG','SIZE','BỘ PHẬN CẮT','GHI CHÚ'\)/);
  assert.match(serverSource,/\$photoX=1068\.0;\$photoWidth=650\.0/);
  assert.match(serverSource,/Draw-RepresentativeImage/);
  assert.match(serverSource,/Trang \{0\}\/\{1\}/);
});

test('動態分頁不拆裁片列，備註過多會建立延續頁',()=>{
  assert.match(serverSource,/Measure-WrappedHeight/);
  assert.match(serverSource,/Split-NoteRowsByHeight/);
  assert.match(serverSource,/parts=\$shownParts;noteRows=\$noteRows/);
  assert.doesNotMatch(serverSource,/\$partGroups=@\(Split-Items \$parts 8\)/);
});
