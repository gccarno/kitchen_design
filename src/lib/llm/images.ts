import sharp from 'sharp';
import type { ImageAttachment } from './provider';

/**
 * Long-edge cap for images sent to a vision model. Larger images cost more
 * tokens without helping (providers downsample to about this size anyway),
 * and phone photos can be 20 MB.
 */
export const VISION_MAX_EDGE_PX = 1568;

export interface VisionImage {
  image: ImageAttachment;
  width: number;
  height: number;
  /** Output size ÷ original size (≤ 1). Multiply original pixel coords by this. */
  scale: number;
}

/** Downscale a stored (EXIF-normalized) photo for a vision request. */
export async function prepareVisionImage(photo: Buffer): Promise<VisionImage> {
  const meta = await sharp(photo).metadata();
  if (!meta.width || !meta.height) throw new Error('could not read image dimensions');
  const scale = Math.min(1, VISION_MAX_EDGE_PX / Math.max(meta.width, meta.height));
  const width = Math.round(meta.width * scale);
  const height = Math.round(meta.height * scale);
  const out = scale < 1 ? await sharp(photo).resize(width, height).jpeg({ quality: 85 }).toBuffer() : photo;
  return { image: { mime: 'image/jpeg', dataBase64: out.toString('base64') }, width, height, scale };
}
