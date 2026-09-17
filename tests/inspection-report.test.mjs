import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const require=createRequire(import.meta.url);
const bundledDependencies=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies');
const JSZip=process.env.PCMS_TEST_JSZIP
  ?require(process.env.PCMS_TEST_JSZIP)
  :require(path.join(bundledDependencies,'node','node_modules','jszip'));

const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('js/inspection-report.js',root),'utf8');
const storeSource=fs.readFileSync(new URL('js/inspection-report-store.js',root),'utf8');
const featureSource=fs.readFileSync(new URL('js/features.js',root),'utf8');
const styleSource=fs.readFileSync(new URL('styles/features/inspection-report.css',root),'utf8');
const coreStyleSource=fs.readFileSync(new URL('styles/ui-core.css',root),'utf8');

test('品檢報告範本沿用共用操作按鈕，說明位於儲存左側，上傳框不超出欄位',()=>{
  assert.match(featureSource,/page:'inspection-report-template'[^\n]*[\s\S]*?zh:'品檢報告範本'/);
  assert.match(source,/class="ui-command-actions inspection-report-actions"[\s\S]*?class="inspection-report-guide-disclosure"[\s\S]*?<summary class="ui-command-action"[\s\S]*?id="inspection-report-save"/);
  assert.match(source,/class="ui-context-item ui-file-picker" id="inspection-report-drop"[\s\S]*?<i[^>]*>[\s\S]*?<div>/);
  assert.match(source,/class="inspection-report-status ui-table-frame"/);
  assert.match(source,/class="ui-language-section is-vi"[\s\S]*?class="ui-language-section is-zh"/);
  assert.match(source,/每個款號產生一個分頁/);
  assert.doesNotMatch(source,/(?:Tệp mẫu|範本檔案|Hướng dẫn|使用說明|Chưa có mẫu báo cáo|尚未匯入品檢報告範本)[^\n]*HUNTER/);
  assert.match(coreStyleSource,/\.ui-file-picker\s*\{[^}]*width:\s*calc\(100% - 8px\)/);
  assert.match(styleSource,/\.inspection-report-upload \.ui-context-note\.ui-dual-copy\s*\{[^}]*display:\s*flex/);
  assert.doesNotMatch(styleSource,/#inspection-report-drop\s*\{/);
  assert.doesNotMatch(source,/<section class="ui-data-section">\s*<div class="ui-section-header"><i class="ti ti-info-circle"/);
});

function runtime(items=[]){
  const window={
    D:[{productId:'prd_a',code:'69697'},{productId:'prd_b',code:'201934'}],
    PCMSOrderService:{loadOrderItems:async()=>items},
    PCMSFeatures:{ensureInspectionReportZipTool:async()=>JSZip}
  };
  const context={window,document:{getElementById:()=>null},console,Set,Map,Blob,Date};
  vm.createContext(context);
  vm.runInContext(source,context);
  return {api:window.PCMSInspectionReport};
}

function template(){
  return {SheetNames:['Mẫu'],Sheets:{'Mẫu':{
    A1:{t:'s',v:'HUNTER'},K5:{t:'s',v:'WEBBING WORLD'},
    C6:{t:'z',s:{font:{name:'Arial',sz:12}}},
    C7:{t:'z',s:{font:{name:'Arial',sz:11}}},
    F7:{t:'z',s:{font:{name:'Arial',sz:11}}},
    C8:{t:'z',s:{font:{name:'Arial',sz:12}}},
    F8:{t:'z',s:{font:{name:'Arial',sz:14,bold:true}}},
    '!merges':[{s:{r:0,c:0},e:{r:0,c:10}}]
  }}};
}

test('範本只接受一頁；五個資料格可保留範例文字但不可包含公式',()=>{
  const {api}=runtime();
  assert.equal(api.validateTemplateBook(template()).sheetName,'Mẫu');
  const filled=template();filled.Sheets['Mẫu'].C6.v='69697';
  filled.Sheets['Mẫu'].C7.v='Collar sample';
  assert.equal(api.validateTemplateBook(filled).sheetName,'Mẫu');
  filled.Sheets['Mẫu'].C6.f='1+1';
  assert.throws(()=>api.validateTemplateBook(filled),/C6/);
  const two=template();two.SheetNames.push('other');two.Sheets.other={};
  assert.throws(()=>api.validateTemplateBook(two),/một trang tính/);
  const wrong=template();wrong.Sheets['Mẫu'].A1.v='SYLS';
  assert.throws(()=>api.validateTemplateBook(wrong),/HUNTER/);
});

async function styledTemplate(){
  const zip=new JSZip();
  const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:K8"/><cols><col min="3" max="3" width="25" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" s="1" t="inlineStr"><is><t>HUNTER</t></is></c></row><row r="5"><c r="K5" s="1" t="inlineStr"><is><t>WEBBING WORLD</t></is></c></row><row r="6"><c r="C6" s="1"/></row><row r="7"><c r="C7" s="1"/><c r="F7" s="1"/></row><row r="8"><c r="C8" s="1"/><c r="F8" s="2"/></row></sheetData><mergeCells count="1"><mergeCell ref="A1:K1"/></mergeCells><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><name val="Calibri"/><sz val="11"/></font><font><name val="Times New Roman"/><sz val="24"/></font><font><b/><name val="Arial"/><sz val="14"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0" numFmtId="0"/></cellStyleXfs><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0" numFmtId="0" xfId="0"/><xf fontId="1" fillId="0" borderId="0" numFmtId="0" xfId="0" applyFont="1"/><xf fontId="2" fillId="0" borderId="0" numFmtId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
  zip.file('xl/worksheets/sheet1.xml',sheet);
  zip.file('xl/styles.xml',styles);
  zip.file('xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Mẫu" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">$A$1:$K$8</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.file('_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const bytes=await zip.generateAsync({type:'uint8array'});
  return {file:new Blob([bytes]),sheet,styles};
}

test('真實寫出與讀回：每款號一頁，字型、合併、欄寬與固定文字保留',async()=>{
  const {api}=runtime();
  const original=await styledTemplate();
  const output=await api.buildReportBlob(original.file,'2026-117767',[
    {code:'69697',description:'Collar Inari Alu-Strong & XL',color:'pastel red',quantity:204},
    {code:'201934',description:'Collar Tripoli',color:'Olive Green',quantity:100}
  ]);
  const book=await JSZip.loadAsync(await output.arrayBuffer(),{checkCRC32:true});
  const read=async path=>book.file(path).async('string');
  const workbook=await read('xl/workbook.xml');
  assert.match(workbook,/<sheet name="69697"/);
  assert.match(workbook,/<sheet name="201934"/);
  assert.match(workbook,/localSheetId="1"/);
  assert.equal(await read('xl/styles.xml'),original.styles);
  for(const [path,code,quantity] of [
    ['xl/worksheets/sheet1.xml','69697',204],
    ['xl/worksheets/pcms_inspection_2.xml','201934',100]
  ]){
    const xml=await read(path);
    assert.match(xml,new RegExp(`<c r="C6" s="1" t="inlineStr"><is><t xml:space="preserve">${code}<`));
    assert.match(xml,new RegExp(`<c r="F8" s="2" t="n"><v>${quantity}<`));
    assert.match(xml,/HUNTER/);assert.match(xml,/WEBBING WORLD/);
    assert.match(xml,/<mergeCell ref="A1:K1"/);
    assert.match(xml,/width="25"/);
    assert.match(xml,/<pageMargins/);
  }
  assert.match(await read('xl/worksheets/sheet1.xml'),/Collar Inari Alu-Strong &amp; XL/);
  assert.equal(original.sheet.includes('69697'),false);
  // 以另一套試算表讀取器獨立開啟實際輸出位元組，確認不只是 XML 文字比對。
  const verify=`import io,json,sys\nfrom openpyxl import load_workbook\nw=load_workbook(io.BytesIO(sys.stdin.buffer.read()))\nprint(json.dumps([{'name':s.title,'code':s['C6'].value,'description':s['C7'].value,'color':s['F7'].value,'order':s['C8'].value,'qty':s['F8'].value,'font':s['C6'].font.name,'fontSize':s['C6'].font.sz,'quantityFont':s['F8'].font.name,'quantityBold':s['F8'].font.bold,'merged':[str(v) for v in s.merged_cells.ranges]} for s in w.worksheets]))`;
  const python=process.env.PCMS_TEST_PYTHON||path.join(bundledDependencies,'python','python.exe');
  const checked=spawnSync(python,['-c',verify],{input:Buffer.from(await output.arrayBuffer()),encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
  const sheets=JSON.parse(checked.stdout);
  assert.deepEqual(sheets.map(sheet=>sheet.name),['69697','201934']);
  assert.deepEqual(sheets.map(sheet=>sheet.qty),[204,100]);
  assert.deepEqual(sheets.map(sheet=>sheet.color),['pastel red','Olive Green']);
  assert.equal(sheets[0].description,'Collar Inari Alu-Strong & XL');
  assert.equal(sheets[0].order,'2026-117767');
  assert.equal(sheets[0].font,'Times New Roman');
  assert.equal(sheets[0].fontSize,24);
  assert.equal(sheets[0].quantityFont,'Arial');
  assert.equal(sheets[0].quantityBold,true);
  assert.deepEqual(sheets[1].merged,['A1:K1']);
});

test('五格已有範例值時只替換輸出內容，原範本與字型保留',async()=>{
  const {api}=runtime();
  const original=await styledTemplate();
  const zip=await JSZip.loadAsync(await original.file.arrayBuffer());
  const examples=[
    ['<c r="C6" s="1"/>','<c r="C6" s="1" t="inlineStr"><is><t>OLD-CODE</t></is></c>'],
    ['<c r="C7" s="1"/>','<c r="C7" s="1" t="inlineStr"><is><t>Old description</t></is></c>'],
    ['<c r="F7" s="1"/>','<c r="F7" s="1" t="inlineStr"><is><t>Old color</t></is></c>'],
    ['<c r="C8" s="1"/>','<c r="C8" s="1" t="inlineStr"><is><t>OLD-PO</t></is></c>'],
    ['<c r="F8" s="2"/>','<c r="F8" s="2" t="n"><v>999</v></c>']
  ];
  const sample=examples.reduce((xml,[before,after])=>xml.replace(before,after),original.sheet);
  zip.file('xl/worksheets/sheet1.xml',sample);
  const input=new Blob([await zip.generateAsync({type:'uint8array'})]);
  const output=await api.buildReportBlob(input,'2026-117767',[
    {code:'69697',description:'Collar XL',color:'pastel red',quantity:204}
  ]);
  const exported=await JSZip.loadAsync(await output.arrayBuffer(),{checkCRC32:true});
  const preserved=await (await JSZip.loadAsync(await input.arrayBuffer())).file('xl/worksheets/sheet1.xml').async('string');
  assert.match(preserved,/OLD-CODE/);
  assert.match(preserved,/Old description/);
  const sheet=await exported.file('xl/worksheets/sheet1.xml').async('string');
  for(const [,oldValue] of examples)assert.equal(sheet.includes(oldValue),false);
  assert.equal(await exported.file('xl/styles.xml').async('string'),original.styles);
  const python=process.env.PCMS_TEST_PYTHON||path.join(bundledDependencies,'python','python.exe');
  const verify=`import io,json,sys\nfrom openpyxl import load_workbook\ns=load_workbook(io.BytesIO(sys.stdin.buffer.read())).active\nprint(json.dumps({'values':[s[p].value for p in ('C6','C7','F7','C8','F8')],'font':s['C6'].font.name,'quantityFont':s['F8'].font.name,'quantityBold':s['F8'].font.bold}))`;
  const checked=spawnSync(python,['-c',verify],{input:Buffer.from(await output.arrayBuffer()),encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
  assert.deepEqual(JSON.parse(checked.stdout),{
    values:['69697','Collar XL','pastel red','2026-117767',204],font:'Times New Roman',quantityFont:'Arial',quantityBold:true
  });
});

test('範本缺少預留格式格或工作表附屬檔時明確拒絕，不產生不完整報告',async()=>{
  const {api}=runtime();
  const missing=await styledTemplate();
  const zip=await JSZip.loadAsync(await missing.file.arrayBuffer());
  zip.file('xl/worksheets/sheet1.xml',missing.sheet.replace('<c r="F8" s="2"/>',''));
  const invalid=new Blob([await zip.generateAsync({type:'uint8array'})]);
  await assert.rejects(api.buildReportBlob(invalid,'PO-1',[{code:'A',description:'Item',color:'red',quantity:1}]),/五格已保留格式/);
  const dependent=await JSZip.loadAsync(await missing.file.arrayBuffer());
  dependent.file('xl/worksheets/_rels/sheet1.xml.rels','<Relationships/>');
  const linked=new Blob([await dependent.generateAsync({type:'uint8array'})]);
  await assert.rejects(api.buildReportBlob(linked,'PO-1',[
    {code:'A',description:'Item',color:'red',quantity:1},
    {code:'B',description:'Item',color:'blue',quantity:2}
  ]),/不支援/);
});

test('由真實表格程式建立的空白樣板也能複製兩頁並保持字型',async()=>{
  const python=process.env.PCMS_TEST_PYTHON||path.join(bundledDependencies,'python','python.exe');
  const create=`import io,sys\nfrom openpyxl import Workbook\nfrom openpyxl.styles import Font\nw=Workbook();s=w.active;s.title='Mẫu';s['A1']='HUNTER';s['K5']='WEBBING WORLD'\nfor cell in ('C6','C7','F7','C8'):s[cell].font=Font(name='Times New Roman',size=24)\ns['F8'].font=Font(name='Arial',size=14,bold=True);s.merge_cells('A1:J1');s.column_dimensions['C'].width=27\nb=io.BytesIO();w.save(b);sys.stdout.buffer.write(b.getvalue())`;
  const created=spawnSync(python,['-c',create],{encoding:null,maxBuffer:8*1024*1024});
  assert.equal(created.status,0,String(created.stderr));
  const {api}=runtime();
  const report=await api.buildReportBlob(new Blob([created.stdout]),'2026-117767',[
    {code:'69697',description:'Collar XL',color:'pastel red',quantity:204},
    {code:'201934',description:'Collar M',color:'blue',quantity:100}
  ]);
  const inspect=`import io,json,sys\nfrom openpyxl import load_workbook\nw=load_workbook(io.BytesIO(sys.stdin.buffer.read()))\nprint(json.dumps([[s.title,s['C6'].value,s['C6'].font.name,s['F8'].font.name,s['F8'].font.bold,s['F8'].value] for s in w]))`;
  const opened=spawnSync(python,['-c',inspect],{input:Buffer.from(await report.arrayBuffer()),encoding:'utf8'});
  assert.equal(opened.status,0,opened.stderr);
  assert.deepEqual(JSON.parse(opened.stdout),[
    ['69697','69697','Times New Roman','Arial',true,204],
    ['201934','201934','Times New Roman','Arial',true,100]
  ]);
});

test('模擬 83 個不同款號，完整報告仍有 83 個分頁且保留樣式檔',async()=>{
  const {api}=runtime();
  const original=await styledTemplate();
  const rows=Array.from({length:83},(_,index)=>({
    code:`ITEM-${String(index+1).padStart(3,'0')}`,
    description:'Collar XL',color:'pastel red',quantity:index+1
  }));
  const result=await api.buildReportBlob(original.file,'2026-117767',rows);
  const zip=await JSZip.loadAsync(await result.arrayBuffer(),{checkCRC32:true});
  const workbook=await zip.file('xl/workbook.xml').async('string');
  assert.equal((workbook.match(/<sheet\b/g)||[]).length,83);
  assert.equal((await zip.file('xl/styles.xml').async('string')),original.styles);
  assert.match(await zip.file('xl/worksheets/pcms_inspection_83.xml').async('string'),/ITEM-083/);
});

test('匯出寫入原始樣式範本，封裝工具只在選擇儲存位置後載入',()=>{
  const features=fs.readFileSync(new URL('js/features.js',root),'utf8');
  assert.match(source,/const handle=await window\.PCMSFileIO\.chooseSaveHandle/);
  assert.ok(source.indexOf('chooseSaveHandle({')<source.indexOf('buildReportBlob(file,'));
  assert.match(source,/PCMSFileIO\.writeToHandle\(handle,output\)/);
  assert.doesNotMatch(source,/writeWorkbookToHandle/);
  assert.match(features,/function ensureInspectionReportZipTool\(/);
});

test('同款號同描述同顏色加總，異色阻擋，不猜測英文翻譯',async()=>{
  const rows=[
    {productId:'prd_a',description:'Collar XL',color:'pastel red',quantity:10,lineNumber:17},
    {productId:'prd_a',description:'Collar XL',color:'pastel red',quantity:20,lineNumber:18}
  ];
  const {api}=runtime(rows);
  const result=await api.rowsForOrder({id:'order-1'});
  assert.equal(result.length,1);
  assert.equal(result[0].quantity,30);
  assert.equal(result[0].lineCount,2);
  rows[1].color='blue';
  await assert.rejects(api.rowsForOrder({id:'order-1'}),/khác nhau/);
  rows[1].color='';
  await assert.rejects(api.rowsForOrder({id:'order-1'}),/thiếu/);
});

test('Excel 工作表名稱超過 31 字或含禁用符號時仍保持唯一',()=>{
  const {api}=runtime();const used=new Set();
  const one=api.normalizeSheetName('A/B:C*D?E[F]\\'.repeat(5),used);
  const two=api.normalizeSheetName('A/B:C*D?E[F]\\'.repeat(5),used);
  assert.ok(one.length<=31&&two.length<=31);
  assert.notEqual(one,two);
  assert.doesNotMatch(one,/[\[\]:*?/\\]/);
});

test('匯出圖示只接上方訂單與工序資料表，不插入下方訂單管理',()=>{
  const orders=fs.readFileSync(new URL('js/orders.js',root),'utf8');
  const lower=orders.slice(orders.indexOf('function renderOrders(){'),orders.indexOf('function viewOrderProgress('));
  const upper=orders.slice(orders.indexOf('async function renderProgress(){'),orders.indexOf('async function saveProgField('));
  assert.doesNotMatch(lower,/orders-inspection-export/);
  assert.match(upper,/orders-inspection-export/);
  assert.match(upper,/toUpperCase\(\)==='HUNTER'/);
  assert.ok(upper.indexOf('openOrderDeleteWarning(${idArg},${orderArg})')<upper.indexOf('class="btn bsm bd2 orders-inspection-export"'));
});

test('同時查到兩份範本時停止，不自行選擇或額外讀取整個集合',async()=>{
  const requests=[];
  const window={
    firebaseAuthUser:{uid:'demo-user'},_getDoc:()=>{},_runTransaction:()=>{},
    _collection:name=>name,_limit:number=>number,_query:(collection,maximum)=>({collection,maximum}),
    _getDocs:async request=>{requests.push(request);return {docs:[
      {id:'main',data:()=>({templateId:'main'})},
      {id:'unexpected',data:()=>({templateId:'unexpected'})}
    ]};}
  };
  vm.runInNewContext(storeSource,{window,Blob,FileReader:class {},console});
  await assert.rejects(window.PCMSInspectionReportStore.loadOnly(),/hai mẫu báo cáo/);
  assert.equal(requests.length,1);
  assert.equal(requests[0].collection,'inspectionReportTemplates');
  assert.equal(requests[0].maximum,2);
});
