import { describe, it, expect } from 'vitest';
import { rescaleRoomToMeasurements, rescaleToKnownLength, SCALE_DISAGREEMENT_WARN } from './scale';
import { wallLengthMm } from './validate';
import type { PlacedItem, Room } from './schemas';

function rectRoom(w: number, d: number, extra: Partial<Room> = {}): Room {
  return {
    polygon: [
      [0, 0],
      [w, 0],
      [w, d],
      [0, d],
    ],
    walls: [0, 1, 2, 3].map((i) => ({ id: `w${i}`, thicknessMm: 100 })),
    openings: [],
    ...extra,
  };
}

describe('rescaleRoomToMeasurements', () => {
  it('returns the room unchanged when there are no measurements', () => {
    const room = rectRoom(3000, 4000);
    const r = rescaleRoomToMeasurements(room);
    expect(r.scale).toBe(1);
    expect(r.residual).toBe(0);
    expect(r.room).toEqual(room);
  });

  it('scales uniformly so a single measured wall matches exactly', () => {
    // LLM guessed 3000 × 4000; the user measured the first wall at 3600.
    const room = rectRoom(3000, 4000, { measurements: [{ wallId: 'w0', lengthMm: 3600, source: 'user' }] });
    const r = rescaleRoomToMeasurements(room);
    expect(r.scale).toBeCloseTo(1.2);
    expect(wallLengthMm(r.room, 0)).toBeCloseTo(3600);
    expect(wallLengthMm(r.room, 1)).toBeCloseTo(4800);
    expect(r.residual).toBeCloseTo(0);
  });

  it('keeps the first vertex fixed', () => {
    const room: Room = {
      ...rectRoom(1000, 1000),
      polygon: [
        [500, 500],
        [1500, 500],
        [1500, 1500],
        [500, 1500],
      ],
      measurements: [{ wallId: 'w0', lengthMm: 2000, source: 'user' }],
    };
    const r = rescaleRoomToMeasurements(room);
    expect(r.room.polygon[0]).toEqual([500, 500]);
    expect(r.room.polygon[2][0]).toBeCloseTo(2500);
  });

  it('averages the scale from two measurements and reports the residual', () => {
    // Wall 0 says ×1.1, wall 1 says ×0.9 → average 1.0. Wall 1 then comes out
    // at 4000 vs a measured 3600: residual = 400 / 3600 ≈ 0.111.
    const room = rectRoom(3000, 4000, {
      measurements: [
        { wallId: 'w0', lengthMm: 3300, source: 'user' },
        { wallId: 'w1', lengthMm: 3600, source: 'user' },
      ],
    });
    const r = rescaleRoomToMeasurements(room);
    expect(r.scale).toBeCloseTo(1.0);
    expect(r.residual).toBeCloseTo(400 / 3600);
    expect(r.residual).toBeGreaterThan(SCALE_DISAGREEMENT_WARN);
  });

  it('reports a small residual when two measurements agree', () => {
    const room = rectRoom(3000, 4000, {
      measurements: [
        { wallId: 'w0', lengthMm: 3600, source: 'user' },
        { wallId: 'w1', lengthMm: 4810, source: 'user' },
      ],
    });
    const r = rescaleRoomToMeasurements(room);
    expect(r.residual).toBeLessThan(SCALE_DISAGREEMENT_WARN);
  });

  it('scales opening positions and widths along with the walls, but not heights', () => {
    const room = rectRoom(3000, 4000, {
      openings: [{ id: 'o', wallId: 'w0', kind: 'door', positionMm: 1000, widthMm: 800, heightMm: 2000 }],
      measurements: [{ wallId: 'w0', lengthMm: 1500, source: 'user' }],
    });
    const r = rescaleRoomToMeasurements(room);
    expect(r.room.openings[0]).toMatchObject({ positionMm: 500, widthMm: 400, heightMm: 2000 });
  });

  it('throws for a measurement on an unknown wall', () => {
    const room = rectRoom(3000, 4000, { measurements: [{ wallId: 'nope', lengthMm: 1, source: 'user' }] });
    expect(() => rescaleRoomToMeasurements(room)).toThrow(/unknown wall/);
  });

  it('does not mutate its input', () => {
    const room = rectRoom(3000, 4000, { measurements: [{ wallId: 'w0', lengthMm: 6000, source: 'user' }] });
    const copy = structuredClone(room);
    rescaleRoomToMeasurements(room);
    expect(room).toEqual(copy);
  });
});

