import { describe, it, expect } from 'vitest';
import {
  planToJsonPatch,
  applyJsonPatch,
  summarizePatch,
  validatePatchOnProject,
} from './diff';
import { ProjectSchema, type Project } from './schemas';

function newProject(): Project {
  const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
  return ProjectSchema.parse({
    id: 'p1',
    name: 'P',
    units: 'mm',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    photos: [],
    room: {
      polygon: [
        [0, 0],
        [3000, 0],
        [3000, 4000],
        [0, 4000],
      ],
      walls: [
        { id: 'w0', from: [0, 0], to: [3000, 0], thicknessMm: 100 },
      ],
      openings: [],
    },
    items: [],
    history: [],
  });
}

describe('planToJsonPatch', () => {
  it('produces a no-op patch when before and after are equal', () => {
    const p = newProject();
    const patch = planToJsonPatch(p, p);
    expect(patch).toEqual([]);
  });

  it('produces a replace op when the project name changes', () => {
    const before = newProject();
    const after = { ...before, name: 'Renamed' };
    const patch = planToJsonPatch(before, after);
    expect(patch).toEqual([{ op: 'replace', path: '/name', value: 'Renamed' }]);
  });

  it('produces an add op when a placed item is added', () => {
    const before = newProject();
    const after: Project = {
      ...before,
      items: [
        {
          id: 'i1',
          catalogId: 'base-cabinet-600',
          position: { x: 100, y: 200 },
          rotationDeg: 0,
        },
      ],
    };
    const patch = planToJsonPatch(before, after);
    expect(patch.length).toBeGreaterThan(0);
    // There should be a single add for the items array.
    const adds = patch.filter((op) => op.op === 'add' && op.path === '/items/0');
    expect(adds.length).toBeGreaterThanOrEqual(1);
    expect(adds[0].value).toMatchObject({ id: 'i1', catalogId: 'base-cabinet-600' });
  });

  it('produces a remove op when an item is removed', () => {
    const before: Project = {
      ...newProject(),
      items: [
        {
          id: 'i1',
          catalogId: 'base-cabinet-600',
          position: { x: 0, y: 0 },
          rotationDeg: 0,
        },
      ],
    };
    const after: Project = { ...before, items: [] };
    const patch = planToJsonPatch(before, after);
    expect(patch).toContainEqual({ op: 'remove', path: '/items/0' });
  });

  it('produces a replace op when a polygon vertex changes', () => {
    const before = newProject();
    const after: Project = {
      ...before,
      room: {
        ...before.room,
        polygon: [
          [0, 0],
          [3000, 0],
          [3000, 5000],
          [0, 4000],
        ] as Project['room']['polygon'],
      },
    };
    const patch = planToJsonPatch(before, after);
    expect(patch).toContainEqual({
      op: 'replace',
      path: '/room/polygon/2/1',
      value: 5000,
    });
  });
});

describe('applyJsonPatch', () => {
  it('applies a replace and re-validates against ProjectSchema', () => {
    const before = newProject();
    const patch = [{ op: 'replace' as const, path: '/name', value: 'After' }];
    const after = applyJsonPatch(before, patch);
    expect(after.name).toBe('After');
  });

  it('throws on an invalid patch (out-of-range index)', () => {
    const before = newProject();
    const patch = [{ op: 'remove' as const, path: '/items/99' }];
    expect(() => applyJsonPatch(before, patch)).toThrow();
  });

  it('round-trips: planToJsonPatch then applyJsonPatch returns the same project', () => {
    const before = newProject();
    const after: Project = {
      ...before,
      name: 'Round',
      room: {
        ...before.room,
        polygon: [
          [0, 0],
          [5000, 0],
          [5000, 4000],
          [0, 4000],
        ] as Project['room']['polygon'],
      },
      items: [
        {
          id: 'i1',
          catalogId: 'base-cabinet-600',
          position: { x: 100, y: 200 },
          rotationDeg: 0,
        },
      ],
    };
    const patch = planToJsonPatch(before, after);
    const restored = applyJsonPatch(before, patch);
    expect(restored).toEqual(after);
  });
});

describe('summarizePatch', () => {
  it('returns a one-line description for a name change', () => {
    const s = summarizePatch([{ op: 'replace', path: '/name', value: 'X' }]);
    expect(s).toMatch(/rename/i);
  });

  it('returns "no changes" for an empty patch', () => {
    expect(summarizePatch([])).toMatch(/no changes/);
  });

  it('describes a polygon resize', () => {
    const s = summarizePatch([
      { op: 'replace', path: '/room/polygon/1/0', value: 5000 },
    ]);
    expect(s).toMatch(/resize|room|polygon/i);
  });
});

describe('validatePatchOnProject', () => {
  it('accepts a patch that yields a valid project', () => {
    const p = newProject();
    const patch = [{ op: 'replace' as const, path: '/name', value: 'OK' }];
    const r = validatePatchOnProject(p, patch);
    expect(r.ok).toBe(true);
  });

  it('rejects a patch whose result is not a valid project', () => {
    const p = newProject();
    const patch = [{ op: 'replace' as const, path: '/units', value: 'parsecs' }];
    const r = validatePatchOnProject(p, patch);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.join(' ')).toMatch(/units|invalid/i);
    }
  });

  it('rejects a patch that fails to apply', () => {
    const p = newProject();
    const patch = [{ op: 'remove' as const, path: '/items/0' }];
    const r = validatePatchOnProject(p, patch);
    expect(r.ok).toBe(false);
  });
});
