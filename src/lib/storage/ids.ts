/**
 * Ids and blob keys. Every storage path or object key is built here, so a
 * request-supplied id is validated before it can name anything.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown for any project id that is not a UUID — the path-traversal guard. */
export class InvalidProjectIdError extends Error {
  constructor(id: string) {
    super(`invalid project id: ${JSON.stringify(id)}`);
    this.name = 'InvalidProjectIdError';
  }
}

export function isValidProjectId(id: string): boolean {
  return UUID_RE.test(id);
}

/** Photo ids we generate; anything else in a hand-edited project could name a file elsewhere. */
export const PHOTO_ID = /^[A-Za-z0-9_-]+$/;

/** `projects/<id>/` — every blob of a project lives under this prefix. The trailing slash keeps one id from matching another that starts with it. */
export function projectPrefix(projectId: string): string {
  if (!isValidProjectId(projectId)) throw new InvalidProjectIdError(projectId);
  return `projects/${projectId}/`;
}

/** `projects/<id>/photos/<photoId>.jpg` — built from the ids, never from a stored path. */
export function photoKey(projectId: string, photoId: string): string {
  if (!PHOTO_ID.test(photoId)) throw new Error('invalid photo id');
  return `${projectPrefix(projectId)}photos/${photoId}.jpg`;
}
