/**
 * Auth gate (Node.js runtime, so it can query Postgres). Only active when
 * DATABASE_URL is set; disk mode passes everything through. Requests without
 * a valid session token: pages → 307 to /login?next=<path>, /api/* → 401.
 * getStorage() re-validates the token itself; this is the first line, not the only one.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { authEnabled } from '@/lib/auth/config';
import { unauthorizedResponse, userFromHeaders } from '@/lib/auth/session';
import type { AuthUser } from '@/lib/auth/users';

export const config = {
  runtime: 'nodejs',
  // Skip static assets and the public paths (decide() checks those again).
  matcher: ['/((?!_next/static/|_next/image|favicon\\.ico$|icons/|manifest(?:\\.json|\\.webmanifest)$|login(?:/|$)|api/auth/|api/health(?:/|$)).*)'],
};

export type RequestInfo = { pathname: string; search: string; authEnabled: boolean };
export type Decision = { action: 'next' } | { action: 'redirect'; location: string } | { action: 'unauthorized' };

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Reachable without signing in: the login page, the auth API, the health check, static assets. */
export function isPublicPath(pathname: string): boolean {
  return (
    under(pathname, '/login') ||
    pathname.startsWith('/api/auth/') ||
    under(pathname, '/api/health') ||
    pathname.startsWith('/_next/static/') ||
    pathname === '/_next/image' ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/icons/') ||
    pathname === '/manifest.json' ||
    pathname === '/manifest.webmanifest'
  );
}

/** Whether this request's token has to be looked up at all. */
export function needsUser(info: RequestInfo): boolean {
  return info.authEnabled && !isPublicPath(info.pathname);
}

export function decide(info: RequestInfo, user: AuthUser | null): Decision {
  if (!needsUser(info) || user) return { action: 'next' };
  if (under(info.pathname, '/api')) return { action: 'unauthorized' };
  // Always a same-origin relative path; the login page only honours those.
  return { action: 'redirect', location: `/login?next=${encodeURIComponent(info.pathname + info.search)}` };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cheap CSRF hardening for cookie-authenticated API calls: a state-changing /api/* request without an
 * Authorization header is refused when the browser says it is cross-site (Sec-Fetch-Site other than
 * same-origin/none) or its Origin host differs from Host. Requests carrying neither header (curl,
 * native clients) pass.
 */
export function csrfBlocked(method: string, pathname: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method.toUpperCase()) || !under(pathname, '/api') || headers.has('authorization')) return false;
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

export async function middleware(req: NextRequest): Promise<Response> {
  const info: RequestInfo = { pathname: req.nextUrl.pathname, search: req.nextUrl.search, authEnabled: authEnabled() };
  if (needsUser(info) && csrfBlocked(req.method, info.pathname, req.headers)) {
    return Response.json({ error: 'Cross-site request refused' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const user = needsUser(info) ? await userFromHeaders(req.headers) : null;
  const decision = decide(info, user);
  if (decision.action === 'unauthorized') return unauthorizedResponse();
  if (decision.action === 'redirect') return NextResponse.redirect(new URL(decision.location, req.url), 307);
  // Defence in depth: nothing downstream reads it, but never forward a client-supplied identity header.
  const forwarded = new Headers(req.headers);
  forwarded.delete('x-user-id');
  return NextResponse.next({ request: { headers: forwarded } });
}
