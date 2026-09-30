/**
 * The plan as the LLM sees it: compact text naming everything by the short
 * refs the command compiler understands (w1…, o1…, i1…), with compass
 * directions so requests like "the north wall" can be matched.
 */

import type { Catalog } from '../catalog/loader';
import { nearestWallPoint } from '../plan/openings';
import { rotateAround, type Point } from '../plan/geometry';
import type { Project } from '../plan/schemas';
import { wallLengthMm } from '../plan/validate';
import { inwardNormal } from '../plan/walls';

const NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const r = (n: number) => Math.round(n);

/** Compass name of a direction vector in plan coordinates (x east, y south). */
export function compass([dx, dy]: Point): string {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = north, 90 = east
  return NAMES[((Math.round(deg / 45) % 8) + 8) % 8];
}

export function describePlanForLLM(project: Project, catalog: Catalog): string {
  const { room } = project;
  const n = room.polygon.length;
  const wallRef = new Map(room.walls.map((w, i) => [w.id, `w${i + 1}`]));
  const b = room.polygon.reduce(
    (acc, [x, y]) => ({ minX: Math.min(acc.minX, x), minY: Math.min(acc.minY, y), maxX: Math.max(acc.maxX, x), maxY: Math.max(acc.maxY, y) }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );

  const lines: string[] = [
    `Project "${project.name}". Room bounding box ${r(b.maxX - b.minX)} × ${r(b.maxY - b.minY)} mm.`,
    'Coordinates are in mm: x grows to the east (right), y grows to the south (down); north is up.',
    '',
    'Walls (inside faces; each runs from its start corner to the next; alongMm is measured from the start corner):',
  ];
  room.walls.forEach((w, i) => {
    const [a, c] = [room.polygon[i], room.polygon[(i + 1) % n]];
    const [nx, ny] = inwardNormal(room, i);
    lines.push(
      `- w${i + 1}: ${compass([-nx, -ny])} wall, ${r(wallLengthMm(room, i))} mm, from (${r(a[0])}, ${r(a[1])}) to (${r(c[0])}, ${r(c[1])}), ${w.thicknessMm} mm thick`
    );
  });

  lines.push('', 'Openings:');
  if (room.openings.length === 0) lines.push('(none)');
  room.openings.forEach((o, i) => {
    const wall = wallRef.get(o.wallId) ?? '?';
    lines.push(`- o${i + 1}: ${o.kind.replace('_', '-')} on ${wall}, ${r(o.widthMm)} mm wide, centred ${r(o.positionMm + o.widthMm / 2)} mm along ${wall}`);
  });

  lines.push('', 'Items (centre = middle of the item; facing = direction its front faces):');
  if (project.items.length === 0) lines.push('(none)');
  project.items.forEach((it, i) => {
    const name = catalog.byId.get(it.catalogId)?.name ?? it.catalogId;
    const centre: Point = [it.position.x, it.position.y];
    const front = rotateAround([0, 1], [0, 0], it.rotationDeg);
    let line = `- i${i + 1}: "${name}" [${it.catalogId}], ${it.sizeMm.w} × ${it.sizeMm.d} mm, centre (${r(centre[0])}, ${r(centre[1])}), facing ${compass(front)}`;
    // "Against" a wall: its back is flush with the wall's inside face.
    const near = nearestWallPoint(room, centre);
    if (Math.abs(near.distanceMm - it.sizeMm.d / 2) <= 5) line += `, against w${near.wallIndex + 1} at ${r(near.alongMm)} mm`;
    if (it.mount && it.mount !== 'floor') line += `, ${it.mount}-mounted`;
    lines.push(line);
  });

  return lines.join('\n');
}

/** One line per catalog item: id, name, size, mount. */
export function describeCatalogForLLM(catalog: Catalog): string {
  return catalog.items
    .map((c) => `- ${c.id}: ${c.name}, ${c.sizeMm.w} × ${c.sizeMm.d} × ${c.sizeMm.h} mm, ${c.mount}`)
    .join('\n');
}
