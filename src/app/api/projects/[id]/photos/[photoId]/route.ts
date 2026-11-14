import { NextResponse } from 'next/server';
import { getStorage, isValidProjectId, lookupPhoto, readPhoto, removePhoto } from '@/lib/storage';
import { withUnauthorized } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; photoId: string }> };

/**
 * GET /api/projects/[id]/photos/[photoId]
 *
 * Streams a project photo. Photos live in the blob store (disk or GCS), so this
 * is the only way the browser can load them.
 */
async function handleGet(_req: Request, { params }: Ctx): Promise<Response> {
  const { id, photoId } = await params;
  const storage = await getStorage();
  const found = await lookupPhoto(storage, id, photoId);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });

  const bytes = await readPhoto(storage, id, found.photo);
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

/**
 * DELETE /api/projects/[id]/photos/[photoId] — take the photo off the project and delete its file.
 * A direct write like the reference marker (photos aren't part of the undoable plan).
 *   200 { photos } (the remaining ones) · 400 invalid project id · 404 unknown project or photo
 */
async function handleDelete(_req: Request, { params }: Ctx): Promise<Response> {
  const { id, photoId } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 });
  const photos = await removePhoto(await getStorage(), id, photoId);
  if (!photos) return NextResponse.json({ error: 'photo not found' }, { status: 404 });
  return NextResponse.json({ photos });
}

export const GET = withUnauthorized(handleGet);
export const DELETE = withUnauthorized(handleDelete);
