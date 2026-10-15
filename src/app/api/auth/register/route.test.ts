// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { projects, users } from '@/lib/db/schema';
import { resetTestDb, sharedTestDb } from '@/lib/db/test-db';
import type { Db } from '@/lib/db/types';
import { jsonReq, sessionFromSetCookie } from '@/lib/auth/route-test-helpers';
import { userForToken } from '@/lib/auth/users';
import { newProject } from '@/lib/plan/new-project';
import { PgProjectStore } from '@/lib/storage/pg-projects';
import { POST } from './route';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));

const URL = 'http://localhost/api/auth/register';
const PW = 'a-good-password';
let db: Db;

beforeAll(async () => {
  db = await sharedTestDb();
  state.db = db;
});
beforeEach(async () => {
  await resetTestDb(db);
  vi.stubEnv('DATABASE_URL', 'postgres://test');
  vi.stubEnv('ALLOW_REGISTRATION', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/auth/register', () => {
  it('registers the first user and sets a working session cookie', async () => {
    const res = await POST(jsonReq(URL, { email: 'A@Example.com', password: PW }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; email: string };
    expect(body.email).toBe('a@example.com');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=31536000');
    const token = sessionFromSetCookie(res)!;
    expect((await userForToken(db, token))?.id).toBe(body.id);
  });

  it('claims orphan projects for the first user only', async () => {
    await new PgProjectStore(db, null).insert(newProject({ name: 'old' }));
    const res = await POST(jsonReq(URL, { email: 'a@example.com', password: PW }));
    const { id } = (await res.json()) as { id: string };
    expect((await db.select().from(projects).where(eq(projects.ownerId, id))).length).toBe(1);

    vi.stubEnv('ALLOW_REGISTRATION', '1');
    await new PgProjectStore(db, null).insert(newProject({ name: 'orphan2' }));
    const res2 = await POST(jsonReq(URL, { email: 'b@example.com', password: PW }));
    expect(res2.status).toBe(201);
    const { id: id2 } = (await res2.json()) as { id: string };
    expect((await db.select().from(projects).where(eq(projects.ownerId, id2))).length).toBe(0);
  });

  it('in production the first user is refused too unless ALLOW_REGISTRATION=1', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(jsonReq(URL, { email: 'a@example.com', password: PW }))).status).toBe(403);
    vi.stubEnv('ALLOW_REGISTRATION', '1');
    expect((await POST(jsonReq(URL, { email: 'a@example.com', password: PW }))).status).toBe(201);
  });

  it('is closed (403) for a second user unless ALLOW_REGISTRATION=1', async () => {
    await POST(jsonReq(URL, { email: 'a@example.com', password: PW }));
    const closed = await POST(jsonReq(URL, { email: 'b@example.com', password: PW }));
    expect(closed.status).toBe(403);
    expect(closed.headers.get('set-cookie')).toBeNull();
    vi.stubEnv('ALLOW_REGISTRATION', '1');
    expect((await POST(jsonReq(URL, { email: 'b@example.com', password: PW }))).status).toBe(201);
  });

  it('lets exactly one of two concurrent first registrations succeed, under the advisory lock', async () => {
    const queries: string[] = [];
    type Tx = { execute: (q: unknown) => unknown };
    const orig = db.transaction.bind(db) as unknown as (fn: (tx: Tx) => Promise<unknown>) => Promise<unknown>;
    const wrapped = (fn: (tx: Tx) => Promise<unknown>) =>
      orig(async (tx) => {
        const exec = tx.execute.bind(tx);
        tx.execute = (q) => {
          queries.push(JSON.stringify(q));
          return exec(q);
        };
        return fn(tx);
      });
    const spy = vi.spyOn(db, 'transaction').mockImplementation(wrapped as never);
    try {
      const results = await Promise.all([
        POST(jsonReq(URL, { email: 'a@example.com', password: PW })),
        POST(jsonReq(URL, { email: 'b@example.com', password: PW })),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 403]);
      expect(await db.select().from(users)).toHaveLength(1);
      expect(queries.some((q) => q.includes('pg_advisory_xact_lock'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns 409 with a neutral message for a duplicate email', async () => {
    vi.stubEnv('ALLOW_REGISTRATION', '1');
    await POST(jsonReq(URL, { email: 'a@example.com', password: PW }));
    const res = await POST(jsonReq(URL, { email: 'A@example.com', password: PW }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "That email can't be used" });
  });

  it('returns 400 for invalid input', async () => {
    expect((await POST(jsonReq(URL, { email: 'nope', password: PW }))).status).toBe(400);
    expect((await POST(jsonReq(URL, { email: 'a@example.com', password: 'short' }))).status).toBe(400);
    expect((await POST(jsonReq(URL, { email: 1, password: PW }))).status).toBe(400);
    expect((await POST(jsonReq(URL, null, { raw: 'not json' }))).status).toBe(400);
    expect((await POST(jsonReq(URL, [1]))).status).toBe(400);
  });

  it('rejects an over-long password with 400 before creating anything', async () => {
    const res = await POST(jsonReq(URL, { email: 'a@example.com', password: 'x'.repeat(201) }));
    expect(res.status).toBe(400);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('rejects an oversized body with 413', async () => {
    const res = await POST(jsonReq(URL, { email: 'a@example.com', password: PW, pad: 'x'.repeat(20_000) }));
    expect(res.status).toBe(413);
  });

  it('rejects an oversized body even without a content-length header', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"pad":"' + 'x'.repeat(20_000) + '"}'));
        c.close();
      },
    });
    const req = new Request(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect((await POST(req)).status).toBe(413);
  });

  it('returns 415 without a JSON content type', async () => {
    const req = new Request(URL, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect((await POST(req)).status).toBe(415);
  });

  it('returns 404 when auth is disabled', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const res = await POST(jsonReq(URL, { email: 'a@example.com', password: PW }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Auth is not enabled' });
  });
});
