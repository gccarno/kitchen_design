import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { prepareVisionImage, VISION_MAX_EDGE_PX } from './images';

const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 9, g: 9, b: 9 } } }).jpeg().toBuffer();

describe('prepareVisionImage', () => {
  it(`downscales a large landscape photo to a ${VISION_MAX_EDGE_PX}px long edge`, async () => {
    const out = await prepareVisionImage(await jpeg(4000, 3000));
    expect(out.width).toBe(VISION_MAX_EDGE_PX);
    expect(out.height).toBe(1176);
    expect(out.scale).toBeCloseTo(VISION_MAX_EDGE_PX / 4000);
    const meta = await sharp(Buffer.from(out.image.dataBase64, 'base64')).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', VISION_MAX_EDGE_PX, 1176]);
    expect(out.image.mime).toBe('image/jpeg');
  });

  it('uses the long edge for portrait photos', async () => {
    const out = await prepareVisionImage(await jpeg(3000, 4000));
    expect([out.width, out.height]).toEqual([1176, VISION_MAX_EDGE_PX]);
  });

  it('leaves small photos at scale 1', async () => {
    const out = await prepareVisionImage(await jpeg(800, 600));
    expect(out.scale).toBe(1);
    expect([out.width, out.height]).toEqual([800, 600]);
  });
});
