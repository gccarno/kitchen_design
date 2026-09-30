import { describe, it, expect } from 'vitest';
import { bandOf, packRun, type RunPiece } from './runs';
import type { Opening, PlacedItem, Room } from './schemas';

/** 3000 × 4000 room: w1 top (north, x 0→3000), w2 right, w3 bottom, w4 left (y 4000→0). */
function room(openings: Opening[] = []): Room {
  return {
    polygon: [
      [0, 0],
      [3000, 0],
      [3000, 4000],
      [0, 4000],
    ],
    walls: ['wa', 'wb', 'wc', 'wd'].map((id) => ({ id, thicknessMm: 100 })),
    openings,
    measurements: [],
  } as Room;
}

const base600: RunPiece = { catalogId: 'base-600', sizeMm: { w: 600, d: 560, h: 720 }, mount: 'floor' };
const base800: RunPiece = { ...base600, catalogId: 'base-800', sizeMm: { w: 800, d: 560, h: 720 } };
const fridge: RunPiece = { catalogId: 'fridge', sizeMm: { w: 910, d: 700, h: 1780 }, mount: 'floor' };
const wallCab: RunPiece = { catalogId: 'wall-600', sizeMm: { w: 600, d: 320, h: 720 }, mount: 'wall' };

const label = { item: (it: PlacedItem) => it.id, opening: (o: Opening) => `${o.kind} ${o.id}` };
const pack = (r: Room, items: PlacedItem[], wall: number, pieces: RunPiece[], from: 'start' | 'end' | 'centre' = 'start') =>
  packRun(r, items, wall, pieces, from, label);

/** A placed item against w1 (north), centred `along` mm from its start. */
function onNorth(id: string, along: number, piece: RunPiece): PlacedItem {
  return {
    id,
    catalogId: piece.catalogId,
    sizeMm: piece.sizeMm,
    ...(piece.mount !== 'floor' ? { mount: piece.mount } : {}),
    position: { x: along, y: piece.sizeMm.d / 2 },
    rotationDeg: 0,
  };
}

describe('bandOf', () => {
  it('splits items into low, high, and tall (both)', () => {
    expect(bandOf('floor', 720)).toBe('low');
    expect(bandOf('counter', 300)).toBe('low');
    expect(bandOf('wall', 720)).toBe('high');
    expect(bandOf(undefined, 2100)).toBe('both');
  });
});

describe('packRun', () => {
  it('packs items back to back from the wall start', () => {
    expect(pack(room(), [], 0, [base600, base800, base600])).toEqual([300, 1000, 1700]);
  });

  it('packs against the far corner with from: end, keeping the listed order', () => {
    expect(pack(room(), [], 0, [base600, base800])).toEqual([300, 1000]);
    expect(pack(room(), [], 0, [base600, base800], 'end')).toEqual([1900, 2600]);
  });

  it('centres the run on the wall with from: centre', () => {
    expect(pack(room(), [], 0, [base600, base600], 'centre')).toEqual([1200, 1800]);
  });

  it('skips over a door', () => {
    const door: Opening = { id: 'd', wallId: 'wa', kind: 'door', positionMm: 700, widthMm: 800, heightMm: 2100 };
    // 600 fits before the door; the 800 goes after it (1500–2300).
    expect(pack(room([door]), [], 0, [base600, base800])).toEqual([300, 1900]);
  });

  it('lets base cabinets sit under a window but not wall cabinets or tall items', () => {
    const win: Opening = { id: 'win', wallId: 'wa', kind: 'window', positionMm: 0, widthMm: 1200, heightMm: 1200 };
    expect(pack(room([win]), [], 0, [base600])).toEqual([300]);
    expect(pack(room([win]), [], 0, [wallCab])).toEqual([1500]);
    expect(pack(room([win]), [], 0, [fridge])).toEqual([1655]);
  });

  it('works around items already on the wall at the same level', () => {
    const existing = onNorth('i1', 900, base600); // 600–1200
    expect(pack(room(), [existing], 0, [base600, base800])).toEqual([300, 1600]);
  });

  it('puts wall cabinets above base cabinets but not above a fridge', () => {
    const items = [onNorth('b', 300, base600), onNorth('f', 1055, fridge)]; // base 0–600, fridge 600–1510
    expect(pack(room(), items, 0, [wallCab, wallCab])).toEqual([300, 1810]);
  });

  it('keeps clear of a run on the neighbouring wall at the corner', () => {
    // A base cabinet against w2 (east) in the w1/w2 corner: it takes the last 560 mm of w1.
    const east: PlacedItem = { ...onNorth('e', 0, base600), position: { x: 3000 - 280, y: 300 }, rotationDeg: 90 };
    expect(pack(room(), [east], 0, [base600, base800, base800], 'end')).toEqual([540, 1240, 2040]);
  });

  it('ignores items out in the room that the run would not reach', () => {
    const island: PlacedItem = { ...onNorth('island', 1500, base600), position: { x: 1500, y: 2000 } };
    expect(pack(room(), [island], 0, [base600])).toEqual([300]);
  });

  it('explains what is in the way when the run does not fit', () => {
    const door: Opening = { id: 'd', wallId: 'wa', kind: 'door', positionMm: 1000, widthMm: 800, heightMm: 2100 };
    const r = room([door]);
    expect(() => pack(r, [onNorth('i2', 2400, base600)], 0, [base800, base800, base800])).toThrow(
      /add up to 2400 mm but base-800 \(800 mm\) does not fit on this 3000 mm wall: free space is 0–1000 mm and 1800–2100 mm and 2700–3000 mm \(1600 mm in total, at most 1000 mm in one piece\); in the way: door d at 1000–1800 mm, i2 at 2100–2700 mm\./
    );
  });
});
