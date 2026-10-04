import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { closetFootprint, newCloset, newComponent } from '../closet/catalog';
import { ProjectSchema, type Closet, type Project } from '../plan/schemas';
import { buildClosetRefinePrompt, describeClosetCatalogForLLM, describeClosetForLLM, refineCloset } from './closet';
import type { LLMProvider } from './provider';
import { RefinementError } from './refine';

function project(over: Partial<Closet> = {}): Project {
  const closet = { ...newCloset(), ...over };
  return ProjectSchema.parse({
    id: 'p',
    name: 'Hall closet',
    kind: 'closet',
    units: 'mm',
    createdAt: 'x',
    updatedAt: 'x',
    revision: 2,
    photos: [],
    room: { polygon: closetFootprint(closet), walls: [0, 1, 2, 3].map((i) => ({ id: `w${i}`, thicknessMm: 100 })), openings: [] },
    items: [],
    closet,
    history: [],
  });
}

function stub(outcomes: unknown[]): LLMProvider & { users: string[]; systems: string[] } {
  return {
    users: [],
    systems: [],
    async completeText() {
      throw new Error('unused');
    },
    async chatWithVision() {
      throw new Error('unused');
    },
    async completeJSON<T>(req: { system: string; user: string; schema: z.ZodType<T, z.ZodTypeDef, unknown> }) {
      this.users.push(req.user);
      this.systems.push(req.system);
      return req.schema.parse(outcomes.shift());
    },
  };
}

describe('describeClosetForLLM', () => {
  it('gives the size, where drawers fit between the doors, and each component by ref', () => {
    const text = describeClosetForLLM(
      project({ components: [newComponent('shelf', 'a', 0, { widthMm: 1830 }), newComponent('drawers', 'b', 600, { count: 3 })] })
    );
    expect(text).toContain('inside 1830 wide × 2440 high × 610 deep (mm)');
    expect(text).toContain('bifold doors from x 0 to 1830 (1830 wide); the open doors take 100 mm at each side, so drawers fit between x 100 and 1730');
    expect(text).toContain('- c1: Shelf [shelf], x 0–1830 (1830 wide), at 2134 high');
    expect(text).toContain('- c2: Drawer unit [drawers], x 600–1210 (610 wide), from 0 to 914 high, 3 drawers');
  });

  it('lists current problems so the model can fix them', () => {
    const text = describeClosetForLLM(project({ components: [newComponent('rod', 'r', 0, { yMm: 800 })] }));
    expect(text).toMatch(/Current problems:\n- clothes on Hanging rod c1 would touch the floor/);
  });

  it('explains sliding doors and an open front', () => {
    expect(describeClosetForLLM(project({ opening: { style: 'sliding', leftMm: 0, widthMm: 1800 } }))).toContain('halves meet at x 900');
    expect(describeClosetForLLM(project({ opening: { style: 'open', leftMm: 0, widthMm: 1830 } }))).toContain('No doors');
  });
});

describe('buildClosetRefinePrompt', () => {
  it('teaches the coordinates, commands, and standard heights, and passes the request and history', () => {
    const p = buildClosetRefinePrompt({
      closetText: 'CLOSET',
      catalogText: describeClosetCatalogForLLM(),
      message: 'add double hang',
      history: [{ role: 'user', content: 'hi' }],
    });
    expect(p.system).toContain('xMm = from the closet’s LEFT side wall');
    expect(p.system).toContain('"type":"addComponent"');
    expect(p.system).toContain('rods at 2057 (81") and 1067 (42")');
    expect(p.user).toContain('CLOSET');
    expect(p.user).toContain('- drawers: Drawer unit, default 610 wide × 914 high, 406 deep; width 305–914; count 1–8.');
    expect(p.user).toContain('User: hi');
    expect(p.user.endsWith('Request: add double hang')).toBe(true);
  });
});

describe('refineCloset', () => {
  it('compiles the model’s commands into a patch, reporting only new warnings', async () => {
    const provider = stub([
      {
        commands: [{ type: 'addComponent', kind: 'rod', xMm: 0, yMm: 800 }],
        summary: 'Add a low rod',
        reply: 'Done.',
      },
    ]);
    const result = await refineCloset({ project: project(), provider, message: 'add a low rod' });
    expect(result.summary).toBe('Add a low rod');
    expect(result.baseRevision).toBe(2);
    expect(result.patch).toEqual([expect.objectContaining({ op: 'add', path: '/closet/components/0' })]);
    expect(result.warnings).toEqual(['clothes on Hanging rod c1 would touch the floor (allow 950 mm below a rod)']);
  });

  it('retries once with the error, then gives up', async () => {
    const bad = { commands: [{ type: 'removeComponent', component: 'c9' }] };
    const provider = stub([bad, bad]);
    await expect(refineCloset({ project: project(), provider, message: 'remove it' })).rejects.toThrow(RefinementError);
    expect(provider.users[1]).toMatch(/could not be applied:\n- commands\[0\] \(removeComponent\): unknown component "c9"/);
  });
});
