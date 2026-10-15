import { sessionCookie } from '@/lib/auth/cookies';
import { clientIp, credentialsFrom, disabledResponse, json, jsonContentTypeGuard, readJsonBody } from '@/lib/auth/http';
import { emailThrottle, ipThrottle, loginThrottle } from '@/lib/auth/throttle';
import { tokensFromRequest } from '@/lib/auth/request';
import { authenticate, createSession, revokeToken } from '@/lib/auth/users';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const off = disabledResponse() ?? jsonContentTypeGuard(req);
  if (off) return off;
  const body = await readJsonBody(req);
  if (body instanceof Response) return body;
  const creds = credentialsFrom(body);
  if (creds instanceof Response) return creds;

  const email = creds.email.trim().toLowerCase();
  const ip = clientIp(req.headers);
  const key = `${ip}|${email}`;
  const throttle = loginThrottle();
  const byEmail = emailThrottle();
  // Reserve attempts up front (before the slow scrypt verify) so parallel guesses can't race past the limit.
  if (!ipThrottle().tryConsume(ip) || !throttle.tryConsume(key) || !byEmail.tryConsume(email)) return json({ error: 'Too many attempts. Try again later.' }, 429);

  const db = getDb();
  const user = await authenticate(db, creds.email, creds.password);
  if (!user) {
    return json({ error: 'Invalid email or password' }, 401);
  }
  throttle.clear(key);
  byEmail.clear(email);
  // Signing in again replaces the session this request presented.
  for (const old of tokensFromRequest(req.headers)) await revokeToken(db, old);
  const token = await createSession(db, user.id, 'web');
  return json({ id: user.id, email: user.email }, 200, { 'Set-Cookie': sessionCookie(token) });
}
