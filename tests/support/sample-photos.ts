/**
 * Sample photos for tests: a sample kitchen built from its commands, and
 * pictures of it from each corner as JPEGs, the way a phone would hand them
 * over (optionally large, or held sideways with an EXIF orientation).
 */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Catalog } from '@/lib/catalog/loader';
import { compileCommands } from '@/lib/plan/commands';
import { cornerViews, renderRoomPhoto, type Camera } from '@/lib/plan/room-photo';
import type { Project } from '@/lib/plan/schemas';
import type { KitchenExample } from './sample-kitchens';

/** The example as a project, without going through storage. */
export function buildExample(example: KitchenExample, catalog: Catalog): Project {
  const empty: Project = {
    id: randomUUID(),
    name: example.name,
    kind: 'kitchen',
    units: 'mm',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0,
    photos: [],
    room: { polygon: example.room, walls: example.room.map(() => ({ id: randomUUID(), thicknessMm: 100 })), openings: [] },
    items: [],
    history: [],
  };
  return compileCommands(empty, example.commands, catalog, randomUUID).project;
}

export interface PhotoOptions {
  width?: number;
  height?: number;
  /**
   * EXIF orientation to store the picture with. 6 is a phone held upright: the
   * pixels are saved on their side and the tag says to turn them.
   */
  orientation?: 6;
}

export async function photoJpeg(project: Project, camera: Camera, options: PhotoOptions = {}): Promise<Buffer> {
  const { width = 1024, height = 768, orientation } = options;
  const photo = renderRoomPhoto(project, camera, { width, height });
  let image = sharp(Buffer.from(photo.rgb), { raw: { width, height, channels: 3 } });
  if (orientation === 6) {
    // Turn the pixels a quarter turn back, so that applying the tag gives the picture as rendered.
    image = sharp(await image.rotate(270).raw().toBuffer(), { raw: { width: height, height: width, channels: 3 } }).withMetadata({ orientation: 6 });
  }
  return image.jpeg({ quality: 88 }).toBuffer();
}

/** One photo from each corner of the room. */
export function cornerPhotos(project: Project, options: PhotoOptions = {}): Promise<Buffer[]> {
  return Promise.all(cornerViews(project).map((camera) => photoJpeg(project, camera, options)));
}
