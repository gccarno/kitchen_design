import { describe, it, expect } from 'vitest';
import { estimateToCsv } from './csv';
import type { Estimate } from './estimate';

const estimate: Estimate = {
  currency: 'EUR',
  lines: [
    { key: 'range-760', label: 'Range (760 mm / 30")', quantity: 1, unit: 'each', unitPrice: 1000, overridden: false, total: 1000 },
    { key: 'x', label: 'Shelf, white', quantity: 1.9, unit: 'm', unitPrice: 30, overridden: true, total: 57.00000000001 },
    { key: 'y', label: '=HYPERLINK("x")', quantity: 2, unit: 'each', unitPrice: 0, overridden: false, total: 0 },
  ],
  subtotal: 1057,
  installPct: 30,
  install: 317.1,
  taxPct: 7.5,
  tax: 103.0575,
  total: 1477.1575,
};

describe('estimateToCsv', () => {
  it('writes the currency, a header, one row per line and the totals, with CRLF line ends', () => {
    expect(estimateToCsv(estimate).split('\r\n')).toEqual([
      '# Currency: EUR',
      'Item,Quantity,Unit,Unit price,Total',
      '"Range (760 mm / 30"")",1,each,1000.00,1000.00',
      '"Shelf, white",1.9,m,30.00,57.00',
      // A label that a spreadsheet would run as a formula is defused.
      `"'=HYPERLINK(""x"")",2,each,0.00,0.00`,
      'Subtotal,,,,1057.00',
      'Installation (30%),,,,317.10',
      'Tax (7.5%),,,,103.06',
      'Total,,,,1477.16',
      '',
    ]);
  });
});
