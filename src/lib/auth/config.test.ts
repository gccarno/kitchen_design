// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, sharedTestDb } from '../db/test-db';
import { authEnabled, registrationAllowed } from './config';
import { createUser } from './users';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('authEnabled', () => {
  it('is true only for a non-empty DATABASE_URL', () => {
    expect(authEnabled(env({ DATABASE_URL: 'postgres://x' }))).toBe(true);
    expect(authEnabled(env({ DATABASE_URL: '' }))).toBe(false);
    expect(authEnabled(env({ DATABASE_URL: '  ' }))).toBe(false);
    expect(authEnabled(env({}))).toBe(false);
  });
});

describe('registrationAllowed', () => {
  beforeEach(async () => resetTestDb(await sharedTestDb()));

  it('is open while empty, closed after, and reopened by ALLOW_REGISTRATION=1', async () => {
    const db = await sharedTestDb();
    expect(await registrationAllowed(db, env({}))).toBe(true);
    await createUser(db, 'a@example.com', 'a-good-password');
    expect(await registrationAllowed(db, env({}))).toBe(false);
    expect(await registrationAllowed(db, env({ ALLOW_REGISTRATION: '1' }))).toBe(true);
    expect(await registrationAllowed(db, env({ ALLOW_REGISTRATION: 'true' }))).toBe(false);
  });

  it('in production needs ALLOW_REGISTRATION=1 even for the first user', async () => {
    const db = await sharedTestDb();
    expect(await registrationAllowed(db, env({ NODE_ENV: 'production' }))).toBe(false);
    expect(await registrationAllowed(db, env({ NODE_ENV: 'production', ALLOW_REGISTRATION: '1' }))).toBe(true);
  });
});
