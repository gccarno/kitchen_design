import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../catalog/loader';
import { newCloset, newComponent } from '../closet/catalog';
import { compileCommands, type Command } from './commands';
import { ACCESS, checkAccessibility, checkLayout, layoutSummary, type LayoutRule } from './layout-check';
import { newProject } from './new-project';
import type { Closet, Project } from './schemas';

const catalog = loadCatalog();

const room = (w: number, h: number, commands: Command[]): Project => {
  const p = newProject({ name: 'Room' });
  const empty: Project = { ...p, room: { ...p.room, polygon: [[0, 0], [w, 0], [w, h], [0, h]] } };
  return compileCommands(empty, commands, catalog, randomUUID).project;
};
const rule = (p: Project, id: string): LayoutRule => checkAccessibility(p).find((r) => r.id === id)!;

describe('aisle wide enough for a wheelchair', () => {
  // A sink run on the right wall and a range run on the left: the aisle is the width less both depths.
  const facing = (w: number) =>
    room(w, 3000, [
      { type: 'addRun', wall: 'w2', items: ['sink-base-900'], from: 'centre' },
      { type: 'addRun', wall: 'w4', items: ['range-760'], from: 'centre' },
    ]);

  it('passes at 1220 mm and fails below it, though the NKBA aisle (1067 mm) still passes', () => {
    const wide = facing(2500);
    expect(rule(wide, 'access-aisle').status).toBe('pass');
    const tight = facing(2400);
    expect(rule(tight, 'access-aisle').status).toBe('fail');
    expect(rule(tight, 'access-aisle').detail).toMatch(/needs 1220 mm/);
    expect(checkLayout(tight).find((r) => r.id === 'work-aisle')!.status).toBe('pass');
  });

  it('is n/a without counters and passes when none face each other', () => {
    expect(rule(room(3000, 3000, []), 'access-aisle').status).toBe('n/a');
    const one = room(3000, 3000, [{ type: 'addRun', wall: 'w1', items: ['sink-base-900'] }]);
    expect(rule(one, 'access-aisle').status).toBe('pass');
  });
});

describe('space to turn a wheelchair', () => {
  const item: Command[] = [{ type: 'addRun', wall: 'w1', items: ['base-600x560x720'] }];

  it('is n/a until something is placed', () => {
    expect(rule(room(3000, 3000, []), 'access-turning').status).toBe('n/a');
  });

  it('passes with a 1525 mm circle clear, and fails when the room is narrower', () => {
    expect(rule(room(1800, 3000, item), 'access-turning').status).toBe('pass');
    expect(rule(room(1600, 3000, item), 'access-turning').status).toBe('pass');
    const narrow = rule(room(1500, 3000, item), 'access-turning');
    expect(narrow.status).toBe('fail');
    expect(narrow.detail).toMatch(/largest clear circle \d+ mm across \(needs 1525 mm\)/);
  });

  it('fails when furniture fills the room, though the room alone is big enough', () => {
    const blocked = room(2400, 2400, [{ type: 'addItem', catalogId: 'island-1800x900', x: 1200, y: 1200, rotationDeg: 0 }]);
    expect(rule(blocked, 'access-turning').status).toBe('fail');
    const empty = room(2400, 2400, [{ type: 'addRun', wall: 'w1', items: ['base-600x560x720'] }]);
    expect(rule(empty, 'access-turning').status).toBe('pass');
  });

  it('ignores wall cabinets, which hang above the circle', () => {
    const cabinets = room(1800, 3000, [{ type: 'addRun', wall: 'w1', items: ['wall-600x320x720', 'wall-600x320x720'] }]);
    expect(rule(cabinets, 'access-turning').status).toBe('pass');
  });
});

