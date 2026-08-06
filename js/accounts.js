// ===== userAccess（使用者權限）帳號管理 =====

function accountUpdatedBy(){
  return String(window.cu?.user||window.firebaseAuthUser?.uid||'system').slice(0,100);
}

// normalizeAccessEmail（標準化核准電子信箱）
function normalizeAccessEmail(value){
  return String(value||'').trim().toLowerCase();
}

// normalizeUserAccessAccount（標準化使用者權限帳號）
function normalizeUserAccessAccount(accessId,data){
  const normalizedAccessId=String(accessId||'');
  const email=normalizeAccessEmail(data?.email);
  const declaredUid=String(data?.authUid||'');
  const accessMode=declaredUid===normalizedAccessId||!email?'uid':'email';
  return {
    accessId:normalizedAccessId,
    accessMode,
    email,
    authUid:declaredUid||(accessMode==='uid'?normalizedAccessId:''),
    user:String(data?.username||''),
    role:String(data?.role||''),
    active:data?.active===true,
    googleDisplayName:typeof data?.googleDisplayName==='string'?data.googleDisplayName:'',
    displayName:typeof data?.displayName==='string'?data.displayName:'',
    department:typeof data?.department==='string'?data.department:'',
    createdAt:Number(data?.createdAt)||0,
    lastLoginAt:Number(data?.lastLoginAt)||0,
    updatedAt:Number(data?.updatedAt)||0,
    updatedBy:String(data?.updatedBy||'')
  };
}

// isCurrentAccessAccount（判斷目前登入的權限帳號）
function isCurrentAccessAccount(account){
  if(!account||!window.cu) return false;
  if(account.accessId&&account.accessId===window.cu.accessId) return true;
  if(account.authUid&&account.authUid===window.cu.authUid) return true;
  return !!(account.email&&account.email===normalizeAccessEmail(window.cu.email));
}

function sortUserAccessAccounts(list){
  return [...list].sort((a,b)=>(ROLE_ORDER[a.role]??9)-(ROLE_ORDER[b.role]??9)||a.user.localeCompare(b.user));
}

async function loadAccounts(){
  if(!isAdm()){
    window.accs=[];
    rAcc();
    return false;
  }
  if(typeof window.firebaseLoadUserAccessList!=='function') return false;
  try{
    const list=await window.firebaseLoadUserAccessList();
    window.accs=sortUserAccessAccounts(list.map(item=>normalizeUserAccessAccount(item.accessId,item)));
    rAcc();
    return true;
  }catch(e){
    console.error('Không thể tải userAccess / 無法載入使用者權限：',e);
    window.accs=[];
    rAcc();
    return false;
  }
}

function appendAccountCell(row,text){
  const cell=document.createElement('td');
  cell.textContent=text;
  row.appendChild(cell);
  return cell;
}

