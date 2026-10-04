/**
 * Plain-language description of a closet edit, for the diff preview —
 * the closet counterpart of `describePlanChanges`' room and item lines.
 */

import type { PlanChange } from '../plan/changes';
import type { Closet, ClosetComponent } from '../plan/schemas';
import { CLOSET_COMPONENTS } from './catalog';

const mm = (n: number) => Math.round(n);
const name = (c: ClosetComponent) => CLOSET_COMPONENTS[c.kind].name;
const at = (c: ClosetComponent) => `${mm(c.xMm)} mm from the left, ${mm(c.yMm)} mm up`;
const dims = (c: Closet) => `${mm(c.widthMm)} × ${mm(c.heightMm)} × ${mm(c.depthMm)}`;
const door = (o: Closet['opening']) => `${o.style}, ${mm(o.widthMm)} mm wide at ${mm(o.leftMm)} mm`;

function size(c: ClosetComponent): string {
  const s = CLOSET_COMPONENTS[c.kind];
  const parts = [s.box ? `${mm(c.widthMm)} × ${mm(c.heightMm ?? 0)} mm` : `${mm(c.widthMm)} mm wide`];
  if (c.count !== undefined) parts.push(`${c.count} ${c.kind === 'drawers' ? 'drawers' : 'shelves'}`);
  return parts.join(', ');
}

export function describeClosetChanges(before: Closet, after: Closet): PlanChange[] {
  const out: PlanChange[] = [];
  if (dims(before) !== dims(after)) {
    out.push({ kind: 'changed', subject: 'room', text: `Closet size: ${dims(before)} → ${dims(after)} mm (w × h × d)` });
  }
  if (door(before.opening) !== door(after.opening)) {
    out.push({ kind: 'changed', subject: 'opening', text: `Door opening: ${door(before.opening)} → ${door(after.opening)}` });
  }

  const afterById = new Map(after.components.map((c) => [c.id, c]));
  const beforeIds = new Set(before.components.map((c) => c.id));
  const removed: PlanChange[] = [];
  for (const c of before.components) {
    const next = afterById.get(c.id);
    if (!next) {
      removed.push({ kind: 'removed', subject: 'item', text: `${name(c)} at ${at(c)}` });
      continue;
    }
    if (next.xMm !== c.xMm || next.yMm !== c.yMm) out.push({ kind: 'changed', subject: 'item', text: `${name(next)} moved to ${at(next)}` });
    if (size(next) !== size(c) || next.depthMm !== c.depthMm) {
      out.push({ kind: 'changed', subject: 'item', text: `${name(next)} resized: ${size(next)}` });
    }
  }
  out.push(...removed);
  for (const c of after.components) {
    if (!beforeIds.has(c.id)) out.push({ kind: 'added', subject: 'item', text: `${name(c)}, ${size(c)}, at ${at(c)}` });
  }
  return out;
}
