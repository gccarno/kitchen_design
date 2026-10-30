/**
 * Closet universal-design checks: can a seated user reach a rod and the
 * storage? Rules come back in the layout check's shape so they share its
 * panel. Only what the closet records can be checked. Lengths in mm.
 */

import type { LayoutRule } from '../plan/layout-check';
import type { Closet, ClosetComponent } from '../plan/schemas';
import { CLOSET_COMPONENTS, topOf } from './catalog';

/** The seated reach range (ADA): lowest and highest a hand can comfortably get to. */
export const REACH_MIN_MM = 380;
export const REACH_MAX_MM = 1220;

const inReach = (y: number) => y >= REACH_MIN_MM && y <= REACH_MAX_MM;

/** Something is within reach if any part of it is: a line at one height, a box over a span. */
const reachable = (c: ClosetComponent) =>
  CLOSET_COMPONENTS[c.kind].box ? c.yMm <= REACH_MAX_MM && topOf(c) >= REACH_MIN_MM : inReach(c.yMm);

const range = `${REACH_MIN_MM} to ${REACH_MAX_MM} mm up`;

export function checkClosetAccessibility(closet: Closet): LayoutRule[] {
  const rods = closet.components.filter((c) => c.kind === 'rod');
  const storage = closet.components.filter((c) => ['shelf', 'drawers', 'basket', 'tower', 'shoe_shelf'].includes(c.kind));

  const rod: LayoutRule = { id: 'access-closet-rod', title: 'A rod within reach', status: 'n/a', detail: 'no hanging rods' };
  if (rods.length > 0) {
    const ok = rods.some(reachable);
    rod.status = ok ? 'pass' : 'fail';
    rod.detail = `${rods.map((r) => `${Math.round(r.yMm)} mm`).join(', ')} (one needs to be ${range})`;
  }

  const store: LayoutRule = { id: 'access-closet-storage', title: 'Storage within reach', status: 'n/a', detail: 'no shelves or drawers' };
  if (storage.length > 0) {
    const ok = storage.some(reachable);
    store.status = ok ? 'pass' : 'fail';
    store.detail = ok ? `${storage.filter(reachable).length} of ${storage.length} within ${range}` : `none within ${range}`;
  }
  return [rod, store];
}
