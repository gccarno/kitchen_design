/**
 * Client side of the async job API: POST starts a job and answers
 * 202 { jobId }; GET /api/jobs/[id] reports it until it is done or failed.
 * Short requests only, so a phone connection never holds one open for minutes.
 */

import { markOffline, markOnline } from './online';

/** Shown when the server no longer knows the job (disk mode lost it on a restart, or it was pruned). */
export const JOB_LOST_MESSAGE = 'The request was lost (the server restarted). Please try again.';

/** After this long, panels reassure the user that a request is still alive. */
export const SLOW_HINT_MS = 20_000;

export const POLL_START_MS = 1500;
export const POLL_MAX_MS = 5000;
const POLL_BACKOFF = 1.5;
/** How long polls may keep failing (network, 5xx, 408, 429) before giving up on the connection. */
export const MAX_FAILING_MS = 2 * 60 * 1000;
/** The longest a client waits for one job before giving up. */
export const MAX_WAIT_MS = 30 * 60 * 1000;

/** Shown when polling had to give up although the job may still finish on the server. */
export const CONNECTION_LOST_MESSAGE = 'Connection lost — reopen this panel to check the result';
export const WAIT_TOO_LONG_MESSAGE = 'Still no result after 30 minutes — reopen this panel to check again.';

/**
 * A request or job that failed; `message` is the server's error text.
 * `keepJob` is true when the client gave up on its own (connection lost,
 * waited too long, a reply it doesn't understand) — the job may still
 * finish, so a panel keeps it remembered for the next mount. It is false
 * for the server's own verdict (done/failed, 404 lost, other 4xx).
 */
export class JobFailedError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly issues?: unknown,
    readonly keepJob = false
  ) {
    super(message);
    this.name = 'JobFailedError';
  }
}

/** Whether a panel should keep the remembered job after `err` (see JobFailedError.keepJob). */
export const keepsJob = (err: unknown): boolean => err instanceof JobFailedError && err.keepJob;

export type WaitOptions = {
  /** First poll delay (default 1.5 s); later polls back off to `maxPollMs` (default 5 s). */
  pollMs?: number;
  maxPollMs?: number;
  /** Consecutive-failure budget (default 2 min) and overall wait limit (default 30 min). */
  maxFailingMs?: number;
  maxWaitMs?: number;
  signal?: AbortSignal;
  /** Message for an error response without an `error` field. */
  fallbackError?: (status: number) => string;
};

export type StartOptions = WaitOptions & { onJobId?: (id: string) => void };

type JobView = { status?: unknown; result?: unknown; error?: unknown };
type JobErrorBody = { status?: number; error?: string; issues?: unknown };

const defaultFallback = (status: number) => `request failed (${status})`;

/**
 * Run `startRequest` (the POST); on 202 { jobId } report the id to `onJobId`
 * and poll until the job settles: resolve with its result, or throw a
 * JobFailedError carrying the job's error. An error start response throws
 * its `error` as before; any other answer (a 2xx that is not 202 { jobId }) is an error too.
 */
export async function startAndWait<T>(startRequest: () => Promise<Response>, opts: StartOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await startRequest();
  } catch (err) {
    if (err instanceof TypeError) markOffline();
    throw err;
  }
  markOnline();
  const body = (await res.json().catch(() => ({}))) as { jobId?: unknown; error?: string; issues?: unknown };
  if (res.status === 202 && typeof body.jobId === 'string') {
    // Unmounted while the POST was in flight: don't remember a job nobody will resume or forget.
    if (opts.signal?.aborted) throw abortReason(opts.signal);
    opts.onJobId?.(body.jobId);
    return waitForJob<T>(body.jobId, opts);
  }
  if (!res.ok) throw new JobFailedError(body.error ?? (opts.fallbackError ?? defaultFallback)(res.status), res.status, body.issues);
  throw new JobFailedError(`unexpected response from the server (${res.status})`, res.status);
}

/** Poll job `jobId` until it settles (also how a remounted component resumes). See startAndWait. */
export async function waitForJob<T>(jobId: string, opts: WaitOptions = {}): Promise<T> {
  const { signal } = opts;
  const maxDelay = opts.maxPollMs ?? POLL_MAX_MS;
  const maxFailing = opts.maxFailingMs ?? MAX_FAILING_MS;
  const deadline = Date.now() + (opts.maxWaitMs ?? MAX_WAIT_MS);
  let delay = opts.pollMs ?? POLL_START_MS;
  let failingSince: number | null = null;
  /** A poll failed transiently: keep going until failures have lasted `maxFailing`. */
  const transientFailure = () => {
    failingSince ??= Date.now();
    if (Date.now() - failingSince >= maxFailing) throw new JobFailedError(CONNECTION_LOST_MESSAGE, undefined, undefined, true);
  };
  for (;;) {
    if (Date.now() >= deadline) throw new JobFailedError(WAIT_TOO_LONG_MESSAGE, undefined, undefined, true);
    await sleep(delay, signal);
    delay = Math.min(delay * POLL_BACKOFF, maxDelay);
    let res: Response;
    try {
      res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store', signal });
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw abortReason(signal, err);
      transientFailure();
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as JobView;
    if (res.status === 404) throw new JobFailedError(JOB_LOST_MESSAGE, 404);
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429 || res.status === 408) {
        transientFailure();
        continue;
      }
      // Any other 4xx is the server's final word. A 401 means the session ended: the job
      // belongs to that session's user, so it is not worth remembering either.
      const message = typeof body.error === 'string' ? body.error : `could not check on the request (${res.status})`;
      throw new JobFailedError(message, res.status);
    }
    failingSince = null;
    switch (body.status) {
      case 'done':
        return body.result as T;
      case 'failed': {
        const e = (body.error ?? {}) as JobErrorBody;
        const status = e.status ?? 500;
        throw new JobFailedError(e.error ?? (opts.fallbackError ?? defaultFallback)(status), status, e.issues);
      }
      case 'queued':
      case 'running':
        continue;
      default:
        throw new JobFailedError('unexpected response from the server', res.status, undefined, true);
    }
  }
}

export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

function abortReason(signal: AbortSignal | undefined, fallback?: unknown): unknown {
  const reason: unknown = signal?.reason;
  if (isAbortError(reason)) return reason;
  if (isAbortError(fallback)) return fallback;
  return new DOMException('The operation was aborted.', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortReason(signal));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/*
 * The in-flight job of a panel, kept in sessionStorage so navigating away and
 * back resumes polling instead of posting again. Storage can be unavailable
 * (private mode, blocked): every access is best effort.
 */

export function rememberJob(key: string, value: { jobId: string } & Record<string, unknown>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best effort
  }
}

export function recallJob<T extends { jobId: string }>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (typeof value === 'object' && value !== null && typeof (value as { jobId?: unknown }).jobId === 'string') return value as T;
    return null;
  } catch {
    return null;
  }
}

export function forgetJob(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // best effort
  }
}
