// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeJobStore } from './contract';
import { MEM_FINISHED_TTL_MS, MemJobStore, MemJobTable } from './mem-jobs';

describeJobStore('memory', async () => {
  const table = new MemJobTable();
  return { storeFor: (userId) => new MemJobStore(table, userId), newUser: async () => randomUUID() };
});

describe('MemJobStore', () => {
  it('hands out copies, so a caller mutating a job changes nothing stored', async () => {
    const store = new MemJobStore(new MemJobTable(), null);
    const job = await store.create(randomUUID(), 'extract', { a: [1] });
    (job.input as { a: number[] }).a.push(2);
    job.status = 'done';
    expect(await store.get(job.id)).toMatchObject({ status: 'queued', input: { a: [1] } });
  });

  it('stores a copy of the input, so the caller changing it later changes nothing', async () => {
    const store = new MemJobStore(new MemJobTable(), null);
    const input = { a: [1] };
    const job = await store.create(randomUUID(), 'extract', input);
    input.a.push(2);
    expect((await store.get(job.id))!.input).toEqual({ a: [1] });
  });

  it('forgets finished jobs an hour after they finish, but never queued or running ones', async () => {
    let now = Date.parse('2026-10-15T10:00:00.000Z');
    const table = new MemJobTable(() => now);
    const store = new MemJobStore(table, null);
    const done = await store.create(randomUUID(), 'extract', {});
    await store.claim(done.id);
    await store.complete(done.id, {});
    const running = await store.create(randomUUID(), 'extract', {});
    await store.claim(running.id);
    const queued = await store.create(randomUUID(), 'extract', {});
    now += MEM_FINISHED_TTL_MS - 1;
    await store.create(randomUUID(), 'extract', {});
    expect(await store.get(done.id)).not.toBeNull();
    now += 2;
    await store.create(randomUUID(), 'extract', {});
    expect(await store.get(done.id)).toBeNull();
    expect(await store.get(running.id)).not.toBeNull();
    expect(await store.get(queued.id)).not.toBeNull();
  });

  it('finds the owner of any job in the table', async () => {
    const table = new MemJobTable();
    const userId = randomUUID();
    const job = await new MemJobStore(table, userId).create(randomUUID(), 'extract', {});
    const anon = await new MemJobStore(table, null).create(randomUUID(), 'extract', {});
    expect(table.owner(job.id)).toEqual({ userId });
    expect(table.owner(anon.id)).toEqual({ userId: null });
    expect(table.owner(randomUUID())).toBeNull();
    expect(table.owner('not-a-uuid')).toBeNull();
  });
});
