import { describe, it, expect, vi, afterEach } from 'vitest';
import { cacheUrls, clearOfflineCaches, purgeProjectCache } from './offline-cache';

function fakeCaches(names: string[]) {
  const stores = new Map<string, Map<string, Response>>(names.map((n) => [n, new Map()]));
  const open = vi.fn(async (n: string) => {
    if (!stores.has(n)) stores.set(n, new Map());
    const m = stores.get(n)!;
    return {
      put: vi.fn(async (u: string, r: Response) => void m.set(u, r)),
      keys: vi.fn(async () => [...m.keys()].map((url) => ({ url }))),
      delete: vi.fn(async (req: string | { url: string }) => m.delete(typeof req === 'string' ? req : req.url)),
    };
  });
  return {
    stores,
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (n: string) => stores.delete(n)),
    open,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
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

  it('asks the worker to clear and waits for its reply before finishing', async () => {
    vi.stubGlobal('caches', fakeCaches([]));
    let port: MessagePort | undefined;
    const postMessage = vi.fn((_msg: unknown, ports: MessagePort[]) => {
      port = ports[0];
    });
    Object.defineProperty(navigator, 'serviceWorker', { value: { controller: { postMessage } } as unknown, configurable: true });
    let done = false;
    const p = clearOfflineCaches().then(() => (done = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(postMessage).toHaveBeenCalledWith({ type: 'clear' }, [expect.anything()]);
    expect(done).toBe(false); // still waiting for the ack
    port!.postMessage('cleared'); // the worker's reply goes to port1 via its own port2
    await p;
    expect(done).toBe(true);
  });

  it('gives up waiting for a silent worker after a short timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('caches', fakeCaches([]));
    Object.defineProperty(navigator, 'serviceWorker', { value: { controller: { postMessage: vi.fn() } } as unknown, configurable: true });
    const p = clearOfflineCaches();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it('is a no-op without the caches API and never throws', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(clearOfflineCaches()).resolves.toBeUndefined();
    vi.stubGlobal('caches', { keys: async () => { throw new Error('boom'); } });
    await expect(clearOfflineCaches()).resolves.toBeUndefined();
  });
});

describe('cacheUrls', () => {
  it('caches only plain 200s, routes photos to hd-photos-v1, counts failures', async () => {
    const c = fakeCaches([]);
    vi.stubGlobal('caches', c);
    const redirected = new Response('login', { status: 200 });
    Object.defineProperty(redirected, 'redirected', { value: true });
    const fetchMock = vi.fn(async (u: string) => {
      if (u === '/bad') return new Response('x', { status: 404 });
      if (u === '/redir') return redirected;
      if (u === '/throw') throw new Error('net');
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await cacheUrls(['/api/projects/p1', '/api/projects/p1/photos/a', '/bad', '/redir', '/throw']);
    expect(r).toEqual({ cached: 2, failed: 3 });
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1', { credentials: 'same-origin' });
    expect([...c.stores.get('hd-pages-v1')!.keys()]).toEqual(['/api/projects/p1']);
    expect([...c.stores.get('hd-photos-v1')!.keys()]).toEqual(['/api/projects/p1/photos/a']);
  });

  it('trims the photo cache to 300 entries, oldest first', async () => {
    const c = fakeCaches([]);
    vi.stubGlobal('caches', c);
    const photos = c.stores;
    photos.set('hd-photos-v1', new Map(Array.from({ length: 300 }, (_, i) => [`/api/projects/old/photos/${i}`, new Response('x')])));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    await cacheUrls(['/api/projects/p1/photos/new']);
    const keys = [...photos.get('hd-photos-v1')!.keys()];
    expect(keys).toHaveLength(300);
    expect(keys).not.toContain('/api/projects/old/photos/0');
    expect(keys.at(-1)).toBe('/api/projects/p1/photos/new');
  });

  it('reports everything failed without the caches API', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await cacheUrls(['/a', '/b'])).toEqual({ cached: 0, failed: 2 });
  });
});

describe('purgeProjectCache', () => {
  it('removes that project’s page, document and photos only', async () => {
    const c = fakeCaches([]);
    vi.stubGlobal('caches', c);
    const entry = () => new Response('x');
    c.stores.set('hd-pages-v1', new Map([
      ['http://h/project/p1', entry()],
      ['http://h/api/projects/p1', entry()],
      ['http://h/project/p10', entry()],
      ['http://h/api/projects/p2', entry()],
      ['http://h/', entry()],
    ]));
    c.stores.set('hd-photos-v1', new Map([
      ['http://h/api/projects/p1/photos/a', entry()],
      ['http://h/api/projects/p2/photos/b', entry()],
    ]));
    await purgeProjectCache('p1');
    expect([...c.stores.get('hd-pages-v1')!.keys()]).toEqual(['http://h/project/p10', 'http://h/api/projects/p2', 'http://h/']);
    expect([...c.stores.get('hd-photos-v1')!.keys()]).toEqual(['http://h/api/projects/p2/photos/b']);
  });
});
