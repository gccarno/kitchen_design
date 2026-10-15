import type { Job, JobError, JobKind, RequeueOutcome } from './types';

export class JobNotFoundError extends Error {
  constructor(id: string) {
    super(`Job not found: ${id}`);
    this.name = 'JobNotFoundError';
  }
}

/**
 * Job records, scoped to one owner like ProjectStore: a store never sees
 * another owner's jobs (null owner = the owner-less jobs of disk mode).
 * Implementations: MemJobStore (process memory), PgJobStore (Postgres).
 *
 * Lifecycle: queued → running (claim) → done (complete) | failed (fail).
 * A running job whose start is too old goes back to queued, or to failed
 * once it has used its attempts (requeueStale).
 */
export interface JobStore {
  /** A new `queued` job with 0 attempts. Rejects InvalidProjectIdError if `projectId` is not a UUID. */
  create(projectId: string, kind: JobKind, input: unknown): Promise<Job>;
  /** The job, or null if there is none with this id for this owner (or the id isn't a UUID). */
  get(id: string): Promise<Job | null>;
  /**
   * Atomically move the job from `queued` to `running` (sets `startedAt`,
   * `attempts + 1`) and return it. Null if it is not queued (already
   * claimed, finished, unknown): of any number of concurrent claims of one
   * job, exactly one succeeds — so a job is executed at most once per queueing.
   */
  claim(id: string): Promise<Job | null>;
  /**
   * `running` → `done` with `result` (sets `finishedAt`). Null, changing
   * nothing, if the job is not running. Rejects JobNotFoundError for an unknown job.
   */
  complete(id: string, result: unknown): Promise<Job | null>;
  /**
   * `running` → `failed` with `error` (sets `finishedAt`). Null, changing
   * nothing, if the job is not running. Rejects JobNotFoundError for an unknown job.
   */
  fail(id: string, error: JobError): Promise<Job | null>;
  /**
   * Stuck-job recovery. If the job is `running` and started more than
   * `olderThanMs` ago: back to `queued` (startedAt cleared) when
   * `attempts < maxAttempts`, else `failed` with JOB_TIMED_OUT. Otherwise
   * (fresh, not running, unknown) nothing changes: 'noop'. Atomic, so two
   * pollers can't both requeue one stuck job.
   */
  requeueStale(id: string, olderThanMs: number, maxAttempts: number): Promise<RequeueOutcome>;
  /**
   * Give up on a job nobody ever started: if it is still `queued` and was
   * created more than `olderThanMs` ago, `queued` → `failed` with `error`
   * (sets `finishedAt`) and true. Otherwise nothing changes: false. Atomic,
   * like claim, so it can't race a runner that claims the job at the same moment.
   */
  failUnstarted(id: string, olderThanMs: number, error: JobError): Promise<boolean>;
}
