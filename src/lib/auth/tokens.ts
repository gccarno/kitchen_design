import { createHash, randomBytes } from 'node:crypto';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A fresh session token (base64url, 32 random bytes) and the digest to store. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
