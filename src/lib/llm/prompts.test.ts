import { describe, it, expect } from 'vitest';
import { ExtractedRoomSchema, refineExtractedRoom, OpeningKindSchema } from './schemas';
import { buildExtractRoomPrompt } from './prompts';

describe('refineExtractedRoom', () => {
  const baseValid = ExtractedRoomSchema.parse({
    confidence: 0.8,
    polygonMm: [
      [0, 0],
      [4000, 0],
      [4000, 3000],
      [0, 3000],
    ],
    walls: [
      { fromIdx: 0, toIdx: 1, thicknessMm: 100 },
      { fromIdx: 1, toIdx: 2, thicknessMm: 100 },
      { fromIdx: 2, toIdx: 3, thicknessMm: 100 },
      { fromIdx: 3, toIdx: 0, thicknessMm: 100 },
    ],
    openings: [],
    notes: '',
  });

  it('returns the same room on a valid input', () => {
    const r = refineExtractedRoom(baseValid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.walls).toHaveLength(4);
    }
  });

  it('flags a wall referencing an out-of-range vertex', () => {
    const broken = {
      ...baseValid,
      walls: [{ fromIdx: 0, toIdx: 99, thicknessMm: 100 }],
    };
    const r = refineExtractedRoom(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.join(' ')).toMatch(/out.of.range/i);
    }
  });

  it('flags an opening referencing an out-of-range wall', () => {
    const broken = {
      ...baseValid,
      openings: [
        {
          wallIdx: 42,
          kind: 'door' as const,
          positionMm: 0,
          widthMm: 800,
          heightMm: 2100,
        },
      ],
    };
    const r = refineExtractedRoom(broken);
    expect(r.ok).toBe(false);
  });

  it('flags self-intersecting polygon', () => {
    const bowTie = {
      ...baseValid,
      polygonMm: [
        [0, 0] as [number, number],
        [4000, 3000] as [number, number],
        [4000, 0] as [number, number],
        [0, 3000] as [number, number],
      ],
    };
    const r = refineExtractedRoom(bowTie);
    expect(r.ok).toBe(false);
  });

  it('rejects zero or negative area', () => {
    const zero = {
      ...baseValid,
      polygonMm: [
        [0, 0] as [number, number],
        [100, 0] as [number, number],
        [200, 0] as [number, number],
      ],
    };
    const r = refineExtractedRoom(zero);
    expect(r.ok).toBe(false);
  });
});

describe('OpeningKindSchema', () => {
  it('accepts known opening kinds', () => {
    expect(OpeningKindSchema.parse('door')).toBe('door');
    expect(OpeningKindSchema.parse('window')).toBe('window');
    expect(OpeningKindSchema.parse('pass_through')).toBe('pass_through');
  });

  it('rejects unknown kinds', () => {
    expect(() => OpeningKindSchema.parse('hatch')).toThrow();
  });
});

describe('buildExtractRoomPrompt', () => {
  it('includes the reference object known size and kind when provided', () => {
    const p = buildExtractRoomPrompt({
      units: 'mm',
      photoCount: 4,
      reference: { kind: 'credit_card', knownSizeMm: 85.6, side: 'long' },
    });
    // The reference line appears verbatim with the known size.
    expect(p.system).toMatch(/85\.6\s*mm/);
    expect(p.system).toMatch(/credit_card/);
    expect(p.user).toMatch(/4 photos?/i);
  });

  it('handles a custom reference size', () => {
    const p = buildExtractRoomPrompt({
      units: 'mm',
      photoCount: 1,
      reference: { kind: 'custom', knownSizeMm: 250, side: 'long' },
    });
    expect(p.system).toMatch(/250\s*mm/);
  });

  it('omits the "use that to compute scale" guidance when no reference is given', () => {
    const p = buildExtractRoomPrompt({ units: 'mm', photoCount: 3 });
    expect(p.system).not.toMatch(/Use that to compute the millimetre-per-pixel scale/);
    expect(p.user).toMatch(/3 photos?/i);
  });

  it('returns a prompt that requests a JSON object (response_format compatible)', () => {
    const p = buildExtractRoomPrompt({ units: 'mm', photoCount: 1 });
    expect(p.system).toMatch(/json/i);
    expect(p.system).toMatch(/polygonMm/);
  });
});
