import { describe, it, expect } from 'vitest';
import { isLocalDatabase, shouldMigrateOnStartup } from './remote-guard';

describe('isLocalDatabase', () => {
  it('accepts localhost addresses', () => {
    for (const url of ['postgres://u:p@localhost:5432/db', 'postgresql://127.0.0.1/db', 'postgres://[::1]:5432/db']) {
      expect(isLocalDatabase(url)).toBe(true);
    }
  });

  it('treats anything else — Neon included — as remote', () => {
    expect(isLocalDatabase('postgresql://u:p@ep-cool-name-123.us-east-1.aws.neon.tech/neondb?sslmode=require')).toBe(false);
    expect(isLocalDatabase('postgres://db.internal:5432/x')).toBe(false);
  });

  it('treats an unparseable URL as remote (refuse when unsure)', () => {
    expect(isLocalDatabase('not a url')).toBe(false);
  });
});

describe('shouldMigrateOnStartup', () => {
  const remote = 'postgres://u:p@db.example.com/x';
  const local = 'postgres://u:p@localhost/x';
  it('migrates in production, even a remote database', () => {
    expect(shouldMigrateOnStartup({ NODE_ENV: 'production', DATABASE_URL: remote })).toBe(true);
  });
  it('does not migrate a remote database from dev', () => {
    expect(shouldMigrateOnStartup({ NODE_ENV: 'development', DATABASE_URL: remote })).toBe(false);
  });
  it('migrates a remote database from dev only with MIGRATE_ALLOW_REMOTE=1', () => {
    expect(shouldMigrateOnStartup({ NODE_ENV: 'development', DATABASE_URL: remote, MIGRATE_ALLOW_REMOTE: '1' })).toBe(true);
  });
  it('migrates a local database from dev', () => {
    expect(shouldMigrateOnStartup({ NODE_ENV: 'development', DATABASE_URL: local })).toBe(true);
  });
  it('does nothing without DATABASE_URL', () => {
    expect(shouldMigrateOnStartup({ NODE_ENV: 'production' })).toBe(false);
    expect(shouldMigrateOnStartup({ NODE_ENV: 'development', DATABASE_URL: '' })).toBe(false);
  });
});
