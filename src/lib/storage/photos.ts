import { join } from 'node:path';
import type { Photo, Project } from '../plan/schemas';
import { isValidProjectId, loadProject, projectDir, projectExists } from './projects';

export type PhotoLookup =
  | { ok: true; project: Project; photo: Photo }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Resolve a (projectId, photoId) pair from a request. Only photos listed on
 * the project are found, so a crafted `photoId` can never name another file.
 */
export function lookupPhoto(dataDir: string, projectId: string, photoId: string): PhotoLookup {
  if (!isValidProjectId(projectId)) return { ok: false, status: 400, error: 'invalid project id' };
  if (!projectExists(dataDir, projectId)) return { ok: false, status: 404, error: 'project not found' };
  const project = loadProject(dataDir, projectId);
  const photo = project.photos.find((p) => p.id === photoId);
  if (!photo) return { ok: false, status: 404, error: 'photo not found' };
  return { ok: true, project, photo };
}

/** Absolute path of a photo's JPEG on disk. */
export function photoFilePath(dataDir: string, projectId: string, photo: Photo): string {
  // Built from the id we generated rather than the stored `path`, so the
  // file location can't be redirected by editing project.json.
  return join(projectDir(dataDir, projectId), 'photos', `${photo.id}.jpg`);
}
