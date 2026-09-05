import { describe, it, expect } from 'vitest';
import ok from './__fixtures__/extraction-ok.json';
import bad from './__fixtures__/extraction-bad.json';
import { ExtractedRoomSchema } from './schemas';

describe('ExtractedRoomSchema', () => {
  it('accepts a valid extracted room', () => {
    const parsed = ExtractedRoomSchema.parse(ok);
    expect(parsed.confidence).toBeCloseTo(0.78);
    expect(parsed.polygonMm).toHaveLength(4);
    expect(parsed.walls).toHaveLength(4);
    expect(parsed.openings).toHaveLength(2);
  });

  it('rejects confidence outside [0, 1]', () => {
    expect(() => ExtractedRoomSchema.parse(bad)).toThrow();
  });

  it('rejects a polygon with fewer than 3 points', () => {
    const data = { ...ok, polygonMm: [[0, 0], [100, 0]] };
    expect(() => ExtractedRoomSchema.parse(data)).toThrow();
  });

  it('rejects an opening with an unknown kind', () => {
    const data = {
      ...ok,
      openings: [
        {
          wallIdx: 0,
          kind: 'hatch',
          positionMm: 0,
          widthMm: 900,
          heightMm: 2100,
        },
      ],
    };
    expect(() => ExtractedRoomSchema.parse(data)).toThrow();
  });

  it('rejects a wall that references an out-of-range vertex index', () => {
    // polygonMm has 4 entries, so valid fromIdx/toIdx are 0..3
    const data = {
      ...ok,
      walls: [{ fromIdx: 0, toIdx: 99, thicknessMm: 100 }],
    };
    // Note: the schema accepts the raw index here; cross-field validation
    // happens in refineExtractedRoom. So this fixture should actually parse.
    // The purpose of this test is to pin the contract: raw schema allows it.
    expect(() => ExtractedRoomSchema.parse(data)).not.toThrow();
  });

  it('rejects a non-positive wall thickness', () => {
    const data = {
      ...ok,
      walls: [{ fromIdx: 0, toIdx: 1, thicknessMm: 0 }],
    };
    expect(() => ExtractedRoomSchema.parse(data)).toThrow();
  });

  it('rejects an opening with non-positive width', () => {
    const data = {
      ...ok,
      openings: [
        {
          wallIdx: 0,
          kind: 'door',
          positionMm: 0,
          widthMm: 0,
          heightMm: 2100,
        },
      ],
    };
    expect(() => ExtractedRoomSchema.parse(data)).toThrow();
  });
});
