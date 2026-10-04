import { describe, it, expect } from 'vitest';
import type { Closet, ClosetComponent, ClosetDoorStyle } from '../plan/schemas';
import { newComponent } from './catalog';
import { validateCloset } from './validate';

function closet(components: ClosetComponent[] = [], style: ClosetDoorStyle = 'open', opening?: Partial<Closet['opening']>): Closet {
  return {
    widthMm: 2000,
    heightMm: 2440,
    depthMm: 610,
    opening: { style, leftMm: 0, widthMm: 2000, ...opening },
    components,
  };
}

const shelf = (id: string, x: number, w: number, y: number) => newComponent('shelf', id, x, { widthMm: w, yMm: y });
const rod = (id: string, x: number, w: number, y: number) => newComponent('rod', id, x, { widthMm: w, yMm: y });
const drawers = (id: string, x: number, w = 600, h = 900) => newComponent('drawers', id, x, { widthMm: w, heightMm: h });
const tower = (id: string, x: number) => newComponent('tower', id, x);

describe('validateCloset', () => {
  it('accepts an empty closet', () => {
    expect(validateCloset(closet())).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('accepts a classic double-hang closet without warnings', () => {
    const r = validateCloset(
      closet([shelf('a', 0, 2000, 2134), rod('b', 0, 1000, 2057), rod('c', 0, 1000, 1067), rod('d', 1000, 1000, 1727)])
    );
    expect(r).toEqual({ valid: true, errors: [], warnings: [] });
  });

  describe('errors', () => {
    it('rejects components outside the closet, naming them by ref', () => {
      const r = validateCloset(closet([shelf('a', 0, 900, 2134), shelf('b', 1500, 900, 2134)]));
      expect(r.valid).toBe(false);
      expect(r.errors).toEqual(['Shelf c2 is outside the closet']);
    });

    it('rejects a box taller than the closet', () => {
      const r = validateCloset(closet([newComponent('tower', 't', 0, { heightMm: 2600 })]));
      expect(r.errors).toEqual(['Shelf tower c1 is outside the closet']);
    });

    it('rejects a component deeper than the closet', () => {
      const r = validateCloset(closet([newComponent('drawers', 'd', 0, { depthMm: 700 })]));
      expect(r.errors).toEqual(['Drawer unit c1 is deeper than the closet (700 > 610 mm)']);
    });

    it('rejects an opening past the closet side', () => {
      const r = validateCloset(closet([], 'bifold', { leftMm: 500, widthMm: 1800 }));
      expect(r.errors).toEqual(['the door opening runs past the right side of the closet']);
    });

    it('rejects duplicate ids', () => {
      const r = validateCloset(closet([shelf('a', 0, 500, 2134), shelf('a', 600, 500, 2134)]));
      expect(r.errors).toContain('duplicate component id "a"');
    });

    it('rejects a box without a height, and a count where none belongs or out of range', () => {
      const noHeight = { ...drawers('d', 0), heightMm: undefined };
      const rodWithCount = { ...rod('r', 0, 900, 1727), count: 3 };
      const tooMany = { ...drawers('e', 700), count: 20 };
      const r = validateCloset(closet([noHeight, rodWithCount, tooMany]));
      expect(r.errors).toEqual([
        'Drawer unit c1 needs a height',
        'Hanging rod c2 can’t have a count',
        'Drawer unit c3 can have 1–8 drawers, not 20',
      ]);
    });
  });

  describe('warnings', () => {
    it('flags overlapping boxes', () => {
      const r = validateCloset(closet([drawers('a', 0), drawers('b', 500)]));
      expect(r.valid).toBe(true);
      expect(r.warnings).toEqual(['Drawer unit c1 and Drawer unit c2 overlap']);
    });

    it('does not flag boxes that only touch', () => {
      expect(validateCloset(closet([drawers('a', 0), drawers('b', 600)])).warnings).toEqual([]);
    });

    it('flags a shelf or rod running through a box', () => {
      const r = validateCloset(closet([tower('t', 800), shelf('s', 0, 2000, 1000)]));
      expect(r.warnings).toEqual(['Shelf c2 runs through Shelf tower c1']);
    });

    it('lets a shelf run over the top of a tower', () => {
      expect(validateCloset(closet([tower('t', 800), shelf('s', 0, 2000, 2134)])).warnings).toEqual([]);
    });

    it('flags clothes that would hit something below the rod', () => {
      const r = validateCloset(closet([rod('r', 0, 1000, 1727), drawers('d', 200, 600, 900)]));
      expect(r.warnings).toEqual(['clothes on Hanging rod c1 would hit Drawer unit c2 (allow 950 mm below a rod)']);
    });

    it('flags clothes that would touch the floor', () => {
      const r = validateCloset(closet([rod('r', 0, 1000, 800)]));
      expect(r.warnings).toEqual(['clothes on Hanging rod c1 would touch the floor (allow 950 mm below a rod)']);
    });

    it('ignores things below a rod but to the side of it', () => {
      expect(validateCloset(closet([rod('r', 0, 1000, 1727), drawers('d', 1000)])).warnings).toEqual([]);
    });

    it('flags a rod too close under a shelf to lift hangers off', () => {
      const r = validateCloset(closet([shelf('s', 0, 1000, 2134), rod('r', 0, 1000, 2110)]));
      expect(r.warnings).toEqual(['Hanging rod c2 is too close under Shelf c1 to lift hangers off (allow 50 mm)']);
    });

    it.each<[ClosetDoorStyle, number, boolean]>([
      ['bifold', 0, true], // flush with the jamb: the folded doors block it
      ['bifold', 200, false],
      ['hinged', 20, true],
      ['hinged', 100, false],
      ['open', 0, false],
    ])('%s doors, drawers at %i mm: blocked = %s', (style, x, blocked) => {
      const r = validateCloset(closet([drawers('d', x)], style, { leftMm: 0, widthMm: 2000 }));
      expect(r.warnings.some((w) => w.includes('behind the doors'))).toBe(blocked);
    });

    it('flags drawers outside the opening of a closet with returns', () => {
      const r = validateCloset(closet([drawers('d', 100)], 'bifold', { leftMm: 400, widthMm: 1200 }));
      expect(r.warnings).toEqual(['Drawer unit c1 is partly behind the doors: keep drawers and baskets between 500 and 1500 mm']);
    });

    it('wants drawers behind sliding doors to fit one half of the opening', () => {
      const straddling = validateCloset(closet([drawers('d', 700)], 'sliding'));
      expect(straddling.warnings).toEqual([
        'Drawer unit c1 can’t be opened past the sliding doors: keep it within the left half (0–1000 mm) or the right half (1000–2000 mm)',
      ]);
      expect(validateCloset(closet([drawers('d', 1200)], 'sliding')).warnings).toEqual([]);
    });

    it('flags things hidden well past the opening edge', () => {
      const r = validateCloset(closet([newComponent('shoe_shelf', 's', 0)], 'bifold', { leftMm: 600, widthMm: 800 }));
      expect(r.warnings).toEqual(['Shoe shelf c1 reaches 600 mm past the door opening, so it’s hard to get to']);
    });

    it('flags a shelf that needs a step stool', () => {
      const r = validateCloset(closet([shelf('s', 0, 1000, 2300)]));
      expect(r.warnings).toEqual(['Shelf c1 is 2300 mm up: you’ll need a step stool']);
    });

    it('flags a non-standard width', () => {
      const r = validateCloset(closet([drawers('d', 0, 1200)]));
      expect(r.warnings).toEqual(['Drawer unit c1 is 1200 mm wide; standard is 305–914 mm']);
    });
  });
});
