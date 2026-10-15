import { randomUUID } from 'node:crypto';
import { InvalidProjectIdError, isValidProjectId } from '../storage/ids';
import { JobNotFoundError, type JobStore } from './store';
import { JOB_TIMED_OUT, type Job, type JobError, type JobKind, type RequeueOutcome } from './types';

/** Finished jobs are forgotten this long after they finish, so the table can't grow without bound. */
export const MEM_FINISHED_TTL_MS = 60 * 60 * 1000;

/** A JSON copy, the way a jsonb column stores a value (drops undefined, no shared references). */
const json = <T>(value: T): T => (value === undefined ? (null as T) : JSON.parse(JSON.stringify(value)));
const copy = (job: Job): Job => ({ ...job, input: json(job.input), result: json(job.result), error: json(job.error) });

/**
 * Every job in this process, of every owner (disk mode has no database). The
 * owner-scoped MemJobStore views read and write it; `owner` is the unscoped
 * lookup the runner uses. All mutations are synchronous check-and-set, so on
 * the single JS thread a claim can't interleave with another.
 */
export class MemJobTable {
  readonly rows = new Map<string, Job>();

  constructor(readonly now: () => number = Date.now) {}

  /** The job's owner, or null if there is no such job (or the id isn't a UUID). */
  owner(id: string): { userId: string | null } | null {
    if (!isValidProjectId(id)) return null;
    const row = this.rows.get(id);
    return row ? { userId: row.userId } : null;
  }

  /** Drop jobs that finished more than MEM_FINISHED_TTL_MS ago. */
  prune(): void {
    const cutoff = this.now() - MEM_FINISHED_TTL_MS;
    for (const [id, row] of this.rows) {
      if (row.finishedAt && Date.parse(row.finishedAt) < cutoff) this.rows.delete(id);
    }
  }
}

/** Jobs in process memory, scoped to one owner (null = owner-less). For disk mode and tests. */
export class MemJobStore implements JobStore {
  constructor(
    private readonly table: MemJobTable,
    private readonly ownerId: string | null = null
  ) {}

  private iso(): string {
    return new Date(this.table.now()).toISOString();
  }

  /** The stored row itself (not a copy) if it exists and is this owner's. */
  private row(id: string): Job | undefined {
    if (!isValidProjectId(id)) return undefined;
    const row = this.table.rows.get(id);
    return row && row.userId === this.ownerId ? row : undefined;
  }

  async create(projectId: string, kind: JobKind, input: unknown): Promise<Job> {
    if (!isValidProjectId(projectId)) throw new InvalidProjectIdError(projectId);
    this.table.prune();
    const job: Job = {
      id: randomUUID(),
      userId: this.ownerId,
      projectId,
      kind,
      status: 'queued',
      input: json(input),
      result: null,
      error: null,
      attempts: 0,
      createdAt: this.iso(),
      startedAt: null,
      finishedAt: null,
    };
    this.table.rows.set(job.id, job);
    return copy(job);
  }

  async get(id: string): Promise<Job | null> {
    const row = this.row(id);
    return row ? copy(row) : null;
  }

  async claim(id: string): Promise<Job | null> {
    const row = this.row(id);
    if (!row || row.status !== 'queued') return null;
    row.status = 'running';
    row.startedAt = this.iso();
    row.attempts += 1;
    return copy(row);
  }

  private finish(id: string, set: Pick<Job, 'status' | 'result' | 'error'>): Job | null {
    const row = this.row(id);
    if (!row) throw new JobNotFoundError(id);
    if (row.status !== 'running') return null;
    Object.assign(row, set, { finishedAt: this.iso() });
    return copy(row);
  }

  async complete(id: string, result: unknown): Promise<Job | null> {
    return this.finish(id, { status: 'done', result: json(result), error: null });
  }

  async fail(id: string, error: JobError): Promise<Job | null> {
    return this.finish(id, { status: 'failed', result: null, error: json(error) });
  }

  async requeueStale(id: string, olderThanMs: number, maxAttempts: number): Promise<RequeueOutcome> {
    const row = this.row(id);
    if (!row || row.status !== 'running' || !row.startedAt) return 'noop';
    if (Date.parse(row.startedAt) >= this.table.now() - olderThanMs) return 'noop';
    if (row.attempts < maxAttempts) {
      Object.assign(row, { status: 'queued', startedAt: null, finishedAt: null, error: null });
      return 'requeued';
    }
    Object.assign(row, { status: 'failed', error: json(JOB_TIMED_OUT), finishedAt: this.iso() });
    return 'failed';
  }
}
