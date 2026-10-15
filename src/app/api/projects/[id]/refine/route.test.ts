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
import { getJobStore } from '@/lib/jobs';
import { MemJobStore } from '@/lib/jobs/mem-jobs';

const providerFromEnv = vi.fn<() => LLMProvider>();
vi.mock('@/lib/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm')>()),
  providerFromEnv: () => providerFromEnv(),
}));
const { POST } = await import('./route');
const { GET: pollJob } = await import('@/app/api/jobs/[id]/route');

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

type Outcome = { status: number; body: any };

/**
 * POST, and when the route answers 202 { jobId }, poll GET /api/jobs/[id]
 * until the job settles. A done job reads as 200 + its result, a failed job
 * as its error's status + body — what the synchronous route used to answer.
 */
async function run(id: string, body: unknown): Promise<Outcome> {
  const res = await post(id, body);
  const json = await res.json();
  if (res.status !== 202) return { status: res.status, body: json };
  expect(json).toEqual({ jobId: expect.any(String) });
  for (let i = 0; i < 400; i++) {
    const polled = await pollJob(new Request('http://localhost/x'), { params: Promise.resolve({ id: json.jobId }) });
    const job = await polled.json();
    if (job.status === 'done') return { status: 200, body: job.result };
    if (job.status === 'failed') return { status: job.error.status, body: job.error };
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job did not settle');
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
    const res = await run(p.id, { message: 'add a dishwasher on the north wall' });
    expect(res.status).toBe(200);
    const body = res.body;
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

  it('answers 202 { jobId } before the LLM finishes; the job then completes', async () => {
    const p = createProject(dataDir, { name: 'P' });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const provider = stub([ADD_DW]);
    const answer = provider.completeJSON.bind(provider);
    provider.completeJSON = (async (req: Parameters<typeof answer>[0]) => {
      await gate;
      return answer(req);
    }) as typeof provider.completeJSON;
    providerFromEnv.mockReturnValue(provider);
    const res = await post(p.id, { message: 'add a dishwasher' });
    expect(res.status).toBe(202);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { jobId } = await res.json();
    const jobs = await getJobStore(null);
    expect(['queued', 'running']).toContain((await jobs.get(jobId))!.status);
    release();
    await vi.waitFor(async () => expect((await jobs.get(jobId))!.status).toBe('done'));
    expect((await jobs.get(jobId))!.input).toEqual({ message: 'add a dishwasher', history: [] });
  });

  it('creates no job when validation fails or no LLM is configured', async () => {
    const create = vi.spyOn(MemJobStore.prototype, 'create');
    const p = createProject(dataDir, { name: 'P' });
    providerFromEnv.mockImplementation(() => {
      throw new LLMNotConfiguredError();
    });
    expect((await post(p.id, { message: 'x' })).status).toBe(503);
    expect((await post(p.id, { message: '' })).status).toBe(400);
    expect((await post(randomUUID(), { message: 'x' })).status).toBe(404);
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('edits a closet project with closet commands', async () => {
    const p = createProject(dataDir, { name: 'Hall', kind: 'closet' });
    const provider = stub([{ commands: [{ type: 'addComponent', kind: 'shelf', xMm: 0, widthMm: 1830 }], summary: 'Add a top shelf' }]);
    providerFromEnv.mockReturnValue(provider);
    const body = (await run(p.id, { message: 'add a top shelf' })).body;
    expect(body.summary).toBe('Add a top shelf');
    expect(body.patch).toEqual([
      { op: 'add', path: '/closet/components/0', value: expect.objectContaining({ kind: 'shelf', widthMm: 1830, yMm: 2134 }) },
    ]);
    expect(provider.users[0]).toContain('Closet "Hall": inside 1830 wide');
  });

  it('passes history through to the prompt', async () => {
    const p = createProject(dataDir, { name: 'P' });
    const provider = stub([ADD_DW]);
    providerFromEnv.mockReturnValue(provider);
    await run(p.id, { message: 'and a dishwasher', history: [{ role: 'user', content: 'hello there' }] });
    expect(provider.users[0]).toMatch(/User: hello there/);
  });

  it('returns a reply with an empty patch for questions', async () => {
    const p = createProject(dataDir, { name: 'P' });
    providerFromEnv.mockReturnValue(stub([{ commands: [], reply: 'It is 3 × 4 m.' }]));
    const body = (await run(p.id, { message: 'how big is it?' })).body;
    expect(body).toMatchObject({ patch: [], reply: 'It is 3 × 4 m.' });
  });

  it('returns 502 with issues when the model keeps proposing unusable edits', async () => {
    const p = createProject(dataDir, { name: 'P' });
    const bad = { commands: [{ type: 'removeItem', item: 'i4' }] };
    providerFromEnv.mockReturnValue(stub([bad, bad]));
    const res = await run(p.id, { message: 'remove it' });
    expect(res.status).toBe(502);
    expect(res.body.issues.join(' ')).toMatch(/unknown item "i4" — there are no items/);
  });

  it('returns 502 when the LLM request fails, 503 when no LLM is configured', async () => {
    const p = createProject(dataDir, { name: 'P' });
    providerFromEnv.mockReturnValue(stub([new LLMRequestError('LLM request timed out after 120000 ms')]));
    expect((await run(p.id, { message: 'x' })).status).toBe(502);
    providerFromEnv.mockImplementation(() => {
      throw new LLMNotConfiguredError();
    });
    const res = await run(p.id, { message: 'x' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/by hand/);
  });

  it('answers unexpected errors with JSON', async () => {
    const p = createProject(dataDir, { name: 'P' });
    providerFromEnv.mockReturnValue(stub([new TypeError('boom')]));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await run(p.id, { message: 'x' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/unexpected/);
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
    expect((await run(p.id, body)).status).toBe(400);
  });

  it('returns 400 for a non-UUID id and 404 for an unknown project', async () => {
    expect((await run('..', { message: 'x' })).status).toBe(400);
    expect((await run(randomUUID(), { message: 'x' })).status).toBe(404);
  });
});
