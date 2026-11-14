// @vitest-environment node
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { rasterizeSvg, withPixelSize } from './raster';

const svg = (w: string, h: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 2500" width="${w}" height="${h}" font-family="x"><rect width="5000" height="2500" fill="red"/></svg>`;

describe('withPixelSize', () => {
  it('replaces the root width and height, and nothing else', () => {
    expect(withPixelSize(svg('100mm', '50mm'), 1000, 500)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 2500" width="1000" height="500" font-family="x"><rect width="5000" height="2500" fill="red"/></svg>'
    );
  });

  it('refuses an SVG without a root width and height', () => {
    expect(() => withPixelSize('<svg viewBox="0 0 1 1"></svg>', 10, 10)).toThrow(/width/);
  });
});

describe('rasterizeSvg', () => {
  // librsvg changed how density scales physical units (sharp 0.35 squares it); the
  // output size must not depend on that.
  it('renders at exactly the asked pixel size, flattened on white', async () => {
    for (const [w, h] of [
      [1000, 500],
      [2000, 1000],
      [283, 142],
    ]) {
      const meta = await sharp(await rasterizeSvg(svg('100mm', '50mm'), w)).metadata();
      expect({ w: meta.width, h: meta.height, format: meta.format, alpha: meta.hasAlpha }).toEqual({ w, h, format: 'png', alpha: false });
    }
  });
});
