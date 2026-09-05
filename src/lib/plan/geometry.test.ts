import { describe, it, expect } from 'vitest';
import {
  polygonAreaMm2,
  pointInPolygon,
  snapToGrid,
  rotateAround,
  polygonBounds,
  insetPolygon,
  distance,
  rectFootprint,
  rectsOverlap,
  segmentLength,
  pointToSegmentDistance,
  polygonCentroid,
  type Point,
  type Rect,
} from './geometry';

describe('polygonAreaMm2', () => {
  it('returns 0 for a degenerate (collinear) triangle', () => {
    expect(polygonAreaMm2([[0, 0], [100, 0], [200, 0]])).toBe(0);
  });

  it('returns the area of a CCW square (positive)', () => {
    expect(polygonAreaMm2([[0, 0], [1000, 0], [1000, 1000], [0, 1000]])).toBe(1_000_000);
  });

  it('returns the positive area for a CW square (magnitude is the same)', () => {
    expect(polygonAreaMm2([[0, 0], [0, 1000], [1000, 1000], [1000, 0]])).toBe(1_000_000);
  });

  it('returns the area of a 3x4x5 right triangle', () => {
    // Triangle with legs 3000 and 4000 = 6_000_000
    expect(polygonAreaMm2([[0, 0], [3000, 0], [0, 4000]])).toBe(6_000_000);
  });
});

describe('pointInPolygon', () => {
  const square: Point[] = [
    [0, 0],
    [1000, 0],
    [1000, 1000],
    [0, 1000],
  ];

  it('returns true for the centroid', () => {
    expect(pointInPolygon([500, 500], square)).toBe(true);
  });

  it('returns false for a point clearly outside', () => {
    expect(pointInPolygon([2000, 500], square)).toBe(false);
  });

  it('returns false for a point just outside an edge', () => {
    expect(pointInPolygon([500, 1001], square)).toBe(false);
    expect(pointInPolygon([-1, 500], square)).toBe(false);
  });

  it('handles a concave polygon (L-shape) correctly', () => {
    const lShape: Point[] = [
      [0, 0],
      [1000, 0],
      [1000, 500],
      [500, 500],
      [500, 1000],
      [0, 1000],
    ];
    // In the notch
    expect(pointInPolygon([750, 750], lShape)).toBe(false);
    // In the bottom rectangle
    expect(pointInPolygon([250, 250], lShape)).toBe(true);
    // In the left vertical strip
    expect(pointInPolygon([250, 750], lShape)).toBe(true);
  });
});

describe('snapToGrid', () => {
  it('rounds to the nearest grid step', () => {
    expect(snapToGrid([123, 477], 50)).toEqual([100, 500]);
  });

  it('snaps exactly halfway to the higher step', () => {
    expect(snapToGrid([125, 0], 50)).toEqual([150, 0]);
  });

  it('handles negative coordinates', () => {
    expect(snapToGrid([-23, -77], 10)).toEqual([-20, -80]);
  });

  it('preserves zero', () => {
    expect(snapToGrid([0, 0], 100)).toEqual([0, 0]);
  });
});

describe('rotateAround', () => {
  it('rotates 90° CCW around the origin', () => {
    const r = rotateAround([100, 0], [0, 0], 90);
    expect(r[0]).toBeCloseTo(0);
    expect(r[1]).toBeCloseTo(100);
  });

  it('rotates 180° around an arbitrary center', () => {
    const r = rotateAround([1100, 500], [500, 500], 180);
    expect(r[0]).toBeCloseTo(-100);
    expect(r[1]).toBeCloseTo(500);
  });

  it('returns the point unchanged at 0°', () => {
    const r = rotateAround([123, 456], [0, 0], 0);
    expect(r[0]).toBeCloseTo(123);
    expect(r[1]).toBeCloseTo(456);
  });

  it('rotates 360° back to the original', () => {
    const r = rotateAround([300, 400], [0, 0], 360);
    expect(r[0]).toBeCloseTo(300);
    expect(r[1]).toBeCloseTo(400);
  });
});

