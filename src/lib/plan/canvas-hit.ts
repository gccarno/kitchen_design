import { pointToSegmentDistance, type Point } from './geometry';
import type { Room } from './schemas';
import { worldToScreen, type Viewport } from './viewport';

export type CanvasHit =
  | { kind: 'vertex'; index: number }
  /** An end handle of an opening: drag to resize. */
  | { kind: 'opening-end'; id: string; edge: 'start' | 'end' }
  /** The body of an opening: drag to slide it along its wall, tap to select. */
  | { kind: 'opening'; id: string }
  /** The "+" handle at the middle of edge `index`; `point` is the midpoint in world mm. */
  | { kind: 'edge'; index: number; point: Point }
  | null;

/**
 * What an editing gesture at `screen` grabs, in priority order: the nearest
 * corner, an opening's end handle, an opening's body, a wall's "+" handle —
 * else nothing (pan). Measured in screen pixels so handles are equally easy
 * to hit at any zoom.
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
  const spans = room.openings.flatMap((o) => {
    const i = room.walls.findIndex((w) => w.id === o.wallId);
    if (i < 0 || i >= n) return [];
    const [a, b] = [room.polygon[i], room.polygon[(i + 1) % n]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const at = (mm: number): Point => [a[0] + ((b[0] - a[0]) * mm) / len, a[1] + ((b[1] - a[1]) * mm) / len];
    return [{ id: o.id, start: at(o.positionMm), end: at(o.positionMm + o.widthMm) }];
  });
  for (const s of spans) {
    if (d(s.start) <= tolerancePx) return { kind: 'opening-end', id: s.id, edge: 'start' };
    if (d(s.end) <= tolerancePx) return { kind: 'opening-end', id: s.id, edge: 'end' };
  }
  for (const s of spans) {
    if (pointToSegmentDistance(screen, worldToScreen(v, s.start), worldToScreen(v, s.end)) <= tolerancePx) {
      return { kind: 'opening', id: s.id };
    }
  }

  for (let index = 0; index < n; index++) {
    const [a, b] = [room.polygon[index], room.polygon[(index + 1) % n]];
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (d(mid) <= tolerancePx) return { kind: 'edge', index, point: mid };
  }
  return null;
}
