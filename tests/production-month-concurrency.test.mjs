import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=file=>fs.readFileSync(new URL(file,root),'utf8');
const scripts=[
  read('js/production/summary-store.js'),
  read('js/production/production-guard-store.js'),
  read('js/production/entry-store.js'),
  read('js/production/report-store.js'),
  read('js/production/attendance-store.js')
];

const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const keyOf=reference=>`${reference.collection}/${reference.id}`;

class SharedFirestore {
  constructor(){
    this.documents=new Map();
    this.sequence=0;
    this.retryCount=0;
    this.queryReads=0;
    this.race=null;
    this.commitTail=Promise.resolve();
  }

  seed(collection,id,data){
    this.documents.set(`${collection}/${id}`,{data:clone(data),version:1});
  }

  read(collection,id){
    return clone(this.documents.get(`${collection}/${id}`)?.data);
  }

  newReference(collection){
    this.sequence+=1;
    return {collection,id:`auto-${this.sequence}`};
  }

  snapshot(reference){
    const row=this.documents.get(keyOf(reference));
    return {
      id:reference.id,
      exists:()=>!!row,
      data:()=>clone(row?.data)
    };
  }

  armRace(participants=2){
    this.race={participants,arrivals:[]};
  }

  async waitForRace(priority){
    const race=this.race;
    if(!race) return ()=>{};
    return new Promise(resolve=>{
      race.arrivals.push({priority,resolve});
      if(race.arrivals.length!==race.participants) return;
      this.race=null;
      const ordered=race.arrivals.slice().sort((a,b)=>a.priority-b.priority);
      const release=index=>{
        const current=ordered[index];
        if(!current) return;
        current.resolve(()=>release(index+1));
      };
      release(0);
    });
  }

  async withCommitLock(task){
    const previous=this.commitTail;
    let release;
    this.commitTail=new Promise(resolve=>{ release=resolve; });
    await previous;
    try{ return task(); }
    finally{ release(); }
  }

  async runTransaction(task,{priority=10}={}){
    for(let attempt=1;attempt<=6;attempt+=1){
      const reads=new Map();
      const writes=[];
      const transaction={
        get:async reference=>{
          const key=keyOf(reference);
          const row=this.documents.get(key);
          if(!reads.has(key)) reads.set(key,row?.version||0);
          return this.snapshot(reference);
        },
        set:(reference,data,options={})=>writes.push({type:'set',reference,data:clone(data),merge:options?.merge===true}),
        delete:reference=>writes.push({type:'delete',reference})
      };
      let result;
      try{ result=await task(transaction); }
      catch(error){ throw error; }
      const releaseRace=attempt===1?await this.waitForRace(priority):()=>{};
      const committed=await this.withCommitLock(()=>{
        const conflicted=[...reads].some(([key,version])=>(this.documents.get(key)?.version||0)!==version);
        if(conflicted) return false;
        writes.forEach(write=>{
          const key=keyOf(write.reference);
          const current=this.documents.get(key);
          if(write.type==='delete') this.documents.delete(key);
          else this.documents.set(key,{
            data:write.merge?{...(current?.data||{}),...clone(write.data)}:clone(write.data),
            version:(current?.version||0)+1
          });
        });
        return true;
      });
      releaseRace();
      if(committed) return result;
      this.retryCount+=1;
    }
    throw new Error('交易重試次數已超過測試上限');
  }

