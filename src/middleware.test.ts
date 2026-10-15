// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { resetTestDb, sharedTestDb } from '@/lib/db/test-db';
import type { Db } from '@/lib/db/types';
import { createSession, createUser, revokeToken } from '@/lib/auth/users';
import { config, csrfBlocked, decide, isPublicPath, middleware } from './middleware';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));

const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'a@example.com' };
const on = (pathname: string, search = '') => ({ pathname, search, authEnabled: true });

describe('isPublicPath', () => {
  it('allows the login page, auth API, health check and static assets', () => {
    for (const p of [
      '/login',
      '/login/',
      '/api/auth/login',
      '/api/auth/me',
      '/api/health',
      '/_next/static/chunks/x.js',
      '/_next/image',
      '/favicon.ico',
      '/icons/icon-192.png',
      '/manifest.json',
      '/manifest.webmanifest',
    ]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });

  it('does not treat look-alike paths as public', () => {
    for (const p of ['/', '/loginx', '/login-evil', '/api/authx', '/api/auth', '/api/healthz', '/api/projects', '/project/1', '/icons', '/api/upload']) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});

describe('decide', () => {
  it('lets public paths through without a user', () => {
    expect(decide(on('/login'), null)).toEqual({ action: 'next' });
    expect(decide(on('/api/auth/login'), null)).toEqual({ action: 'next' });
    expect(decide(on('/api/health'), null)).toEqual({ action: 'next' });
  });

  it('redirects a page without a user to /login with a relative next', () => {
    expect(decide(on('/project/abc', '?x=1'), null)).toEqual({ action: 'redirect', location: '/login?next=%2Fproject%2Fabc%3Fx%3D1' });
    expect(decide(on('/'), null)).toEqual({ action: 'redirect', location: '/login?next=%2F' });
  });

  it('answers 401 for the API without a user', () => {
    expect(decide(on('/api/projects'), null)).toEqual({ action: 'unauthorized' });
    expect(decide(on('/api'), null)).toEqual({ action: 'unauthorized' });
    expect(decide(on('/api/export/x/csv'), null)).toEqual({ action: 'unauthorized' });
  });

  it('lets a signed-in user through', () => {
    expect(decide(on('/'), USER)).toEqual({ action: 'next' });
    expect(decide(on('/api/projects'), USER)).toEqual({ action: 'next' });
  });

  it('lets everything through when auth is disabled', () => {
    expect(decide({ pathname: '/', search: '', authEnabled: false }, null)).toEqual({ action: 'next' });
    expect(decide({ pathname: '/api/projects', search: '', authEnabled: false }, null)).toEqual({ action: 'next' });
  });
});

describe('config', () => {
  it('runs on the Node.js runtime', () => {
    expect(config.runtime).toBe('nodejs');
  });

  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it('skips static assets and public paths', () => {
    for (const p of ['/_next/static/chunks/a.js', '/_next/image?url=x', '/favicon.ico', '/icons/icon.png', '/manifest.json', '/login', '/api/auth/login', '/api/health']) {
      expect(matches(p), p).toBe(false);
    }
  });

  it('runs for pages and the rest of the API', () => {
    for (const p of ['/', '/project/abc', '/compare/abc', '/api/projects', '/api/upload', '/api/export/x/csv', '/loginx', '/api/authx', '/api/healthz']) {
      expect(matches(p), p).toBe(true);
    }
  });
});

describe('middleware', () => {
  let db: Db;
  beforeAll(async () => {
    db = await sharedTestDb();
    state.db = db;
  });
  beforeEach(async () => {
    await resetTestDb(db);
    vi.stubEnv('DATABASE_URL', 'postgres://test');
  });
  afterEach(() => vi.unstubAllEnvs());

  const run = (path: string, headers: Record<string, string> = {}) => middleware(new NextRequest(`http://localhost${path}`, { headers }));

  it('redirects an anonymous page request to /login (307)', async () => {
    const res = await run('/project/abc?tab=2');
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search).toBe(
      '/login?next=%2Fproject%2Fabc%3Ftab%3D2'
    );
  });

  it('answers 401 JSON to an anonymous API request', async () => {
    const res = await run('/api/projects');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('rejects a revoked token and a forged x-user-id header', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    const t = await createSession(db, u.id);
    await revokeToken(db, t);
    expect((await run('/api/projects', { cookie: `session=${t}` })).status).toBe(401);
    expect((await run('/api/projects', { 'x-user-id': u.id })).status).toBe(401);
  });

  it('passes a valid session through and strips any incoming x-user-id', async () => {
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    const t = await createSession(db, u.id);
    for (const auth of [{ cookie: `session=${t}` }, { authorization: `Bearer ${t}` }] as Record<string, string>[]) {
      const res = await run('/api/projects', { ...auth, 'x-user-id': 'someone-else' });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-next')).toBe('1');
      const kept = (res.headers.get('x-middleware-override-headers') ?? '').split(',');
      expect(kept).not.toContain('x-user-id');
      expect(res.headers.get('x-middleware-request-x-user-id')).toBeNull();
    }
  });

  it('does nothing (but still strips x-user-id) when auth is disabled', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const res = await run('/api/projects', { 'x-user-id': 'x' });
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect((res.headers.get('x-middleware-override-headers') ?? '').split(',')).not.toContain('x-user-id');
  });
});

describe('csrfBlocked', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it('blocks cross-site state-changing API requests', () => {
    expect(csrfBlocked('POST', '/api/upload', h({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(csrfBlocked('POST', '/api/projects', h({ 'sec-fetch-site': 'same-site' }))).toBe(true);
    expect(csrfBlocked('DELETE', '/api/projects/x', h({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(csrfBlocked('POST', '/api/projects', h({ origin: 'https://evil.example', host: 'app.example' }))).toBe(true);
    expect(csrfBlocked('POST', '/api/projects', h({ origin: 'null', host: 'app.example' }))).toBe(true);
  });
  it('allows same-origin, header-less, Bearer and safe-method requests', () => {
    expect(csrfBlocked('POST', '/api/projects', h({ 'sec-fetch-site': 'same-origin', origin: 'https://app.example', host: 'app.example' }))).toBe(false);
    expect(csrfBlocked('POST', '/api/projects', h({ 'sec-fetch-site': 'none' }))).toBe(false);
    expect(csrfBlocked('POST', '/api/projects', h({}))).toBe(false);
    expect(csrfBlocked('POST', '/api/projects', h({ 'sec-fetch-site': 'cross-site', authorization: 'Bearer t' }))).toBe(false);
    expect(csrfBlocked('GET', '/api/projects', h({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(csrfBlocked('POST', '/somewhere', h({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });
});

describe('middleware CSRF', () => {
  beforeAll(async () => {
    state.db = await sharedTestDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('403s a cross-site POST to /api/upload and /api/projects even with a valid session', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://test');
    const db = await sharedTestDb();
    await resetTestDb(db);
    const u = await createUser(db, 'a@example.com', 'a-good-password');
    const t = await createSession(db, u.id);
    for (const path of ['/api/upload', '/api/projects']) {
      const res = await middleware(
        new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { cookie: `session=${t}`, 'sec-fetch-site': 'cross-site' } })
      );
      expect(res.status, path).toBe(403);
    }
    const ok = await middleware(new NextRequest('http://localhost/api/projects', { method: 'POST', headers: { cookie: `session=${t}` } }));
    expect(ok.status).toBe(200);
  });
});
