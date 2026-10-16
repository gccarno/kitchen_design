// @vitest-environment node
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkerServer, type WorkerDeps } from './server';

let server: ReturnType<typeof createWorkerServer> | undefined;

async function start(deps: Partial<WorkerDeps> = {}) {
  server = createWorkerServer({ token: 'secret', owner: async () => ({ userId: null }), run: async () => {}, ...deps });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (id: string, auth: string | null = 'Bearer secret') =>
    fetch(`${base}/run/${id}`, { method: 'POST', headers: auth ? { Authorization: auth } : {} });
  return { base, post };
}

afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r(null)));
  server = undefined;
});

describe('worker server', () => {
  it('serves /health without auth', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('rejects a missing or wrong token without running anything', async () => {
    const run = vi.fn(async () => {});
    const { post } = await start({ run });
    expect((await post(randomUUID(), null)).status).toBe(401);
    expect((await post(randomUUID(), 'Bearer nope')).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('accepts with 202 and runs the job in the background', async () => {
    const run = vi.fn(async () => {});
    const { post } = await start({ run });
    const id = randomUUID();
    expect((await post(id)).status).toBe(202);
    expect(run).toHaveBeenCalledWith(id);
  });

  it('answers 404 for unknown or malformed job ids', async () => {
    const run = vi.fn(async () => {});
    const { post } = await start({ run, owner: async () => null });
    expect((await post(randomUUID())).status).toBe(404);
    expect((await post('not-a-uuid')).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 503 when at capacity, then recovers', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { post } = await start({ run: () => gate, maxConcurrent: 1 });
    expect((await post(randomUUID())).status).toBe(202);
    expect((await post(randomUUID())).status).toBe(503);
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect((await post(randomUUID())).status).toBe(202);
  });
});
