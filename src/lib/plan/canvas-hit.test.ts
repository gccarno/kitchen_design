import { describe, it, expect } from 'vitest';
import { hitTest } from './canvas-hit';
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
});