describe('polygonBounds', () => {
  it('returns the axis-aligned bounding box', () => {
    const p: Point[] = [
      [100, 200],
      [800, 50],
      [600, 900],
    ];
    const b = polygonBounds(p);
    expect(b.minX).toBe(100);
    expect(b.minY).toBe(50);
    expect(b.maxX).toBe(800);
    expect(b.maxY).toBe(900);
  });
});

describe('insetPolygon', () => {
  it('shrinks a square by the given inset', () => {
    const square: Point[] = [
      [0, 0],
      [1000, 0],
      [1000, 1000],
      [0, 1000],
    ];
    const inset = insetPolygon(square, 100);
    // Area should drop by 2*inset*(w + h) = 2*100*2000 = 400_000; new area = 600_000
    expect(polygonAreaMm2(inset)).toBeCloseTo(640_000, -2);
  });

  it('returns an empty array when inset is larger than half the width', () => {
    const square: Point[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    expect(insetPolygon(square, 200)).toEqual([]);
  });
});

describe('distance', () => {
  it('returns Euclidean distance', () => {
    expect(distance([0, 0], [3, 4])).toBe(5);
  });

  it('returns 0 for the same point', () => {
    expect(distance([7, 7], [7, 7])).toBe(0);
  });
});

describe('rectFootprint', () => {
  it('returns a closed rectangle at the given origin, axis-aligned, w×d', () => {
    const r: Rect = { x: 100, y: 200, w: 600, d: 400, rotationDeg: 0 };
    const f = rectFootprint(r);
    expect(f).toEqual([
      [100, 200],
      [700, 200],
      [700, 600],
      [100, 600],
    ]);
  });
});

describe('rectsOverlap', () => {
  const r = (x: number, y: number): Rect => ({ x, y, w: 600, d: 400, rotationDeg: 0 });

  it('returns true for two overlapping rects', () => {
    expect(rectsOverlap(r(0, 0), r(500, 0))).toBe(true);
  });

  it('returns false for two disjoint rects', () => {
    expect(rectsOverlap(r(0, 0), r(1000, 0))).toBe(false);
  });

  it('returns false for two rects that just touch (zero overlap)', () => {
    // edges meet at x=600; not overlapping
    expect(rectsOverlap(r(0, 0), r(600, 0))).toBe(false);
  });
});

describe('segmentLength', () => {
  it('returns 0 for a zero-length segment', () => {
    expect(segmentLength([5, 5], [5, 5])).toBe(0);
  });

  it('returns the Euclidean length', () => {
    expect(segmentLength([0, 0], [3, 4])).toBe(5);
  });
});

describe('pointToSegmentDistance', () => {
  it('returns 0 for a point on the segment', () => {
    expect(pointToSegmentDistance([5, 0], [0, 0], [10, 0])).toBe(0);
  });

  it('returns the perpendicular distance to a horizontal segment', () => {
    expect(pointToSegmentDistance([5, 3], [0, 0], [10, 0])).toBe(3);
  });

  it('returns distance to the nearest endpoint for points past the segment', () => {
    // segment from (0,0) to (1,0); point (2,0) is past the right end
    expect(pointToSegmentDistance([2, 0], [0, 0], [1, 0])).toBe(1);
    // point (-1,0) is past the left end
    expect(pointToSegmentDistance([-1, 0], [0, 0], [1, 0])).toBe(1);
  });
});

describe('polygonCentroid', () => {
  it('returns the centroid of a square', () => {
    const c = polygonCentroid([
      [0, 0],
      [1000, 0],
      [1000, 1000],
      [0, 1000],
    ]);
    expect(c[0]).toBeCloseTo(500);
    expect(c[1]).toBeCloseTo(500);
  });

  it('returns the centroid of a triangle', () => {
    const c = polygonCentroid([
      [0, 0],
      [3000, 0],
      [0, 6000],
    ]);
    expect(c[0]).toBeCloseTo(1000);
    expect(c[1]).toBeCloseTo(2000);
  });
});
