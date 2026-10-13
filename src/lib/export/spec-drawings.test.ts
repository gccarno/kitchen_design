import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../catalog/loader';
import { newCloset } from '../closet/catalog';
import { closetToSvg } from '../closet/svg';
import { wallElevations } from '../plan/elevation';
import { elevationFrame } from '../plan/elevation-drawing';
import { wallElevationSvg } from '../plan/elevation-svg';
import { buildSampleKitchen } from '../plan/sample-kitchen';
import { ProjectSchema, type Project } from '../plan/schemas';
import { planToSvg } from '../plan/svg';
import { pickScale, svgViewBoxSize } from './paper';

const catalog = loadCatalog();
const blank = (over: Partial<Project> = {}): Project =>
  ProjectSchema.parse({
    id: randomUUID(), name: 'Sample kitchen', kind: 'kitchen', units: 'mm', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0, photos: [],
    room: { polygon: [[0, 0], [3000, 0], [3000, 4000], [0, 4000]], walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })), openings: [] },
    items: [], history: [], ...over,
  });
let k = 0;
const sample = buildSampleKitchen(blank(), catalog, () => `id-${k++}`);

describe('drawings without a title block', () => {
  it('the plan keeps its scale bar but drops the title block, and is unchanged by default', () => {
    expect(planToSvg(sample)).toContain('id="title"');
    const bare = planToSvg(sample, { titleBlock: false });
    expect(bare).not.toContain('id="title"');
    expect(bare).toContain('id="scale-bar"');
  });

  it('the closet front drops its title block and the space for it', () => {
    const closet = blank({ kind: 'closet', closet: newCloset(), name: 'Hall closet' });
    expect(closetToSvg(closet)).toContain('id="title"');
    const bare = closetToSvg(closet, { titleBlock: false });
    expect(bare).not.toContain('id="title"');
    expect(svgViewBoxSize(bare).h).toBe(closet.closet!.heightMm + 250 + 400);
  });
});

describe('wallElevationSvg', () => {
  it('draws one wall alone, framed like the editor view', () => {
    const [wall] = wallElevations(sample, catalog);
    const svg = wallElevationSvg(wall, 'mm');
    const f = elevationFrame(wall);
    expect(svgViewBoxSize(svg)).toEqual({ w: f.w, h: f.h });
    expect(svg.match(/<svg/g)).toHaveLength(1);
    expect(svg).toContain('>Refrigerator</text>');
  });
});

describe('pickScale', () => {
  it('picks the largest standard drawing that fits the box', () => {
    // A box 510 × 600 pt is 179.9 × 211.7 mm.
    expect(pickScale({ w: 4000, h: 3000 }, { w: 510, h: 600 })).toBe(25);
    expect(pickScale({ w: 3000, h: 3000 }, { w: 510, h: 600 })).toBe(20);
    expect(pickScale({ w: 5780, h: 6080 }, { w: 510, h: 615 })).toBe(50);
    expect(pickScale({ w: 12000, h: 3000 }, { w: 510, h: 600 })).toBe(100);
  });

  it('gives up past 1:100', () => {
    expect(pickScale({ w: 30000, h: 1000 }, { w: 510, h: 600 })).toBeNull();
  });
});

describe('svgViewBoxSize', () => {
  it('reads the size a drawing covers', () => {
    expect(svgViewBoxSize('<svg viewBox="-120.5 -80 4000 3000.5">')).toEqual({ w: 4000, h: 3000.5 });
    expect(() => svgViewBoxSize('<svg>')).toThrow(/viewBox/);
  });
});
