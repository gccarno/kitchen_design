/**
 * A picture of a kitchen plan from inside the room, as a phone would take it:
 * the 3D scene's prisms drawn in perspective from eye height, with a depth
 * buffer. Used to make sample photos whose true room is known (tests, and
 * checking the photo → room extraction against a real model). Pure and
 * deterministic: the same plan and camera give the same bytes.
 */

import { pointInPolygon, pointToSegmentDistance, polygonCentroid, rotatedRectFootprint, type Point } from './geometry';
import { buildScene, SCENE_COLORS, type Prism } from './scene3d';
import type { Project } from './schemas';

export interface Camera {
  /** Where the photographer stands, plan mm. */
  position: Point;
  /** The point on the plan the camera faces. */
  lookAt: Point;
  /** Lens height above the floor, mm. */
  eyeMm?: number;
  /** Horizontal field of view; a phone's main camera is about 70–80°. */
  fovDeg?: number;
}

export interface RoomPhoto {
  width: number;
  height: number;
  /** width × height × 3 bytes, RGB, top row first. */
  rgb: Uint8Array;
}

export const PHOTO_COLORS = {
  ceiling: '#f7f5f0',
  /** What shows through a doorway. */
  beyond: '#4f4a45',
  frame: '#fbfaf7',
} as const;

const NEAR_MM = 30;
/** How far the photographer keeps from cabinets and appliances. */
const CLEAR_OF_ITEMS_MM = 250;
const DEFAULT_EYE_MM = 1500;
const DEFAULT_FOV_DEG = 75;
/** Sun direction for flat shading: faces at different angles come out in different tones. */
const LIGHT = [0.35, 0.5, 0.79] as const;

type Vec3 = [number, number, number];
type Pattern = 'plain' | 'outlined' | 'floor' | 'wall' | 'pane';

interface Face {
  /** World corners: plan x, plan y, height. */
  corners: Vec3[];
  /** Position on the face in mm, per corner: drives outlines, floorboards and the like. */
  uv: [number, number][];
  /** Face size in the same mm, for patterns that need the far edges. */
  size: [number, number];
  normal: Vec3;
  color: string;
  pattern: Pattern;
}

/**
 * Stand in each corner of the room, a step in from the walls, facing the middle.
 * Where a cabinet or appliance fills the corner, step further in until clear of it.
 */
export function cornerViews(project: Project, stepInMm = 450): Camera[] {
  const poly = project.room.polygon as Point[];
  const centre = polygonCentroid(poly);
  const footprints = project.items.map((it) => rotatedRectFootprint([it.position.x, it.position.y], it.sizeMm.w, it.sizeMm.d, it.rotationDeg));
  const crowded = (p: Point) =>
    footprints.some((fp) => pointInPolygon(p, fp) || fp.some((a, i) => pointToSegmentDistance(p, a, fp[(i + 1) % fp.length]) < CLEAR_OF_ITEMS_MM));
  return poly.map((corner) => {
    const toCentre = Math.hypot(centre[0] - corner[0], centre[1] - corner[1]) || 1;
    const at = (mm: number): Point => [corner[0] + ((centre[0] - corner[0]) * mm) / toCentre, corner[1] + ((centre[1] - corner[1]) * mm) / toCentre];
    // Never past three quarters of the way: a view from the middle shows too little.
    const furthest = toCentre * 0.75;
    let step = Math.min(stepInMm, furthest);
    while (step < furthest && crowded(at(step))) step = Math.min(furthest, step + 100);
    return { position: at(step), lookAt: centre };
  });
}

