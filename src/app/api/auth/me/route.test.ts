// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { resetTestDb, sharedTestDb } from '@/lib/db/test-db';
import type { Db } from '@/lib/db/types';
import { createSession, createUser, revokeToken } from '@/lib/auth/users';
import { GET } from './route';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));

const URL = 'http://localhost/api/auth/me';
let db: Db;

beforeAll(async () => {
  db = await sharedTestDb();
  state.db = db;
});
beforeEach(async () => {
  await resetTestDb(db);
  vi.stubEnv('DATABASE_URL', 'postgres://test');
});
afterEach(() => vi.unstubAllEnvs());

const get = (headers: Record<string, string> = {}) => GET(new Request(URL, { headers }));

describe('GET /api/auth/me', () => {
  it('returns the user for a session cookie and for a Bearer token', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    const t = await createSession(db, u.id);
    const variants: Record<string, string>[] = [{ cookie: `session=${t}` }, { authorization: `Bearer ${t}` }];
    for (const headers of variants) {
      const res = await get(headers);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: u.id, email: 'a@example.com' });
    }
  });

  it('is 401 with no, unknown, or revoked token', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    const t = await createSession(db, u.id);
    await revokeToken(db, t);
    expect((await get()).status).toBe(401);
    expect((await get({ cookie: 'session=bogus' })).status).toBe(401);
    expect((await get({ cookie: `session=${t}` })).status).toBe(401);
  });

  it('ignores a forged x-user-id header', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    expect((await get({ 'x-user-id': u.id })).status).toBe(401);
  });

  it('returns 404 when auth is disabled', async () => {
    vi.stubEnv('DATABASE_URL', '');
    expect((await get()).status).toBe(404);
  });
});
