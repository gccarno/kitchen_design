// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import nextConfig from '../../next.config';

const headersFor = async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const all = rules.find((r) => r.source === '/:path*');
  return Object.fromEntries((all?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
};

describe('security headers (next.config.ts)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sends nosniff, no framing and a strict referrer policy on every path', async () => {
    const h = await headersFor();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sends HSTS only in production (local http would be pinned to https)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect((await headersFor())['strict-transport-security']).toBeUndefined();
    vi.stubEnv('NODE_ENV', 'production');
    expect((await headersFor())['strict-transport-security']).toBe('max-age=31536000');
  });
});