  async getDocs(query){
    this.queryReads+=1;
    const rows=[];
    for(const [key,row] of this.documents){
      const separator=key.indexOf('/');
      const collection=key.slice(0,separator);
      const id=key.slice(separator+1);
      if(collection!==query.collection) continue;
      const matches=query.conditions.every(condition=>{
        if(condition.type!=='where') return true;
        const value=row.data?.[condition.field];
        if(condition.operator==='==') return value===condition.value;
        if(condition.operator==='>=') return value>=condition.value;
        if(condition.operator==='<=') return value<=condition.value;
        return true;
      });
      if(matches) rows.push({id,data:()=>clone(row.data)});
    }
    const order=query.conditions.find(condition=>condition.type==='orderBy');
    if(order) rows.sort((a,b)=>{
      const left=a.data()?.[order.field];
      const right=b.data()?.[order.field];
      const result=String(left??'').localeCompare(String(right??''));
      return order.direction==='desc'?-result:result;
    });
    const limit=query.conditions.find(condition=>condition.type==='limit')?.value;
    const limited=Number.isInteger(limit)?rows.slice(0,limit):rows;
    return {docs:limited,size:limited.length};
  }
}

function createBrowser(database,{uid='clerk-a',name='文員 A',priority=10}={}){
  const cache=new Map();
  const cacheStats={reads:0,writes:0};
  const window={
    firebaseAuthUser:{uid},
    cu:{role:'clerk',user:name},
    PCMSProductionEmployees:{normalizeEmployeeId:value=>String(value||'').trim().toUpperCase()},
    PCMSFeatures:{invalidateDataScopes:()=>{}},
    pcmsDataCache:{
      async read(scope,version){
        cacheStats.reads+=1;
        const row=cache.get(scope);
        return row?.version===version?clone(row.data):null;
      },
      async write(scope,version,data){ cacheStats.writes+=1;cache.set(scope,{version,data:clone(data)}); },
      async remove(scope){ cache.delete(scope); }
    },
    _docRef:(collection,id)=>({collection,id}),
    _newDocRef:collection=>database.newReference(collection),
    _runTransaction:(task,options={})=>database.runTransaction(task,{...options,priority}),
    _getDoc:async reference=>database.snapshot(reference),
    _collection:collection=>collection,
    _where:(field,operator,value)=>({type:'where',field,operator,value}),
    _orderBy:(field,direction='asc')=>({type:'orderBy',field,direction}),
    _limit:value=>({type:'limit',value}),
    _startAfter:snapshot=>({type:'startAfter',snapshot}),
    _query:(collection,...conditions)=>({collection,conditions}),
    _getDocs:query=>database.getDocs(query)
  };
  const context={window,console,Map,Set,Object,Array,String,Number,Math,Date,Error,RegExp,Promise,JSON,encodeURIComponent,setTimeout,clearTimeout};
  vm.createContext(context);
  scripts.forEach(source=>vm.runInContext(source,context));
  return {window,cacheStats};
}

function createEnvironment({status='open',summaryReady=true,revision=1}={}){
  const database=new SharedFirestore();
  database.seed('productionMonths','2026-08',{
    month:'2026-08',status,entriesVersion:'entries-1',attendanceVersion:'attendance-1',
    summaryVersion:'summary-1',summaryReady,revision,updatedAt:1,updatedByUid:'migration',
    updatedBy:'migration',schemaVersion:2
  });
  database.seed('productionEmployees','M00001',{
    employeeId:'M00001',name:'NHÂN VIÊN 1',department:'May',active:true
  });
  database.seed('productionAttendance','2026-08-15__M00001',{
    attendanceId:'2026-08-15__M00001',attendanceDate:'2026-08-15',employeeId:'M00001',
    employeeName:'NHÂN VIÊN 1',department:'May',normalHours:8,overtimeHours:0,note:'',
    revision:1,createdAt:1,createdByUid:'migration',createdBy:'migration',updatedAt:1,
    updatedByUid:'migration',updatedBy:'migration',schemaVersion:1
  });
  return {database};
}

function supplement(browser,hours=1){
  return browser.window.PCMSProductionEntryStore.createEntry({
    productionDate:'2026-08-15',employeeId:'M00001',orderId:'',productCode:'',
    processNo:'0',supplementReason:'測試',supplementHours:hours
  });
}

function attendance(browser,normalHours,overtimeHours=0){
  return browser.window.PCMSProductionAttendance.saveMany([{
    attendanceDate:'2026-08-15',employeeId:'M00001',normalHours,overtimeHours,note:''
  }]);
}

