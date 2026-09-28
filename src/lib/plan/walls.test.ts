import { describe, it, expect } from 'vitest';
import { wallQuads, inwardNormal } from './walls';
import type { Room } from './schemas';

const rect = (reverse = false): Room => {
  const polygon: Room['polygon'] = [
    [0, 0],
    [3000, 0],
    [3000, 4000],
    [0, 4000],
  ];
  return {
    polygon: reverse ? [...polygon].reverse() : polygon,
    walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
    openings: [],
  };
};

const close = (p: number[], q: number[]) => {
  expect(p[0]).toBeCloseTo(q[0], 6);
  expect(p[1]).toBeCloseTo(q[1], 6);
};

describe('inwardNormal', () => {
  it('points into the room for either winding', () => {
    close(inwardNormal(rect(), 0), [0, 1]); // top wall → down into the room
    const r = rect(true); // (0,4000),(3000,4000),(3000,0),(0,0): wall 0 is the bottom
    close(inwardNormal(r, 0), [0, -1]);
  });
});

describe('wallQuads', () => {
  it('draws each wall outside the interior outline with mitred corners', () => {
    const [top, right] = wallQuads(rect());
    // Inner edge is the outline; outer edge is 100 mm further out, meeting its neighbours at the corners.
    close(top[0], [0, 0]);
    close(top[1], [3000, 0]);
    close(top[2], [3100, -100]);
    close(top[3], [-100, -100]);
    close(right[2], [3100, 4100]);
    close(right[3], [3100, -100]);
  });

  it('mitres a concave (inside) corner correctly', () => {
    // L-shape; vertex 3 (2000, 2000) is the inside corner.
    const room: Room = {
      polygon: [
        [0, 0],
        [4000, 0],
        [4000, 2000],
        [2000, 2000],
        [2000, 4000],
        [0, 4000],
      ],
      walls: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, thicknessMm: 100 })),
      openings: [],
    };
    const quads = wallQuads(room);
    // Wall 2 (4000,2000)→(2000,2000) and wall 3 (2000,2000)→(2000,4000) meet at the outer point (2100, 2100).
    close(quads[2][2], [2100, 2100]);
    close(quads[3][3], [2100, 2100]);
  });

  it('uses each wall’s own thickness', () => {
    const room = rect();
    room.walls[0].thicknessMm = 300;
    const [top, right] = wallQuads(room);
    close(top[3], [-100, -300]);
    close(right[3], [3100, -300]);
  });

  it('handles a straight run (collinear walls) without blowing up', () => {
    const room: Room = {
      polygon: [
        [0, 0],
        [1500, 0],
        [3000, 0],
        [3000, 4000],
        [0, 4000],
      ],
      walls: ['a', 'a2', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
      openings: [],
    };
    const quads = wallQuads(room);
    close(quads[0][2], [1500, -100]);
    close(quads[1][3], [1500, -100]);
  });
});
