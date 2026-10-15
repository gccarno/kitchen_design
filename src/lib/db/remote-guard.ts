const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Whether the server should apply migrations at startup. Production always
 * does (when a database is configured). Dev and e2e do only for a local
 * database, or when MIGRATE_ALLOW_REMOTE=1, so a laptop never migrates a remote DB.
 */
export function shouldMigrateOnStartup(env: Record<string, string | undefined>): boolean {
  const url = env.DATABASE_URL;
  if (!url) return false;
  if (env.NODE_ENV === 'production') return true;
  return isLocalDatabase(url) || env.MIGRATE_ALLOW_REMOTE === '1';
}

/** True only for a database on this machine. Anything unparseable counts as remote. */
export function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
