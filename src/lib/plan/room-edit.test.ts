import { describe, it, expect } from 'vitest';
import { insertVertex, moveVertex, removeVertex } from './room-edit';
import { wallLengthMm } from './validate';
import type { Opening, Room } from './schemas';

/** 3000 × 4000 rectangle, walls a (top), b (right), c (bottom), d (left). */
function rect(extra: Partial<Room> = {}): Room {
  return {
    polygon: [
      [0, 0],
      [3000, 0],
      [3000, 4000],
      [0, 4000],
    ],
    walls: [
      { id: 'a', thicknessMm: 100 },
      { id: 'b', thicknessMm: 150 },
      { id: 'c', thicknessMm: 100 },
      { id: 'd', thicknessMm: 100 },
    ],
    openings: [],
    ...extra,
  };
}

const door = (id: string, wallId: string, positionMm: number, widthMm = 800): Opening => ({
  id,
  wallId,
  kind: 'door',
  positionMm,
  widthMm,
  heightMm: 2000,
});

describe('insertVertex', () => {
  it('splits the wall: the original id keeps the first half, the new id takes the second', () => {
    const r = insertVertex(rect(), 1, [3000, 1000], 'b2');
    expect(r.polygon).toEqual([
      [0, 0],
      [3000, 0],
      [3000, 1000],
      [3000, 4000],
      [0, 4000],
    ]);
    expect(r.walls.map((w) => w.id)).toEqual(['a', 'b', 'b2', 'c', 'd']);
    expect(r.walls[2].thicknessMm).toBe(150); // inherits the split wall's thickness
    expect(wallLengthMm(r, 1)).toBe(1000);
    expect(wallLengthMm(r, 2)).toBe(3000);
  });

  it('projects the point onto the edge so the outline does not change shape', () => {
    const r = insertVertex(rect(), 0, [1200, 37], 'x');
    expect(r.polygon[1]).toEqual([1200, 0]);
  });

  it('moves openings to the half that holds their centre, remapping position', () => {
    const r = insertVertex(
      rect({ openings: [door('first', 'a', 200), door('second', 'a', 2000)] }),
      0,
      [1500, 0],
      'a2'
    );
    expect(r.openings.find((o) => o.id === 'first')).toMatchObject({ wallId: 'a', positionMm: 200 });
    expect(r.openings.find((o) => o.id === 'second')).toMatchObject({ wallId: 'a2', positionMm: 500 });
  });

  it('shifts an opening that straddles the split so it fits on its new wall', () => {
    // Door 1000–1800 on wall a; split at 1500 → centre 1400 stays on 'a' (0–1500), shifted to 700.
    const r = insertVertex(rect({ openings: [door('o', 'a', 1000)] }), 0, [1500, 0], 'a2');
    expect(r.openings[0]).toMatchObject({ wallId: 'a', positionMm: 700, widthMm: 800 });
  });

  it('drops a measurement of the split wall and keeps the others', () => {
    const measurements = [
      { wallId: 'a', lengthMm: 3000, source: 'user' as const },
      { wallId: 'b', lengthMm: 4000, source: 'user' as const },
    ];
    const r = insertVertex(rect({ measurements }), 0, [1500, 0], 'a2');
    expect(r.measurements).toEqual([measurements[1]]);
  });

  it('refuses a point at an existing corner', () => {
    expect(() => insertVertex(rect(), 0, [0, 0], 'x')).toThrow(/corner/);
  });

  it('does not mutate its input', () => {
    const room = rect({ openings: [door('o', 'a', 100)] });
    const copy = structuredClone(room);
    insertVertex(room, 0, [1500, 0], 'x');
    expect(room).toEqual(copy);
  });
});