describe('door wide enough', () => {
  const door = (widthMm?: number): Command[] => [{ type: 'addOpening', wall: 'w3', kind: 'door', widthMm }];

  it('needs 815 mm', () => {
    expect(ACCESS.door).toBe(815);
    expect(rule(room(3000, 3000, door(900)), 'access-door').status).toBe('pass');
    expect(rule(room(3000, 3000, door(815)), 'access-door').status).toBe('pass');
    const narrow = rule(room(3000, 3000, door(800)), 'access-door');
    expect(narrow.status).toBe('fail');
    expect(narrow.detail).toBe('widest door 800 mm (needs 815 mm)');
  });

  it('uses the widest door, ignores windows, and is n/a with no door', () => {
    const two = room(4000, 4000, [...door(700), { type: 'addOpening', wall: 'w1', kind: 'door', widthMm: 900 }]);
    expect(rule(two, 'access-door').status).toBe('pass');
    const windowOnly = room(3000, 3000, [{ type: 'addOpening', wall: 'w1', kind: 'window', widthMm: 2000 }]);
    expect(rule(windowOnly, 'access-door').status).toBe('n/a');
  });
});

describe('wall cabinets within reach', () => {
  it('only reports, and is never counted', () => {
    const p = room(3000, 3000, [{ type: 'addRun', wall: 'w1', items: ['wall-600x320x720'] }]);
    const r = rule(p, 'access-wall-cabinets');
    expect(r.info).toBe(true);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/start 1450 mm up/);
    expect(layoutSummary(checkAccessibility(p).filter((x) => x.id === r.id)).counted).toBe(0);
    expect(rule(room(3000, 3000, []), 'access-wall-cabinets').status).toBe('n/a');
  });
});

describe('closets', () => {
  const closetProject = (build: (c: Closet) => Closet['components']): Project => {
    const p = newProject({ name: 'C', kind: 'closet' });
    const base = newCloset();
    return { ...p, closet: { ...base, components: build(base) } };
  };
  const at = (kind: Parameters<typeof newComponent>[0], yMm: number) => newComponent(kind, randomUUID(), 0, { yMm });

  it('wants a rod between 380 and 1220 mm up', () => {
    expect(rule(closetProject(() => [at('rod', 1067)]), 'access-closet-rod').status).toBe('pass');
    expect(rule(closetProject(() => [at('rod', 1727), at('rod', 1067)]), 'access-closet-rod').status).toBe('pass');
    const high = rule(closetProject(() => [at('rod', 1727)]), 'access-closet-rod');
    expect(high.status).toBe('fail');
    expect(high.detail).toBe('1727 mm (one needs to be 380 to 1220 mm up)');
    expect(rule(closetProject(() => [at('rod', 300)]), 'access-closet-rod').status).toBe('fail');
    expect(rule(closetProject(() => [at('shelf', 800)]), 'access-closet-rod').status).toBe('n/a');
  });

  it('wants some storage in reach: a shelf at that height, or a box that spans it', () => {
    expect(rule(closetProject(() => [at('shelf', 800)]), 'access-closet-storage').status).toBe('pass');
    expect(rule(closetProject(() => [at('shelf', 2134)]), 'access-closet-storage').status).toBe('fail');
    expect(rule(closetProject(() => [at('drawers', 0)]), 'access-closet-storage').status).toBe('pass');
    expect(rule(closetProject(() => [at('rod', 1067)]), 'access-closet-storage').status).toBe('n/a');
  });

  it('gives only closet rules for a closet and only kitchen rules for a kitchen', () => {
    const closetIds = checkAccessibility(closetProject(() => [])).map((r) => r.id);
    expect(closetIds.every((id) => id.startsWith('access-closet-'))).toBe(true);
    const kitchenIds = checkAccessibility(room(3000, 3000, [])).map((r) => r.id);
    expect(kitchenIds.some((id) => id.startsWith('access-closet-'))).toBe(false);
  });
});

describe('alongside the NKBA layout check', () => {
  it('leaves checkLayout alone: same nine rules, no accessibility ids', () => {
    const p = room(3000, 3000, [{ type: 'addRun', wall: 'w1', items: ['sink-base-900'] }]);
    const ids = checkLayout(p).map((r) => r.id);
    expect(ids).toHaveLength(9);
    expect(ids.some((id) => id.startsWith('access-'))).toBe(false);
  });
});
