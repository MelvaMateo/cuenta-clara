/* Service worker mínimo: cachea la app para que cargue sin internet (PWA). */
const CACHE = 'cuenta-clara-v3';
const ASSETS = [
  './',
  './index.html',
  './login.html',
  './app.html',
  './css/base.css',
  './css/landing.css',
  './css/login.css',
  './css/app.css',
  './js/sesion.js',
  './js/login.js',
  './js/app.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

/* Borra las cachés de versiones anteriores; si no, seguiría sirviendo el HTML
   viejo (con el CSS y el JS adentro) en lugar de estos archivos. */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
