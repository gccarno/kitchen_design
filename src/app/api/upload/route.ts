import { NextResponse } from 'next/server';
import { addPhoto, getRequestUserId, getStorage, isValidProjectId, MAX_PHOTOS, ProjectNotFoundError, TooManyPhotosError } from '@/lib/storage';
import { normalizeOrientation, readImageDimensions } from '@/lib/exif';
import { authEnabled } from '@/lib/auth/config';
import { csrfBlocked, csrfRefusedResponse } from '@/lib/auth/csrf';
import { withUnauthorized } from '@/lib/auth/session';
import { MAX_BODY_BYTES, MAX_PHOTO_BYTES } from './limits';

// Disable any caching on this route.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = MAX_PHOTO_BYTES;

const tooManyPhotos = () => NextResponse.json({ error: new TooManyPhotosError().message }, { status: 409 });
const tooLarge = () => NextResponse.json({ error: `file too large (max ${MAX_BYTES / 1024 / 1024}MB)` }, { status: 413 });

/**
 * The request body, read up to MAX_BODY_BYTES; null as soon as it is (or declares itself)
 * larger, without buffering the rest. `req.formData()` would read any size into memory.
 */
async function readCappedBody(req: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

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
  // The proxy skips this route (see its matcher), so check here, before reading the body:
  // a cross-site POST gets 403, and no valid session gets 401 (UnauthorizedError → withUnauthorized).
  if (authEnabled() && csrfBlocked(req.method, '/api/upload', req.headers)) return csrfRefusedResponse();
  await getRequestUserId();

  const bytes = await readCappedBody(req);
  if (!bytes) return tooLarge();
  let formData: FormData;
  try {
    formData = await new Response(bytes, { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
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
  const project = await storage.projects.load(projectId);
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  // Checked again under the project lock (addPhoto); this saves decoding a photo that can't be kept.
  if (project.photos.length >= MAX_PHOTOS) return tooManyPhotos();
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return tooLarge();

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
    if (err instanceof TooManyPhotosError) return tooManyPhotos();
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
