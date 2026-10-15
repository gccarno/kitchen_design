import { registrationAllowed } from '@/lib/auth/config';
import { sessionCookie } from '@/lib/auth/cookies';
import { credentialsFrom, disabledResponse, json, jsonContentTypeGuard, readJsonBody } from '@/lib/auth/http';
import { EmailTakenError, InvalidCredentialsInputError, createSession, createUser, userCount } from '@/lib/auth/users';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const off = disabledResponse() ?? jsonContentTypeGuard(req);
  if (off) return off;
  const body = await readJsonBody(req);
  if (body instanceof Response) return body;
  const creds = credentialsFrom(body);
  if (creds instanceof Response) return creds;

  const db = getDb();
  if (!(await registrationAllowed(db))) return json({ error: 'Registration is closed' }, 403);
  const first = (await userCount(db)) === 0;
  try {
    const user = await createUser(db, creds.email, creds.password, { claimOrphans: first });
    const token = await createSession(db, user.id, 'web');
    return json({ id: user.id, email: user.email }, 201, { 'Set-Cookie': sessionCookie(token) });
  } catch (err) {
    if (err instanceof EmailTakenError) return json({ error: err.message }, 409);
    if (err instanceof InvalidCredentialsInputError) return json({ error: err.message }, 400);
    console.error('register failed', err instanceof Error ? err.name : 'unknown');
    return json({ error: 'Registration failed' }, 500);
  }
}
