import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

function derive(pw: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pw, salt, keylen, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** `scrypt$N$r$p$saltB64$hashB64` */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(pw, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** False (never throws) for a wrong password or a malformed stored value. */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [n, r, p] = [parts[1], parts[2], parts[3]].map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
    // Only accept our own parameters, so a tampered row can't demand huge memory.
    if (n !== N || r !== R || p !== P) return false;
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || expected.length !== KEYLEN) return false;
    const actual = await derive(pw, salt, n, r, p, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** A valid hash of a random secret, used to equalize timing when the email is unknown. */
export const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${Buffer.alloc(SALT_BYTES, 1).toString('base64')}$${Buffer.alloc(KEYLEN, 2).toString('base64')}`;
