import { sql } from 'drizzle-orm';
import { authEnabled } from '@/lib/auth/config';
import { json } from '@/lib/auth/http';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (authEnabled()) {
    try {
      await getDb().execute(sql`select 1`);
    } catch {
      return json({ ok: false }, 503);
    }
  }
  return json({ ok: true }, 200);
}
