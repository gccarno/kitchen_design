/**
 * Measured walls are the scale source of truth. A room outline from the
 * vision LLM (or a rough hand sketch) has the right shape but a guessed
 * size; `rescaleRoomToMeasurements` scales it uniformly so the walls the
 * user measured come out at their measured lengths.
 */

import type { Point } from './geometry';
import type { Room } from './schemas';
import { wallLengthMm } from './validate';

/** Above this relative disagreement between measurements, the UI should warn. */
export const SCALE_DISAGREEMENT_WARN = 0.05;

export interface RescaleResult {
  room: Room;
  /** Uniform factor applied to the room. 1 when there are no measurements. */
  scale: number;
  /**
   * Largest relative error between a measured length and the resulting
   * wall length (0 = every measurement matches). Non-zero only when two or
   * more measurements disagree about the scale.
   */
  residual: number;
}

/**
 * Scale `room` uniformly about its first vertex. With one measurement the
 * measured wall matches exactly; with several, the scale is the mean of
 * their individual factors and `residual` reports how far off they are.
 * Opening positions and widths scale with their walls; heights don't (floor
 * measurements say nothing about vertical size). Throws if a measurement
 * names an unknown wall or a zero-length wall.
 */
export function rescaleRoomToMeasurements(room: Room): RescaleResult {
  const measurements = room.measurements ?? [];
  if (measurements.length === 0) return { room, scale: 1, residual: 0 };

  const factors = measurements.map((m) => {
    const i = room.walls.findIndex((w) => w.id === m.wallId);
    if (i < 0 || i >= room.polygon.length) throw new Error(`measurement references unknown wall "${m.wallId}"`);
    const current = wallLengthMm(room, i);
    if (current === 0) throw new Error(`wall "${m.wallId}" has zero length and cannot be scaled`);
    return { measured: m.lengthMm, current, factor: m.lengthMm / current };
  });

  const scale = factors.reduce((sum, f) => sum + f.factor, 0) / factors.length;
  const residual = Math.max(...factors.map((f) => Math.abs(f.current * scale - f.measured) / f.measured));

  const [ox, oy] = room.polygon[0];
  const polygon = room.polygon.map(([x, y]): Point => [ox + (x - ox) * scale, oy + (y - oy) * scale]);
  const openings = room.openings.map((o) => ({
    ...o,
    positionMm: o.positionMm * scale,
    widthMm: o.widthMm * scale,
  }));

  return { room: { ...room, polygon, openings }, scale, residual };
}
