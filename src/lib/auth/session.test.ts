// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { resetTestDb, sharedTestDb } from '@/lib/db/test-db';
import type { Db } from '@/lib/db/types';
import { createSession, createUser, revokeToken } from './users';
import { currentUser, requireUser, UnauthorizedError, unauthorizedResponse, userFromHeaders, withUnauthorized } from './session';

const state = vi.hoisted(() => ({ db: undefined as unknown, headers: new Headers() }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('next/headers', () => ({ headers: async () => state.headers }));

let db: Db;

beforeAll(async () => {
  db = await sharedTestDb();
  state.db = db;
});
beforeEach(async () => {
  await resetTestDb(db);
  state.headers = new Headers();
  vi.stubEnv('DATABASE_URL', 'postgres://test');
});
afterEach(() => vi.unstubAllEnvs());

describe('currentUser / requireUser', () => {
  it('is null / UnauthorizedError with no token', async () => {
    expect(await currentUser()).toBeNull();
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('is null / UnauthorizedError for an unknown or revoked token', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    const t = await createSession(db, u.id);
    await revokeToken(db, t);
    for (const h of [{ cookie: 'session=bogus' }, { cookie: `session=${t}` }, { authorization: `Bearer ${t}` }] as Record<string, string>[]) {
      state.headers = new Headers(h);
      expect(await currentUser()).toBeNull();
      await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
    }
  });

  it('resolves the user from a session cookie', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    state.headers = new Headers({ cookie: `other=1; session=${await createSession(db, u.id)}` });
    expect(await currentUser()).toEqual({ id: u.id, email: 'a@example.com' });
    expect(await requireUser()).toEqual({ id: u.id, email: 'a@example.com' });
  });

  it('resolves the user from a Bearer token', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    state.headers = new Headers({ authorization: `Bearer ${await createSession(db, u.id)}` });
    expect(await currentUser()).toEqual({ id: u.id, email: 'a@example.com' });
  });

  it('never trusts a client-supplied x-user-id header', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    state.headers = new Headers({ 'x-user-id': u.id });
    expect(await currentUser()).toBeNull();
    expect(await userFromHeaders(new Headers({ 'x-user-id': u.id }), db)).toBeNull();
  });

  it('is null when auth is disabled, without touching the database', async () => {
    vi.stubEnv('DATABASE_URL', '');
    state.db = undefined;
    try {
      state.headers = new Headers({ cookie: 'session=whatever' });
      expect(await currentUser()).toBeNull();
    } finally {
      state.db = db;
    }
  });
});

describe('unauthorizedResponse / withUnauthorized', () => {
  it('is a 401 JSON response', async () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('turns an UnauthorizedError thrown by a handler into 401 JSON', async () => {
    const handler = withUnauthorized(async () => {
      throw new UnauthorizedError();
    });
    const res = await handler();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('passes other results and errors through', async () => {
    const ok = withUnauthorized(async (n: number) => Response.json({ n }));
    expect(await (await ok(3)).json()).toEqual({ n: 3 });
    const boom = withUnauthorized(async () => {
      throw new Error('boom');
    });
    await expect(boom()).rejects.toThrow('boom');
  });
});
