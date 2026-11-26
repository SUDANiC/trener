const CACHE = 'trener-v9';
const FILES = ['./', './index.html', './app.js', './drive.js', './exlib.js', './report.js', './exdb-pl.json', './repdb-pl.json', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && !k.startsWith('trener-img') && !k.startsWith('trener-repdb') && !k.startsWith('trener-exdb')).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'GET' && /(^|\.)exercise-dataset\.com$|cdn\.jsdelivr\.net$/.test(u.hostname) && /\.(webp|jpg|png)$/.test(u.pathname)) {
    // ilustracje i zdjęcia ćwiczeń: z pamięci telefonu, a przy pierwszym razie z internetu
    e.respondWith(caches.open('trener-img').then(c => c.match(e.request).then(r => r || fetch(e.request).then(n => { c.put(e.request, n.clone()); return n; }))));
    return;
  }
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // sieć najpierw (świeża wersja aplikacji), a bez internetu – kopia z pamięci
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
