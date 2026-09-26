import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import type { z } from 'zod';
import { extractRoom, ExtractionError } from './extract';
import { LLMResponseError } from './openai-compatible';
import type { LLMProvider, VisionRequest } from './provider';
import { VISION_MAX_EDGE_PX } from './images';
import { commitRevision } from '../plan/diff';
import { validatePlan, wallLengthMm } from '../plan/validate';
import { ProjectSchema, type Photo, type Project } from '../plan/schemas';

/** A provider that replays queued outcomes and records every vision request. */
class StubProvider implements LLMProvider {
  requests: VisionRequest<unknown>[] = [];
  constructor(private outcomes: Array<unknown | Error>) {}
  async completeText(): Promise<string> {
    throw new Error('not used');
  }
  async completeJSON<T>(): Promise<T> {
    throw new Error('not used');
  }
  async chatWithVision<T>(req: VisionRequest<T>): Promise<T> {
    this.requests.push(req as VisionRequest<unknown>);
    const next = this.outcomes.shift();
    if (next === undefined) throw new Error('stub: no more outcomes');
    if (next instanceof Error) throw next;
    // Parse like the real provider does, so schema defaults apply.
    return (req.schema as z.ZodType<T>).parse(next);
  }
}

/** A 4000 × 3000 guess with a door on wall 0. */
const answer = (overrides: Record<string, unknown> = {}) => ({
  confidence: 0.7,
  polygonMm: [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ],
  walls: [{ thicknessMm: 120 }, { thicknessMm: 120 }, { thicknessMm: 120 }, { thicknessMm: 120 }],
  openings: [{ wallIdx: 0, kind: 'door', positionMm: 1000, widthMm: 900, heightMm: 2100 }],
  measuredWalls: [0],
  notes: 'fridge wall partly hidden',
  ...overrides,
});

let bigJpeg: Buffer;
beforeAll(async () => {
  bigJpeg = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 5, g: 5, b: 5 } } })
    .jpeg()
    .toBuffer();
});

function project(photos: Photo[]): Project {
  return ProjectSchema.parse({
    id: '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b',
    name: 'P',
    units: 'mm',
    createdAt: 'x',
    updatedAt: 'x',
    revision: 3,
    photos,
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
    items: [],
    history: [],
  });
}

const PHOTOS: Photo[] = [
  { id: 'p1', path: 'photos/p1.jpg', width: 4000, height: 3000, wallHint: 'north' },
  {
    id: 'p2',
    path: 'photos/p2.jpg',
    width: 4000,
    height: 3000,
    referenceObject: { kind: 'credit_card', side: 'long', knownSizeMm: 85.6, pixelBox: [400, 300, 800, 600] },
  },
];

const run = (provider: LLMProvider, measurements = [{ description: 'sink wall', lengthMm: 3600 }]) =>
  extractRoom({ project: project(PHOTOS), readPhoto: async () => bigJpeg, provider, measurements });

