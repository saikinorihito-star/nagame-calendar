// 起動を高速化: キャッシュ済みの静的ファイルを通信待ちなしで表示する。
// HTMLなど非バージョン固定の資産は背後で再検証して次の起動に反映。
// 祝日・競馬のJSONは毎回サーバーで確認し、オフライン時のみ保存版を利用する。
const CACHE='nagame-calendar-static-v15-fast-start';
const ASSETS=['./','./index.html','./styles.css?v=20261123-today-contrast','./app.js?v=20261125-fast-start','./market.js?v=20261106-index-cards','./holidays.js','./races.js','./data/holidays.json','./data/races.json','./manifest.webmanifest','./icon-warm-192.png','./icon-warm-512.png'];
const paths=new Set(ASSETS.map(asset=>new URL(asset,self.registration.scope).pathname));
const JSON_PATHS=new Set(['./data/holidays.json','./data/races.json'].map(asset=>new URL(asset,self.registration.scope).pathname));
const REVALIDATE_PATHS=new Set(['./','./index.html','./holidays.js','./races.js','./manifest.webmanifest'].map(asset=>new URL(asset,self.registration.scope).pathname));

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

  const cacheReady=caches.open(CACHE);
  const saved=cacheReady.then(cache=>cache.match(event.request));
  const mustBeFresh=JSON_PATHS.has(url.pathname)||event.request.cache==='no-store';

  async function fromNetwork(cacheControl){
    const response=await fetch(event.request,cacheControl?{cache:cacheControl}:undefined);
    if(response.ok){
      const cache=await cacheReady;
      await cache.put(event.request,response.clone()).catch(()=>{});
    }
    return response;
  }
  // Service Worker内の応答はキャッシュ優先。ただしHTML等は返却後に更新確認。
  // waitUntilをfetchイベントの同期部分で登録し、iOSでも処理を保持させる。
  if(!mustBeFresh&&REVALIDATE_PATHS.has(url.pathname)){
    event.waitUntil(saved.then(cached=>{
      if(cached)return fromNetwork('no-cache').catch(()=>{});
    }).catch(()=>{}));
  }
  event.respondWith((async()=>{
    const cached=await saved;
    if(cached&&!mustBeFresh)return cached;
    try{return await fromNetwork(mustBeFresh?'no-store':undefined);}
    catch(error){if(cached)return cached;throw error;}
  })());
});
