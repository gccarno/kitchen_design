import { describe, it, expect } from 'vitest';
import { rescaleRoomToMeasurements, SCALE_DISAGREEMENT_WARN } from './scale';
import { wallLengthMm } from './validate';
import type { Room } from './schemas';

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
