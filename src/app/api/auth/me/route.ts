import { disabledResponse, json } from '@/lib/auth/http';
import { tokenFromRequest } from '@/lib/auth/request';
import { userForToken } from '@/lib/auth/users';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const off = disabledResponse();
  if (off) return off;
  const token = tokenFromRequest(req.headers);
  const user = token ? await userForToken(getDb(), token) : null;
  if (!user) return json({ error: 'Not signed in' }, 401);
  return json({ id: user.id, email: user.email }, 200);
}
