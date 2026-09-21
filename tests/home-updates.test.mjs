import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const archive=JSON.parse(read('data/home-updates/2026.json'));
const response=data=>({ok:true,text:async()=>JSON.stringify(data)});

// harness（離線驗收環境）：只使用虛構網路回應與畫面節點，不連正式網站或雲端。
function harness(fetcher=async()=>response(archive)){
  class Node {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.attrs={};this.className='';this.hidden=false;this.disabled=false;this.valueText='';}
    append(...nodes){for(const node of nodes)this.children.push(...(node.tagName==='fragment'?node.children:[node]));}
    replaceChildren(...nodes){this.children=[];this.valueText='';this.append(...nodes);}
    set textContent(value){this.valueText=String(value);this.children=[];}
    get textContent(){return this.valueText+this.children.map(node=>node.textContent).join('');}
    setAttribute(name,value){this.attrs[name]=value;}
    getAttribute(name){return this.attrs[name];}
    removeAttribute(name){delete this.attrs[name];}
  }
  const ids=Object.fromEntries(['home-updates-load','home-updates-year','home-updates-status','home-updates-archive','home-updates-archive-list','home-updates-archive-title'].map(id=>[id,new Node()]));
  ids['home-updates-year'].selectedOptions=[{value:'2026',dataset:{version:'20260922-1'}}];
  const calls=[],timers=new Map();let nextTimer=0;
  const document={baseURI:'https://example.test/app/',getElementById:id=>ids[id]||null,querySelectorAll:()=>[],createElement:tag=>new Node(tag),createDocumentFragment:()=>new Node('fragment')};
  const window={PCMSUIText:{set(target,pair){target.replaceChildren();for(const lang of ['vi','zh']){const node=new Node('span');node.className='ui-text-'+lang;node.textContent=pair[lang];target.append(node);}}}};
  const context={window,document,URL,AbortController,console,CONFIGURABLE_ROLES:['manager','clerk','productionDevelopment','productionControl','sales'],fetch:async(url,options)=>{calls.push({url:String(url),options});return fetcher(url,options);},setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(read('js/home-updates.js'),context);
  return {api:window.PCMSHomeUpdates,ids,calls,timers,context,Node};
}

test('首頁只保留最新五則，年度舊公告各有唯一完整雙語來源',()=>{
  const html=read('index.html');
  const dates=[...html.matchAll(/class="home-update-date" datetime="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(dates,['2026-09-22','2026-09-18','2026-09-14','2026-09-08','2026-09-06']);
  assert.match(html,/Tiến độ sản xuất và tổng số lượng chưa xuất/);
  assert.match(html,/生產進度與未出貨總數量/);
  assert.match(html,/已登記生產秒數 ÷ 訂單預計生產總秒數/);
  assert.match(html,/不包含備料、品檢及包裝/);
  assert.match(html,/不受搜尋或目前選擇訂單影響/);
  assert.deepEqual(archive.entries.map(entry=>entry.date),['2026-08-27','2026-08-25','2026-08-24','2026-08-21','2026-08-20']);
  assert.equal(new Set([...dates,...archive.entries.map(entry=>entry.date)]).size,10);
  for(const entry of archive.entries)for(const lang of ['vi','zh'])assert.ok(entry.title[lang]&&entry.sections[lang].length);
  assert.doesNotMatch(html,/<script[^>]+src="js\/home-updates\.js|rel="(?:preload|prefetch)"[^>]+home-updates/);
  assert.match(read('styles/features/home.css'),/\.home-update-language-block ol\s*\{[^}]*padding-inline-start:\s*24px/);
  assert.match(read('styles/features/home.css'),/\.home-update-language-block li \+ li\s*\{[^}]*margin-top:\s*4px/);
});

test('初始化零要求，首次載入一次，重複點擊及重看不重複下載或新增列',async()=>{
  let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}));
  assert.equal(h.calls.length,0);
  const first=h.api.show(),second=h.api.show();
  assert.equal(first,second);assert.equal(h.calls.length,1);
  resolve(response(archive));assert.equal(await first,true);
  assert.equal(h.ids['home-updates-archive-list'].children.length,5);
  assert.equal(await h.api.show(),true);assert.equal(h.calls.length,1);
  assert.equal(h.ids['home-updates-archive-list'].children.length,5);
  assert.equal(h.calls[0].url,'https://example.test/app/data/home-updates/2026.json?v=20260922-1');
  assert.equal(h.timers.size,0);
});