describe('rescaleToKnownLength', () => {
  const door = { id: 'o1', wallId: 'w0', kind: 'door' as const, positionMm: 500, widthMm: 900, heightMm: 2100 };
  const fridge: PlacedItem = { id: 'i1', catalogId: 'fridge-600', sizeMm: { w: 600, d: 650, h: 1850 }, position: { x: 300, y: 400 }, rotationDeg: 0 };
  const estimated = () => rectRoom(3000, 4000, { openings: [door], sizeEstimated: true });

  it('scales the room so a wall has its real length, and clears the estimated flag', () => {
    const r = rescaleToKnownLength({ room: estimated(), items: [] }, { kind: 'wall', id: 'w0' }, 3600);
    expect(r.factor).toBeCloseTo(1.2);
    expect(wallLengthMm(r.room, 0)).toBeCloseTo(3600);
    expect(wallLengthMm(r.room, 1)).toBeCloseTo(4800);
    expect(r.room.sizeEstimated).toBeUndefined();
    expect(r.room.measurements).toEqual([{ wallId: 'w0', lengthMm: 3600, source: 'user' }]);
  });

  it('scales to a door or window width, and records no wall measurement', () => {
    const r = rescaleToKnownLength({ room: estimated(), items: [] }, { kind: 'opening', id: 'o1' }, 810);
    expect(r.factor).toBeCloseTo(0.9);
    expect(r.room.openings[0].widthMm).toBeCloseTo(810);
    expect(r.room.openings[0].positionMm).toBeCloseTo(450);
    expect(r.room.openings[0].heightMm).toBe(2100); // heights are not on the floor plan's scale
    expect(wallLengthMm(r.room, 0)).toBeCloseTo(2700);
    expect(r.room.measurements).toBeUndefined();
    expect(r.room.sizeEstimated).toBeUndefined();
  });

  it('moves items with the room about the same corner, but keeps their sizes', () => {
    const r = rescaleToKnownLength({ room: estimated(), items: [fridge] }, { kind: 'wall', id: 'w0' }, 3600);
    expect(r.items[0].position.x).toBeCloseTo(360);
    expect(r.items[0].position.y).toBeCloseTo(480);
    expect(r.items[0].sizeMm).toEqual(fridge.sizeMm);
  });

  it('keeps the first vertex fixed and walls thickness unchanged', () => {
    const r = rescaleToKnownLength({ room: { ...estimated(), polygon: [[100, 200], [3100, 200], [3100, 4200], [100, 4200]] }, items: [] }, { kind: 'wall', id: 'w0' }, 6000);
    expect(r.room.polygon[0]).toEqual([100, 200]);
    expect(r.room.walls.every((w) => w.thicknessMm === 100)).toBe(true);
  });

  it('drops earlier measurements, which the new scale would contradict', () => {
    const room = rectRoom(3000, 4000, { measurements: [{ wallId: 'w1', lengthMm: 4000, source: 'user' }] });
    const r = rescaleToKnownLength({ room, items: [] }, { kind: 'wall', id: 'w0' }, 3300);
    expect(r.room.measurements).toEqual([{ wallId: 'w0', lengthMm: 3300, source: 'user' }]);
  });

  it('does not mutate its input', () => {
    const room = estimated();
    const before = JSON.stringify(room);
    rescaleToKnownLength({ room, items: [fridge] }, { kind: 'wall', id: 'w0' }, 3600);
    expect(JSON.stringify(room)).toBe(before);
  });

  it.each([0, -5, NaN, Infinity])('rejects a length of %s', (len) => {
    expect(() => rescaleToKnownLength({ room: estimated(), items: [] }, { kind: 'wall', id: 'w0' }, len)).toThrow(/positive/);
  });

  it('rejects a wall or opening that is not in the room', () => {
    expect(() => rescaleToKnownLength({ room: estimated(), items: [] }, { kind: 'wall', id: 'zzz' }, 3000)).toThrow(/unknown wall/);
    expect(() => rescaleToKnownLength({ room: estimated(), items: [] }, { kind: 'opening', id: 'zzz' }, 900)).toThrow(/unknown opening/);
  });
});
