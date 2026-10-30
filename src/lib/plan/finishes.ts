/**
 * Kitchen finishes: cabinet colour, door style and countertop material. A
 * project without `finishes` looks and prices like `DEFAULT_FINISHES`, so
 * nothing changes for a design that never picked any. Pure.
 */

import type { CountertopMaterial, DoorStyle, Finishes, Project } from './schemas';

export const DEFAULT_FINISHES: Finishes = { cabinetColor: '#f3e8d2', doorStyle: 'shaker', countertop: 'quartz' };

/** Preset cabinet colours: what the picker offers, and the names the chat understands. */
export const FINISH_COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Natural wood', hex: '#f3e8d2' },
  { name: 'White', hex: '#f5f5f4' },
  { name: 'Light grey', hex: '#d1d5db' },
  { name: 'Sage green', hex: '#cfd8c5' },
  { name: 'Navy', hex: '#1e3a5f' },
  { name: 'Charcoal', hex: '#4b5563' },
];

export const DOOR_STYLE_LABEL: Record<DoorStyle, string> = { slab: 'Slab (flat)', shaker: 'Shaker', glass: 'Glass-front' };
export const COUNTERTOP_LABEL: Record<CountertopMaterial, string> = {
  laminate: 'Laminate',
  'butcher-block': 'Butcher block',
  quartz: 'Quartz',
  granite: 'Granite',
};
/** How each countertop is drawn in the elevations. */
export const COUNTERTOP_COLOR: Record<CountertopMaterial, string> = {
  laminate: '#d1d5db',
  'butcher-block': '#b0793a',
  quartz: '#374151',
  granite: '#6b6258',
};

const HEX = /^#[0-9a-f]{6}$/i;

/** The project's finishes, or the defaults when none were picked. */
export const finishesOf = (project: Pick<Project, 'finishes'>): Finishes => project.finishes ?? DEFAULT_FINISHES;

/** A preset's name ("white") or a "#rrggbb" colour, as lower-case "#rrggbb"; null if it is neither. */
export function resolveColor(input: string): string | null {
  const text = input.trim();
  if (HEX.test(text)) return text.toLowerCase();
  return FINISH_COLORS.find((c) => c.name.toLowerCase() === text.toLowerCase())?.hex ?? null;
}

/** A preset's name, or the colour code itself. */
export const colorName = (hex: string): string => FINISH_COLORS.find((c) => c.hex === hex.toLowerCase())?.name ?? hex.toLowerCase();

/** `hex` with each channel scaled toward black by `amount` (0–1). */
export function darken(hex: string, amount: number): string {
  const channel = (i: number) => Math.round(parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - amount));
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`;
}

/** The outline colour for a cabinet front: the standard brown on the default, else the fill darkened. */
export const edgeColor = (fill: string, standardEdge: string): string =>
  fill.toLowerCase() === DEFAULT_FINISHES.cabinetColor ? standardEdge : darken(fill, 0.45);

/** "White cabinets, shaker doors, quartz countertop" */
export function describeFinishes(f: Finishes): string {
  return `${colorName(f.cabinetColor)} cabinets, ${DOOR_STYLE_LABEL[f.doorStyle].toLowerCase()} doors, ${COUNTERTOP_LABEL[f.countertop].toLowerCase()} countertop`;
}

/** What differs between two finishes, one phrase each; empty when they match. */
export function finishChanges(before: Finishes, after: Finishes): string[] {
  const out: string[] = [];
  if (before.cabinetColor.toLowerCase() !== after.cabinetColor.toLowerCase()) {
    out.push(`Cabinet colour: ${colorName(before.cabinetColor)} → ${colorName(after.cabinetColor)}`);
  }
  if (before.doorStyle !== after.doorStyle) out.push(`Door style: ${DOOR_STYLE_LABEL[before.doorStyle]} → ${DOOR_STYLE_LABEL[after.doorStyle]}`);
  if (before.countertop !== after.countertop) out.push(`Countertop: ${COUNTERTOP_LABEL[before.countertop]} → ${COUNTERTOP_LABEL[after.countertop]}`);
  return out;
}
