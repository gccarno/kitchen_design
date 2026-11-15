import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getStorage, isValidProjectId, lookupPhoto, ProjectNotFoundError, readPhoto, removePhoto, updatePhoto } from '@/lib/storage';
import { MAX_PHOTO_LABEL, THUMBNAIL_WIDTH_PX } from '@/lib/storage/limits';
import { withUnauthorized } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; photoId: string }> };

/**
 * GET /api/projects/[id]/photos/[photoId]
 *
 * Streams a project photo. Photos live in the blob store (disk or GCS), so this
 * is the only way the browser can load them. `?w=320` gives the small version the
 * photo grid shows (the only width offered, so the resize can't be used to make work).
 */
async function handleGet(req: Request, { params }: Ctx): Promise<Response> {
  const { id, photoId } = await params;
  const w = new URL(req.url).searchParams.get('w');
  if (w !== null && w !== String(THUMBNAIL_WIDTH_PX)) {
    return NextResponse.json({ error: `w must be ${THUMBNAIL_WIDTH_PX}` }, { status: 400 });
  }
  const storage = await getStorage();
  const found = await lookupPhoto(storage, id, photoId);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });

  const bytes = await readPhoto(storage, id, found.photo);
  if (!bytes) return NextResponse.json({ error: 'photo file missing' }, { status: 404 });
  const out = w === null ? bytes : await sharp(bytes).resize({ width: THUMBNAIL_WIDTH_PX, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
  return new Response(new Uint8Array(out), {
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

/**
 * PATCH /api/projects/[id]/photos/[photoId] — JSON body { label }: the user's words for what the
 * photo shows. Trimmed; empty clears it. A direct write, like the reference marker.
 *   200 { photo } · 400 bad id or body · 404 unknown project or photo
 */
async function handlePatch(req: Request, { params }: Ctx): Promise<Response> {
  const { id, photoId } = await params;
  const storage = await getStorage();
  const found = await lookupPhoto(storage, id, photoId);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });

  const body = (await req.json().catch(() => null)) as { label?: unknown } | null;
  if (!body || typeof body.label !== 'string') return NextResponse.json({ error: 'label must be text' }, { status: 400 });
  const label = body.label.trim();
  if (label.length > MAX_PHOTO_LABEL) {
    return NextResponse.json({ error: `label is too long (max ${MAX_PHOTO_LABEL} characters)` }, { status: 400 });
  }
  try {
    const photo = await updatePhoto(storage, id, photoId, ({ label: _old, ...rest }) => (label ? { ...rest, label } : rest));
    if (!photo) return NextResponse.json({ error: 'photo not found' }, { status: 404 });
    return NextResponse.json({ photo });
  } catch (err) {
    if (err instanceof ProjectNotFoundError) return NextResponse.json({ error: 'project not found' }, { status: 404 });
    throw err;
  }
}

export const GET = withUnauthorized(handleGet);
export const PATCH = withUnauthorized(handlePatch);
export const DELETE = withUnauthorized(handleDelete);
