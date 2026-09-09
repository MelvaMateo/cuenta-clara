/* Service worker: guarda una copia de la app para que abra sin internet (PWA).

   Estrategia: primero la red y, solo si falla, la copia guardada. Antes era al
   revés (primero la caché) y cada cambio en el HTML, el CSS o el JS quedaba
   invisible hasta acordarse de subir a mano el número de versión de abajo. */
const CACHE = 'cuenta-clara-v7';
const ASSETS = [
  './',
  './index.html',
  './login.html',
  './app.html',
  './css/base.css',
  './css/landing.css',
  './css/login.css',
  './css/app.css',
  './js/config.js',
  './js/sesion.js',
  './js/datos.js',
  './js/login.js',
  './js/app.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', e => {
  /* skipWaiting: el service worker nuevo toma el control enseguida, sin
     esperar a que se cierren todas las pestañas abiertas. */
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copia = res.clone();                  // guarda la última versión buena
          caches.open(CACHE).then(c => c.put(e.request, copia));
        }
        return res;
      })
      .catch(() => caches.match(e.request))           // sin internet: la copia guardada
  );
});
