import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../catalog/loader';
import { newProject } from './new-project';
import { addOpening } from './openings';
import { checkLayout, layoutSummary } from './layout-check';
import { proposeLayouts } from './layout-proposals';
import { ProjectSchema, type Project } from './schemas';
import { validatePlan } from './validate';

const catalog = loadCatalog();

const room = (w: number, h: number): Project => {
  const p = newProject({ name: 'Room' });
  return { ...p, room: { ...p.room, polygon: [[0, 0], [w, 0], [w, h], [0, h]] } };
};

const SIZES: Array<[number, number]> = [
  [3000, 3000],
  [3000, 4000],
  [3600, 4200],
  [4400, 3000],
  [5000, 4000],
  [6000, 5000],
];

describe.each(SIZES)('proposeLayouts for a %i x %i mm room', (w, h) => {
  const input = room(w, h);
  const { proposals, reason } = proposeLayouts(input, catalog, randomUUID);

  it('offers up to three layouts of different shapes', () => {
    expect(reason).toBeUndefined();
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.length).toBeLessThanOrEqual(3);
    expect(new Set(proposals.map((p) => p.shape)).size).toBe(proposals.length);
  });

  it('builds valid projects with no validation errors, in the same room', () => {
    for (const p of proposals) {
      const result = validatePlan(p.project);
      expect(result.errors, p.label).toEqual([]);
      expect(p.project.room).toEqual(input.room);
      expect(p.project.items.length).toBeGreaterThan(0);
      expect(ProjectSchema.parse(JSON.parse(JSON.stringify(p.project)))).toEqual(p.project);
    }
  });

  it('reports the scores the layout check gives', () => {
    for (const p of proposals) {
      const { passed, counted } = layoutSummary(checkLayout(p.project));
      expect([p.passed, p.counted]).toEqual([passed, counted]);
      expect(p.warnings).toBe(validatePlan(p.project).warnings.length);
      expect(p.passed * 2).toBeGreaterThanOrEqual(p.counted);
    }
  });

  it('puts the best first', () => {
    const failed = proposals.map((p) => p.counted - p.passed);
    expect(failed).toEqual([...failed].sort((a, b) => a - b));
  });

  it('has a sink, a range and a fridge in every layout', () => {
    for (const p of proposals) {
      const tags = new Set(p.project.items.map((it) => it.tag));
      expect([...tags]).toEqual(expect.arrayContaining(['sink', 'range', 'fridge']));
    }
  });
});

describe('proposeLayouts', () => {
  it('finds a layout that passes every counted check for a typical room', () => {
    const { proposals } = proposeLayouts(room(3600, 4200), catalog, randomUUID);
    expect(proposals[0].passed).toBe(proposals[0].counted);
  });

  it('offers more than one shape for a mid-sized room', () => {
    const { proposals } = proposeLayouts(room(3600, 4200), catalog, randomUUID);
    expect(proposals.length).toBeGreaterThanOrEqual(2);
  });

  it('gives the same layouts every time, whatever the ids', () => {
    const shape = (r: ReturnType<typeof proposeLayouts>) =>
      r.proposals.map((p) => [p.label, p.passed, p.warnings, p.project.items.map((it) => [it.catalogId, it.position.x, it.position.y])]);
    expect(shape(proposeLayouts(room(3600, 4200), catalog, randomUUID))).toEqual(shape(proposeLayouts(room(3600, 4200), catalog, randomUUID)));
  });

  it('replaces the items and keeps the doors and windows', () => {
    let input = room(4400, 3600);
    input = { ...input, room: addOpening(input.room, 2, 800, 'door', randomUUID()) };
    input = { ...input, room: addOpening(input.room, 0, 2200, 'window', randomUUID()) };
    const leftover = proposeLayouts(room(4400, 3600), catalog, randomUUID).proposals[0].project.items[0];
    input = { ...input, items: [{ ...leftover, id: randomUUID() }] };
    const { proposals } = proposeLayouts(input, catalog, randomUUID);
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      expect(p.project.room.openings).toEqual(input.room.openings);
      expect(p.project.items.map((it) => it.id)).not.toContain(input.items[0].id);
      expect(validatePlan(p.project).errors).toEqual([]);
    }
  });

  it('leaves the project it was given alone', () => {
    const input = room(3600, 4200);
    const before = JSON.stringify(input);
    proposeLayouts(input, catalog, randomUUID);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('says why a room that is too small has none', () => {
    for (const [w, h] of [[1800, 2000], [2400, 2400]]) {
      const r = proposeLayouts(room(w, h), catalog, randomUUID);
      expect(r.proposals).toEqual([]);
      expect(r.reason).toMatch(/No standard layout fits/);
    }
  });

  it('declines a room that is not a rectangle', () => {
    const input = room(4000, 4000);
    const l = { ...input, room: { ...input.room, polygon: [[0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 4000], [0, 4000]] as [number, number][], walls: Array.from({ length: 6 }, (_, i) => ({ ...input.room.walls[i % 4], id: randomUUID() })) } };
    const r = proposeLayouts(l, catalog, randomUUID);
    expect(r.proposals).toEqual([]);
    expect(r.reason).toMatch(/rectangular/);
  });

  it('declines a tilted four-sided room', () => {
    const input = room(4000, 4000);
    const r = proposeLayouts({ ...input, room: { ...input.room, polygon: [[0, 0], [4000, 200], [4000, 4000], [0, 4000]] } }, catalog, randomUUID);
    expect(r.reason).toMatch(/rectangular/);
  });

  it('declines a closet', () => {
    const r = proposeLayouts(newProject({ name: 'C', kind: 'closet' }), catalog, randomUUID);
    expect(r.proposals).toEqual([]);
    expect(r.reason).toMatch(/kitchen/);
  });
});
