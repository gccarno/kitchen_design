import { describe, it, expect } from 'vitest';
import { tokenFromRequest } from './request';

const h = (init: Record<string, string>) => new Headers(init);

describe('tokenFromRequest', () => {
  it('reads a Bearer token', () => {
    expect(tokenFromRequest(h({ authorization: 'Bearer abc_-123' }))).toBe('abc_-123');
  });
  it('reads the session cookie among others', () => {
    expect(tokenFromRequest(h({ cookie: 'a=1; session=tok; b=2' }))).toBe('tok');
  });
  it('prefers Bearer over the cookie', () => {
    expect(tokenFromRequest(h({ authorization: 'Bearer one', cookie: 'session=two' }))).toBe('one');
  });
  it('ignores non-Bearer auth and falls back to the cookie', () => {
    expect(tokenFromRequest(h({ authorization: 'Basic xyz', cookie: 'session=two' }))).toBe('two');
  });
  it('returns null when absent or empty', () => {
    expect(tokenFromRequest(h({}))).toBeNull();
    expect(tokenFromRequest(h({ cookie: 'session=; other=1' }))).toBeNull();
    expect(tokenFromRequest(h({ cookie: 'xsession=nope' }))).toBeNull();
    expect(tokenFromRequest(h({ authorization: 'Bearer ' }))).toBeNull();
  });
});
