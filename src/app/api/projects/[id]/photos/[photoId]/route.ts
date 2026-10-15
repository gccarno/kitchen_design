import { NextResponse } from 'next/server';
import { fsStorage, lookupPhoto, readPhoto, resolveDataDir } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; photoId: string }> };

/**
 * GET /api/projects/[id]/photos/[photoId]
 *
 * Streams a project photo. Photos live under `data/`, not `public/`, so this
 * is the only way the browser can load them.
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id, photoId } = await params;
  const dataDir = resolveDataDir();
  const found = await lookupPhoto(fsStorage(dataDir), id, photoId);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });

  const bytes = await readPhoto(fsStorage(dataDir), id, found.photo);
  if (!bytes) return NextResponse.json({ error: 'photo file missing' }, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      // Photo ids are never reused, so the bytes behind a URL never change.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
}
