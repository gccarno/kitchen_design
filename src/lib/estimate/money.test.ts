import { describe, it, expect } from 'vitest';
import { moneyFormat } from './money';

describe('moneyFormat', () => {
  it('formats in the given currency', () => {
    expect(moneyFormat('EUR').resolvedOptions().currency).toBe('EUR');
    expect(moneyFormat('USD').format(1234.5)).toContain('1,234.50');
  });

  it('falls back to USD for an unknown currency code instead of throwing', () => {
    expect(moneyFormat('NOPE').resolvedOptions().currency).toBe('USD');
  });
});
