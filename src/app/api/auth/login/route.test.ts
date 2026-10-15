// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { authTokens } from '@/lib/db/schema';
import { resetTestDb, sharedTestDb } from '@/lib/db/test-db';
import type { Db } from '@/lib/db/types';
import { jsonReq, sessionFromSetCookie } from '@/lib/auth/route-test-helpers';
import { Throttle, setLoginThrottle } from '@/lib/auth/throttle';
import { createUser, userForToken } from '@/lib/auth/users';
import { POST } from './route';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));

const URL = 'http://localhost/api/auth/login';
const PW = 'a-good-password';
let db: Db;

beforeAll(async () => {
  db = await sharedTestDb();
  state.db = db;
});
beforeEach(async () => {
  await resetTestDb(db);
  setLoginThrottle(new Throttle());
  vi.stubEnv('DATABASE_URL', 'postgres://test');
});
afterEach(() => {
  vi.unstubAllEnvs();
  setLoginThrottle(undefined);
});

const login = (email: string, password: string, ip = '1.2.3.4') =>
  POST(jsonReq(URL, { email, password }, { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } }));

describe('POST /api/auth/login', () => {
  it('logs in and sets a working session cookie', async () => {
    const u = await createUser(db, 'a@example.com', PW);
    const res = await login('A@example.com', PW);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: u.id, email: 'a@example.com' });
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    expect((await userForToken(db, sessionFromSetCookie(res)!))?.id).toBe(u.id);
  });

  it('returns the same 401 for a wrong password and an unknown email', async () => {
    await createUser(db, 'a@example.com', PW);
    const bad = await login('a@example.com', 'wrong-password-1');
    const unknown = await login('nobody@example.com', 'wrong-password-1');
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'Invalid email or password' });
    expect(await unknown.json()).toEqual({ error: 'Invalid email or password' });
    expect(bad.headers.get('set-cookie')).toBeNull();
    expect(await db.select().from(authTokens)).toHaveLength(0);
  });

  it('throttles with 429 after 5 failures, even for the right password', async () => {
    await createUser(db, 'a@example.com', PW);
    for (let i = 0; i < 5; i++) expect((await login('a@example.com', 'wrong-password-1')).status).toBe(401);
    expect((await login('a@example.com', PW)).status).toBe(429);
    // Different ip or different email is a different key.
    expect((await login('a@example.com', PW, '9.9.9.9')).status).toBe(200);
    expect((await login('other@example.com', 'wrong-password-1')).status).toBe(401);
  });

  it('keys on a lowercased email and the first forwarded hop', async () => {
    for (let i = 0; i < 5; i++) await login(i % 2 ? 'A@Example.com' : 'a@example.com', 'wrong-password-1');
    expect((await login('a@example.com', 'wrong-password-1')).status).toBe(429);
  });

  it('a success clears earlier failures', async () => {
    await createUser(db, 'a@example.com', PW);
    for (let i = 0; i < 4; i++) await login('a@example.com', 'wrong-password-1');
    expect((await login('a@example.com', PW)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login('a@example.com', 'wrong-password-1')).status).toBe(401);
  });

  it('falls back to the unknown key without x-forwarded-for', async () => {
    const t = new Throttle();
    setLoginThrottle(t);
    await POST(jsonReq(URL, { email: 'a@example.com', password: 'wrong-password-1' }));
    expect(t.allowed('unknown|a@example.com')).toBe(true);
    for (let i = 0; i < 4; i++) await POST(jsonReq(URL, { email: 'a@example.com', password: 'wrong-password-1' }));
    expect(t.allowed('unknown|a@example.com')).toBe(false);
  });

  it('rejects an over-long password with 400 and does not count it', async () => {
    const res = await login('a@example.com', 'x'.repeat(201));
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed bodies, 413 for huge ones, 415 for wrong type', async () => {
    expect((await POST(jsonReq(URL, null, { raw: '{' }))).status).toBe(400);
    expect((await POST(jsonReq(URL, { email: 'a@example.com' }))).status).toBe(400);
    expect((await POST(jsonReq(URL, { email: 'a', password: 'b', pad: 'x'.repeat(20_000) }))).status).toBe(413);
    const req = new Request(URL, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect((await POST(req)).status).toBe(415);
  });

  it('returns 404 when auth is disabled', async () => {
    vi.stubEnv('DATABASE_URL', '');
    expect((await login('a@example.com', PW)).status).toBe(404);
  });
});