async function transitionMonth(database,status,{summaryReady=status!=='migrating',priority=0}={}){
  return database.runTransaction(async transaction=>{
    const reference={collection:'productionMonths',id:'2026-08'};
    const snapshot=await transaction.get(reference);
    const current=snapshot.data();
    transaction.set(reference,{
      status,summaryReady,revision:Number(current.revision)+1,
      updatedAt:Date.now(),updatedByUid:'manager',updatedBy:'管理者'
    },{merge:true});
  },{priority});
}

test('兩個瀏覽器同時報工，交易重試後兩筆報工與摘要都保留',async()=>{
  const {database}=createEnvironment();
  const browserA=createBrowser(database,{uid:'clerk-a',name:'文員 A'});
  const browserB=createBrowser(database,{uid:'clerk-b',name:'文員 B'});
  database.armRace(2);
  await Promise.all([supplement(browserA),supplement(browserB)]);
  const day=database.read('productionDaySummaries','2026-08-15__M00001');
  const month=database.read('productionEmployeeMonths','2026-08__M00001');
  assert.equal([...database.documents.keys()].filter(key=>key.startsWith('productionEntries/')).length,2);
  assert.equal(day.activeEntryCount,2);
  assert.equal(day.activeSupplementHours,2);
  assert.equal(month.activeEntryCount,2);
});

test('兩個瀏覽器同時修改考勤，最後考勤與日月摘要保持相同',async()=>{
  const {database}=createEnvironment();
  const browserA=createBrowser(database,{uid:'clerk-a'});
  const browserB=createBrowser(database,{uid:'clerk-b'});
  database.armRace(2);
  await Promise.all([attendance(browserA,8,0),attendance(browserB,8,2)]);
  const saved=database.read('productionAttendance','2026-08-15__M00001');
  const day=database.read('productionDaySummaries','2026-08-15__M00001');
  const month=database.read('productionEmployeeMonths','2026-08__M00001');
  assert.equal(day.attendanceHours,saved.normalHours+saved.overtimeHours);
  assert.equal(month.attendanceHours,day.attendanceHours);
  assert.equal(database.read('productionMonths','2026-08').revision,1);
});

test('報工與考勤同時發生，來源及摘要在重試後完整合併',async()=>{
  const {database}=createEnvironment();
  const entryBrowser=createBrowser(database,{uid:'entry-user'});
  const attendanceBrowser=createBrowser(database,{uid:'attendance-user'});
  database.armRace(2);
  await Promise.all([supplement(entryBrowser),attendance(attendanceBrowser,8,2)]);
  const day=database.read('productionDaySummaries','2026-08-15__M00001');
  assert.equal(day.activeEntryCount,1);
  assert.equal(day.activeSupplementHours,1);
  assert.equal(day.attendanceHours,10);
  assert.equal(database.read('productionEmployeeMonths','2026-08__M00001').attendanceHours,10);
});

test('月份鎖定同時有人報工，鎖定先成功且報工整筆取消',async()=>{
  const {database}=createEnvironment();
  const browser=createBrowser(database,{uid:'entry-user',priority:10});
  database.armRace(2);
  const results=await Promise.allSettled([
    transitionMonth(database,'locked',{priority:0}),
    supplement(browser)
  ]);
  assert.equal(results[0].status,'fulfilled');
  assert.equal(results[1].status,'rejected');
  assert.equal(database.read('productionMonths','2026-08').status,'locked');
  assert.equal([...database.documents.keys()].some(key=>key.startsWith('productionEntries/')),false);
});

test('月份解鎖後可以重新報工，只有狀態轉換增加 revision',async()=>{
  const {database}=createEnvironment({status:'locked',revision:2});
  const browser=createBrowser(database,{uid:'entry-user'});
  await transitionMonth(database,'open');
  await supplement(browser);
  const month=database.read('productionMonths','2026-08');
  assert.equal(month.status,'open');
  assert.equal(month.revision,3);
  assert.equal(month.entriesVersion,month.summaryVersion);
});

