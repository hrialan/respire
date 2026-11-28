// Respire — service worker.
//
// Network first: when online, every file is revalidated with the server
// (cache: 'no-cache' bypasses GitHub Pages' 10-minute HTTP cache; unchanged
// files cost a tiny 304), so a new version shows up on the very next launch.
// Offline, or if the network takes more than 3 s, the cached copy is served.
//
// When adding a file to the app, list it in ASSETS and bump CACHE.
const CACHE = 'respire-v12';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './scene.js',
  './audio.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  const key = url.origin + url.pathname;   // ignore ?h=, ?boat… for caching

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromNetwork = fetch(request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
    try {
      const res = await Promise.race([fromNetwork, timeout]);
      if (res) return res;
    } catch { /* offline */ }
    return (await cache.match(key)) || fromNetwork;
  })());
});
