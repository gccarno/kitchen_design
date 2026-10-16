// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { resetTestDb, sharedTestDb } from '../db/test-db';
import { users } from '../db/schema';
import type { Db } from '../db/types';
import { describeJobStore } from './contract';
import { PgJobStore, pgJobOwner } from './pg-jobs';
import { jobs } from '../db/schema';

async function addUser(db: Db): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email: `${randomUUID()}@example.test`, passwordHash: 'x' })
    .returning({ id: users.id });
  return row.id;
}

describeJobStore('postgres (PGlite)', async () => {
  const db = await sharedTestDb();
  await resetTestDb(db);
  return { storeFor: (userId) => new PgJobStore(db, userId), newUser: () => addUser(db) };
});

describe('PgJobStore', () => {
  beforeEach(async () => resetTestDb(await sharedTestDb()));

  it('claims with one conditional UPDATE … RETURNING', async () => {
    const db = await sharedTestDb();
    const { sql: text } = new PgJobStore(db, null).claimQuery(randomUUID()).toSQL();
    expect(text.toLowerCase()).toMatch(/^update "jobs" set .* where .*"status" = .*returning/);
  });

  it('finds the owner of a job by id, and null for unknown or non-UUID ids', async () => {
    const db = await sharedTestDb();
    const userId = await addUser(db);
    const job = await new PgJobStore(db, userId).create(randomUUID(), 'extract', {});
    const anon = await new PgJobStore(db, null).create(randomUUID(), 'refine', {});
    expect(await pgJobOwner(db, job.id)).toEqual({ userId });
    expect(await pgJobOwner(db, anon.id)).toEqual({ userId: null });
    expect(await pgJobOwner(db, randomUUID())).toBeNull();
    expect(await pgJobOwner(db, 'not-a-uuid')).toBeNull();
  });

  it("deletes a user's jobs with the user", async () => {
    const db = await sharedTestDb();
    const userId = await addUser(db);
    const job = await new PgJobStore(db, userId).create(randomUUID(), 'extract', {});
    await db.delete(users).where(eq(users.id, userId));
    expect(await pgJobOwner(db, job.id)).toBeNull();
  });

  it('rejects a job for a user that does not exist', async () => {
    const db = await sharedTestDb();
    await expect(new PgJobStore(db, randomUUID()).create(randomUUID(), 'extract', {})).rejects.toThrow();
  });

  it('is cleared by resetTestDb', async () => {
    const db = await sharedTestDb();
    await new PgJobStore(db, null).create(randomUUID(), 'extract', {});
    await resetTestDb(db);
    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM jobs`);
    expect((rows as unknown as { rows?: unknown[] }).rows ?? rows).toMatchObject([{ n: 0 }]);
  });

  it("on create, deletes every owner's jobs finished over 7 days ago, and nothing else", async () => {
    const db = await sharedTestDb();
    const a = new PgJobStore(db, await addUser(db));
    const b = new PgJobStore(db, await addUser(db));
    const finish = async (store: PgJobStore, how: 'done' | 'failed' | 'running' | 'queued', daysAgo: number) => {
      const job = await store.create(randomUUID(), 'refine', {});
      if (how !== 'queued') await store.claim(job.id);
      if (how === 'done') await store.complete(job.id, {});
      if (how === 'failed') await store.fail(job.id, { status: 502, error: 'x' });
      const at = sql`now() - (${daysAgo}::int * interval '1 day')`;
      await db.update(jobs).set({ createdAt: at, startedAt: how === 'queued' ? null : at, finishedAt: how === 'done' || how === 'failed' ? at : null }).where(eq(jobs.id, job.id));
      return job.id;
    };
    const oldDone = await finish(a, 'done', 8);
    const oldFailed = await finish(b, 'failed', 30);
    const recentDone = await finish(a, 'done', 6);
    const oldRunning = await finish(b, 'running', 9);
    const oldQueued = await finish(a, 'queued', 9);

    await a.create(randomUUID(), 'extract', {});
    await vi.waitFor(async () => expect(await pgJobOwner(db, oldDone)).toBeNull());
    expect(await pgJobOwner(db, oldFailed)).toBeNull();
    for (const kept of [recentDone, oldRunning, oldQueued]) expect(await pgJobOwner(db, kept)).not.toBeNull();
  });

  it('creates the job even if pruning fails', async () => {
    const db = await sharedTestDb();
    const store = new PgJobStore(db, null);
    vi.spyOn(store, 'pruneFinished').mockRejectedValue(new Error('lock timeout'));
    const job = await store.create(randomUUID(), 'refine', {});
    expect(await store.get(job.id)).toMatchObject({ status: 'queued' });
    vi.restoreAllMocks();
  });
});
