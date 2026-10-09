/**
 * A ready-made cleaning closet, 4' wide × 8' tall × 2' deep, to look around
 * in without an LLM. Built with the same commands the AI chat proposes, so
 * clamping and validation are the real thing.
 *
 * Left half: a tall-tools bay — brooms and mops hang from hooks, the vacuum
 * stands on the floor below, and a shelf above holds things grabbed often.
 * Right half: a shelf tower for sprays, cloths and refills, with a pull-out
 * basket under it for brushes and rags. A full-width top shelf takes bulk
 * paper towels and spares. Hinged doors across the whole front.
 */

import type { Project } from '../plan/schemas';
import { compileClosetCommands, type ClosetCommand } from './commands';

const COMMANDS: ClosetCommand[] = [
  // 48" × 96" × 24"; the opening follows the width, so it stays full-width.
  { type: 'setClosetSize', widthMm: 1219, heightMm: 2438, depthMm: 610 },
  { type: 'setOpening', style: 'hinged' },
  // Bulk storage across the top (84").
  { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1219, yMm: 2134 },
  // Tall-tools bay: a shelf at 72" over hooks at 60"; the floor stays clear for the vacuum.
  { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 610, yMm: 1829 },
  { type: 'addComponent', kind: 'hooks', xMm: 0, widthMm: 610, yMm: 1524 },
  // Supplies tower up to 68", standing on a 3" plinth above the basket.
  { type: 'addComponent', kind: 'tower', xMm: 610, widthMm: 609, yMm: 356, heightMm: 1371, depthMm: 406, count: 4 },
  // Pull-out basket under the tower, kept 50 mm clear of the right-hand door.
  { type: 'addComponent', kind: 'basket', xMm: 610, widthMm: 559, yMm: 76, depthMm: 406 },
];

/** `base` (a freshly created closet project) furnished as a cleaning closet; id and dates are kept. */
export function buildSampleCleaningCloset(base: Project, makeId: () => string): Project {
  const empty: Project = base.closet ? { ...base, closet: { ...base.closet, components: [] } } : base;
  return compileClosetCommands(empty, COMMANDS, makeId).project;
}
