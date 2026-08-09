// cost-log（成本歷史畫面）：只處理成本變動表格、右側補充設定及重新整理。
(function(){
  const PRIMARY_FIELDS=Object.freeze([
    {key:'平均薪資',vi:'Lương TB',zh:'平均薪資'},
    {key:'平均保險',vi:'Bảo hiểm TB',zh:'平均保險'},
    {key:'餐費',vi:'Tiền ăn',zh:'餐費'},
    {key:'每月總成本',vi:'Tổng tháng',zh:'每月總成本'},
    {key:'平均時薪',vi:'Lương giờ TB',zh:'平均時薪'},
    {key:'匯率USD',vi:'Tỷ giá USD',zh:'美元匯率'},
    {key:'匯率TWD',vi:'Tỷ giá TWD',zh:'台幣匯率'}
  ]); // PRIMARY_FIELDS（預設顯示的成本設定）。
  const EXTRA_FIELDS=Object.freeze([
    {key:'工作秒數/小時',vi:'Giây làm việc/giờ',zh:'每小時工作秒數'},
    {key:'生產效率(%)',vi:'Hiệu suất',zh:'生產效率',suffix:'%'}
  ]); // EXTRA_FIELDS（按箭頭後向右展開的補充設定）。
  let extraExpanded=false; // extraExpanded（補充設定是否已展開）。

  function safeText(value){
    return window.PCMSSafe.text(value);
  }

  function formatHistoryTime(log){
    if(!log?.createdAt) return String(log?.t||'');
    return new Date(log.createdAt).toLocaleString('zh-TW',{hour12:false});
  }

  function normalizeHistoryChanges(log){
    const source=Array.isArray(log?.changes)?log.changes:(Array.isArray(log?.ch)?log.ch:[]); // source（新舊格式的成本明細）。
    const mapped=new Map(); // mapped（依成本項目整理的歷史明細）。
    source.forEach(change=>{
      const key=String(change?.field??change?.f??'');
      if(!key) return;
      mapped.set(key,{
        before:Number(change?.before??change?.b),
        after:Number(change?.after??change?.a),
        percent:change?.percent??change?.p??null
      });
    });
    return mapped;
  }

  function formatCostLogValue(field,value){
    if(!Number.isFinite(value)) return '—';
    const formatted=Number(value).toLocaleString('en-US',{maximumFractionDigits:2}); // formatted（加上千分位的顯示數值）。
    return `${formatted}${field.suffix||''}`;
  }

  function renderValueCell(field,change,{extra=false}={}){
    const classNames=['cost-log-value-cell']; // classNames（成本數值儲存格樣式）。
    if(extra) classNames.push('cost-log-extra');
    if(!change){
      classNames.push('is-missing');
      return `<td class="${classNames.join(' ')}" title="Bản ghi cũ chưa lưu giá trị này / 舊紀錄未保存此數值"><span class="cost-log-value">—</span></td>`;
    }
    const changed=change.before!==change.after;
    if(changed) classNames.push('is-changed');
    const hasPercent=change.percent!==null&&change.percent!==undefined&&change.percent!==''; // hasPercent（紀錄是否保存有效百分比）。
    const numericPercent=hasPercent?Number(change.percent):Number.NaN; // numericPercent（變動百分比數值）。
    const percent=changed&&Number.isFinite(numericPercent)
      ? `<span class="cost-log-percent">${numericPercent>0?'+':''}${numericPercent.toFixed(1)}%</span>`
      : '';
    return `<td class="${classNames.join(' ')}"><span class="cost-log-value">${safeText(formatCostLogValue(field,change.after))}</span>${percent}</td>`;
  }

  function renderHeaderCell(field,{extra=false}={}){
    return `<th class="cost-log-value-head${extra?' cost-log-extra':''}"><span>${safeText(field.vi)}</span><small>${safeText(field.zh)}</small></th>`;
  }

  function renderCostLogTable(logs){
    const expandedClass=extraExpanded?' is-extra-expanded':''; // expandedClass（右側補充設定展開樣式）。
    const arrow=extraExpanded?'ti-chevron-left':'ti-chevron-right';
    const label=extraExpanded
      ? 'Thu gọn cài đặt / 收合計算設定'
      : 'Mở rộng cài đặt / 展開計算設定';
    return `<div class="cost-log-table-scroll ui-table-scroll${expandedClass}" data-ui-floating-scroll="only">
      <table class="cost-log-table ui-table" id="cost-log-table" data-ui-table-layout="special" data-ui-table-sticky="original">
        <thead><tr>
          <th class="cost-log-time-head"><span>Thời gian</span><small>時間</small></th>
          <th class="cost-log-user-head"><span>Người thao tác</span><small>操作者</small></th>
          ${PRIMARY_FIELDS.map(field=>renderHeaderCell(field)).join('')}
          ${EXTRA_FIELDS.map(field=>renderHeaderCell(field,{extra:true})).join('')}
          <th class="cost-log-toggle-head"><button type="button" id="costlog-extra-toggle" class="cost-log-extra-toggle" aria-expanded="${extraExpanded}" aria-label="${safeText(label)}" title="${safeText(label)}" onclick="toggleCostLogExtraColumns()"><i class="ti ${arrow}"></i></button></th>
        </tr></thead>
        <tbody>${logs.map(log=>{
          const changes=normalizeHistoryChanges(log); // changes（本次全部成本設定或舊紀錄已保存項目）。
          return `<tr>
            <td class="cost-log-time-cell">${safeText(formatHistoryTime(log))}</td>
            <td class="cost-log-user-cell">${safeText(log?.createdBy||log?.u||'')}</td>
            ${PRIMARY_FIELDS.map(field=>renderValueCell(field,changes.get(field.key))).join('')}
            ${EXTRA_FIELDS.map(field=>renderValueCell(field,changes.get(field.key),{extra:true})).join('')}
            <td class="cost-log-toggle-spacer"></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }

  function rClog(){
    const container=g('clog-list'); // container（成本變動表格容器）。
    if(!container) return;
    if(typeof canOpenPage==='function'&&!canOpenPage('costlog')){
      container.innerHTML='<div class="cost-log-empty"><div>Không có quyền xem lịch sử chi phí</div><div>沒有查看成本歷史權限</div></div>';
      return;
    }
    const logs=Array.isArray(window.cLog)?window.cLog:[]; // logs（目前載入的成本變動紀錄）。
    if(!logs.length){
      container.innerHTML='<div class="cost-log-empty"><div>Chưa có lịch sử</div><div>尚無記錄</div></div>';
      return;
    }
    container.innerHTML=renderCostLogTable(logs);
  }

  function toggleCostLogExtraColumns(){
    extraExpanded=!extraExpanded;
    rClog();
  }

  async function refreshCostLog(){
    const button=g('costlog-refresh'); // button（重新整理按鈕）。
    if(button?.disabled) return;
    if(button){
      button.disabled=true;
      button.classList.add('is-loading');
    }
    try{
      if(typeof window.ensureCostLogLoaded!=='function') throw new Error('costlog-loader');
      await window.ensureCostLogLoaded({force:true});
      rClog();
    }catch(error){
      console.error('Không thể làm mới lịch sử chi phí / 無法重新整理成本歷史：',error);
      await window.PCMSUIComponents.alertDialog({
        message:{vi:'Không thể làm mới lịch sử chi phí.',zh:'無法重新整理成本歷史。'},
        kind:'danger'
      });
    }finally{
      if(button){
        button.disabled=false;
        button.classList.remove('is-loading');
      }
    }
  }

  window.rClog=rClog;
  window.toggleCostLogExtraColumns=toggleCostLogExtraColumns;
  window.refreshCostLog=refreshCostLog;
})();
