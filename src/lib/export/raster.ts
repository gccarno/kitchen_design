/**
 * Rasterize our SVG drawings to PNG at an exact pixel size. Server-only (sharp is native).
 *
 * The drawings declare a physical size (mm at 1:SVG_SCALE). Rendering those through sharp's
 * `density` is fragile: librsvg 2.6x (sharp 0.35) scales physical units by density² / 72, so a
 * 508 dpi request came out ~7× too large. Instead the root's width and height are set to the
 * target size in pixels and rendered at 72 dpi, where one SVG pixel is one image pixel in every
 * librsvg version.
 */
import sharp from 'sharp';
import { svgViewBoxSize } from './paper';

const ROOT_SIZE = /^(<svg\b[^>]*?\s)width="[^"]*"(\s[^>]*?)?\sheight="[^"]*"/;

/** The SVG with its root width/height replaced by plain pixel values. */
export function withPixelSize(svg: string, widthPx: number, heightPx: number): string {
  if (!ROOT_SIZE.test(svg)) throw new Error('drawing has no root width and height');
  return svg.replace(ROOT_SIZE, (_m, head: string, mid = '') => `${head}width="${widthPx}"${mid} height="${heightPx}"`);
}

/** A PNG of the drawing `widthPx` wide (height follows the viewBox), on white. */
export function rasterizeSvg(svg: string, widthPx: number): Promise<Buffer> {
  const box = svgViewBoxSize(svg);
  const w = Math.max(1, Math.round(widthPx));
  const h = Math.max(1, Math.round((widthPx * box.h) / box.w));
  return sharp(Buffer.from(withPixelSize(svg, w, h)), { density: 72 })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
}
