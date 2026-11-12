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
  /** HTTP status, or 0 when no response came back (network error, connection reset). */
  status: number;
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
  const network = f.status === 0;
  Sentry.captureException(new PhotoUploadError(`Photo upload failed: ${network ? 'no response' : `HTTP ${f.status}`}`), {
    level: 'error',
    fingerprint: ['upload-failed', String(f.status)],
    tags: { upload_status: String(f.status), upload_type: f.mimeType || 'unknown', online: String(navigator.onLine) },
    extra: {
      shown: f.error.slice(0, 200),
      sizeKB: Math.round(f.sizeBytes / 1024),
      durationMs: Math.round(f.durationMs),
    },
  });
}
