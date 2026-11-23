import { ExtractionError, LLMNotConfiguredError, LLMRateLimitError, LLMRequestError, RefinementError } from '../llm';
import type { LLMCallEvent } from '../llm/log';
import type { JobError, JobKind } from './types';

/** The most of the providers' messages kept on a failed job. */
export const DETAIL_SHOWN_MAX = 1000;

/** Failures whose `detail` is the provider's (or the network's) message, not the model's own answer. */
const PROVIDER_OUTCOMES = new Set<LLMCallEvent['outcome']>(['rate_limited', 'http_error', 'timeout', 'network_error']);

/**
 * What each model's provider said when a call failed, one line per distinct
 * message: "model (status): message". The model's own answers (bad_json,
 * bad_envelope) are left out, as they can quote what the user typed.
 */
export function providerDetail(calls: LLMCallEvent[]): string | undefined {
  const lines: string[] = [];
  for (const c of calls) {
    if (!PROVIDER_OUTCOMES.has(c.outcome) || !c.detail) continue;
    const line = `${c.modelUsed ?? c.models[0]}${c.status ? ` (${c.status})` : ''}: ${c.detail}`;
    if (!lines.includes(line)) lines.push(line);
  }
  return lines.length > 0 ? lines.join('\n').slice(0, DETAIL_SHOWN_MAX) : undefined;
}

const HAND_HINT: Record<JobKind, string> = {
  extract: 'You can still sketch the room by hand.',
  refine: 'You can still edit the plan by hand.',
};

/**
 * Map what a handler threw to the error body the synchronous route used to
 * answer with (same statuses, same messages), so the client shows what it did before.
 */
export function toJobError(err: unknown, kind: JobKind = 'extract'): JobError {
  if (err instanceof ExtractionError || err instanceof RefinementError) {
    return { status: 502, error: err.message, issues: err.issues };
  }
  // The provider's raw 429 body means nothing to the user; say what happened and when to try again.
  if (err instanceof LLMRateLimitError) {
    const error =
      err.kind === 'quota'
        ? `The free AI model limit for this account is used up for now. ${HAND_HINT[kind]}`
        : `The free AI models are busy right now. ${HAND_HINT[kind]}`;
    return { status: 502, error, ...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}) };
  }
  if (err instanceof LLMRequestError) return { status: 502, error: err.message };
  if (err instanceof LLMNotConfiguredError) return { status: 503, error: `${err.message} ${HAND_HINT[kind]}` };
  // Anything else is a bug; log its name and message (not the stack or payload) and answer generically.
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`${kind} job failed unexpectedly: ${name}: ${message}`);
  return {
    status: 500,
    error: `unexpected server error during ${kind === 'extract' ? 'extraction' : 'refinement'}`,
  };
}
