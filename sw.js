// Cache do app: abre mesmo com internet ruim. Dados vêm sempre da planilha (não passam por aqui).
const CACHE = 'ps-2026-11-11T03:16:42.395Z';
const ARQ = ['./', 'index.html', 'app.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icone-192.png', 'logo.svg'];
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQ))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
