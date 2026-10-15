// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { z } from 'zod';
import type { LLMProvider, VisionRequest } from '../llm';
import { ExtractionError, LLMRequestError } from '../llm';
import { addPhoto, getStorageFor, newProject } from '../storage';
import { getJobStore } from './index';
import { runJob } from './run';

/** Replays queued outcomes for both vision and text calls; counts calls. */
class StubProvider implements LLMProvider {
  calls = 0;
  constructor(private outcomes: Array<unknown | Error>) {}
  private next<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
    this.calls++;
    const n = this.outcomes.shift();
    if (n === undefined) throw new Error('stub: no more outcomes');
    if (n instanceof Error) throw n;
    return schema.parse(n);
  }
  async completeText(): Promise<string> {
    throw new Error('unused');
  }
  async completeJSON<T>(req: { schema: z.ZodType<T, z.ZodTypeDef, unknown> }): Promise<T> {
    return this.next(req.schema);
  }
  async chatWithVision<T>(req: VisionRequest<T>): Promise<T> {
    return this.next(req.schema as z.ZodType<T, z.ZodTypeDef, unknown>);
  }
}

const roomAnswer = {
  confidence: 0.7,
  polygonMm: [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ],
  walls: [{ thicknessMm: 120 }, { thicknessMm: 120 }, { thicknessMm: 120 }, { thicknessMm: 120 }],
  openings: [],
  measuredWalls: [0],
  notes: 'ok',
};
const reply = (text: string) => ({ commands: [], summary: '', reply: text });

let dir: string;
let jpeg: Buffer;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 5, g: 5, b: 5 } } })
    .jpeg()
    .toBuffer();
});
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kd-run-'));
  vi.stubEnv('DATA_DIR', dir);
  vi.stubEnv('GCS_BUCKET', '');
  vi.stubEnv('DATABASE_URL', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function setup(kind: 'extract' | 'refine', input: unknown, opts: { photo?: boolean; closet?: boolean } = {}) {
  const storage = await getStorageFor(null);
  const project = newProject({ name: 'P', kind: opts.closet ? 'closet' : 'kitchen' });
  await storage.projects.insert(project);
  if (opts.photo) await addPhoto(storage, project.id, jpeg, { width: 400, height: 300 });
  const store = await getJobStore(null);
  const job = await store.create(project.id, kind, input);
  return { storage, project, store, job };
}

describe('runJob', () => {
  it('runs an extract job to done with the extractRoom result', async () => {
    const { store, job } = await setup('extract', { measurements: [{ description: 'wall', lengthMm: 4000 }] }, { photo: true });
    await runJob(job.id, { provider: new StubProvider([roomAnswer]) });
    const done = (await store.get(job.id))!;
    expect(done.status).toBe('done');
    expect(done.error).toBeNull();
    expect(done.result).toMatchObject({ room: expect.anything(), baseRevision: expect.any(Number), patch: expect.any(Array) });
  });

  it('runs a refine job to done with the refine result', async () => {
    const { store, job } = await setup('refine', { message: 'hello' });
    await runJob(job.id, { provider: new StubProvider([reply('Hi there')]) });
    const done = (await store.get(job.id))!;
    expect(done.status).toBe('done');
    expect(done.result).toMatchObject({ reply: 'Hi there', patch: [] });
  });

  it('runs a closet refine job through refineCloset', async () => {
    const { store, job } = await setup('refine', { message: 'hello' }, { closet: true });
    await runJob(job.id, { provider: new StubProvider([reply('closet hi')]) });
    const done = (await store.get(job.id))!;
    expect(done.status).toBe('done');
    expect(done.result).toMatchObject({ reply: 'closet hi' });
  });

  it('fails with 502 on an LLM request error', async () => {
    const { store, job } = await setup('extract', {}, { photo: true });
    await runJob(job.id, { provider: new StubProvider([new LLMRequestError('rate limited')]) });
    const failed = (await store.get(job.id))!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toEqual({ status: 502, error: 'rate limited' });
  });

  it('fails with 502 and issues when extraction keeps failing', async () => {
    const { store, job } = await setup('extract', {}, { photo: true });
    const bad = new ExtractionError(['nope']);
    await runJob(job.id, { provider: new StubProvider([bad, bad]) });
    expect((await store.get(job.id))!.error).toMatchObject({ status: 502, error: bad.message, issues: ['nope'] });
  });

  it('fails 503 when no LLM is configured', async () => {
    for (const k of ['OPENROUTER_API_KEY', 'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_PROVIDER']) vi.stubEnv(k, '');
    const { store, job } = await setup('refine', { message: 'x' });
    await runJob(job.id);
    const failed = (await store.get(job.id))!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatchObject({ status: 503 });
    expect(failed.error!.error).toMatch(/You can still edit the plan by hand\.$/);
  });

  it('fails 500 on an unexpected error', async () => {
    const { store, job } = await setup('refine', { message: 'x' });
    const boom: LLMProvider = {
      completeText: async () => 'x',
      completeJSON: async () => {
        throw new TypeError('kaboom');
      },
      chatWithVision: async () => {
        throw new Error('unused');
      },
    };
    await runJob(job.id, { provider: boom });
    expect((await store.get(job.id))!.error).toEqual({ status: 500, error: 'unexpected server error during refinement' });
  });

  it('fails a job whose project was deleted with 404, not stuck running', async () => {
    const { store, job, storage, project } = await setup('refine', { message: 'x' });
    await storage.projects.remove(project.id);
    const provider = new StubProvider([]);
    await runJob(job.id, { provider });
    const failed = (await store.get(job.id))!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toEqual({ status: 404, error: 'project not found' });
    expect(provider.calls).toBe(0);
  });

  it('runs the handler once when called repeatedly', async () => {
    const { store, job } = await setup('refine', { message: 'x' });
    const provider = new StubProvider([reply('a'), reply('b'), reply('c')]);
    await Promise.all([runJob(job.id, { provider }), runJob(job.id, { provider })]);
    await runJob(job.id, { provider });
    expect(provider.calls).toBe(1);
    expect((await store.get(job.id))!.attempts).toBe(1);
  });

  it('never throws, even for an unknown or non-UUID job', async () => {
    await expect(runJob('nope')).resolves.toBeUndefined();
    await expect(runJob('3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b')).resolves.toBeUndefined();
  });
});
