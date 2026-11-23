import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExtractionError, LLMNotConfiguredError, LLMRateLimitError, LLMRequestError, RefinementError } from '../llm';
import { DETAIL_SHOWN_MAX, providerDetail, toJobError } from './errors';
import type { LLMCallEvent } from '../llm/log';

afterEach(() => vi.restoreAllMocks());

describe('toJobError', () => {
  it('maps ExtractionError and RefinementError to 502 with issues', () => {
    const e = new ExtractionError(['bad wall']);
    expect(toJobError(e, 'extract')).toEqual({ status: 502, error: e.message, issues: ['bad wall'] });
    const r = new RefinementError(['no such item']);
    expect(toJobError(r, 'refine')).toEqual({ status: 502, error: r.message, issues: ['no such item'] });
  });

  it('maps LLMRequestError to 502 without issues', () => {
    expect(toJobError(new LLMRequestError('upstream timeout'))).toEqual({ status: 502, error: 'upstream timeout' });
  });

  it('replaces a rate-limit (429) body with a plain message, the per-kind hint and when to try again', () => {
    const raw = 'LLM request failed: 429 Too Many Requests — {"error":{"message":"x is temporarily rate-limited upstream"}}';
    expect(toJobError(new LLMRateLimitError(raw, 'upstream', 60_000), 'extract')).toEqual({
      status: 502,
      error: 'The free AI models are busy right now. You can still sketch the room by hand.',
      retryAfterMs: 60_000,
    });
    const quota = toJobError(new LLMRateLimitError(raw, 'quota', 3_600_000), 'refine');
    expect(quota).toEqual({
      status: 502,
      error: 'The free AI model limit for this account is used up for now. You can still edit the plan by hand.',
      retryAfterMs: 3_600_000,
    });
    expect(toJobError(new LLMRateLimitError(raw, 'quota'), 'extract')).not.toHaveProperty('retryAfterMs');
  });

  it('maps LLMNotConfiguredError to 503 with the per-kind hint', () => {
    const err = new LLMNotConfiguredError();
    expect(toJobError(err, 'extract')).toEqual({
      status: 503,
      error: `${err.message} You can still sketch the room by hand.`,
    });
    expect(toJobError(err, 'refine').error).toBe(`${err.message} You can still edit the plan by hand.`);
  });

  it('maps anything else to a generic 500 and logs only name and message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toJobError(new TypeError('boom'), 'extract')).toEqual({
      status: 500,
      error: 'unexpected server error during extraction',
    });
    expect(toJobError('weird', 'refine')).toEqual({
      status: 500,
      error: 'unexpected server error during refinement',
    });
    expect(spy.mock.calls[0][0]).toContain('TypeError: boom');
    expect(spy.mock.calls[0]).toHaveLength(1);
  });
});

describe('providerDetail', () => {
  const call = (extra: Partial<LLMCallEvent>): LLMCallEvent => ({ event: 'llm_call', op: 'vision', attempt: 0, models: ['a/m:free', 'b/m:free'], ms: 1, outcome: 'ok', ...extra });

  it('is nothing when no model call failed', () => {
    expect(providerDetail([])).toBeUndefined();
    expect(providerDetail([call({ outcome: 'ok' })])).toBeUndefined();
  });

  it("lists each model's own message once, in order, naming the model", () => {
    const busy = 'Provider returned error (a/m:free is temporarily rate-limited upstream)';
    const calls = [
      call({ attempt: 0, outcome: 'rate_limited', status: 429, detail: busy }),
      call({ attempt: 1, outcome: 'rate_limited', status: 429, detail: busy }),
      call({ attempt: 2, models: ['b/m:free', 'a/m:free'], outcome: 'timeout', detail: 'LLM request timed out after 300000 ms' }),
    ];
    expect(providerDetail(calls)).toBe(`a/m:free (429): ${busy}\nb/m:free: LLM request timed out after 300000 ms`);
  });

  it("leaves out the model's own answers (bad_json, bad_envelope), which can quote what the user typed", () => {
    expect(providerDetail([call({ outcome: 'bad_json', detail: 'LLM returned non-JSON content: "my kitchen…"' })])).toBeUndefined();
    expect(providerDetail([call({ outcome: 'bad_envelope', detail: 'no choices' })])).toBeUndefined();
  });

  it('is kept short', () => {
    const calls = Array.from({ length: 20 }, (_, i) => call({ outcome: 'http_error', status: 500, detail: `error number ${i} `.repeat(20) }));
    expect(providerDetail(calls)!.length).toBeLessThanOrEqual(DETAIL_SHOWN_MAX);
  });
});
