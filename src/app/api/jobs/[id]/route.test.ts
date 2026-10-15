// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resetTestDb, sharedTestDb } from '@/lib/db/test-db';
import type { Db } from '@/lib/db/types';
import { createSession, createUser } from '@/lib/auth/users';
import { getJobStore } from '@/lib/jobs';

const state = vi.hoisted(() => ({ db: undefined as unknown, headers: new Headers() }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('next/headers', () => ({ headers: async () => state.headers }));
const { GET } = await import('./route');

let db: Db;
beforeAll(async () => {
  db = await sharedTestDb();
  state.db = db;
});
beforeEach(async () => {
  await resetTestDb(db);
  state.headers = new Headers();
  vi.stubEnv('DATABASE_URL', 'postgres://test');
  vi.stubEnv('WORKER_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

const PROJECT = randomUUID();
const poll = (id: string) => GET(new Request(`http://localhost/api/jobs/${id}`), { params: Promise.resolve({ id }) });

async function signIn(email: string) {
  const user = await createUser(db, email, 'a-good-password');
  state.headers = new Headers({ cookie: `session=${await createSession(db, user.id)}` });
  return { user, jobs: await getJobStore(user.id) };
}

describe('GET /api/jobs/[id]', () => {
  it('reports a queued job', async () => {
    const { jobs } = await signIn('a@example.com');
    const job = await jobs.create(PROJECT, 'refine', { message: 'x' });
    const res = await poll(job.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ id: job.id, kind: 'refine', status: 'queued' });
  });

  it('reports a running job without result or error', async () => {
    const { jobs } = await signIn('a@example.com');
    const job = await jobs.create(PROJECT, 'extract', {});
    await jobs.claim(job.id);
    expect(await (await poll(job.id)).json()).toEqual({ id: job.id, kind: 'extract', status: 'running' });
  });

  it('returns the result of a done job', async () => {
    const { jobs } = await signIn('a@example.com');
    const job = await jobs.create(PROJECT, 'refine', { message: 'x' });
    await jobs.claim(job.id);
    await jobs.complete(job.id, { reply: 'hi', patch: [] });
    expect(await (await poll(job.id)).json()).toEqual({
      id: job.id,
      kind: 'refine',
      status: 'done',
      result: { reply: 'hi', patch: [] },
    });
  });

  it('returns the error body of a failed job', async () => {
    const { jobs } = await signIn('a@example.com');
    const job = await jobs.create(PROJECT, 'extract', {});
    await jobs.claim(job.id);
    await jobs.fail(job.id, { status: 502, error: 'model kept answering badly', issues: ['x'] });
    const res = await poll(job.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: job.id,
      kind: 'extract',
      status: 'failed',
      error: { status: 502, error: 'model kept answering badly', issues: ['x'] },
    });
  });

  it("is 404 for another user's job, an unknown id and a non-UUID id", async () => {
    const { jobs } = await signIn('a@example.com');
    const job = await jobs.create(PROJECT, 'refine', { message: 'x' });
    await signIn('b@example.com');
    for (const id of [job.id, randomUUID(), 'not-a-uuid', '..']) {
      const res = await poll(id);
      expect(res.status, id).toBe(404);
      expect(res.headers.get('cache-control'), id).toBe('no-store');
      expect(await res.json(), id).toEqual({ error: 'job not found' });
    }
    // B's poll did not touch A's job.
    expect((await jobs.get(job.id))!.status).toBe('queued');
  });

  it('is 401 without a valid session', async () => {
    const { jobs } = await signIn('a@example.com');
    const job = await jobs.create(PROJECT, 'refine', { message: 'x' });
    state.headers = new Headers({ cookie: 'session=bogus' });
    const res = await poll(job.id);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });
});
