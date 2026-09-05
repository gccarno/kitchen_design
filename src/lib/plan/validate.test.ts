import { describe, it, expect } from 'vitest';
import { validatePlan } from './validate';
import { ProjectSchema, type Project } from './schemas';

function newProject(overrides: Partial<Project> = {}): Project {
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
      walls: [],
      openings: [],
    },
    items: [],
    history: [],
    ...overrides,
  });
}

describe('validatePlan', () => {
  it('returns valid for a clean project', () => {
    const r = validatePlan(newProject());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects a self-intersecting polygon', () => {
    const p = newProject({
      room: {
        polygon: [
          [0, 0],
          [4000, 4000],
          [4000, 0],
          [0, 4000],
        ],
        walls: [],
        openings: [],
      },
    });
    const r = validatePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/self.intersect|polygon/i);
  });

  it('rejects a wall with an endpoint not on the polygon perimeter', () => {
    const p = newProject({
      room: {
        polygon: [
          [0, 0],
          [3000, 0],
          [3000, 4000],
          [0, 4000],
        ],
        walls: [
          { id: 'w0', from: [0, 0], to: [3000, 0], thicknessMm: 100 },
          // `to` is inside the room, not on the perimeter
          { id: 'w1', from: [3000, 0], to: [1500, 1500], thicknessMm: 100 },
        ],
        openings: [],
      },
    });
    const r = validatePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/wall|vertex|perimeter/i);
  });

  it('rejects an opening referencing a non-existent wall', () => {
    const p = newProject({
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
        openings: [
          { id: 'o0', wallId: 'w99', kind: 'door', positionMm: 0, widthMm: 900, heightMm: 2100 },
        ],
      },
    });
    const r = validatePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/opening|wall/i);
  });

  it('rejects a placed item outside the room polygon', () => {
    const p = newProject({
      items: [
        {
          id: 'i1',
          catalogId: 'base-cabinet-600',
          position: { x: 10000, y: 10000 },
          rotationDeg: 0,
        },
      ],
    });
    const r = validatePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/item|outside|polygon/i);
  });

  it('accepts a placed item just inside the room polygon', () => {
    const p = newProject({
      items: [
        {
          id: 'i1',
          catalogId: 'base-cabinet-600',
          position: { x: 1500, y: 2000 },
          rotationDeg: 0,
        },
      ],
    });
    const r = validatePlan(p);
    expect(r.valid).toBe(true);
  });

  it('reports overlapping items as warnings, not errors', () => {
    const p = newProject({
      items: [
        {
          id: 'i1',
          catalogId: 'base-cabinet-600',
          position: { x: 1000, y: 1000 },
          rotationDeg: 0,
        },
        {
          id: 'i2',
          catalogId: 'base-cabinet-600',
          position: { x: 1050, y: 1050 },
          rotationDeg: 0,
        },
      ],
    });
    const r = validatePlan(p);
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/overlap/i);
  });

  it('reports a zero-area room polygon', () => {
    const p = newProject({
      room: {
        polygon: [
          [0, 0],
          [100, 0],
          [200, 0],
        ],
        walls: [],
        openings: [],
      },
    });
    const r = validatePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/area|polygon/i);
  });

  it('reports duplicate wall ids', () => {
    const p = newProject({
      room: {
        polygon: [
          [0, 0],
          [3000, 0],
          [3000, 4000],
          [0, 4000],
        ],
        walls: [
          { id: 'dup', from: [0, 0], to: [3000, 0], thicknessMm: 100 },
          { id: 'dup', from: [3000, 0], to: [3000, 4000], thicknessMm: 100 },
        ],
        openings: [],
      },
    });
    const r = validatePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/duplicate|wall id/i);
  });

  it('reports duplicate placed item ids', () => {
    const p = newProject({
      items: [
        {
          id: 'i1',
          catalogId: 'base-cabinet-600',
          position: { x: 100, y: 100 },
          rotationDeg: 0,
        },
        {
          id: 'i1',
          catalogId: 'base-cabinet-600',
          position: { x: 200, y: 200 },
          rotationDeg: 0,
        },
      ],
    });
    const r = validatePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/duplicate|item id/i);
  });
});
