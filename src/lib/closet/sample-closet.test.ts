import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { validatePlan } from '../plan/validate';
import type { Project } from '../plan/schemas';
import { newCloset, closetFootprint } from './catalog';
import { buildSampleCleaningCloset } from './sample-closet';

function blankCloset(): Project {
  const closet = newCloset();
  return {
    id: randomUUID(),
    name: 'Sample cleaning closet',
    kind: 'closet',
    units: 'mm',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0,
    photos: [],
    room: { polygon: closetFootprint(closet), walls: Array.from({ length: 4 }, () => ({ id: randomUUID(), thicknessMm: 100 })), openings: [] },
    items: [],
    closet,
    history: [],
  };
}

describe('buildSampleCleaningCloset', () => {
  const sample = buildSampleCleaningCloset(blankCloset(), randomUUID);

  it('is a valid closet with no design warnings', () => {
    const result = validatePlan(sample);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('is 4 ft wide, 8 ft tall and 2 ft deep with a full-width hinged opening', () => {
    expect(sample.closet).toMatchObject({ widthMm: 1219, heightMm: 2438, depthMm: 610 });
    expect(sample.closet?.opening).toEqual({ style: 'hinged', leftMm: 0, widthMm: 1219 });
    expect(sample.room.polygon).toEqual(closetFootprint(sample.closet!));
  });

  it('has hooks for tall tools, a supplies tower, a basket and shelves', () => {
    expect(sample.closet?.components.map((c) => c.kind).sort()).toEqual(['basket', 'hooks', 'shelf', 'shelf', 'tower']);
  });

  it('keeps the project identity', () => {
    const base = blankCloset();
    const built = buildSampleCleaningCloset(base, randomUUID);
    expect(built.id).toBe(base.id);
    expect(built.revision).toBe(0);
  });
});
