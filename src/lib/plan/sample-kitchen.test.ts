import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../catalog/loader';
import { validatePlan } from './validate';
import { buildSampleKitchen } from './sample-kitchen';
import type { Project } from './schemas';

function blankKitchen(): Project {
  return {
    id: randomUUID(),
    name: 'Sample kitchen',
    kind: 'kitchen',
    units: 'mm',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0,
    photos: [],
    room: {
      polygon: [
        [0, 0],
        [3000, 0],
        [3000, 4000],
        [0, 4000],
      ],
      walls: Array.from({ length: 4 }, () => ({ id: randomUUID(), thicknessMm: 100 })),
      openings: [],
    },
    items: [],
    history: [],
  };
}

describe('buildSampleKitchen', () => {
  const sample = buildSampleKitchen(blankKitchen(), loadCatalog(), randomUUID);

  it('is a valid plan with no layout warnings', () => {
    const result = validatePlan(sample);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('has the core kitchen pieces', () => {
    const ids = sample.items.map((it) => it.catalogId);
    for (const id of ['sink-base-900', 'range-760', 'dishwasher-600', 'fridge-counter-depth-910', 'range-hood-760', 'island-1800x900']) {
      expect(ids).toContain(id);
    }
  });

  it('has a door and a window', () => {
    expect(sample.room.openings.map((o) => o.kind).sort()).toEqual(['door', 'window']);
  });

  it('keeps the project identity and starts its history fresh', () => {
    const base = blankKitchen();
    const built = buildSampleKitchen(base, loadCatalog(), randomUUID);
    expect(built.id).toBe(base.id);
    expect(built.revision).toBe(0);
    expect(built.room.walls.map((w) => w.id)).toEqual(base.room.walls.map((w) => w.id));
  });
});
