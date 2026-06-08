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
  if(window.accs.find(a=>a.user===u)){ alert('Tài khoản đã tồn tại / 帳號已存在'); return; }
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
  window.accs[i].user=u; window.accs[i].role=r; if(p) window.accs[i].pass=p;
  if(orig===window.cu.user){ window.cu=window.accs[i]; uNav(); }
  cm('m-eacc'); rAcc();
  if(window.saveAccsToFB) await saveAccsToFB();
}

async function delAcc(user){
  if(confirm('Xác nhận xóa / 確定刪除帳號 '+user+'?')){
    window.accs=window.accs.filter(a=>a.user!==user);
    rAcc();
    if(window.saveAccsToFB) await saveAccsToFB();
  }
}
