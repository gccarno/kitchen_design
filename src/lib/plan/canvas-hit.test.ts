import { describe, it, expect } from 'vitest';
import { hitTest, itemsAt } from './canvas-hit';
import type { PlacedItem } from './schemas';
import type { Room } from './schemas';
import type { Viewport } from './viewport';

const room: Room = {
  polygon: [
    [0, 0],
    [3000, 0],
    [3000, 4000],
    [0, 4000],
  ],
  walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
  openings: [],
};
// 0.1 px/mm, world origin at (50, 50): corner (3000, 0) is at screen (350, 50).
const v: Viewport = { scale: 0.1, x: 50, y: 50 };

describe('hitTest', () => {
  it('finds a corner within the tolerance', () => {
    expect(hitTest(room, v, [355, 45], 14)).toEqual({ kind: 'vertex', index: 1 });
  });

  it('finds an edge midpoint handle', () => {
    // Midpoint of edge 1 (right wall) is world (3000, 2000) → screen (350, 250).
    expect(hitTest(room, v, [352, 258], 14)).toEqual({ kind: 'edge', index: 1, point: [3000, 2000] });
  });

  it('prefers a corner over a nearby midpoint', () => {
    const tiny: Viewport = { scale: 0.005, x: 0, y: 0 }; // midpoint and corners within a few px
    expect(hitTest(room, tiny, [15, 0], 14)).toEqual({ kind: 'vertex', index: 1 });
  });

  it('picks the nearest corner when several are in range', () => {
    const tiny: Viewport = { scale: 0.005, x: 0, y: 0 };
    expect(hitTest(room, tiny, [2, 1], 14)).toEqual({ kind: 'vertex', index: 0 });
  });

  it('returns null away from any handle (so the gesture pans)', () => {
    expect(hitTest(room, v, [200, 200], 14)).toBeNull();
  });

  describe('openings', () => {
    // Window on the top wall from x=1000 to x=2200 → screen x 150..270 at y 50.
    const withWindow: Room = {
      ...room,
      openings: [{ id: 'w', wallId: 'a', kind: 'window', positionMm: 1000, widthMm: 1200, heightMm: 1200 }],
    };

    it('grabs an opening end handle', () => {
      expect(hitTest(withWindow, v, [152, 47], 12)).toEqual({ kind: 'opening-end', id: 'w', edge: 'start' });
      expect(hitTest(withWindow, v, [268, 53], 12)).toEqual({ kind: 'opening-end', id: 'w', edge: 'end' });
    });

    it('grabs the opening body away from its ends', () => {
      expect(hitTest(withWindow, v, [220, 55], 12)).toEqual({ kind: 'opening', id: 'w' });
    });

    it('lets the opening body win over the wall "+" handle it covers', () => {
      // The top wall's midpoint (1500, 0) → screen (200, 50) is inside the window.
      expect(hitTest(withWindow, v, [200, 50], 12)).toEqual({ kind: 'opening', id: 'w' });
    });

    it('keeps corners grabbable when an opening ends at the corner', () => {
      const atCorner: Room = {
        ...room,
        openings: [{ id: 'd', wallId: 'a', kind: 'door', positionMm: 0, widthMm: 800, heightMm: 2100 }],
      };
      expect(hitTest(atCorner, v, [50, 50], 12)).toEqual({ kind: 'vertex', index: 0 });
    });
  });
});

describe('itemsAt', () => {
  const mk = (id: string, x: number, y: number, mount?: PlacedItem['mount'], rotationDeg = 0): PlacedItem => ({
    id,
    catalogId: id,
    sizeMm: { w: 600, d: 400, h: 700 },
    position: { x, y },
    rotationDeg,
    ...(mount ? { mount } : {}),
  });

  it('lists items under a point, topmost level first', () => {
    const items = [mk('base', 1000, 1000), mk('wall', 1000, 1000, 'wall'), mk('micro', 1000, 1000, 'counter')];
    expect(itemsAt(items, [1100, 1050])).toEqual(['wall', 'micro', 'base']);
  });

  it('respects rotation', () => {
    const items = [mk('r', 1000, 1000, undefined, 90)]; // 400 wide, 600 deep once rotated
    expect(itemsAt(items, [1000, 1280])).toEqual(['r']);
    expect(itemsAt(items, [1280, 1000])).toEqual([]);
  });

  it('puts later items first within a level (they are drawn on top)', () => {
    expect(itemsAt([mk('a', 1000, 1000), mk('b', 1100, 1000)], [1050, 1000])).toEqual(['b', 'a']);
  });
});
