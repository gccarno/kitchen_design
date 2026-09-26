import { describe, it, expect } from 'vitest';
import minimal from './__fixtures__/minimal.json';
import bad from './__fixtures__/bad.json';
import { ProjectSchema } from './schemas';

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

  it('accepts user measurements on the room', () => {
    const room = { ...minimal.room, measurements: [{ wallId: 'w0', lengthMm: 3000, source: 'user' }] };
    expect(ProjectSchema.parse({ ...minimal, room }).room.measurements).toHaveLength(1);
  });
});
