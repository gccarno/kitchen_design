import { describe, it, expect } from 'vitest';
import { buildCatalog, loadCatalog, searchCatalog } from './loader';
import type { CatalogItem } from './schema';

const item = (id: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name: id,
  category: 'appliance',
  mount: 'floor',
  sizeMm: { w: 600, d: 600, h: 850 },
  tags: [],
  ...extra,
});

describe('buildCatalog', () => {
  it('indexes items by id and keeps source order', () => {
    const c = buildCatalog([item('a'), item('b')], [item('c')]);
    expect(c.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(c.byId.get('c')?.id).toBe('c');
  });

  it('fails loudly on duplicate ids across sources', () => {
    expect(() => buildCatalog([item('a')], [item('a')])).toThrow(/duplicate catalog id "a"/);
  });

  it('reports every invalid item at once', () => {
    const bad = [
      { ...item('ok') },
      { ...item('Bad Id') },
      { ...item('no-size'), sizeMm: { w: 0, d: 600, h: 850 } },
    ];
    expect(() => buildCatalog(bad)).toThrow(/item 1 \("Bad Id"\).*item 2 \("no-size"\)/s);
  });
});

describe('the shipped catalog', () => {
  const catalog = loadCatalog();

  it('loads and validates', () => {
    expect(catalog.items.length).toBeGreaterThanOrEqual(20);
  });

  it('covers what a kitchen plan needs', () => {
    const tags = new Set(catalog.items.flatMap((i) => i.tags));
    for (const t of ['fridge', 'range', 'dishwasher', 'sink', 'microwave', 'range-hood', 'island', 'table', 'chair', 'stool']) {
      expect(tags, t).toContain(t);
    }
  });

  it('has counter-depth and standard fridges, and four dining table sizes', () => {
    expect(searchCatalog(catalog.items, 'counter-depth fridge')).toHaveLength(1);
    expect(searchCatalog(catalog.items, 'dining table')).toHaveLength(4);
  });

  it('gives fridges side clearance', () => {
    for (const f of searchCatalog(catalog.items, 'fridge')) expect(f.clearanceMm?.sides).toBeGreaterThanOrEqual(50);
  });

  it('mounts hoods and over-range microwaves on the wall', () => {
    for (const h of searchCatalog(catalog.items, 'range-hood')) expect(h.mount).toBe('wall');
  });
});

describe('searchCatalog', () => {
  const items = [
    item('fridge-counter-depth', { name: 'Counter-depth refrigerator', tags: ['fridge'] }),
    item('fridge-standard', { name: 'Refrigerator', tags: ['fridge'] }),
    item('chair', { name: 'Dining chair', category: 'furniture', tags: ['chair'] }),
  ];

  it('returns everything for an empty query', () => {
    expect(searchCatalog(items, '  ')).toHaveLength(3);
  });

  it('matches every word, in any order, across name, tags, category, and id', () => {
    expect(searchCatalog(items, 'Fridge COUNTER').map((i) => i.id)).toEqual(['fridge-counter-depth']);
    expect(searchCatalog(items, 'furniture').map((i) => i.id)).toEqual(['chair']);
  });

  it('filters by category', () => {
    expect(searchCatalog(items, '', 'furniture').map((i) => i.id)).toEqual(['chair']);
    expect(searchCatalog(items, 'fridge', 'furniture')).toEqual([]);
  });
});