test('Migration／摘要重建開始時有人報工，重建狀態成功且報工整筆取消',async()=>{
  const {database}=createEnvironment();
  const browser=createBrowser(database,{uid:'entry-user',priority:10});
  database.armRace(2);
  const results=await Promise.allSettled([
    transitionMonth(database,'migrating',{summaryReady:false,priority:0}),
    supplement(browser)
  ]);
  assert.equal(results[0].status,'fulfilled');
  assert.equal(results[1].status,'rejected');
  const month=database.read('productionMonths','2026-08');
  assert.equal(month.status,'migrating');
  assert.equal(month.summaryReady,false);
  assert.equal(month.entriesVersion,'entries-1');
  assert.equal(month.summaryVersion,'summary-1');
});

test('productionMonths 版本變更後另一個瀏覽器的月份摘要快取必須失效',async()=>{
  const {database}=createEnvironment();
  const writer=createBrowser(database,{uid:'entry-user'});
  const reader=createBrowser(database,{uid:'analysis-user'});
  assert.deepEqual(await reader.window.PCMSProductionSummaries.loadEmployeeMonths('2026-08'),[]);
  assert.equal(database.queryReads,1);
  await supplement(writer);
  const refreshed=await reader.window.PCMSProductionSummaries.loadEmployeeMonths('2026-08');
  assert.equal(refreshed.length,1);
  assert.equal(refreshed[0].activeEntryCount,1);
  assert.equal(database.queryReads,2);
});

test('Transaction 重試後來源版本、summaryVersion 與摘要仍一致',async()=>{
  const {database}=createEnvironment();
  const browserA=createBrowser(database,{uid:'clerk-a'});
  const browserB=createBrowser(database,{uid:'clerk-b'});
  database.armRace(2);
  await Promise.all([supplement(browserA,1),supplement(browserB,1.5)]);
  const control=database.read('productionMonths','2026-08');
  const day=database.read('productionDaySummaries','2026-08-15__M00001');
  const employeeMonth=database.read('productionEmployeeMonths','2026-08__M00001');
  assert.ok(database.retryCount>=1);
  assert.equal(control.entriesVersion,control.summaryVersion);
  assert.equal(control.revision,1);
  assert.equal(day.activeSupplementHours,2.5);
  assert.equal(employeeMonth.supplementHours,2.5);
});

test('另一個瀏覽器的產能紀錄快取依 entriesVersion 失效',async()=>{
  const {database}=createEnvironment();
  const writer=createBrowser(database,{uid:'entry-user'});
  const reader=createBrowser(database,{uid:'records-user'});
  assert.equal((await reader.window.PCMSProductionReports.loadDaily('M00001','2026-08-15')).length,0);
  const firstQueryCount=database.queryReads;
  await supplement(writer);
  const rows=await reader.window.PCMSProductionReports.loadDaily('M00001','2026-08-15');
  assert.equal(rows.length,1);
  assert.equal(rows[0].supplementHours,1);
  assert.equal(database.queryReads,firstQueryCount+1);
});

test('另一個瀏覽器的考勤日快取依 attendanceVersion 失效',async()=>{
  const {database}=createEnvironment();
  const writer=createBrowser(database,{uid:'attendance-user'});
  const reader=createBrowser(database,{uid:'attendance-reader'});
  assert.equal((await reader.window.PCMSProductionAttendance.loadDay('2026-08-15'))[0].overtimeHours,0);
  const firstQueryCount=database.queryReads;
  await attendance(writer,8,2);
  const rows=await reader.window.PCMSProductionAttendance.loadDay('2026-08-15');
  assert.equal(rows[0].overtimeHours,2);
  assert.equal(database.queryReads,firstQueryCount+1);
});
