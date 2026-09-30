import { describe, it, expect } from 'vitest';
import { positionItem, WALL_SNAP_MM } from './placement';
import { rotatedRectFootprint } from './geometry';
import type { Room } from './schemas';

const room: Room = {
  polygon: [
    [0, 0],
    [3000, 0],
    [3000, 4000],
    [0, 4000],
  ],
  walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
  openings: [],
};
const dishwasher = { w: 600, d: 580 };

const pose = (at: [number, number], mount: 'floor' | 'counter' | 'wall' = 'floor', size = dishwasher, rotationDeg?: number) =>
  positionItem(room, size, mount, at, { snapMm: 50, rotationDeg });

describe('positionItem', () => {
  it('puts the back flush against a nearby wall, facing into the room, snapped along it', () => {
    expect(pose([1234, 100])).toEqual({ position: { x: 1250, y: 290 }, rotationDeg: 0, wallIndex: 0 });
  });

  it('rotates to face into the room on each wall', () => {
    expect(pose([2900, 1000])).toEqual({ position: { x: 2710, y: 1000 }, rotationDeg: 90, wallIndex: 1 });
    expect(pose([1500, 3950])).toEqual({ position: { x: 1500, y: 3710 }, rotationDeg: 180, wallIndex: 2 });
    expect(pose([60, 2000])).toEqual({ position: { x: 290, y: 2000 }, rotationDeg: 270, wallIndex: 3 });
  });

  it('keeps the back on the wall: the footprint touches the wall and faces inward', () => {
    const p = pose([2900, 1000]);
    const xs = rotatedRectFootprint([p.position.x, p.position.y], 600, 580, p.rotationDeg).map((c) => c[0]);
    expect(Math.max(...xs)).toBeCloseTo(3000);
    expect(Math.min(...xs)).toBeCloseTo(2420);
  });

  it('slides into a corner instead of hanging off the end of the wall', () => {
    // (60, 40) is nearest the top wall; the item is pushed along it so it doesn't overhang the corner.
    expect(pose([60, 40]).position).toEqual({ x: 300, y: 290 });
  });

  it(`only snaps to a wall within the item's depth + ${WALL_SNAP_MM} mm`, () => {
    // 580 + 300 = 880 mm from the top wall is the limit.
    expect(pose([1500, 870]).wallIndex).toBe(0);
    expect(pose([1500, 900]).wallIndex).toBeNull();
  });

  it('places freely on the grid away from walls, keeping the given rotation', () => {
    expect(pose([1520, 2010], 'floor', { w: 1800, d: 900 }, 45)).toEqual({
      position: { x: 1500, y: 2000 },
      rotationDeg: 45,
      wallIndex: null,
    });
  });

  it('works without snapping', () => {
    const p = positionItem(room, dishwasher, 'floor', [1234, 100], { snapMm: 0 });
    expect(p.position).toEqual({ x: 1234, y: 290 });
  });

  it('refuses a wall-mounted item away from any wall', () => {
    expect(() => pose([1500, 2000], 'wall')).toThrow(/against a wall/);
  });

  it('refuses a spot outside the room', () => {
    expect(() => pose([6000, 2000])).toThrow(/inside the room/);
  });

  it('snaps to a wall from just outside it', () => {
    expect(pose([1500, -150]).position).toEqual({ x: 1500, y: 290 });
  });

  it('can be told which wall to use, even when another is nearer', () => {
    // (100, 60) is nearest the top wall; force the left wall (index 3) instead.
    const p = positionItem(room, dishwasher, 'floor', [100, 60], { snapMm: 50, wallIndex: 3 });
    expect(p).toEqual({ position: { x: 290, y: 300 }, rotationDeg: 270, wallIndex: 3 });
  });

  it('uses a forced wall even from far away', () => {
    const p = positionItem(room, dishwasher, 'floor', [1500, 2000], { snapMm: 50, wallIndex: 0 });
    expect(p).toEqual({ position: { x: 1500, y: 290 }, rotationDeg: 0, wallIndex: 0 });
  });
});
