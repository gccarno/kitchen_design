import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Loads public/sw.js against a fake worker scope and an in-memory Cache Storage. */
const SOURCE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');
type Listener = (event: unknown) => void;

function makeEnv(fetchImpl: (req: Request) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>();
  const urlOf = (r: unknown) => (typeof r === 'string' ? new URL(r, 'https://app.test').href : (r as { url: string }).url);
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      put: async (r: unknown, res: Response) => void m.set(urlOf(r), res),
      add: async (r: string) => void m.set(urlOf(r), new Response('offline page')),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (r: unknown) => m.delete(urlOf(r)),
    };
  };
  const caches = {
    open: async (n: string) => cacheFor(n),
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (r: unknown, opts?: { cacheName?: string }) => {
      for (const [n, m] of stores) if (!opts?.cacheName || opts.cacheName === n) if (m.has(urlOf(r))) return m.get(urlOf(r));
      return undefined;
    },
  };
  const listeners: Record<string, Listener> = {};
  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (t: string, l: Listener) => (listeners[t] = l),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  new Function('self', 'caches', 'fetch', SOURCE)(self, caches, fetchImpl);
  /** Dispatch a fetch event; resolves to the response, or null if the worker did not handle it. */
  async function dispatch(url: string, init: { method?: string; mode?: string } = {}) {
    const request = { url: new URL(url, 'https://app.test').href, method: init.method ?? 'GET', mode: init.mode ?? 'cors' } as unknown as Request;
    let handled: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    listeners.fetch({ request, respondWith: (p: Promise<Response>) => (handled = p), waitUntil: (p: Promise<unknown>) => waits.push(p) });
    const res = handled ? await (handled as Promise<Response>) : null;
    await Promise.all(waits);
    return res;
  }
  return { stores, caches, listeners, dispatch };
}

const ok = (body = 'ok', headers: Record<string, string> = {}) => new Response(body, { status: 200, headers });
const keysOf = (e: ReturnType<typeof makeEnv>, n: string) => [...(e.stores.get(n)?.keys() ?? [])].map((u) => new URL(u).pathname);
const redirectedTo = (url: string) => {
  const res = new Response('<html>', { status: 200 });
  Object.defineProperty(res, 'redirected', { value: true });
  Object.defineProperty(res, 'url', { value: url });
  return res;
};

describe('public/sw.js', () => {
  let env: ReturnType<typeof makeEnv>;
  let respond: (req: Request) => Promise<Response>;
  beforeEach(() => {
    respond = async () => ok();
    env = makeEnv((req) => respond(req));
  });

  it('caches a 200 project document and serves it when the network fails', async () => {
    await env.dispatch('/api/projects/p1');
    expect(keysOf(env, 'hd-pages-v1')).toEqual(['/api/projects/p1']);
    respond = async () => {
      throw new TypeError('offline');
    };
    const res = await env.dispatch('/api/projects/p1');
    expect(await res!.text()).toBe('ok');
  });

  it('never touches /api/auth, /api/health, /api/jobs or writes', async () => {
    for (const p of ['/api/auth/me', '/api/health', '/api/jobs/j1']) expect(await env.dispatch(p, { mode: 'navigate' })).toBeNull();
    expect(await env.dispatch('/api/projects/p1', { method: 'POST' })).toBeNull();
    expect(env.stores.size).toBe(0);
  });

  it('does not cache non-200 or redirected responses', async () => {
    respond = async () => new Response('nope', { status: 500 });
    await env.dispatch('/api/projects/p1');
    respond = async () => redirectedTo('https://app.test/api/other');
    await env.dispatch('/api/projects/p2');
    expect(keysOf(env, 'hd-pages-v1')).toEqual([]);
  });

  it('does not cache API routes opened as navigations, or no-store photos', async () => {
    expect(await env.dispatch('/api/export/p1/svg', { mode: 'navigate' })).toBeNull();
    respond = async () => ok('img', { 'cache-control': 'no-store' });
    await env.dispatch('/api/projects/p1/photos/a');
    expect(keysOf(env, 'hd-photos-v1')).toEqual([]);
    expect(env.stores.has('hd-pages-v1')).toBe(false);
  });

  it('caches page navigations and falls back to /offline for uncached ones', async () => {
    await env.dispatch('/project/p1', { mode: 'navigate' });
    expect(keysOf(env, 'hd-pages-v1')).toEqual(['/project/p1']);
    await env.listeners.install({ waitUntil: () => undefined });
    respond = async () => {
      throw new TypeError('offline');
    };
    expect(await (await env.dispatch('/project/p1', { mode: 'navigate' }))!.text()).toBe('ok');
    expect(await (await env.dispatch('/project/zzz', { mode: 'navigate' }))!.text()).toBe('offline page');
  });

  it('purges cached pages and photos when a navigation is redirected (session ended)', async () => {
    await env.dispatch('/project/p1', { mode: 'navigate' });
    await env.dispatch('/api/projects/p1/photos/a');
    expect(keysOf(env, 'hd-photos-v1')).toHaveLength(1);
    respond = async () => ({ status: 0, type: 'opaqueredirect', redirected: false, headers: new Headers() }) as unknown as Response;
    await env.dispatch('/', { mode: 'navigate' });
    expect(env.stores.has('hd-pages-v1')).toBe(false);
    expect(env.stores.has('hd-photos-v1')).toBe(false);
  });

  it('purges on a 401 API response and on a fetch redirected to /login', async () => {
    await env.dispatch('/api/projects/p1');
    respond = async () => new Response('{}', { status: 401 });
    await env.dispatch('/api/projects');
    expect(env.stores.has('hd-pages-v1')).toBe(false);

    respond = async () => ok();
    await env.dispatch('/api/projects/p1');
    expect(keysOf(env, 'hd-pages-v1')).toHaveLength(1);
    respond = async () => redirectedTo('https://app.test/login?next=%2F');
    await env.dispatch('/api/projects');
    expect(env.stores.has('hd-pages-v1')).toBe(false);
  });

  it('keeps at most 300 photos, evicting the oldest', async () => {
    for (let i = 0; i < 302; i++) await env.dispatch(`/api/projects/p1/photos/${i}`);
    const keys = keysOf(env, 'hd-photos-v1');
    expect(keys).toHaveLength(300);
    expect(keys).not.toContain('/api/projects/p1/photos/0');
    expect(keys.at(-1)).toBe('/api/projects/p1/photos/301');
  });

  it('keeps at most 100 pages', async () => {
    for (let i = 0; i < 103; i++) await env.dispatch(`/project/${i}`, { mode: 'navigate' });
    expect(keysOf(env, 'hd-pages-v1')).toHaveLength(100);
  });

  it('serves the manifest from cache while refreshing it', async () => {
    respond = async () => ok('v1');
    await env.dispatch('/manifest.json');
    respond = async () => ok('v2');
    expect(await (await env.dispatch('/manifest.json'))!.text()).toBe('v1');
    expect(await env.stores.get('hd-static-v2')!.get('https://app.test/manifest.json')!.text()).toBe('v2');
  });

  it('clear message deletes every hd- cache and acknowledges on the port', async () => {
    await env.dispatch('/api/projects/p1');
    await env.dispatch('/api/projects/p1/photos/a');
    await env.caches.open('other');
    const postMessage = vi.fn();
    const waits: Promise<unknown>[] = [];
    env.listeners.message({ data: { type: 'clear' }, ports: [{ postMessage }], waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect([...env.stores.keys()]).toEqual(['other']);
    expect(postMessage).toHaveBeenCalledWith('cleared');
  });
});
