// bonus-lock-service（獎金鎖定服務）：新鎖定只保存目前獎金結果；舊版完整月份快照維持唯讀相容。
(function(){
  'use strict';

  const SNAPSHOT_COLLECTION='performanceBonusSnapshots';
  const CHUNK_COLLECTION='performanceBonusSnapshotChunks';
  const MONTH_COLLECTION='performanceBonusMonths';
  const PRODUCTION_MONTH_COLLECTION='productionMonths';
  const LOG_COLLECTION='operationLogs';
  const SNAPSHOT_SCHEMA_VERSION=1;
  const CURRENT_RESULT_SCHEMA_VERSION=1;
  const CURRENT_RESULT_TEXT_LIMIT=220000; // 目前有效獎金結果保守控制在 Firestore 單一文件安全範圍內。
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
  function snapshotData(snapshot){ return snapshot?.exists?.()?{id:snapshot.id,...snapshot.data()}:null; }
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
  function joinJson(parts,expectedHash=''){
    const source=(parts||[]).join('');
    if(expectedHash&&hashText(source)!==text(expectedHash)){
      throw new Error('Ảnh chụp tháng không đầy đủ. / 月份快照不完整。');
    }
    return JSON.parse(source);
  }
  function snapshotRef(snapshotId){ return window._docRef(SNAPSHOT_COLLECTION,text(snapshotId)); }
  // 舊快照只讀取既有分段，不再產生或寫入新快照。
  function chunkIdFor(snapshotId,index){ return `${text(snapshotId)}__${Number(index)}`; }
  function chunkRef(snapshotId,index){ return window._docRef(CHUNK_COLLECTION,chunkIdFor(snapshotId,index)); }
  function monthRef(month){ return window._docRef(MONTH_COLLECTION,requireMonth(month)); }
  function productionMonthRef(month){ return window._docRef(PRODUCTION_MONTH_COLLECTION,requireMonth(month)); }
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
  function lockLog(current,lockedAt,operationLogId,lockRevision,controlRevision){
    const who=actor();
    const employees=current?.employees||[];
    return {permissionKey:'performanceBonus',feature:'performanceBonus',action:'performanceBonusLock',status:'success',
      targetType:'performanceBonusMonth',targetId:current?.metadata?.month,note:String(current?.metadata?.month||''),
      itemCount:employees.length,detailCount:employees.filter(item=>Number(item.finalBonus)>0).length,
      createdAt:lockedAt,createdByUid:who.uid,createdBy:who.name,
      changes:[{field:'status',before:'open',after:'locked'}],operationLogId,
      targetRevision:lockRevision,controlRevision,schemaVersion:2};
  }
  async function lockMonth(month,current,options={}){
    const normalized=requireMonth(month);
    const controlSnapshot=await window._getDoc(productionMonthRef(normalized));
    const control=snapshotData(controlSnapshot);
    if(control?.status==='locked'){
      const existing=snapshotData(await window._getDoc(monthRef(normalized)));
      if(existing&&LOCKED_STATUSES.has(existing.status)) return existing;
    }
    if(!control||control.status!=='open'||control.summaryReady!==true){
      throw new Error('Tháng chưa sẵn sàng để khóa. / 月份尚未準備好鎖定。');
    }
    const expected={entriesVersion:text(current?.metadata?.sourceEntriesVersion)||'0',
      attendanceVersion:text(current?.metadata?.sourceAttendanceVersion)||'0',summaryVersion:text(current?.metadata?.sourceSummaryVersion)||'0'};
    if(!sameSource(stateFromControl(control),expected)) throw new Error('Dữ liệu vừa thay đổi, vui lòng thử khóa lại. / 資料剛有變動，請重新執行鎖定。');
    const frozenEmployees=clone(current?.employees||[]);
    if(JSON.stringify(frozenEmployees).length>CURRENT_RESULT_TEXT_LIMIT){
      throw new Error('Kết quả thưởng tháng quá lớn để khóa an toàn. / 月份獎金結果過大，無法安全鎖定。');
    }
    const lockedAt=Date.now();
    const logReference=window._newDocRef(LOG_COLLECTION);
    const operationLogId=logReference.id;
    let saved=null;
    await window._runTransaction(async transaction=>{
      const [latestControlSnapshot,monthSnapshot]=await Promise.all([
        transaction.get(productionMonthRef(normalized)),transaction.get(monthRef(normalized))
      ]);
      const latestControl=latestControlSnapshot.exists()?latestControlSnapshot.data():null;
      const previousMonth=monthSnapshot.exists()?monthSnapshot.data():{};
      if(LOCKED_STATUSES.has(previousMonth.status)){
        saved={...previousMonth};return;
      }
      if(!latestControl||latestControl.status!=='open'||latestControl.summaryReady!==true||!sameSource(stateFromControl(latestControl),expected)){
        throw new Error('Dữ liệu vừa thay đổi, vui lòng thử khóa lại. / 資料剛有變動，請重新執行鎖定。');
      }
      const who=actor();
      const lockRevision=(Number(previousMonth.lockRevision)||0)+1;
      const controlRevision=(Number(latestControl.revision)||0)+1;
      saved={...clone(current.metadata),status:'locked',frozenEmployees,
        currentResultSchemaVersion:CURRENT_RESULT_SCHEMA_VERSION,operationLogId,
        lockedAt,lockedByUid:who.uid,lockedBy:who.name,lockRevision,
        updatedAt:lockedAt,updatedByUid:who.uid,updatedBy:who.name};
      delete saved.snapshotId;
      delete saved.snapshotSchemaVersion;
      delete saved.unlockedAt;
      delete saved.unlockedByUid;
      delete saved.unlockedBy;
      delete saved.unlockReason;
      transaction.set(monthRef(normalized),saved);
      transaction.set(productionMonthRef(normalized),{...latestControl,status:'locked',revision:controlRevision,
        lockedAt,lockedByUid:who.uid,lockedBy:who.name,updatedAt:lockedAt,updatedByUid:who.uid,updatedBy:who.name,operationLogId});
      transaction.set(logReference,lockLog(current,lockedAt,operationLogId,lockRevision,controlRevision));
    },{skipDataVersions:true});
    return saved;
  }

  window.PCMSPerformanceBonusLockService=Object.freeze({
    SNAPSHOT_COLLECTION,CHUNK_COLLECTION,SNAPSHOT_SCHEMA_VERSION,CURRENT_RESULT_SCHEMA_VERSION,hashText,joinJson,
    readSnapshot,lockMonth
  });
})();
