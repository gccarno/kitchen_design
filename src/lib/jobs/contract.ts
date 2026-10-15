/**
 * Behaviour every JobStore must have. The memory and Postgres test files
 * call this with a setup function, so both are held to the same rules.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { JobNotFoundError, type JobStore } from './store';
import { JOB_TIMED_OUT } from './types';

export type JobStoreSetup = () => Promise<{
  /** The store scoped to `userId` (null = the owner-less store). */
  storeFor: (userId: string | null) => JobStore;
  /** A fresh user id the backend accepts as an owner. */
  newUser: () => Promise<string>;
  teardown?: () => Promise<void>;
}>;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function describeJobStore(name: string, setup: JobStoreSetup): void {
  describe(`JobStore contract: ${name}`, () => {
    let storeFor: (userId: string | null) => JobStore;
    let newUser: () => Promise<string>;
    let teardown: (() => Promise<void>) | undefined;
    let store: JobStore;
    beforeEach(async () => {
      ({ storeFor, newUser, teardown } = await setup());
      store = storeFor(await newUser());
    });
    afterEach(async () => {
      await teardown?.();
    });

    it('creates a queued job and gets it back', async () => {
      const projectId = randomUUID();
      const input = { message: 'make it blue', nested: [1, 2] };
      const job = await store.create(projectId, 'refine', input);
      expect(job).toMatchObject({
        projectId,
        kind: 'refine',
        status: 'queued',
        input,
        result: null,
        error: null,
        attempts: 0,
        startedAt: null,
        finishedAt: null,
      });
      expect(job.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(job.createdAt).toMatch(ISO);
      expect(await store.get(job.id)).toEqual(job);
    });

    it('records the owner on the job', async () => {
      const userId = await newUser();
      const job = await storeFor(userId).create(randomUUID(), 'extract', {});
      expect(job.userId).toBe(userId);
      const anon = await storeFor(null).create(randomUUID(), 'extract', {});
      expect(anon.userId).toBeNull();
    });

    it('refuses a project id that is not a UUID', async () => {
      await expect(store.create('../etc', 'extract', {})).rejects.toThrow('invalid project id');
    });

    it('gets null for an unknown id or one that is not a UUID', async () => {
      expect(await store.get(randomUUID())).toBeNull();
      expect(await store.get('not-a-uuid')).toBeNull();
      expect(await store.get("'; DROP TABLE jobs; --")).toBeNull();
      expect(await store.claim('not-a-uuid')).toBeNull();
      expect(await store.requeueStale('not-a-uuid', 0, 3)).toBe('noop');
    });

    it("never shows or changes another owner's job", async () => {
      const job = await store.create(randomUUID(), 'extract', {});
      for (const other of [storeFor(await newUser()), storeFor(null)]) {
        expect(await other.get(job.id)).toBeNull();
        expect(await other.claim(job.id)).toBeNull();
        await expect(other.complete(job.id, {})).rejects.toBeInstanceOf(JobNotFoundError);
        await expect(other.fail(job.id, { status: 500, error: 'x' })).rejects.toBeInstanceOf(JobNotFoundError);
        expect(await other.requeueStale(job.id, 0, 3)).toBe('noop');
      }
      expect(await store.get(job.id)).toEqual(job);
    });

    it("keeps a user's running job safe from another owner's complete, fail and requeue", async () => {
      const job = await store.create(randomUUID(), 'extract', {});
      const running = await store.claim(job.id);
      await pause(20);
      const other = storeFor(await newUser());
      await expect(other.complete(job.id, {})).rejects.toBeInstanceOf(JobNotFoundError);
      await expect(other.fail(job.id, { status: 500, error: 'x' })).rejects.toBeInstanceOf(JobNotFoundError);
      expect(await other.requeueStale(job.id, 1, 3)).toBe('noop');
      expect(await store.get(job.id)).toEqual(running);
    });

    it('keeps owner-less jobs apart from users', async () => {
      const anon = storeFor(null);
      const job = await anon.create(randomUUID(), 'extract', {});
      expect(await store.get(job.id)).toBeNull();
      expect(await anon.get(job.id)).toEqual(job);
    });

    it('claims a queued job once: running, startedAt set, attempts + 1', async () => {
      const job = await store.create(randomUUID(), 'extract', {});
      const claimed = await store.claim(job.id);
      expect(claimed).toMatchObject({ id: job.id, status: 'running', attempts: 1 });
      expect(claimed!.startedAt).toMatch(ISO);
      expect(await store.get(job.id)).toEqual(claimed);
      expect(await store.claim(job.id)).toBeNull();
      expect(await store.claim(randomUUID())).toBeNull();
    });

    it('lets exactly one of many concurrent claims win', async () => {
      const job = await store.create(randomUUID(), 'extract', {});
      const results = await Promise.all(Array.from({ length: 8 }, () => store.claim(job.id)));
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect((await store.get(job.id))!.attempts).toBe(1);
    });

    it('completes a running job with its result', async () => {
      const job = await store.create(randomUUID(), 'extract', {});
      await store.claim(job.id);
      const done = await store.complete(job.id, { room: { width: 3000 } });
      expect(done).toMatchObject({ status: 'done', result: { room: { width: 3000 } }, error: null, attempts: 1 });
      expect(done!.finishedAt).toMatch(ISO);
      expect(Date.parse(done!.finishedAt!)).toBeGreaterThanOrEqual(Date.parse(done!.startedAt!));
      expect(await store.get(job.id)).toEqual(done);
    });

    it('fails a running job with its error', async () => {
      const job = await store.create(randomUUID(), 'refine', {});
      await store.claim(job.id);
      const err = { status: 502, error: 'model returned junk', issues: [{ path: ['room'] }] };
      const failed = await store.fail(job.id, err);
      expect(failed).toMatchObject({ status: 'failed', error: err, result: null });
      expect(failed!.finishedAt).toMatch(ISO);
      expect(await store.get(job.id)).toEqual(failed);
    });

    it('ignores complete or fail of a job that is not running, without overwriting', async () => {
      const queued = await store.create(randomUUID(), 'extract', {});
      expect(await store.complete(queued.id, { x: 1 })).toBeNull();
      expect(await store.fail(queued.id, { status: 500, error: 'x' })).toBeNull();
      expect(await store.get(queued.id)).toEqual(queued);

      const job = await store.create(randomUUID(), 'extract', {});
      await store.claim(job.id);
      const done = await store.complete(job.id, { first: true });
      expect(await store.complete(job.id, { second: true })).toBeNull();
      expect(await store.fail(job.id, { status: 500, error: 'late' })).toBeNull();
      expect(await store.claim(job.id)).toBeNull();
      expect(await store.get(job.id)).toEqual(done);
    });

    it('rejects complete or fail of an unknown job with JobNotFoundError', async () => {
      await expect(store.complete(randomUUID(), {})).rejects.toBeInstanceOf(JobNotFoundError);
      await expect(store.fail(randomUUID(), { status: 500, error: 'x' })).rejects.toBeInstanceOf(JobNotFoundError);
      await expect(store.complete('not-a-uuid', {})).rejects.toBeInstanceOf(JobNotFoundError);
    });

    it('leaves a freshly running job alone', async () => {
      const job = await store.create(randomUUID(), 'extract', {});
      const running = await store.claim(job.id);
      expect(await store.requeueStale(job.id, 60_000, 3)).toBe('noop');
      expect(await store.get(job.id)).toEqual(running);
    });

    it('leaves queued and finished jobs alone', async () => {
      const queued = await store.create(randomUUID(), 'extract', {});
      await pause(20);
      expect(await store.requeueStale(queued.id, 1, 3)).toBe('noop');
      expect(await store.get(queued.id)).toEqual(queued);
      await store.claim(queued.id);
      const done = await store.complete(queued.id, {});
      await pause(20);
      expect(await store.requeueStale(queued.id, 1, 3)).toBe('noop');
      expect(await store.get(queued.id)).toEqual(done);
    });

    it('requeues a stale running job that has attempts left, and it can be claimed again', async () => {
      const job = await store.create(randomUUID(), 'extract', {});
      await store.claim(job.id);
      await pause(30);
      expect(await store.requeueStale(job.id, 10, 3)).toBe('requeued');
      expect(await store.get(job.id)).toMatchObject({
        status: 'queued',
        attempts: 1,
        startedAt: null,
        finishedAt: null,
        error: null,
      });
      expect(await store.claim(job.id)).toMatchObject({ status: 'running', attempts: 2 });
    });

    it('fails a stale running job that has used its attempts', async () => {
      const job = await store.create(randomUUID(), 'refine', {});
      await store.claim(job.id);
      await pause(30);
      expect(await store.requeueStale(job.id, 10, 2)).toBe('requeued');
      await store.claim(job.id);
      await pause(30);
      expect(await store.requeueStale(job.id, 10, 2)).toBe('failed');
      const failed = await store.get(job.id);
      expect(failed).toMatchObject({ status: 'failed', attempts: 2, error: JOB_TIMED_OUT, result: null });
      expect(failed!.finishedAt).toMatch(ISO);
      expect(await store.requeueStale(job.id, 10, 2)).toBe('noop');
    });

    it('lets only one of two concurrent pollers requeue a stuck job', async () => {
      const job = await store.create(randomUUID(), 'extract', {});
      await store.claim(job.id);
      await pause(30);
      const outcomes = await Promise.all([store.requeueStale(job.id, 10, 3), store.requeueStale(job.id, 10, 3)]);
      expect(outcomes.sort()).toEqual(['noop', 'requeued']);
    });
  });
}
