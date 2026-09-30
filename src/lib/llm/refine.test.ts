import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { refinePlan, RefinementError } from './refine';
import { LLMResponseError } from './openai-compatible';
import type { LLMProvider } from './provider';
import { loadCatalog } from '../catalog/loader';
import { commitRevision } from '../plan/diff';
import { ProjectSchema, type Project } from '../plan/schemas';

const catalog = loadCatalog();

/** Replays queued answers to completeJSON and records each request. */
class StubProvider implements LLMProvider {
  requests: Array<{ system: string; user: string }> = [];
  constructor(private outcomes: Array<unknown | Error>) {}
  async completeText(): Promise<string> {
    throw new Error('unused');
  }
  async chatWithVision<T>(): Promise<T> {
    throw new Error('unused');
  }
  async completeJSON<T>(req: { system: string; user: string; schema: z.ZodType<T, z.ZodTypeDef, unknown> }): Promise<T> {
    this.requests.push({ system: req.system, user: req.user });
    const next = this.outcomes.shift();
    if (next === undefined) throw new Error('stub: no more outcomes');
    if (next instanceof Error) throw next;
    return req.schema.parse(next);
  }
}

const project: Project = ProjectSchema.parse({
  id: 'p',
  name: 'Kitchen',
  units: 'mm',
  createdAt: 'x',
  updatedAt: 'x',
  revision: 7,
  photos: [],
  room: {
    polygon: [
      [0, 0],
      [3000, 0],
      [3000, 4000],
      [0, 4000],
    ],
    walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
    openings: [],
  },
  items: [
    {
      id: 'fridge',
      catalogId: 'fridge-600',
      sizeMm: { w: 600, d: 650, h: 1850 },
      clearanceMm: { front: 900, sides: 50 },
      position: { x: 1500, y: 3675 },
      rotationDeg: 180,
    },
  ],
  history: [],
});

type Turn = { role: 'user' | 'assistant'; content: string };
const run = (provider: LLMProvider, message = 'move the fridge to the north wall', history?: Turn[]) =>
  refinePlan({ project, catalog, provider, message, history });

const moveFridgeNorth = {
  commands: [{ type: 'moveItem', item: 'i1', wall: 'w1' }],
  summary: 'Move the fridge to the north wall',
  reply: 'Done.',
};

describe('refinePlan', () => {
  it('sends the plan, catalog, and request, and returns a patch against baseRevision', async () => {
    const provider = new StubProvider([moveFridgeNorth]);
    const r = await run(provider);
    const [req] = provider.requests;
    expect(req.user).toContain('- i1: "Refrigerator, slim (600 mm)" [fridge-600]');
    expect(req.user).toContain('- w1: north wall');
    expect(req.user).toContain('- dishwasher-600: Dishwasher (600 mm)');
    expect(req.user).toMatch(/Request: move the fridge to the north wall$/);
    expect(req.system).toMatch(/moveItem/);

    expect(r).toMatchObject({ summary: 'Move the fridge to the north wall', reply: 'Done.', baseRevision: 7, warnings: [] });
    const next = commitRevision(project, r.patch, { baseRevision: 7, source: 'llm', summary: r.summary });
    expect(next.items[0]).toMatchObject({ id: 'fridge', position: { x: 1500, y: 325 }, rotationDeg: 0 });
  });

  it('includes recent conversation for follow-ups', async () => {
    const provider = new StubProvider([moveFridgeNorth]);
    await run(provider, 'a bit further left', [
      { role: 'user', content: 'move the fridge to the north wall' },
      { role: 'assistant', content: 'Done.' },
    ]);
    expect(provider.requests[0].user).toMatch(/User: move the fridge.*\nAssistant: Done\.\n\nRequest: a bit further left/s);
  });

  it('passes a question through as a reply with no changes', async () => {
    const r = await run(new StubProvider([{ commands: [], reply: 'The room is 3 × 4 m.' }]), 'how big is the room?');
    expect(r).toMatchObject({ commands: [], patch: [], reply: 'The room is 3 × 4 m.' });
  });

  it('retries once with the compiler error fed back', async () => {
    const provider = new StubProvider([{ commands: [{ type: 'moveItem', item: 'i9', wall: 'w1' }] }, moveFridgeNorth]);
    const r = await run(provider);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].user).toMatch(/previous answer could not be applied/i);
    expect(provider.requests[1].user).toMatch(/unknown item "i9" — items are i1/);
    expect(r.summary).toBe('Move the fridge to the north wall');
  });

  it('retries once on malformed JSON', async () => {
    const provider = new StubProvider([new LLMResponseError('LLM returned non-JSON content: x', 'oops'), moveFridgeNorth]);
    await run(provider);
    expect(provider.requests).toHaveLength(2);
  });

  it('gives up after the retry with a RefinementError', async () => {
    const bad = { commands: [{ type: 'addItem', catalogId: 'hot-tub', wall: 'w1' }] };
    const err = await run(new StubProvider([bad, bad])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RefinementError);
    expect((err as RefinementError).issues.join(' ')).toMatch(/hot-tub/);
  });

  it('reports only warnings the change introduces', async () => {
    // Fridge tucked into the south-east corner: an existing side-clearance warning.
    const cornered: Project = { ...project, items: [{ ...project.items[0], position: { x: 2700, y: 3675 } }] };
    const existing = '"fridge-600" needs 50 mm at its sides: a wall is too close';
    const addDishwasher = { commands: [{ type: 'addItem', catalogId: 'dishwasher-600', wall: 'w1' }], summary: 'Add a dishwasher' };

    const quiet = await refinePlan({ project: cornered, catalog, provider: new StubProvider([addDishwasher]), message: 'm' });
    expect(quiet.warnings).toEqual([]); // the fridge warning already existed

    // An island right in front of the fridge adds a new problem.
    const island = { commands: [{ type: 'addItem', catalogId: 'island-1200x900', x: 2400, y: 2600 }], summary: 'Add an island' };
    const r = await refinePlan({ project: cornered, catalog, provider: new StubProvider([island]), message: 'm' });
    expect(r.warnings).toContain('not enough room in front of "fridge-600": "island-1200x900" is in the way');
    expect(r.warnings).not.toContain(existing);
  });

  it('fills in a summary when the model leaves it empty', async () => {
    const r = await run(new StubProvider([{ commands: moveFridgeNorth.commands }]));
    expect(r.summary).toBe('Chat edit: move the fridge to the north wall');
  });
});
