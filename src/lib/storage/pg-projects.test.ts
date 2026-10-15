// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { resetTestDb, sharedTestDb } from '../db/test-db';
import { newProject } from '../plan/new-project';
import { describeProjectStore } from './contract';
import { PgProjectStore } from './pg-projects';

describeProjectStore('postgres (PGlite)', async () => {
  const db = await sharedTestDb();
  await resetTestDb(db);
  return { store: new PgProjectStore(db) };
});

describe('PgProjectStore', () => {
  beforeEach(async () => resetTestDb(await sharedTestDb()));

  it("keeps owners apart: one owner never sees or changes another's projects", async () => {
    const db = await sharedTestDb();
    const alice = new PgProjectStore(db, randomUUID());
    const bob = new PgProjectStore(db, randomUUID());
    const p = newProject({ name: "Alice's kitchen" });
    await alice.insert(p);
    expect(await bob.load(p.id)).toBeNull();
    expect(await bob.list()).toEqual([]);
    expect(await bob.group(p.id)).toEqual([]);
    expect(await bob.remove(p.id)).toBe(false);
    await expect(bob.update(p.id, (x) => x)).rejects.toThrow('Project not found');
    expect(await alice.load(p.id)).toEqual(p);
  });

  it('skips a row whose document no longer parses, instead of failing the list', async () => {
    const db = await sharedTestDb();
    const store = new PgProjectStore(db);
    const good = newProject({ name: 'Good' });
    await store.insert(good);
    await db.execute(sql`
      INSERT INTO projects (id, owner_id, name, kind, revision, doc, created_at, updated_at)
      VALUES (${randomUUID()}, NULL, 'Broken', 'kitchen', 0, '{"name":"Broken"}'::jsonb, now(), now())`);
    expect((await store.list()).map((s) => s.name)).toEqual(['Good']);
  });

  it('keeps the denormalized columns in step with the document', async () => {
    const db = await sharedTestDb();
    const store = new PgProjectStore(db);
    const p = newProject({ name: 'Before' });
    await store.insert(p);
    await store.update(p.id, (cur) => ({ ...cur, name: 'After', revision: 4 }));
    const rows = await db.execute(sql`SELECT name, revision FROM projects WHERE id = ${p.id}`);
    expect((rows as unknown as { rows?: unknown[] }).rows ?? rows).toMatchObject([{ name: 'After', revision: 4 }]);
  });
});
