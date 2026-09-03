/* Service worker mínimo: cachea la app para que cargue sin internet (PWA). */
const CACHE = 'cuenta-clara-v2';
const ASSETS = ['./', './index.html', './login.html', './app.html', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

/* Borra las cachés de versiones anteriores; si no, seguiría sirviendo el
   index.html viejo (que era la app) en lugar de la landing. */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
