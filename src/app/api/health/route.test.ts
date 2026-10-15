// @vitest-environment node
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { sharedTestDb } from '@/lib/db/test-db';
import { GET } from './route';

const state = vi.hoisted(() => ({ db: undefined as unknown, fail: false }));
vi.mock('@/lib/db/client', () => ({
  getDb: () => {
    if (state.fail) throw new Error('db down');
    return state.db;
  },
}));

beforeAll(async () => {
  state.db = await sharedTestDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  state.fail = false;
});

describe('GET /api/health', () => {
  it('is 200 ok with a healthy database', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://test');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('is 503 when the database check fails', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://test');
    state.fail = true;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });

  it('is 200 without touching the database when auth is disabled', async () => {
    vi.stubEnv('DATABASE_URL', '');
    state.fail = true;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
