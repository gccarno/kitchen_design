import { describe, it, expect } from 'vitest';
import {
  fitToBounds,
  worldToScreen,
  screenToWorld,
  zoomAt,
  pan,
  pinch,
  rulerTicks,
  gridStepMm,
  formatLength,
  MIN_SCALE,
  MAX_SCALE,
  type Viewport,
} from './viewport';

const close = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe('fitToBounds', () => {
  it('fits a 3000 × 4000 room into 800 × 600 px, centred, with padding', () => {
    const v = fitToBounds({ minX: 0, minY: 0, maxX: 3000, maxY: 4000 }, 800, 600, 0.1);
    // Height-limited: 600 * 0.8 / 4000 = 0.12 px/mm.
    expect(v.scale).toBeCloseTo(0.12);
    close(worldToScreen(v, [1500, 2000]), [400, 300]);
  });

  it('handles an offset room', () => {
    const v = fitToBounds({ minX: 1000, minY: 1000, maxX: 2000, maxY: 2000 }, 500, 500, 0);
    close(worldToScreen(v, [1000, 1000]), [0, 0]);
    close(worldToScreen(v, [2000, 2000]), [500, 500]);
  });

  it('clamps the scale for a degenerate room', () => {
    const v = fitToBounds({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 500, 500);
    expect(v.scale).toBe(MAX_SCALE);
  });
});

describe('screen/world transforms', () => {
  it('round-trips', () => {
    const v: Viewport = { scale: 0.25, x: 40, y: -10 };
    close(screenToWorld(v, worldToScreen(v, [1234, 567])), [1234, 567]);
  });
});

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    const v: Viewport = { scale: 0.1, x: 50, y: 20 };
    const cursor: [number, number] = [300, 200];
    const before = screenToWorld(v, cursor);
    const z = zoomAt(v, cursor, 2);
    expect(z.scale).toBeCloseTo(0.2);
    close(screenToWorld(z, cursor), before);
  });

  it('clamps to the scale limits', () => {
    expect(zoomAt({ scale: MAX_SCALE, x: 0, y: 0 }, [0, 0], 10).scale).toBe(MAX_SCALE);
    expect(zoomAt({ scale: MIN_SCALE, x: 0, y: 0 }, [0, 0], 0.01).scale).toBe(MIN_SCALE);
  });
});

describe('pan', () => {
  it('moves the view by screen pixels', () => {
    expect(pan({ scale: 1, x: 5, y: 5 }, 10, -3)).toEqual({ scale: 1, x: 15, y: 2 });
  });
});

describe('pinch', () => {
  it('zooms by the change in finger distance about the midpoint', () => {
    const v: Viewport = { scale: 0.1, x: 0, y: 0 };
    const mid = screenToWorld(v, [200, 200]);
    const next = pinch(v, [[150, 200], [250, 200]], [[100, 200], [300, 200]]);
    expect(next.scale).toBeCloseTo(0.2);
    close(screenToWorld(next, [200, 200]), mid);
  });

  it('pans when both fingers move together', () => {
    const v: Viewport = { scale: 0.1, x: 0, y: 0 };
    const next = pinch(v, [[100, 100], [200, 100]], [[130, 140], [230, 140]]);
    expect(next.scale).toBeCloseTo(0.1);
    expect(next.x).toBeCloseTo(30);
    expect(next.y).toBeCloseTo(40);
  });

  it('ignores fingers on the same spot', () => {
    const v: Viewport = { scale: 0.1, x: 0, y: 0 };
    expect(pinch(v, [[5, 5], [5, 5]], [[9, 9], [9, 9]])).toEqual(v);
  });
});

describe('rulerTicks', () => {
  it('picks the smallest nice metric step at least minSpacing apart', () => {
    // 0.1 px/mm: 500 mm = 50 px (< 60), 1000 mm = 100 px.
    const r = rulerTicks(0.1, 0, 400, 'mm', 60);
    expect(r.stepMm).toBe(1000);
    expect(r.ticks.map((t) => t.label)).toEqual(['0', '1 m', '2 m', '3 m', '4 m']);
    expect(r.ticks.map((t) => t.px)).toEqual([0, 100, 200, 300, 400]);
  });

  it('labels sub-metre steps in mm and follows the offset', () => {
    // 0.5 px/mm, offset 25 px → world 0 is at px 25; step 200 mm = 100 px.
    const r = rulerTicks(0.5, 25, 260, 'mm', 60);
    expect(r.stepMm).toBe(200);
    expect(r.ticks.map((t) => [t.px, t.label])).toEqual([
      [25, '0'],
      [125, '200 mm'],
      [225, '400 mm'],
    ]);
  });

  it('uses feet and inches for imperial projects', () => {
    // 0.2 px/mm: 12" = 304.8 mm = 61 px.
    const r = rulerTicks(0.2, 0, 200, 'in', 60);
    expect(r.stepMm).toBeCloseTo(304.8);
    expect(r.ticks.map((t) => t.label)).toEqual(['0', `1'`, `2'`, `3'`]);
  });

  it('includes negative positions when the view is scrolled left of the origin', () => {
    const r = rulerTicks(0.1, 150, 400, 'mm', 60);
    expect(r.ticks[0]).toEqual({ px: 50, label: '-1 m' });
  });
});

describe('gridStepMm', () => {
  it('coarsens the grid as you zoom out', () => {
    expect(gridStepMm(1)).toBe(100);
    expect(gridStepMm(0.1)).toBe(500);
    expect(gridStepMm(0.02)).toBe(1000);
  });
});

describe('formatLength', () => {
  it('formats millimetres', () => {
    expect(formatLength(3600, 'mm')).toBe('3600 mm');
    expect(formatLength(3599.6, 'mm')).toBe('3600 mm');
  });

  it('formats feet and inches to the nearest quarter inch', () => {
    expect(formatLength(3600, 'in')).toBe(`11' 9 3/4"`);
    expect(formatLength(304.8, 'in')).toBe(`1' 0"`);
    expect(formatLength(12.7, 'in')).toBe(`1/2"`);
  });
});
