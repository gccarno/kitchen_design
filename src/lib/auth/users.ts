import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { authTokens, projects, users } from '../db/schema';
import type { Db } from '../db/types';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';
import { hashToken, newToken } from './tokens';

export type AuthUser = { id: string; email: string };

export class EmailTakenError extends Error {
  constructor() {
    super("That email can't be used");
    this.name = 'EmailTakenError';
  }
}

export class InvalidCredentialsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCredentialsInputError';
  }
}

const EmailSchema = z.string().trim().toLowerCase().max(254).email();
const PasswordSchema = z.string().min(10).max(200);

function normalizeEmail(email: string): string | null {
  const r = EmailSchema.safeParse(email);
  return r.success ? r.data : null;
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && typeof e === 'object' && i < 5; i++) {
    if ((e as { code?: unknown }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export async function userCount(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row.n;
}

export async function createUser(
  db: Db,
  email: string,
  password: string,
  opts: { claimOrphans?: boolean } = {}
): Promise<AuthUser> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new InvalidCredentialsInputError('Enter a valid email address');
  if (!PasswordSchema.safeParse(password).success) {
    throw new InvalidCredentialsInputError('Password must be 10 to 200 characters');
  }
  const passwordHash = await hashPassword(password);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(users).values({ email: normalized, passwordHash }).returning({ id: users.id, email: users.email });
      if (opts.claimOrphans) await tx.update(projects).set({ ownerId: row.id }).where(isNull(projects.ownerId));
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new EmailTakenError();
    throw err;
  }
}

/** Always runs exactly one scrypt verify, so timing does not reveal whether the email exists. */
export async function authenticate(db: Db, email: string, password: string): Promise<AuthUser | null> {
  const normalized = normalizeEmail(email);
  const [row] = normalized
    ? await db.select().from(users).where(eq(users.email, normalized)).limit(1)
    : [undefined];
  const ok = await verifyPassword(password, row ? row.passwordHash : DUMMY_HASH);
  return row && ok ? { id: row.id, email: row.email } : null;
}

/** The user with this (normalized) email, or null. For scripts. */
export async function findUserByEmail(db: Db, email: string): Promise<AuthUser | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const [row] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, normalized)).limit(1);
  return row ?? null;
}

export async function createSession(db: Db, userId: string, label?: string): Promise<string> {
  const { token, hash } = newToken();
  await db.insert(authTokens).values({ tokenHash: hash, userId, label: label ?? null });
  return token;
}

export async function userForToken(db: Db, token: string): Promise<AuthUser | null> {
  const hash = hashToken(token);
  const [row] = await db
    .select({ id: users.id, email: users.email })
    .from(authTokens)
    .innerJoin(users, eq(users.id, authTokens.userId))
    .where(eq(authTokens.tokenHash, hash))
    .limit(1);
  if (!row) return null;
  await db
    .update(authTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(authTokens.tokenHash, hash),
        or(isNull(authTokens.lastUsedAt), lt(authTokens.lastUsedAt, sql`now() - interval '1 hour'`))
      )
    );
  return row;
}

export async function revokeToken(db: Db, token: string): Promise<void> {
  await db.delete(authTokens).where(eq(authTokens.tokenHash, hashToken(token)));
}
