import { describe, it, expect } from 'vitest';
import { loadCatalog } from '../catalog/loader';
import { ProjectSchema, type ClosetComponent, type PlacedItem, type Pricing, type Project } from '../plan/schemas';
import { buildEstimate, resolvedPricing } from './estimate';

const catalog = loadCatalog();

let n = 0;
function placed(catalogId: string, x = 0): PlacedItem {
  const c = catalog.byId.get(catalogId);
  n += 1;
  return {
    id: `i${n}`,
    catalogId,
    sizeMm: c?.sizeMm ?? { w: 500, d: 500, h: 500 },
    ...(c && c.mount !== 'floor' ? { mount: c.mount } : {}),
    position: { x, y: 300 },
    rotationDeg: 0,
    ...(c?.tags[0] ? { tag: c.tags[0] } : {}),
  };
}

function project(over: Partial<Project> = {}): Project {
  return ProjectSchema.parse({
    id: 'p',
    name: 'k',
    units: 'mm',
    createdAt: 'x',
    updatedAt: 'x',
    revision: 0,
    photos: [],
    room: {
      polygon: [
        [0, 0],
        [6000, 0],
        [6000, 5000],
        [0, 5000],
      ],
      walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
      openings: [],
    },
    items: [],
    history: [],
    ...over,
  });
}

function closet(components: Omit<ClosetComponent, 'id' | 'yMm'>[], pricing?: Pricing): Project {
  return project({
    kind: 'closet',
    closet: {
      widthMm: 2400,
      heightMm: 2440,
      depthMm: 610,
      opening: { style: 'bifold', leftMm: 0, widthMm: 2400 },
      components: components.map((c, i) => ({ id: `c${i}`, yMm: 1000, ...c })),
    },
    ...(pricing ? { pricing } : {}),
  });
}

// Two 600 bases, an 800 sink base, a corner base, a wall filler (no counter) and a range.
const kitchenItems = () => [
  placed('base-600x560x720'),
  placed('sink-base-800'),
  placed('base-600x560x720'),
  placed('corner-base-900x900x720'),
  placed('filler-wall-50x320x720'),
  placed('range-760'),
];
// Counter: 2 × 600 × 585 + 800 × 625 (the sink base is 600 deep) + 900 × 900 = 2 012 000 mm² → 2.01 m².

const line = (e: ReturnType<typeof buildEstimate>, key: string) => e.lines.find((l) => l.key === key)!;

describe('buildEstimate — kitchen', () => {
  it('groups items by catalog id in order of first placement, then the countertop', () => {
    const e = buildEstimate(project({ items: kitchenItems() }), catalog);
    expect(e.lines.map((l) => [l.key, l.quantity, l.unit, l.unitPrice])).toEqual([
      ['base-600x560x720', 2, 'each', 270],
      ['sink-base-800', 1, 'each', 450],
      ['corner-base-900x900x720', 1, 'each', 350],
      ['filler-wall-50x320x720', 1, 'each', 25],
      ['range-760', 1, 'each', 1000],
      ['countertop', 2.01, 'm²', 350],
    ]);
    expect(line(e, 'range-760')).toMatchObject({ label: 'Range (760 mm / 30")', total: 1000, overridden: false });
    expect(line(e, 'countertop').label).toBe('Countertop');
    expect(line(e, 'countertop').total).toBeCloseTo(703.5, 6);
  });

  it('adds up the totals: install on the parts, tax on parts and install', () => {
    const e = buildEstimate(project({ items: kitchenItems(), pricing: { currency: 'EUR', unitPrices: {}, taxPct: 10 } }), catalog);
    expect(e.currency).toBe('EUR');
    expect(e.subtotal).toBeCloseTo(540 + 450 + 350 + 25 + 1000 + 703.5, 6);
    expect(e.installPct).toBe(30);
    expect(e.install).toBeCloseTo(e.subtotal * 0.3, 6);
    expect(e.taxPct).toBe(10);
    expect(e.tax).toBeCloseTo((e.subtotal + e.install) * 0.1, 6);
    expect(e.total).toBeCloseTo(e.subtotal + e.install + e.tax, 6);
  });

  it('shows the countertop in ft² at the per-ft² price for an inch project, for about the same total', () => {
    const e = buildEstimate(project({ units: 'in', items: kitchenItems() }), catalog);
    const top = line(e, 'countertop');
    expect(top.unit).toBe('ft²');
    expect(top.quantity).toBe(21.66);
    expect(top.unitPrice).toBeCloseTo(350 / 10.7639, 6);
    expect(Math.abs(top.total - 703.5)).toBeLessThan(1);
  });

  it('uses overrides, and marks them', () => {
    const pricing: Pricing = { currency: 'USD', unitPrices: { 'range-760': 1200 }, countertopPerM2: 100, installPct: 0 };
    const e = buildEstimate(project({ items: kitchenItems(), pricing }), catalog);
    expect(line(e, 'range-760')).toMatchObject({ unitPrice: 1200, overridden: true, total: 1200 });
    expect(line(e, 'base-600x560x720').overridden).toBe(false);
    expect(line(e, 'countertop')).toMatchObject({ unitPrice: 100, overridden: true });
    expect(line(e, 'countertop').total).toBeCloseTo(201, 6);
    expect(e.install).toBe(0);
  });

  it('prices an unknown catalog id at 0, labelled with its id', () => {
    const e = buildEstimate(project({ items: [placed('mystery-thing')] }), catalog);
    expect(e.lines).toEqual([{ key: 'mystery-thing', label: 'mystery-thing', quantity: 1, unit: 'each', unitPrice: 0, overridden: false, total: 0 }]);
  });

  it('gives no lines and zero totals for an empty project, and no countertop without counters', () => {
    expect(buildEstimate(project(), catalog)).toEqual({
      currency: 'USD',
      lines: [],
      subtotal: 0,
      installPct: 30,
      install: 0,
      taxPct: 0,
      tax: 0,
      total: 0,
    });
    expect(buildEstimate(project({ items: [placed('range-760'), placed('fridge-600')] }), catalog).lines.map((l) => l.key)).toEqual([
      'range-760',
      'fridge-600',
    ]);
  });
});

