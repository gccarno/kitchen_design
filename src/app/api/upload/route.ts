import { NextResponse } from 'next/server';
import { addPhoto, getRequestUserId, getStorage, isValidProjectId, ProjectNotFoundError } from '@/lib/storage';
import { normalizeOrientation, readImageDimensions } from '@/lib/exif';
import { authEnabled } from '@/lib/auth/config';
import { csrfBlocked, csrfRefusedResponse } from '@/lib/auth/csrf';
import { withUnauthorized } from '@/lib/auth/session';

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
 * project's photos, appends it to `project.photos`, and returns
 * the photo metadata. The reference object is marked afterwards via
 * PUT /api/projects/[id]/photos/[photoId]/reference.
 */
async function handlePost(req: Request): Promise<Response> {
  // The middleware skips this route (see its matcher), so check here, before reading the body:
  // a cross-site POST gets 403, and no valid session gets 401 (UnauthorizedError → withUnauthorized).
  if (authEnabled() && csrfBlocked(req.method, '/api/upload', req.headers)) return csrfRefusedResponse();
  await getRequestUserId();

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
  const storage = await getStorage();
  if (!(await storage.projects.load(projectId))) {
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

  try {
    const photo = await addPhoto(storage, projectId, normalized, dims);
    return NextResponse.json({ photo }, { status: 201 });
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: 'project not found' }, { status: 404 });
    }
    throw err;
  }
}

const authedPost = withUnauthorized(handlePost);

/**
 * One JSON log line per upload (status, declared size, time taken), so a phone
 * report can be matched to the server side. Unhandled errors still reach Sentry
 * through onRequestError (src/instrumentation.ts); this only adds the line.
 */
export async function POST(req: Request): Promise<Response> {
  const started = Date.now();
  const declared = Number(req.headers.get('content-length'));
  const contentLengthKB = Number.isFinite(declared) && declared > 0 ? Math.round(declared / 1024) : null;
  const log = (status: number, errorName?: string) => {
    const line = JSON.stringify({ event: 'upload', status, contentLengthKB, ms: Date.now() - started, ...(errorName ? { errorName } : {}) });
    if (status >= 500) console.error(line);
    else console.info(line);
  };
  try {
    const res = await authedPost(req);
    log(res.status);
    return res;
  } catch (err) {
    log(500, err instanceof Error ? err.name : typeof err);
    throw err;
  }
}
