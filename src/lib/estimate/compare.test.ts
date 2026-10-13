import { describe, it, expect } from 'vitest';
import type { Estimate, EstimateLine } from './estimate';
import { partDifferences } from './compare';

const line = (key: string, label: string, quantity: number, unit: EstimateLine['unit'] = 'each'): EstimateLine => ({
  key, label, quantity, unit, unitPrice: 1, overridden: false, total: quantity,
});
const est = (lines: EstimateLine[]): Estimate => ({ currency: 'USD', lines, subtotal: 0, installPct: 0, install: 0, taxPct: 0, tax: 0, total: 0 });

describe('partDifferences', () => {
  it('lists the lines whose quantity differs, a missing line counting as 0, sorted by label', () => {
    const rows = partDifferences([
      est([line('b', 'Base cabinet', 2), line('s', 'Sink base', 1), line('ct', 'Countertop', 1.5, 'm²')]),
      est([line('b', 'Base cabinet', 3), line('s', 'Sink base', 1), line('ct', 'Countertop', 1.5, 'm²'), line('d', 'Dishwasher', 1)]),
    ]);
    expect(rows).toEqual([
      { key: 'b', label: 'Base cabinet', unit: 'each', quantities: [2, 3] },
      { key: 'd', label: 'Dishwasher', unit: 'each', quantities: [0, 1] },
    ]);
  });

  it('ignores floating-point noise in quantities', () => {
    expect(partDifferences([est([line('ct', 'Countertop', 1.5, 'm²')]), est([line('ct', 'Countertop', 1.5000000001, 'm²')])])).toEqual([]);
  });

  it('finds nothing when every estimate uses the same parts', () => {
    expect(partDifferences([est([line('b', 'Base', 2)]), est([line('b', 'Base', 2)])])).toEqual([]);
  });
});
