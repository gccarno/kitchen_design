/**
 * The parts list and cost estimate: one line per kind of part, priced from
 * the defaults (`prices.ts`) or the project's own prices, plus a countertop
 * line for kitchens, a hardware line for closets, installation and tax.
 * Pure; the panel and the CSV export both use it.
 */

import type { Catalog } from '../catalog/loader';
import { CLOSET_COMPONENTS } from '../closet/catalog';
import { ClosetComponentKindSchema, projectKind, type Closet, type Pricing, type Project } from '../plan/schemas';
import { COUNTERTOP_LABEL, finishesOf } from '../plan/finishes';
import { CLOSET_PRICES, closetKey, COUNTERTOP_RATES, DEFAULT_CURRENCY, DEFAULT_RATES, defaultUnitPrice } from './prices';

export type EstimateUnit = 'each' | 'm' | 'drawer' | 'm²' | 'ft²';

export interface EstimateLine {
  /** Price key (catalog id or `closet:<kind>`), or 'countertop' / 'hardware'. */
  key: string;
  label: string;
  quantity: number;
  unit: EstimateUnit;
  unitPrice: number;
  /** The unit price is the project's own, not the default. */
  overridden: boolean;
  total: number;
}

export interface Estimate {
  currency: string;
  lines: EstimateLine[];
  subtotal: number;
  installPct: number;
  install: number;
  taxPct: number;
  tax: number;
  total: number;
}

export const FT2_PER_M2 = 10.7639;
/** Countertop overhang past a base cabinet's front. */
const OVERHANG_MM = 25;
/** Floor items a countertop sits on. */
const COUNTER_TAGS = new Set(['base', 'corner', 'sink', 'dishwasher', 'filler', 'island']);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The project's prices with every missing rate filled in from the defaults. */
export function resolvedPricing(project: Project): Required<Pricing> {
  return { currency: DEFAULT_CURRENCY, unitPrices: {}, ...DEFAULT_RATES, ...project.pricing };
}

export function buildEstimate(project: Project, catalog: Catalog): Estimate {
  const pricing = resolvedPricing(project);
  const priced = (key: string, label: string, quantity: number, unit: EstimateUnit, fallback: number, override?: number): EstimateLine => {
    const unitPrice = override ?? fallback;
    return { key, label, quantity, unit, unitPrice, overridden: override !== undefined, total: quantity * unitPrice };
  };
  const part = (key: string, label: string, quantity: number, unit: EstimateUnit) =>
    priced(key, label, quantity, unit, defaultUnitPrice(key, catalog, finishesOf(project).doorStyle), project.pricing?.unitPrices[key]);

  const lines: EstimateLine[] = [];
  if (projectKind(project) === 'closet' && project.closet) {
    lines.push(...closetLines(project.closet, part));
    const hardware = hardwareCount(project.closet);
    if (hardware > 0) lines.push(priced('hardware', 'Hardware (brackets)', hardware, 'each', DEFAULT_RATES.hardwareEach, project.pricing?.hardwareEach));
  } else {
    const counts = new Map<string, number>();
    for (const it of project.items) counts.set(it.catalogId, (counts.get(it.catalogId) ?? 0) + 1);
    for (const [id, count] of counts) lines.push(part(id, catalog.byId.get(id)?.name ?? id, count, 'each'));

    const areaM2 = countertopMm2(project) / 1e6;
    if (areaM2 > 0) {
      const inches = project.units === 'in';
      const perM2 = project.pricing?.countertopPerM2;
      const material = finishesOf(project).countertop;
      const rate = COUNTERTOP_RATES[material];
      lines.push(
        priced(
          'countertop',
          project.finishes ? `Countertop (${COUNTERTOP_LABEL[material].toLowerCase()})` : 'Countertop',
          round2(inches ? areaM2 * FT2_PER_M2 : areaM2),
          inches ? 'ft²' : 'm²',
          inches ? rate / FT2_PER_M2 : rate,
          perM2 === undefined ? undefined : inches ? perM2 / FT2_PER_M2 : perM2
        )
      );
    }
  }

  const subtotal = lines.reduce((sum, l) => sum + l.total, 0);
  const install = (subtotal * pricing.installPct) / 100;
  const tax = ((subtotal + install) * pricing.taxPct) / 100;
  return {
    currency: pricing.currency,
    lines,
    subtotal,
    installPct: pricing.installPct,
    install,
    taxPct: pricing.taxPct,
    tax,
    total: subtotal + install + tax,
  };
}

/** Counter area over the floor items a countertop sits on, in mm²; bases get a front overhang. */
function countertopMm2(project: Project): number {
  let area = 0;
  for (const it of project.items) {
    if ((it.mount ?? 'floor') !== 'floor' || !it.tag || !COUNTER_TAGS.has(it.tag)) continue;
    const { w, d } = it.sizeMm;
    area += it.tag === 'corner' || it.tag === 'island' ? w * d : w * (d + OVERHANG_MM);
  }
  return area;
}

function closetLines(closet: Closet, part: (key: string, label: string, quantity: number, unit: EstimateUnit) => EstimateLine): EstimateLine[] {
  const lines: EstimateLine[] = [];
  for (const kind of ClosetComponentKindSchema.options) {
    const of = closet.components.filter((c) => c.kind === kind);
    if (of.length === 0) continue;
    const { unit } = CLOSET_PRICES[kind];
    const quantity =
      unit === 'm'
        ? round2(of.reduce((sum, c) => sum + c.widthMm, 0) / 1000)
        : unit === 'drawer'
          ? of.reduce((sum, c) => sum + (c.count ?? CLOSET_COMPONENTS[kind].defaults.count ?? 1), 0)
          : of.length;
    lines.push(part(closetKey(kind), CLOSET_COMPONENTS[kind].name, quantity, unit));
  }
  return lines;
}

/** Brackets: 2 per rod; 2 per shelf or shoe shelf, plus one more for every 800 mm of width. */
function hardwareCount(closet: Closet): number {
  let n = 0;
  for (const c of closet.components) {
    if (c.kind === 'rod') n += 2;
    else if (c.kind === 'shelf' || c.kind === 'shoe_shelf') n += 2 + Math.floor(c.widthMm / 800);
  }
  return n;
}
