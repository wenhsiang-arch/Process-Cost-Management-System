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
  assert.match(source,/id="inspection-report-table" class="ui-table inspection-report-table" data-ui-table-controls="auto"/);
  assert.match(source,/id="inspection-report-cancel" disabled/);
  assert.match(source,/id="inspection-report-download"/);
  assert.match(source,/id="inspection-report-delete"/);
  assert.match(featureSource,/scripts:\['history','fileIo','uiTableControls','inspectionReportStore','inspectionReport'\]/);
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
  const context={window,document:{getElementById:()=>null},console,Set,Map,Blob,Date,URL};
  vm.createContext(context);
  vm.runInContext(source,context);
  return {api:window.PCMSInspectionReport,window};
}

function template(){
  return {SheetNames:['Mẫu'],Sheets:{'Mẫu':{
    A1:{t:'s',v:'HUNTER'},K5:{t:'s',v:'WEBBING WORLD'},
    C6:{t:'n',v:69697,s:{font:{name:'Arial',sz:12}}},
    C7:{t:'s',v:'Sample description',s:{font:{name:'Arial',sz:11}}},
    F7:{t:'s',v:'Sample color',s:{font:{name:'Arial',sz:11}}},
    C8:{t:'s',v:'Sample order',s:{font:{name:'Arial',sz:12}}},
    F8:{t:'n',v:999,s:{font:{name:'Arial',sz:14,bold:true}}},
    '!merges':[{s:{r:0,c:0},e:{r:0,c:10}}]
  }}};
}

test('範本只接受一頁；五個資料格須有範例值且不可包含公式',()=>{
  const {api}=runtime();
  assert.equal(api.validateTemplateBook(template()).sheetName,'Mẫu');
  const filled=template();filled.Sheets['Mẫu'].C6.v='69697';
  filled.Sheets['Mẫu'].C7.v='Collar sample';
  assert.equal(api.validateTemplateBook(filled).sheetName,'Mẫu');
  filled.Sheets['Mẫu'].C6.f='1+1';
  assert.throws(()=>api.validateTemplateBook(filled),/C6/);
  delete filled.Sheets['Mẫu'].C6.f;
  filled.Sheets['Mẫu'].C6.v='';
  assert.throws(()=>api.validateTemplateBook(filled),/C6/);
  const two=template();two.SheetNames.push('other');two.Sheets.other={};
  assert.throws(()=>api.validateTemplateBook(two),/một trang tính/);
  const otherClient=template();otherClient.Sheets['Mẫu'].A1.v='SYLS';
  assert.equal(api.validateTemplateBook(otherClient).sheetName,'Mẫu');
});

test('品檢範本只接受 .xlsx，不再要求本機轉換工具',()=>{
  const window={};
  vm.runInNewContext(storeSource,{window,Blob,FileReader:class {},console});
  const makeFile=name=>Object.assign(new Blob(['example']),{name});
  assert.throws(()=>window.PCMSInspectionReportStore.validateFile(makeFile('old.xls')),/\.xlsx/);
  assert.doesNotThrow(()=>window.PCMSInspectionReportStore.validateFile(makeFile('new.xlsx')));
  assert.throws(()=>window.PCMSInspectionReportStore.validateFile(makeFile('macro.xlsm')),/\.xlsx/);
  assert.match(source,/accept="\.xlsx"/);
  assert.match(source,/accept:\['\.xlsx'\]/);
  assert.doesNotMatch(source,/convertLegacyTemplate|127\.0\.0\.1:8767/);
  assert.equal(fs.existsSync(new URL('local-inspection-report-server.ps1',root)),false);
  assert.equal(fs.existsSync(new URL('啟動品檢報告轉換工具.bat',root)),false);
});

