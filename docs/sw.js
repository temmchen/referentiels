/* Référentiels Mobil – Service Worker. Hülle network-first (Cache als Rückfall), Chiffrate (.enc) cache-first
   (fid ändert sich mit dem Inhalt), index.json/m.enc network-first. Eigene Präfixe „rm-“: die anderen Portale
   auf temmchen.github.io räumen nur ihre eigenen Caches ab. */
const CACHE = 'rm-v1';
const HUELLE = ['./', './index.html', './manifest.webmanifest', './lib/pdf.min.mjs', './lib/pdf.worker.min.mjs', './icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(HUELLE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('rm-') && k !== CACHE && k !== 'rm-dateien').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.endsWith('.enc') && u.pathname.includes('/f/')) {
    e.respondWith(caches.open('rm-dateien').then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then(r => { if (r.ok && !u.pathname.includes('/vaults/')) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request, {ignoreSearch:true})));
});
