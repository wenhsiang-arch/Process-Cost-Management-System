import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/ui-table-controls.js',import.meta.url),'utf8'); // source（共用表格操作程式內容）

function loadApi(){
  const context={window:{},console};
  vm.createContext(context);
  vm.runInContext(source,context);
  return context.window.PCMSUITableControls;
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
    dispatch(type,event={}){
      listeners.get(type)?.forEach(listener=>listener({currentTarget:this,target:event.target||this,...event}));
    }
  },properties);
}

function classList(){
  const values=new Set();
  return {
    add:value=>values.add(value),remove:value=>values.delete(value),
    contains:value=>values.has(value),toggle(value,active){ active ? values.add(value) : values.delete(value); }
  };
}

function style(){
  const values=new Map();
  return {
    setProperty(name,value){ values.set(name,String(value)); },
    removeProperty(name){ values.delete(name); if(name==='width') delete this.width; },
    getPropertyValue(name){ return values.get(name)||''; },
    values
  };
}

function loadResizeHarness(){
  const stored=new Map();
  let languageMode='bilingual';
  const window=eventTarget({
    getComputedStyle(){
      return {font:'400 12px sans-serif',fontSize:'12px',fontWeight:'400',fontFamily:'sans-serif',paddingLeft:'10px',paddingRight:'10px',gap:'3px',columnGap:'3px'};
    },
    localStorage:{
      getItem:key=>stored.get(key)||null,
      setItem:(key,value)=>stored.set(key,String(value)),
      removeItem:key=>stored.delete(key)
    },
    PCMSUIRuntime:{getLanguageMode:()=>languageMode}
  });
  const body={classList:classList()};
  function matches(node,selector){
    if(selector==='[data-ui-table-resize-handle]') return node.dataset?.uiTableResizeHandle==='true';
    if(selector==='[data-ui-table-sort-trigger]') return node.dataset?.uiTableSortTrigger==='true';
    if(selector==='[data-ui-table-sort-icon]') return node.dataset?.uiTableSortIcon==='true';
    if(selector==='[data-ui-table-sort-key]') return Boolean(node.dataset?.uiTableSortKey);
    if(selector==='th') return node.tagName==='TH';
    if(selector.startsWith('.')) return String(node.className||'').split(/\s+/).includes(selector.slice(1));
    return false;
  }
  function closest(node,selector){
    let current=node;
    while(current){ if(matches(current,selector)) return current; current=current.parentElement; }
    return null;
  }
  function find(node,selector){
    for(const child of node.children||[]){
      if(matches(child,selector)) return child;
      const nested=find(child,selector);
      if(nested) return nested;
    }
    return null;
  }
  function appendChild(parent,child,index=parent.children.length){
    if(child.parentElement) child.parentElement.children=child.parentElement.children.filter(item=>item!==child);
    child.parentElement=parent;
    parent.children.splice(index,0,child);
    return child;
  }
  const document=eventTarget({
    body,
    createElement(tagName='div'){
      const element={
        tagName:String(tagName).toUpperCase(),dataset:{},style:style(),className:'',classList:classList(),children:[],attributes:{},parentElement:null,
        setAttribute(name,value){ this.attributes[name]=String(value); },
        getAttribute(name){ return this.attributes[name]??null; },
        appendChild(child){ return appendChild(this,child); },
        append(...children){ children.forEach(child=>appendChild(this,child)); },
        replaceChildren(...children){
          this.children.forEach(child=>{ child.parentElement=null; });
          this.children=[];
          children.forEach(child=>appendChild(this,child));
        },
        insertBefore(child,reference){ return appendChild(this,child,Math.max(0,this.children.indexOf(reference))); },
        querySelector(selector){ return find(this,selector); },
        closest(selector){ return closest(this,selector); },
        getBoundingClientRect(){ return {width:this.dataset.uiTableSortTrigger==='true' ? 20 : 0}; },
        remove(){
          if(!this.parentElement) return;
          this.parentElement.children=this.parentElement.children.filter(child=>child!==this);
          this.parentElement=null;
        }
      };
      return element;
    }
  });
  const context={window,document,console};
  vm.createContext(context);
  vm.runInContext(source,context);

  function makeCell(key,width,text,scrollWidth=width,tagName='td'){
    const cellStyle=style();
    return {
      tagName:String(tagName).toUpperCase(),dataset:{uiTableColumn:key},style:cellStyle,classList:classList(),className:'',children:[],attributes:{},
      textContent:text,scrollWidth,parentElement:null,
      setAttribute(name,value){ this.attributes[name]=String(value); },
      getAttribute(name){ return this.attributes[name]??null; },
      appendChild(child){ return appendChild(this,child); },
      append(...children){ children.forEach(child=>appendChild(this,child)); },
      replaceChildren(...children){
        this.children.forEach(child=>{ child.parentElement=null; });
        this.children=[];
        children.forEach(child=>appendChild(this,child));
      },
      insertBefore(child,reference){ return appendChild(this,child,Math.max(0,this.children.indexOf(reference))); },
      getBoundingClientRect(){ return {width:Number.parseFloat(this.style.width)||width}; },
      querySelector(selector){ return find(this,selector); },
      closest(selector){ return closest(this,selector); }
    };
  }

  function makeTable(id='resize-table',sortable=false){
    const headers=[makeCell('code',120,'Mã hàng',150,'th'),makeCell('name',200,'Tên Việt',240,'th')];
    const cells=[makeCell('code',120,'BA0101-A',180),makeCell('name',200,'Tên công đoạn rất dài',310)];
    if(sortable){
      headers[0].dataset.uiTableSortKey='code';
      const icon=document.createElement('i');
      icon.dataset.uiTableSortIcon='true';
      headers[0].appendChild(icon);
    }
    const table=eventTarget({
      id,dataset:{uiTableResizable:'true'},style:style(),classList:classList(),
      tHead:{rows:[{cells:headers}]},
      querySelectorAll(selector){
        if(selector==='[data-ui-table-column]') return [...headers,...cells];
        if(selector==='[data-ui-table-sort-key]') return headers.filter(header=>header.dataset.uiTableSortKey);
        return [];
      },
      contains(node){
        let current=node;
        while(current){ if(current===this) return true; current=current.parentElement; }
        return headers.includes(node)||cells.includes(node);
      }
    });
    headers.forEach(header=>{ header.parentElement=table; });
    cells.forEach(cell=>{ cell.parentElement=table; });
    return {table,headers,cells};
  }
  return {
    api:window.PCMSUITableControls,window,stored,makeTable,
    setLanguageMode(mode){ languageMode=mode; document.dispatch('pcms:languagechange',{detail:{mode}}); }
  };
}