async function styledTemplate(){
  const zip=new JSZip();
  const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:K8"/><sheetViews><sheetView tabSelected="1" view="pageBreakPreview" topLeftCell="A22" zoomScale="60" workbookViewId="0"><selection activeCell="O23" sqref="O23"/></sheetView></sheetViews><cols><col min="3" max="3" width="25" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" s="1" t="inlineStr"><is><t>HUNTER</t></is></c></row><row r="5"><c r="K5" s="1" t="inlineStr"><is><t>WEBBING WORLD</t></is></c></row><row r="6"><c r="C6" s="1" t="inlineStr"><is><t>OLD-CODE</t></is></c></row><row r="7"><c r="C7" s="1" t="inlineStr"><is><t>Old description</t></is></c><c r="F7" s="1" t="inlineStr"><is><t>Old color</t></is></c></row><row r="8"><c r="C8" s="1" t="inlineStr"><is><t>OLD-PO</t></is></c><c r="F8" s="2" t="n"><v>999</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:K1"/></mergeCells><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><name val="Calibri"/><sz val="11"/></font><font><name val="Times New Roman"/><sz val="24"/></font><font><b/><name val="Arial"/><sz val="14"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0" numFmtId="0"/></cellStyleXfs><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0" numFmtId="0" xfId="0"/><xf fontId="1" fillId="0" borderId="0" numFmtId="0" xfId="0" applyFont="1"/><xf fontId="2" fillId="0" borderId="0" numFmtId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
  zip.file('xl/worksheets/sheet1.xml',sheet);
  zip.file('xl/styles.xml',styles);
  zip.file('xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Mẫu" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Mẫu'!$A$1:$K$8</definedName></definedNames></workbook>`);
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
    assert.match(xml,/topLeftCell="A1"/);
    assert.match(xml,/<selection activeCell="A1" sqref="A1"\/>/);
    assert.match(xml,/view="pageBreakPreview"/);
    assert.match(xml,/<ignoredError sqref="C6" numberStoredAsText="1"\/>/);
  }
  assert.match(await read('xl/worksheets/sheet1.xml'),/tabSelected="1"/);
  assert.doesNotMatch(await read('xl/worksheets/pcms_inspection_2.xml'),/tabSelected="1"/);
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

test('純數字外觀及前導零款號仍以文字輸出，只排除 C6 的數字文字提示',async()=>{
  const {api}=runtime();
  const original=await styledTemplate();
  const output=await api.buildReportBlob(original.file,'PO-1',[
    {code:'001234',description:'Item',color:'red',quantity:1}
  ]);
  const zip=await JSZip.loadAsync(await output.arrayBuffer());
  const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(xml,/<c r="C6" s="1" t="inlineStr"><is><t xml:space="preserve">001234<\/t><\/is><\/c>/);
  assert.match(xml,/<ignoredErrors><ignoredError sqref="C6" numberStoredAsText="1"\/><\/ignoredErrors>/);
  assert.doesNotMatch(xml,/<ignoredError[^>]*(?:sqref="C7"|sqref="F8")/);
});

test('範本已有忽略提示或凍結窗格時，保留原設定並從可見頂端開啟',async()=>{
  const {api}=runtime();
  const original=await styledTemplate();
  const zip=await JSZip.loadAsync(await original.file.arrayBuffer());
  zip.file('xl/worksheets/sheet1.xml',original.sheet
    .replace('<selection activeCell="O23" sqref="O23"/>',
      '<pane xSplit="1" ySplit="1" topLeftCell="O23" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="O23" sqref="O23"/>')
    .replace('</worksheet>','<ignoredErrors><ignoredError sqref="B2" numberStoredAsText="1"/></ignoredErrors></worksheet>'));
  const file=new Blob([await zip.generateAsync({type:'uint8array'})]);
  const output=await api.buildReportBlob(file,'PO-1',[{code:'001234',description:'Item',color:'red',quantity:1}]);
  const result=await JSZip.loadAsync(await output.arrayBuffer());
  const xml=await result.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(xml,/<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"\/>/);
  assert.match(xml,/<selection pane="bottomRight" activeCell="B2" sqref="B2"\/>/);
  assert.match(xml,/<ignoredError sqref="B2" numberStoredAsText="1"\/>/);
  assert.match(xml,/<ignoredError sqref="C6" numberStoredAsText="1"\/>/);
});

test('五格已有範例值時只替換輸出內容，原範本與字型保留',async()=>{
  const {api}=runtime();
  const original=await styledTemplate();
  const zip=await JSZip.loadAsync(await original.file.arrayBuffer());
  const examples=[
    ['<c r="C6" s="1" t="inlineStr"><is><t>OLD-CODE</t></is></c>','<c r="C6" s="1" t="inlineStr"><is><t>EXAMPLE-CODE</t></is></c>'],
    ['<c r="C7" s="1" t="inlineStr"><is><t>Old description</t></is></c>','<c r="C7" s="1" t="inlineStr"><is><t>Example description</t></is></c>'],
    ['<c r="F7" s="1" t="inlineStr"><is><t>Old color</t></is></c>','<c r="F7" s="1" t="inlineStr"><is><t>Example color</t></is></c>'],
    ['<c r="C8" s="1" t="inlineStr"><is><t>OLD-PO</t></is></c>','<c r="C8" s="1" t="inlineStr"><is><t>EXAMPLE-PO</t></is></c>'],
    ['<c r="F8" s="2" t="n"><v>999</v></c>','<c r="F8" s="2" t="n"><v>123</v></c>']
  ];
  const sample=examples.reduce((xml,[before,after])=>xml.replace(before,after),original.sheet);
  zip.file('xl/worksheets/sheet1.xml',sample);
  const input=new Blob([await zip.generateAsync({type:'uint8array'})]);
  const output=await api.buildReportBlob(input,'2026-117767',[
    {code:'69697',description:'Collar XL',color:'pastel red',quantity:204}
  ]);
  const exported=await JSZip.loadAsync(await output.arrayBuffer(),{checkCRC32:true});
  assert.match(await exported.file('xl/workbook.xml').async('string'),/'69697'!\$A\$1:\$K\$8/);
  const preserved=await (await JSZip.loadAsync(await input.arrayBuffer())).file('xl/worksheets/sheet1.xml').async('string');
  assert.match(preserved,/EXAMPLE-CODE/);
  assert.match(preserved,/Example description/);
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

test('範本缺少填寫格時拒絕，正常工作表附屬檔可複製',async()=>{
  const {api}=runtime();
  const missing=await styledTemplate();
  const zip=await JSZip.loadAsync(await missing.file.arrayBuffer());
  zip.file('xl/worksheets/sheet1.xml',missing.sheet.replace('<c r="F8" s="2" t="n"><v>999</v></c>',''));
  const invalid=new Blob([await zip.generateAsync({type:'uint8array'})]);
  await assert.rejects(api.buildReportBlob(invalid,'PO-1',[{code:'A',description:'Item',color:'red',quantity:1}]),/五個填寫格/);
  const dependent=await JSZip.loadAsync(await missing.file.arrayBuffer());
  dependent.file('xl/worksheets/_rels/sheet1.xml.rels','<Relationships/>');
  const linked=new Blob([await dependent.generateAsync({type:'uint8array'})]);
  const exported=await api.buildReportBlob(linked,'PO-1',[
    {code:'A',description:'Item',color:'red',quantity:1},
    {code:'B',description:'Item',color:'blue',quantity:2}
  ]);
  const result=await JSZip.loadAsync(await exported.arrayBuffer());
  assert.equal(await result.file('xl/worksheets/_rels/pcms_inspection_2.xml.rels').async('string'),'<Relationships/>');
});

test('由真實表格程式建立的有字樣板也能複製兩頁並保持字型',async()=>{
  const python=process.env.PCMS_TEST_PYTHON||path.join(bundledDependencies,'python','python.exe');
  const create=`import io,sys\nfrom openpyxl import Workbook\nfrom openpyxl.styles import Font\nw=Workbook();s=w.active;s.title='Mẫu';s['A1']='HUNTER';s['K5']='WEBBING WORLD'\nfor cell in ('C6','C7','F7','C8'):s[cell].font=Font(name='Times New Roman',size=24)\nfor cell,value in {'C6':'OLD','C7':'Old description','F7':'Old color','C8':'OLD-PO','F8':999}.items():s[cell]=value\ns['F8'].font=Font(name='Arial',size=14,bold=True);s.merge_cells('A1:J1');s.column_dimensions['C'].width=27\nb=io.BytesIO();w.save(b);sys.stdout.buffer.write(b.getvalue())`;
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
  assert.match(source,/selection=window\.PCMSFileIO\.chooseSaveHandle/);
  assert.ok(source.indexOf('chooseSaveHandle({')<source.indexOf('buildReportBlob(file,'));
  assert.match(source,/PCMSFileIO\.writeToHandle\(handle,output\)/);
  assert.doesNotMatch(source,/writeWorkbookToHandle/);
  assert.match(features,/function ensureInspectionReportZipTool\(/);
});

test('先核對範本，再由第二次點擊同步開儲存視窗；取消不產生檔案',async()=>{
  const orders=fs.readFileSync(new URL('js/orders.js',root),'utf8');
  const entry=orders.slice(orders.indexOf('async function exportInspectionReportFromOrder('),orders.indexOf('function closeOrderDeleteWarning('));
  assert.ok(entry.indexOf('progressDialog({')<entry.indexOf("ensurePageScripts('inspection-report-template')"));
  assert.match(entry,/inspectionReportExportRequests\.has\(key\)/);
  assert.match(entry,/button\.disabled=true/);
  assert.match(entry,/exportOrder\(orderId,progress\)/);
  assert.match(entry,/inspectionReportExportRequests\.delete\(key\)/);
  const events=[];
  const {api,window}=runtime([{productId:'prd_a',description:'Collar XL',color:'red',quantity:1}]);
  let dialogOptions;
  const progress={
    update:value=>events.push(['update',value.text?.zh]),
    close:()=>events.push(['close'])
  };
  window._doc=(collection,id)=>`${collection}/${id}`;
  window._getDoc=async()=>({exists:()=>true,id:'order-1',data:()=>({client:'HUNTER',importStatus:'ready',lifecycleStatus:'active',orderId:'PO-1'})});
  window.PCMSInspectionReportStore={
    loadOnly:async()=>({fileName:'sample.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),
    loadFile:async()=>new Blob(['sample'])
  };
  window.PCMSFeatures.ensureSpreadsheetTool=async()=>{};
  window.XLSX={read:()=>template()};
  window.PCMSFileIO={chooseSaveHandle:async()=>{events.push(['picker']);return null;},spreadsheetFileType:{}};
  window.PCMSUIComponents={
    alertDialog:()=>{throw new Error('取消不應顯示錯誤');},
    openDialog:options=>{dialogOptions=options;events.push(['ready']);return {};}
  };
  const running=api.exportOrder('order-1',progress);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events.filter(([kind])=>kind==='update').map(([,text])=>text),[
    '正在核對訂單','正在核對報告範本','正在讀取訂單款號','正在檢查範本格式'
  ]);
  assert.deepEqual(events.slice(-2),[['close'],['ready']]);
  assert.equal(events.some(([kind])=>kind==='picker'),false);
  const controller={close:reason=>{events.push(['dialog-close',reason]);dialogOptions.onClose(reason);}};
  const select=dialogOptions.actions[1];
  const clicked=select.onClick({controller});
  assert.equal(clicked,false);
  assert.deepEqual(events.slice(-2),[['picker'],['dialog-close','picker']]);
  await running;
  assert.equal(events.some(([kind])=>kind==='write'),false);
});

test('儲存視窗功能不存在與開啟遭拒分開提示',async()=>{
  const fileIoSource=fs.readFileSync(new URL('js/file-io.js',root),'utf8');
  const window={};
  vm.runInNewContext(fileIoSource,{window,Blob});
  const notices=[];
  const options={onUnsupported:()=>notices.push('unsupported'),onBlocked:()=>notices.push('blocked')};
  assert.equal(await window.PCMSFileIO.chooseSaveHandle(options),null);
  assert.deepEqual(notices,['unsupported']);
  window.showSaveFilePicker=async()=>{throw Object.assign(new Error('gesture expired'),{name:'SecurityError'});};
  assert.equal(await window.PCMSFileIO.chooseSaveHandle(options),null);
  assert.deepEqual(notices,['unsupported','blocked']);
  window.showSaveFilePicker=async()=>{throw Object.assign(new Error('cancel'),{name:'AbortError'});};
  assert.equal(await window.PCMSFileIO.chooseSaveHandle(options),null);
  assert.deepEqual(notices,['unsupported','blocked']);
});

test('完成核對後點選儲存位置，產生報告並只寫入選定檔案',async()=>{
  const {api,window}=runtime([{productId:'prd_a',description:'Collar XL',color:'red',quantity:3}]);
  const sample=await styledTemplate();
  const events=[];
  let dialogOptions;
  let output;
  window._doc=(collection,id)=>`${collection}/${id}`;
  window._getDoc=async()=>({exists:()=>true,id:'order-1',data:()=>({
    client:'HUNTER',importStatus:'ready',lifecycleStatus:'active',orderId:'PO-1'
  })});
  window.PCMSInspectionReportStore={
    loadOnly:async()=>({fileName:'sample.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),
    loadFile:async()=>sample.file
  };
  window.PCMSFeatures.ensureSpreadsheetTool=async()=>{};
  window.XLSX={read:()=>template()};
  window.PCMSFileIO={
    spreadsheetFileType:{},
    chooseSaveHandle:()=>{events.push('picker');return Promise.resolve({name:'report.xlsx'});},
    writeToHandle:async(_handle,blob)=>{events.push('write');output=blob;}
  };
  window.PCMSHistory={saveOperationLog:async()=>events.push('log')};
  window.PCMSUIComponents={
    alertDialog:()=>{throw new Error('成功路徑不應顯示錯誤');},
    openDialog:options=>{dialogOptions=options;},
    progressDialog:()=>({update:()=>{},close:()=>events.push('close') }),
    showToast:()=>events.push('success')
  };
  const running=api.exportOrder('order-1',{update:()=>{},close:()=>events.push('close')});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(events.includes('picker'),false);
  dialogOptions.actions[1].onClick({controller:{close:reason=>dialogOptions.onClose(reason)}});
  await running;
  assert.ok(output instanceof Blob);
  assert.deepEqual(events.filter(value=>value==='picker'||value==='write'||value==='log'),['picker','write','log']);
  const zip=await JSZip.loadAsync(await output.arrayBuffer());
  assert.match(await zip.file('xl/worksheets/sheet1.xml').async('string'),/<v>3<\/v>/);
});

test('匯出程式尚在載入時連點同一訂單，只執行一次並恢復按鈕',async()=>{
  const orders=fs.readFileSync(new URL('js/orders.js',root),'utf8');
  const entry=orders.slice(orders.indexOf('async function exportInspectionReportFromOrder('),orders.indexOf('function closeOrderDeleteWarning('));
  const events=[];
  let finishLoading;
  const loading=new Promise(resolve=>{finishLoading=resolve;});
  const button={disabled:false,setAttribute:()=>events.push('busy'),removeAttribute:()=>events.push('ready')};
  const context={
    window:{
      PCMSUIComponents:{progressDialog:()=>{events.push('progress');return {close:()=>events.push('close')};}},
      PCMSFeatures:{ensurePageScripts:()=>{events.push('load');return loading;}},
      PCMSInspectionReport:{exportOrder:async()=>{events.push('export');}}
    },
    canOpenPage:()=>true,ordersMessage:async()=>{events.push('error');},console:{error:()=>{}}
  };
  vm.createContext(context);
  vm.runInContext(`const inspectionReportExportRequests=new Set();${entry}`,context);
  const first=context.exportInspectionReportFromOrder('order-1',button);
  await context.exportInspectionReportFromOrder('order-1',button);
  assert.equal(button.disabled,true);
  assert.deepEqual(events.slice(0,3),['busy','progress','load']);
  finishLoading();
  await first;
  assert.equal(button.disabled,false);
  assert.equal(events.filter(value=>value==='export').length,1);
  assert.equal(events.filter(value=>value==='close').length,1);
  assert.equal(events.at(-1),'ready');
  context.window.PCMSFeatures.ensurePageScripts=async()=>{throw new Error('offline');};
  await context.exportInspectionReportFromOrder('order-1',button);
  assert.equal(button.disabled,false);
  assert.equal(events.filter(value=>value==='error').length,1);
  assert.equal(events.filter(value=>value==='close').length,2);
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

test('匯出圖示只接上方訂單與工序資料表，已移除重複訂單管理表',()=>{
  const orders=fs.readFileSync(new URL('js/orders.js',root),'utf8');
  const html=fs.readFileSync(new URL('index.html',root),'utf8');
  const upper=orders.slice(orders.indexOf('async function renderProgress(){'),orders.indexOf('async function saveProgField('));
  assert.doesNotMatch(html,/id="order-manager-panel"/);
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

test('取消選檔不碰雲端；下載先選儲存位置，刪除須確認且留紀錄',()=>{
  assert.match(source,/function cancelPending\(\)[\s\S]*?state\.pendingFile=null;state\.pendingSheetName=''/);
  assert.match(source,/async function downloadOriginal\(\)[\s\S]*?chooseSaveHandle\([\s\S]*?if\(!handle\)return;[\s\S]*?loadFile\(current\)/);
  assert.match(source,/async function deleteSaved\(\)[\s\S]*?confirmDialog\([\s\S]*?if\(!confirmed\)return;[\s\S]*?removeFile\(expected\)/);
  assert.match(storeSource,/async function removeFile\(expectedMeta\)[\s\S]*?transaction\.delete\(metaRef\);[\s\S]*?transaction\.set\(logRef,log\)/);
});

test('刪除範本採版本核對及同交易刪除分段、主檔、操作紀錄',async()=>{
  const meta={id:'main',templateId:'main',fileName:'source.xlsx',contentHash:'a'.repeat(64),updatedAt:100,chunkCount:2};
  const operations=[];
  const transaction={
    get:async()=>({exists:()=>true,data:()=>({...meta})}),
    delete:ref=>operations.push(['delete',ref]),
    set:(ref,value)=>operations.push(['set',ref,value])
  };
  const window={
    firebaseAuthUser:{uid:'admin-user'},_getDoc:()=>{},
    _collection:name=>name,_limit:value=>value,_query:(name,limit)=>({name,limit}),
    _getDocs:async()=>({docs:[{id:'main',data:()=>meta}]}),
    _doc:(collection,id)=>`${collection}/${id}`,_newDocRef:()=>({id:'log-1'}),
    _runTransaction:async callback=>callback(transaction),
    PCMSHistory:{buildOperationLog:details=>({...details}),rememberOperationLog:()=>{}}
  };
  vm.runInNewContext(storeSource,{window,Blob,FileReader:class {},console,Date});
  await window.PCMSInspectionReportStore.removeFile(meta);
  assert.deepEqual(operations.filter(([kind])=>kind==='delete').map(([,ref])=>ref),[
    'inspectionReportTemplateChunks/main_00000','inspectionReportTemplateChunks/main_00001',
    'inspectionReportTemplates/main'
  ]);
  assert.equal(operations.at(-1)[2].action,'inspectionTemplateDelete');
  operations.length=0;
  await assert.rejects(window.PCMSInspectionReportStore.removeFile({...meta,contentHash:'stale'}),/thay đổi/);
  assert.equal(operations.length,0);
});
