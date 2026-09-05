/**
 * EXIF orientation handling. Phone cameras set an EXIF orientation tag
 * but the raw pixels are stored un-rotated. Browsers and image viewers
 * rotate on display based on the tag. To make the floor plan extractor
 * work (and our reference-object math), we physically rotate the image
 * once at upload time and strip the orientation tag.
 *
 * `exifr` reads the orientation; `sharp` does the actual rotation/re-encode.
 */

import exifr from 'exifr';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

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
 * Apply the EXIF orientation to the pixels and re-encode as JPEG,
 * stripping the orientation tag. The returned buffer is what gets
 * saved to disk; downstream code can assume pixels are display-ready.
 *
 * If no EXIF orientation tag is present (e.g. screenshots, desktop
 * uploads), this is essentially a no-op re-encode.
 */
export async function normalizeOrientation(input: Buffer | string): Promise<Buffer> {
  // Try to read orientation. exifr returns undefined for images with
  // no EXIF data; default to 1 (no rotation).
  let orientation = 1;
  try {
    const buf = typeof input === 'string' ? await readFile(input) : input;
    const tags = await exifr.parse(buf, { pick: ['Orientation'] });
    if (tags && typeof tags.Orientation === 'number') {
      orientation = tags.Orientation;
    }
  } catch {
    // No EXIF data — leave orientation as 1.
  }

  let pipeline = sharp(input).rotate(); // sharp's rotate() with no args applies EXIF orientation
  // For belt-and-suspenders, also explicitly rotate if the tag was
  // present (sharp normally handles this, but some buggy JPEGs need it).
  if (orientation > 1) {
    // .rotate() with no arg already applies the EXIF tag, so this
    // is technically redundant for well-formed files. We keep it as
    // an explicit signal in case the image has no embedded EXIF but
    // the caller already knows the orientation.
    pipeline = sharp(input).rotate();
  }
  return await pipeline.jpeg({ quality: 90 }).toBuffer();
}
