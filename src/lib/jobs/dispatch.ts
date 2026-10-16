import { authEnabled } from '../auth/config';
import { getJobStore } from './index';
import { runJob } from './run';
import { JOB_NEVER_STARTED, type Job, type RequeueOutcome } from './types';

export type DispatchOpts = {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  /** Runs the job in this process when no worker took it. */
  run?: (jobId: string) => Promise<void>;
  /** The clock, for ensureProgress's age check. */
  now?: () => number;
};

export const WORKER_TIMEOUT_MS = 2000;
/** A running job older than this is presumed dead (each LLM call is bounded at about 60 s, plus one retry). */
export const STALE_JOB_MS = 5 * 60 * 1000;
export const MAX_JOB_ATTEMPTS = 3;
/** A job still `queued` this long after creation was never started (e.g. the server restarted). */
export const UNSTARTED_JOB_MS = 60 * 1000;
/** A job still `queued` this long after creation is given up on (failed 'job was never started'). */
export const NEVER_STARTED_JOB_MS = 10 * 60 * 1000;

/**
 * Start job `jobId`: hand it to the worker (`POST ${WORKER_URL}/run/${jobId}`,
 * bearer WORKER_TOKEN, 2 s timeout) and return 'worker' on a 2xx; on any
 * failure, or with no worker configured, run it in this process without
 * waiting and return 'local'. The claim makes a double start harmless.
 * In disk mode (no DATABASE_URL) the worker is skipped: jobs live only in
 * this process's memory, so no worker could see them.
 */
export async function dispatchJob(jobId: string, opts: DispatchOpts = {}): Promise<'worker' | 'local'> {
  const env = opts.env ?? process.env;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const run = opts.run ?? ((id: string) => runJob(id));
  const base = env.WORKER_URL;
  const token = env.WORKER_TOKEN;
  if (base && token && authEnabled(env as NodeJS.ProcessEnv)) {
    try {
      const res = await doFetch(`${base.replace(/\/+$/, '')}/run/${jobId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      });
      if (res.ok) return 'worker';
      console.error(`worker rejected job: HTTP ${res.status}`);
    } catch (err) {
      console.error(`worker unreachable: ${err instanceof Error ? err.name : typeof err}`);
    }
  }
  // Started on a later microtask and never awaited: the caller's response is not held up, and a
  // run that throws synchronously or rejects is logged (by error name only), never propagated.
  void Promise.resolve()
    .then(() => run(jobId))
    .catch((err: unknown) => console.error(`local job run failed: ${err instanceof Error ? err.name : typeof err}`));
  return 'local';
}

/**
 * Called when a job is polled: recovers a stuck job. A `running` job started
 * over 5 minutes ago goes back to queued (or failed after 3 attempts) and is
 * dispatched again. A job left `queued` for over a minute (never started, e.g.
 * the server restarted before running it) is dispatched too; the claim keeps
 * that safe. One still `queued` after 10 minutes is failed ('job was never
 * started'). Returns what happened ('requeued' also covers a re-dispatch).
 */
export async function ensureProgress(job: Job, opts: DispatchOpts = {}): Promise<RequeueOutcome> {
  const store = await getJobStore(job.userId);
  if (job.status === 'queued') {
    const age = (opts.now ?? Date.now)() - Date.parse(job.createdAt);
    if (age < UNSTARTED_JOB_MS) return 'noop';
    if (age > NEVER_STARTED_JOB_MS && (await store.failUnstarted(job.id, NEVER_STARTED_JOB_MS, JOB_NEVER_STARTED))) return 'failed';
    await dispatchJob(job.id, opts);
    return 'requeued';
  }
  const outcome = await store.requeueStale(job.id, STALE_JOB_MS, MAX_JOB_ATTEMPTS);
  if (outcome === 'requeued') await dispatchJob(job.id, opts);
  return outcome;
}
