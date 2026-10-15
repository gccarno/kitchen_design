/**
 * The one entry point app code uses for storage: `await getStorage()` per
 * request. Phase 1 is always the disk; Task 72 adds Postgres and GCS.
 */
import { FsBlobStore } from './fs-blobs';
import { FsProjectStore } from './fs-projects';
import { resolveDataDir } from './projects';
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

/** The storage for this request. Cheap; don't cache it across requests. */
export async function getStorage(): Promise<Storage> {
  return fsStorage(resolveDataDir());
}
