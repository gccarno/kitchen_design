// @vitest-environment node
/**
 * The photo path on realistic input: pictures of each sample kitchen, taken
 * from its corners, go through upload, thumbnails and extraction the way the
 * app sends them. The model is stubbed to answer with the true room, so what
 * is checked is everything around it: what it is sent, and what comes back
 * as a proposal.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { z } from 'zod';
import { loadCatalog } from '@/lib/catalog/loader';
import { distance, type Point } from '@/lib/plan/geometry';
import type { LLMProvider, VisionRequest } from '@/lib/llm';
import { VISION_MAX_EDGE_PX } from '@/lib/llm/images';
import type { Photo, Project } from '@/lib/plan/schemas';
import { cornerViews } from '@/lib/plan/room-photo';
import { MAX_PHOTOS, STORED_MAX_EDGE_PX, THUMBNAIL_WIDTH_PX } from '@/lib/storage/limits';
import { createProject, loadProject } from '@/lib/storage/projects';
import { POST as upload } from '@/app/api/upload/route';
import { GET as getPhoto } from '@/app/api/projects/[id]/photos/[photoId]/route';
import { POST as commit } from '@/app/api/projects/[id]/revisions/route';
import { SHAPED_KITCHENS } from '../support/sample-kitchens';
import { buildExample, cornerPhotos, photoJpeg } from '../support/sample-photos';

const providerFromEnv = vi.fn<() => LLMProvider>();
vi.mock('@/lib/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm')>()),
  providerFromEnv: () => providerFromEnv(),
}));
const { POST: extract } = await import('@/app/api/projects/[id]/extract/route');
const { GET: pollJob } = await import('@/app/api/jobs/[id]/route');

let dataDir: string;
beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'kd-sample-photos-'));
  process.env.DATA_DIR = dataDir;
});
afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function uploadPhoto(projectId: string, jpeg: Buffer): Promise<{ status: number; photo?: Photo }> {
  const form = new FormData();
  form.append('projectId', projectId);
  form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'photo.jpg');
  const res = await upload(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
  return { status: res.status, photo: ((await res.json()) as { photo?: Photo }).photo };
}

async function stored(projectId: string, photoId: string, query = ''): Promise<Buffer> {
  const res = await getPhoto(new Request(`http://localhost/api/projects/${projectId}/photos/${photoId}${query}`), {
    params: Promise.resolve({ id: projectId, photoId }),
  });
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

/** What a model that read the photos perfectly would answer for this kitchen. */
function trueAnswer(truth: Project, measuredWalls: number[]) {
  const wallIndex = new Map(truth.room.walls.map((w, i) => [w.id, i]));
  return {
    confidence: 0.9,
    polygonMm: truth.room.polygon,
    walls: truth.room.walls.map((w) => ({ thicknessMm: w.thicknessMm })),
    openings: truth.room.openings.map((o) => ({ wallIdx: wallIndex.get(o.wallId)!, kind: o.kind, positionMm: o.positionMm, widthMm: o.widthMm, heightMm: o.heightMm })),
    measuredWalls,
    notes: 'read from the sample photos',
  };
}

/** A provider that records what it was sent and answers with `answer`. */
function recording(answer: unknown) {
  const requests: VisionRequest<unknown>[] = [];
  const provider: LLMProvider = {
    async completeText() {
      throw new Error('unused');
    },
    async completeJSON() {
      throw new Error('unused');
    },
    async chatWithVision<T>(req: VisionRequest<T>) {
      requests.push(req as VisionRequest<unknown>);
      return (req.schema as z.ZodType<T>).parse(answer);
    },
  };
  return { provider, requests };
}

