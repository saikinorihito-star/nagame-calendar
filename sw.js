// 静的ファイルもネット接続時には最新版を優先し、自動更新後の古い表示を防止。
// オフライン時だけ前回取得したファイルを使用する。
const CACHE='nagame-calendar-static-v6-free-daily-links';
const ASSETS=['./','./index.html','./styles.css','./app.js','./market.js','./holidays.js','./races.js','./data/holidays.json','./data/races.json','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
const paths=new Set(ASSETS.map(asset=>new URL(asset,self.registration.scope).pathname));
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key.startsWith('nagame-calendar-static-')&&key!==CACHE).map(key=>caches.delete(key))
  )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||!paths.has(url.pathname))return;
  event.respondWith((async()=>{
    try{
      const res=await fetch(event.request);
      if(res.ok){
        const cache=await caches.open(CACHE);
        // キャッシュ保存失敗でもオンライン表示を妨げない。
        await cache.put(event.request,res.clone()).catch(()=>{});
      }
      return res;
    }catch(error){
      const saved=await caches.match(event.request);
      if(saved)return saved;
      throw error;
    }
  })());
});
