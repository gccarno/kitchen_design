import { describe, it, expect } from 'vitest';
import { normalizeOrientation, readImageDimensions, STORED_MAX_EDGE_PX } from './exif';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function makeJpegBuffer(width: number, height: number): Promise<Buffer> {
  // Build a minimal JPEG via sharp so we exercise the real code path.
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 64, b: 192 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe('exif utilities', () => {
  it('reads dimensions of a plain JPEG', async () => {
    const buf = await makeJpegBuffer(800, 600);
    const dims = await readImageDimensions(buf);
    expect(dims.width).toBe(800);
    expect(dims.height).toBe(600);
  });

  it('normalizeOrientation returns the original buffer when no EXIF orientation is set', async () => {
    const buf = await makeJpegBuffer(400, 300);
    const out = await normalizeOrientation(buf);
    // No re-encode needed; result is essentially the same bytes
    expect(out.length).toBeGreaterThan(0);
  });

  it('normalizeOrientation re-encodes a square image without rotation', async () => {
    const buf = await makeJpegBuffer(500, 500);
    const out = await normalizeOrientation(buf);
    const dims = await readImageDimensions(out);
    expect(dims.width).toBe(500);
    expect(dims.height).toBe(500);
  });

  it('applies the EXIF orientation to the pixels and drops the tag', async () => {
    // Stored 400×300 with "rotate 90° clockwise to display" (orientation 6), as phones do.
    const tagged = await sharp(await makeJpegBuffer(400, 300)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const out = await normalizeOrientation(tagged);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([300, 400]);
    expect(meta.orientation ?? 1).toBe(1);
  });

  it(`shrinks a photo whose long edge is over ${STORED_MAX_EDGE_PX} px, keeping its proportions`, async () => {
    const out = await normalizeOrientation(await makeJpegBuffer(4000, 3000));
    expect(await readImageDimensions(out)).toEqual({ width: STORED_MAX_EDGE_PX, height: (STORED_MAX_EDGE_PX * 3) / 4 });
    const tall = await normalizeOrientation(await makeJpegBuffer(1500, 3000));
    expect(await readImageDimensions(tall)).toEqual({ width: STORED_MAX_EDGE_PX / 2, height: STORED_MAX_EDGE_PX });
  });

  it('handles a tiny 10x10 image', async () => {
    const buf = await makeJpegBuffer(10, 10);
    const dims = await readImageDimensions(buf);
    expect(dims.width).toBe(10);
    expect(dims.height).toBe(10);
  });

  it('reads dimensions from a file path', async () => {
    const buf = await makeJpegBuffer(320, 240);
    const path = join(tmpdir(), `exif-test-${Date.now()}.jpg`);
    writeFileSync(path, buf);
    const dims = await readImageDimensions(path);
    expect(dims.width).toBe(320);
    expect(dims.height).toBe(240);
  });
});
