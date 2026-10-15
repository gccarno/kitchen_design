import { registrationAllowed } from '@/lib/auth/config';
import { sessionCookie } from '@/lib/auth/cookies';
import { credentialsFrom, disabledResponse, json, jsonContentTypeGuard, readJsonBody } from '@/lib/auth/http';
import { EmailTakenError, InvalidCredentialsInputError, createSession, createUser, userCount } from '@/lib/auth/users';
import { getDb } from '@/lib/db/client';
import type { Db } from '@/lib/db/types';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';

const REGISTER_LOCK_KEY = 7_540_075;

export async function POST(req: Request): Promise<Response> {
  const off = disabledResponse() ?? jsonContentTypeGuard(req);
  if (off) return off;
  const body = await readJsonBody(req);
  if (body instanceof Response) return body;
  const creds = credentialsFrom(body);
  if (creds instanceof Response) return creds;

  const db = getDb();
  try {
    // One transaction under an advisory lock: check openness, create, claim orphans atomically,
    // so two simultaneous first registrations cannot both succeed.
    const user = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${REGISTER_LOCK_KEY})`);
      const txDb = tx as unknown as Db;
      if (!(await registrationAllowed(txDb))) return null;
      const first = (await userCount(txDb)) === 0;
      return createUser(txDb, creds.email, creds.password, { claimOrphans: first });
    });
    if (!user) return json({ error: 'Registration is closed' }, 403);
    const token = await createSession(db, user.id, 'web');
    return json({ id: user.id, email: user.email }, 201, { 'Set-Cookie': sessionCookie(token) });
  } catch (err) {
    if (err instanceof EmailTakenError) return json({ error: err.message }, 409);
    if (err instanceof InvalidCredentialsInputError) return json({ error: err.message }, 400);
    console.error('register failed', err instanceof Error ? err.name : 'unknown');
    return json({ error: 'Registration failed' }, 500);
  }
}
