import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb } from './client';
import { MIGRATIONS_DIR } from './migrations';

// Drizzle's migrator takes no advisory lock, so only one migrator may run at a
// time (we run a single Render instance). Add a lock before scaling out.
/** Apply any pending migrations in drizzle/ to DATABASE_URL. */
export async function runMigrations(): Promise<void> {
  await migrate(getDb() as unknown as PostgresJsDatabase, { migrationsFolder: MIGRATIONS_DIR });
}