function rAcc(){
  const tb=g('acc-tb');
  if(!tb) return;
  tb.textContent='';
  const list=Array.isArray(window.accs)?window.accs:[];
  if(!list.length){
    const tr=document.createElement('tr');
    const td=document.createElement('td');
    td.colSpan=6;
    td.style.cssText='text-align:center;padding:24px;color:var(--mu)';
    td.textContent='Chưa có tài khoản được cấp quyền / 尚無已授權帳號';
    tr.appendChild(td);
    tb.appendChild(tr);
    return;
  }

  list.forEach(a=>{
    const isMe=isCurrentAccessAccount(a);
    const tr=document.createElement('tr');

    const emailText=a.email||(isMe?normalizeAccessEmail(window.cu?.email):'');
    appendAccountCell(tr,emailText||'Chưa ghi nhận / 尚未記錄');

    const userCell=appendAccountCell(tr,a.user||'-');
    if(isMe){
      const me=document.createElement('span');
      me.className='tg tb2';
      me.style.marginLeft='6px';
      me.textContent='Tôi / 我';
      userCell.appendChild(me);
    }

    const roleCell=document.createElement('td');
    const roleTag=document.createElement('span');
    roleTag.className='tg '+(ROLE_TAG_CLASS[a.role]||'ta');
    roleTag.textContent=ROLE_LABEL[a.role]||a.role||'-';
    roleCell.appendChild(roleTag);
    tr.appendChild(roleCell);

    const statusCell=document.createElement('td');
    const statusTag=document.createElement('span');
    statusTag.className='tg '+(a.active?'tg2':'tr2');
    statusTag.textContent=a.active?'Đang bật / 已啟用':'Đã tắt / 已停用';
    statusCell.appendChild(statusTag);
    tr.appendChild(statusCell);

    const uidCell=appendAccountCell(tr,a.authUid||'Chưa đăng nhập / 尚未登入');
    uidCell.style.cssText='font-family:monospace;font-size:11px;word-break:break-all;max-width:260px';

    const actionCell=document.createElement('td');
    const actions=document.createElement('div');
    actions.style.cssText='display:flex;gap:4px';
    const editButton=document.createElement('button');
    editButton.className='btn bsm';
    editButton.title='Chỉnh sửa / 編輯';
    editButton.innerHTML='<i class="ti ti-edit"></i>';
    editButton.addEventListener('click',()=>oEacc(a.accessId));
    actions.appendChild(editButton);
    if(!isMe){
      const deleteButton=document.createElement('button');
      deleteButton.className='btn bsm bd2';
      deleteButton.title='Xóa quyền truy cập / 刪除使用權限';
      deleteButton.innerHTML='<i class="ti ti-trash"></i>';
      deleteButton.addEventListener('click',()=>delAcc(a.accessId));
      actions.appendChild(deleteButton);
    }
    actionCell.appendChild(actions);
    tr.appendChild(actionCell);
    tb.appendChild(tr);
  });
}

// validEmailAccessInput（檢查電子信箱核准資料）
function validEmailAccessInput(email,username){
  if(!email||email.length>254||email.includes('/')||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    alert('Email Google không hợp lệ / Google 電子信箱格式不正確');
    return false;
  }
  if(!username||username.length>100){
    alert('Vui lòng nhập tên tài khoản hợp lệ / 請輸入正確的帳號名稱');
    return false;
  }
  return true;
}

// buildUserAccessPayload（建立使用者權限寫入資料）
function buildUserAccessPayload(account,email,username,role,active){
  const payload={
    username,
    role,
    active:active===true,
    updatedAt:Date.now(),
    updatedBy:accountUpdatedBy()
  };
  if(email){
    payload.email=email;
    payload.authUid=String(account?.authUid||'');
    payload.googleDisplayName=String(account?.googleDisplayName||'').slice(0,200);
    payload.createdAt=account?.createdAt||Date.now();
    if(account?.lastLoginAt) payload.lastLoginAt=account.lastLoginAt;
  }
  if(account?.displayName) payload.displayName=account.displayName;
  if(account?.department) payload.department=account.department;
  return payload;
}

async function saveAcc(){
  const email=normalizeAccessEmail(g('ac-email').value);
  const username=g('ac-u').value.trim();
  const role=g('ac-r').value;
  const active=g('ac-active').checked;
  if(!DESK_ROLES.includes(role)){
    alert('Vai trò không hợp lệ / 角色設定不正確');
    return;
  }
  if(!validEmailAccessInput(email,username)) return;
  if(window.accs.some(a=>a.accessId===email||a.email===email)){
    alert('Email Google đã được phê duyệt / Google 電子信箱已經核准');
    return;
  }
  if(window.accs.some(a=>a.user===username)){
    alert('Tài khoản đã tồn tại / 帳號已存在');
    return;
  }
  const payload=buildUserAccessPayload(null,email,username,role,active);
  try{
    await window.firebaseSaveUserAccess(email,payload);
    window.accs=sortUserAccessAccounts([...window.accs,normalizeUserAccessAccount(email,payload)]);
    cm('m-nacc');
    g('ac-email').value='';
    g('ac-u').value='';
    g('ac-r').value='manager';
    g('ac-active').checked=true;
    rAcc();
  }catch(e){
    console.error('Không thể tạo userAccess / 無法新增使用者權限：',e);
    alert('Tạo tài khoản thất bại / 新增帳號失敗\n\n'+(e?.message||''));
  }
}

