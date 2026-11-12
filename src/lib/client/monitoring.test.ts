import { describe, it, expect, vi, beforeEach } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('@sentry/browser', () => sentry);

const failure = { status: 502, error: 'upload failed (502)', sizeBytes: 4_200_000, mimeType: 'image/jpeg', durationMs: 31_250.4 };

describe('client monitoring', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(sentry).forEach((f) => f.mockClear());
  });

  it('does nothing without a DSN', async () => {
    const m = await import('./monitoring');
    expect(m.initClientMonitoring({})).toBe(false);
    m.reportUploadFailure(failure);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('starts without personal data and without console breadcrumbs', async () => {
    const m = await import('./monitoring');
    expect(m.initClientMonitoring({ dsn: 'https://k@o1.ingest.sentry.io/1', environment: 'production', release: 'abc' })).toBe(true);
    const opts = sentry.init.mock.calls[0][0];
    expect(opts).toMatchObject({
      dsn: 'https://k@o1.ingest.sentry.io/1',
      environment: 'production',
      release: 'abc',
      dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
    });
    expect(opts.tracesSampleRate).toBeUndefined();
    const kept = opts.integrations([{ name: 'Breadcrumbs' }, { name: 'Console' }, { name: 'GlobalHandlers' }]);
    expect(kept.map((i: { name: string }) => i.name)).toEqual(['Breadcrumbs', 'GlobalHandlers']);
  });

  it('reports a failed upload grouped by status, with size and timing but no file name', async () => {
    const m = await import('./monitoring');
    m.initClientMonitoring({ dsn: 'https://k@o1.ingest.sentry.io/1' });
    m.reportUploadFailure(failure);
    const [err, ctx] = sentry.captureException.mock.calls[0];
    expect(err.name).toBe('PhotoUploadError');
    expect(err.message).toBe('Photo upload failed: HTTP 502');
    expect(ctx.fingerprint).toEqual(['upload-failed', '502']);
    expect(ctx.tags).toMatchObject({ upload_status: '502', upload_type: 'image/jpeg' });
    expect(ctx.extra).toEqual({ shown: 'upload failed (502)', sizeKB: 4102, durationMs: 31250 });
  });

  it('names a request that got no response', async () => {
    const m = await import('./monitoring');
    m.initClientMonitoring({ dsn: 'https://k@o1.ingest.sentry.io/1' });
    m.reportUploadFailure({ ...failure, status: 0, error: 'Failed to fetch' });
    expect((sentry.captureException.mock.calls[0][0] as Error).message).toBe('Photo upload failed: no response');
  });
});
