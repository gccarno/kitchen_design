/**
 * EXIF orientation handling. Phone cameras set an EXIF orientation tag
 * but the raw pixels are stored un-rotated. Browsers and image viewers
 * rotate on display based on the tag. To make the floor plan extractor
 * work (and our reference-object math), we physically rotate the image
 * once at upload time and strip the orientation tag (sharp does both).
 */

import sharp from 'sharp';

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
 * Long-edge cap for stored photos. Phone photos are 4000+ px and several MB; the editor shows them
 * as thumbnails, the vision model gets 1568 px (llm/images.ts), and the offline cache keeps up to
 * 300 of them. This leaves room to zoom while marking a reference object.
 */
export const STORED_MAX_EDGE_PX = 2560;

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
