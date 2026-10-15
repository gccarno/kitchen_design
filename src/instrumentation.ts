/**
 * Runs once when the Next.js server starts. With a database configured,
 * apply pending migrations before any request is served: if one fails the
 * server fails to start, the health check fails, and the deploy is rolled back.
 */
export async function register(): Promise<void> {
  // The positive NEXT_RUNTIME check must wrap the import so Next drops the
  // Node-only migrator from the edge compilation of this file.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (!process.env.DATABASE_URL) return;
    const { runMigrations } = await import('./lib/db/migrate');
    await runMigrations();
  }
}
