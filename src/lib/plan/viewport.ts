/**
 * Pure viewport math for the floor-plan canvas. A viewport maps world
 * millimetres to screen pixels: screen = world × scale + (x, y). Keeping
 * this free of Konva and the DOM makes pan/zoom/pinch unit-testable.
 */

import type { Bounds, Point } from './geometry';

export interface Viewport {
  /** Screen pixels per millimetre. */
  scale: number;
  x: number;
  y: number;
}

/** 10 m fits in 50 px at the minimum; 1 mm is 2 px at the maximum. */
export const MIN_SCALE = 0.005;
export const MAX_SCALE = 2;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function worldToScreen(v: Viewport, p: Point): Point {
  return [p[0] * v.scale + v.x, p[1] * v.scale + v.y];
}

export function screenToWorld(v: Viewport, p: Point): Point {
  return [(p[0] - v.x) / v.scale, (p[1] - v.y) / v.scale];
}

/** Centre `bounds` in a width × height view, leaving `padding` (fraction per side). */
export function fitToBounds(bounds: Bounds, width: number, height: number, padding = 0.08): Viewport {
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const usable = 1 - 2 * padding;
  const scale = clampScale(Math.min((width * usable) / bw, (height * usable) / bh));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { scale, x: width / 2 - cx * scale, y: height / 2 - cy * scale };
}

/** Zoom by `factor`, keeping the world point under `screenPoint` fixed. */
export function zoomAt(v: Viewport, screenPoint: Point, factor: number): Viewport {
  const world = screenToWorld(v, screenPoint);
  const scale = clampScale(v.scale * factor);
  return { scale, x: screenPoint[0] - world[0] * scale, y: screenPoint[1] - world[1] * scale };
}

export function pan(v: Viewport, dx: number, dy: number): Viewport {
  return { scale: v.scale, x: v.x + dx, y: v.y + dy };
}

/**
 * Two-finger gesture: zoom by the change in finger distance and move so the
 * world point under the old midpoint ends up under the new midpoint (which
 * also pans when both fingers move together).
 */
export function pinch(v: Viewport, prev: [Point, Point], next: [Point, Point]): Viewport {
  const d0 = Math.hypot(prev[1][0] - prev[0][0], prev[1][1] - prev[0][1]);
  const d1 = Math.hypot(next[1][0] - next[0][0], next[1][1] - next[0][1]);
  if (d0 === 0 || d1 === 0) return v;
  const mid0: Point = [(prev[0][0] + prev[1][0]) / 2, (prev[0][1] + prev[1][1]) / 2];
  const mid1: Point = [(next[0][0] + next[1][0]) / 2, (next[0][1] + next[1][1]) / 2];
  const world = screenToWorld(v, mid0);
  const scale = clampScale(v.scale * (d1 / d0));
  return { scale, x: mid1[0] - world[0] * scale, y: mid1[1] - world[1] * scale };
}

const METRIC_STEPS_MM = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000];
const IMPERIAL_STEPS_IN = [1, 2, 3, 6, 12, 24, 36, 60, 120, 240, 600];
const MM_PER_IN = 25.4;

export interface RulerTick {
  px: number;
  label: string;
}

/**
 * Ticks for a ruler along one screen axis. `offsetPx` is where world 0 sits
 * on that axis (viewport x or y). Picks the smallest "nice" step at least
 * `minSpacingPx` apart; labels in metres/mm or feet/inches.
 */
export function rulerTicks(
  scale: number,
  offsetPx: number,
  lengthPx: number,
  units: 'mm' | 'in',
  minSpacingPx = 60
): { stepMm: number; ticks: RulerTick[] } {
  const stepsMm = units === 'mm' ? METRIC_STEPS_MM : IMPERIAL_STEPS_IN.map((s) => s * MM_PER_IN);
  const stepMm = stepsMm.find((s) => s * scale >= minSpacingPx) ?? stepsMm[stepsMm.length - 1];

  const firstWorld = Math.ceil((0 - offsetPx) / scale / stepMm) * stepMm;
  const ticks: RulerTick[] = [];
  for (let w = firstWorld; w * scale + offsetPx <= lengthPx + 1e-6; w += stepMm) {
    const px = Math.round((w * scale + offsetPx) * 1000) / 1000;
    ticks.push({ px, label: tickLabel(Math.round(w * 1000) / 1000, stepMm, units) });
  }
  return { stepMm, ticks };
}

function tickLabel(mm: number, stepMm: number, units: 'mm' | 'in'): string {
  if (Math.abs(mm) < 1e-6) return '0';
  if (units === 'mm') {
    return stepMm >= 1000 ? `${trim(mm / 1000)} m` : `${Math.round(mm)} mm`;
  }
  const inches = Math.round(mm / MM_PER_IN);
  const sign = inches < 0 ? '-' : '';
  const abs = Math.abs(inches);
  const ft = Math.floor(abs / 12);
  const rest = abs % 12;
  if (ft === 0) return `${sign}${rest}"`;
  return rest === 0 ? `${sign}${ft}'` : `${sign}${ft}' ${rest}"`;
}

const trim = (n: number) => String(Math.round(n * 100) / 100);

/** Grid spacing that stays at least ~20 px apart on screen. */
export function gridStepMm(scale: number): number {
  return [100, 500, 1000, 5000].find((s) => s * scale >= 20) ?? 5000;
}

/** A length for display: "3600 mm", or feet and inches to the nearest ¼". */
export function formatLength(mm: number, units: 'mm' | 'in'): string {
  if (units === 'mm') return `${Math.round(mm)} mm`;
  const quarters = Math.round((mm / MM_PER_IN) * 4);
  const ft = Math.floor(quarters / 48);
  const inQuarters = quarters - ft * 48;
  const whole = Math.floor(inQuarters / 4);
  const frac = ['', '1/4', '1/2', '3/4'][inQuarters % 4];
  const inches = whole === 0 && frac ? frac : frac ? `${whole} ${frac}` : `${whole}`;
  return ft > 0 ? `${ft}' ${inches}"` : `${inches}"`;
}
