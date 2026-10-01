/**
 * The plan as a clean, dimensioned SVG drawing: walls in black, doors with
 * their swing, windows as double lines, items as labelled outlines (wall
 * cabinets dashed), each wall's length on a dimension line outside it, a
 * scale bar, a north arrow, and a title block. Coordinates are plan mm;
 * the document is sized to print at 1:50. Pure: no DOM, no I/O.
 */

import { polygonBounds, type Point } from './geometry';
import type { Opening, PlacedItem, Project } from './schemas';
import { wallLengthMm } from './validate';
import { formatLength } from './viewport';
import { inwardNormal, wallQuads } from './walls';

export const SVG_SCALE = 50; // 1:50 on paper

export interface SvgOptions {
  /** Display names for items by id (e.g. catalog names); falls back to the catalog id. */
  labels?: Record<string, string>;
  /** Date shown in the title block (ISO string); defaults to the project's updatedAt. */
  date?: string;
}

const FONT = 'Helvetica, Arial, sans-serif';
const TEXT_MM = 120; // ≈ 2.4 mm on paper at 1:50
const DIM_GAP_MM = 250; // between a wall's outer face and its dimension line
const r = (n: number) => Math.round(n * 10) / 10;
const pts = (ps: Point[]) => ps.map(([x, y]) => `${r(x)},${r(y)}`).join(' ');

/** A safe download name from the project name, e.g. "Our kitchen" → "our-kitchen". */
export function exportFileName(name: string, ext: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 60);
  return `${slug || 'kitchen-plan'}.${ext}`;
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Text rotation that keeps text along `deg` but never upside down. */
function readable(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 90 && a <= 270) a -= 180;
  return a > 180 ? a - 360 : a;
}

