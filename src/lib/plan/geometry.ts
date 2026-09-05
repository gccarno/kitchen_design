/**
 * Pure geometry helpers for the floor plan editor. All functions are
 * millimeter-based; all inputs/outputs are plain `[x, y]` tuples. No
 * class state, no DOM, no LLM — easy to unit test and reuse on the
 * server and the client.
 */

export type Point = [number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
  rotationDeg: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Euclidean distance between two points. */
export function distance(a: Point, b: Point): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** Length of a segment. */
export function segmentLength(a: Point, b: Point): number {
  return distance(a, b);
}

/** Signed polygon area via the shoelace formula. Positive = CCW. */
export function signedPolygonArea(poly: ReadonlyArray<Point>): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Unsigned polygon area in mm². */
export function polygonAreaMm2(poly: ReadonlyArray<Point>): number {
  return Math.abs(signedPolygonArea(poly));
}

/** True if `p` is inside the polygon (ray-casting). */
export function pointInPolygon(p: Point, poly: ReadonlyArray<Point>): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects =
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Round each coordinate to the nearest multiple of `step`. */
export function snapToGrid(p: Point, step: number): Point {
  if (step <= 0) return [p[0], p[1]];
  const snap = (n: number) => Math.round(n / step) * step;
  return [snap(p[0]), snap(p[1])];
}

/** Rotate `p` around `center` by `deg` degrees, CCW. */
export function rotateAround(p: Point, center: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p[0] - center[0];
  const dy = p[1] - center[1];
  return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos];
}

/** Axis-aligned bounding box of a polygon. */
export function polygonBounds(poly: ReadonlyArray<Point>): Bounds {
  if (poly.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = poly[0][0];
  let minY = poly[0][1];
  let maxX = poly[0][0];
  let maxY = poly[0][1];
  for (let i = 1; i < poly.length; i++) {
    const [x, y] = poly[i];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Inset a convex polygon by `mm` millimetres along its edges. Returns
 * the inset polygon, or `[]` if the inset is too large.
 *
 * For a convex CCW polygon, each edge is shifted inward along its inward
 * normal by `mm`, and adjacent offset edges' intersection is taken as the
 * new vertex. Empty when the input is degenerate or the inset collapses
 * the polygon (adjacent offset edges would meet outside the original).
 */
export function insetPolygon(poly: ReadonlyArray<Point>, mm: number): Point[] {
  if (poly.length < 3 || mm <= 0) return poly.slice();
  const area = signedPolygonArea(poly);
  if (area === 0) return [];

  // Ensure CCW for inward-normal direction.
  const ccw = area > 0 ? poly.slice() : poly.slice().reverse();
  const n = ccw.length;

  // Per-vertex: two incident inward normals, blended by edge-length weight.
  // Standard approach: compute a single inward unit normal at each vertex
  // (the angle bisector of the two incident edge normals, then renormalize),
  // and shift the vertex by mm / sin(half-angle) along it. The "safer"
  // path for this app: shift each edge by mm along its inward normal, then
  // intersect adjacent offset edges to get the new vertex.

  type Edge = { a: Point; b: Point; inward: Point };
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const a = ccw[i];
    const b = ccw[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return [];
    // Inward unit normal for a CCW polygon: rotate the unit direction 90° CCW.
    // (dir (1,0) → (0,1) = "up" for the bottom edge of a CCW square — interior is above.)
    const nx = -dy / len;
    const ny = dx / len;
    edges.push({
      a: [a[0] + nx * mm, a[1] + ny * mm],
      b: [b[0] + nx * mm, b[1] + ny * mm],
      inward: [nx, ny],
    });
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n];
    const cur = edges[i];
    const x = lineLineIntersection(prev.a, prev.b, cur.a, cur.b);
    if (x === null) return [];
    out.push(x);
  }

  // If any new vertex is outside the original polygon, the inset has
  // collapsed (e.g. inset > half-width for a rectangle) — signal that
  // by returning an empty polygon. The caller treats this as "no valid
  // inset exists at this size".
  for (const v of out) {
    if (!pointInPolygon(v, ccw as Point[])) return [];
  }
  return out;
}

/** Axis-aligned rectangle footprint as a closed polygon. */
export function rectFootprint(r: Rect): Point[] {
  return [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.d],
    [r.x, r.y + r.d],
  ];
}

/** True if two axis-aligned rects overlap with non-zero intersection area. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.d <= b.y ||
    b.y + b.d <= a.y
  );
}

/** Perpendicular distance from a point to a segment (0 if the foot lies on the segment). */
export function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return distance(p, a);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return distance(p, b);
  const t = c1 / c2;
  const proj: Point = [a[0] + t * vx, a[1] + t * vy];
  return distance(p, proj);
}

/** Centroid of a polygon. For non-self-intersecting polygons this is the area centroid. */
export function polygonCentroid(poly: ReadonlyArray<Point>): Point {
  let cx = 0;
  let cy = 0;
  let twiceArea = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const f = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
    twiceArea += f;
  }
  if (twiceArea === 0) {
    // Degenerate — return average of vertices.
    if (poly.length === 0) return [0, 0];
    let sx = 0;
    let sy = 0;
    for (const [x, y] of poly) {
      sx += x;
      sy += y;
    }
    return [sx / poly.length, sy / poly.length];
  }
  const k = 1 / (3 * twiceArea);
  return [cx * k, cy * k];
}

// --- internals ---

function lineLineIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point
): Point | null {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  if (d === 0) return null; // parallel
  const t =
    ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d;
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}
