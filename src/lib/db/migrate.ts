import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb } from './client';
import { MIGRATIONS_DIR } from './migrations';

/** Apply any pending migrations in drizzle/ to DATABASE_URL. */
export async function runMigrations(): Promise<void> {
  await migrate(getDb() as unknown as PostgresJsDatabase, { migrationsFolder: MIGRATIONS_DIR });
}
