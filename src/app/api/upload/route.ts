import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isValidProjectId,
  projectDir,
  projectExists,
  resolveDataDir,
  updateProject,
} from '@/lib/storage/projects';
import { normalizeOrientation, readImageDimensions } from '@/lib/exif';
import type { Photo } from '@/lib/plan/schemas';

// Disable any caching on this route.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB per photo

/**
 * POST /api/upload
 *
 * multipart/form-data fields:
 *   - projectId: string (UUID of an existing project)
 *   - file: the image (jpeg/png/webp/heic — anything sharp can decode)
 *
 * Saves the photo (EXIF orientation applied, re-encoded as JPEG) into the
 * project's photos/ directory, appends it to `project.photos`, and returns
 * the photo metadata. The reference object is marked afterwards via
 * PUT /api/projects/[id]/photos/[photoId]/reference.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 });
  }

  const projectId = formData.get('projectId');
  const file = formData.get('file');
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  if (!isValidProjectId(projectId)) {
    return NextResponse.json({ error: 'invalid projectId' }, { status: 400 });
  }
  const dataDir = resolveDataDir();
  if (!projectExists(dataDir, projectId)) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_BYTES / 1024 / 1024}MB)` },
      { status: 413 }
    );
  }

  // Normalize EXIF orientation; this also rejects bytes sharp can't decode.
  let normalized: Buffer;
  let dims: { width: number; height: number };
  try {
    normalized = await normalizeOrientation(Buffer.from(await file.arrayBuffer()));
    dims = await readImageDimensions(normalized);
  } catch {
    return NextResponse.json({ error: 'file is not a readable image' }, { status: 400 });
  }

  const photoId = randomUUID();
  const photo: Photo = {
    id: photoId,
    path: `photos/${photoId}.jpg`,
    width: dims.width,
    height: dims.height,
  };
  const outPath = join(projectDir(dataDir, projectId), photo.path);
  await mkdir(join(projectDir(dataDir, projectId), 'photos'), { recursive: true });
  await writeFile(outPath, normalized);

  try {
    await updateProject(dataDir, projectId, (p) => ({
      ...p,
      photos: [...p.photos, photo],
      updatedAt: new Date().toISOString(),
    }));
  } catch (err) {
    // Don't leave an orphaned file the project doesn't know about.
    await unlink(outPath).catch(() => undefined);
    throw err;
  }

  return NextResponse.json({ photo }, { status: 201 });
}
