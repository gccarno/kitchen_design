// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { resetTestDb, sharedTestDb } from '@/lib/db/test-db';
import type { Db } from '@/lib/db/types';
import { jsonReq } from '@/lib/auth/route-test-helpers';
import { createSession, createUser, userForToken } from '@/lib/auth/users';
import { POST } from './route';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));

const URL = 'http://localhost/api/auth/logout';
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

describe('POST /api/auth/logout', () => {
  it('revokes the cookie token and clears the cookie', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    const t1 = await createSession(db, u.id);
    const t2 = await createSession(db, u.id);
    const res = await POST(jsonReq(URL, {}, { headers: { cookie: `session=${t1}` } }));
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(/^session=;.*Max-Age=0/);
    expect(await userForToken(db, t1)).toBeNull();
    expect(await userForToken(db, t2)).not.toBeNull();
  });

  it('revokes a Bearer token', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    const t = await createSession(db, u.id);
    const res = await POST(jsonReq(URL, {}, { headers: { authorization: `Bearer ${t}` } }));
    expect(res.status).toBe(204);
    expect(await userForToken(db, t)).toBeNull();
  });

  it('revokes both the Bearer token and the cookie token when both are present', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    const t1 = await createSession(db, u.id);
    const t2 = await createSession(db, u.id);
    const res = await POST(jsonReq(URL, {}, { headers: { authorization: `Bearer ${t1}`, cookie: `session=${t2}` } }));
    expect(res.status).toBe(204);
    expect(await userForToken(db, t1)).toBeNull();
    expect(await userForToken(db, t2)).toBeNull();
  });

  it('is 204 with no token', async () => {
    expect((await POST(jsonReq(URL, {}))).status).toBe(204);
  });

  it('returns 415 without a JSON content type', async () => {
    expect((await POST(new Request(URL, { method: 'POST' }))).status).toBe(415);
  });

  it('returns 404 when auth is disabled', async () => {
    vi.stubEnv('DATABASE_URL', '');
    expect((await POST(jsonReq(URL, {}))).status).toBe(404);
  });
});
