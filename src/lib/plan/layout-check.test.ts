import { describe, it, expect } from 'vitest';
import { checkLayout, counterBeside, type LayoutRule } from './layout-check';
import { ProjectSchema, type PlacedItem, type Project } from './schemas';

let n = 0;
/** A floor item with its centre at (x, y), front facing +y when rotationDeg is 0. */
function item(tag: string | undefined, w: number, d: number, x: number, y: number, rotationDeg = 0, h = 900): PlacedItem {
  n += 1;
  return { id: `i${n}`, catalogId: `${tag ?? 'thing'}-${w}`, sizeMm: { w, d, h }, position: { x, y }, rotationDeg, ...(tag ? { tag } : {}) };
}

/** Items packed left to right against the top wall (y = 0) from `x0`, `gap` apart; spec = [tag, w, d?, h?]. */
function run(specs: Array<[string, number, number?, number?]>, x0 = 0, gap = 0): PlacedItem[] {
  let x = x0;
  return specs.map(([tag, w, d = 560, h = 900]) => {
    const it = item(tag, w, d, x + w / 2, d / 2, 0, h);
    x += w + gap;
    return it;
  });
}

function kitchen(items: PlacedItem[], kind: 'kitchen' | 'closet' = 'kitchen'): Project {
  return ProjectSchema.parse({
    id: 'p',
    name: 'k',
    kind,
    units: 'mm',
    createdAt: 'x',
    updatedAt: 'x',
    revision: 0,
    photos: [],
    room: {
      polygon: [
        [0, 0],
        [6000, 0],
        [6000, 5000],
        [0, 5000],
      ],
      walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
      openings: [],
    },
    items,
    history: [],
    ...(kind === 'closet'
      ? { closet: { widthMm: 1830, heightMm: 2438, depthMm: 610, opening: { style: 'bifold', leftMm: 0, widthMm: 1830 }, components: [] } }
      : {}),
  });
}

const rule = (rules: LayoutRule[], id: string) => rules.find((r) => r.id === id)!;
const status = (items: PlacedItem[], id: string) => rule(checkLayout(kitchen(items)), id).status;

// A comfortable triangle: sink and range 1800 mm apart on the top wall, the fridge facing them.
const sink = () => item('sink', 900, 560, 1500, 280);
const range = () => item('range', 760, 650, 3300, 325);
const fridge = (x = 2400, y = 1900) => item('fridge', 910, 700, x, y, 180, 1780);

describe('work triangle', () => {
  it('passes a triangle with every side 1200–2700 mm and nothing in the way', () => {
    const rules = checkLayout(kitchen([sink(), range(), fridge()]));
    expect(rule(rules, 'triangle-legs').status).toBe('pass');
    expect(rule(rules, 'triangle-total').status).toBe('pass');
    expect(rule(rules, 'triangle-clear').status).toBe('pass');
    expect(rule(rules, 'triangle-legs').detail).toContain('sink ↔ range 1801 mm'); // centres at different depths
  });

  it('fails a side that is too long, and a total that is too long', () => {
    const rules = checkLayout(kitchen([sink(), range(), fridge(5500, 4500)]));
    expect(rule(rules, 'triangle-legs').status).toBe('fail');
    expect(rule(rules, 'triangle-total').status).toBe('fail');
  });

  it('fails when an island stands across a side', () => {
    const rules = checkLayout(kitchen([sink(), range(), fridge(), item('island', 1200, 600, 2000, 1100)]));
    expect(rule(rules, 'triangle-clear')).toMatchObject({ status: 'fail', detail: '"island-1200" is in the way (fridge ↔ sink)' });
  });

  it('uses the closest of several fridges', () => {
    expect(status([sink(), range(), fridge(5500, 4500), fridge()], 'triangle-legs')).toBe('pass');
  });

  it('does not apply without all three', () => {
    const rules = checkLayout(kitchen([sink(), fridge()]));
    for (const id of ['triangle-legs', 'triangle-total', 'triangle-clear']) expect(rule(rules, id).status).toBe('n/a');
  });
});

describe('checkLayout', () => {
  it('returns every rule, in order, for a kitchen', () => {
    const rules = checkLayout(kitchen([]));
    expect(rules.map((r) => r.id)).toEqual([
      'triangle-legs',
      'triangle-total',
      'triangle-clear',
      'sink-landing',
      'range-landing',
      'fridge-landing',
      'dishwasher-sink',
      'work-aisle',
      'counter-frontage',
    ]);
    expect(rules.every((r) => r.status === 'n/a')).toBe(true);
  });

  it('returns nothing for a closet', () => {
    expect(checkLayout(kitchen([], 'closet'))).toEqual([]);
  });

  it('ignores items without a tag, and wall-mounted items', () => {
    const wallSink: PlacedItem = { ...sink(), mount: 'wall' };
    expect(checkLayout(kitchen([item(undefined, 900, 560, 1500, 280), wallSink])).every((r) => r.status === 'n/a')).toBe(true);
  });
});
