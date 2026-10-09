/* Référentiels Mobil – Service Worker. Hülle network-first (Cache als Rückfall), Chiffrate (.enc) cache-first
   (fid ändert sich mit dem Inhalt), index.json/m.enc network-first (die Seite legt sie mit Zeitlimit in „rm-daten“ ab). Eigene Präfixe „rm-“: die anderen Portale
   auf temmchen.github.io räumen nur ihre eigenen Caches ab. */
const CACHE = 'rm-v3';
const HUELLE = ['./', './index.html', './manifest.webmanifest', './lib/pdf.min.mjs', './lib/pdf.worker.min.mjs', './icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(HUELLE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('rm-') && k !== CACHE && k !== 'rm-dateien' && k !== 'rm-daten').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.endsWith('.enc') && u.pathname.includes('/f/')) {
    e.respondWith(caches.open('rm-dateien').then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  // Kopie VOR dem Zurückgeben ziehen (nachher ist der Body evtl. schon gelesen → clone() wirft unter WebKit).
  // /vaults/ (Index, Manifest) speichert die Seite selbst im Cache „rm-daten“.
  e.respondWith(fetch(e.request).then(r => { if (r.ok && !u.pathname.includes('/vaults/')) { const k = r.clone(); caches.open(CACHE).then(c => c.put(e.request, k)).catch(() => {}); } return r; })
    .catch(async () => {   // nur im eigenen Cache suchen – alle Portale teilen sich die Domain temmchen.github.io
      const c = await caches.open(CACHE);
      return (await c.match(e.request, {ignoreSearch:true})) || (e.request.mode === 'navigate' && await c.match('./index.html')) || Response.error();
    }));
});
