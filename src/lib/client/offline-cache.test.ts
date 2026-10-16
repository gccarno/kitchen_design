import { describe, it, expect, vi, afterEach } from 'vitest';
import { cacheUrls, clearOfflineCaches } from './offline-cache';

function fakeCaches(names: string[]) {
  const stores = new Map<string, Map<string, Response>>(names.map((n) => [n, new Map()]));
  return {
    stores,
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (n: string) => stores.delete(n)),
    open: vi.fn(async (n: string) => {
      if (!stores.has(n)) stores.set(n, new Map());
      const m = stores.get(n)!;
      return { put: vi.fn(async (u: string, r: Response) => void m.set(u, r)) };
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clearOfflineCaches', () => {
  it('deletes only hd- caches', async () => {
    const c = fakeCaches(['hd-static-v1', 'hd-pages-v1', 'other']);
    vi.stubGlobal('caches', c);
    await clearOfflineCaches();
    expect(c.delete).toHaveBeenCalledWith('hd-static-v1');
    expect(c.delete).toHaveBeenCalledWith('hd-pages-v1');
    expect(c.delete).not.toHaveBeenCalledWith('other');
  });

  it('asks the active worker to clear too', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('caches', fakeCaches([]));
    Object.defineProperty(navigator, 'serviceWorker', { value: { controller: { postMessage } } as unknown, configurable: true });
    await clearOfflineCaches();
    expect(postMessage).toHaveBeenCalledWith({ type: 'clear' });
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
  });

  it('is a no-op without the caches API and never throws', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(clearOfflineCaches()).resolves.toBeUndefined();
    vi.stubGlobal('caches', { keys: async () => { throw new Error('boom'); } });
    await expect(clearOfflineCaches()).resolves.toBeUndefined();
  });
});

describe('cacheUrls', () => {
  it('caches 200s, routes photos to hd-photos-v1, counts failures', async () => {
    const c = fakeCaches([]);
    vi.stubGlobal('caches', c);
    const fetchMock = vi.fn(async (u: string) => {
      if (u === '/bad') return new Response('x', { status: 404 });
      if (u === '/throw') throw new Error('net');
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await cacheUrls(['/api/projects/p1', '/api/projects/p1/photos/a', '/bad', '/throw']);
    expect(r).toEqual({ cached: 2, failed: 2 });
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1', { credentials: 'same-origin' });
    expect(c.open).toHaveBeenCalledWith('hd-pages-v1');
    expect(c.open).toHaveBeenCalledWith('hd-photos-v1');
  });

  it('reports everything failed without the caches API', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await cacheUrls(['/a', '/b'])).toEqual({ cached: 0, failed: 2 });
  });
});
