import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const pub = join(process.cwd(), 'public');
const manifest = JSON.parse(readFileSync(join(pub, 'manifest.json'), 'utf8')) as {
  name: string;
  start_url: string;
  display: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
};

describe('PWA manifest', () => {
  it('is installable: name, start URL, standalone display', () => {
    expect(manifest).toMatchObject({ name: 'Home Design', start_url: '/', display: 'standalone' });
  });

  it('has 192 and 512 px icons, plus a maskable one, and every icon file exists at the size it claims', async () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/')).toBe(true);
      const meta = await sharp(join(pub, icon.src)).metadata();
      expect(meta.format).toBe('png');
      expect(`${meta.width}x${meta.height}`).toBe(icon.sizes);
    }
  });

  it('has the apple touch icon the layout links to', async () => {
    expect((await sharp(join(pub, 'icons', 'apple-touch-icon.png')).metadata()).width).toBe(180);
  });
});
