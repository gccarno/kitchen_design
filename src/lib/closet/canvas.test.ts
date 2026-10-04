import { describe, it, expect } from 'vitest';
import type { Closet } from '../plan/schemas';
import { newCloset, newComponent } from './catalog';
import { clientToElevation, dragTo, placeAt, resizeTo, snapX, snapY } from './canvas';

const tower = newComponent('tower', 't', 700); // 700–1157
const closet: Closet = { ...newCloset(), components: [tower] };

describe('clientToElevation', () => {
  it('undoes a uniform, centred fit', () => {
    // viewBox 1000 × 500 drawn into 400 × 400: scale 0.4, letterboxed 100 px top and bottom.
    const rect = { left: 10, top: 20, width: 400, height: 400 };
    const vb = { x: -50, y: -50, w: 1000, h: 500 };
    expect(clientToElevation(rect, vb, 10, 120)).toEqual([-50, -50]);
    expect(clientToElevation(rect, vb, 410, 320)).toEqual([950, 450]);
  });
});

describe('snapX', () => {
  it('lines a left or right edge up with a nearby edge', () => {
    expect(snapX(closet, 1180, 400)).toBe(1157); // left edge to the tower's right side
    expect(snapX(closet, 280, 400)).toBe(300); // right edge (680) to the tower's left side (700)
    expect(snapX(closet, 20, 400)).toBe(0); // the closet's left side
  });

  it('otherwise rounds to the grid', () => {
    expect(snapX(closet, 412, 200)).toBe(400);
  });

  it('ignores the component being moved', () => {
    // Its own left side (700) would be within reach; without it, 680 just rounds to the grid.
    expect(snapX(closet, 680, 457, 't')).toBe(675);
  });
});

describe('snapY', () => {
  it('drops boxes near the floor onto it and rounds the rest to the grid', () => {
    expect(snapY('drawers', 40)).toBe(0);
    expect(snapY('rod', 40)).toBe(50);
    expect(snapY('shelf', 2131)).toBe(2125);
  });
});

describe('placeAt', () => {
  it('centres a rod on the tap at the tapped height', () => {
    expect(placeAt(closet, 'rod', 'r', [350, 1720])).toMatchObject({ kind: 'rod', xMm: 0, widthMm: 900, yMm: 1725 });
  });

  it('stands drawers on the floor whatever the tapped height, against the nearest side', () => {
    // Centred on 1500 its left edge would be 1195; the closet's right side is closest (1830 − 610).
    expect(placeAt(closet, 'drawers', 'd', [1500, 1200])).toMatchObject({ yMm: 0, xMm: 1220 });
  });

  it('keeps a component inside a narrow closet', () => {
    const narrow = { ...newCloset(), widthMm: 600, components: [] };
    expect(placeAt(narrow, 'shelf', 's', [300, 2000])).toMatchObject({ xMm: 0, widthMm: 600 });
  });
});

describe('dragTo', () => {
  it('snaps and keeps the component inside the closet', () => {
    const rod = newComponent('rod', 'r', 0);
    expect(dragTo({ ...closet, components: [tower, rod] }, rod, 1500, 1700)).toMatchObject({ xMm: 930, yMm: 1700 });
  });
});

describe('resizeTo', () => {
  const rod = newComponent('rod', 'r', 0, { widthMm: 600 });
  const c: Closet = { ...closet, components: [tower, rod] };

  it('moves the right edge, snapping to the tower', () => {
    expect(resizeTo(c, rod, 'right', 690)).toMatchObject({ xMm: 0, widthMm: 700 });
  });

  it('moves the left edge, keeping the right edge put', () => {
    expect(resizeTo(c, rod, 'left', 200)).toMatchObject({ xMm: 200, widthMm: 400 });
  });

  it('never makes it narrower than its kind allows', () => {
    expect(resizeTo(c, rod, 'left', 590)).toMatchObject({ xMm: 450, widthMm: 150 });
  });
});
