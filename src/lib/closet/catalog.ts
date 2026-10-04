/**
 * Generic reach-in closet components: what each kind is called, whether it
 * is a box (has a height) or a line (a rod or shelf seen edge-on), and its
 * standard sizes. Not tied to any brand. All sizes in mm.
 */

import type { Closet, ClosetComponent, ClosetComponentKind } from '../plan/schemas';

export interface ClosetComponentSpec {
  kind: ClosetComponentKind;
  name: string;
  /** Boxes stand on something and have a height; lines are rods, shelves, hooks. */
  box: boolean;
  /** Placed with these, unless told otherwise. */
  defaults: { widthMm: number; yMm: number; heightMm?: number; depthMm: number; count?: number };
  minWidthMm: number;
  /** Absent: as wide as the closet allows. */
  maxWidthMm?: number;
  /** Allowed `count` (drawers in a unit, shelves in a tower); absent: no count. */
  count?: { min: number; max: number };
  /** One line for the palette and the LLM. */
  hint: string;
}

export const CLOSET_COMPONENTS: Record<ClosetComponentKind, ClosetComponentSpec> = {
  shelf: {
    kind: 'shelf',
    name: 'Shelf',
    box: false,
    defaults: { widthMm: 900, yMm: 2134, depthMm: 305 },
    minWidthMm: 150,
    hint: 'flat shelf, 305 deep; a top shelf usually sits at 2134 (84")',
  },
  rod: {
    kind: 'rod',
    name: 'Hanging rod',
    box: false,
    defaults: { widthMm: 900, yMm: 1727, depthMm: 305 },
    minWidthMm: 150,
    hint: 'clothes rod; long hang at 1727 (68"), double hang at 2057 and 1067 (81" / 42")',
  },
  tower: {
    kind: 'tower',
    name: 'Shelf tower',
    box: true,
    defaults: { widthMm: 457, yMm: 0, heightMm: 2134, depthMm: 356, count: 5 },
    minWidthMm: 305,
    maxWidthMm: 914,
    count: { min: 1, max: 12 },
    hint: 'floor-standing shelf unit that splits the closet into sections; count = shelves',
  },
  drawers: {
    kind: 'drawers',
    name: 'Drawer unit',
    box: true,
    defaults: { widthMm: 610, yMm: 0, heightMm: 914, depthMm: 406, count: 4 },
    minWidthMm: 305,
    maxWidthMm: 914,
    count: { min: 1, max: 8 },
    hint: 'floor-standing chest of drawers; count = drawers; keep it inside the door opening',
  },
  shoe_shelf: {
    kind: 'shoe_shelf',
    name: 'Shoe shelf',
    box: false,
    defaults: { widthMm: 610, yMm: 152, depthMm: 305 },
    minWidthMm: 300,
    hint: 'slanted shelf for shoes, low down (152 = 6")',
  },
  basket: {
    kind: 'basket',
    name: 'Basket',
    box: true,
    defaults: { widthMm: 457, yMm: 300, heightMm: 254, depthMm: 356 },
    minWidthMm: 300,
    maxWidthMm: 914,
    hint: 'pull-out wire basket, 254 tall',
  },
  hooks: {
    kind: 'hooks',
    name: 'Hooks',
    box: false,
    defaults: { widthMm: 300, yMm: 1524, depthMm: 75 },
    minWidthMm: 100,
    hint: 'a strip of hooks for bags and belts, around 1524 (60")',
  },
  valet_rod: {
    kind: 'valet_rod',
    name: 'Valet rod',
    box: false,
    defaults: { widthMm: 50, yMm: 1524, depthMm: 300 },
    minWidthMm: 25,
    maxWidthMm: 100,
    hint: 'pull-out rod for staging an outfit, around 1524 (60")',
  },
};

export const CLOSET_COMPONENT_KINDS = Object.keys(CLOSET_COMPONENTS) as ClosetComponentKind[];

/** Short ref for the component at index i, as shown on screen and to the LLM: c1, c2, … */
export const componentRef = (index: number) => `c${index + 1}`;

/** A new closet: 6' × 8' × 24", empty, with a bifold door across the whole front. */
export function newCloset(): Closet {
  return {
    widthMm: 1830,
    heightMm: 2440,
    depthMm: 610,
    opening: { style: 'bifold', leftMm: 0, widthMm: 1830 },
    components: [],
  };
}

/** The floor-plan footprint of a closet (width × depth), as the project's room outline. */
export function closetFootprint(closet: Pick<Closet, 'widthMm' | 'depthMm'>): [number, number][] {
  const { widthMm: w, depthMm: d } = closet;
  return [
    [0, 0],
    [w, 0],
    [w, d],
    [0, d],
  ];
}

/** Top edge of a component: a box's top, or a line's own height. */
export function topOf(c: ClosetComponent): number {
  return CLOSET_COMPONENTS[c.kind].box ? c.yMm + (c.heightMm ?? 0) : c.yMm;
}

/** A component of `kind` with its default sizes, left edge at `xMm`, overridden by `over`. */
export function newComponent(
  kind: ClosetComponentKind,
  id: string,
  xMm: number,
  over: Partial<Omit<ClosetComponent, 'id' | 'kind'>> = {}
): ClosetComponent {
  const d = CLOSET_COMPONENTS[kind].defaults;
  return {
    id,
    kind,
    xMm,
    widthMm: d.widthMm,
    yMm: d.yMm,
    ...(d.heightMm !== undefined ? { heightMm: d.heightMm } : {}),
    depthMm: d.depthMm,
    ...(d.count !== undefined ? { count: d.count } : {}),
    ...over,
  };
}
