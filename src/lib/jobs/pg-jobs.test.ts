// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { resetTestDb, sharedTestDb } from '../db/test-db';
import { users } from '../db/schema';
import type { Db } from '../db/types';
import { describeJobStore } from './contract';
import { PgJobStore, pgJobOwner } from './pg-jobs';

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
});
