/** Client helpers for the offline caches owned by public/sw.js (all cache names start with `hd-`). */
const PREFIX = 'hd-';
const PAGES = 'hd-pages-v1';
const PHOTOS = 'hd-photos-v1';

/** Deletes every hd- cache and asks the active worker to do the same. Never throws. */
export async function clearOfflineCaches(): Promise<void> {
  try {
    if (typeof caches !== 'undefined' && caches) {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(PREFIX)).map((n) => caches.delete(n)));
    }
  } catch {
    /* best effort */
  }
  try {
    if (typeof navigator !== 'undefined') navigator.serviceWorker?.controller?.postMessage({ type: 'clear' });
  } catch {
    /* best effort */
  }
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
      cached++;
    } catch {
      failed++;
    }
  }
  return { cached, failed };
}
