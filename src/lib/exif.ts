/**
 * EXIF orientation handling. Phone cameras set an EXIF orientation tag
 * but the raw pixels are stored un-rotated. Browsers and image viewers
 * rotate on display based on the tag. To make the floor plan extractor
 * work (and our reference-object math), we physically rotate the image
 * once at upload time and strip the orientation tag (sharp does both).
 */

import sharp from 'sharp';
import { STORED_MAX_EDGE_PX } from './storage/limits';

export { STORED_MAX_EDGE_PX };

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Read just the image dimensions from a JPEG/PNG. Accepts a Buffer
 * (raw bytes) or a string (file path).
 */
export async function readImageDimensions(input: Buffer | string): Promise<ImageDimensions> {
  const meta = await sharp(input).metadata();
  const w = meta.width;
  const h = meta.height;
  if (w == null || h == null) {
    throw new Error('Could not read image dimensions');
  }
  return { width: w, height: h };
}


/**
 * Apply the EXIF orientation to the pixels (sharp's `rotate()` with no angle reads the tag and
 * drops it), shrink to STORED_MAX_EDGE_PX on the long edge, and re-encode as JPEG. The result is
 * what gets stored; downstream code can assume pixels are display-ready. Rejects bytes sharp
 * can't decode.
 */
export async function normalizeOrientation(input: Buffer | string): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width: STORED_MAX_EDGE_PX, height: STORED_MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}
