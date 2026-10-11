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

describe('counter beside', () => {
  it('walks through counter neighbours and stops at an appliance', () => {
    const items = run([['range', 760, 650], ['base', 600], ['sink', 900], ['dishwasher', 600], ['base', 450], ['fridge', 910, 700, 1780], ['base', 600]]);
    expect(counterBeside(items[2], items)).toEqual([600, 1050]);
  });

  it('counts across a fridge-sized side gap but not a 200 mm one', () => {
    const spaced = run([['fridge', 910, 700, 1780], ['base', 600]], 0, 50);
    expect(counterBeside(spaced[0], spaced)).toEqual([0, 600]);
    const apart = run([['sink', 900], ['base', 600]], 0, 200);
    expect(counterBeside(apart[0], apart)).toEqual([0, 0]);
  });

  it('gives the same lengths for a run turned 90° along the left wall, and for rotation 360', () => {
    const items = run([['base', 600], ['sink', 900], ['base', 450]]);
    // Rotate the run about the origin by 90° (CCW), then shift it inside the room.
    const turned = items.map((it) => ({ ...it, rotationDeg: 90, position: { x: -it.position.y + 560, y: it.position.x } }));
    // The run's +x now points down the wall (+y), so the 600 is still on the −x side.
    expect(counterBeside(turned[1], turned)).toEqual([600, 450]);
    const mixed = items.map((it, i) => (i === 0 ? { ...it, rotationDeg: 360 } : it));
    expect(counterBeside(mixed[1], mixed)).toEqual([600, 450]);
  });

  it('counts a deeper corner cabinet whose back is in line with the run', () => {
    const corner = item('corner', 900, 900, 450, 450);
    const rest = run([['sink', 900], ['base', 450]], 900);
    expect(counterBeside(rest[0], [corner, ...rest])).toEqual([900, 450]);
  });

  it('counts a corner cabinet beside the run on the other wall of an L, and stops there', () => {
    // Corner in the top-left; a range on the left wall (facing +x) just below it, a base below that.
    const corner = item('corner', 900, 900, 450, 450);
    const beyond = item('base', 600, 560, 1200, 280); // on the top wall: past the corner, not counted
    const rangeOnLeft = item('range', 760, 650, 325, 900 + 380, 270);
    const baseOnLeft = item('base', 600, 560, 280, 900 + 760 + 300, 270);
    // rotation 270: the item's +x points to −y (up the wall), so the corner is on its +x side.
    expect(counterBeside(rangeOnLeft, [corner, beyond, rangeOnLeft, baseOnLeft])).toEqual([600, 900]);
  });
});

describe('landing space', () => {
  it('sink: 600 one side and 450 the other passes; 300 one side fails', () => {
    expect(status(run([['base', 600], ['sink', 900], ['dishwasher', 450]]), 'sink-landing')).toBe('pass');
    expect(status(run([['base', 300], ['sink', 900], ['base', 900]]), 'sink-landing')).toBe('fail');
  });

  it('range: needs counter on both sides; a range at the end of a run fails', () => {
    expect(status(run([['base', 300], ['range', 760, 650], ['base', 450]]), 'range-landing')).toBe('pass');
    const end = checkLayout(kitchen(run([['range', 760, 650], ['base', 900]])));
    expect(rule(end, 'range-landing')).toMatchObject({
      status: 'fail',
      detail: '0 mm and 900 mm beside "range-760" (needs 380 mm and 300 mm)',
    });
  });

  it('passes when any one of several sinks has the space', () => {
    const items = [...run([['sink', 900]]), ...run([['base', 600], ['sink', 900], ['base', 600]], 2000)];
    expect(status(items, 'sink-landing')).toBe('pass');
  });

  it('fridge: counter beside it, or an island in front of it', () => {
    expect(status(run([['fridge', 910, 700, 1780], ['base', 450]], 0, 50), 'fridge-landing')).toBe('pass');
    expect(status(run([['fridge', 910, 700, 1780], ['tall', 600, 560, 2100]]), 'fridge-landing')).toBe('fail');
    const f = run([['fridge', 910, 700, 1780]]);
    expect(status([...f, item('island', 1200, 900, 455, 700 + 500 + 450)], 'fridge-landing')).toBe('pass');
    expect(status([...f, item('island', 1200, 900, 455, 700 + 1500 + 450)], 'fridge-landing')).toBe('fail');
  });

  it('does not apply without the appliance', () => {
    expect(status(run([['base', 600]]), 'sink-landing')).toBe('n/a');
  });
});

describe('dishwasher next to the sink', () => {
  it('passes when beside the sink, fails 1200 mm away, n/a without one', () => {
    expect(status(run([['sink', 900], ['dishwasher', 600]]), 'dishwasher-sink')).toBe('pass');
    expect(status(run([['sink', 900], ['base', 1200], ['dishwasher', 600]]), 'dishwasher-sink')).toBe('fail');
    expect(status(run([['sink', 900]]), 'dishwasher-sink')).toBe('n/a');
  });
});

describe('work aisle', () => {
  /** A base run on the top wall and a facing one whose fronts are `gap` apart. */
  const galley = (gap: number) => [...run([['base', 600], ['sink', 900]]), item('base', 1500, 560, 750, 560 + gap + 280, 180)];

  it('fails facing counters 1000 mm apart and passes at 1200 mm', () => {
    expect(status(galley(1000), 'work-aisle')).toBe('fail');
    expect(rule(checkLayout(kitchen(galley(1000))), 'work-aisle').detail).toMatch(/^1000 mm from/);
    expect(status(galley(1200), 'work-aisle')).toBe('pass');
  });

  it('passes a single run with nothing across from it', () => {
    expect(rule(checkLayout(kitchen(run([['base', 600], ['sink', 900]]))), 'work-aisle').detail).toBe('no counters face each other');
  });

  it('counts an island across from the run', () => {
    expect(status([...run([['sink', 900]]), item('island', 1800, 900, 450, 560 + 900 + 450)], 'work-aisle')).toBe('fail');
  });
});

describe('counter frontage', () => {
  it('adds up counter widths, as information', () => {
    const r = rule(checkLayout(kitchen(run([['base', 1200], ['sink', 900], ['dishwasher', 600], ['range', 760, 650]]))), 'counter-frontage');
    expect(r).toMatchObject({ status: 'fail', info: true, detail: '2700 mm of counter (guideline 3350 mm)' });
  });
});
