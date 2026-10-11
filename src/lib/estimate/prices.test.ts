import { describe, it, expect } from 'vitest';
import { loadCatalog } from '../catalog/loader';
import { CLOSET_COMPONENT_KINDS } from '../closet/catalog';
import { CLOSET_PRICES, closetKey, defaultUnitPrice } from './prices';

const catalog = loadCatalog();

describe('defaultUnitPrice', () => {
  it('prices every catalog item and every closet kind above 0', () => {
    for (const item of catalog.items) expect(defaultUnitPrice(item.id, catalog), item.id).toBeGreaterThan(0);
    for (const kind of CLOSET_COMPONENT_KINDS) expect(defaultUnitPrice(closetKey(kind), catalog), kind).toBeGreaterThan(0);
  });

  it('prices generated cabinets by type and width', () => {
    expect(defaultUnitPrice('base-600x560x720', catalog)).toBe(270);
    expect(defaultUnitPrice('base-600x610x720', catalog)).toBe(270);
    expect(defaultUnitPrice('wall-900x320x720', catalog)).toBe(270);
    expect(defaultUnitPrice('tall-600x560x2100', catalog)).toBe(600);
    expect(defaultUnitPrice('corner-base-900x900x720', catalog)).toBe(350);
    expect(defaultUnitPrice('corner-wall-600x600x720', catalog)).toBe(220);
    expect(defaultUnitPrice('filler-base-50x560x720', catalog)).toBe(25);
    expect(defaultUnitPrice('filler-wall-100x320x720', catalog)).toBe(25);
  });

  it('uses the closet table, and gives 0 for something unknown', () => {
    expect(CLOSET_PRICES.drawers).toEqual({ price: 60, unit: 'drawer' });
    expect(defaultUnitPrice('closet:shelf', catalog)).toBe(30);
    expect(defaultUnitPrice('closet:nope', catalog)).toBe(0);
    expect(defaultUnitPrice('no-such-item', catalog)).toBe(0);
  });
});
