/**
 * Client side of the async job API: POST starts a job and answers
 * 202 { jobId }; GET /api/jobs/[id] reports it until it is done or failed.
 * Short requests only, so a phone connection never holds one open for minutes.
 */

/** Shown when the server no longer knows the job (disk mode lost it on a restart, or it was pruned). */
export const JOB_LOST_MESSAGE = 'The request was lost (the server restarted). Please try again.';

/** After this long, panels reassure the user that a request is still alive. */
export const SLOW_HINT_MS = 20_000;

export const POLL_START_MS = 1500;
export const POLL_MAX_MS = 5000;
const POLL_BACKOFF = 1.5;
/** Consecutive poll failures (network, 5xx, 429) ridden out before giving up. */
export const MAX_POLL_FAILURES = 3;

/** A request or job that failed; `message` is the server's error text. */
export class JobFailedError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly issues?: unknown
  ) {
    super(message);
    this.name = 'JobFailedError';
  }
}

export type WaitOptions = {
  /** First poll delay (default 1.5 s); later polls back off to `maxPollMs` (default 5 s). */
  pollMs?: number;
  maxPollMs?: number;
  signal?: AbortSignal;
  /** Message for an error response without an `error` field. */
  fallbackError?: (status: number) => string;
};

export type StartOptions = WaitOptions & { onJobId?: (id: string) => void };

type JobView = { status?: string; result?: unknown; error?: { status?: number; error?: string; issues?: unknown } };

const defaultFallback = (status: number) => `request failed (${status})`;

/**
 * Run `startRequest` (the POST); on 202 { jobId } report the id to `onJobId`
 * and poll until the job settles: resolve with its result, or throw a
 * JobFailedError carrying the job's error. Any other non-2xx start response
 * throws its `error` as before; a plain 2xx body is returned as the result.
 */
export async function startAndWait<T>(startRequest: () => Promise<Response>, opts: StartOptions = {}): Promise<T> {
  const res = await startRequest();
  const body = (await res.json().catch(() => ({}))) as { jobId?: unknown; error?: string; issues?: unknown };
  if (res.status === 202 && typeof body.jobId === 'string') {
    opts.onJobId?.(body.jobId);
    return waitForJob<T>(body.jobId, opts);
  }
  if (!res.ok) throw new JobFailedError(body.error ?? (opts.fallbackError ?? defaultFallback)(res.status), res.status, body.issues);
  return body as T;
}

/** Poll job `jobId` until it settles (also how a remounted component resumes). See startAndWait. */
export async function waitForJob<T>(jobId: string, opts: WaitOptions = {}): Promise<T> {
  const { signal } = opts;
  const maxDelay = opts.maxPollMs ?? POLL_MAX_MS;
  let delay = opts.pollMs ?? POLL_START_MS;
  let failures = 0;
  for (;;) {
    await sleep(delay, signal);
    delay = Math.min(delay * POLL_BACKOFF, maxDelay);
    let res: Response;
    try {
      res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store', signal });
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw abortReason(signal, err);
      if (++failures > MAX_POLL_FAILURES) throw err;
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as JobView & { error?: unknown };
    if (res.status === 404) throw new JobFailedError(JOB_LOST_MESSAGE, 404);
    if (!res.ok) {
      const message = typeof body.error === 'string' ? body.error : `could not check on the request (${res.status})`;
      const transient = res.status >= 500 || res.status === 429 || res.status === 408;
      if (!transient || ++failures > MAX_POLL_FAILURES) throw new JobFailedError(message, res.status);
      continue;
    }
    failures = 0;
    if (body.status === 'done') return body.result as T;
    if (body.status === 'failed') {
      const e = (body.error ?? {}) as NonNullable<JobView['error']>;
      const status = e.status ?? 500;
      throw new JobFailedError(e.error ?? (opts.fallbackError ?? defaultFallback)(status), status, e.issues);
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
