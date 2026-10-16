/** Client helpers for the offline caches owned by public/sw.js (all cache names start with `hd-`). */
const PREFIX = 'hd-';
const PAGES = 'hd-pages-v1';
const PHOTOS = 'hd-photos-v1';

const MAX_PHOTOS = 300;
const MAX_PAGES = 100;
const ACK_TIMEOUT_MS = 1000;

async function deleteHdCaches(): Promise<void> {
  try {
    if (typeof caches !== 'undefined' && caches) {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(PREFIX)).map((n) => caches.delete(n)));
    }
  } catch {
    /* best effort */
  }
}

/** Asks the active worker to clear its caches and waits (briefly) for its reply. Never throws. */
function clearViaWorker(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const controller = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : undefined;
      if (!controller) return resolve();
      const channel = new MessageChannel();
      const timer = setTimeout(resolve, ACK_TIMEOUT_MS);
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        resolve();
      };
      controller.postMessage({ type: 'clear' }, [channel.port2]);
    } catch {
      resolve();
    }
  });
}

/**
 * Deletes every hd- cache and has the active worker do the same, waiting for it
 * so an in-flight worker write cannot repopulate the cache afterwards. Never throws.
 */
export async function clearOfflineCaches(): Promise<void> {
  await deleteHdCaches();
  await clearViaWorker();
  await deleteHdCaches();
}

/** Drops one project's cached page, document and photos (after it is deleted). Never throws. */
export async function purgeProjectCache(projectId: string): Promise<void> {
  try {
    if (typeof caches === 'undefined' || !caches) return;
    const doc = `/api/projects/${projectId}`;
    for (const name of [PAGES, PHOTOS]) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        const path = new URL(req.url, 'http://x').pathname;
        if (path === `/project/${projectId}` || path === doc || path.startsWith(`${doc}/`)) await cache.delete(req);
      }
    }
  } catch {
    /* best effort */
  }
}

async function trim(cache: Cache, max: number): Promise<void> {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

const isPhotoUrl = (url: string) => /\/api\/projects\/[^/]+\/photos\/[^/?#]+/.test(url);

/** Fetches each URL and stores 200 responses for offline use. */
export async function cacheUrls(urls: string[]): Promise<{ cached: number; failed: number }> {
  if (typeof caches === 'undefined' || !caches) return { cached: 0, failed: urls.length };
  let cached = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (res.status !== 200 || res.redirected) {
        failed++;
        continue;
      }
      const cache = await caches.open(isPhotoUrl(url) ? PHOTOS : PAGES);
      await cache.put(url, res);
      await trim(cache, isPhotoUrl(url) ? MAX_PHOTOS : MAX_PAGES);
      cached++;
    } catch {
      failed++;
    }
  }
  return { cached, failed };
}
