// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Project } from '@/lib/plan/schemas';
import { scoreRoom } from '../support/room-score';

type Room = Project['room'];

function room(w: number, d: number, openings: Array<'door' | 'window'> = []): Room {
  const walls = ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 }));
  return {
    polygon: [
      [0, 0],
      [w, 0],
      [w, d],
      [0, d],
    ],
    walls,
    openings: openings.map((kind, i) => ({ id: `o${i}`, wallId: 'a', kind, positionMm: 100 + i * 1000, widthMm: 800, heightMm: 2000 })),
  };
}

describe('scoreRoom', () => {
  it('calls the true room good, with no error', () => {
    const truth = room(4000, 3000, ['door', 'window']);
    expect(scoreRoom(truth, truth)).toEqual({
      sides: { want: 4, got: 4 },
      areaErrorPct: 0,
      longSideErrorPct: 0,
      shortSideErrorPct: 0,
      doors: { want: 1, got: 1 },
      windows: { want: 1, got: 1 },
      good: true,
    });
  });

  it('does not mind the outline being turned a quarter turn', () => {
    expect(scoreRoom(room(4000, 3000), room(3000, 4000)).good).toBe(true);
  });

  it('reports sizes as signed percentages, and fails a room outside the tolerance', () => {
    const score = scoreRoom(room(4000, 3000), room(4800, 3000));
    expect(score).toMatchObject({ areaErrorPct: 20, longSideErrorPct: 20, shortSideErrorPct: 0, good: false });
    expect(scoreRoom(room(4000, 3000), room(4800, 3000), 25).good).toBe(true);
    expect(scoreRoom(room(4000, 3000), room(3600, 3000)).longSideErrorPct).toBe(-10);
  });

  it('fails a room with a missed window, an invented door, or the wrong number of sides', () => {
    const truth = room(4000, 3000, ['door', 'window']);
    expect(scoreRoom(truth, room(4000, 3000, ['door']))).toMatchObject({ windows: { want: 1, got: 0 }, good: false });
    expect(scoreRoom(truth, room(4000, 3000, ['door', 'door', 'window']))).toMatchObject({ doors: { want: 1, got: 2 }, good: false });
    const five: Room = { ...truth, polygon: [...truth.polygon.slice(0, 2), [4000, 1500], ...truth.polygon.slice(2)], walls: [...truth.walls, { id: 'e', thicknessMm: 100 }] };
    expect(scoreRoom(truth, five)).toMatchObject({ sides: { want: 4, got: 5 }, good: false });
  });
});
