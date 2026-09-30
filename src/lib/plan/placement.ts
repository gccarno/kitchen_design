/**
 * Where a catalog item goes when dropped on the plan. Kitchen items live
 * against walls, so near a wall the item's back goes flush to it, facing
 * into the room; elsewhere it lands on the grid. Local frame: width along
 * x, depth along y, front facing +y at rotation 0.
 */

import { pointInPolygon, type Point } from './geometry';
import { alongWallMm, nearestWallPoint } from './openings';
import type { CatalogItem } from '../catalog/schema';
import type { Mount, PlacedItem, Room } from './schemas';
import { inwardNormal } from './walls';

/** Snap to a wall when the drop point is within the item's depth plus this much of it. */
export const WALL_SNAP_MM = 300;

export interface ItemPose {
  position: { x: number; y: number };
  rotationDeg: number;
  /** The wall the item was set against, or null for free placement. */
  wallIndex: number | null;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const snap = (n: number, step: number) => (step > 0 ? Math.round(n / step) * step : n);

export function positionItem(
  room: Room,
  size: { w: number; d: number },
  mount: Mount,
  at: Point,
  opts: { snapMm?: number; rotationDeg?: number; wallIndex?: number } = {}
): ItemPose {
  const step = opts.snapMm ?? 0;
  // A forced wall (e.g. "against the north wall") skips the nearest-wall search.
  const near =
    opts.wallIndex === undefined
      ? nearestWallPoint(room, at)
      : { wallIndex: opts.wallIndex, alongMm: alongWallMm(room, opts.wallIndex, at), distanceMm: 0 };
  let pose: ItemPose;

  if (near.distanceMm <= size.d + WALL_SNAP_MM) {
    const i = near.wallIndex;
    const n = room.polygon.length;
    const [a, b] = [room.polygon[i], room.polygon[(i + 1) % n]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const [nx, ny] = inwardNormal(room, i);
    const half = size.w / 2;
    const along = len < size.w ? len / 2 : Math.min(Math.max(snap(near.alongMm, step), half), len - half);
    const rotation = (Math.atan2(-nx, ny) * 180) / Math.PI;
    pose = {
      position: {
        x: round(a[0] + ux * along + nx * (size.d / 2)),
        y: round(a[1] + uy * along + ny * (size.d / 2)),
      },
      rotationDeg: round(((rotation % 360) + 360) % 360),
      wallIndex: i,
    };
  } else {
    if (mount === 'wall') throw new Error('wall-mounted items go against a wall');
    pose = {
      position: { x: snap(at[0], step), y: snap(at[1], step) },
      rotationDeg: opts.rotationDeg ?? 0,
      wallIndex: null,
    };
  }

  if (!pointInPolygon([pose.position.x, pose.position.y], room.polygon as Point[])) {
    throw new Error('place it inside the room');
  }
  return pose;
}

/** A placed item for catalog item `item` at `pose`, snapshotting what validation needs. */
export function placedFromCatalog(item: CatalogItem, pose: ItemPose, id: string): PlacedItem {
  return {
    id,
    catalogId: item.id,
    sizeMm: item.sizeMm,
    ...(item.mount !== 'floor' ? { mount: item.mount } : {}),
    ...(item.clearanceMm ? { clearanceMm: item.clearanceMm } : {}),
    ...(item.tags[0] ? { tag: item.tags[0] } : {}),
    position: pose.position,
    rotationDeg: pose.rotationDeg,
  };
}
