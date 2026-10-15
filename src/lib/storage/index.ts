/**
 * The one entry point app code uses for storage: `await getStorage()` per
 * request. Disk by default; Postgres when DATABASE_URL is set, GCS when
 * GCS_BUCKET is set.
 */
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
 * The storage for this request: Postgres when DATABASE_URL is set, GCS when
 * GCS_BUCKET is set, the disk under DATA_DIR otherwise (each independently).
 * Cheap — the database pool and GCS clients are shared — so don't cache the result.
 */
export async function getStorage(): Promise<Storage> {
  const dataDir = resolveDataDir();
  const projects = process.env.DATABASE_URL
    ? new (await import('./pg-projects')).PgProjectStore((await import('../db/client')).getDb())
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
