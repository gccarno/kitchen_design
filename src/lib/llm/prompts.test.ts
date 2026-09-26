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

describe('refineExtractedRoom with measurements', () => {
  const room = ExtractedRoomSchema.parse({
    confidence: 0.8,
    polygonMm: [
      [0, 0],
      [4000, 0],
      [4000, 3000],
      [0, 3000],
    ],
    walls: [{ thicknessMm: 100 }, { thicknessMm: 100 }, { thicknessMm: 100 }, { thicknessMm: 100 }],
    openings: [],
    measuredWalls: [2],
    notes: '',
  });

  it('accepts one wall index per measurement', () => {
    expect(refineExtractedRoom(room, { measurementCount: 1 }).ok).toBe(true);
  });

  it('flags a measuredWalls count that does not match the measurements', () => {
    const r = refineExtractedRoom(room, { measurementCount: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/measuredWalls has 1.*2 measurements/);
  });

  it('flags an out-of-range measured wall', () => {
    const r = refineExtractedRoom({ ...room, measuredWalls: [7] }, { measurementCount: 1 });
    expect(r.ok).toBe(false);
  });

  it('defaults measuredWalls to [] when the model omits it', () => {
    const { measuredWalls: _omit, ...rest } = room;
    expect(ExtractedRoomSchema.parse(rest).measuredWalls).toEqual([]);
  });
});

describe('buildExtractRoomPrompt', () => {
  const photo = (index: number, extra = {}) => ({ index, width: 1568, height: 1176, ...extra });

  it('lists each measurement and asks for one measuredWalls entry per measurement', () => {
    const p = buildExtractRoomPrompt({
      photos: [photo(0), photo(1)],
      measurements: [
        { description: 'sink wall', lengthMm: 3600 },
        { description: 'wall with the window', lengthMm: 2450 },
      ],
    });
    expect(p.user).toMatch(/Measurement 1: "sink wall" = 3600 mm/);
    expect(p.user).toMatch(/Measurement 2: "wall with the window" = 2450 mm/);
    expect(p.system).toMatch(/measuredWalls/);
    expect(p.user).toMatch(/measuredWalls must have exactly 2 entries/);
  });

  it('says there are no measurements when none are given', () => {
    const p = buildExtractRoomPrompt({ photos: [photo(0)], measurements: [] });
    expect(p.user).toMatch(/no measured walls/i);
    expect(p.user).toMatch(/measuredWalls must be \[\]/);
  });

  it('describes each photo, its wall hint, and its reference box', () => {
    const p = buildExtractRoomPrompt({
      photos: [
        photo(0, { wallHint: 'north' }),
        photo(1, { reference: { kind: 'credit_card', side: 'long', knownSizeMm: 85.6, pixelBox: [10, 20, 60, 50] } }),
      ],
      measurements: [],
    });
    expect(p.user).toMatch(/2 photos/);
    expect(p.user).toMatch(/Photo 1 \(1568×1176 px\).*north wall/);
    expect(p.user).toMatch(/Photo 2 .*credit_card.*\[10, 20, 60, 50\].*long edge.*85\.6 mm/);
  });

  it('treats measurements as the scale and references as a secondary hint', () => {
    const p = buildExtractRoomPrompt({ photos: [photo(0)], measurements: [] });
    expect(p.system).toMatch(/measured.*exact/i);
    expect(p.system).toMatch(/reference object.*secondary/i);
  });

  it('includes the user hint', () => {
    const p = buildExtractRoomPrompt({ photos: [photo(0)], measurements: [], hint: 'galley kitchen' });
    expect(p.user).toMatch(/galley kitchen/);
  });

  it('describes walls as one entry per polygon edge', () => {
    const p = buildExtractRoomPrompt({ photos: [photo(0)], measurements: [] });
    expect(p.system).toMatch(/walls\[i\].*edge/i);
    expect(p.system).not.toMatch(/fromIdx/);
  });

  it('requests a JSON object with the room fields', () => {
    const p = buildExtractRoomPrompt({ photos: [photo(0)], measurements: [] });
    expect(p.system).toMatch(/json/i);
    expect(p.system).toMatch(/polygonMm/);
  });
});
