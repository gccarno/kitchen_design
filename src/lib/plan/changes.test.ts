import { describe, it, expect } from 'vitest';
import { describePlanChanges } from './changes';
import { ProjectSchema, type PlacedItem, type Project, type Room } from './schemas';

const RECT = (w: number, d: number): Room['polygon'] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
];

function project(overrides: Partial<Project> = {}): Project {
  return ProjectSchema.parse({
    id: 'p',
    name: 'Kitchen',
    units: 'mm',
    createdAt: 'x',
    updatedAt: 'x',
    revision: 0,
    photos: [],
    room: { polygon: RECT(3000, 4000), walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })), openings: [] },
    items: [],
    history: [],
    ...overrides,
  });
}

const item = (id: string, x: number, y: number, extra: Partial<PlacedItem> = {}): PlacedItem => ({
  id,
  catalogId: 'base-600',
  sizeMm: { w: 600, d: 560, h: 720 },
  position: { x, y },
  rotationDeg: 0,
  ...extra,
});

const texts = (before: Project, after: Project) => describePlanChanges(before, after).map((c) => `${c.kind}: ${c.text}`);

describe('describePlanChanges', () => {
  it('returns nothing for identical plans', () => {
    expect(describePlanChanges(project(), project())).toEqual([]);
  });

  it('describes a rename', () => {
    expect(texts(project(), project({ name: 'New' }))).toEqual(['changed: Rename "Kitchen" → "New"']);
  });

  it('summarizes a replaced room as one outline change and one walls change', () => {
    const before = project();
    const after = project({
      room: {
        polygon: RECT(3600, 2700),
        walls: ['n1', 'n2', 'n3', 'n4'].map((id) => ({ id, thicknessMm: 120 })),
        openings: [],
      },
    });
    expect(texts(before, after)).toEqual([
      'changed: Room outline: 3000 × 4000 mm, 12.0 m² → 3600 × 2700 mm, 9.7 m²',
      'changed: All walls replaced: 4 walls (3600, 2700, 3600, 2700 mm)',
    ]);
  });

  it('lists per-wall length changes when wall ids are kept', () => {
    const before = project();
    const after = project({ room: { ...before.room, polygon: RECT(3500, 4000) } });
    expect(texts(before, after)).toEqual([
      'changed: Room outline: 3000 × 4000 mm, 12.0 m² → 3500 × 4000 mm, 14.0 m²',
      'changed: Wall 1: 3000 → 3500 mm',
      'changed: Wall 3: 3000 → 3500 mm',
    ]);
  });

  it('describes wall thickness changes', () => {
    const before = project();
    const walls = before.room.walls.map((w, i) => (i === 1 ? { ...w, thicknessMm: 150 } : w));
    expect(texts(before, project({ room: { ...before.room, walls } }))).toEqual([
      'changed: Wall 2 thickness: 100 → 150 mm',
    ]);
  });

  it('describes openings added, removed, and changed', () => {
    const door = { id: 'o1', wallId: 'a', kind: 'door' as const, positionMm: 100, widthMm: 900, heightMm: 2100 };
    const window = { id: 'o2', wallId: 'b', kind: 'window' as const, positionMm: 500, widthMm: 1200, heightMm: 1000 };
    const before = project({ room: { ...project().room, openings: [door, window] } });
    const after = project({
      room: {
        ...project().room,
        openings: [
          { ...door, widthMm: 800 },
          { id: 'o3', wallId: 'c', kind: 'pass_through', positionMm: 0, widthMm: 1000, heightMm: 2000 },
        ],
      },
    });
    expect(texts(before, after)).toEqual([
      'changed: Door on wall 1: 900 → 800 mm wide',
      'removed: Window on wall 2',
      'added: Pass-through on wall 3 (1000 mm wide)',
    ]);
  });

  it('describes measurements added and removed', () => {
    const before = project({ room: { ...project().room, measurements: [{ wallId: 'b', lengthMm: 4000, source: 'user' }] } });
    const after = project({ room: { ...project().room, measurements: [{ wallId: 'a', lengthMm: 3000, source: 'user' }] } });
    expect(texts(before, after)).toEqual(['added: Wall 1 measured at 3000 mm', 'removed: Measurement of wall 2']);
  });

  it('describes items added, removed, moved, and rotated', () => {
    const before = project({ items: [item('i1', 1000, 1000), item('i2', 2000, 2000), item('i3', 500, 500)] });
    const after = project({
      items: [
        item('i1', 1200, 1000),
        item('i2', 2000, 2000, { rotationDeg: 90 }),
        item('i4', 1500, 3000, { catalogId: 'fridge-600' }),
      ],
    });
    expect(texts(before, after)).toEqual([
      'changed: base-600 moved to (1200, 1000)',
      'changed: base-600 rotated to 90°',
      'removed: base-600 at (500, 500)',
      'added: fridge-600 at (1500, 3000)',
    ]);
  });
});