export function renderRoomPhoto(project: Project, camera: Camera, size: { width: number; height: number } = { width: 1024, height: 768 }): RoomPhoto {
  const { width, height } = size;
  const scene = buildScene(project);
  const eye = camera.eyeMm ?? DEFAULT_EYE_MM;
  const focal = width / 2 / Math.tan((((camera.fovDeg ?? DEFAULT_FOV_DEG) / 2) * Math.PI) / 180);

  // Forward and right on the plan. Plan y runs down the page, so right of "east" is "south".
  const dx = camera.lookAt[0] - camera.position[0];
  const dy = camera.lookAt[1] - camera.position[1];
  const len = Math.hypot(dx, dy) || 1;
  const forward: Point = [dx / len, dy / len];
  const right: Point = [-forward[1], forward[0]];

  const rgb = new Uint8Array(width * height * 3);
  const depth = new Float32Array(width * height); // 1/distance: larger is nearer, 0 is empty
  const beyond = parseColor(PHOTO_COLORS.beyond);
  for (let i = 0; i < width * height; i++) rgb.set(beyond, i * 3);

  for (const face of facesOf(scene.prisms, scene.bounds, scene.ceilingMm)) {
    // Camera space: x right, y up, d forward.
    let poly = face.corners.map(([x, y, z], i) => {
      const px = x - camera.position[0];
      const py = y - camera.position[1];
      return { x: px * right[0] + py * right[1], y: z - eye, d: px * forward[0] + py * forward[1], u: face.uv[i][0], v: face.uv[i][1] };
    });
    poly = clipNear(poly);
    if (poly.length < 3) continue;
    const base = parseColor(face.color);
    const lit = 0.58 + 0.42 * Math.abs(face.normal[0] * LIGHT[0] + face.normal[1] * LIGHT[1] + face.normal[2] * LIGHT[2]);
    const screen = poly.map((p) => ({ sx: width / 2 + (p.x / p.d) * focal, sy: height / 2 - (p.y / p.d) * focal, w: 1 / p.d, uw: p.u / p.d, vw: p.v / p.d }));
    for (let i = 1; i + 1 < screen.length; i++) {
      fillTriangle(screen[0], screen[i], screen[i + 1], width, height, depth, (index, w, u, v) => {
        // Far things are a little hazier, so depth reads even on one flat colour.
        const shade = lit * tone(face, u, v) * (1 - 0.1 * Math.min(1, 1 / w / 8000));
        const c = face.pattern === 'pane' && onMullion(face, u, v) ? parseColor(PHOTO_COLORS.frame) : base;
        rgb[index * 3] = Math.min(255, c[0] * shade);
        rgb[index * 3 + 1] = Math.min(255, c[1] * shade);
        rgb[index * 3 + 2] = Math.min(255, c[2] * shade);
      });
    }
  }
  return { width, height, rgb };
}

/** Darker or lighter than the face's own colour at this spot on it. */
function tone(face: Face, u: number, v: number): number {
  const [U, V] = face.size;
  switch (face.pattern) {
    case 'outlined': {
      // A thin dark line round every door, drawer front and appliance, as the gaps between them.
      const edge = Math.min(u, v, U - u, V - v);
      return edge < 9 ? 0.72 : 1;
    }
    case 'floor':
      // Floorboards 140 mm wide, with a joint every 1.2 m staggered board to board.
      return u % 140 < 5 || (v + Math.floor(u / 140) * 430) % 1200 < 5 ? 0.86 : 1;
    case 'wall':
      // A skirting board along the floor.
      return v < 90 ? 0.9 : 1;
    default:
      return 1;
  }
}

function onMullion(face: Face, u: number, v: number): boolean {
  const [U, V] = face.size;
  return Math.min(u, v, U - u, V - v) < 45 || Math.abs(u - U / 2) < 18 || Math.abs(v - V / 2) < 18;
}

