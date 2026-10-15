import { clearedSessionCookie } from '@/lib/auth/cookies';
import { disabledResponse, jsonContentTypeGuard } from '@/lib/auth/http';
import { tokensFromRequest } from '@/lib/auth/request';
import { revokeToken } from '@/lib/auth/users';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const off = disabledResponse() ?? jsonContentTypeGuard(req);
  if (off) return off;
  const db = getDb();
  for (const token of tokensFromRequest(req.headers)) await revokeToken(db, token);
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearedSessionCookie(), 'Cache-Control': 'no-store' },
  });
}
