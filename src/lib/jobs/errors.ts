import { ExtractionError, LLMNotConfiguredError, LLMRequestError, RefinementError } from '../llm';
import type { JobError, JobKind } from './types';

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