async function runExtraction(projectId: string, body: unknown) {
  const res = await extract(
    new Request(`http://localhost/api/projects/${projectId}/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: projectId }) }
  );
  const started = (await res.json()) as { jobId: string };
  expect(res.status).toBe(202);
  for (let i = 0; i < 400; i++) {
    const polled = await pollJob(new Request('http://localhost/x'), { params: Promise.resolve({ id: started.jobId }) });
    const job = await polled.json();
    if (job.status === 'done') return job.result;
    if (job.status === 'failed') throw new Error(`extraction failed: ${JSON.stringify(job.error)}`);
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job did not settle');
}

describe('sample photos of the sample kitchens', () => {
  const catalog = loadCatalog();

  it.each(SHAPED_KITCHENS)('$name: corner photos upload, shrink for the model, and come back as the room', async (example) => {
    const truth = buildExample(example, catalog);
    const photos = await cornerPhotos(truth);
    expect(photos).toHaveLength(example.room.length);
    expect(photos.length).toBeLessThanOrEqual(MAX_PHOTOS);

    const project = createProject(dataDir, { name: example.name });
    for (const jpeg of photos) {
      const { status, photo } = await uploadPhoto(project.id, jpeg);
      expect(status).toBe(201);
      expect(photo).toMatchObject({ width: 1024, height: 768 });
    }
    const saved = loadProject(dataDir, project.id);
    expect(saved.photos).toHaveLength(photos.length);

    // The grid's thumbnail of the first photo.
    const thumb = await sharp(await stored(project.id, saved.photos[0].id, `?w=${THUMBNAIL_WIDTH_PX}`)).metadata();
    expect([thumb.width, thumb.height, thumb.format]).toEqual([THUMBNAIL_WIDTH_PX, 240, 'jpeg']);

    // Extract, with the first wall measured.
    const wallMm = distance(example.room[0] as Point, example.room[1] as Point);
    const { provider, requests } = recording(trueAnswer(truth, [0]));
    providerFromEnv.mockReturnValue(provider);
    const result = await runExtraction(project.id, { measurements: [{ description: 'the first wall', lengthMm: wallMm }] });

    // The model got every photo, in order, at a size it can take, and was told about each.
    expect(requests).toHaveLength(1);
    expect(requests[0].images).toHaveLength(photos.length);
    for (const image of requests[0].images) {
      const meta = await sharp(Buffer.from(image.dataBase64, 'base64')).metadata();
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(VISION_MAX_EDGE_PX);
    }
    expect(requests[0].user).toContain(`${wallMm} mm`);
    expect(requests[0].user).toContain('the first wall');

    // A true answer needs no rescaling and no warnings, and applies as the room.
    expect(result.scale).toBeCloseTo(1, 6);
    expect(result.warnings).toEqual([]);
    expect(result.room.polygon).toEqual(example.room);
    expect(result.room.openings).toHaveLength(truth.room.openings.length);
    const committed = await commit(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: result.baseRevision, patch: result.patch, summary: 'Room from photos', source: 'llm' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(committed.status).toBe(200);
    const after = loadProject(dataDir, project.id);
    expect(after.room.polygon).toEqual(example.room);
    expect(after.room.openings.map((o) => o.kind).sort()).toEqual(truth.room.openings.map((o) => o.kind).sort());
    expect(after.photos).toHaveLength(photos.length);
  });

  it('a photo taken with the phone upright is stored the right way up', async () => {
    const truth = buildExample(SHAPED_KITCHENS[0], catalog);
    const camera = cornerViews(truth)[2];
    // Saved on its side with a "turn me" tag, as phones do.
    const jpeg = await photoJpeg(truth, camera, { width: 600, height: 800, orientation: 6 });
    expect(await sharp(jpeg).metadata()).toMatchObject({ width: 800, height: 600, orientation: 6 });

    const project = createProject(dataDir, { name: 'Upright' });
    const { status, photo } = await uploadPhoto(project.id, jpeg);
    expect(status).toBe(201);
    expect(photo).toMatchObject({ width: 600, height: 800 });

    // Ceiling at the top, floor at the bottom: the same as the picture that was taken.
    const upright = await sharp(await stored(project.id, photo!.id)).raw().toBuffer();
    const taken = await sharp(await photoJpeg(truth, camera, { width: 600, height: 800 })).raw().toBuffer();
    const at = (buf: Buffer, x: number, y: number) => buf[(y * 600 + x) * 3];
    for (const [x, y] of [[300, 10], [300, 400], [300, 790], [50, 400], [550, 400]]) {
      expect(Math.abs(at(upright, x, y) - at(taken, x, y)), `pixel ${x},${y}`).toBeLessThan(12);
    }
  });

  it('a full-size phone photo is stored shrunk to the stored size', async () => {
    const truth = buildExample(SHAPED_KITCHENS[1], catalog);
    const small = await photoJpeg(truth, cornerViews(truth)[0]);
    const big = await sharp(small).resize(4032, 3024).jpeg({ quality: 90 }).toBuffer();

    const project = createProject(dataDir, { name: 'Full size' });
    const { status, photo } = await uploadPhoto(project.id, big);
    expect(status).toBe(201);
    expect(photo).toMatchObject({ width: STORED_MAX_EDGE_PX, height: (STORED_MAX_EDGE_PX * 3) / 4 });
    expect((await stored(project.id, photo!.id)).length).toBeLessThan(big.length);
  });
});
