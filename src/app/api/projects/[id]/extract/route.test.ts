import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { z } from 'zod';
import { createProject, loadProject } from '@/lib/storage/projects';
import { POST as upload } from '@/app/api/upload/route';
import { POST as commit } from '../revisions/route';
import type { LLMProvider, VisionRequest } from '@/lib/llm';
import { LLMRequestError, LLMNotConfiguredError, LLMResponseError } from '@/lib/llm';
import type { Project } from '@/lib/plan/schemas';

const providerFromEnv = vi.fn<() => LLMProvider>();
vi.mock('@/lib/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm')>()),
  providerFromEnv: () => providerFromEnv(),
}));
const { POST } = await import('./route');

function stub(outcomes: unknown[]): LLMProvider & { calls: number } {
  return {
    calls: 0,
    async completeText() {
      throw new Error('unused');
    },
    async completeJSON() {
      throw new Error('unused');
    },
    async chatWithVision<T>(req: VisionRequest<T>) {
      this.calls++;
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return (req.schema as z.ZodType<T>).parse(next);
    },
  };
}

const ANSWER = {
  confidence: 0.8,
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

function post(id: string, body: unknown): Promise<Response> {
  const req = new Request(`http://localhost/api/projects/${id}/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

async function projectWithPhoto(dataDir: string): Promise<Project> {
  const p = createProject(dataDir, { name: 'P' });
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 1, g: 1, b: 1 } } })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.append('projectId', p.id);
  form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));
  await upload(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
  return loadProject(dataDir, p.id);
}

const MEASURED = { measurements: [{ description: 'sink wall', lengthMm: 3600 }] };

describe('POST /api/projects/[id]/extract', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-extract-'));
    process.env.DATA_DIR = dataDir;
    providerFromEnv.mockReset();
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('returns a candidate room and a patch, without changing the project', async () => {
    const p = await projectWithPhoto(dataDir);
    providerFromEnv.mockReturnValue(stub([ANSWER]));
    const res = await post(p.id, MEASURED);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ confidence: 0.8, notes: 'ok', baseRevision: 0, warnings: [] });
    expect(body.room.polygon[1][0]).toBeCloseTo(3600);
    expect(loadProject(dataDir, p.id)).toEqual(p);

    // The patch commits through the revisions endpoint unchanged.
    const committed = await commit(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: body.baseRevision, patch: body.patch, summary: 'extract', source: 'llm' }),
      }),
      { params: Promise.resolve({ id: p.id }) }
    );
    expect(committed.status).toBe(200);
    expect(loadProject(dataDir, p.id).room).toEqual(body.room);
  });

  it('accepts a request with no measurements (and warns)', async () => {
    const p = await projectWithPhoto(dataDir);
    providerFromEnv.mockReturnValue(stub([{ ...ANSWER, measuredWalls: [] }]));
    const res = await post(p.id, {});
    expect(res.status).toBe(200);
    expect((await res.json()).warnings.join(' ')).toMatch(/no measured walls/i);
  });

  it('returns 503 when no LLM is configured', async () => {
    const p = await projectWithPhoto(dataDir);
    providerFromEnv.mockImplementation(() => {
      throw new LLMNotConfiguredError();
    });
    const res = await post(p.id, MEASURED);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/LLM_API_KEY/);
  });

  it('returns 502 with issues when the model keeps answering badly', async () => {
    const p = await projectWithPhoto(dataDir);
    const bad = { ...ANSWER, measuredWalls: [] };
    providerFromEnv.mockReturnValue(stub([bad, bad]));
    const res = await post(p.id, MEASURED);
    expect(res.status).toBe(502);
    expect((await res.json()).issues.join(' ')).toMatch(/measuredWalls/);
  });

  it('returns 502 when the LLM request fails', async () => {
    const p = await projectWithPhoto(dataDir);
    providerFromEnv.mockReturnValue(stub([new LLMRequestError('LLM request timed out after 60000 ms')]));
    const res = await post(p.id, MEASURED);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/timed out/);
  });

  it('answers unexpected errors with JSON (never an empty 500)', async () => {
    const p = await projectWithPhoto(dataDir);
    providerFromEnv.mockReturnValue(stub([new TypeError('something unexpected')]));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(p.id, MEASURED);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/unexpected/);
    spy.mockRestore();
  });

  it('retries a malformed reply once before succeeding', async () => {
    const p = await projectWithPhoto(dataDir);
    const provider = stub([new LLMResponseError('LLM returned non-JSON content', 'x'), ANSWER]);
    providerFromEnv.mockReturnValue(provider);
    expect((await post(p.id, MEASURED)).status).toBe(200);
    expect(provider.calls).toBe(2);
  });

  it('returns 400 when the project has no photos', async () => {
    const p = createProject(dataDir, { name: 'P' });
    providerFromEnv.mockReturnValue(stub([ANSWER]));
    const res = await post(p.id, MEASURED);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/photo/i);
  });

  it.each([
    ['a non-positive length', { measurements: [{ description: 'x', lengthMm: 0 }] }],
    ['an empty description', { measurements: [{ description: ' ', lengthMm: 100 }] }],
    ['too many measurements', { measurements: Array.from({ length: 5 }, () => ({ description: 'x', lengthMm: 1 })) }],
    ['non-JSON', 'nope'],
  ])('returns 400 for %s', async (_label, body) => {
    const p = await projectWithPhoto(dataDir);
    providerFromEnv.mockReturnValue(stub([ANSWER]));
    expect((await post(p.id, body)).status).toBe(400);
  });

  it('returns 400 for a non-UUID id and 404 for an unknown project', async () => {
    expect((await post('..', MEASURED)).status).toBe(400);
    expect((await post(randomUUID(), MEASURED)).status).toBe(404);
  });
});
