import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { createProject, loadProject } from '@/lib/storage/projects';
import { POST as commit } from '../revisions/route';
import type { LLMProvider } from '@/lib/llm';
import { LLMNotConfiguredError, LLMRequestError } from '@/lib/llm';

const providerFromEnv = vi.fn<() => LLMProvider>();
vi.mock('@/lib/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm')>()),
  providerFromEnv: () => providerFromEnv(),
}));
const { POST } = await import('./route');

function stub(outcomes: unknown[]): LLMProvider & { users: string[] } {
  return {
    users: [],
    async completeText() {
      throw new Error('unused');
    },
    async chatWithVision() {
      throw new Error('unused');
    },
    async completeJSON<T>(req: { user: string; schema: z.ZodType<T, z.ZodTypeDef, unknown> }) {
      this.users.push(req.user);
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return req.schema.parse(next);
    },
  };
}

function post(id: string, body: unknown): Promise<Response> {
  const req = new Request(`http://localhost/api/projects/${id}/refine`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

const ADD_DW = {
  commands: [{ type: 'addItem', catalogId: 'dishwasher-600', wall: 'w1', alongMm: 1500 }],
  summary: 'Add a dishwasher on the north wall',
  reply: 'Added a 600 mm dishwasher.',
};

describe('POST /api/projects/[id]/refine', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-refine-'));
    process.env.DATA_DIR = dataDir;
    providerFromEnv.mockReset();
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('proposes a patch without changing the project; the patch commits cleanly', async () => {
    const p = createProject(dataDir, { name: 'P' });
    providerFromEnv.mockReturnValue(stub([ADD_DW]));
    const res = await post(p.id, { message: 'add a dishwasher on the north wall' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ summary: ADD_DW.summary, reply: ADD_DW.reply, baseRevision: 0, warnings: [] });
    expect(body.patch.length).toBeGreaterThan(0);
    expect(loadProject(dataDir, p.id).items).toEqual([]);

    const committed = await commit(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 0, patch: body.patch, summary: body.summary, source: 'llm' }),
      }),
      { params: Promise.resolve({ id: p.id }) }
    );
    expect(committed.status).toBe(200);
    expect(loadProject(dataDir, p.id).items[0]).toMatchObject({ catalogId: 'dishwasher-600', position: { x: 1500, y: 290 } });
  });

  it('passes history through to the prompt', async () => {
    const p = createProject(dataDir, { name: 'P' });
    const provider = stub([ADD_DW]);
    providerFromEnv.mockReturnValue(provider);
    await post(p.id, { message: 'and a dishwasher', history: [{ role: 'user', content: 'hello there' }] });
    expect(provider.users[0]).toMatch(/User: hello there/);
  });

  it('returns a reply with an empty patch for questions', async () => {
    const p = createProject(dataDir, { name: 'P' });
    providerFromEnv.mockReturnValue(stub([{ commands: [], reply: 'It is 3 × 4 m.' }]));
    const body = await (await post(p.id, { message: 'how big is it?' })).json();
    expect(body).toMatchObject({ patch: [], reply: 'It is 3 × 4 m.' });
  });

  it('returns 502 with issues when the model keeps proposing unusable edits', async () => {
    const p = createProject(dataDir, { name: 'P' });
    const bad = { commands: [{ type: 'removeItem', item: 'i4' }] };
    providerFromEnv.mockReturnValue(stub([bad, bad]));
    const res = await post(p.id, { message: 'remove it' });
    expect(res.status).toBe(502);
    expect((await res.json()).issues.join(' ')).toMatch(/unknown item "i4" — there are no items/);
  });

  it('returns 502 when the LLM request fails, 503 when no LLM is configured', async () => {
    const p = createProject(dataDir, { name: 'P' });
    providerFromEnv.mockReturnValue(stub([new LLMRequestError('LLM request timed out after 120000 ms')]));
    expect((await post(p.id, { message: 'x' })).status).toBe(502);
    providerFromEnv.mockImplementation(() => {
      throw new LLMNotConfiguredError();
    });
    const res = await post(p.id, { message: 'x' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/by hand/);
  });

  it('answers unexpected errors with JSON', async () => {
    const p = createProject(dataDir, { name: 'P' });
    providerFromEnv.mockReturnValue(stub([new TypeError('boom')]));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(p.id, { message: 'x' });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/unexpected/);
    spy.mockRestore();
  });

  it.each([
    ['an empty message', { message: '   ' }],
    ['a huge message', { message: 'x'.repeat(1001) }],
    ['a bad history role', { message: 'x', history: [{ role: 'system', content: 'hi' }] }],
    ['non-JSON', 'nope'],
  ])('returns 400 for %s', async (_label, body) => {
    const p = createProject(dataDir, { name: 'P' });
    providerFromEnv.mockReturnValue(stub([ADD_DW]));
    expect((await post(p.id, body)).status).toBe(400);
  });

  it('returns 400 for a non-UUID id and 404 for an unknown project', async () => {
    expect((await post('..', { message: 'x' })).status).toBe(400);
    expect((await post(randomUUID(), { message: 'x' })).status).toBe(404);
  });
});
