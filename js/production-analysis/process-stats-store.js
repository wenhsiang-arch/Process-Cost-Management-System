// process-stats-store（工序分析摘要資料層）：把同一員工日的多次異動合併後，再更新工序統計與前二十名。
(function(){
  'use strict';

  const QUEUE_COLLECTION='productionProcessAnalysisQueue';
  const APPLIED_COLLECTION='productionProcessAnalysisAppliedDays';
  const STATS_COLLECTION='productionProcessAnalysisStats';
  const PENDING_BATCH_SIZE=20;
  const MAX_PENDING_PER_OPEN=200;

  function text(value){ return String(value??'').trim(); }
  function number(value){ const parsed=Number(value);return Number.isFinite(parsed)?parsed:0; }
  function round(value,digits=6){ const factor=10**digits;return Math.round((number(value)+Number.EPSILON)*factor)/factor; }
  function actor(){
    return {updatedAt:Date.now(),updatedByUid:text(window.firebaseAuthUser?.uid),
      updatedBy:text(window.cu?.user||window.cu?.username||window.firebaseAuthUser?.displayName).slice(0,200)};
  }
  function processId(key){ return encodeURIComponent(text(key)); }
  function mapProcesses(rows){ return new Map((Array.isArray(rows)?rows:[]).filter(item=>text(item.key)).map(item=>[text(item.key),item])); }
  function contribution(item){
    return {
      standardHours:round(item?.standardHours),inferredHours:round(item?.inferredHours),quantity:Math.max(0,Math.round(number(item?.quantity))),
      sampleCount:number(item?.inferredHours)>0&&number(item?.quantity)>0?1:0
    };
  }
  function median(values){
    const rows=values.filter(Number.isFinite).sort((a,b)=>a-b);
    if(!rows.length) return null;
    const middle=Math.floor(rows.length/2);
    return rows.length%2?rows[middle]:(rows[middle-1]+rows[middle])/2;
  }
  function average(values){ return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null; }
  function typical(rows,field){
    if(!rows.length) return {value:null,method:'none'};
    if(rows.length===1) return {value:rows[0][field],method:'single'};
    if(rows.length<10) return {value:median(rows.map(item=>item[field])),method:'median'};
    const ordered=rows.slice().sort((a,b)=>a.efficiency-b.efficiency);
    const trim=Math.floor(ordered.length*0.2);
    return {value:average(ordered.slice(trim,ordered.length-trim).map(item=>item[field])),method:'trimmed-middle-60'};
  }
  function updatedEmployeeTotals(current,employeeId,before,after){
    const totals={...(current||{})};
    const previous=totals[employeeId]||{standardHours:0,inferredHours:0,quantity:0,sampleCount:0};
    const next={
      standardHours:round(previous.standardHours-before.standardHours+after.standardHours),
      inferredHours:round(previous.inferredHours-before.inferredHours+after.inferredHours),
      quantity:Math.max(0,Math.round(number(previous.quantity)-before.quantity+after.quantity)),
      sampleCount:Math.max(0,Math.round(number(previous.sampleCount)-before.sampleCount+after.sampleCount))
    };
    if(next.standardHours<=0&&next.inferredHours<=0&&next.quantity<=0&&next.sampleCount<=0) delete totals[employeeId];
    else totals[employeeId]=next;
    return totals;
  }
  function buildStat(current,source,employeeTotals,currentActor){
    const rows=Object.entries(employeeTotals).map(([employeeId,item])=>{
      const standardHours=Math.max(0,number(item.standardHours));
      const inferredHours=Math.max(0,number(item.inferredHours));
      const quantity=Math.max(0,Math.round(number(item.quantity)));
      return {employeeId,standardHours,inferredHours,quantity,sampleCount:Math.max(0,Math.round(number(item.sampleCount))),
        efficiency:inferredHours>0?standardHours/inferredHours*100:null,
        suggestedSeconds:inferredHours>0&&quantity>0?inferredHours*3000/quantity:null};
    }).filter(item=>item.quantity>0||item.sampleCount>0);
    const usable=rows.filter(item=>item.efficiency!==null&&item.suggestedSeconds!==null);
    const typicalSeconds=typical(usable,'suggestedSeconds');
    const typicalEfficiency=typical(usable,'efficiency');
    const totalStandardHours=round(rows.reduce((sum,item)=>sum+item.standardHours,0));
    const totalInferredHours=round(rows.reduce((sum,item)=>sum+item.inferredHours,0));
    const totalQuantity=rows.reduce((sum,item)=>sum+item.quantity,0);
    const currentSeconds=Math.max(0,number(source?.processSecSnapshot||current?.currentSeconds));
    const suggestedSeconds=typicalSeconds.value==null?null:round(typicalSeconds.value,4);
    const differenceSeconds=suggestedSeconds==null?null:round(suggestedSeconds-currentSeconds,4);
    return {
      processAnalysisId:processId(source?.key||current?.key),key:text(source?.key||current?.key),
      productCode:text(source?.productCode||current?.productCode),processNo:text(source?.processNo||current?.processNo),
      processNameVi:text(source?.processNameVi||current?.processNameVi).slice(0,200),
      processNameZh:text(source?.processNameZh||current?.processNameZh).slice(0,200),
      currentSeconds,hourlyCapacitySnapshot:Math.max(0,number(source?.hourlyCapacitySnapshot||current?.hourlyCapacitySnapshot)),
      employeeTotals,totalStandardHours,totalInferredHours,totalQuantity,
      rawEfficiency:totalInferredHours>0?round(totalStandardHours/totalInferredHours*100,4):null,
      rawSuggestedSeconds:totalInferredHours>0&&totalQuantity>0?round(totalInferredHours*3000/totalQuantity,4):null,
      typicalEfficiency:typicalEfficiency.value==null?null:round(typicalEfficiency.value,4),suggestedSeconds,
      differenceSeconds,absoluteDifferenceSeconds:differenceSeconds==null?0:round(Math.abs(differenceSeconds),4),
      differencePercent:currentSeconds>0&&differenceSeconds!=null?round(differenceSeconds/currentSeconds*100,4):null,
      participantCount:usable.length,cumulativeStandardHours:totalStandardHours,
      method:typicalSeconds.method,sampleCount:rows.reduce((sum,item)=>sum+item.sampleCount,0),
      ...currentActor,schemaVersion:1
    };
  }
  async function processQueueDocument(reference){
    let finished=false;
    while(!finished){
      finished=await window._runTransaction(async transaction=>{
      const queueSnapshot=await transaction.get(reference);
      if(!queueSnapshot.exists()||queueSnapshot.data().status!=='pending') return true;
      const queue=queueSnapshot.data();
      const appliedReference=window._docRef(APPLIED_COLLECTION,queueSnapshot.id);
      const appliedSnapshot=await transaction.get(appliedReference);
      const applied=appliedSnapshot.exists()?appliedSnapshot.data():null;
      const before=mapProcesses(applied?.processes);
      const after=mapProcesses(queue.processes);
      const keys=[...new Set([...before.keys(),...after.keys()])];
      const currentActor=actor();
      const processed=Number(queue.processingRevision)===Number(queue.dayRevision)&&Array.isArray(queue.processedKeys)
        ?queue.processedKeys.map(text):[];
      const completed=new Set(processed);
      const key=keys.find(item=>!completed.has(item));
      if(key){
        const oldProcess=before.get(key);
        const newProcess=after.get(key);
        const statReference=window._docRef(STATS_COLLECTION,processId(key));
        const statSnapshot=await transaction.get(statReference);
        const current=statSnapshot.exists()?statSnapshot.data():null;
        const employeeTotals=updatedEmployeeTotals(current?.employeeTotals,queue.employeeId,contribution(oldProcess),contribution(newProcess));
        transaction.set(statReference,buildStat(current,newProcess||oldProcess,employeeTotals,currentActor));
        const checkpoint=new Map(before);
        if(newProcess) checkpoint.set(key,newProcess); else checkpoint.delete(key);
        transaction.set(appliedReference,{...queue,processes:[...checkpoint.values()],status:'processing',
          workingRevision:queue.dayRevision,appliedRevision:Number(applied?.appliedRevision)||0,
          appliedAt:currentActor.updatedAt,appliedByUid:currentActor.updatedByUid,appliedBy:currentActor.updatedBy});
        transaction.update(reference,{processingRevision:queue.dayRevision,processedKeys:[...processed,key],
          processingAt:currentActor.updatedAt,processingByUid:currentActor.updatedByUid,processingBy:currentActor.updatedBy});
        return false;
      }
      transaction.set(appliedReference,{...queue,status:'applied',appliedRevision:queue.dayRevision,
        appliedAt:currentActor.updatedAt,appliedByUid:currentActor.updatedByUid,appliedBy:currentActor.updatedBy});
      transaction.update(reference,{status:'processed',processedAt:currentActor.updatedAt,
        processedByUid:currentActor.updatedByUid,processedBy:currentActor.updatedBy});
      return true;
      },{skipDataVersions:true});
    }
    return true;
  }
  async function pendingBatch(){
    const snapshot=await window._getDocs(window._query(
      window._collection(QUEUE_COLLECTION),window._where('status','==','pending'),window._limit(PENDING_BATCH_SIZE)
    ));
    return snapshot.docs.map(item=>item.ref||window._docRef(QUEUE_COLLECTION,item.id));
  }
  async function syncPending(options={}){
    const maximum=Math.max(0,Math.min(1000,Math.round(number(options.max)||MAX_PENDING_PER_OPEN)));
    let processed=0;
    while(processed<maximum){
      const references=await pendingBatch();
      if(!references.length) return {processed,pending:false};
      for(const reference of references){
        if(processed>=maximum) break;
        if(await processQueueDocument(reference)) processed+=1;
      }
      if(references.length<PENDING_BATCH_SIZE) return {processed,pending:false};
    }
    return {processed,pending:true};
  }
  async function loadTop(limitCount=20){
    const maximum=Math.max(1,Math.min(20,Math.round(number(limitCount)||20)));
    const snapshot=await window._getDocs(window._query(
      window._collection(STATS_COLLECTION),window._orderBy('absoluteDifferenceSeconds','desc'),window._limit(maximum)
    ));
    return snapshot.docs.map(item=>({id:item.id,...item.data()})).filter(item=>item.sampleCount>0&&item.suggestedSeconds!=null);
  }
  async function syncAndLoadTop(limitCount=20){
    const sync=await syncPending();
    const rows=await loadTop(limitCount);
    return {rows,...sync};
  }

  window.PCMSProductionProcessStats=Object.freeze({processId,buildStat,syncPending,loadTop,syncAndLoadTop});
})();
