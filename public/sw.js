// 6IAN service worker: the app shell only. Audio, art and API calls always go to the network
// (audio is never cached beyond what the player itself buffers for the next track).
const SHELL = 'shell-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/login', '/icon.svg', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (u.pathname.startsWith('/_next/static/') || /\.(png|svg|woff2|webmanifest)$/.test(u.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const c = r.clone(); caches.open(SHELL).then((s) => s.put(e.request, c)); return r; })));
    return;
  }
  if (e.request.mode === 'navigate') {
    // Network first so the queue is fresh; the cached sign-in page if offline.
    e.respondWith(fetch(e.request).catch(() => caches.match('/login')));
  }
});
