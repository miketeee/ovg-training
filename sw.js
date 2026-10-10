// sw.js — keeps the app shell on the phone so it opens with no signal.
// Only this site's own files are cached. Requests to your Apps Script
// (POST, script.google.com) are never touched or stored here.

const VERSION = '5.0.0'; // bump on every release (matches APP_VERSION in js/app.js)
const CACHE = `ovg-shell-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/storage.js',
  'js/sync.js',
  'js/ui.js',
  'js/md.js',
  'js/content.js',
  'js/library.js',
  'js/log.js',
  'js/workout.js',
  'js/charts.js',
  'js/levels.js',
  'js/progress.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  // cache: 'reload' skips the browser's HTTP cache so a new version gets fresh files
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('ovg-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // network as normal

  // Opening the app (any page address) → the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match('index.html')) || fetch(req);
    })());
    return;
  }

  // Everything else from this site: cache first, then network (and keep a copy).
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  })());
});
