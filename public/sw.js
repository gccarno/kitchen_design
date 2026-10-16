/* Home Design offline worker: view-only caching. Never caches writes, auth, health or jobs. */
const STATIC = 'hd-static-v1';
const PAGES = 'hd-pages-v1';
const PHOTOS = 'hd-photos-v1';
const CURRENT = [STATIC, PAGES, PHOTOS];
const MAX_PHOTOS = 300;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((c) => c.add(OFFLINE_URL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('hd-') && !CURRENT.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((n) => n.startsWith('hd-')).map((n) => caches.delete(n)))));
  }
});

const NEVER = [/^\/api\/auth(\/|$)/, /^\/api\/health(\/|$)/, /^\/api\/jobs(\/|$)/];
const PHOTO = /^\/api\/projects\/[^/]+\/photos\/[^/]+/;
const PROJECT_API = /^\/api\/projects(\/[^/]+)?\/?$/;
const STATIC_PATH = /^\/(_next\/static\/|icons\/|manifest\.json$)/;

// Only plain 200s that were not redirected (a redirect to /login must never be stored under a project URL).
const cacheable = (res) => res && res.status === 200 && !res.redirected;

async function put(name, request, res) {
  const cache = await caches.open(name);
  await cache.put(request, res);
  return cache;
}

async function cacheFirst(request, name, max) {
  const cached = await caches.match(request, { cacheName: name });
  if (cached) return cached;
  const res = await fetch(request);
  if (cacheable(res)) {
    const cache = await put(name, request, res.clone());
    if (max) {
      const keys = await cache.keys();
      for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
    }
  }
  return res;
}

async function networkFirst(request, fallbackToOffline) {
  try {
    const res = await fetch(request);
    if (cacheable(res)) await put(PAGES, request, res.clone());
    return res;
  } catch (err) {
    const cached = await caches.match(request, { cacheName: PAGES });
    if (cached) return cached;
    if (fallbackToOffline) {
      const offline = await caches.match(OFFLINE_URL, { cacheName: STATIC });
      if (offline) return offline;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (NEVER.some((re) => re.test(path))) return;

  if (PHOTO.test(path)) {
    event.respondWith(cacheFirst(request, PHOTOS, MAX_PHOTOS));
  } else if (STATIC_PATH.test(path)) {
    event.respondWith(cacheFirst(request, STATIC));
  } else if (request.mode === 'navigate') {
    if (path === '/sw.js') return;
    event.respondWith(networkFirst(request, true));
  } else if (PROJECT_API.test(path)) {
    event.respondWith(networkFirst(request, false));
  }
});
