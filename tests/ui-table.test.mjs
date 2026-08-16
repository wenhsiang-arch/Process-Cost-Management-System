import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/ui-table.js',import.meta.url),'utf8'); // source（共用表格程式內容）
const styles=fs.readFileSync(new URL('../styles/ui-core.css',import.meta.url),'utf8'); // styles（共用表格樣式內容）

test('浮動專用表格在控制初始化前就隱藏功能框原始捲軸',()=>{
  assert.match(styles,/\.ui-table-scroll\[data-ui-floating-scroll="only"\],[\s\S]*?scrollbar-width:\s*none;/);
  assert.match(styles,/\.ui-table-scroll\[data-ui-floating-scroll="only"\]::\-webkit-scrollbar,[\s\S]*?height:\s*0;/);
});

function classList(initial=[]){
  const values=new Set(initial);
  return {
    add:value=>values.add(value),
    remove:value=>values.delete(value),
    contains:value=>values.has(value),
    toggle(value,active){ active ? values.add(value) : values.delete(value); }
  };
}

function eventTarget(properties={}){
  const listeners=new Map();
  return Object.assign({
    listeners,
    addEventListener(type,listener){
      if(!listeners.has(type)) listeners.set(type,new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type,listener){ listeners.get(type)?.delete(listener); },
    dispatch(type){ listeners.get(type)?.forEach(listener=>listener({currentTarget:this})); }
  },properties);
}

function createHarness(options={}){
  const frames=[];
  const created=[];
  const resizeObservers=[];
  const mutationObservers=[];
  const target=eventTarget({
    isConnected:true,
    hidden:false,
    classList:classList(),
    dataset:{uiFloatingScroll:'only'},
    scrollWidth:1600,
    clientWidth:960,
    scrollLeft:0,
    rect:{left:220,right:1180,top:120,bottom:options.targetBottom??1400},
    closest:()=>null,
    getBoundingClientRect(){ return {...this.rect}; }
  });
  const scrollHost=eventTarget({
    isConnected:true,
    clientWidth:1000,
    clientHeight:750,
    scrollHeight:options.scrollHeight??750,
    scrollTop:options.scrollTop??0,
    closest:()=>null,
    getBoundingClientRect:()=>({left:200,right:1200,top:50,bottom:800,width:1000,height:750})
  });
  const page={
    isConnected:true,
    classList:classList(['active']),
    closest:selector=>selector==='.ct'?scrollHost:null,
    querySelectorAll:selector=>selector==='.ui-table-scroll'?[target]:[]
  };
  const body={appendChild(element){ element.isConnected=true; created.push(element); }};
  const document={
    body,
    documentElement:{clientWidth:1200,clientHeight:800},
    getElementById:id=>id==='pg-production-records'?page:null,
    createElement(){
      return eventTarget({
        isConnected:false,
        className:'',
        classList:classList(),
        dataset:{},
        style:{},
        attributes:{},
        children:[],
        scrollLeft:0,
        offsetHeight:18,
        setAttribute(name,value){ this.attributes[name]=String(value); },
        appendChild(child){ this.children.push(child); }
      });
    }
  };
  class FakeResizeObserver{
    constructor(callback){ this.callback=callback; this.targets=new Set(); resizeObservers.push(this); }
    observe(element){ this.targets.add(element); }
    unobserve(element){ this.targets.delete(element); }
    disconnect(){ this.targets.clear(); }
    trigger(){ this.callback(); }
  }
  class FakeMutationObserver{
    constructor(callback){ this.callback=callback; mutationObservers.push(this); }
    observe(){}
    disconnect(){}
    trigger(){ this.callback(); }
  }
  const visualViewport=eventTarget();
  const window=eventTarget({
    innerWidth:1200,
    innerHeight:800,
    visualViewport,
    getComputedStyle:()=>({overflowX:'auto'}),
    requestAnimationFrame(callback){ frames.push(callback); return frames.length; },
    cancelAnimationFrame(){}
  });
  const context={window,document,ResizeObserver:FakeResizeObserver,MutationObserver:FakeMutationObserver,console};
  vm.createContext(context);
  vm.runInContext(source,context);
  return {
    api:window.PCMSUITable,
    target,page,scrollHost,created,resizeObservers,mutationObservers,
    flush(){ while(frames.length) frames.shift()(); }
  };
}

test('唯一浮動捲軸固定在主視窗底部並與表格雙向同步',()=>{
  const harness=createHarness();
  assert.equal(harness.api.activatePage('production-records'),true);
  harness.flush();
  const bar=harness.created[0];
  const spacer=bar.children[0];
  assert.equal(bar.classList.contains('is-visible'),true);
  assert.equal(bar.attributes['aria-hidden'],'false');
  assert.equal(bar.style.left,'220px');
  assert.equal(bar.style.width,'960px');
  assert.equal(bar.style.top,'782px');
  assert.equal(spacer.style.width,'1600px');

  bar.scrollLeft=240;
  bar.dispatch('scroll');
  assert.equal(harness.target.scrollLeft,240);
  harness.target.scrollLeft=420;
  harness.target.dispatch('scroll');
  assert.equal(bar.scrollLeft,420);

  harness.target.rect.top=810;
  harness.target.rect.bottom=1400;
  harness.api.refresh();
  harness.flush();
  assert.equal(bar.classList.contains('is-visible'),false);
  assert.equal(bar.attributes['aria-hidden'],'true');
});

test('表格不再超寬或離開功能時會移除浮動捲軸狀態',()=>{
  const harness=createHarness();
  harness.api.activatePage('production-records');
  harness.flush();
  const bar=harness.created[0];
  harness.target.scrollWidth=900;
  harness.resizeObservers[0].trigger();
  harness.flush();
  assert.equal(bar.classList.contains('is-visible'),false);

  harness.target.scrollWidth=1600;
  harness.target.rect.bottom=1400;
  harness.api.refresh();
  harness.flush();
  assert.equal(bar.classList.contains('is-visible'),true);
  harness.api.deactivatePage('production-records');
  assert.equal(bar.classList.contains('is-visible'),false);
  assert.equal(harness.target.listeners.get('scroll')?.size||0,0);
});

test('短內容的唯一水平捲軸固定在主視窗最下方',()=>{
  const harness=createHarness({targetBottom:180,scrollHeight:750});
  harness.api.activatePage('production-records');
  harness.flush();
  const bar=harness.created[0];
  assert.equal(bar.classList.contains('is-visible'),true);
  assert.equal(bar.style.top,'782px');
  assert.equal(harness.target.classList.contains('is-ui-floating-only'),true);
});

test('長內容在頁面頂端立即顯示，主捲軸移動後仍維持浮動捲軸',()=>{
  const harness=createHarness({targetBottom:1400,scrollHeight:1800});
  harness.api.activatePage('production-records');
  harness.flush();
  const bar=harness.created[0];
  assert.equal(bar.classList.contains('is-visible'),true);
  assert.equal(bar.style.top,'782px');
  assert.equal(harness.target.classList.contains('is-ui-floating-only'),true);

  harness.scrollHost.scrollTop=120;
  harness.scrollHost.dispatch('scroll');
  harness.flush();
  assert.equal(bar.classList.contains('is-visible'),true);
  assert.equal(bar.style.top,'782px');

  harness.scrollHost.scrollTop=0;
  harness.scrollHost.dispatch('scroll');
  harness.flush();
  assert.equal(bar.classList.contains('is-visible'),true);

  harness.api.deactivatePage('production-records');
  assert.equal(harness.target.classList.contains('is-ui-floating-only'),false);
});
