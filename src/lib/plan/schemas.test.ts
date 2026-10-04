import { describe, it, expect } from 'vitest';
import minimal from './__fixtures__/minimal.json';
import bad from './__fixtures__/bad.json';
import { ProjectSchema, projectKind } from './schemas';

describe('ProjectSchema', () => {
  it('accepts a minimal valid project', () => {
    const parsed = ProjectSchema.parse(minimal);
    expect(parsed.id).toBe('minimal-1');
    expect(parsed.revision).toBe(0);
    expect(parsed.room.walls).toHaveLength(4);
  });

  it('rejects invalid units', () => {
    expect(() => ProjectSchema.parse(bad)).toThrow();
  });

  it('rejects negative revision', () => {
    const withNegRevision = { ...minimal, revision: -1 };
    expect(() => ProjectSchema.parse(withNegRevision)).toThrow();
  });

  it('rejects room polygon with fewer than 3 points', () => {
    const badPoly = { ...minimal, room: { ...minimal.room, polygon: [[0, 0], [1, 0]] } };
    expect(() => ProjectSchema.parse(badPoly)).toThrow();
  });

  it('accepts project with one placed item', () => {
    const withItem = {
      ...minimal,
      items: [
        {
          id: 'i1',
          catalogId: 'base-cabinet-600',
          sizeMm: { w: 600, d: 560, h: 720 },
          position: { x: 100, y: 200 },
          rotationDeg: 0,
          tag: 'base',
        },
      ],
    };
    const parsed = ProjectSchema.parse(withItem);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].catalogId).toBe('base-cabinet-600');
  });

  it('rejects a placed item without a size snapshot', () => {
    const withItem = {
      ...minimal,
      items: [{ id: 'i1', catalogId: 'c', position: { x: 0, y: 0 }, rotationDeg: 0 }],
    };
    expect(() => ProjectSchema.parse(withItem)).toThrow();
  });

  it('requires an inverse patch on every history entry', () => {
    const entry = { revision: 1, patch: [], at: '2026-01-01T00:00:00.000Z', source: 'user', summary: '' };
    expect(() => ProjectSchema.parse({ ...minimal, history: [entry] })).toThrow();
    expect(() => ProjectSchema.parse({ ...minimal, history: [{ ...entry, inverse: [] }] })).not.toThrow();
  });

  it('accepts a photo with a resolved reference object', () => {
    const photo = {
      id: 'ph1',
      path: 'photos/ph1.jpg',
      width: 4000,
      height: 3000,
      referenceObject: { kind: 'credit_card', side: 'long', knownSizeMm: 85.6, pixelBox: [10, 10, 200, 130] },
    };
    expect(() => ProjectSchema.parse({ ...minimal, photos: [photo] })).not.toThrow();
  });

  it('rejects the removed tape_measure reference kind', () => {
    const photo = {
      id: 'ph1',
      path: 'photos/ph1.jpg',
      width: 4000,
      height: 3000,
      referenceObject: { kind: 'tape_measure', side: 'long', knownSizeMm: 50, pixelBox: [0, 0, 1, 1] },
    };
    expect(() => ProjectSchema.parse({ ...minimal, photos: [photo] })).toThrow();
  });

  it('reads a project saved before project kinds existed as a kitchen', () => {
    const parsed = ProjectSchema.parse(minimal);
    expect(parsed.kind).toBeUndefined();
    expect(projectKind(parsed)).toBe('kitchen');
  });

  it('accepts a closet project', () => {
    const closet = {
      widthMm: 1830,
      heightMm: 2440,
      depthMm: 610,
      opening: { style: 'bifold', leftMm: 0, widthMm: 1830 },
      components: [
        { id: 'c1', kind: 'shelf', xMm: 0, widthMm: 1830, yMm: 2134, depthMm: 305 },
        { id: 'c2', kind: 'drawers', xMm: 600, widthMm: 600, yMm: 0, heightMm: 900, count: 4 },
      ],
    };
    const parsed = ProjectSchema.parse({ ...minimal, kind: 'closet', closet });
    expect(projectKind(parsed)).toBe('closet');
    expect(parsed.closet?.components).toHaveLength(2);
  });

  it('rejects an unknown closet component kind or door style', () => {
    const closet = {
      widthMm: 1000,
      heightMm: 2400,
      depthMm: 600,
      opening: { style: 'bifold', leftMm: 0, widthMm: 1000 },
      components: [{ id: 'c1', kind: 'trampoline', xMm: 0, widthMm: 100, yMm: 0 }],
    };
    expect(() => ProjectSchema.parse({ ...minimal, kind: 'closet', closet })).toThrow();
    const badDoor = { ...closet, components: [], opening: { style: 'portal', leftMm: 0, widthMm: 1000 } };
    expect(() => ProjectSchema.parse({ ...minimal, kind: 'closet', closet: badDoor })).toThrow();
  });

  it('accepts user measurements on the room', () => {
    const room = { ...minimal.room, measurements: [{ wallId: 'w0', lengthMm: 3000, source: 'user' }] };
    expect(ProjectSchema.parse({ ...minimal, room }).room.measurements).toHaveLength(1);
  });
});
