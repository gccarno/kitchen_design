import { sessionCookie } from '@/lib/auth/cookies';
import { credentialsFrom, disabledResponse, json, jsonContentTypeGuard, readJsonBody } from '@/lib/auth/http';
import { loginThrottle } from '@/lib/auth/throttle';
import { authenticate, createSession } from '@/lib/auth/users';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const off = disabledResponse() ?? jsonContentTypeGuard(req);
  if (off) return off;
  const body = await readJsonBody(req);
  if (body instanceof Response) return body;
  const creds = credentialsFrom(body);
  if (creds instanceof Response) return creds;

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const key = `${ip}|${creds.email.trim().toLowerCase()}`;
  const throttle = loginThrottle();
  if (!throttle.allowed(key)) return json({ error: 'Too many attempts. Try again later.' }, 429);

  const db = getDb();
  const user = await authenticate(db, creds.email, creds.password);
  if (!user) {
    throttle.recordFailure(key);
    return json({ error: 'Invalid email or password' }, 401);
  }
  throttle.clear(key);
  const token = await createSession(db, user.id, 'web');
  return json({ id: user.id, email: user.email }, 200, { 'Set-Cookie': sessionCookie(token) });
}
