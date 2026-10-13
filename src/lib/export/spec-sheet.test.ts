import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { loadCatalog } from '../catalog/loader';
import { newCloset } from '../closet/catalog';
import { buildSampleKitchen } from '../plan/sample-kitchen';
import { ProjectSchema, type PlacedItem, type Project } from '../plan/schemas';
import { pdfText } from './pdf-text';
import { buildSpecSheet } from './spec-sheet';

const catalog = loadCatalog();
const blank = (over: Partial<Project> = {}): Project =>
  ProjectSchema.parse({
    id: randomUUID(), name: 'Sample kitchen', kind: 'kitchen', units: 'mm', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0, photos: [],
    room: { polygon: [[0, 0], [3000, 0], [3000, 4000], [0, 4000]], walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })), openings: [] },
    items: [], history: [], ...over,
  });
let k = 0;
const sample = () => buildSampleKitchen(blank(), catalog, () => `id-${k++}`);
const read = async (pdf: Uint8Array) => ({ doc: await PDFDocument.load(pdf), text: pdfText(pdf).join('\n') });

describe('buildSpecSheet', () => {
  it('a kitchen is four A4 pages: cover and plan, wall elevations, parts and estimate, layout check', async () => {
    const { doc, text } = await read(await buildSpecSheet(sample(), catalog, { date: '2026-02-03' }));
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    for (const s of [
      'Sample kitchen',
      'Kitchen spec sheet',
      'Floor plan — 1:50',
      'Wall elevations',
      'Wall 1 — north, 4200 mm — 1:50',
      'Parts list and estimate',
      'Prices are estimates from default or edited unit prices, not quotes.',
      'Layout check — ',
      'Sample kitchen · 2026-02-03 · revision 0 · page 1 of 4',
      'page 4 of 4',
    ]) {
      expect(text).toContain(s);
    }
  });

  it('writes the work-triangle arrows as plain text', async () => {
    const { text } = await read(await buildSpecSheet(sample(), catalog, { date: '2026-02-03' }));
    expect(text).toContain('fridge - sink');
    expect(text).not.toContain('fridge ? sink');
  });

  it('is on Letter, in feet and inches, for a project in inches', async () => {
    const { doc, text } = await read(await buildSpecSheet({ ...sample(), units: 'in' }, catalog, { date: '2026-02-03' }));
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(text).toContain('ft²');
  });

  it('leaves out the elevations page when nothing is against a wall', async () => {
    const { doc, text } = await read(await buildSpecSheet(blank(), catalog));
    expect(doc.getPageCount()).toBe(3);
    expect(text).not.toContain('Wall elevations');
    expect(text).toContain('nothing to check yet');
  });

  it('keeps three walls, and their captions, together on one elevations page when the height sets the scale', async () => {
    // A 3100 mm tall cabinet raises the drawing; with items on three walls, boxes that ignore the captions run over the page.
    const base = { catalogId: 'tall-600x560x2100', tag: 'tall', mount: 'floor' as const };
    const items: PlacedItem[] = [
      { id: 'n', ...base, sizeMm: { w: 600, d: 560, h: 3100 }, position: { x: 1500, y: 280 }, rotationDeg: 0 },
      { id: 's', ...base, sizeMm: { w: 600, d: 560, h: 3100 }, position: { x: 1500, y: 3720 }, rotationDeg: 180 },
      { id: 'w', ...base, sizeMm: { w: 600, d: 560, h: 3100 }, position: { x: 280, y: 2000 }, rotationDeg: 270 },
    ];
    const { doc, text } = await read(await buildSpecSheet(blank({ items }), catalog));
    const walls = text.split('\n').filter((t) => /^Wall \d — /.test(t));
    expect(walls).toHaveLength(3);
    // Cover, one elevations page, parts (no layout check: nothing to check yet).
    expect(doc.getPageCount()).toBe(4);
  });

  it('a closet is two pages: cover with the front elevation, then parts and estimate', async () => {
    const { doc, text } = await read(await buildSpecSheet(blank({ kind: 'closet', closet: newCloset(), name: 'Hall closet' }), catalog));
    expect(doc.getPageCount()).toBe(2);
    expect(text).toContain('Closet spec sheet');
    expect(text).toMatch(/Front elevation — 1:\d+/);
    expect(text).not.toContain('Layout check');
  });

  it('carries a long parts list onto another page', async () => {
    // Many different parts, turned 45° in the middle of the room so none is against a wall.
    const items: PlacedItem[] = catalog.items.slice(0, 80).map((c, i) => ({
      id: `p${i}`, catalogId: c.id, sizeMm: c.sizeMm, mount: c.mount, position: { x: 1500, y: 2000 }, rotationDeg: 45, ...(c.tags[0] ? { tag: c.tags[0] } : {}),
    }));
    const { doc, text } = await read(await buildSpecSheet(blank({ items }), catalog));
    expect(doc.getPageCount()).toBeGreaterThan(3);
    expect(text.split('\n').filter((t) => t === 'Part').length).toBeGreaterThan(1);
  });

  it('builds for a name the standard fonts cannot draw, showing "?"', async () => {
    const { text } = await read(await buildSpecSheet(blank({ name: '厨房 kitchen' }), catalog));
    expect(text).toContain('?? kitchen');
  });
});
