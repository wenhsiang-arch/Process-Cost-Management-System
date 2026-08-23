// bonus-lock-service（獎金鎖定服務）：分段保存完整月份快照，最後一次交易才正式鎖定月份。
(function(){
  'use strict';

  const SNAPSHOT_COLLECTION='performanceBonusSnapshots';
  const CHUNK_COLLECTION='performanceBonusSnapshotChunks';
  const MONTH_COLLECTION='performanceBonusMonths';
  const PRODUCTION_MONTH_COLLECTION='productionMonths';
  const LOG_COLLECTION='operationLogs';
  const SNAPSHOT_SCHEMA_VERSION=1;
  const CHUNK_TEXT_LENGTH=180000; // 最多約 540KB UTF-8，保留 Firestore 文件大小安全空間。
  const BATCH_WRITE_LIMIT=300;
  const LOCKED_STATUSES=new Set(['locked','exported','paid']);

  function text(value){ return String(value??'').trim(); }
  function clone(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function requireMonth(value){
    const month=text(value);
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Tháng không hợp lệ. / 月份不正確。');
    return month;
  }
  function actor(){
    const user=window.firebaseAuthUser||{};
    const profile=window.cu||{};
    return {
      uid:text(user.uid||profile.authUid||profile.uid),
      name:text(profile.user||profile.username||profile.displayName||profile.email||user.uid||'unknown').slice(0,200)
    };
  }
  function monthRange(month){
    const normalized=requireMonth(month);
    const [year,number]=normalized.split('-').map(Number);
    return {from:`${normalized}-01`,to:`${normalized}-${String(new Date(year,number,0).getDate()).padStart(2,'0')}`};
  }
  function snapshotData(snapshot){ return snapshot?.exists?.()?{id:snapshot.id,...snapshot.data()}:null; }
  function documentRows(snapshot){ return (snapshot?.docs||[]).map(item=>({id:item.id,...item.data()})); }
  function unique(values){ return [...new Set((values||[]).map(text).filter(Boolean))].sort(); }
  function stateFromControl(value={}){
    return {
      entriesVersion:text(value.entriesVersion)||'0',attendanceVersion:text(value.attendanceVersion)||'0',
      summaryVersion:text(value.summaryVersion)||'0',revision:Number(value.revision)||0,
      status:text(value.status),summaryReady:value.summaryReady===true
    };
  }
  function sameSource(left,right){
    return text(left.entriesVersion)===text(right.entriesVersion)
      &&text(left.attendanceVersion)===text(right.attendanceVersion)
      &&text(left.summaryVersion)===text(right.summaryVersion);
  }
  function hashText(value){
    const source=String(value??'');
    let first=0x811c9dc5,second=0x9e3779b9;
    for(let index=0;index<source.length;index+=1){
      const code=source.charCodeAt(index);
      first=Math.imul(first^code,0x01000193)>>>0;
      second=Math.imul(second^(code+index),0x85ebca6b)>>>0;
    }
    return `${first.toString(36).padStart(7,'0')}${second.toString(36).padStart(7,'0')}`;
  }
  function splitJson(value,maxLength=CHUNK_TEXT_LENGTH){
    const source=JSON.stringify(value);
    const parts=[];
    for(let start=0;start<source.length;){
      let end=Math.min(source.length,start+Math.max(1000,Number(maxLength)||CHUNK_TEXT_LENGTH));
      if(end<source.length&&/[\uD800-\uDBFF]/.test(source.charAt(end-1))) end-=1;
      parts.push(source.slice(start,end));
      start=end;
    }
    return {json:source,parts:parts.length?parts:[''],hash:hashText(source)};
  }
  function joinJson(parts,expectedHash=''){
    const source=(parts||[]).join('');
    if(expectedHash&&hashText(source)!==text(expectedHash)){
      throw new Error('Ảnh chụp tháng không đầy đủ. / 月份快照不完整。');
    }
    return JSON.parse(source);
  }
  async function queryRange(collection,field,range){
    const query=window._query(window._collection(collection),window._where(field,'>=',range.from),window._where(field,'<=',range.to));
    return documentRows(await window._getDocs(query));
  }
  async function readByIds(collection,ids){
    const rows=await Promise.all(unique(ids).map(async id=>snapshotData(await window._getDoc(window._docRef(collection,id)))));
    return rows.filter(Boolean);
  }
  function analysisSnapshot(resolvedSummaries,range){
    const calculations=window.PCMSProductionAnalysisCalculations;
    if(!calculations?.buildDatasetFromMonthSummaries) return {calculationVersion:'',employees:[],processes:[],departments:[]};
    const filters={fromDate:range.from,toDate:range.to};
    const dataset=calculations.buildDatasetFromMonthSummaries(resolvedSummaries,filters);
    return {
      calculationVersion:text(calculations.calculationVersion),
      employees:calculations.employeeAnalysisRows(dataset,filters),
      processes:calculations.ieAnalysisRows(dataset,filters),
      departments:calculations.departmentAnalysisRows(dataset,filters)
    };
  }
  function buildSnapshotPayload(input={}){
    const month=requireMonth(input.month);
    const range=monthRange(month);
    const rawSummaries=clone(input.rawSummaries||[]);
    const resolvedSummaries=clone(input.resolvedSummaries||[]);
    const summaryStore=window.PCMSProductionSummaries;
    const performance=summaryStore?.performanceRows
      ?summaryStore.performanceRows(resolvedSummaries,range.from,range.to):[];
    return {
      snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,month,sourceState:clone(input.sourceState||{}),
      frozenAt:Number(input.frozenAt)||Date.now(),frozenBy:clone(input.frozenBy||actor()),
      productMaster:{products:clone(input.products||[])},
      orderContext:{orders:clone(input.orders||[]),orderItems:clone(input.orderItems||[])},
      production:{entries:clone(input.entries||[]),attendance:clone(input.attendance||[]),rawSummaries,resolvedSummaries},
      analysis:clone(input.analysis||analysisSnapshot(resolvedSummaries,range)),
      performance:clone(input.performance||performance),
      bonus:{metadata:clone(input.current?.metadata||{}),employees:clone(input.current?.employees||[]),referenceTable:clone(input.referenceTable||null)}
    };
  }
  async function captureSnapshot(month,current,control){
    const normalized=requireMonth(month);
    const range=monthRange(normalized);
    const summaryStore=window.PCMSProductionSummaries;
    if(!summaryStore?.loadRawEmployeeMonths||!summaryStore?.loadEmployeeMonths){
      throw new Error('Bộ nhớ tóm tắt mới chưa sẵn sàng. / 新月摘要程式尚未載入。');
    }
    const sourceState=stateFromControl(control);
    const [rawSummaries,resolvedSummaries,entries,attendance,referenceTable]=await Promise.all([
      summaryStore.loadRawEmployeeMonths(normalized,{version:sourceState.summaryVersion,force:true}),
      summaryStore.loadEmployeeMonths(normalized,{version:sourceState.summaryVersion,force:true}),
      queryRange('productionEntries','productionDate',range),queryRange('productionAttendance','attendanceDate',range),
      window._getDoc(window._docRef('performanceBonusTables','current')).then(snapshotData)
    ]);
    const orderItems=await readByIds('orderItems',entries.map(item=>item.orderItemId));
    const orders=await readByIds('orders',[...entries.map(item=>item.orderId),...orderItems.map(item=>item.orderId)]);
    const products=await readByIds('products',[...entries.map(item=>item.productId),...orderItems.map(item=>item.productId)]);
    return buildSnapshotPayload({month:normalized,current,sourceState,rawSummaries,resolvedSummaries,entries,attendance,
      orderItems,orders,products,referenceTable,frozenAt:Date.now(),frozenBy:actor()});
  }
  function snapshotIdFor(payload,hash){
    return `pbs_${payload.month.replace('-','')}_${hashText(`${payload.month}|${hash}|${payload.sourceState.summaryVersion||'0'}`)}`;
  }
  function operationLogIdFor(snapshotId){ return `pbl_${text(snapshotId)}`; }
  function snapshotRef(snapshotId){ return window._docRef(SNAPSHOT_COLLECTION,text(snapshotId)); }
  // 區塊明確保存前一段與最後一段識別碼，讓 Security Rules（安全規則）驗證完整連續鏈。
  function chunkIdFor(snapshotId,index){ return `${text(snapshotId)}__${Number(index)}`; }
  function chunkRef(snapshotId,index){ return window._docRef(CHUNK_COLLECTION,chunkIdFor(snapshotId,index)); }
  function monthRef(month){ return window._docRef(MONTH_COLLECTION,requireMonth(month)); }
  function productionMonthRef(month){ return window._docRef(PRODUCTION_MONTH_COLLECTION,requireMonth(month)); }
  async function stageSnapshot(payload){
    const encoded=splitJson(payload);
    const snapshotId=snapshotIdFor(payload,encoded.hash);
    const timestamp=Date.now();
    const manifest={snapshotId,month:payload.month,state:'staging',payloadHash:encoded.hash,chunkCount:encoded.parts.length,
      lastChunkId:chunkIdFor(snapshotId,encoded.parts.length-1),
      sourceState:clone(payload.sourceState),createdAt:timestamp,createdByUid:actor().uid,schemaVersion:SNAPSHOT_SCHEMA_VERSION};
    const writes=[{reference:snapshotRef(snapshotId),data:manifest},...encoded.parts.map((part,index)=>({
      reference:chunkRef(snapshotId,index),data:{chunkId:chunkIdFor(snapshotId,index),snapshotId,index,
        previousChunkId:index>0?chunkIdFor(snapshotId,index-1):'',totalParts:encoded.parts.length,payloadPart:part,
        payloadHash:encoded.hash,state:'staged',schemaVersion:SNAPSHOT_SCHEMA_VERSION}
    }))];
    for(let offset=0;offset<writes.length;offset+=BATCH_WRITE_LIMIT){
      const batch=window._writeBatch({skipDataVersions:true});
      writes.slice(offset,offset+BATCH_WRITE_LIMIT).forEach(item=>batch.set(item.reference,item.data));
      await batch.commit();
    }
    return manifest;
  }
  async function readSnapshot(snapshotId){
    const manifest=snapshotData(await window._getDoc(snapshotRef(snapshotId)));
    if(!manifest||manifest.state!=='locked') throw new Error('Không tìm thấy ảnh chụp tháng đã khóa. / 找不到已鎖定月份快照。');
    const snapshots=await Promise.all(Array.from({length:Number(manifest.chunkCount)||0},(_,index)=>window._getDoc(chunkRef(snapshotId,index))));
    const parts=snapshots.map((snapshot,index)=>{
      const row=snapshotData(snapshot);
      if(!row||Number(row.index)!==index||row.snapshotId!==snapshotId) throw new Error('Ảnh chụp tháng không đầy đủ. / 月份快照不完整。');
      return row.payloadPart;
    });
    return joinJson(parts,manifest.payloadHash);
  }
  function lockLog(payload,snapshotId,lockedAt,operationLogId,lockRevision,controlRevision){
    const who=actor();
    const employees=payload.bonus?.employees||[];
    return {permissionKey:'performanceBonus',feature:'performanceBonus',action:'performanceBonusLock',status:'success',
      targetType:'performanceBonusMonth',targetId:payload.month,note:`${payload.month} · ${snapshotId}`,
      itemCount:employees.length,detailCount:employees.filter(item=>Number(item.finalBonus)>0).length,
      createdAt:lockedAt,createdByUid:who.uid,createdBy:who.name,
      changes:[{field:'status',before:'open',after:'locked'}],snapshotId,operationLogId,
      targetRevision:lockRevision,controlRevision,schemaVersion:2};
  }
  async function lockMonth(month,current,options={}){
    const normalized=requireMonth(month);
    const controlSnapshot=await window._getDoc(productionMonthRef(normalized));
    const control=snapshotData(controlSnapshot);
    if(!control||control.status!=='open'||control.summaryReady!==true){
      throw new Error('Tháng chưa sẵn sàng để khóa. / 月份尚未準備好鎖定。');
    }
    const expected={entriesVersion:text(current?.metadata?.sourceEntriesVersion)||'0',
      attendanceVersion:text(current?.metadata?.sourceAttendanceVersion)||'0',summaryVersion:text(current?.metadata?.sourceSummaryVersion)||'0'};
    if(!sameSource(stateFromControl(control),expected)) throw new Error('Dữ liệu vừa thay đổi, vui lòng thử khóa lại. / 資料剛有變動，請重新執行鎖定。');
    const payload=options.payload||await captureSnapshot(normalized,current,control);
    if(!sameSource(payload.sourceState,expected)) throw new Error('Dữ liệu vừa thay đổi, vui lòng thử khóa lại. / 資料剛有變動，請重新執行鎖定。');
    const manifest=await stageSnapshot(payload);
    const lockedAt=Date.now();
    const operationLogId=operationLogIdFor(manifest.snapshotId);
    let saved=null;
    await window._runTransaction(async transaction=>{
      const [latestControlSnapshot,monthSnapshot,manifestSnapshot]=await Promise.all([
        transaction.get(productionMonthRef(normalized)),transaction.get(monthRef(normalized)),transaction.get(snapshotRef(manifest.snapshotId))
      ]);
      const latestControl=latestControlSnapshot.exists()?latestControlSnapshot.data():null;
      const previousMonth=monthSnapshot.exists()?monthSnapshot.data():{};
      if(LOCKED_STATUSES.has(previousMonth.status)){
        if(previousMonth.snapshotId===manifest.snapshotId){ saved={...previousMonth};return; }
        throw new Error('Tháng đã được khóa bằng ảnh chụp khác. / 月份已由另一份快照鎖定。');
      }
      if(!latestControl||latestControl.status!=='open'||latestControl.summaryReady!==true||!sameSource(stateFromControl(latestControl),expected)){
        throw new Error('Dữ liệu vừa thay đổi, vui lòng thử khóa lại. / 資料剛有變動，請重新執行鎖定。');
      }
      if(!manifestSnapshot.exists()||manifestSnapshot.data().payloadHash!==manifest.payloadHash){
        throw new Error('Ảnh chụp tháng chưa hoàn chỉnh. / 月份快照尚未完整。');
      }
      const who=actor();
      const lockRevision=(Number(previousMonth.lockRevision)||0)+1;
      const controlRevision=(Number(latestControl.revision)||0)+1;
      saved={...clone(current.metadata),status:'locked',snapshotId:manifest.snapshotId,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,
        operationLogId,
        lockedAt,lockedByUid:who.uid,lockedBy:who.name,lockRevision,
        updatedAt:lockedAt,updatedByUid:who.uid,updatedBy:who.name};
      delete saved.frozenEmployees;
      transaction.set(monthRef(normalized),saved);
      transaction.set(productionMonthRef(normalized),{...latestControl,status:'locked',revision:controlRevision,
        lockedAt,lockedByUid:who.uid,lockedBy:who.name,updatedAt:lockedAt,updatedByUid:who.uid,updatedBy:who.name,operationLogId});
      transaction.set(snapshotRef(manifest.snapshotId),{
        ...manifest,state:'locked',operationLogId,lockedAt,lockedByUid:who.uid
      });
      transaction.set(window._docRef(LOG_COLLECTION,operationLogId),
        lockLog(payload,manifest.snapshotId,lockedAt,operationLogId,lockRevision,controlRevision));
    },{skipDataVersions:true});
    return saved;
  }

  window.PCMSPerformanceBonusLockService=Object.freeze({
    SNAPSHOT_COLLECTION,CHUNK_COLLECTION,SNAPSHOT_SCHEMA_VERSION,hashText,splitJson,joinJson,
    buildSnapshotPayload,captureSnapshot,stageSnapshot,readSnapshot,lockMonth
  });
})();
