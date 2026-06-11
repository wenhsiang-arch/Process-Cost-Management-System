// ===== 帳號管理 =====
function rAcc(){
  const tb=g('acc-tb'); if(!tb) return; tb.innerHTML='';
  window.accs.forEach(a=>{
    const isMe=a.user===window.cu.user;
    const tr=document.createElement('tr');
    const rc={'admin':'tg2','manager':'tb2','clerk':'ta','leader':'tb3'};
    tr.innerHTML=`<td><b>${a.user}</b>${isMe?' <span class="tg tb2">我</span>':''}</td><td><span class="tg ${rc[a.role]||'ta'}">${ROLE_LABEL[a.role]||a.role}</span></td><td><div style="display:flex;gap:4px"><button class="btn bsm" onclick="oEacc('${a.user}')"><i class="ti ti-edit"></i></button>${!isMe?`<button class="btn bsm bd2" onclick="delAcc('${a.user}')"><i class="ti ti-trash"></i></button>`:''}</div></td>`;
    tb.appendChild(tr);
  });
}

async function saveAcc(){
  const u=g('ac-u').value.trim(), r=g('ac-r').value;
  if(!u){ alert('請填入帳號'); return; }
  if(window.accs.find(a=>a.user===u)||(window.allEmployees&&window.allEmployees.find(e=>e.user===u))){ alert('Tài khoản đã tồn tại / 帳號已存在'); return; }
  window.accs.push({user:u,pass:'',role:r}); cm('m-nacc');
  g('ac-u').value=''; rAcc();
  if(window.saveAccsToFB) await saveAccsToFB();
}

function oEacc(user){
  const a=window.accs.find(x=>x.user===user); if(!a) return;
  g('ea-orig').value=user; g('ea-u').value=a.user; g('ea-p').value=''; g('ea-r').value=a.role;
  om('m-eacc');
}

async function saveEacc(){
  const orig=g('ea-orig').value, u=g('ea-u').value.trim(), p=g('ea-p').value, r=g('ea-r').value;
  const i=window.accs.findIndex(a=>a.user===orig); if(i<0) return;
  if(!u){ alert('帳號不得空白 / Tài khoản không được để trống'); return; }
  if(window.accs.some((a,idx)=>idx!==i&&a.user===u)||(window.allEmployees||[]).some(e=>e.user===u)){
    alert('帳號已存在 / Tài khoản đã tồn tại');
    return;
  }
  const original={...window.accs[i]};
  const adminCount=window.accs.filter(a=>a.role==='admin').length;
  if(original.role==='admin'&&r!=='admin'&&adminCount<=1){
    alert('不可變更最後一位管理員的權限 / Không thể thay đổi quản trị viên cuối cùng');
    return;
  }
  window.accs[i].user=u; window.accs[i].role=r;
  if(p){
    const hashed=await bcrypt.hash(p,10); // 儲存前將密碼 hash
    window.accs[i].pass=hashed;
  }
  if(orig===window.cu.user){ window.cu=window.accs[i]; uNav(); }
  const ok=window.saveAccsToFB?await saveAccsToFB():false;
  if(!ok){
    window.accs[i]=original;
    if(orig===window.cu.user){ window.cu=window.accs[i]; uNav(); }
    rAcc();
    alert('帳號儲存失敗，已恢復原始資料 / Lưu tài khoản thất bại, dữ liệu đã được khôi phục');
    return;
  }
  cm('m-eacc'); rAcc();
}

async function delAcc(user){
  const target=window.accs.find(a=>a.user===user); if(!target) return;
  if(user===window.cu?.user){ alert('不可刪除自己的帳號 / Không thể xóa tài khoản của chính mình'); return; }
  if(target.role==='admin'&&window.accs.filter(a=>a.role==='admin').length<=1){
    alert('不可刪除最後一位管理員 / Không thể xóa quản trị viên cuối cùng');
    return;
  }
  if(confirm('Xác nhận xóa / 確定刪除帳號 '+user+'?')){
    const original=window.accs;
    window.accs=window.accs.filter(a=>a.user!==user);
    const ok=window.saveAccsToFB?await saveAccsToFB():false;
    if(!ok){
      window.accs=original;
      rAcc();
      alert('帳號刪除失敗，已恢復原始資料 / Xóa tài khoản thất bại, dữ liệu đã được khôi phục');
      return;
    }
    rAcc();
  }
}
