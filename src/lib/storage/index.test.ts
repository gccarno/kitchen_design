// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetTestDb, sharedTestDb } from '@/lib/db/test-db';
import type { Db } from '@/lib/db/types';
import { UnauthorizedError } from '@/lib/auth/session';
import { createSession, createUser, revokeToken } from '@/lib/auth/users';
import { FsProjectStore } from './fs-projects';
import { getStorage, getStorageFor, newProject } from './index';
import { PgProjectStore } from './pg-projects';

const state = vi.hoisted(() => ({ db: undefined as unknown, headers: new Headers(), dbCalls: 0 }));
vi.mock('@/lib/db/client', () => ({
  getDb: () => {
    state.dbCalls++;
    return state.db;
  },
}));
vi.mock('next/headers', () => ({ headers: async () => state.headers }));

let db: Db;
let dir: string;

beforeAll(async () => {
  db = await sharedTestDb();
  state.db = db;
});
beforeEach(async () => {
  await resetTestDb(db);
  state.headers = new Headers();
  state.dbCalls = 0;
  dir = mkdtempSync(join(tmpdir(), 'kd-index-'));
  vi.stubEnv('DATA_DIR', dir);
  vi.stubEnv('GCS_BUCKET', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('getStorage() in disk mode (no DATABASE_URL)', () => {
  it('is the disk store, ignores any token, and never touches the database', async () => {
    vi.stubEnv('DATABASE_URL', '');
    state.headers = new Headers({ cookie: 'session=whatever', 'x-user-id': 'someone' });
    const s = await getStorage();
    expect(s.projects).toBeInstanceOf(FsProjectStore);
    expect(state.dbCalls).toBe(0);
  });
});

describe('getStorage() with auth enabled', () => {
  beforeEach(() => vi.stubEnv('DATABASE_URL', 'postgres://test'));

  it('throws UnauthorizedError without a token, with an unknown one, or a revoked one', async () => {
    await expect(getStorage()).rejects.toBeInstanceOf(UnauthorizedError);
    state.headers = new Headers({ cookie: 'session=bogus' });
    await expect(getStorage()).rejects.toBeInstanceOf(UnauthorizedError);
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    const t = await createSession(db, u.id);
    await revokeToken(db, t);
    state.headers = new Headers({ authorization: `Bearer ${t}` });
    await expect(getStorage()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('ignores a forged x-user-id header', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    state.headers = new Headers({ 'x-user-id': u.id });
    await expect(getStorage()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("returns the signed-in user's own projects only", async () => {
    const ua = await createUser(db, 'a@example.com', 'a-good-password');
    const ub = await createUser(db, 'b@example.com', 'b-good-password');
    const p = newProject({ name: "A's" });
    await (await getStorageFor(ua.id)).projects.insert(p);

    state.headers = new Headers({ cookie: `session=${await createSession(db, ua.id)}` });
    const asA = await getStorage();
    expect(asA.projects).toBeInstanceOf(PgProjectStore);
    expect((await asA.projects.list()).map((s) => s.id)).toEqual([p.id]);

    // B's cookie, plus a forged header naming A: still B's (empty) storage.
    state.headers = new Headers({ cookie: `session=${await createSession(db, ub.id)}`, 'x-user-id': ua.id });
    const asB = await getStorage();
    expect(await asB.projects.list()).toEqual([]);
    expect(await asB.projects.load(p.id)).toBeNull();
  });
});

describe('getStorageFor()', () => {
  it('is the disk store in disk mode, whatever the user', async () => {
    vi.stubEnv('DATABASE_URL', '');
    expect((await getStorageFor(null)).projects).toBeInstanceOf(FsProjectStore);
    expect((await getStorageFor('u')).projects).toBeInstanceOf(FsProjectStore);
  });

  it('scopes to null-owner rows for null (scripts, import:local)', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://test');
    const orphans = await getStorageFor(null);
    expect(orphans.projects).toBeInstanceOf(PgProjectStore);
    const p = newProject({ name: 'orphan' });
    await orphans.projects.insert(p);
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    expect(await (await getStorageFor(u.id)).projects.load(p.id)).toBeNull();
    expect(await orphans.projects.load(p.id)).not.toBeNull();
  });
});
