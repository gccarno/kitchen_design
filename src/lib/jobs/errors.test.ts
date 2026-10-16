import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExtractionError, LLMNotConfiguredError, LLMRequestError, RefinementError } from '../llm';
import { toJobError } from './errors';

afterEach(() => vi.restoreAllMocks());

describe('toJobError', () => {
  it('maps ExtractionError and RefinementError to 502 with issues', () => {
    const e = new ExtractionError(['bad wall']);
    expect(toJobError(e, 'extract')).toEqual({ status: 502, error: e.message, issues: ['bad wall'] });
    const r = new RefinementError(['no such item']);
    expect(toJobError(r, 'refine')).toEqual({ status: 502, error: r.message, issues: ['no such item'] });
  });

  it('maps LLMRequestError to 502 without issues', () => {
    expect(toJobError(new LLMRequestError('upstream 429'))).toEqual({ status: 502, error: 'upstream 429' });
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