function facesOf(prisms: Prism[], bounds: { minX: number; minY: number; maxX: number; maxY: number }, ceilingMm: number): Face[] {
  const faces: Face[] = [];
  // Floor and ceiling run well past the walls: the room's outline may not be convex, and
  // the walls hide whatever lies outside it (a doorway shows the floor carrying on).
  const pad = 4000;
  const [x0, y0, x1, y1] = [bounds.minX - pad, bounds.minY - pad, bounds.maxX + pad, bounds.maxY + pad];
  const slab = (z: number, color: string, pattern: Pattern): Face => ({
    corners: [
      [x0, y0, z],
      [x1, y0, z],
      [x1, y1, z],
      [x0, y1, z],
    ],
    uv: [
      [0, 0],
      [x1 - x0, 0],
      [x1 - x0, y1 - y0],
      [0, y1 - y0],
    ],
    size: [x1 - x0, y1 - y0],
    normal: [0, 0, 1],
    color,
    pattern,
  });
  faces.push(slab(0, SCENE_COLORS.floor, 'floor'), slab(ceilingMm, PHOTO_COLORS.ceiling, 'plain'));

  for (const p of prisms) {
    if (p.kind === 'floor') continue;
    const pattern: Pattern = p.kind === 'wall' ? 'wall' : p.kind === 'pane' ? 'pane' : 'outlined';
    const fp = p.footprint;
    fp.forEach((a, i) => {
      const b = fp[(i + 1) % fp.length];
      const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (run === 0) return;
      const rise = p.top - p.bottom;
      faces.push({
        corners: [
          [a[0], a[1], p.bottom],
          [b[0], b[1], p.bottom],
          [b[0], b[1], p.top],
          [a[0], a[1], p.top],
        ],
        uv: [
          [0, 0],
          [run, 0],
          [run, rise],
          [0, rise],
        ],
        size: [run, rise],
        normal: [(b[1] - a[1]) / run, -(b[0] - a[0]) / run, 0],
        color: p.color,
        // A wall's skirting belongs at the floor only, not under a window's upper piece.
        pattern: pattern === 'wall' && p.bottom > 0 ? 'plain' : pattern,
      });
    });
    // Top and underside (a wall cabinet's is seen from below). Item footprints are rectangles.
    if (fp.length === 4 && p.kind !== 'wall' && p.kind !== 'pane') {
      const w = Math.hypot(fp[1][0] - fp[0][0], fp[1][1] - fp[0][1]);
      const d = Math.hypot(fp[2][0] - fp[1][0], fp[2][1] - fp[1][1]);
      for (const z of [p.top, p.bottom]) {
        if (z <= 0) continue;
        faces.push({
          corners: fp.map(([x, y]) => [x, y, z] as Vec3),
          uv: [
            [0, 0],
            [w, 0],
            [w, d],
            [0, d],
          ],
          size: [w, d],
          normal: [0, 0, 1],
          color: p.color,
          pattern: 'outlined',
        });
      }
    }
  }
  return faces;
}

interface CamPoint {
  x: number;
  y: number;
  d: number;
  u: number;
  v: number;
}

/** Cut away the part of a face behind (or right at) the lens. */
function clipNear(poly: CamPoint[]): CamPoint[] {
  const out: CamPoint[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = a.d >= NEAR_MM;
    const bIn = b.d >= NEAR_MM;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (NEAR_MM - a.d) / (b.d - a.d);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, d: NEAR_MM, u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return out;
}

interface ScreenPoint {
  sx: number;
  sy: number;
  /** 1/distance, and u, v divided by distance: these interpolate straight across the screen. */
  w: number;
  uw: number;
  vw: number;
}

function fillTriangle(
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  width: number,
  height: number,
  depth: Float32Array,
  paint: (index: number, w: number, u: number, v: number) => void
) {
  const area = (b.sx - a.sx) * (c.sy - a.sy) - (b.sy - a.sy) * (c.sx - a.sx);
  if (area === 0) return;
  const minX = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)));
  const minY = Math.max(0, Math.floor(Math.min(a.sy, b.sy, c.sy)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a.sy, b.sy, c.sy)));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const wa = ((b.sx - px) * (c.sy - py) - (b.sy - py) * (c.sx - px)) / area;
      const wb = ((c.sx - px) * (a.sy - py) - (c.sy - py) * (a.sx - px)) / area;
      const wc = 1 - wa - wb;
      if (wa < 0 || wb < 0 || wc < 0) continue;
      const w = wa * a.w + wb * b.w + wc * c.w;
      const index = y * width + x;
      if (w <= depth[index]) continue;
      depth[index] = w;
      paint(index, w, (wa * a.uw + wb * b.uw + wc * c.uw) / w, (wa * a.vw + wb * b.vw + wc * c.vw) / w);
    }
  }
}

const parsed = new Map<string, [number, number, number]>();
function parseColor(hex: string): [number, number, number] {
  let c = parsed.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    parsed.set(hex, c);
  }
  return c;
}
