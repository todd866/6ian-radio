// 6IAN offline-capable service worker (Design D):
//   - shell-v2: app shell + immutable Next.js static assets
//   - art-v1:   bounded cover art cache (/api/art/, max 200)
//   - api-v1:   network-first with offline fallback for queue, home, moods, station, and info GETs
//   - audio-v1: bounded played-track audio cache (/api/audio/, max 40) with synthesized HTTP 206
//               Content-Range responses so iOS Safari / mobile browsers play cleanly offline.
const SHELL = 'shell-v2';
const ART = 'art-v1';
const API = 'api-v1';
const AUDIO = 'audio-v1';
const KEEP = new Set([SHELL, ART, API, AUDIO]);
const MAX_ART = 200;
const MAX_AUDIO = 40;

function parseByteRange(header, total) {
  if (!header || total <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (!rawStart && !rawEnd) return null;
  let start;
  let end;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Math.min(total - 1, Number(rawEnd)) : total - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || start > end) {
    return { unsatisfiable: true, total };
  }
  return { start, end, total };
}

async function synthesizeRangeResponse(fullResponse, rangeHeader) {
  const buf = await fullResponse.arrayBuffer();
  const total = buf.byteLength;
  const parsed = parseByteRange(rangeHeader, total);
  if (!parsed) {
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': fullResponse.headers.get('content-type') || 'audio/mp4',
        'content-length': String(total),
        'accept-ranges': 'bytes',
      },
    });
  }
  if (parsed.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${total}` },
    });
  }
  const slice = buf.slice(parsed.start, parsed.end + 1);
  return new Response(slice, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'content-type': fullResponse.headers.get('content-type') || 'audio/mp4',
      'content-length': String(slice.byteLength),
      'content-range': `bytes ${parsed.start}-${parsed.end}/${total}`,
      'accept-ranges': 'bytes',
    },
  });
}

async function trimCache(name, maxEntries) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const drop = keys.slice(0, keys.length - maxEntries);
  await Promise.all(drop.map((k) => cache.delete(k)));
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(['/login', '/icon.svg', '/manifest.webmanifest']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;

  // 1. Immutable static assets -> cache first
  if (u.pathname.startsWith('/_next/static/') || /\.(png|svg|woff2|webmanifest)$/.test(u.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => {
        if (r.ok) { const c = r.clone(); caches.open(SHELL).then((s) => s.put(req, c)); }
        return r;
      })),
    );
    return;
  }

  // 2. Cover art (/api/art/*) -> cache first, bounded LRU
  if (u.pathname.startsWith('/api/art/')) {
    e.respondWith(
      caches.open(ART).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const r = await fetch(req);
        if (r.ok) {
          cache.put(req, r.clone()).then(() => trimCache(ART, MAX_ART)).catch(() => {});
        }
        return r;
      }),
    );
    return;
  }

  // 3. Audio (/api/audio/*) -> serve cached full body with synthesized HTTP 206 Range when present,
  //    otherwise fetch network (and opportunistically cache full 200 responses for offline replay).
  if (u.pathname.startsWith('/api/audio/')) {
    const cacheKey = new Request(u.origin + u.pathname, { method: 'GET' });
    const rangeHeader = req.headers.get('range');
    e.respondWith(
      caches.open(AUDIO).then(async (cache) => {
        const hit = await cache.match(cacheKey);
        if (hit) return synthesizeRangeResponse(hit, rangeHeader);
        const r = await fetch(req);
        if (r.status === 200 && !rangeHeader) {
          cache.put(cacheKey, r.clone()).then(() => trimCache(AUDIO, MAX_AUDIO)).catch(() => {});
        }
        return r;
      }),
    );
    return;
  }

  // 4. Read-only browse/info/moods API GETs -> network-first with offline cache fallback
  if (/^\/api\/(home|station\/|info\/|device\/moods)/.test(u.pathname)) {
    e.respondWith(
      caches.open(API).then(async (cache) => {
        try {
          const r = await fetch(req);
          if (r.ok) cache.put(req, r.clone()).catch(() => {});
          return r;
        } catch {
          const hit = await cache.match(req);
          if (hit) return hit;
          return new Response(JSON.stringify({ offline: true }), { status: 503, headers: { 'content-type': 'application/json' } });
        }
      }),
    );
    return;
  }

  // 5. Navigation -> network-first, fall back to cached app shell or /login
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.open(SHELL).then(async (cache) => {
        try {
          const r = await fetch(req);
          if (r.ok && u.pathname === '/') cache.put(req, r.clone()).catch(() => {});
          return r;
        } catch {
          return (await cache.match(req)) || (await cache.match('/')) || (await cache.match('/login'));
        }
      }),
    );
  }
});