test('網路失敗可重試，不快取失敗或移除已載入的有效內容',async()=>{
  let fail=true;const h=harness(async()=>{if(fail)throw Error('offline');return response(archive);});
  assert.equal(await h.api.show(),false);assert.match(h.ids['home-updates-status'].textContent,/重試/);
  assert.equal(h.ids['home-updates-load'].disabled,false);
  fail=false;assert.equal(await h.api.show(),true);assert.equal(h.calls.length,2);
  const previous=h.ids['home-updates-archive-list'].textContent;
  h.ids['home-updates-year'].selectedOptions[0]={value:'2025',dataset:{version:'20260908-1'}};fail=true;
  assert.equal(await h.api.show(),false);assert.equal(h.ids['home-updates-archive-list'].textContent,previous);
});

test('離頁取消要求，遲到回應不顯示；回頁可以重新載入',async()=>{
  let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}));
  const first=h.api.show();h.api.leave();assert.equal(h.calls[0].options.signal.aborted,true);
  resolve(response(archive));assert.equal(await first,false);
  assert.equal(h.ids['home-updates-archive-list'].children.length,0);
  const retry=h.api.show();resolve(response(archive));assert.equal(await retry,true);
});

test('逾時顯示重試訊息，年度切換只讀所選檔案，空年度正常呈現',async()=>{
  const h=harness((url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout')))));
  const result=h.api.show();[...h.timers.values()][0]();assert.equal(await result,false);
  assert.match(h.ids['home-updates-status'].textContent,/重試/);assert.equal(h.timers.size,0);
  const empty=harness(async()=>response({schemaVersion:1,year:2025,entries:[]}));
  empty.ids['home-updates-year'].selectedOptions[0]={value:'2025',dataset:{version:'20260908-2'}};
  assert.equal(await empty.api.show(),true);assert.match(empty.calls[0].url,/2025\.json\?v=20260908-2$/);
  assert.match(empty.ids['home-updates-status'].textContent,/沒有較早公告/);
});

test('錯誤年度、重複日期、缺語言及無效檔案不部分顯示；文字不作為程式執行',async()=>{
  for(const data of [{...archive,year:2025},{...archive,entries:[archive.entries[0],archive.entries[0]]},{...archive,entries:[{...archive.entries[0],title:{vi:'only'}}]}]){
    const h=harness(async()=>response(data));assert.equal(await h.api.show(),false);assert.equal(h.ids['home-updates-archive-list'].children.length,0);
  }
  const h=harness(async()=>({ok:true,text:async()=>'{broken'}));assert.equal(await h.api.show(),false);
  const x=structuredClone(archive);x.entries[0].sections.zh[0].items[0]='<img src=x onerror=alert(1)>';
  const safe=harness(async()=>response(x));assert.equal(await safe.api.show(),true);
  assert.ok(safe.ids['home-updates-archive-list'].textContent.includes('<img src=x onerror=alert(1)>'));
  const nodes=node=>[node,...node.children.flatMap(nodes)];
  assert.equal(nodes(safe.ids['home-updates-archive-list']).some(node=>node.tagName==='img'),false);
  for(const lang of ['vi','zh'])assert.ok(nodes(safe.ids['home-updates-archive-list']).some(node=>node.className==='home-update-language-block ui-text-'+lang));
});

test('中央載入登記不擴充業務權限，載入器仍共用單一程式要求',async()=>{
  const h=harness();const scripts=[];
  h.context.document.head={appendChild(script){scripts.push(script);queueMicrotask(()=>script.onload());}};
  h.context.document.createElement=tag=>({tagName:tag,dataset:{}});
  vm.runInNewContext(read('js/features.js'),h.context);
  const features=h.context.window.PCMSFeatures;
  assert.equal(features.modules.some(module=>module.id==='home'),false);
  assert.equal(features.permissionKeys.some(key=>/home|update/i.test(key)),false);
  assert.deepEqual(Array.from(features.getPage('home').dataScopes),[]);
  assert.equal(scripts.length,0);
  await Promise.all([features.ensurePageScripts('home'),features.ensurePageScripts('home')]);
  assert.equal(scripts.length,1);assert.match(scripts[0].src,/js\/home-updates\.js\?v=/);
});
