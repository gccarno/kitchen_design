/** Long-running LLM work (photo extraction, plan refinement) runs as a job the client polls. */

export const JOB_KINDS = ['extract', 'refine'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** A failed job's error, mirroring the HTTP error body the synchronous route used to return. */
export type JobError = { status: number; error: string; issues?: unknown };

export type Job = {
  id: string;
  /** The owning user; null in disk mode (no accounts). */
  userId: string | null;
  projectId: string;
  kind: JobKind;
  status: JobStatus;
  input: unknown;
  /** The route's former 200 body, once `done`. */
  result: unknown | null;
  error: JobError | null;
  /** How many times the job has been claimed (started). */
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

/** What `requeueStale` did. */
export type RequeueOutcome = 'requeued' | 'failed' | 'noop';

/** The error a job gets when it ran too long too many times. */
export const JOB_TIMED_OUT: JobError = { status: 500, error: 'job timed out' };

/** The error a job gets when it sat queued too long without ever starting. */
export const JOB_NEVER_STARTED: JobError = { status: 500, error: 'job was never started' };
