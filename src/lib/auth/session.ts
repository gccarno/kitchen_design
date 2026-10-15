/**
 * Who is making this request. The only source of identity is a session token
 * (Bearer or `session` cookie) validated against the database — never a
 * header such as `x-user-id`, which a client could forge.
 */
import { headers } from 'next/headers';
import { getDb } from '../db/client';
import type { Db } from '../db/types';
import { authEnabled } from './config';
import { tokenFromRequest } from './request';
import { userForToken, type AuthUser } from './users';

/** No valid session. Pages turn it into a redirect to /login, API routes into 401 JSON. */
export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

/** The user whose valid token these headers carry, or null. */
export async function userFromHeaders(h: Headers, db?: Db): Promise<AuthUser | null> {
  const token = tokenFromRequest(h);
  return token ? userForToken(db ?? getDb(), token) : null;
}

/** The signed-in user of the current request, or null (always null when auth is off). */
export async function currentUser(): Promise<AuthUser | null> {
  if (!authEnabled()) return null;
  return userFromHeaders(await headers());
}

/** The signed-in user of the current request; throws UnauthorizedError if there is none. */
export async function requireUser(): Promise<AuthUser> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Wrap a route handler so an UnauthorizedError (from getStorage) becomes 401
 * JSON rather than a 500. The middleware already 401s requests without a
 * valid token; this covers a token revoked between the two checks.
 */
export function withUnauthorized<A extends unknown[], R extends Response>(
  handler: (...args: A) => Promise<R>
): (...args: A) => Promise<R | Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof UnauthorizedError) return unauthorizedResponse();
      throw err;
    }
  };
}
