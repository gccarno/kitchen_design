import type { Db } from '../db/types';
import { userCount } from './users';

/** Auth is on iff DATABASE_URL is set (disk mode stays open and single-user). */
export function authEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DATABASE_URL ?? '').trim() !== '';
}

/**
 * Open when ALLOW_REGISTRATION=1. Otherwise, outside production, only while the users table is
 * empty. In production even the first user needs ALLOW_REGISTRATION=1: create them beforehand with
 * `npm run create-user`, so nobody can claim the first account (and the orphan projects) by racing the owner.
 */
export async function registrationAllowed(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env.ALLOW_REGISTRATION === '1') return true;
  if (env.NODE_ENV === 'production') return false;
  return (await userCount(db)) === 0;
}
