import { NextResponse } from 'next/server';
import { resolveDataDir, updateProject } from '@/lib/storage/projects';
import { lookupPhoto } from '@/lib/storage/photos';
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
  const dataDir = resolveDataDir();
  const found = lookupPhoto(dataDir, id, photoId);
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

  const photo = await setPhoto(dataDir, id, photoId, (p) => ({ ...p, referenceObject: resolved.value }));
  return NextResponse.json({ photo });
}

/** DELETE .../reference — clear the photo's reference object. */
export async function DELETE(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id, photoId } = await params;
  const dataDir = resolveDataDir();
  const found = lookupPhoto(dataDir, id, photoId);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status });

  const photo = await setPhoto(dataDir, id, photoId, ({ referenceObject: _removed, ...rest }) => rest);
  return NextResponse.json({ photo });
}

async function setPhoto(
  dataDir: string,
  projectId: string,
  photoId: string,
  change: (p: Photo) => Photo
): Promise<Photo | undefined> {
  const project = await updateProject(dataDir, projectId, (p) => ({
    ...p,
    photos: p.photos.map((ph) => (ph.id === photoId ? change(ph) : ph)),
    updatedAt: new Date().toISOString(),
  }));
  return project.photos.find((ph) => ph.id === photoId);
}
