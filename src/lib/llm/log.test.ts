import { describe, it, expect, vi, afterEach } from 'vitest';
import { DETAIL_MAX, errorDetail, logLLMCall, type LLMCallEvent } from './log';

afterEach(() => vi.restoreAllMocks());

const base: LLMCallEvent = { event: 'llm_call', op: 'vision', attempt: 0, models: ['a'], ms: 12, outcome: 'ok' };

describe('logLLMCall', () => {
  it('writes one JSON line: info for success, warn for failures', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logLLMCall(base);
    logLLMCall({ ...base, outcome: 'rate_limited', status: 429 });
    expect(JSON.parse(info.mock.calls[0][0] as string)).toEqual(base);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ outcome: 'rate_limited', status: 429 });
  });
});

describe('errorDetail', () => {
  it('takes error.message from an OpenAI/OpenRouter body, with the upstream raw message', () => {
    expect(errorDetail('{"error":{"message":"bad"}}')).toBe('bad');
    expect(errorDetail('{"error":{"message":"Provider returned error","metadata":{"raw":"busy"}}}')).toBe('Provider returned error (busy)');
  });

  it('falls back to the start of the body, trimmed', () => {
    expect(errorDetail('<html>gateway</html>')).toBe('<html>gateway</html>');
    expect(errorDetail('x'.repeat(1000))).toHaveLength(DETAIL_MAX);
  });
});
