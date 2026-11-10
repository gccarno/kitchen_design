import { describe, it, expect } from 'vitest';
import { parseLength } from './length';

describe('parseLength', () => {
  it('reads a bare number in the project units', () => {
    expect(parseLength('3600', 'mm')).toBe(3600);
    expect(parseLength('150', 'in')).toBeCloseTo(3810);
    expect(parseLength('3.5', 'in')).toBeCloseTo(88.9);
  });

  it('reads explicit metric units whatever the project units', () => {
    expect(parseLength('3.6 m', 'in')).toBe(3600);
    expect(parseLength('3.6m', 'mm')).toBe(3600);
    expect(parseLength('360 cm', 'mm')).toBe(3600);
    expect(parseLength('3600 mm', 'in')).toBe(3600);
  });

  it('reads feet and inches', () => {
    expect(parseLength(`12' 6"`, 'mm')).toBeCloseTo(3810);
    expect(parseLength(`12'6"`, 'mm')).toBeCloseTo(3810);
    expect(parseLength(`10'`, 'mm')).toBeCloseTo(3048);
    expect(parseLength(`12 ft 6 in`, 'mm')).toBeCloseTo(3810);
    expect(parseLength(`12 feet`, 'mm')).toBeCloseTo(3657.6);
  });

  it('reads inches, with fractions', () => {
    expect(parseLength('150 in', 'mm')).toBeCloseTo(3810);
    expect(parseLength(`150"`, 'mm')).toBeCloseTo(3810);
    expect(parseLength(`12' 6 1/2"`, 'mm')).toBeCloseTo(3822.7);
    expect(parseLength(`1/2"`, 'mm')).toBeCloseTo(12.7);
    expect(parseLength(`30 1/4 in`, 'mm')).toBeCloseTo(768.35);
  });

  it('reads a bare feet-inches number with a fraction in inch projects', () => {
    expect(parseLength('30 1/2', 'in')).toBeCloseTo(774.7);
  });

  it('returns null for anything it cannot read or that is not positive', () => {
    for (const bad of ['', '   ', 'abc', '0', '-5', `0'`, '12 parsecs', `12' x`, '1/0"', '1e400']) {
      expect(parseLength(bad, 'mm'), bad).toBeNull();
    }
  });

  it('ignores surrounding space and case', () => {
    expect(parseLength('  3.6 M ', 'mm')).toBe(3600);
    expect(parseLength(`12' 6" `, 'mm')).toBeCloseTo(3810);
  });
});
