import { describe, it, expect } from 'vitest';
import {
  planToJsonPatch,
  applyJsonPatch,
  summarizePatch,
  validatePatchOnProject,
  commitRevision,
  StaleRevisionError,
  InvalidPatchError,
  HISTORY_LIMIT,
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
        { id: 'w0', thicknessMm: 100 },
        { id: 'w1', thicknessMm: 100 },
        { id: 'w2', thicknessMm: 100 },
        { id: 'w3', thicknessMm: 100 },
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
          sizeMm: { w: 600, d: 560, h: 720 },
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
          sizeMm: { w: 600, d: 560, h: 720 },
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
          sizeMm: { w: 600, d: 560, h: 720 },
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
    const patch = [{ op: 'replace' as const, path: '/room/walls/0/thicknessMm', value: -5 }];
    const r = validatePatchOnProject(p, patch);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.join(' ')).toMatch(/thicknessMm|invalid|number/i);
    }
  });

  it('rejects a patch that fails to apply', () => {
    const p = newProject();
    const patch = [{ op: 'remove' as const, path: '/items/0' }];
    const r = validatePatchOnProject(p, patch);
    expect(r.ok).toBe(false);
  });
});

describe('patch-path allowlist', () => {
  it.each([
    ['/id', 'x'],
    ['/revision', 99],
    ['/history', []],
    ['/photos', []],
    ['/units', 'in'],
    ['/updatedAt', 'x'],
    ['/names', 'x'],
  ])('rejects ops targeting %s', (path, value) => {
    expect(() => applyJsonPatch(newProject(), [{ op: 'replace', path, value }])).toThrow(/non-editable path/);
  });

  it('rejects move/copy whose source is outside the allowlist', () => {
    expect(() => applyJsonPatch(newProject(), [{ op: 'copy', from: '/id', path: '/name' }])).toThrow(
      /non-editable path/
    );
  });

  it('allows /name, /room/** and /items/**', () => {
    const p = applyJsonPatch(newProject(), [
      { op: 'replace', path: '/name', value: 'N' },
      { op: 'replace', path: '/room/walls/0/thicknessMm', value: 150 },
      {
        op: 'add',
        path: '/items/-',
        value: { id: 'i1', catalogId: 'c', sizeMm: { w: 600, d: 560, h: 720 }, position: { x: 1, y: 1 }, rotationDeg: 0 },
      },
    ]);
    expect(p.name).toBe('N');
    expect(p.items).toHaveLength(1);
  });
});

describe('commitRevision', () => {
  const at = '2026-02-02T00:00:00.000Z';
  const rename = [{ op: 'replace' as const, path: '/name', value: 'Renamed' }];

  it('applies the patch, bumps revision and updatedAt, and records history', () => {
    const before = newProject();
    const after = commitRevision(before, rename, { baseRevision: 0, source: 'user', summary: 'rename', at });
    expect(after.name).toBe('Renamed');
    expect(after.revision).toBe(1);
    expect(after.updatedAt).toBe(at);
    expect(after.history).toHaveLength(1);
    expect(after.history[0]).toMatchObject({ revision: 1, patch: rename, source: 'user', summary: 'rename', at });
  });

  it('records an inverse that restores the previous plan', () => {
    const before = newProject();
    const movedVertex = [{ op: 'replace' as const, path: '/room/polygon/2', value: [3500, 4500] }];
    const after = commitRevision(before, movedVertex, { baseRevision: 0, source: 'llm', summary: 's', at });
    const undone = applyJsonPatch(after, after.history[0].inverse);
    expect(undone.room).toEqual(before.room);
    expect(undone.name).toEqual(before.name);
  });

  it('rejects a stale baseRevision', () => {
    const p = { ...newProject(), revision: 3 };
    expect(() => commitRevision(p, rename, { baseRevision: 2, source: 'llm', summary: 's', at })).toThrow(
      StaleRevisionError
    );
  });

  it('rejects a patch that leaves the plan semantically invalid', () => {
    const p = newProject();
    const dropWall = [{ op: 'remove' as const, path: '/room/walls/3' }];
    expect(() => commitRevision(p, dropWall, { baseRevision: 0, source: 'user', summary: 's', at })).toThrow(
      /3 walls/
    );
  });

  it.each([
    ['a non-editable path', [{ op: 'replace' as const, path: '/id', value: 'x' }]],
    ['a patch that fails to apply', [{ op: 'remove' as const, path: '/items/9' }]],
    ['a schema-invalid result', [{ op: 'replace' as const, path: '/room/walls/0/thicknessMm', value: -1 }]],
    ['a semantically invalid result', [{ op: 'remove' as const, path: '/room/walls/3' }]],
  ])('throws InvalidPatchError for %s', (_label, patch) => {
    expect(() => commitRevision(newProject(), patch, { baseRevision: 0, source: 'user', summary: 's', at })).toThrow(
      InvalidPatchError
    );
  });

  it(`caps history at ${HISTORY_LIMIT} entries, dropping the oldest`, () => {
    let p = newProject();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      p = commitRevision(p, [{ op: 'replace', path: '/name', value: `n${i}` }], {
        baseRevision: p.revision,
        source: 'user',
        summary: String(i),
        at,
      });
    }
    expect(p.history).toHaveLength(HISTORY_LIMIT);
    expect(p.history[0].summary).toBe('5');
    expect(p.revision).toBe(HISTORY_LIMIT + 5);
  });
});
