/**
 * The one entry point app code uses for storage: `await getStorage()` per
 * request. Disk by default; Postgres when DATABASE_URL is set, GCS when
 * GCS_BUCKET is set.
 */
import { authEnabled } from '../auth/config';
import { FsBlobStore } from './fs-blobs';
import { FsProjectStore } from './fs-projects';
import { resolveDataDir } from './projects';
import type { GcsBlobStore } from './gcs-blobs';
import type { Storage } from './store';

export * from './service';
export * from './store';
export { InvalidProjectIdError, isValidProjectId, PHOTO_ID } from './ids';
export { newProject } from '../plan/new-project';
export { resolveDataDir } from './projects';

/** Projects and blobs both on disk under `dataDir`. */
export function fsStorage(dataDir: string): Storage {
  return { projects: new FsProjectStore(dataDir), blobs: new FsBlobStore(dataDir) };
}

const gcsStores = new Map<string, Promise<GcsBlobStore>>();

/**
 * The storage for this request. Disk under DATA_DIR when DATABASE_URL is
 * unset (no auth, single user — exactly as before). With DATABASE_URL set,
 * auth is on: the request's session token (Bearer or cookie) is validated
 * here, and the projects are the signed-in user's own; throws
 * UnauthorizedError when there is no valid token. Nothing a client sends
 * other than that token (e.g. an `x-user-id` header) is ever trusted.
 * Cheap — the database pool and GCS clients are shared — so don't cache the result.
 */
export async function getStorage(): Promise<Storage> {
  return (await getRequestStorage()).storage;
}

/**
 * getStorage() plus the validated user's id (null in disk mode), for routes
 * that also open the user's job store. Same rules: throws UnauthorizedError
 * without a valid token.
 */
export async function getRequestStorage(): Promise<{ storage: Storage; userId: string | null }> {
  if (!authEnabled()) return { storage: await getStorageFor(null), userId: null };
  const { requireUser } = await import('../auth/session');
  const userId = (await requireUser()).id;
  return { storage: await getStorageFor(userId), userId };
}

/**
 * Storage for `userId` without looking at any request: for scripts and tests.
 * With DATABASE_URL set, projects are scoped to that owner (null = the
 * owner-less rows `import:local` creates); on disk the owner is ignored.
 * App code must use getStorage(), which takes the user from a validated token.
 * GCS_BUCKET selects GCS for blobs (blob keys are per project; access to them
 * goes through the owner-scoped project lookup).
 */
export async function getStorageFor(userId: string | null): Promise<Storage> {
  const dataDir = resolveDataDir();
  const projects = authEnabled()
    ? new (await import('./pg-projects')).PgProjectStore((await import('../db/client')).getDb(), userId)
    : new FsProjectStore(dataDir);
  let blobs: Storage['blobs'];
  const bucket = process.env.GCS_BUCKET;
  if (bucket) {
    const prefix = process.env.GCS_PREFIX ?? '';
    const key = `${bucket}
${prefix}`;
    if (!gcsStores.has(key)) {
      gcsStores.set(key, import('./gcs-blobs').then((m) => m.gcsBlobStore(bucket, prefix)));
    }
    blobs = await gcsStores.get(key)!;
  } else {
    blobs = new FsBlobStore(dataDir);
  }
  return { projects, blobs };
}
