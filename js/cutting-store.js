// cuttingStore（裁帶資料儲存）：第一版使用 localStorage（瀏覽器本機儲存），未來可替換 Firebase（雲端資料庫平台）。
(function(){
  const KEY = 'cuttingTemplates.v1';

  function nowText(){
    return new Date().toISOString();
  }

  function readAll(){
    try{
      const raw = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    }catch(e){
      console.error('讀取裁帶模板失敗：', e);
      return [];
    }
  }

  function writeAll(items){
    localStorage.setItem(KEY, JSON.stringify(items));
  }

  window.cuttingStore = {
    mode: 'local',
    async listTemplates(){
      return readAll();
    },
    async saveTemplate(template){
      const items = readAll();
      const code = String(template.code || '').trim().toUpperCase();
      if(!code) throw new Error('Thiếu mã hàng / 缺少款號');
      const next = {
        ...template,
        id: template.id || code,
        code,
        piecesPerItem: Number(template.piecesPerItem || 0),
        aliases: Array.isArray(template.aliases) ? template.aliases : [],
        updatedAt: nowText()
      };
      const idx = items.findIndex(x => x.id === next.id || String(x.code || '').toUpperCase() === code);
      if(idx >= 0) items[idx] = {...items[idx], ...next};
      else items.push(next);
      writeAll(items);
      return next;
    },
    async removeTemplate(id){
      const items = readAll().filter(x => x.id !== id);
      writeAll(items);
      return true;
    }
  };
})();
