/* Home Design offline worker: view-only caching. Never caches writes, auth, health or jobs. */
const STATIC = 'hd-static-v2';
const PAGES = 'hd-pages-v1';
const PHOTOS = 'hd-photos-v1';
const CURRENT = [STATIC, PAGES, PHOTOS];
const MAX_PHOTOS = 300;
const MAX_PAGES = 100;
const MAX_STATIC = 200;
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
    const done = caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('hd-')).map((n) => caches.delete(n))))
      .then(() => {
        // Tell the page the caches are gone (it waits for this before signing out / in).
        if (event.ports && event.ports[0]) event.ports[0].postMessage('cleared');
      });
    event.waitUntil(done);
  }
});

const NEVER = [/^\/api\/auth(\/|$)/, /^\/api\/health(\/|$)/, /^\/api\/jobs(\/|$)/];
const PHOTO = /^\/api\/projects\/[^/]+\/photos\/[^/]+/;
const PROJECT_API = /^\/api\/projects(\/[^/]+)?\/?$/;
const STATIC_PATH = /^\/(_next\/static\/|icons\/|manifest\.json$)/;
// Unhashed files: serve the cached copy but refresh it in the background.
const REVALIDATE_PATH = /^\/(icons\/|manifest\.json$)/;

// Only plain 200s that were not redirected (a redirect to /login must never be stored under a project URL).
// `no-store` is honoured unless the caller says the route is cached on purpose: Next's dynamic pages and
// GET /api/projects/<id> send no-store but are exactly what "view offline" needs.
const cacheable = (res, ignoreNoStore) =>
  !!res &&
  res.status === 200 &&
  !res.redirected &&
  (ignoreNoStore || !/no-store/i.test(res.headers.get('cache-control') || ''));

// The session is gone: the server sent us to /login (an opaque redirect for navigations) or answered 401.
function authLost(res) {
  if (!res) return false;
  if (res.status === 401 || res.type === 'opaqueredirect') return true;
  if (res.redirected) {
    try {
      return new URL(res.url).pathname.startsWith('/login');
    } catch (e) {
      return false;
    }
  }
  return false;
}

// Per-user data must not outlive the session that fetched it.
function purgeUserData() {
  return Promise.all([caches.delete(PAGES), caches.delete(PHOTOS)]);
}

async function trim(cache, max) {
  // Never evict the offline fallback page.
  const keys = (await cache.keys()).filter((k) => new URL(k.url).pathname !== OFFLINE_URL);
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

async function put(name, request, res) {
  const cache = await caches.open(name);
  await cache.put(request, res);
  return cache;
}

async function cacheFirst(request, name, max) {
  max = max || MAX_STATIC;
  const cached = await caches.match(request, { cacheName: name });
  if (cached) return cached;
  const res = await fetch(request);
  if (authLost(res)) await purgeUserData();
  else if (cacheable(res)) await trim(await put(name, request, res.clone()), max);
  return res;
}

async function staleWhileRevalidate(request, name, max, event) {
  const cached = await caches.match(request, { cacheName: name });
  const refresh = fetch(request)
    .then(async (res) => {
      if (cacheable(res)) await trim(await put(name, request, res.clone()), max);
      return res;
    })
    .catch((err) => {
      if (!cached) throw err;
      return cached;
    });
  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }
  return refresh;
}

async function networkFirst(request, fallbackToOffline) {
  try {
    const res = await fetch(request);
    if (authLost(res)) await purgeUserData();
    else if (cacheable(res, true)) await trim(await put(PAGES, request, res.clone()), MAX_PAGES);
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
  } else if (REVALIDATE_PATH.test(path)) {
    event.respondWith(staleWhileRevalidate(request, STATIC, MAX_STATIC, event));
  } else if (STATIC_PATH.test(path)) {
    event.respondWith(cacheFirst(request, STATIC, MAX_STATIC));
  } else if (request.mode === 'navigate') {
    // Server routes (exports, JSON) opened as a page are not app pages: never cached.
    if (path === '/sw.js' || path.startsWith('/api/')) return;
    event.respondWith(networkFirst(request, true));
  } else if (PROJECT_API.test(path)) {
    event.respondWith(networkFirst(request, false));
  }
});
