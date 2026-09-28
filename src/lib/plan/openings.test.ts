import { describe, it, expect } from 'vitest';
import {
  addOpening,
  moveOpening,
  nearestWallPoint,
  removeOpening,
  alongWallMm,
  resizeOpening,
  OPENING_DEFAULTS,
  MIN_OPENING_MM,
} from './openings';
import type { Opening, Room } from './schemas';

/** 3000 × 4000 room: wall a is the top edge (0,0)→(3000,0), wall b the right edge. */
function room(openings: Opening[] = []): Room {
  return {
    polygon: [
      [0, 0],
      [3000, 0],
      [3000, 4000],
      [0, 4000],
    ],
    walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
    openings,
  };
}

const win = (id: string, positionMm: number, widthMm = 1000, wallId = 'a'): Opening => ({
  id,
  wallId,
  kind: 'window',
  positionMm,
  widthMm,
  heightMm: 1200,
});

describe('nearestWallPoint', () => {
  it('projects a point onto the closest wall', () => {
    expect(nearestWallPoint(room(), [1200, 80])).toEqual({ wallIndex: 0, alongMm: 1200, distanceMm: 80 });
    expect(nearestWallPoint(room(), [2950, 1000])).toEqual({ wallIndex: 1, alongMm: 1000, distanceMm: 50 });
  });

  it('clamps to the wall ends', () => {
    expect(nearestWallPoint(room(), [-300, -50]).alongMm).toBe(0);
  });
});

describe('alongWallMm', () => {
  it('measures along a given wall without clamping (drags can overshoot)', () => {
    expect(alongWallMm(room(), 1, [2900, 1500])).toBe(1500);
    expect(alongWallMm(room(), 0, [-200, 400])).toBe(-200);
  });
});

describe('addOpening', () => {
  it('centres a default-size door on the given point along the wall', () => {
    const r = addOpening(room(), 0, 1500, 'door', 'o1');
    expect(r.openings).toEqual([
      {
        id: 'o1',
        wallId: 'a',
        kind: 'door',
        positionMm: 1500 - OPENING_DEFAULTS.door.widthMm / 2,
        widthMm: OPENING_DEFAULTS.door.widthMm,
        heightMm: OPENING_DEFAULTS.door.heightMm,
      },
    ]);
  });

  it('shifts an opening placed near a corner so it fits the wall', () => {
    const r = addOpening(room(), 0, 100, 'window', 'o1');
    expect(r.openings[0].positionMm).toBe(0);
    const r2 = addOpening(room(), 0, 2950, 'window', 'o2');
    expect(r2.openings[0].positionMm).toBe(3000 - OPENING_DEFAULTS.window.widthMm);
  });

  it('shrinks the default width to fit a short wall', () => {
    const short: Room = {
      ...room(),
      polygon: [
        [0, 0],
        [600, 0],
        [600, 4000],
        [0, 4000],
      ],
    };
    const r = addOpening(short, 0, 300, 'window', 'o1');
    expect(r.openings[0]).toMatchObject({ positionMm: 0, widthMm: 600 });
  });

  it('refuses to overlap an existing opening on the same wall', () => {
    expect(() => addOpening(room([win('w', 1000)]), 0, 1500, 'door', 'o1')).toThrow(/overlap/);
  });

  it('allows an opening on another wall at the same position', () => {
    const r = addOpening(room([win('w', 1000, 1000, 'b')]), 0, 1500, 'door', 'o1');
    expect(r.openings).toHaveLength(2);
  });

  it('refuses a wall shorter than the minimum opening', () => {
    const tiny: Room = {
      ...room(),
      polygon: [
        [0, 0],
        [200, 0],
        [200, 4000],
        [0, 4000],
      ],
    };
    expect(() => addOpening(tiny, 0, 100, 'door', 'o1')).toThrow(/too short/);
  });
});

describe('resizeOpening', () => {
  it('moves the end edge, keeping the start fixed', () => {
    const r = resizeOpening(room([win('w', 1000)]), 'w', 'end', 2500);
    expect(r.openings[0]).toMatchObject({ positionMm: 1000, widthMm: 1500 });
  });

  it('moves the start edge, keeping the end fixed', () => {
    const r = resizeOpening(room([win('w', 1000)]), 'w', 'start', 400);
    expect(r.openings[0]).toMatchObject({ positionMm: 400, widthMm: 1600 });
  });

  it(`never goes below ${MIN_OPENING_MM} mm`, () => {
    const r = resizeOpening(room([win('w', 1000)]), 'w', 'end', 1100);
    expect(r.openings[0].widthMm).toBe(MIN_OPENING_MM);
  });

  it('stops at the wall ends', () => {
    expect(resizeOpening(room([win('w', 1000)]), 'w', 'end', 9999).openings[0]).toMatchObject({ widthMm: 2000 });
    expect(resizeOpening(room([win('w', 1000)]), 'w', 'start', -500).openings[0]).toMatchObject({
      positionMm: 0,
      widthMm: 2000,
    });
  });

  it('stops at a neighbouring opening', () => {
    const r = resizeOpening(room([win('w', 500), win('n', 2200, 500)]), 'w', 'end', 2900);
    expect(r.openings[0]).toMatchObject({ positionMm: 500, widthMm: 1700 });
  });
});

describe('moveOpening', () => {
  it('slides along the wall keeping its width', () => {
    const r = moveOpening(room([win('w', 1000)]), 'w', 1500);
    expect(r.openings[0]).toMatchObject({ positionMm: 1500, widthMm: 1000 });
  });

  it('stays within the wall', () => {
    expect(moveOpening(room([win('w', 1000)]), 'w', 2800).openings[0].positionMm).toBe(2000);
    expect(moveOpening(room([win('w', 1000)]), 'w', -40).openings[0].positionMm).toBe(0);
  });

  it('stops against a neighbour instead of overlapping it', () => {
    // Neighbour occupies 2200–2700; moving right stops with our end at 2200.
    const r = moveOpening(room([win('w', 500), win('n', 2200, 500)]), 'w', 1800);
    expect(r.openings[0].positionMm).toBe(1200);
    // Moving left past a neighbour stops at its end.
    const l = moveOpening(room([win('n', 200, 500), win('w', 1500)]), 'w', 300);
    expect(l.openings[1].positionMm).toBe(700);
  });
});

describe('removeOpening', () => {
  it('removes by id', () => {
    expect(removeOpening(room([win('w', 1000), win('x', 2200, 500)]), 'w').openings.map((o) => o.id)).toEqual(['x']);
  });
});
