/** Test-only: an in-process Postgres (PGlite) with the real migrations applied. */
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_DIR } from './migrations';
import * as schema from './schema';
import type { Db } from './types';

let shared: Promise<Db> | undefined;

/** One migrated PGlite database per test file (module), created on first use. */
export function sharedTestDb(): Promise<Db> {
  shared ??= (async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return db as unknown as Db;
  })();
  return shared;
}

export async function resetTestDb(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE jobs, projects, users CASCADE`);
}
