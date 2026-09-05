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
});