describe('removeVertex', () => {
  /** Rectangle with an extra collinear corner at (3000, 1000) on the right side. */
  const withExtra = () => insertVertex(rect(), 1, [3000, 1000], 'b2');

  it('merges the two walls at the corner, keeping the earlier wall id', () => {
    const r = removeVertex(withExtra(), 2);
    expect(r.polygon).toEqual(rect().polygon);
    expect(r.walls.map((w) => w.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('works for the first vertex (merging the last and first walls)', () => {
    const room: Room = {
      polygon: [
        [1500, 0],
        [3000, 0],
        [3000, 4000],
        [0, 4000],
        [0, 0],
      ],
      walls: ['p', 'q', 'r', 's', 't'].map((id) => ({ id, thicknessMm: 100 })),
      openings: [],
    };
    const r = removeVertex(room, 0);
    expect(r.polygon).toEqual([
      [3000, 0],
      [3000, 4000],
      [0, 4000],
      [0, 0],
    ]);
    // Wall t (0,0)→(1500,0) absorbs wall p (1500,0)→(3000,0) and becomes the last edge.
    expect(r.walls.map((w) => w.id)).toEqual(['q', 'r', 's', 't']);
    expect(wallLengthMm(r, 3)).toBe(3000);
  });

  it('moves openings from the removed wall onto the merged wall at the same place along it', () => {
    const room = withExtra();
    room.openings = [door('upper', 'b', 100), door('lower', 'b2', 1000)];
    const r = removeVertex(room, 2);
    expect(r.openings.find((o) => o.id === 'upper')).toMatchObject({ wallId: 'b', positionMm: 100 });
    // 'lower' was 1000 mm into b2, which starts 1000 mm along the old path.
    expect(r.openings.find((o) => o.id === 'lower')).toMatchObject({ wallId: 'b', positionMm: 2000 });
  });

  it('drops measurements of both merged walls', () => {
    const room = withExtra();
    room.measurements = [
      { wallId: 'b', lengthMm: 1000, source: 'user' },
      { wallId: 'b2', lengthMm: 3000, source: 'user' },
      { wallId: 'a', lengthMm: 3000, source: 'user' },
    ];
    expect(removeVertex(room, 2).measurements).toEqual([{ wallId: 'a', lengthMm: 3000, source: 'user' }]);
  });

  it('refuses to go below three corners', () => {
    const tri: Room = {
      polygon: [
        [0, 0],
        [1000, 0],
        [0, 1000],
      ],
      walls: ['x', 'y', 'z'].map((id) => ({ id, thicknessMm: 100 })),
      openings: [],
    };
    expect(() => removeVertex(tri, 0)).toThrow(/three corners/);
  });
});

describe('moveVertex', () => {
  it('moves the corner and changes only the two adjacent walls', () => {
    const r = moveVertex(rect(), 2, [3500, 4000]);
    expect(r.polygon[2]).toEqual([3500, 4000]);
    expect(wallLengthMm(r, 0)).toBe(3000);
    expect(wallLengthMm(r, 1)).toBeCloseTo(Math.hypot(500, 4000));
    expect(wallLengthMm(r, 2)).toBe(3500);
    expect(r.walls).toEqual(rect().walls);
  });

  it('keeps openings on the resized walls at the same relative position', () => {
    // Wall c runs (3000,4000)→(0,4000); a door 1500 mm along it is at the midpoint.
    const r = moveVertex(rect({ openings: [door('o', 'c', 1500)] }), 2, [6000, 4000]);
    // Wall c is now 6000 long: the door stays at the same fraction (0.5) of it.
    expect(r.openings[0]).toMatchObject({ wallId: 'c', positionMm: 3000, widthMm: 800 });
  });

  it('shifts an opening that would no longer fit', () => {
    const r = moveVertex(rect({ openings: [door('o', 'a', 2000, 900)] }), 1, [1000, 0]);
    // Wall a is now 1000 long: the 900 mm door is shifted to 100 so it ends at the corner.
    expect(r.openings[0]).toMatchObject({ positionMm: 100, widthMm: 900 });
  });

  it('drops measurements of the walls whose length changed', () => {
    const measurements = [
      { wallId: 'a', lengthMm: 3000, source: 'user' as const },
      { wallId: 'b', lengthMm: 4000, source: 'user' as const },
      { wallId: 'd', lengthMm: 4000, source: 'user' as const },
    ];
    // Moving vertex 1 along the top edge's line changes walls a and b.
    const r = moveVertex(rect({ measurements }), 1, [3000, -500]);
    expect(r.measurements).toEqual([measurements[2]]);
  });

  it('keeps measurements when the corner did not actually move', () => {
    const measurements = [{ wallId: 'a', lengthMm: 3000, source: 'user' as const }];
    expect(moveVertex(rect({ measurements }), 1, [3000, 0]).measurements).toEqual(measurements);
  });
});
