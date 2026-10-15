import { authEnabled } from './config';

export const MAX_BODY_BYTES = 10 * 1024;
export const MAX_PASSWORD_LENGTH = 200;

export function json(body: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/** 404 when auth is off. */
export function disabledResponse(): Response | null {
  return authEnabled() ? null : json({ error: 'Auth is not enabled' }, 404);
}

/** 415 unless Content-Type is application/json. */
export function jsonContentTypeGuard(req: Request): Response | null {
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/json' ? null : json({ error: 'Content-Type must be application/json' }, 415);
}

/** Read and parse a small JSON object body; returns a Response on failure. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | Response> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ error: 'Request body too large' }, 413);
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return json({ error: 'Request body too large' }, 413);
      }
      chunks.push(value);
    }
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return json({ error: 'Invalid JSON body' }, 400);
}

/** Extract email/password strings; oversize input is rejected before any scrypt work. */
export function credentialsFrom(body: Record<string, unknown>): { email: string; password: string } | Response {
  const { email, password } = body;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return json({ error: 'Email and password are required' }, 400);
  }
  if (email.length > 254 || password.length > MAX_PASSWORD_LENGTH) {
    return json({ error: 'Email or password is too long' }, 400);
  }
  return { email, password };
}

/**
 * Client IP for throttling, from x-forwarded-for. TRUSTED_PROXY_HOPS (default 1) is the number of
 * entries appended by trusted proxies: the Nth entry from the RIGHT is the client (1 = rightmost,
 * what Render and Tailscale Funnel append). Earlier entries are client-supplied and never used.
 * 0 ignores the header. Falls back to 'unknown' (a shared bucket) when there is no such entry.
 */
export function clientIp(headers: Headers, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.TRUSTED_PROXY_HOPS;
  const parsed = raw === undefined || raw.trim() === '' ? 1 : Number(raw);
  const hops = Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
  if (hops === 0) return 'unknown';
  const parts = (headers.get('x-forwarded-for') ?? '').split(',');
  return parts[parts.length - hops]?.trim() || 'unknown';
}
