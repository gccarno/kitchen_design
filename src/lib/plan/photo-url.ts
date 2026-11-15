import { THUMBNAIL_WIDTH_PX } from '../storage/limits';

/** Where the browser loads a project photo from: the stored photo, or the small version for grids. */
export function photoUrl(projectId: string, photoId: string, size: 'full' | 'thumb' = 'full'): string {
  const url = `/api/projects/${projectId}/photos/${photoId}`;
  return size === 'thumb' ? `${url}?w=${THUMBNAIL_WIDTH_PX}` : url;
}
