import { describe, it, expect } from 'vitest';
import { layoutDetail, layoutSummary, type LayoutRule } from './layout-check';

const rule = (id: string, status: LayoutRule['status'], info = false): LayoutRule => ({ id, title: id, status, detail: '', ...(info ? { info } : {}) });

describe('layoutSummary', () => {
  it('counts passes and fails, not information or rules that do not apply', () => {
    const s = layoutSummary([rule('a', 'n/a'), rule('b', 'pass'), rule('c', 'pass', true), rule('d', 'fail')]);
    expect(s.passed).toBe(1);
    expect(s.counted).toBe(2);
  });

  it('orders fails first, then passes, then information, then what does not apply', () => {
    const s = layoutSummary([rule('a', 'n/a'), rule('b', 'pass'), rule('c', 'pass', true), rule('d', 'fail')]);
    expect(s.ordered.map((r) => r.id)).toEqual(['d', 'b', 'c', 'a']);
  });
});

describe('layoutDetail', () => {
  it('writes "<n> mm" lengths in the project units', () => {
    expect(layoutDetail('aisle 1067 mm', 'mm')).toBe('aisle 1067 mm');
    const inches = layoutDetail('aisle 1067 mm, gap 600 mm', 'in');
    expect(inches).not.toContain('mm');
    expect(inches).toContain(`1' 11 1/2"`);
  });
});
