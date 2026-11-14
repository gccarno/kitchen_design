import * as Sentry from '@sentry/browser';

/**
 * Browser error reporting (the phone app's WebView included). Sentry only
 * when NEXT_PUBLIC_SENTRY_DSN was set at build time; otherwise every call
 * here is a no-op. Like the server side (src/lib/monitoring.ts): errors only,
 * no tracing, no Session Replay, no user data. Never sends photos, file
 * names or what the user typed.
 */

let enabled = false;

type Env = { dsn?: string; environment?: string; release?: string };

// NEXT_PUBLIC_* values are inlined at build time, so they must be read by their literal names.
const buildEnv: Env = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_RELEASE,
};

export function initClientMonitoring(env: Env = buildEnv): boolean {
  if (enabled || !env.dsn) return enabled;
  Sentry.init({
    dsn: env.dsn,
    environment: env.environment,
    release: env.release || undefined,
    // No user, cookies or request/response bodies (a body could be a photo or the user's words).
    dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
    // Uncaught errors and unhandled rejections are reported; the breadcrumbs that lead up to
    // them keep clicks, navigation and fetches but not the console (it can hold model output).
    integrations: (defaults) => defaults.filter((i) => i.name !== 'Console'),
  });
  enabled = true;
  return true;
}

export type UploadFailure = {
  /** HTTP status, 0 when no response came back (network error, timeout), -1 when nothing was sent (empty file). */
  status: number;
  /** The request was aborted after waiting too long. */
  timedOut?: boolean;
  /** The message the user was shown. */
  error: string;
  sizeBytes: number;
  mimeType: string;
  durationMs: number;
};

/** Named so the Sentry issue reads "PhotoUploadError: Photo upload failed: HTTP 502". */
export class PhotoUploadError extends Error {
  override name = 'PhotoUploadError';
}

/** A photo upload failed: the user saw an error, so Sentry gets one too, grouped by status. */
export function reportUploadFailure(f: UploadFailure): void {
  if (!enabled) return;
  const what = f.timedOut ? 'timed out' : f.status === 0 ? 'no response' : f.status === -1 ? 'empty file' : `HTTP ${f.status}`;
  Sentry.captureException(new PhotoUploadError(`Photo upload failed: ${what}`), {
    level: 'error',
    fingerprint: ['upload-failed', f.timedOut ? 'timeout' : String(f.status)],
    tags: {
      upload_status: String(f.status),
      upload_type: f.mimeType || 'unknown',
      online: String(navigator.onLine),
      ...(f.timedOut ? { upload_timeout: 'true' } : {}),
    },
    extra: {
      shown: f.error.slice(0, 200),
      sizeKB: Math.round(f.sizeBytes / 1024),
      durationMs: Math.round(f.durationMs),
    },
  });
}

export type UploadStep =
  | 'picker-open'
  | 'picker-cancelled'
  | 'files-picked'
  | 'upload-start'
  | 'upload-done'
  | 'upload-failed';

/**
 * A breadcrumb for each step of a photo upload, so any later report carries
 * the sequence that led to it. Counts, sizes, types, statuses and timings only:
 * never file names.
 */
export function uploadStep(step: UploadStep, data: Record<string, string | number | boolean> = {}): void {
  if (!enabled) return;
  Sentry.addBreadcrumb({ category: 'photo-upload', message: step, level: step === 'upload-failed' ? 'error' : 'info', data });
}

/** Named so the Sentry issue reads "PhotoPickerLostError: Photo picker result lost …". */
export class PhotoPickerLostError extends Error {
  override name = 'PhotoPickerLostError';
}

/**
 * The camera or photo picker was opened but its result never came back,
 * usually because Android closed the app while the camera was in front and
 * the page reloaded. Nothing else would report this.
 */
export function reportPickerLost(f: { source: string; ageMs: number }): void {
  if (!enabled) return;
  // An Error, not captureMessage: a message's issue is titled after a minified stack frame ("Object.c").
  Sentry.captureException(new PhotoPickerLostError('Photo picker result lost (app reloaded while picking)'), {
    level: 'warning',
    fingerprint: ['photo-picker-lost', f.source],
    tags: { picker_source: f.source },
    extra: { secondsSincePickerOpened: Math.round(f.ageMs / 1000) },
  });
}
