import { isLocalDatabase } from '../db/remote-guard';
import type { Db } from '../db/types';
import { createUser, userCount, type AuthUser } from './users';

/** A usage / configuration problem whose message is safe to print as is. */
export class CliError extends Error {}

/**
 * Logic of `npm run create-user -- <email>`. The password comes from
 * NEW_USER_PASSWORD (never argv, so it stays out of shell history and process
 * lists). A remote database needs MIGRATE_ALLOW_REMOTE=1. When the users table
 * is empty the new user claims the owner-less projects `import:local` left.
 */
export async function createUserCli(
  env: Record<string, string | undefined>,
  email: string | undefined,
  getDb: () => Db
): Promise<{ user: AuthUser; claimedOrphans: boolean }> {
  const url = env.DATABASE_URL;
  if (!url) throw new CliError('DATABASE_URL is not set.');
  if (!isLocalDatabase(url) && env.MIGRATE_ALLOW_REMOTE !== '1') {
    throw new CliError('Refusing to touch a non-local database. Set MIGRATE_ALLOW_REMOTE=1 if you really mean it.');
  }
  if (!email) throw new CliError('Usage: NEW_USER_PASSWORD=... npm run create-user -- <email>');
  const password = env.NEW_USER_PASSWORD;
  if (!password) throw new CliError('Set NEW_USER_PASSWORD (10 to 200 characters).');
  const db = getDb();
  const claimedOrphans = (await userCount(db)) === 0;
  const user = await createUser(db, email, password, { claimOrphans: claimedOrphans });
  return { user, claimedOrphans };
}
