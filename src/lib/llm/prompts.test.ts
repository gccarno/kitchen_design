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
    walls: [{ thicknessMm: 100 }, { thicknessMm: 100 }, { thicknessMm: 100 }, { thicknessMm: 100 }],
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

  it('flags a wall count that does not match the polygon edge count', () => {
    const broken = { ...baseValid, walls: [{ thicknessMm: 100 }] };
    const r = refineExtractedRoom(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.join(' ')).toMatch(/1 walls.*4 edges/);
    }
  });

  it('flags an opening that runs past the end of its wall', () => {
    // Wall 1 is the 3000mm edge (4000,0)→(4000,3000).
    const broken = {
      ...baseValid,
      openings: [{ wallIdx: 1, kind: 'window' as const, positionMm: 2500, widthMm: 1000, heightMm: 1200 }],
    };
    const r = refineExtractedRoom(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.join(' ')).toMatch(/past the end/);
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

  it('describes walls as one entry per polygon edge', () => {
    const p = buildExtractRoomPrompt({ units: 'mm', photoCount: 1 });
    expect(p.system).toMatch(/walls\[i\].*edge/i);
    expect(p.system).not.toMatch(/fromIdx/);
  });

  it('returns a prompt that requests a JSON object (response_format compatible)', () => {
    const p = buildExtractRoomPrompt({ units: 'mm', photoCount: 1 });
    expect(p.system).toMatch(/json/i);
    expect(p.system).toMatch(/polygonMm/);
  });
});
