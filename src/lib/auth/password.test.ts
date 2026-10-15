// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('round-trips and uses the documented format', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
  });
  it('rejects a wrong password', async () => {
    const h = await hashPassword('correct horse battery');
    expect(await verifyPassword('wrong password!!', h)).toBe(false);
  });
  it('returns false for malformed stored values', async () => {
    for (const s of ['', 'nope', 'scrypt$x$8$1$aa$bb', 'scrypt$16384$8$1$aa', 'bcrypt$16384$8$1$aa$bb', 'scrypt$16384$8$1$$']) {
      expect(await verifyPassword('whatever-long', s)).toBe(false);
    }
  });
  it('salts: two hashes of one password differ', async () => {
    expect(await hashPassword('same password 1')).not.toBe(await hashPassword('same password 1'));
  });
  it('DUMMY_HASH is valid but matches nothing useful', async () => {
    expect(await verifyPassword('anything-at-all', DUMMY_HASH)).toBe(false);
    expect(DUMMY_HASH.split('$')).toHaveLength(6);
  });
});
