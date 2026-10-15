import { describe, it, expect } from 'vitest';
import { clearedSessionCookie, sessionCookie } from './cookies';

const dev = { NODE_ENV: 'development' } as unknown as NodeJS.ProcessEnv;
const prod = { NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv;

describe('session cookies', () => {
  it('sets HttpOnly, SameSite=Lax, Path=/, one-year Max-Age', () => {
    const c = sessionCookie('tok', dev);
    expect(c).toContain('session=tok');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain('Max-Age=31536000');
    expect(c).not.toContain('Secure');
  });
  it('adds Secure in production', () => {
    expect(sessionCookie('tok', prod)).toContain('; Secure');
    expect(clearedSessionCookie(prod)).toContain('; Secure');
  });
  it('clears with Max-Age=0 and an empty value', () => {
    const c = clearedSessionCookie(dev);
    expect(c).toMatch(/^session=;/);
    expect(c).toContain('Max-Age=0');
    expect(c).toContain('HttpOnly');
  });
});