describe('buildEstimate — closet', () => {
  const parts = closet([
    { kind: 'drawers', xMm: 0, widthMm: 610, heightMm: 914 }, // count unset → 4
    { kind: 'shelf', xMm: 0, widthMm: 900 },
    { kind: 'rod', xMm: 0, widthMm: 900 },
    { kind: 'shelf', xMm: 900, widthMm: 1000 },
    { kind: 'drawers', xMm: 900, widthMm: 610, heightMm: 500, count: 2 },
    { kind: 'tower', xMm: 1600, widthMm: 457, heightMm: 2134 },
    { kind: 'shoe_shelf', xMm: 0, widthMm: 610 },
  ]);

  it('lists parts in kind order: metres, drawers and pieces, then hardware', () => {
    const e = buildEstimate(parts, catalog);
    expect(e.lines.map((l) => [l.key, l.label, l.quantity, l.unit, l.total])).toEqual([
      ['closet:shelf', 'Shelf', 1.9, 'm', 57],
      ['closet:rod', 'Hanging rod', 0.9, 'm', 13.5],
      ['closet:tower', 'Shelf tower', 1, 'each', 180],
      ['closet:drawers', 'Drawer unit', 6, 'drawer', 360],
      ['closet:shoe_shelf', 'Shoe shelf', 0.61, 'm', 24.4],
      // Rod 2; shelves 2 + 1 and 2 + 1; shoe shelf 2 + 0.
      ['hardware', 'Hardware (brackets)', 10, 'each', 40],
    ]);
    expect(e.subtotal).toBeCloseTo(674.9, 6);
  });

  it('uses the hardware and part overrides', () => {
    const e = buildEstimate(closet([{ kind: 'rod', xMm: 0, widthMm: 1000 }], { currency: 'USD', unitPrices: { 'closet:rod': 20 }, hardwareEach: 1 }), catalog);
    expect(e.lines.map((l) => [l.key, l.total, l.overridden])).toEqual([
      ['closet:rod', 20, true],
      ['hardware', 2, true],
    ]);
  });

  it('leaves hardware out when nothing needs brackets', () => {
    expect(buildEstimate(closet([{ kind: 'basket', xMm: 0, widthMm: 457, heightMm: 254 }]), catalog).lines.map((l) => l.key)).toEqual([
      'closet:basket',
    ]);
  });
});

describe('resolvedPricing', () => {
  it('fills in the defaults', () => {
    expect(resolvedPricing(project())).toEqual({
      currency: 'USD',
      unitPrices: {},
      countertopPerM2: 350,
      installPct: 30,
      taxPct: 0,
      hardwareEach: 4,
    });
    expect(resolvedPricing(project({ pricing: { currency: 'GBP', unitPrices: { a: 1 }, taxPct: 20 } }))).toMatchObject({
      currency: 'GBP',
      unitPrices: { a: 1 },
      taxPct: 20,
      installPct: 30,
    });
  });
});
