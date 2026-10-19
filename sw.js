// 오프라인 캐시: 처음 한 번 접속하면 모든 파일을 저장하고 이후엔 네트워크 없이 동작
const CACHE = 'cardgame-202610190022';
const FILES = ["./","index.html","bundle.js?v=202610190022","worker.js?v=202610190022","manifest.json","icon-180.png","icon-192.png","icon-512.png"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).catch(() => caches.match('index.html'))));
});
