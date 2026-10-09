/* Référentiels Mobil – Service Worker.
   - Hülle (Seite, pdf.js, Icons): Netz mit Zeitlimit (3 s), sonst die gespeicherte Fassung. Ohne Zeitlimit blieb die
     Home-Bildschirm-App bei hängender Verbindung (Funkloch, VPN-Wechsel) komplett schwarz – sie zeigt keinen Ladebalken
     (09.10.2026). Ist noch nichts gespeichert, wird weiter auf das Netz gewartet.
   - Chiffrate (vaults/…/f/….enc): cache-first in „rm-dateien“ (die fid ändert sich mit dem Inhalt).
   - Index und Manifest (vaults/index.json, m.enc): nicht abgefangen – die Seite holt sie selbst mit Zeitlimit und legt
     sie in „rm-daten“ ab.
   Nur eigene Caches („rm-…“): alle Portale teilen sich die Domain temmchen.github.io. */
const CACHE = 'rm-v4';
const ZEITLIMIT = 3000;
const HUELLE = ['./', './index.html', './manifest.webmanifest', './lib/pdf.min.mjs', './lib/pdf.worker.min.mjs', './icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(HUELLE.map(p => c.add(new Request(p, {cache:'reload'})).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k.startsWith('rm-') && k !== CACHE && k !== 'rm-dateien' && k !== 'rm-daten').map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function netzMitZeitlimit(req, schluessel) {
  const c = await caches.open(CACHE);
  // Kopie VOR dem Zurückgeben ziehen (nachher ist der Body evtl. schon gelesen → clone() wirft unter WebKit).
  const netz = fetch(req).then(r => { if (r.ok) { const k = r.clone(); c.put(schluessel, k).catch(() => {}); } return r; });
  netz.catch(() => {});
  const r = await Promise.race([netz.catch(() => null), new Promise(ok => setTimeout(() => ok(null), ZEITLIMIT))]);
  if (r) return r;
  const t = (await c.match(schluessel, {ignoreSearch:true})) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
  return t || netz;   // nichts gespeichert: weiter auf das Netz warten (oder dessen Fehler)
}

self.addEventListener('fetch', e => {
  const req = e.request; const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (!u.href.startsWith(self.registration.scope)) return;
  if (u.pathname.includes('/vaults/')) {
    if (u.pathname.endsWith('.enc') && u.pathname.includes('/f/'))
      e.respondWith(caches.open('rm-dateien').then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) { const k = r.clone(); c.put(req, k).catch(() => {}); } return r; })));
    return;
  }
  e.respondWith(netzMitZeitlimit(req, req.mode === 'navigate' ? './index.html' : u.href.split('?')[0]));
});
