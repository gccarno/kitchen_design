// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { authTokens, projects, users } from '../db/schema';
import { resetTestDb, sharedTestDb } from '../db/test-db';
import { newProject } from '../plan/new-project';
import { PgProjectStore } from '../storage/pg-projects';
import { hashToken } from './tokens';
import {
  EmailTakenError,
  InvalidCredentialsInputError,
  authenticate,
  findUserByEmail,
  createSession,
  createUser,
  revokeToken,
  SESSION_IDLE_DAYS,
  userCount,
  userForToken,
} from './users';

const PW = 'a-good-password';

describe('users', () => {
  beforeEach(async () => resetTestDb(await sharedTestDb()));

  it('findUserByEmail normalizes and returns null for unknown or invalid emails', async () => {
    const db = await sharedTestDb();
    const u = await createUser(db, 'alice@example.com', PW);
    expect(await findUserByEmail(db, ' ALICE@example.com ')).toEqual(u);
    expect(await findUserByEmail(db, 'nobody@example.com')).toBeNull();
    expect(await findUserByEmail(db, 'not-an-email')).toBeNull();
  });

  it('creates a user with a normalized email and counts users', async () => {
    const db = await sharedTestDb();
    expect(await userCount(db)).toBe(0);
    const u = await createUser(db, '  Alice@Example.COM ', PW);
    expect(u.email).toBe('alice@example.com');
    expect(u.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await userCount(db)).toBe(1);
    const [row] = await db.select().from(users);
    expect(row.passwordHash).toMatch(/^scrypt\$/);
  });

  it('rejects a duplicate email case-insensitively', async () => {
    const db = await sharedTestDb();
    await createUser(db, 'a@example.com', PW);
    await expect(createUser(db, 'A@Example.com', PW)).rejects.toBeInstanceOf(EmailTakenError);
  });

  it('rejects concurrent duplicates with EmailTakenError', async () => {
    const db = await sharedTestDb();
    const r = await Promise.allSettled([createUser(db, 'c@example.com', PW), createUser(db, 'c@example.com', PW)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const bad = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(bad.reason).toBeInstanceOf(EmailTakenError);
  });

  it('rejects bad email and bad passwords', async () => {
    const db = await sharedTestDb();
    await expect(createUser(db, 'not-an-email', PW)).rejects.toBeInstanceOf(InvalidCredentialsInputError);
    await expect(createUser(db, 'a@example.com', 'short')).rejects.toBeInstanceOf(InvalidCredentialsInputError);
    await expect(createUser(db, 'a@example.com', 'x'.repeat(201))).rejects.toBeInstanceOf(InvalidCredentialsInputError);
    await expect(createUser(db, `${'a'.repeat(250)}@example.com`, PW)).rejects.toBeInstanceOf(InvalidCredentialsInputError);
    expect(await userCount(db)).toBe(0);
  });

  it('claimOrphans moves null-owner projects and leaves other users alone', async () => {
    const db = await sharedTestDb();
    const other = await createUser(db, 'other@example.com', PW);
    const otherStore = new PgProjectStore(db, other.id);
    const mine = newProject({ name: 'other' });
    await otherStore.insert(mine);
    const orphans = new PgProjectStore(db, null);
    await orphans.insert(newProject({ name: 'o1' }));
    await orphans.insert(newProject({ name: 'o2' }));

    const u = await createUser(db, 'first@example.com', PW, { claimOrphans: true });
    expect(await new PgProjectStore(db, u.id).list()).toHaveLength(2);
    expect(await orphans.list()).toHaveLength(0);
    expect(await otherStore.list()).toHaveLength(1);
  });

  it('does not claim orphans by default', async () => {
    const db = await sharedTestDb();
    await new PgProjectStore(db, null).insert(newProject({ name: 'o1' }));
    await createUser(db, 'a@example.com', PW);
    expect(await new PgProjectStore(db, null).list()).toHaveLength(1);
  });

  it('authenticate: ok, wrong password, unknown email', async () => {
    const db = await sharedTestDb();
    const u = await createUser(db, 'a@example.com', PW);
    expect(await authenticate(db, ' A@example.com', PW)).toEqual(u);
    expect(await authenticate(db, 'a@example.com', 'wrong-password-1')).toBeNull();
    expect(await authenticate(db, 'nobody@example.com', PW)).toBeNull();
    expect(await authenticate(db, 'garbage', '')).toBeNull();
  });

  it('sessions: round-trip, unknown, revoke, hashed storage', async () => {
    const db = await sharedTestDb();
    const u = await createUser(db, 'a@example.com', PW);
    const token = await createSession(db, u.id, 'phone');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await userForToken(db, token)).toEqual(u);
    expect(await userForToken(db, 'nope')).toBeNull();
    const [row] = await db.select().from(authTokens);
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.label).toBe('phone');
    await revokeToken(db, token);
    expect(await userForToken(db, token)).toBeNull();
  });

  it('touches last_used_at at most once per hour', async () => {
    const db = await sharedTestDb();
    const u = await createUser(db, 'a@example.com', PW);
    const token = await createSession(db, u.id);
    const last = async () => (await db.select().from(authTokens))[0].lastUsedAt;
    expect(await last()).toBeNull();
    await userForToken(db, token);
    const first = await last();
    expect(first).not.toBeNull();
    await userForToken(db, token);
    expect(await last()).toBe(first);
    await db.execute(sql`UPDATE auth_tokens SET last_used_at = now() - interval '2 hours'`);
    await userForToken(db, token);
    expect(new Date((await last())!).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it(`expires a session unused for ${SESSION_IDLE_DAYS} days, and keeps one in use`, async () => {
    const db = await sharedTestDb();
    const u = await createUser(db, 'a@example.com', PW);
    const idle = await createSession(db, u.id);
    const active = await createSession(db, u.id);
    const age = (token: string, lastUsed: string | null, created: string) =>
      db.execute(
        sql`UPDATE auth_tokens SET last_used_at = ${lastUsed === null ? null : sql.raw(`now() - interval '${lastUsed}'`)}, created_at = now() - ${sql.raw(`interval '${created}'`)} WHERE token_hash = ${hashToken(token)}`
      );
    // Never used since it was created long ago; created long ago but used last week.
    await age(idle, null, `${SESSION_IDLE_DAYS + 1} days`);
    await age(active, '7 days', '400 days');
    expect(await userForToken(db, idle)).toBeNull();
    expect(await userForToken(db, active)).toEqual(u);
  });

  it('prunes expired sessions when a new one is created', async () => {
    const db = await sharedTestDb();
    const u = await createUser(db, 'a@example.com', PW);
    const old = await createSession(db, u.id);
    await db.execute(sql`UPDATE auth_tokens SET last_used_at = now() - ${sql.raw(`interval '${SESSION_IDLE_DAYS + 1} days'`)} WHERE token_hash = ${hashToken(old)}`);
    await createSession(db, u.id);
    const rows = await db.select().from(authTokens);
    expect(rows.map((r) => r.tokenHash)).not.toContain(hashToken(old));
    expect(rows).toHaveLength(1);
  });

  it('deleting a user cascades to their tokens', async () => {
    const db = await sharedTestDb();
    const u = await createUser(db, 'a@example.com', PW);
    await createSession(db, u.id);
    await db.delete(users).where(eq(users.id, u.id));
    expect(await db.select().from(authTokens)).toHaveLength(0);
    expect(await db.select().from(projects)).toHaveLength(0);
  });
});