export function planToSvg(project: Project, opts: SvgOptions = {}): string {
  const { room, items, units } = project;
  const poly = room.polygon as Point[];
  const n = poly.length;
  const quads = wallQuads(room);
  const maxT = Math.max(0, ...room.walls.map((w) => w.thicknessMm));

  // Page: the room plus walls, dimension lines, and a footer for the scale bar and title.
  const b = polygonBounds(poly);
  const margin = maxT + DIM_GAP_MM + TEXT_MM * 2 + 200;
  const footer = 900;
  const x0 = b.minX - margin;
  const y0 = b.minY - margin;
  const width = b.maxX - b.minX + 2 * margin;
  const height = b.maxY - b.minY + 2 * margin + footer;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(x0)} ${r(y0)} ${r(width)} ${r(height)}" width="${r(width / SVG_SCALE)}mm" height="${r(height / SVG_SCALE)}mm" font-family="${FONT}">`,
    `<title>${escapeXml(project.name)}</title>`,
    `<rect x="${r(x0)}" y="${r(y0)}" width="${r(width)}" height="${r(height)}" fill="#ffffff"/>`,
    `<polygon points="${pts(poly)}" fill="#f9fafb"/>`
  );

  // Walls.
  out.push('<g id="walls" fill="#111827">');
  quads.forEach((q) => out.push(`<polygon points="${pts(q)}"/>`));
  out.push('</g>');

  // Openings: cut the wall, then draw the symbol.
  const wallIndex = new Map(room.walls.map((w, i) => [w.id, i]));
  out.push('<g id="openings" fill="none" stroke="#111827" stroke-width="12">');
  for (const o of room.openings) {
    const i = wallIndex.get(o.wallId);
    if (i !== undefined && i < n) out.push(openingSvg(o, poly[i], poly[(i + 1) % n], inwardNormal(room, i), room.walls[i].thicknessMm));
  }
  out.push('</g>');

  // Items: floor and counter first, wall cabinets (dashed) on top.
  const level = { floor: 0, counter: 1, wall: 2 } as const;
  const sorted = [...items].sort((p, q) => level[p.mount ?? 'floor'] - level[q.mount ?? 'floor']);
  out.push('<g id="items">');
  for (const it of sorted) out.push(itemSvg(it, opts.labels?.[it.id] ?? it.catalogId));
  out.push('</g>');

  // Dimension lines outside each wall.
  out.push(`<g id="dimensions" stroke="#374151" stroke-width="8" font-size="${TEXT_MM}" fill="#111827">`);
  room.walls.forEach((w, i) => {
    if (i >= n) return;
    const [a, c] = [poly[i], poly[(i + 1) % n]];
    const [nx, ny] = inwardNormal(room, i);
    const off = w.thicknessMm + DIM_GAP_MM;
    const p: Point = [a[0] - nx * off, a[1] - ny * off];
    const q: Point = [c[0] - nx * off, c[1] - ny * off];
    const tick = 60;
    const ticks = [p, q]
      .map(([x, y]) => `<line x1="${r(x + nx * tick)}" y1="${r(y + ny * tick)}" x2="${r(x - nx * tick)}" y2="${r(y - ny * tick)}"/>`)
      .join('');
    const angle = readable((Math.atan2(c[1] - a[1], c[0] - a[0]) * 180) / Math.PI);
    // Just outside the dimension line, clear of it.
    const tx = (p[0] + q[0]) / 2 - nx * (TEXT_MM * 0.8);
    const ty = (p[1] + q[1]) / 2 - ny * (TEXT_MM * 0.8);
    out.push(
      `<line x1="${r(p[0])}" y1="${r(p[1])}" x2="${r(q[0])}" y2="${r(q[1])}"/>${ticks}` +
        `<text x="${r(tx)}" y="${r(ty)}" transform="rotate(${r(angle)} ${r(tx)} ${r(ty)})" text-anchor="middle" dominant-baseline="middle" stroke="none">` +
        `${escapeXml(`${i + 1} · ${formatLength(wallLengthMm(room, i), units)}`)}</text>`
    );
  });
  out.push('</g>');

  // Footer: scale bar, north arrow, title block.
  const fy = b.maxY + margin + 150;
  out.push(scaleBar(x0 + 200, fy, units), northArrow(x0 + width - 400, b.minY - margin + 450));
  const date = (opts.date ?? project.updatedAt).slice(0, 10);
  out.push(
    `<g id="title" fill="#111827" text-anchor="end">` +
      `<text x="${r(x0 + width - 200)}" y="${r(fy + 150)}" font-size="${TEXT_MM * 1.6}" font-weight="bold">${escapeXml(project.name)}</text>` +
      `<text x="${r(x0 + width - 200)}" y="${r(fy + 380)}" font-size="${TEXT_MM}">${escapeXml(
        `Scale 1:${SVG_SCALE} · revision ${project.revision} · ${date} · ${units === 'mm' ? 'millimetres' : 'feet and inches'}`
      )}</text>` +
      `</g>`
  );

  out.push('</svg>');
  return out.join('\n');
}

function openingSvg(o: Opening, a: Point, c: Point, [nx, ny]: Point, t: number): string {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
  const [ux, uy] = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
  const at = (along: number, out: number): Point => [a[0] + ux * along - nx * out, a[1] + uy * along - ny * out];
  const s = o.positionMm;
  const e = o.positionMm + o.widthMm;
  // Cut the wall (slightly oversized so no black hairline is left).
  const parts = [`<polygon points="${pts([at(s, -1), at(e, -1), at(e, t + 1), at(s, t + 1)])}" fill="#ffffff" stroke="none"/>`];
  const jambs = [at(s, 0), at(s, t), at(e, 0), at(e, t)];
  parts.push(
    `<line x1="${r(jambs[0][0])}" y1="${r(jambs[0][1])}" x2="${r(jambs[1][0])}" y2="${r(jambs[1][1])}"/>`,
    `<line x1="${r(jambs[2][0])}" y1="${r(jambs[2][1])}" x2="${r(jambs[3][0])}" y2="${r(jambs[3][1])}"/>`
  );
  if (o.kind === 'door') {
    // Hinged at the start, opening into the room: the leaf stands perpendicular, the arc shows its sweep.
    const hinge = at(s, 0);
    const leaf: Point = [hinge[0] + nx * o.widthMm, hinge[1] + ny * o.widthMm];
    const closed = at(e, 0);
    // Sweep direction: from the open leaf to the closed position around the hinge.
    const cross = (leaf[0] - hinge[0]) * (closed[1] - hinge[1]) - (leaf[1] - hinge[1]) * (closed[0] - hinge[0]);
    parts.push(
      `<line x1="${r(hinge[0])}" y1="${r(hinge[1])}" x2="${r(leaf[0])}" y2="${r(leaf[1])}" stroke-width="20"/>`,
      `<path d="M ${r(leaf[0])} ${r(leaf[1])} A ${r(o.widthMm)} ${r(o.widthMm)} 0 0 ${cross > 0 ? 1 : 0} ${r(closed[0])} ${r(closed[1])}" stroke-dasharray="40 30"/>`
    );
  } else if (o.kind === 'window') {
    for (const f of [1 / 3, 2 / 3]) {
      const [p, q] = [at(s, t * f), at(e, t * f)];
      parts.push(`<line x1="${r(p[0])}" y1="${r(p[1])}" x2="${r(q[0])}" y2="${r(q[1])}"/>`);
    }
  }
  return `<g class="${o.kind.replace('_', '-')}">${parts.join('')}</g>`;
}

