// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, sharedTestDb } from '../db/test-db';
import { newProject } from '../plan/new-project';
import { PgProjectStore } from '../storage/pg-projects';
import { CliError, createUserCli } from './create-user-cli';
import { userCount } from './users';

const LOCAL = 'postgresql://u:p@localhost:5432/db';
const PW = 'correct horse battery';

describe('createUserCli', () => {
  let db: Awaited<ReturnType<typeof sharedTestDb>>;
  beforeEach(async () => {
    db = await sharedTestDb();
    await resetTestDb(db);
  });

  it('creates a user from NEW_USER_PASSWORD, claiming orphans when the table is empty', async () => {
    const p = newProject({ name: 'Old' });
    await new PgProjectStore(db, null).insert(p);
    const first = await createUserCli({ DATABASE_URL: LOCAL, NEW_USER_PASSWORD: PW }, 'A@x.io', () => db);
    expect(first.claimedOrphans).toBe(true);
    expect(first.user.email).toBe('a@x.io');
    expect(await new PgProjectStore(db, first.user.id).load(p.id)).not.toBeNull();
    const second = await createUserCli({ DATABASE_URL: LOCAL, NEW_USER_PASSWORD: PW }, 'b@x.io', () => db);
    expect(second.claimedOrphans).toBe(false);
    expect(await userCount(db)).toBe(2);
  });

  it('refuses a remote database without MIGRATE_ALLOW_REMOTE=1', async () => {
    const env = { DATABASE_URL: 'postgresql://u:p@db.neon.tech/x', NEW_USER_PASSWORD: PW };
    await expect(createUserCli(env, 'a@x.io', () => db)).rejects.toBeInstanceOf(CliError);
    expect(await userCount(db)).toBe(0);
    await expect(createUserCli({ ...env, MIGRATE_ALLOW_REMOTE: '1' }, 'a@x.io', () => db)).resolves.toBeTruthy();
  });

  it('needs DATABASE_URL, an email and a password', async () => {
    await expect(createUserCli({ NEW_USER_PASSWORD: PW }, 'a@x.io', () => db)).rejects.toThrow(/DATABASE_URL/);
    await expect(createUserCli({ DATABASE_URL: LOCAL, NEW_USER_PASSWORD: PW }, undefined, () => db)).rejects.toThrow(/Usage/);
    await expect(createUserCli({ DATABASE_URL: LOCAL }, 'a@x.io', () => db)).rejects.toThrow(/NEW_USER_PASSWORD/);
  });
});
