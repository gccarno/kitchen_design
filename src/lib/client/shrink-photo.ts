import { STORED_MAX_EDGE_PX } from '@/lib/storage/limits';

/** `width` × `height` scaled to fit a `maxEdge` long edge, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

type Encode = (file: Blob, maxEdge: number) => Promise<Blob>;

/** Decode with the EXIF orientation applied, draw at the capped size, re-encode as JPEG. */
async function encodeInBrowser(file: Blob, maxEdge: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode'))), 'image/jpeg', 0.9)
    );
  } finally {
    bitmap.close();
  }
}

/**
 * A phone photo shrunk to the size the server stores anyway (see `normalizeOrientation`), so
 * megabytes aren't uploaded only to be thrown away. Best-effort: whatever the browser can't
 * decode (HEIC outside Safari) or can't make smaller is sent as it is, and the server handles it.
 */
export async function shrinkPhoto(file: Blob, encode: Encode = encodeInBrowser): Promise<Blob> {
  try {
    const out = await encode(file, STORED_MAX_EDGE_PX);
    return out.size > 0 && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}
