import { describe, it, expect } from 'vitest';
import { generateCabinets, STANDARD_WIDTHS_MM } from './generator';
import { buildCatalog, searchCatalog } from './loader';
import { CatalogItemSchema } from './schema';
import seed from './seed.json';

const cabinets = generateCabinets();
const ids = cabinets.map((c) => c.id);

describe('generateCabinets', () => {
  it('is deterministic', () => {
    expect(generateCabinets()).toEqual(cabinets);
  });

  it('produces valid, unique items that do not clash with the seed', () => {
    for (const c of cabinets) expect(() => CatalogItemSchema.parse(c)).not.toThrow();
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => buildCatalog(seed, cabinets)).not.toThrow();
  });

  it('keeps ids stable (saved plans reference them)', () => {
    expect(ids).toEqual(
      expect.arrayContaining([
        'base-600x560x720',
        'base-600x610x720',
        'wall-600x320x720',
        'wall-900x320x900',
        'tall-600x560x2100',
        'corner-base-900x900x720',
        'corner-wall-600x600x720',
        'filler-base-50x560x720',
        'filler-wall-100x320x720',
      ])
    );
  });

  it('offers base and wall cabinets in every standard width', () => {
    for (const w of STANDARD_WIDTHS_MM) {
      expect(ids).toContain(`base-${w}x560x720`);
      expect(ids).toContain(`wall-${w}x320x720`);
    }
  });

  it('mounts wall units on the wall and everything else on the floor', () => {
    for (const c of cabinets) {
      expect(c.category).toBe('cabinet');
      expect(c.mount).toBe(c.id.startsWith('wall-') || c.id.includes('-wall-') ? 'wall' : 'floor');
    }
  });

  it('is findable by width and type', () => {
    expect(searchCatalog(cabinets, '600 base').map((c) => c.id)).toEqual(['base-600x560x720', 'base-600x610x720']);
    expect(searchCatalog(cabinets, 'pantry').length).toBeGreaterThan(0);
  });
});