describe('extractRoom', () => {
  it('sends every photo downscaled, with reference boxes mapped to the sent pixels', async () => {
    const provider = new StubProvider([answer()]);
    await run(provider);
    const [req] = provider.requests;
    expect(req.images).toHaveLength(2);
    for (const img of req.images) {
      const meta = await sharp(Buffer.from(img.dataBase64, 'base64')).metadata();
      expect(Math.max(meta.width!, meta.height!)).toBe(VISION_MAX_EDGE_PX);
    }
    // 1568 / 4000 = 0.392 → [400,300,800,600] becomes [157,118,314,235].
    expect(req.user).toMatch(/\[157, 118, 314, 235\]/);
    expect(req.user).toMatch(/north wall/);
    expect(req.user).toMatch(/"sink wall" = 3600 mm/);
  });

  it('rescales the outline so the measured wall is exact, and assigns stable ids', async () => {
    const r = await run(new StubProvider([answer()]));
    expect(r.scale).toBeCloseTo(0.9);
    expect(wallLengthMm(r.room, 0)).toBeCloseTo(3600);
    expect(wallLengthMm(r.room, 1)).toBeCloseTo(2700);
    expect(new Set(r.room.walls.map((w) => w.id)).size).toBe(4);
    expect(r.room.measurements).toEqual([{ wallId: r.room.walls[0].id, lengthMm: 3600, source: 'user' }]);
    expect(r.room.openings).toEqual([
      expect.objectContaining({ wallId: r.room.walls[0].id, kind: 'door', positionMm: 900, widthMm: 810 }),
    ]);
    expect(r.confidence).toBe(0.7);
    expect(r.notes).toBe('fridge wall partly hidden');
    expect(r.warnings).toEqual([]);
  });

  it('returns a patch against baseRevision that commits to exactly the candidate room', async () => {
    const p = project(PHOTOS);
    const r = await extractRoom({
      project: p,
      readPhoto: async () => bigJpeg,
      provider: new StubProvider([answer()]),
      measurements: [{ description: 'sink wall', lengthMm: 3600 }],
    });
    expect(r.baseRevision).toBe(3);
    const committed = commitRevision(p, r.patch, { baseRevision: r.baseRevision, source: 'llm', summary: 'extract' });
    expect(committed.room).toEqual(r.room);
    expect(validatePlan(committed).valid).toBe(true);
  });

  it('does not modify the project it was given', async () => {
    const p = project(PHOTOS);
    const before = structuredClone(p);
    await extractRoom({
      project: p,
      readPhoto: async () => bigJpeg,
      provider: new StubProvider([answer({ measuredWalls: [] })]),
      measurements: [],
    });
    expect(p).toEqual(before);
  });

  it('retries once with the problems fed back when the answer fails the room checks', async () => {
    const provider = new StubProvider([answer({ walls: [{ thicknessMm: 120 }] }), answer()]);
    const r = await run(provider);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].user).toMatch(/previous answer was rejected/i);
    expect(provider.requests[1].user).toMatch(/1 walls but polygonMm has 4 edges/);
    expect(wallLengthMm(r.room, 0)).toBeCloseTo(3600);
  });

  it('retries once when the reply is not valid JSON for the schema', async () => {
    const provider = new StubProvider([new LLMResponseError('LLM returned non-JSON content: x', 'oops'), answer()]);
    await run(provider);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].user).toMatch(/non-JSON/);
  });

  it('gives up after the retry with an ExtractionError listing the issues', async () => {
    const bad = answer({ measuredWalls: [] });
    const err = await run(new StubProvider([bad, bad])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect((err as ExtractionError).issues.join(' ')).toMatch(/measuredWalls/);
  });

  it('does not retry transport errors', async () => {
    const provider = new StubProvider([new Error('LLM request failed: 500'), answer()]);
    await expect(run(provider)).rejects.toThrow(/500/);
    expect(provider.requests).toHaveLength(1);
  });

  it('warns when there are no measurements (scale is the model estimate)', async () => {
    const r = await run(new StubProvider([answer({ measuredWalls: [] })]), []);
    expect(r.scale).toBe(1);
    expect(r.warnings.join(' ')).toMatch(/no measured walls/i);
  });

  it('warns when two measurements disagree', async () => {
    const r = await run(new StubProvider([answer({ measuredWalls: [0, 1] })]), [
      { description: 'sink wall', lengthMm: 4400 },
      { description: 'side wall', lengthMm: 2700 },
    ]);
    expect(r.warnings.join(' ')).toMatch(/disagree/i);
  });

  it('warns when placed items would end up outside the new room', async () => {
    const p = {
      ...project(PHOTOS),
      items: [
        {
          id: 'i1',
          catalogId: 'c',
          sizeMm: { w: 600, d: 560, h: 720 },
          position: { x: 3500, y: 3500 },
          rotationDeg: 0,
        },
      ],
    };
    const r = await extractRoom({
      project: p,
      readPhoto: async () => bigJpeg,
      provider: new StubProvider([answer()]),
      measurements: [{ description: 'sink wall', lengthMm: 3600 }],
    });
    expect(r.warnings.join(' ')).toMatch(/i1.*outside/);
  });

  it('refuses a project without photos', async () => {
    await expect(
      extractRoom({ project: project([]), readPhoto: async () => bigJpeg, provider: new StubProvider([]), measurements: [] })
    ).rejects.toThrow(/no photos/i);
  });
});
