// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resetTestDb, sharedTestDb } from '@/lib/db/test-db';
import { users } from '@/lib/db/schema';
import type { Db } from '@/lib/db/types';
import { getJobStore, jobOwner } from './index';
import { MemJobStore } from './mem-jobs';
import { PgJobStore } from './pg-jobs';

const state = vi.hoisted(() => ({ db: undefined as unknown, dbCalls: 0 }));
vi.mock('@/lib/db/client', () => ({
  getDb: () => {
    state.dbCalls++;
    return state.db;
  },
}));

let db: Db;
beforeAll(async () => {
  db = await sharedTestDb();
  state.db = db;
});
beforeEach(async () => {
  await resetTestDb(db);
  state.dbCalls = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('job storage in disk mode (no DATABASE_URL)', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', '');
  });

  it('is one in-memory table per process, shared by every getJobStore call, without touching the database', async () => {
    const a = await getJobStore(null);
    expect(a).toBeInstanceOf(MemJobStore);
    const job = await a.create(randomUUID(), 'extract', {});
    expect(await (await getJobStore(null)).get(job.id)).toEqual(job);
    expect(state.dbCalls).toBe(0);
  });

  it('scopes jobs by user and finds any job owner with jobOwner', async () => {
    const userId = randomUUID();
    const job = await (await getJobStore(userId)).create(randomUUID(), 'refine', {});
    expect(await (await getJobStore(randomUUID())).get(job.id)).toBeNull();
    expect(await (await getJobStore(null)).get(job.id)).toBeNull();
    expect(await jobOwner(job.id)).toEqual({ userId });
    const anon = await (await getJobStore(null)).create(randomUUID(), 'extract', {});
    expect(await jobOwner(anon.id)).toEqual({ userId: null });
    expect(await jobOwner(randomUUID())).toBeNull();
    expect(await jobOwner('not-a-uuid')).toBeNull();
    expect(state.dbCalls).toBe(0);
  });
});

describe('job storage with DATABASE_URL', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://example.invalid/db');
  });

  it("is the Postgres store, scoped to the user, and jobOwner reads the row's owner", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.test`, passwordHash: 'x' })
      .returning({ id: users.id });
    const store = await getJobStore(user.id);
    expect(store).toBeInstanceOf(PgJobStore);
    const job = await store.create(randomUUID(), 'extract', {});
    expect(await (await getJobStore(null)).get(job.id)).toBeNull();
    expect(await jobOwner(job.id)).toEqual({ userId: user.id });
    expect(await jobOwner(randomUUID())).toBeNull();
    expect(await jobOwner('not-a-uuid')).toBeNull();
  });
});
