/**
 * Runs once when the Next.js server starts. With a database configured,
 * apply pending migrations before any request is served: if one fails the
 * server fails to start, the health check fails, and the deploy is rolled back.
 */
export async function register(): Promise<void> {
  // The positive NEXT_RUNTIME check must wrap the import so Next drops the
  // Node-only migrator from the edge compilation of this file.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set in production: auth is DISABLED and the app is wide open to anyone who can reach it.');
    }
    const { shouldMigrateOnStartup } = await import('./lib/db/remote-guard');
    if (!shouldMigrateOnStartup(process.env)) {
      if (process.env.DATABASE_URL) {
        console.error(
          'DATABASE_URL points at a remote database and NODE_ENV is not production: skipping startup migrations. ' +
            'Set MIGRATE_ALLOW_REMOTE=1 to migrate it anyway.'
        );
      }
      return;
    }
    if (process.env.NODE_ENV === 'production' && !process.env.GCS_BUCKET) {
      console.warn('DATABASE_URL is set but GCS_BUCKET is not: photos will be written to ephemeral local disk.');
    }
    const { runMigrations } = await import('./lib/db/migrate');
    await runMigrations();
  }
}
