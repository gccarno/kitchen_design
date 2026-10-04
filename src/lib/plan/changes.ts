/**
 * Human-readable description of what a proposed edit changes, for the
 * diff preview. Compares whole plans (not patch ops) so the wording is
 * about walls and items, never JSON paths.
 */

import { describeClosetChanges } from '../closet/changes';
import { polygonAreaMm2, polygonBounds, type Point } from './geometry';
import type { Opening, PlacedItem, Project, Room } from './schemas';
import { wallLengthMm } from './validate';

export interface PlanChange {
  kind: 'added' | 'removed' | 'changed';
  subject: 'name' | 'room' | 'wall' | 'opening' | 'measurement' | 'item';
  text: string;
}

export function describePlanChanges(before: Project, after: Project): PlanChange[] {
  const out: PlanChange[] = [];
  if (before.name !== after.name) {
    out.push({ kind: 'changed', subject: 'name', text: `Rename "${before.name}" → "${after.name}"` });
  }
  // A closet's room is only its footprint, derived from the closet.
  if (before.closet && after.closet) {
    out.push(...describeClosetChanges(before.closet, after.closet));
    return out;
  }
  out.push(...roomChanges(before.room, after.room));
  out.push(...itemChanges(before.items, after.items));
  return out;
}

const mm = (n: number) => Math.round(n);

function outline(room: Room): string {
  const b = polygonBounds(room.polygon as Point[]);
  const area = polygonAreaMm2(room.polygon as Point[]) / 1e6;
  return `${mm(b.maxX - b.minX)} × ${mm(b.maxY - b.minY)} mm, ${area.toFixed(1)} m²`;
}

function roomChanges(before: Room, after: Room): PlanChange[] {
  const out: PlanChange[] = [];
  const samePolygon =
    before.polygon.length === after.polygon.length &&
    before.polygon.every((p, i) => p[0] === after.polygon[i][0] && p[1] === after.polygon[i][1]);
  if (!samePolygon) {
    out.push({ kind: 'changed', subject: 'room', text: `Room outline: ${outline(before)} → ${outline(after)}` });
  }

  const beforeIdx = new Map(before.walls.map((w, i) => [w.id, i]));
  const afterIdx = new Map(after.walls.map((w, i) => [w.id, i]));
  const wallName = (room: Room, id: string) => {
    const i = (room === before ? beforeIdx : afterIdx).get(id);
    return i === undefined ? 'unknown wall' : `wall ${i + 1}`;
  };
  const shared = after.walls.filter((w) => beforeIdx.has(w.id));

  if (shared.length === 0 && before.walls.length > 0 && after.walls.length > 0) {
    const lengths = after.walls.map((_, i) => mm(wallLengthMm(after, i))).join(', ');
    out.push({
      kind: 'changed',
      subject: 'wall',
      text: `All walls replaced: ${after.walls.length} walls (${lengths} mm)`,
    });
  } else {
    for (const [i, w] of after.walls.entries()) {
      const j = beforeIdx.get(w.id);
      if (j === undefined) {
        out.push({ kind: 'added', subject: 'wall', text: `Wall ${i + 1} added (${mm(wallLengthMm(after, i))} mm)` });
        continue;
      }
      const lenBefore = mm(wallLengthMm(before, j));
      const lenAfter = mm(wallLengthMm(after, i));
      if (lenBefore !== lenAfter) {
        out.push({ kind: 'changed', subject: 'wall', text: `Wall ${i + 1}: ${lenBefore} → ${lenAfter} mm` });
      }
      const t = before.walls[j].thicknessMm;
      if (t !== w.thicknessMm) {
        out.push({ kind: 'changed', subject: 'wall', text: `Wall ${i + 1} thickness: ${t} → ${w.thicknessMm} mm` });
      }
    }
    for (const [j, w] of before.walls.entries()) {
      if (!afterIdx.has(w.id)) out.push({ kind: 'removed', subject: 'wall', text: `Wall ${j + 1} removed` });
    }
  }

  const label = (o: Opening) => (o.kind === 'pass_through' ? 'Pass-through' : o.kind === 'door' ? 'Door' : 'Window');
  const beforeOpenings = new Map(before.openings.map((o) => [o.id, o]));
  const afterOpenings = new Map(after.openings.map((o) => [o.id, o]));
  for (const o of before.openings) {
    const next = afterOpenings.get(o.id);
    if (!next) {
      out.push({ kind: 'removed', subject: 'opening', text: `${label(o)} on ${wallName(before, o.wallId)}` });
      continue;
    }
    const where = `${label(next)} on ${wallName(after, next.wallId)}`;
    if (next.widthMm !== o.widthMm) {
      out.push({ kind: 'changed', subject: 'opening', text: `${where}: ${mm(o.widthMm)} → ${mm(next.widthMm)} mm wide` });
    } else if (next.wallId !== o.wallId || next.positionMm !== o.positionMm || next.heightMm !== o.heightMm) {
      out.push({ kind: 'changed', subject: 'opening', text: `${where}: moved or resized` });
    }
  }
  for (const o of after.openings) {
    if (!beforeOpenings.has(o.id)) {
      out.push({
        kind: 'added',
        subject: 'opening',
        text: `${label(o)} on ${wallName(after, o.wallId)} (${mm(o.widthMm)} mm wide)`,
      });
    }
  }

  const key = (m: { wallId: string; lengthMm: number }) => `${m.wallId}:${m.lengthMm}`;
  const beforeM = new Set((before.measurements ?? []).map(key));
  const afterM = new Set((after.measurements ?? []).map(key));
  for (const m of after.measurements ?? []) {
    if (!beforeM.has(key(m))) {
      out.push({
        kind: 'added',
        subject: 'measurement',
        text: `${capitalize(wallName(after, m.wallId))} measured at ${mm(m.lengthMm)} mm`,
      });
    }
  }
  for (const m of before.measurements ?? []) {
    if (!afterM.has(key(m))) {
      out.push({ kind: 'removed', subject: 'measurement', text: `Measurement of ${wallName(before, m.wallId)}` });
    }
  }
  return out;
}

function itemChanges(before: PlacedItem[], after: PlacedItem[]): PlanChange[] {
  const out: PlanChange[] = [];
  const at = (it: PlacedItem) => `(${mm(it.position.x)}, ${mm(it.position.y)})`;
  const afterById = new Map(after.map((it) => [it.id, it]));
  const beforeIds = new Set(before.map((it) => it.id));
  const removed: PlanChange[] = [];
  for (const it of before) {
    const next = afterById.get(it.id);
    if (!next) {
      removed.push({ kind: 'removed', subject: 'item', text: `${it.catalogId} at ${at(it)}` });
      continue;
    }
    if (next.position.x !== it.position.x || next.position.y !== it.position.y) {
      out.push({ kind: 'changed', subject: 'item', text: `${next.catalogId} moved to ${at(next)}` });
    }
    if (next.rotationDeg !== it.rotationDeg) {
      out.push({ kind: 'changed', subject: 'item', text: `${next.catalogId} rotated to ${next.rotationDeg}°` });
    }
  }
  out.push(...removed);
  for (const it of after) {
    if (!beforeIds.has(it.id)) out.push({ kind: 'added', subject: 'item', text: `${it.catalogId} at ${at(it)}` });
  }
  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
