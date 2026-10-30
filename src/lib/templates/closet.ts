/**
 * Starter closets, built with the same commands the AI chat proposes, so
 * clamping and validation are the real thing. All are front elevations:
 * `xMm` is from the left side, `yMm` the height above the floor. Each one
 * is meant to pass `validateCloset` with no warnings, so the numbers follow
 * its rules: 950 mm of drop below a rod, 50 mm between a rod and a shelf
 * above it, drawers and baskets clear of the door stack.
 */

import { compileClosetCommands, type ClosetCommand } from '../closet/commands';
import { buildSampleCleaningCloset } from '../closet/sample-closet';
import type { Project } from '../plan/schemas';

export type ClosetBuilder = (base: Project, makeId: () => string) => Project;

/** `base` (a freshly created closet) emptied, then `commands` applied. */
const closet =
  (commands: ClosetCommand[]): ClosetBuilder =>
  (base, makeId) => {
    const empty: Project = base.closet ? { ...base, closet: { ...base.closet, components: [] } } : base;
    return compileClosetCommands(empty, commands, makeId).project;
  };

/** 6 ft × 8 ft × 24", bifold doors. Two rods across two thirds, shoe shelves in the last third. */
const DOUBLE_HANG: ClosetCommand[] = [
  { type: 'setClosetSize', widthMm: 1829, heightMm: 2438, depthMm: 610 },
  { type: 'setOpening', style: 'bifold' },
  { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1829, yMm: 2134 },
  { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 1219, yMm: 2057 },
  { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 1219, yMm: 1067 },
  // Shoes: the shoe shelves can't sit under a rod, so they get their own section.
  { type: 'addComponent', kind: 'shoe_shelf', xMm: 1219, widthMm: 610, yMm: 152 },
  { type: 'addComponent', kind: 'shoe_shelf', xMm: 1219, widthMm: 610, yMm: 457 },
  { type: 'addComponent', kind: 'shoe_shelf', xMm: 1219, widthMm: 610, yMm: 762 },
  { type: 'addComponent', kind: 'shelf', xMm: 1219, widthMm: 610, yMm: 1219 },
  { type: 'addComponent', kind: 'shelf', xMm: 1219, widthMm: 610, yMm: 1676 },
];

/** 6 ft wide, hinged doors. Dresses, a double-hang section, then a drawer unit with shelves above. */
const HANG_AND_DRAWERS: ClosetCommand[] = [
  { type: 'setClosetSize', widthMm: 1829, heightMm: 2438, depthMm: 610 },
  { type: 'setOpening', style: 'hinged' },
  { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1829, yMm: 2134 },
  { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 610, yMm: 1727 },
  { type: 'addComponent', kind: 'rod', xMm: 610, widthMm: 559, yMm: 2057 },
  { type: 'addComponent', kind: 'rod', xMm: 610, widthMm: 559, yMm: 1067 },
  // 50 mm in from the right so the open door leaves the drawers clear.
  { type: 'addComponent', kind: 'drawers', xMm: 1169, widthMm: 610 },
  { type: 'addComponent', kind: 'shelf', xMm: 1169, widthMm: 610, yMm: 1219 },
  { type: 'addComponent', kind: 'shelf', xMm: 1169, widthMm: 610, yMm: 1676 },
];

/** 5 ft wide, no doors. A shelf tower on the left, open shelves over a basket on the right. */
const SHELVING: ClosetCommand[] = [
  { type: 'setClosetSize', widthMm: 1524, heightMm: 2438, depthMm: 610 },
  { type: 'setOpening', style: 'open' },
  { type: 'addComponent', kind: 'tower', xMm: 0, widthMm: 610, heightMm: 2134, count: 6 },
  { type: 'addComponent', kind: 'basket', xMm: 660, widthMm: 559, yMm: 76 },
  { type: 'addComponent', kind: 'shelf', xMm: 610, widthMm: 914, yMm: 457 },
  { type: 'addComponent', kind: 'shelf', xMm: 610, widthMm: 914, yMm: 838 },
  { type: 'addComponent', kind: 'shelf', xMm: 610, widthMm: 914, yMm: 1219 },
  { type: 'addComponent', kind: 'shelf', xMm: 610, widthMm: 914, yMm: 1600 },
  { type: 'addComponent', kind: 'shelf', xMm: 610, widthMm: 914, yMm: 1981 },
];

/** 5 ft wide, hinged doors. The rod is at 1100 mm so a child can reach it; the tower is 1.2 m tall. */
const KIDS: ClosetCommand[] = [
  { type: 'setClosetSize', widthMm: 1524, heightMm: 2438, depthMm: 610 },
  { type: 'setOpening', style: 'hinged' },
  { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1524, yMm: 2134 },
  { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 762, yMm: 1676 },
  { type: 'addComponent', kind: 'rod', xMm: 0, widthMm: 762, yMm: 1100 },
  { type: 'addComponent', kind: 'tower', xMm: 762, widthMm: 610, heightMm: 1219, count: 4 },
  { type: 'addComponent', kind: 'shelf', xMm: 762, widthMm: 762, yMm: 1524 },
  { type: 'addComponent', kind: 'hooks', xMm: 1372, widthMm: 152, yMm: 1067 },
];

/** 4 ft wide but only 16" deep. Sliding doors, so the basket stays in one half. */
const SHOES_AND_ACCESSORIES: ClosetCommand[] = [
  { type: 'setClosetSize', widthMm: 1219, heightMm: 2438, depthMm: 406 },
  { type: 'setOpening', style: 'sliding' },
  { type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1219, yMm: 2134 },
  { type: 'addComponent', kind: 'shoe_shelf', xMm: 0, widthMm: 610, yMm: 152 },
  { type: 'addComponent', kind: 'shoe_shelf', xMm: 0, widthMm: 610, yMm: 457 },
  { type: 'addComponent', kind: 'shoe_shelf', xMm: 0, widthMm: 610, yMm: 762 },
  { type: 'addComponent', kind: 'shoe_shelf', xMm: 0, widthMm: 610, yMm: 1067 },
  { type: 'addComponent', kind: 'shoe_shelf', xMm: 0, widthMm: 610, yMm: 1372 },
  { type: 'addComponent', kind: 'hooks', xMm: 610, widthMm: 300, yMm: 1829 },
  { type: 'addComponent', kind: 'hooks', xMm: 910, widthMm: 300, yMm: 1524 },
  { type: 'addComponent', kind: 'valet_rod', xMm: 1150, yMm: 1219 },
  { type: 'addComponent', kind: 'basket', xMm: 640, widthMm: 559, yMm: 76, depthMm: 356 },
];

export const CLOSET_BUILDERS: Record<string, ClosetBuilder> = {
  'closet-double-hang': closet(DOUBLE_HANG),
  'closet-hang-and-drawers': closet(HANG_AND_DRAWERS),
  'closet-shelving': closet(SHELVING),
  'closet-kids': closet(KIDS),
  'closet-shoes-accessories': closet(SHOES_AND_ACCESSORIES),
  'closet-cleaning': buildSampleCleaningCloset,
};