test('共用排序依預設、遞增、遞減、預設循環',()=>{
  const api=loadApi();
  const ascending=api.nextSortState({key:'',direction:'none'},'code');
  const descending=api.nextSortState(ascending,'code');
  const cleared=api.nextSortState(descending,'code');
  const switched=api.nextSortState(descending,'client');
  assert.deepEqual({...ascending},{key:'code',direction:'ascending'});
  assert.deepEqual({...descending},{key:'code',direction:'descending'});
  assert.deepEqual({...cleared},{key:'',direction:'none'});
  assert.deepEqual({...switched},{key:'client',direction:'ascending'});
});

test('共用欄位清單只保留功能已判定可用的欄位',()=>{
  const api=loadApi();
  const columns=api.availableColumns([
    {key:'code',label:{vi:'Mã hàng',zh:'款號'}},
    {key:'cost',label:{vi:'Tổng chi phí',zh:'總工價'},available:()=>false},
    {key:'action',label:{vi:'Thao tác',zh:'操作'},available:()=>{ throw new Error('denied'); }}
  ]);
  assert.deepEqual(columns.map(column=>column.key),['code']);
});

test('試點表格可以拖曳、雙擊自動符合並保存與恢復欄寬',()=>{
  const harness=loadResizeHarness();
  const first=harness.makeTable();
  const columns=[
    {key:'code',label:{vi:'Mã hàng',zh:'款號'},minimum:90,preferred:120,maximum:220},
    {key:'name',label:{vi:'Tên Việt',zh:'越文名稱'},minimum:120,preferred:200,maximum:260}
  ];
  const control=harness.api.create({table:first.table,columns,resizable:true});
  const codeHandle=first.headers[0].children[0];
  assert.equal(codeHandle.dataset.uiTableResizeHandle,'true');

  first.table.dispatch('pointerdown',{target:codeHandle,button:0,clientX:100,preventDefault(){},stopPropagation(){}});
  harness.window.dispatch('pointermove',{clientX:150,preventDefault(){}});
  assert.equal(first.headers[0].style.width,'170px');
  assert.equal(first.cells[0].style.width,'170px');
  harness.window.dispatch('pointerup',{preventDefault(){}});
  const saved=JSON.parse(harness.stored.get('pcms.ui.table-widths.v1.resize-table'));
  assert.equal(saved.widths.code,170);
  assert.equal(saved.widths.name,200);

  first.table.dispatch('dblclick',{target:first.headers[1].children[0],preventDefault(){},stopPropagation(){}});
  assert.equal(first.headers[1].style.width,'260px');
  assert.equal(JSON.parse(harness.stored.get('pcms.ui.table-widths.v1.resize-table')).widths.name,260);

  control.resetColumnWidths();
  assert.equal(first.headers[0].style.width,undefined);
  assert.equal(first.headers[1].style.width,undefined);
  assert.equal(harness.stored.has('pcms.ui.table-widths.v1.resize-table'),false);

  first.table.dispatch('pointerdown',{target:codeHandle,button:0,clientX:100,preventDefault(){},stopPropagation(){}});
  harness.window.dispatch('pointermove',{clientX:-100,preventDefault(){}});
  const compactWidth=Number.parseFloat(first.headers[0].style.width);
  assert.ok(compactWidth<90,'欄位最小值應可縮到原固定最小值以下');
  assert.ok(compactWidth>=56,'欄位不得縮到低於完整表頭所需寬度');
  harness.window.dispatch('pointerup',{preventDefault(){}});
  control.resetColumnWidths();
  control.destroy();
});

