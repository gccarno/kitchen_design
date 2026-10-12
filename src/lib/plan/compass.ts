import type { Point } from './geometry';

const NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Compass name of a direction vector in plan coordinates (x east, y south). */
export function compass([dx, dy]: Point): string {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = north, 90 = east
  return NAMES[((Math.round(deg / 45) % 8) + 8) % 8];
}
