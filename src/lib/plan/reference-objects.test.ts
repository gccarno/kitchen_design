import { describe, it, expect } from 'vitest';
import { REFERENCE_OBJECTS, knownSizeMm, resolveReference } from './reference-objects';

const photo = { width: 4000, height: 3000 };

describe('knownSizeMm', () => {
  it('returns the long and short edge of a credit card', () => {
    expect(knownSizeMm('credit_card', 'long')).toBeCloseTo(85.6);
    expect(knownSizeMm('credit_card', 'short')).toBeCloseTo(53.98);
  });

  it('uses the same diameter for both sides of a coin', () => {
    expect(knownSizeMm('coin_us_quarter', 'long')).toBe(knownSizeMm('coin_us_quarter', 'short'));
  });

  it('has a long edge >= short edge for every built-in object', () => {
    for (const obj of Object.values(REFERENCE_OBJECTS)) {
      expect(obj.longMm).toBeGreaterThanOrEqual(obj.shortMm);
    }
  });
});

describe('resolveReference', () => {
  it('resolves a built-in kind to its known size', () => {
    const r = resolveReference({ kind: 'a4_paper', side: 'long', pixelBox: [10, 20, 310, 230] }, photo);
    expect(r).toEqual({
      ok: true,
      value: { kind: 'a4_paper', side: 'long', knownSizeMm: 297, pixelBox: [10, 20, 310, 230] },
    });
  });

  it('uses customSizeMm for the custom kind', () => {
    const r = resolveReference(
      { kind: 'custom', side: 'long', customSizeMm: 250, pixelBox: [0, 0, 100, 100] },
      photo
    );
    expect(r.ok && r.value.knownSizeMm).toBe(250);
  });

  it('rejects custom without a positive size', () => {
    const r = resolveReference({ kind: 'custom', side: 'long', pixelBox: [0, 0, 100, 100] }, photo);
    expect(r.ok).toBe(false);
  });

  it('normalizes a box drawn right-to-left / bottom-to-top', () => {
    const r = resolveReference({ kind: 'credit_card', side: 'long', pixelBox: [300, 200, 100, 50] }, photo);
    expect(r.ok && r.value.pixelBox).toEqual([100, 50, 300, 200]);
  });

  it('rejects a box that extends outside the photo', () => {
    const r = resolveReference({ kind: 'credit_card', side: 'long', pixelBox: [3900, 0, 4100, 100] }, photo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/outside/);
  });

  it('rejects a zero-size box', () => {
    const r = resolveReference({ kind: 'credit_card', side: 'long', pixelBox: [100, 100, 100, 200] }, photo);
    expect(r.ok).toBe(false);
  });
});