function oEacc(accessId){
  const account=window.accs.find(a=>a.accessId===accessId);
  if(!account) return;
  const isMe=isCurrentAccessAccount(account);
  g('ea-orig').value=account.accessId;
  g('ea-email-view').value=account.email||(isMe?normalizeAccessEmail(window.cu?.email):'Chưa ghi nhận / 尚未記錄');
  g('ea-uid-view').value=account.authUid||'Chưa đăng nhập / 尚未登入';
  g('ea-u').value=account.user;
  g('ea-r').value=account.role;
  g('ea-active').checked=account.active;
  g('ea-r').disabled=isMe;
  g('ea-active').disabled=isMe;
  g('ea-self-note').style.display=isMe?'block':'none';
  om('m-eacc');
}

async function saveEacc(){
  const accessId=g('ea-orig').value;
  const account=window.accs.find(a=>a.accessId===accessId);
  if(!account) return;
  const username=g('ea-u').value.trim();
  const role=g('ea-r').value;
  const active=g('ea-active').checked;
  if(!DESK_ROLES.includes(role)){
    alert('Vai trò không hợp lệ / 角色設定不正確');
    return;
  }
  if(!username||username.length>100){
    alert('Vui lòng nhập tên tài khoản hợp lệ / 請輸入正確的帳號名稱');
    return;
  }
  if(window.accs.some(a=>a.accessId!==accessId&&a.user===username)){
    alert('Tài khoản đã tồn tại / 帳號已存在');
    return;
  }
  const isMe=isCurrentAccessAccount(account);
  if(isMe&&(role!=='admin'||active!==true)){
    alert('Không thể tắt hoặc hạ quyền tài khoản đang đăng nhập / 不可停用或降低目前登入帳號的權限');
    return;
  }
  const activeAdminCount=window.accs.filter(a=>a.role==='admin'&&a.active).length;
  if(account.role==='admin'&&account.active&&(role!=='admin'||!active)&&activeAdminCount<=1){
    alert('Phải giữ lại ít nhất một quản trị viên đang hoạt động / 至少必須保留一位啟用中的管理員');
    return;
  }

  const payload=buildUserAccessPayload(account,account.email,username,role,active);
  try{
    await window.firebaseSaveUserAccess(accessId,payload);
    const index=window.accs.findIndex(a=>a.accessId===accessId);
    window.accs[index]=normalizeUserAccessAccount(accessId,payload);
    window.accs=sortUserAccessAccounts(window.accs);
    if(isMe){
      window.cu.user=username;
      uNav();
    }
    cm('m-eacc');
    rAcc();
  }catch(e){
    console.error('Không thể cập nhật userAccess / 無法更新使用者權限：',e);
    alert('Lưu tài khoản thất bại / 儲存帳號失敗\n\n'+(e?.message||''));
  }
}

async function delAcc(accessId){
  const account=window.accs.find(a=>a.accessId===accessId);
  if(!account) return;
  if(isCurrentAccessAccount(account)){
    alert('Không thể xóa tài khoản đang đăng nhập / 不可刪除目前登入的帳號');
    return;
  }
  const activeAdminCount=window.accs.filter(a=>a.role==='admin'&&a.active).length;
  if(account.role==='admin'&&account.active&&activeAdminCount<=1){
    alert('Không thể xóa quản trị viên cuối cùng / 不可刪除最後一位管理員');
    return;
  }
  if(!confirm('Xóa quyền truy cập của tài khoản này? / 確定刪除此帳號的使用權限？\n\n'+(account.email||account.user))) return;
  try{
    await window.firebaseDeleteUserAccess(accessId);
    window.accs=window.accs.filter(a=>a.accessId!==accessId);
    rAcc();
  }catch(e){
    console.error('Không thể xóa userAccess / 無法刪除使用者權限：',e);
    alert('Xóa tài khoản thất bại / 刪除帳號失敗\n\n'+(e?.message||''));
  }
}