test('語言切換只改目前顯示下限且不覆蓋使用者保存欄寬',()=>{
  const harness=loadResizeHarness();
  harness.setLanguageMode('vi');
  const fixture=harness.makeTable('language-width-table');
  const control=harness.api.create({
    table:fixture.table,resizable:true,
    columns:[
      {key:'code',label:{vi:'Mã',zh:'非常非常長的中文表頭'},minimum:56,preferred:120,maximum:320},
      {key:'name',label:{vi:'Tên',zh:'名稱'},minimum:56,preferred:160,maximum:260}
    ]
  });
  const handle=fixture.headers[0].children[0];
  fixture.table.dispatch('pointerdown',{target:handle,button:0,clientX:100,preventDefault(){},stopPropagation(){}});
  harness.window.dispatch('pointermove',{clientX:-100,preventDefault(){}});
  harness.window.dispatch('pointerup',{preventDefault(){}});
  const saved=control.getColumnWidths().code;
  harness.setLanguageMode('bilingual');
  assert.equal(control.getColumnWidths().code,saved);
  assert.ok(Number.parseFloat(fixture.headers[0].style.width)>saved);
  harness.setLanguageMode('vi');
  assert.equal(Number.parseFloat(fixture.headers[0].style.width),saved);
  control.destroy();
});

test('排序只由箭頭按鈕觸發，表頭文字及欄寬拖曳區不會排序',()=>{
  const harness=loadResizeHarness();
  const fixture=harness.makeTable('sort-table',true);
  const changes=[];
  const control=harness.api.create({
    table:fixture.table,
    columns:[
      {key:'code',label:{vi:'Mã hàng',zh:'款號'},minimum:90,preferred:120,maximum:220},
      {key:'name',label:{vi:'Tên Việt',zh:'越文名稱'},minimum:120,preferred:200,maximum:260}
    ],
    resizable:true,
    onSortChanged:state=>changes.push({...state})
  });
  const header=fixture.headers[0];
  const trigger=header.querySelector('[data-ui-table-sort-trigger]');
  const icon=header.querySelector('[data-ui-table-sort-icon]');
  const resizeHandle=header.querySelector('[data-ui-table-resize-handle]');
  const vi=header.querySelector('.ui-text-vi');
  const zh=header.querySelector('.ui-text-zh');
  assert.ok(trigger);
  assert.equal(vi.textContent,'Mã hàng');
  assert.equal(zh.textContent,'款號');

  fixture.table.dispatch('click',{target:header});
  fixture.table.dispatch('click',{target:resizeHandle});
  assert.equal(changes.length,0);

  fixture.table.dispatch('click',{target:icon,preventDefault(){},stopPropagation(){}});
  assert.deepEqual(changes,[{key:'code',direction:'ascending'}]);
  control.destroy();
});

test('共用控制只管理介面狀態且保留功能回呼',()=>{
  assert.match(source,/currentAvailableColumns\(\)[\s\S]*?columnIsAvailable/);
  assert.match(source,/function syncMenuToggles\(\)[\s\S]*?input\.checked = visibility\[input\.dataset\.uiTableColumnToggle\] !== false/);
  assert.match(source,/selectAll\.indeterminate = selected > 0 && selected < toggles\.length/);
  assert.match(source,/cell\.classList\.toggle\('is-column-hidden',!visible\)/);
  assert.match(source,/options\.onColumnsChanged\?\.\(/);
  assert.match(source,/options\.onSortChanged\?\.\(sortState\)/);
  assert.match(source,/data-ui-table-resize-handle/);
  assert.match(source,/window\.localStorage\?\.setItem/);
  assert.match(source,/handleResizeDoubleClick/);
  assert.match(source,/resetColumnWidths/);
  assert.match(source,/SORT_TRIGGER_SELECTOR = '\[data-ui-table-sort-trigger\]'/);
  assert.match(source,/function headerMinimumWidth\(column\)/);
  assert.match(source,/ti ti-arrows-horizontal/);
  assert.match(source,/createDualCopy\(\{vi:'Mặc định',zh:'恢復預設'\}\)/);
  assert.doesNotMatch(source,/userAccess|firebase|firestore|UID|canViewCosts|isAdmin/);
});
