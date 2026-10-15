import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/** A Drizzle database over any Postgres driver: postgres-js in the app, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
