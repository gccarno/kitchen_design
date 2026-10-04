import { describe, it, expect } from 'vitest';
import type { Closet } from '../plan/schemas';
import { newCloset, newComponent } from './catalog';
import { describeClosetChanges } from './changes';

const base: Closet = { ...newCloset(), components: [newComponent('rod', 'a', 0), newComponent('drawers', 'b', 1000)] };

describe('describeClosetChanges', () => {
  it('reports nothing for the same closet', () => {
    expect(describeClosetChanges(base, base)).toEqual([]);
  });

  it('reports size and door changes', () => {
    const after: Closet = { ...base, widthMm: 2400, opening: { style: 'sliding', leftMm: 0, widthMm: 2400 } };
    expect(describeClosetChanges(base, after).map((c) => c.text)).toEqual([
      'Closet size: 1830 × 2440 × 610 → 2400 × 2440 × 610 mm (w × h × d)',
      'Door opening: bifold, 1830 mm wide at 0 mm → sliding, 2400 mm wide at 0 mm',
    ]);
  });

  it('reports components added, moved, resized and removed', () => {
    const after: Closet = {
      ...base,
      components: [
        { ...base.components[1], xMm: 1200, count: 5 },
        newComponent('shelf', 'c', 0),
      ],
    };
    expect(describeClosetChanges(base, after)).toEqual([
      { kind: 'changed', subject: 'item', text: 'Drawer unit moved to 1200 mm from the left, 0 mm up' },
      { kind: 'changed', subject: 'item', text: 'Drawer unit resized: 610 × 914 mm, 5 drawers' },
      { kind: 'removed', subject: 'item', text: 'Hanging rod at 0 mm from the left, 1727 mm up' },
      { kind: 'added', subject: 'item', text: 'Shelf, 900 mm wide, at 0 mm from the left, 2134 mm up' },
    ]);
  });
});
