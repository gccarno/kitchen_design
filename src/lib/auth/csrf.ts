import { bearerToken } from './request';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const underApi = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');

/**
 * Cheap CSRF hardening for cookie-authenticated API calls: a state-changing /api/* request without a
 * Bearer token (so authenticated by its cookie, if at all) is refused when the browser says it is cross-site (Sec-Fetch-Site other than
 * same-origin/none) or its Origin host differs from Host. Requests carrying neither header (curl,
 * native clients) pass. Used by the middleware, and by routes the middleware skips (/api/upload).
 */
export function csrfBlocked(method: string, pathname: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method.toUpperCase()) || !underApi(pathname) || bearerToken(headers) !== null) return false;
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') return true;
  const origin = headers.get('origin');
  if (origin !== null) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* 'null' or malformed: treated as a mismatch */
    }
    if (originHost === null || originHost !== headers.get('host')) return true;
  }
  return false;
}

export function csrfRefusedResponse(): Response {
  return Response.json({ error: 'Cross-site request refused' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
}
