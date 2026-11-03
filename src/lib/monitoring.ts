import * as Sentry from '@sentry/node';
import type { LLMCallEvent } from './llm/log';

/**
 * Error reporting. Sentry only when `SENTRY_DSN` is set (the web server via
 * instrumentation.ts, the worker in its entry point); otherwise reports are
 * just log lines. Only error reporting: no tracing, no auto-instrumentation,
 * so it can't interfere with Next's own. Never sends prompts, photos or keys.
 */

let enabled = false;

export function initMonitoring(env: Record<string, string | undefined> = process.env): boolean {
  if (enabled || !env.SENTRY_DSN) return enabled;
  Sentry.initWithoutDefaultIntegrations({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.RENDER_GIT_COMMIT,
    // No request-data integration is loaded anyway; this keeps users and cookies out if one ever is.
    dataCollection: { userInfo: false, cookies: false },
    integrations: [Sentry.linkedErrorsIntegration()],
  });
  enabled = true;
  return true;
}

export type JobFailure = {
  jobId: string;
  kind: string;
  projectId: string;
  /** The job error the user was shown. */
  status: number;
  error: string;
  /** Every LLM attempt the job made, oldest first. */
  calls: LLMCallEvent[];
};

const SENTRY_TEXT_MAX = 200;

/**
 * What leaves for Sentry is trimmed: an answer the model got wrong can quote
 * its own output (which may echo what the user typed), so `bad_json` and
 * `bad_envelope` details are dropped; provider error messages are kept, short.
 */
function forSentry(calls: LLMCallEvent[]): LLMCallEvent[] {
  return calls.map(({ detail, ...rest }) =>
    detail === undefined || rest.outcome === 'bad_json' || rest.outcome === 'bad_envelope'
      ? rest
      : { ...rest, detail: detail.slice(0, SENTRY_TEXT_MAX) }
  );
}

/** A copy of the error with only its name, a trimmed message and the stack (no body text beyond that). */
function sanitizedError(err: unknown): Error {
  const e = new Error(err instanceof Error ? err.message.slice(0, SENTRY_TEXT_MAX) : String(err).slice(0, SENTRY_TEXT_MAX));
  e.name = err instanceof Error ? err.name : typeof err;
  if (err instanceof Error && err.stack) e.stack = `${e.name}: ${e.message}\n${err.stack.split('\n').slice(1).join('\n')}`;
  return e;
}

/** Rate limits and a missing key are expected on free models: warnings. Anything else is an error. */
const WARNING_ERRORS = new Set(['LLMRateLimitError', 'LLMNotConfiguredError']);

/**
 * A job failed: one JSON line in the logs, and one Sentry event (when
 * enabled) grouped by what went wrong and with which model, carrying the
 * job's LLM attempts.
 */
export function reportJobFailure(err: unknown, f: JobFailure): void {
  const last = f.calls[f.calls.length - 1];
  const errorName = err instanceof Error ? err.name : typeof err;
  console.error(
    JSON.stringify({
      event: 'job_failed',
      jobId: f.jobId,
      kind: f.kind,
      projectId: f.projectId,
      status: f.status,
      errorName,
      error: f.error.slice(0, 300),
      llmCalls: f.calls.length,
      lastOutcome: last?.outcome,
      lastModel: last?.modelUsed ?? last?.models[0],
    })
  );
  if (!enabled) return;
  Sentry.captureException(sanitizedError(err), {
    level: WARNING_ERRORS.has(errorName) ? 'warning' : 'error',
    fingerprint: ['job-failed', f.kind, errorName, last?.outcome ?? 'no-llm-call', last?.models[0] ?? '-'],
    tags: {
      job_kind: f.kind,
      llm_outcome: last?.outcome ?? 'none',
      llm_model: last?.models[0] ?? 'none',
      ...(last?.rateLimitKind ? { rate_limit: last.rateLimitKind } : {}),
    },
    extra: {
      jobId: f.jobId,
      projectId: f.projectId,
      status: f.status,
      shown: f.error.slice(0, SENTRY_TEXT_MAX),
      llmCalls: forSentry(f.calls),
    },
  });
}

/** Anything else worth a report (a route's unhandled error). */
export function reportError(err: unknown, context: Record<string, unknown> = {}): void {
  if (!enabled) return;
  Sentry.captureException(sanitizedError(err), { extra: context });
}

/** Send what's queued before the process exits (worker shutdown). */
export async function flushMonitoring(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
