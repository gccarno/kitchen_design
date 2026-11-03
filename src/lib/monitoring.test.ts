import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMCallEvent } from './llm/log';

const sentry = vi.hoisted(() => ({
  initWithoutDefaultIntegrations: vi.fn(),
  linkedErrorsIntegration: vi.fn(() => ({ name: 'LinkedErrors' })),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));
vi.mock('@sentry/node', () => sentry);

/** A fresh copy of the module, so each test starts with monitoring off. */
const load = async () => {
  vi.resetModules();
  return import('./monitoring');
};

class LLMRateLimitError extends Error {
  name = 'LLMRateLimitError';
}

const call = (extra: Partial<LLMCallEvent> = {}): LLMCallEvent => ({
  event: 'llm_call',
  op: 'vision',
  attempt: 0,
  models: ['a/vision:free', 'b/vision:free'],
  ms: 900,
  outcome: 'rate_limited',
  status: 429,
  rateLimitKind: 'upstream',
  ...extra,
});
const failure = (calls: LLMCallEvent[]) => ({
  jobId: 'job-1',
  kind: 'extract',
  projectId: 'proj-1',
  status: 502,
  error: 'The free AI models are busy right now.',
  calls,
});

describe('monitoring', () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('stays off without SENTRY_DSN, but still logs a job_failed line', async () => {
    const m = await load();
    expect(m.initMonitoring({})).toBe(false);
    m.reportJobFailure(new LLMRateLimitError('429'), failure([call(), call({ attempt: 1, modelUsed: 'b/vision:free' })]));
    expect(sentry.initWithoutDefaultIntegrations).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(JSON.parse(errorLog.mock.calls[0][0] as string)).toEqual({
      event: 'job_failed',
      jobId: 'job-1',
      kind: 'extract',
      projectId: 'proj-1',
      status: 502,
      errorName: 'LLMRateLimitError',
      error: 'The free AI models are busy right now.',
      llmCalls: 2,
      lastOutcome: 'rate_limited',
      lastModel: 'b/vision:free',
    });
  });

  it('with a DSN, sends one event per failed job: grouped by outcome and model, with the attempts attached', async () => {
    const m = await load();
    expect(m.initMonitoring({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', NODE_ENV: 'production', RENDER_GIT_COMMIT: 'abc' })).toBe(true);
    expect(sentry.initWithoutDefaultIntegrations).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://k@o1.ingest.sentry.io/1', environment: 'production', release: 'abc' })
    );
    const err = new LLMRateLimitError('429');
    const calls = [call(), call({ attempt: 1 })];
    m.reportJobFailure(err, failure(calls));
    expect(sentry.captureException).toHaveBeenCalledWith(err, {
      level: 'warning',
      fingerprint: ['job-failed', 'extract', 'LLMRateLimitError', 'rate_limited', 'a/vision:free'],
      tags: { job_kind: 'extract', llm_outcome: 'rate_limited', llm_model: 'a/vision:free', rate_limit: 'upstream' },
      extra: { jobId: 'job-1', projectId: 'proj-1', status: 502, shown: 'The free AI models are busy right now.', llmCalls: calls },
    });
  });

  it('reports other failures as errors, and jobs that made no LLM call', async () => {
    const m = await load();
    m.initMonitoring({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' });
    m.reportJobFailure(new TypeError('boom'), { ...failure([]), status: 500, error: 'unexpected server error during extraction' });
    expect(sentry.captureException.mock.calls[0][1]).toMatchObject({
      level: 'error',
      fingerprint: ['job-failed', 'extract', 'TypeError', 'no-llm-call', '-'],
      tags: { llm_outcome: 'none', llm_model: 'none' },
    });
  });

  it('initialises once, and flushes only when on', async () => {
    const m = await load();
    await m.flushMonitoring();
    expect(sentry.flush).not.toHaveBeenCalled();
    m.initMonitoring({ SENTRY_DSN: 'x' });
    m.initMonitoring({ SENTRY_DSN: 'x' });
    expect(sentry.initWithoutDefaultIntegrations).toHaveBeenCalledOnce();
    await m.flushMonitoring();
    expect(sentry.flush).toHaveBeenCalledOnce();
  });
});
