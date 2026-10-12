import { describe, it, expect } from 'vitest';
import type { Shape } from '../drawing/shapes';
import type { ElevationPiece, WallElevation } from './elevation';
import { doorCount, elevationDrawing, elevationFrame, PLINTH } from './elevation-drawing';

const p = (over: Partial<ElevationPiece>): ElevationPiece => ({ itemId: 'x', name: 'Thing', kind: 'base', x: 0, w: 600, y: 0, h: 860, plinthMm: 100, ...over });
const elevation = (pieces: ElevationPiece[], over: Partial<WallElevation> = {}): WallElevation => ({
  wallIndex: 0, label: 'Wall 1 — north, 4000 mm', lengthMm: 4000, ceilingMm: 2400, pieces, counters: [], openings: [], ...over,
});
const texts = (shapes: Shape[]) => shapes.flatMap((s) => (s.type === 'text' ? [s.text] : []));
const doorsOf = (shapes: Shape[], id: string) => shapes.filter((s) => s.componentId === id && s.type === 'rect' && s.fill === 'none').length;

describe('doorCount', () => {
  it('gives doors by tag and width', () => {
    expect(doorCount(p({ tag: 'base', w: 450 }))).toEqual({ across: 1, stacked: false });
    expect(doorCount(p({ tag: 'base', w: 600 }))).toEqual({ across: 2, stacked: false });
    expect(doorCount(p({ tag: 'sink', w: 800 }))).toEqual({ across: 2, stacked: false });
    expect(doorCount(p({ tag: 'corner', w: 900 }))).toEqual({ across: 1, stacked: false });
    expect(doorCount(p({ tag: 'filler', w: 50 }))).toEqual({ across: 0, stacked: false });
    expect(doorCount(p({ tag: 'wall', kind: 'wall', w: 450 }))).toEqual({ across: 1, stacked: false });
    expect(doorCount(p({ tag: 'wall', kind: 'wall', w: 900 }))).toEqual({ across: 2, stacked: false });
    expect(doorCount(p({ tag: 'tall', kind: 'tall', w: 600 }))).toEqual({ across: 1, stacked: true });
    expect(doorCount(p({ tag: 'range', kind: 'appliance' }))).toEqual({ across: 0, stacked: false });
  });
});

describe('elevationDrawing', () => {
  it('draws door panels, the plinth and the countertop', () => {
    const shapes = elevationDrawing(
      elevation([p({ itemId: 'b', tag: 'base', w: 600 }), p({ itemId: 't', tag: 'tall', kind: 'tall', x: 600, h: 2200 })], { counters: [{ x: 0, w: 600 }] }),
      'mm'
    );
    expect(doorsOf(shapes, 'b')).toBe(2);
    expect(doorsOf(shapes, 't')).toBe(2); // stacked
    expect(shapes).toContainEqual(expect.objectContaining({ type: 'rect', componentId: 'b', fill: PLINTH, x: 0, y: 2300, w: 600, h: 100 }));
    // Countertop: 860–900 mm above the floor, so y = 2400 − 900.
    expect(shapes).toContainEqual(expect.objectContaining({ type: 'rect', x: 0, y: 1500, w: 600, h: 40 }));
  });

  it('names appliances, falling back to the short name, and leaves out a name that will not fit', () => {
    const shapes = elevationDrawing(
      elevation([
        p({ itemId: 'd', name: 'Dishwasher (600 mm)', tag: 'dishwasher', kind: 'appliance', plinthMm: 0 }),
        p({ itemId: 'f', name: 'Refrigerator, slim (600 mm)', tag: 'fridge', kind: 'appliance', x: 600, h: 1780, plinthMm: 0 }),
        p({ itemId: 'z', name: 'Something enormous', kind: 'appliance', x: 1200, w: 100, plinthMm: 0 }),
        p({ itemId: 'c', name: 'Base cabinet 600 mm', tag: 'base', x: 1300 }),
      ]),
      'mm'
    );
    const t = texts(shapes);
    expect(t).toContain('Dishwasher');
    expect(t).toContain('Refrigerator');
    expect(t.join('|')).not.toMatch(/Something|Base cabinet/);
  });

  it('dimensions each piece, the wall and the key heights, in the project units', () => {
    const e = elevation([p({ tag: 'base', w: 600 }), p({ itemId: 'w', tag: 'wall', kind: 'wall', y: 1450, h: 720, plinthMm: 0 })]);
    const mm = texts(elevationDrawing(e, 'mm'));
    for (const t of ['600 mm', '4000 mm', '900 mm', '1450 mm', '2170 mm']) expect(mm).toContain(t);
    const inches = texts(elevationDrawing(e, 'in'));
    expect(inches).toContain('1\' 11 1/2"');
    expect(inches.join('|')).not.toMatch(/\d mm/);
  });

  it('draws windows dashed and frames the drawing with room for the dimensions', () => {
    const e = elevation([p({})], { openings: [{ openingId: 'o', kind: 'window', x: 1000, w: 900, y: 1050, h: 1200 }] });
    expect(elevationDrawing(e, 'mm')).toContainEqual(expect.objectContaining({ type: 'rect', x: 1000, y: 150, w: 900, h: 1200, dash: [40, 30] }));
    expect(elevationFrame(e)).toEqual({ x: -450, y: -300, w: 4600, h: 3200 });
  });
});
