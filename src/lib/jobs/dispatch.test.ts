// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dispatchJob, ensureProgress } from './dispatch';
// A job store whose clock the tests control (the real one reads Date.now captured at creation).
const clock = vi.hoisted(() => ({ now: 1_700_000_000_000 }));
vi.mock('./index', async () => {
  const { MemJobStore, MemJobTable } = await import('./mem-jobs');
  const table = new MemJobTable(() => clock.now);
  return { getJobStore: async (userId: string | null) => new MemJobStore(table, userId) };
});
const { getJobStore } = await import('./index');

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const env = { WORKER_URL: 'http://worker.test/', WORKER_TOKEN: 'tok' };

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const asFetch = (fn: unknown) => fn as typeof fetch;

describe('dispatchJob', () => {
  it('posts to the worker with the bearer token and returns worker on 2xx', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 202 }));
    const run = vi.fn(async () => {});
    expect(await dispatchJob(ID, { env, fetch: asFetch(fetchFn), run })).toBe('worker');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://worker.test/run/${ID}`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(init.body).toBe('{}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-2xx', async () => new Response('no', { status: 500 })],
    ['a network error', async () => Promise.reject(new TypeError('fetch failed'))],
    ['a timeout', async () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
  ])('falls back to a local run on %s', async (_n, impl) => {
    const run = vi.fn(async () => {});
    expect(await dispatchJob(ID, { env, fetch: asFetch(vi.fn(impl)), run })).toBe('local');
    expect(run).toHaveBeenCalledWith(ID);
  });

  it('runs locally without touching fetch when no worker is configured', async () => {
    const fetchFn = vi.fn();
    const run = vi.fn(async () => {});
    expect(await dispatchJob(ID, { env: {}, fetch: asFetch(fetchFn), run })).toBe('local');
    expect(await dispatchJob(ID, { env: { WORKER_URL: 'http://x' }, fetch: asFetch(fetchFn), run })).toBe('local');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not wait for the local run and swallows its errors', async () => {
    const run = vi.fn(() => new Promise<void>((_, reject) => setTimeout(() => reject(new Error('x')), 10)));
    expect(await dispatchJob(ID, { env: {}, run, now: () => clock.now })).toBe('local');
    await new Promise((r) => setTimeout(r, 40));
    expect(console.error).toHaveBeenCalled();
  });
});

describe('ensureProgress', () => {
  const PROJECT = '9a1f8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

  it('re-dispatches a stale running job once it is requeued', async () => {
    const store = await getJobStore(null);
    const job = await store.create(PROJECT, 'refine', { message: 'x' });
    await store.claim(job.id);
    const run = vi.fn(async () => {});
    clock.now += 16 * 60 * 1000;
    const running = (await store.get(job.id))!;
    expect(await ensureProgress(running, { env: {}, run, now: () => clock.now })).toBe('requeued');
    expect(run).toHaveBeenCalledWith(job.id);
    expect((await store.get(job.id))!.status).toBe('queued');
  });

  it('does nothing for a fresh running job', async () => {
    const store = await getJobStore(null);
    const job = await store.create(PROJECT, 'refine', {});
    const running = (await store.claim(job.id))!;
    const run = vi.fn(async () => {});
    expect(await ensureProgress(running, { env: {}, run, now: () => clock.now })).toBe('noop');
    expect(run).not.toHaveBeenCalled();
  });

  it('dispatches a job that has sat queued, never started', async () => {
    const store = await getJobStore(null);
    const job = await store.create(PROJECT, 'refine', {});
    const run = vi.fn(async () => {});
    expect(await ensureProgress(job, { env: {}, run, now: () => clock.now })).toBe('noop');
    clock.now += 2 * 60 * 1000;
    expect(await ensureProgress(job, { env: {}, run, now: () => clock.now })).toBe('requeued');
    expect(run).toHaveBeenCalledWith(job.id);
  });

  it('marks a job failed after too many attempts and does not dispatch', async () => {
    const store = await getJobStore(null);
    const job = await store.create(PROJECT, 'refine', {});
    const run = vi.fn(async () => {});
    for (let i = 0; i < 3; i++) {
      await store.claim(job.id);
      clock.now += 16 * 60 * 1000;
      const cur = (await store.get(job.id))!;
      expect(await ensureProgress(cur, { env: {}, run, now: () => clock.now })).toBe(i < 2 ? 'requeued' : 'failed');
    }
    expect((await store.get(job.id))!.error).toEqual({ status: 500, error: 'job timed out' });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