function itemSvg(it: PlacedItem, label: string): string {
  const { w, d } = it.sizeMm;
  const onWall = it.mount === 'wall';
  const { x, y } = it.position;
  const rot = r(it.rotationDeg);
  // Fit the label to the item: shrink long names, skip it if it would be unreadable.
  const size = Math.min(TEXT_MM, (w * 0.9) / Math.max(1, label.length * 0.55), d * 0.35);
  const textRot = readable(it.rotationDeg);
  const rect =
    `<rect x="${r(-w / 2)}" y="${r(-d / 2)}" width="${r(w)}" height="${r(d)}" fill="${onWall ? 'none' : '#ffffff'}" stroke="#374151" stroke-width="${onWall ? 8 : 12}"${onWall ? ' stroke-dasharray="50 35"' : ''}/>` +
    // Front edge: which way it faces.
    `<line x1="${r(-w / 2)}" y1="${r(d / 2)}" x2="${r(w / 2)}" y2="${r(d / 2)}" stroke="#374151" stroke-width="${onWall ? 12 : 28}"/>`;
  // Wall cabinets put their label near the back so it doesn't sit on the base cabinet's label.
  const ty = onWall ? -d / 2 + size : 0;
  const text =
    size >= 40
      ? `<text transform="translate(${r(x)} ${r(y)}) rotate(${rot}) translate(0 ${r(ty)}) rotate(${r(textRot - it.rotationDeg)})" text-anchor="middle" dominant-baseline="middle" font-size="${r(size)}" fill="#111827">${escapeXml(label)}</text>`
      : '';
  return `<g class="item${onWall ? ' wall-mounted' : ''}"><g transform="translate(${r(x)} ${r(y)}) rotate(${rot})">${rect}</g>${text}</g>`;
}

function scaleBar(x: number, y: number, units: 'mm' | 'in'): string {
  // 2 m (or 6 ft) in four segments.
  const total = units === 'mm' ? 2000 : 6 * 12 * 25.4;
  const seg = total / 4;
  const h = 60;
  const parts: string[] = [];
  for (let k = 0; k < 4; k++) {
    parts.push(`<rect x="${r(x + k * seg)}" y="${r(y)}" width="${r(seg)}" height="${h}" fill="${k % 2 ? '#ffffff' : '#111827'}" stroke="#111827" stroke-width="8"/>`);
  }
  const label = (k: number) => (units === 'mm' ? `${(k * seg) / 1000} m` : `${(k * 18) / 12}'`.replace(/^0'$/, '0'));
  for (let k = 0; k <= 4; k += 2) {
    parts.push(`<text x="${r(x + k * seg)}" y="${r(y + h + TEXT_MM * 1.2)}" font-size="${TEXT_MM}" text-anchor="middle" fill="#111827">${label(k)}</text>`);
  }
  return `<g id="scale-bar">${parts.join('')}</g>`;
}

function northArrow(x: number, y: number): string {
  return (
    `<g id="north" fill="#111827">` +
    `<path d="M ${r(x)} ${r(y - 200)} L ${r(x + 90)} ${r(y + 60)} L ${r(x)} ${r(y)} L ${r(x - 90)} ${r(y + 60)} Z"/>` +
    `<text x="${r(x)}" y="${r(y + 220)}" font-size="${TEXT_MM}" text-anchor="middle">N</text>` +
    `</g>`
  );
}
