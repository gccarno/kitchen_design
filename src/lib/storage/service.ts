/**
 * Storage operations that span project records and blobs. Backend-agnostic:
 * they work on any `Storage`, so the routes behave the same on disk and in
 * the cloud.
 */
import { randomUUID } from 'node:crypto';
import { groupName, nextOptionName, optionGroupId, sortGroup } from '../plan/options';
import { ProjectSchema, type Photo, type Project } from '../plan/schemas';
import { isValidProjectId, PHOTO_ID, photoKey, projectPrefix } from './ids';
import { reportError } from '../monitoring';
import { ProjectNotFoundError, type Storage } from './store';

import { MAX_PHOTOS } from './limits';

export { MAX_PHOTOS };

export class TooManyPhotosError extends Error {
  constructor() {
    super(`a project can have at most ${MAX_PHOTOS} photos; remove one first`);
    this.name = 'TooManyPhotosError';
  }
}

/**
 * Blobs that should have been deleted but could not be (the record is already gone or changed).
 * Not fatal for the request; logged with the project so they can be cleaned up by hand.
 */
function reportOrphanedBlobs(projectId: string, what: string, err: unknown): void {
  const errorName = err instanceof Error ? err.name : typeof err;
  console.error(JSON.stringify({ event: 'orphaned_blobs', projectId, what, errorName }));
  reportError(err, { event: 'orphaned_blobs', projectId, what });
}

/** The projects in option group `groupId`: the original first (if it still exists), then its options oldest first. */
export async function optionGroup(storage: Storage, groupId: string): Promise<Project[]> {
  if (!isValidProjectId(groupId)) return [];
  return sortGroup(await storage.projects.group(groupId), groupId);
}

/**
 * Copy a project as a new design option: a new id and a fresh history,
 * linked to its group's original by `optionOf`, named "<group> — Option <L>",
 * with its photos copied. The source is not changed. Null for an unknown source.
 * `items`, when given, replace the source's items on the copy (a suggested layout).
 */
export async function duplicateAsOption(storage: Storage, sourceId: string, items?: Project['items']): Promise<Project | null> {
  const source = await storage.projects.load(sourceId);
  if (!source) return null;
  const groupId = optionGroupId(source);
  const group = await optionGroup(storage, groupId);
  const now = new Date().toISOString();
  const id = randomUUID();
  const { history: _history, ...rest } = source;
  const photos = source.photos.filter((photo) => PHOTO_ID.test(photo.id));
  const copy: Project = ProjectSchema.parse({
    ...rest,
    ...(items ? { items } : {}),
    photos,
    id,
    name: nextOptionName(groupName(group), group.map((p) => p.name)),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    optionOf: groupId,
    history: [],
  });
  // A listed photo whose file is missing is still listed on the copy, as before.
  try {
    for (const photo of photos) await storage.blobs.copy(photoKey(source.id, photo.id), photoKey(id, photo.id));
    await storage.projects.insert(copy);
  } catch (err) {
    // No record points at the copied photos: remove them again.
    await storage.blobs.deletePrefix(projectPrefix(id)).catch((cleanupErr: unknown) => reportOrphanedBlobs(id, 'failed duplicate', cleanupErr));
    throw err;
  }
  return copy;
}

/** Delete a project and all its blobs. Permanent: there is no trash. False if it didn't exist. */
export async function deleteProject(storage: Storage, id: string): Promise<boolean> {
  if (!isValidProjectId(id)) return false;
  const removed = await storage.projects.remove(id);
  // The project is gone either way; photos left behind are reported rather than failing the delete.
  if (removed) await storage.blobs.deletePrefix(projectPrefix(id)).catch((err: unknown) => reportOrphanedBlobs(id, 'deleted project', err));
  return removed;
}

export type PhotoLookup =
  | { ok: true; project: Project; photo: Photo }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Resolve a (projectId, photoId) pair from a request. Only photos listed on
 * the project are found, so a crafted `photoId` can never name another blob.
 */
export async function lookupPhoto(storage: Storage, projectId: string, photoId: string): Promise<PhotoLookup> {
  if (!isValidProjectId(projectId)) return { ok: false, status: 400, error: 'invalid project id' };
  const project = await storage.projects.load(projectId);
  if (!project) return { ok: false, status: 404, error: 'project not found' };
  const photo = project.photos.find((p) => p.id === photoId);
  // A listed photo with an id we couldn't have generated (hand-edited project) is treated as absent.
  if (!photo || !PHOTO_ID.test(photo.id)) return { ok: false, status: 404, error: 'photo not found' };
  return { ok: true, project, photo };
}

/** A photo's JPEG bytes, or null if the blob is missing. Throws for a photo id we didn't generate. */
export function readPhoto(storage: Storage, projectId: string, photo: Photo): Promise<Buffer | null> {
  return storage.blobs.get(photoKey(projectId, photo.id));
}

/**
 * Store a (normalized) JPEG and append it to `project.photos`. If the
 * project update fails, the blob is deleted again so no orphan is left.
 */
export async function addPhoto(
  storage: Storage,
  projectId: string,
  jpeg: Buffer,
  dims: { width: number; height: number }
): Promise<Photo> {
  const id = randomUUID();
  const photo: Photo = { id, path: `photos/${id}.jpg`, width: dims.width, height: dims.height };
  const key = photoKey(projectId, id);
  await storage.blobs.put(key, jpeg, 'image/jpeg');
  try {
    await storage.projects.update(projectId, (p) => {
      // Checked under the project lock, so parallel uploads can't overshoot.
      if (p.photos.length >= MAX_PHOTOS) throw new TooManyPhotosError();
      return { ...p, photos: [...p.photos, photo], updatedAt: new Date().toISOString() };
    });
  } catch (err) {
    await storage.blobs.delete(key).catch(() => undefined);
    throw err;
  }
  return photo;
}

/**
 * Take a photo off the project, then delete its bytes. Resolves to the project's remaining
 * photos, or null when the project or the photo (one we generated) isn't there.
 */
export async function removePhoto(storage: Storage, projectId: string, photoId: string): Promise<Photo[] | null> {
  if (!isValidProjectId(projectId) || !PHOTO_ID.test(photoId)) return null;
  let found = false;
  let photos: Photo[];
  try {
    const next = await storage.projects.update(projectId, (p) => {
      found = p.photos.some((ph) => ph.id === photoId);
      if (!found) return p;
      return { ...p, photos: p.photos.filter((ph) => ph.id !== photoId), updatedAt: new Date().toISOString() };
    });
    photos = next.photos;
  } catch (err) {
    if (err instanceof ProjectNotFoundError) return null;
    throw err;
  }
  if (!found) return null;
  await storage.blobs.delete(photoKey(projectId, photoId)).catch((err: unknown) => reportOrphanedBlobs(projectId, 'removed photo', err));
  return photos;
}
