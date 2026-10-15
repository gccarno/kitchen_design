import { NextResponse } from 'next/server';
import { getStorage, lookupPhoto, ProjectNotFoundError, type Storage } from '@/lib/storage';
import { ReferenceInputSchema, resolveReference } from '@/lib/plan/reference-objects';
import type { Photo } from '@/lib/plan/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; photoId: string }> };

/**
 * PUT /api/projects/[id]/photos/[photoId]/reference
 *
 * JSON body: { kind, side, customSizeMm?, pixelBox: [x1, y1, x2, y2] } with
 * pixelBox in natural image pixels. The server resolves the known size from
 * `reference-objects.ts`, so clients never send (or disagree on) sizes.
 * Responds with the updated photo.
 *
 * Photos aren't part of the editable plan, so this is a direct write rather
 * than a JSON-Patch revision.
 */
export async function PUT(req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id, photoId } = await params;
  const storage = await getStorage();
  const found = await lookupPhoto(storage, id, photoId);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }
  const input = ReferenceInputSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: input.error.issues.map((i) => i.message).join('; ') }, { status: 400 });
  }
  const resolved = resolveReference(input.data, found.photo);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.issues.join('; ') }, { status: 400 });
  }

  try {
    const photo = await setPhoto(storage, id, photoId, (p) => ({ ...p, referenceObject: resolved.value }));
    return NextResponse.json({ photo });
  } catch (err) {
    if (err instanceof ProjectNotFoundError) return NextResponse.json({ error: 'project not found' }, { status: 404 });
    throw err;
  }
}

/** DELETE .../reference — clear the photo's reference object. */
export async function DELETE(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id, photoId } = await params;
  const storage = await getStorage();
  const found = await lookupPhoto(storage, id, photoId);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });

  try {
    const photo = await setPhoto(storage, id, photoId, ({ referenceObject: _removed, ...rest }) => rest);
    return NextResponse.json({ photo });
  } catch (err) {
    if (err instanceof ProjectNotFoundError) return NextResponse.json({ error: 'project not found' }, { status: 404 });
    throw err;
  }
}

async function setPhoto(
  storage: Storage,
  projectId: string,
  photoId: string,
  change: (p: Photo) => Photo
): Promise<Photo | undefined> {
  const project = await storage.projects.update(projectId, (p) => ({
    ...p,
    photos: p.photos.map((ph) => (ph.id === photoId ? change(ph) : ph)),
    updatedAt: new Date().toISOString(),
  }));
  return project.photos.find((ph) => ph.id === photoId);
}
