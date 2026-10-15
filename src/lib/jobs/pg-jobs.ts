import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { jobs } from '../db/schema';
import type { Db } from '../db/types';
import { InvalidProjectIdError, isValidProjectId } from '../storage/ids';
import { JobNotFoundError, type JobStore } from './store';
import { JOB_TIMED_OUT, type Job, type JobError, type JobKind, type JobStatus, type RequeueOutcome } from './types';

type Row = typeof jobs.$inferSelect;

/** Finished (done/failed) jobs are deleted this long after they finish, so the table can't grow without bound. */
export const PG_FINISHED_TTL_DAYS = 7;

/** Postgres timestamp text ("2026-10-15 14:25:10.123456+00") as ISO-8601 UTC. */
const iso = (ts: string): string => new Date(ts).toISOString();
const isoOrNull = (ts: string | null): string | null => (ts === null ? null : iso(ts));

function toJob(row: Row): Job {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    input: row.input,
    result: row.result ?? null,
    error: (row.error as JobError | null) ?? null,
    attempts: row.attempts,
    createdAt: iso(row.createdAt),
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
  };
}

/**
 * Jobs in Postgres, scoped to one owner (null = owner-less rows). Every state
 * change is one conditional UPDATE … WHERE status = <expected> … RETURNING,
 * so concurrent callers (two pollers, the web process and the worker) can't
 * both make the same transition. All time comparisons use the database's
 * clock (now()), never the app server's.
 */
export class PgJobStore implements JobStore {
  constructor(
    private readonly db: Db,
    private readonly ownerId: string | null = null
  ) {}

  private owned(): SQL {
    return this.ownerId === null ? isNull(jobs.userId) : eq(jobs.userId, this.ownerId);
  }

  private mine(id: string, status?: JobStatus): SQL {
    return and(eq(jobs.id, id), this.owned(), ...(status ? [eq(jobs.status, status)] : []))!;
  }

  async create(projectId: string, kind: JobKind, input: unknown): Promise<Job> {
    if (!isValidProjectId(projectId)) throw new InvalidProjectIdError(projectId);
    const [row] = await this.db
      .insert(jobs)
      .values({ userId: this.ownerId, projectId, kind, status: 'queued', input: input ?? {} })
      .returning();
    // Housekeeping rides along with job creation; it never delays or fails it.
    void this.pruneFinished().catch(() => {});
    return toJob(row);
  }

  /**
   * Delete every owner's jobs that finished more than PG_FINISHED_TTL_DAYS ago
   * (one DELETE; unscoped on purpose — only finished rows, never queued/running).
   * Resolves to the number of rows removed.
   */
  async pruneFinished(): Promise<number> {
    const removed = await this.db
      .delete(jobs)
      .where(
        and(
          inArray(jobs.status, ['done', 'failed']),
          sql`${jobs.finishedAt} < now() - (${PG_FINISHED_TTL_DAYS}::int * interval '1 day')`
        )
      )
      .returning({ id: jobs.id });
    return removed.length;
  }

  async get(id: string): Promise<Job | null> {
    if (!isValidProjectId(id)) return null;
    const [row] = await this.db.select().from(jobs).where(this.mine(id)).limit(1);
    return row ? toJob(row) : null;
  }

  /** The atomic queued → running UPDATE (public so a test can assert its shape). */
  claimQuery(id: string) {
    return this.db
      .update(jobs)
      .set({ status: 'running', startedAt: sql`now()`, attempts: sql`${jobs.attempts} + 1` })
      .where(this.mine(id, 'queued'))
      .returning();
  }

  async claim(id: string): Promise<Job | null> {
    if (!isValidProjectId(id)) return null;
    const [row] = await this.claimQuery(id);
    return row ? toJob(row) : null;
  }

  private async finish(id: string, set: { status: JobStatus; result: unknown; error: JobError | null }): Promise<Job | null> {
    if (!isValidProjectId(id)) throw new JobNotFoundError(id);
    const [row] = await this.db
      .update(jobs)
      .set({ ...set, finishedAt: sql`now()` })
      .where(this.mine(id, 'running'))
      .returning();
    if (row) return toJob(row);
    if (!(await this.get(id))) throw new JobNotFoundError(id);
    return null;
  }

  async complete(id: string, result: unknown): Promise<Job | null> {
    return this.finish(id, { status: 'done', result: result ?? null, error: null });
  }

  async fail(id: string, error: JobError): Promise<Job | null> {
    return this.finish(id, { status: 'failed', result: null, error });
  }

  async requeueStale(id: string, olderThanMs: number, maxAttempts: number): Promise<RequeueOutcome> {
    if (!isValidProjectId(id)) return 'noop';
    const retry = sql`${jobs.attempts} < ${maxAttempts}`;
    const [row] = await this.db
      .update(jobs)
      .set({
        status: sql`CASE WHEN ${retry} THEN 'queued' ELSE 'failed' END`,
        startedAt: sql`CASE WHEN ${retry} THEN NULL ELSE ${jobs.startedAt} END`,
        finishedAt: sql`CASE WHEN ${retry} THEN NULL ELSE now() END`,
        error: sql`CASE WHEN ${retry} THEN NULL ELSE ${JSON.stringify(JOB_TIMED_OUT)}::jsonb END`,
      })
      .where(
        and(
          this.mine(id, 'running'),
          sql`${jobs.startedAt} < now() - (${olderThanMs}::double precision * interval '1 millisecond')`
        )
      )
      .returning({ status: jobs.status });
    if (!row) return 'noop';
    return row.status === 'queued' ? 'requeued' : 'failed';
  }

  async failUnstarted(id: string, olderThanMs: number, error: JobError): Promise<boolean> {
    if (!isValidProjectId(id)) return false;
    const rows = await this.db
      .update(jobs)
      .set({ status: 'failed', result: null, error, finishedAt: sql`now()` })
      .where(
        and(
          this.mine(id, 'queued'),
          sql`${jobs.createdAt} < now() - (${olderThanMs}::double precision * interval '1 millisecond')`
        )
      )
      .returning({ id: jobs.id });
    return rows.length > 0;
  }
}

/** The owner of a job, unscoped: for the runner, which has no request. Null for an unknown or non-UUID id. */
export async function pgJobOwner(db: Db, id: string): Promise<{ userId: string | null } | null> {
  if (!isValidProjectId(id)) return null;
  const [row] = await db.select({ userId: jobs.userId }).from(jobs).where(eq(jobs.id, id)).limit(1);
  return row ? { userId: row.userId } : null;
}
