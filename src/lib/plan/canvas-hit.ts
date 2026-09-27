import type { Point } from './geometry';
import type { Room } from './schemas';
import { worldToScreen, type Viewport } from './viewport';

export type CanvasHit =
  | { kind: 'vertex'; index: number }
  /** The "+" handle at the middle of edge `index`; `point` is the midpoint in world mm. */
  | { kind: 'edge'; index: number; point: Point }
  | null;

/**
 * What an editing gesture at `screen` grabs: the nearest corner within
 * `tolerancePx`, else an edge-midpoint handle, else nothing (pan). Measured
 * in screen pixels so handles are equally easy to hit at any zoom.
 */
export function hitTest(room: Room, v: Viewport, screen: Point, tolerancePx: number): CanvasHit {
  const d = (p: Point) => {
    const s = worldToScreen(v, p);
    return Math.hypot(s[0] - screen[0], s[1] - screen[1]);
  };

  let bestIndex = -1;
  let bestDist = tolerancePx;
  for (let i = 0; i < room.polygon.length; i++) {
    const dist = d(room.polygon[i] as Point);
    if (dist <= bestDist) {
      bestIndex = i;
      bestDist = dist;
    }
  }
  if (bestIndex >= 0) return { kind: 'vertex', index: bestIndex };

  const n = room.polygon.length;
  for (let index = 0; index < n; index++) {
    const [a, b] = [room.polygon[index], room.polygon[(index + 1) % n]];
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (d(mid) <= tolerancePx) return { kind: 'edge', index, point: mid };
  }
  return null;
}
