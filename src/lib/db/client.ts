import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import type { Db } from './types';

// One pool per process, shared by every Next.js route bundle (like the project locks).
const KEY = Symbol.for('kitchen-design.db');
type Holder = { db: Db; client: postgres.Sql };
const holder = () => globalThis as typeof globalThis & { [KEY]?: Holder };

/**
 * The app's database (DATABASE_URL). Small pool, short idle timeout: Neon
 * suspends idle compute and drops connections, and postgres-js reconnects
 * on the next query.
 */
export function getDb(): Db {
  const g = holder();
  if (!g[KEY]) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 });
    g[KEY] = { client, db: drizzle(client, { schema }) as unknown as Db };
  }
  return g[KEY].db;
}

/** Close the pool (scripts and tests). Safe to call when none is open. */
export async function closeDb(): Promise<void> {
  const g = holder();
  const h = g[KEY];
  delete g[KEY];
  await h?.client.end({ timeout: 5 });
}
