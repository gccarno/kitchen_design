import { describe, it, expect } from 'vitest';
import { isLocalDatabase } from './remote-guard';

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
