/**
 * Closet validation. Errors make a closet unsaveable (things outside it,
 * malformed components); warnings are the closet-design advice the user can
 * choose to ignore: clothes hitting what's below a rod, drawers the doors
 * block, things tucked out of reach. Components are named "<name> c<n>", the
 * same refs the canvas and the chat use.
 */

import type { Closet, ClosetComponent } from '../plan/schemas';
import type { PlanValidationResult } from '../plan/validate';
import { CLOSET_COMPONENTS, componentRef, topOf } from './catalog';

/** Clear drop clothes need below a rod (shirts, folded trousers). */
export const HANG_DROP_MM = 950;
/** Gap needed between a rod and the shelf above it to lift hangers off. */
export const ROD_CLEARANCE_MM = 50;
/** Shelves higher than this need a step stool. */
export const HIGH_SHELF_MM = 2200;
/** How far past the opening edge things are still easy to get to. */
export const REACH_PAST_OPENING_MM = 300;
/** How much of each side of the opening the open doors take up, by style. */
export const DOOR_STACK_MM = { bifold: 100, hinged: 50, sliding: 0, open: 0 } as const;

const EPS = 0.5;
const r = Math.round;

export function validateCloset(closet: Closet): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { widthMm: W, heightMm: H, depthMm: D, opening, components } = closet;
  const label = (c: ClosetComponent) => `${CLOSET_COMPONENTS[c.kind].name} ${componentRef(components.indexOf(c))}`;
  const spec = (c: ClosetComponent) => CLOSET_COMPONENTS[c.kind];
  const right = (c: ClosetComponent) => c.xMm + c.widthMm;
  const sideBySide = (a: ClosetComponent, b: ClosetComponent) => a.xMm < right(b) - EPS && b.xMm < right(a) - EPS;

  // --- Errors ---
  if (opening.leftMm + opening.widthMm > W + EPS) errors.push('the door opening runs past the right side of the closet');

  const ids = new Set<string>();
  for (const c of components) {
    if (ids.has(c.id)) errors.push(`duplicate component id "${c.id}"`);
    ids.add(c.id);
    const s = spec(c);
    if (s.box && c.heightMm === undefined) errors.push(`${label(c)} needs a height`);
    if (c.xMm < -EPS || right(c) > W + EPS || c.yMm < -EPS || topOf(c) > H + EPS) errors.push(`${label(c)} is outside the closet`);
    if ((c.depthMm ?? 0) > D + EPS) errors.push(`${label(c)} is deeper than the closet (${r(c.depthMm!)} > ${r(D)} mm)`);
    if (c.count !== undefined) {
      if (!s.count) errors.push(`${label(c)} can’t have a count`);
      else if (c.count < s.count.min || c.count > s.count.max) {
        errors.push(`${label(c)} can have ${s.count.min}–${s.count.max} ${c.kind === 'drawers' ? 'drawers' : 'shelves'}, not ${c.count}`);
      }
    }
  }

  // --- Warnings ---
  const boxes = components.filter((c) => spec(c).box);
  const lines = components.filter((c) => !spec(c).box);

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (sideBySide(a, b) && a.yMm < topOf(b) - EPS && b.yMm < topOf(a) - EPS) warnings.push(`${label(a)} and ${label(b)} overlap`);
    }
  }

  for (const line of lines) {
    const through = boxes.find((b) => sideBySide(line, b) && line.yMm > b.yMm + EPS && line.yMm < topOf(b) - EPS);
    if (through) warnings.push(`${label(line)} runs through ${label(through)}`);
  }

  for (const rod of components.filter((c) => c.kind === 'rod')) {
    const dropTo = rod.yMm - HANG_DROP_MM;
    const hit = components.find(
      (c) => c !== rod && sideBySide(rod, c) && c.yMm < rod.yMm - EPS && topOf(c) > dropTo + EPS && !(spec(c).box && topOf(c) > rod.yMm)
    );
    if (hit) warnings.push(`clothes on ${label(rod)} would hit ${label(hit)} (allow ${HANG_DROP_MM} mm below a rod)`);
    else if (dropTo < -EPS) warnings.push(`clothes on ${label(rod)} would touch the floor (allow ${HANG_DROP_MM} mm below a rod)`);

    const above = components.find(
      (c) =>
        c !== rod &&
        c.kind !== 'rod' &&
        sideBySide(rod, c) &&
        c.yMm >= rod.yMm - EPS &&
        c.yMm < rod.yMm + ROD_CLEARANCE_MM - EPS
    );
    if (above) warnings.push(`${label(rod)} is too close under ${label(above)} to lift hangers off (allow ${ROD_CLEARANCE_MM} mm)`);
  }

  const oLeft = opening.leftMm;
  const oRight = opening.leftMm + opening.widthMm;
  for (const c of components.filter((x) => x.kind === 'drawers' || x.kind === 'basket')) {
    if (opening.style === 'sliding') {
      const mid = (oLeft + oRight) / 2;
      const inHalf = (a: number, b: number) => c.xMm >= a - EPS && right(c) <= b + EPS;
      if (!inHalf(oLeft, mid) && !inHalf(mid, oRight)) {
        warnings.push(
          `${label(c)} can’t be opened past the sliding doors: keep it within the left half (${r(oLeft)}–${r(mid)} mm) or the right half (${r(mid)}–${r(oRight)} mm)`
        );
      }
      continue;
    }
    const stack = DOOR_STACK_MM[opening.style];
    const [from, to] = [oLeft + (opening.style === 'open' ? 0 : stack), oRight - stack];
    if (opening.style !== 'open' && (c.xMm < from - EPS || right(c) > to + EPS)) {
      warnings.push(`${label(c)} is partly behind the doors: keep drawers and baskets between ${r(from)} and ${r(to)} mm`);
    }
  }

  for (const c of components.filter((x) => ['tower', 'shoe_shelf', 'hooks', 'valet_rod'].includes(x.kind))) {
    const past = Math.max(oLeft - c.xMm, right(c) - oRight);
    if (past > REACH_PAST_OPENING_MM + EPS) warnings.push(`${label(c)} reaches ${r(past)} mm past the door opening, so it’s hard to get to`);
  }

  for (const c of components.filter((x) => x.kind === 'shelf' && x.yMm > HIGH_SHELF_MM + EPS)) {
    warnings.push(`${label(c)} is ${r(c.yMm)} mm up: you’ll need a step stool`);
  }

  for (const c of components) {
    const s = spec(c);
    if (c.widthMm < s.minWidthMm - EPS || (s.maxWidthMm !== undefined && c.widthMm > s.maxWidthMm + EPS)) {
      warnings.push(`${label(c)} is ${r(c.widthMm)} mm wide; standard is ${s.minWidthMm}–${s.maxWidthMm ?? '…'} mm`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
