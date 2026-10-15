import type { Db } from '../db/types';
import { userCount } from './users';

/** Auth is on iff DATABASE_URL is set (disk mode stays open and single-user). */
export function authEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DATABASE_URL ?? '').trim() !== '';
}

/** Open only while the users table is empty, or when ALLOW_REGISTRATION=1. */
export async function registrationAllowed(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env.ALLOW_REGISTRATION === '1') return true;
  return (await userCount(db)) === 0;
}
