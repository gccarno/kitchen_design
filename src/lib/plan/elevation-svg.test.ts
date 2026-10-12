import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../catalog/loader';
import { buildSampleKitchen } from './sample-kitchen';
import { ProjectSchema, type Project } from './schemas';
import { elevationsToSvg } from './elevation-svg';

const catalog = loadCatalog();
function blank(name = 'Sample kitchen'): Project {
  return ProjectSchema.parse({
    id: randomUUID(), name, kind: 'kitchen', units: 'mm', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0, photos: [],
    room: { polygon: [[0, 0], [3000, 0], [3000, 4000], [0, 4000]], walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })), openings: [] },
    items: [], history: [],
  });
}
let k = 0;
const sample = buildSampleKitchen(blank(), catalog, () => `id-${k++}`);

describe('elevationsToSvg', () => {
  const svg = elevationsToSvg(sample, catalog, { date: '2026-02-03' });

  it('stacks every elevation at 1:50 with a heading each and one title block', () => {
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+" width="[\d.]+mm" height="[\d.]+mm"/);
    // The sample is a one-wall kitchen in a 4200 × 3600 mm room.
    expect(svg).toContain('>Wall 1 — north, 4200 mm</text>');
    expect(svg.match(/>Wall \d — /g)).toHaveLength(1);
    expect(svg).toContain('Wall elevations · Scale 1:50 · revision 0 · 2026-02-03');
    expect(svg).toMatchSnapshot();
  });

  it('escapes the project name and unknown catalog ids', () => {
    const odd: Project = { ...sample, name: 'Mum & Dad’s <kitchen>', items: sample.items.map((it, i) => (i === 0 ? { ...it, catalogId: 'a<b>&"c"', tag: undefined } : it)) };
    const out = elevationsToSvg(odd, catalog, { date: '2026-02-03' });
    expect(out).toContain('Mum &amp; Dad’s &lt;kitchen&gt;');
    expect(out).not.toMatch(/<b>|&"c"/);
  });

  it('throws when nothing is against a wall', () => {
    expect(() => elevationsToSvg(blank(), catalog)).toThrow('no wall elevations');
  });
});
