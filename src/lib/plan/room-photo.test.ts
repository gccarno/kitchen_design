// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../catalog/loader';
import { compileCommands, type Command } from './commands';
import { pointInPolygon, rotatedRectFootprint, type Point } from './geometry';
import { cornerViews, renderRoomPhoto, type Camera, type RoomPhoto } from './room-photo';
import type { Project } from './schemas';

const catalog = loadCatalog();

/** A 4 m × 3 m room: w1 top, w2 right, w3 bottom, w4 left. */
function room(commands: Command[] = [], polygon: Point[] = [[0, 0], [4000, 0], [4000, 3000], [0, 3000]]): Project {
  const empty: Project = {
    id: randomUUID(),
    name: 'Room',
    kind: 'kitchen',
    units: 'mm',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0,
    photos: [],
    room: { polygon, walls: polygon.map(() => ({ id: randomUUID(), thicknessMm: 100 })), openings: [] },
    items: [],
    history: [],
  };
  return compileCommands(empty, commands, catalog, randomUUID).project;
}

const SIZE = { width: 320, height: 240 };
const pixel = (p: RoomPhoto, x: number, y: number) => [...p.rgb.subarray((y * p.width + x) * 3, (y * p.width + x) * 3 + 3)];
const centre = (p: RoomPhoto) => pixel(p, p.width / 2, p.height / 2);
const brightness = ([r, g, b]: number[]) => r + g + b;
const isGlass = ([r, , b]: number[]) => b > r + 20;
const anyPixel = (p: RoomPhoto, test: (rgb: number[]) => boolean) => {
  for (let i = 0; i < p.width * p.height; i++) if (test([...p.rgb.subarray(i * 3, i * 3 + 3)])) return true;
  return false;
};

/** From the middle of the room, facing a point on a wall. */
const facing = (lookAt: Point): Camera => ({ position: [2000, 1500], lookAt });

describe('renderRoomPhoto', () => {
  it('gives the size asked for, filled in, and the same bytes every time', () => {
    const plan = room([{ type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 2000, widthMm: 1000 }]);
    const a = renderRoomPhoto(plan, facing([2000, 0]), SIZE);
    expect(a.rgb).toHaveLength(320 * 240 * 3);
    expect(renderRoomPhoto(plan, facing([2000, 0]), SIZE).rgb).toEqual(a.rgb);
    expect(renderRoomPhoto(plan, facing([2000, 0])).width).toBe(1024);
  });

  it('shows ceiling above, a lit wall ahead and floor below', () => {
    const p = renderRoomPhoto(room(), { position: [2000, 2800], lookAt: [2000, 0] }, SIZE);
    const [top, mid, bottom] = [pixel(p, 160, 2), centre(p), pixel(p, 160, 237)];
    expect(brightness(mid)).toBeGreaterThan(450);
    expect(top).not.toEqual(mid);
    expect(bottom).not.toEqual(mid);
  });

  it('shows a window as glass in the wall it is in, and not from a camera facing away', () => {
    const plan = room([{ type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 2000, widthMm: 1200 }]);
    // Aim left of the middle bar of the window.
    expect(isGlass(centre(renderRoomPhoto(plan, facing([1750, 0]), SIZE)))).toBe(true);
    expect(isGlass(centre(renderRoomPhoto(room(), facing([1750, 0]), SIZE)))).toBe(false);
    expect(anyPixel(renderRoomPhoto(plan, facing([2000, 3000]), SIZE), isGlass)).toBe(false);
  });

  it('shows a doorway as a dark gap in a light wall', () => {
    // w3 runs right to left along the bottom: 3000 mm along it is x = 1000.
    const plan = room([{ type: 'addOpening', wall: 'w3', kind: 'door', alongMm: 3000 }]);
    const door = centre(renderRoomPhoto(plan, facing([1000, 3000]), SIZE));
    const wall = centre(renderRoomPhoto(plan, facing([3000, 3000]), SIZE));
    expect(brightness(door)).toBeLessThan(300);
    expect(brightness(wall)).toBeGreaterThan(450);
  });

  it('draws what is nearer in front: a fridge hides the window behind it', () => {
    const window: Command = { type: 'addOpening', wall: 'w1', kind: 'window', alongMm: 2000, widthMm: 1200 };
    const bare = renderRoomPhoto(room([window]), facing([1750, 0]), SIZE);
    const withFridge = renderRoomPhoto(room([window, { type: 'addItem', catalogId: 'fridge-600', x: 1750, y: 700 }]), facing([1750, 0]), SIZE);
    expect(isGlass(centre(bare))).toBe(true);
    expect(isGlass(centre(withFridge))).toBe(false);
  });

  it('copes with a cabinet right at the lens', () => {
    const plan = room([{ type: 'addItem', catalogId: 'fridge-600', x: 2000, y: 1500 }]);
    expect(() => renderRoomPhoto(plan, facing([2000, 0]), SIZE)).not.toThrow();
  });
});

describe('cornerViews', () => {
  it('stands in each corner, inside the room, facing the middle', () => {
    const plan = room();
    const views = cornerViews(plan);
    expect(views).toHaveLength(4);
    for (const v of views) {
      expect(pointInPolygon(v.position, plan.room.polygon as Point[])).toBe(true);
      expect(v.lookAt).toEqual([2000, 1500]);
    }
    expect(views[0].position[0]).toBeGreaterThan(200);
    expect(views[0].position[0]).toBeLessThan(600);
  });

  it('gives one view per corner of a room that is not a rectangle', () => {
    const l: Point[] = [[0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 4000], [0, 4000]];
    expect(cornerViews(room([], l))).toHaveLength(6);
  });

  it('steps further in when a corner is full of cabinets', () => {
    const plan = room([{ type: 'addItem', catalogId: 'fridge-600', x: 350, y: 350 }]);
    const [first] = cornerViews(plan);
    const fridge = plan.items[0];
    const footprint = rotatedRectFootprint([fridge.position.x, fridge.position.y], fridge.sizeMm.w, fridge.sizeMm.d, fridge.rotationDeg);
    expect(pointInPolygon(first.position, footprint)).toBe(false);
    expect(first.position[0]).toBeGreaterThan(cornerViews(room())[0].position[0]);
  });
});
