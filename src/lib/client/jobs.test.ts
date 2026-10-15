import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forgetJob, isAbortError, JOB_LOST_MESSAGE, JobFailedError, recallJob, rememberJob, startAndWait, waitForJob } from './jobs';

const JOB = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const accepted = () => json({ jobId: JOB }, 202);
const job = (status: string, extra: Record<string, unknown> = {}) => json({ id: JOB, kind: 'refine', status, ...extra });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Settle `p` while letting the fake clock run; returns its value or the error it threw. */
async function settle<T>(p: Promise<T>, ms = 60_000): Promise<{ value?: T; error?: unknown }> {
  const out: { value?: T; error?: unknown } = {};
  const done = p.then(
    (value) => void (out.value = value),
    (error) => void (out.error = error)
  );
  await vi.advanceTimersByTimeAsync(ms);
  await done;
  return out;
}

describe('startAndWait', () => {
  it('posts, polls the job until done and returns its result', async () => {
    fetchMock.mockResolvedValueOnce(job('queued')).mockResolvedValueOnce(job('running')).mockResolvedValueOnce(job('done', { result: { reply: 'hi' } }));
    const onJobId = vi.fn();
    const start = vi.fn(async () => accepted());
    const { value } = await settle(startAndWait<{ reply: string }>(start, { onJobId }));
    expect(value).toEqual({ reply: 'hi' });
    expect(start).toHaveBeenCalledTimes(1);
    expect(onJobId).toHaveBeenCalledWith(JOB);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/jobs/${JOB}`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('polls every 1.5 s at first, backing off to at most 5 s', async () => {
    fetchMock.mockImplementation(async () => job('running'));
    const p = startAndWait(async () => accepted());
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(1499);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    const n = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls.length).toBe(n + 1);
  });

  it("throws the failed job's error message with its status and issues", async () => {
    fetchMock.mockResolvedValueOnce(job('failed', { error: { status: 502, error: 'the model kept answering badly', issues: ['a'] } }));
    const { error } = await settle(startAndWait(async () => accepted()));
    expect(error).toBeInstanceOf(JobFailedError);
    expect(error).toMatchObject({ message: 'the model kept answering badly', status: 502, issues: ['a'] });
  });

  it('throws the error of a non-202 start response, as before (e.g. 503 no LLM)', async () => {
    const { error } = await settle(startAndWait(async () => json({ error: 'LLM_API_KEY is not set.' }, 503)));
    expect(error).toMatchObject({ message: 'LLM_API_KEY is not set.', status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the fallback message when an error response has no body', async () => {
    const { error } = await settle(
      startAndWait(async () => new Response('oops', { status: 500 }), { fallbackError: (s) => `extraction failed (${s})` })
    );
    expect((error as Error).message).toBe('extraction failed (500)');
  });

  it('returns a plain 200 body directly (an old-style synchronous answer)', async () => {
    const { value } = await settle(startAndWait(async () => json({ reply: 'sync' })));
    expect(value).toEqual({ reply: 'sync' });
  });

  it('rides out a single failed poll (network error or 5xx)', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({ error: 'bad gateway' }, 502))
      .mockResolvedValueOnce(job('done', { result: 42 }));
    const { value } = await settle(startAndWait(async () => accepted()));
    expect(value).toBe(42);
  });

  it('gives up after repeated poll failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { error } = await settle(startAndWait(async () => accepted()), 120_000);
    expect((error as Error).message).toMatch(/Failed to fetch/);
  });

  it('reports a job the server no longer knows (404) as lost', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'job not found' }, 404));
    const { error } = await settle(startAndWait(async () => accepted()));
    expect((error as Error).message).toBe(JOB_LOST_MESSAGE);
    expect(JOB_LOST_MESSAGE).toBe('The request was lost (the server restarted). Please try again.');
  });

  it('stops polling when aborted', async () => {
    fetchMock.mockImplementation(async () => job('running'));
    const ctrl = new AbortController();
    const p = settle(startAndWait(async () => accepted(), { signal: ctrl.signal }), 0);
    await vi.advanceTimersByTimeAsync(1500);
    ctrl.abort();
    const { error } = await p;
    expect(isAbortError(error)).toBe(true);
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

describe('waitForJob', () => {
  it('resumes polling a known job without posting again', async () => {
    fetchMock.mockResolvedValueOnce(job('done', { result: 'x' }));
    const { value } = await settle(waitForJob(JOB));
    expect(value).toBe('x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('remembered jobs', () => {
  it('round-trips through sessionStorage and survives it throwing', () => {
    rememberJob('k', { jobId: JOB, message: 'm' });
    expect(recallJob('k')).toEqual({ jobId: JOB, message: 'm' });
    forgetJob('k');
    expect(recallJob('k')).toBeNull();
    sessionStorage.setItem('k', 'not json');
    expect(recallJob('k')).toBeNull();
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(recallJob('k')).toBeNull();
    spy.mockRestore();
  });
});
