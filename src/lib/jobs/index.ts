/**
 * The entry point for job storage. Postgres when DATABASE_URL is set (auth
 * on, jobs scoped to the signed-in user); otherwise one in-memory table per
 * process (disk mode: single user, jobs are lost on restart — the client
 * re-posts). Callers in a request pass the validated user's id (from
 * getStorage()'s user); the runner, which has no request, finds it with jobOwner.
 */
import { authEnabled } from '../auth/config';
import { MemJobStore, MemJobTable } from './mem-jobs';
import type { JobStore } from './store';

export * from './store';
export * from './types';

// One table per process, shared by every Next.js route bundle (like the db pool).
const KEY = Symbol.for('kitchen-design.mem-jobs');
function memTable(): MemJobTable {
  const g = globalThis as typeof globalThis & { [KEY]?: MemJobTable };
  g[KEY] ??= new MemJobTable();
  return g[KEY];
}

/** The job store of `userId` (null = owner-less, as in disk mode). */
export async function getJobStore(userId: string | null): Promise<JobStore> {
  if (!authEnabled()) return new MemJobStore(memTable(), userId);
  const [{ PgJobStore }, { getDb }] = await Promise.all([import('./pg-jobs'), import('../db/client')]);
  return new PgJobStore(getDb(), userId);
}

/**
 * Who owns job `jobId`, looked up without any owner scope — only for the
 * runner/worker, which holds a job id but no request, to then open that
 * owner's getJobStore(). Null for an unknown or non-UUID id. Never use it to
 * authorize a request: routes take the user from the validated session.
 */
export async function jobOwner(jobId: string): Promise<{ userId: string | null } | null> {
  if (!authEnabled()) return memTable().owner(jobId);
  const [{ pgJobOwner }, { getDb }] = await Promise.all([import('./pg-jobs'), import('../db/client')]);
  return pgJobOwner(getDb(), jobId);
}
