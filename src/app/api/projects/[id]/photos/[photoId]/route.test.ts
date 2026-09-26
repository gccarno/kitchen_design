import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createProject, loadProject } from '@/lib/storage/projects';
import { POST as upload } from '@/app/api/upload/route';
import { GET } from './route';
import { PUT, DELETE } from './reference/route';

type Params = { params: Promise<{ id: string; photoId: string }> };
const ctx = (id: string, photoId: string): Params => ({ params: Promise.resolve({ id, photoId }) });

async function uploadPhoto(projectId: string, w = 400, h = 300): Promise<string> {
  const jpeg = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.append('projectId', projectId);
  form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));
  const res = await upload(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
  return ((await res.json()) as { photo: { id: string } }).photo.id;
}

function putRef(id: string, photoId: string, body: unknown): Promise<Response> {
  const req = new Request(`http://localhost/api/projects/${id}/photos/${photoId}/reference`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PUT(req, ctx(id, photoId));
}

describe('photo routes', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-photo-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  describe('GET /api/projects/[id]/photos/[photoId]', () => {
    it('serves the stored JPEG', async () => {
      const p = createProject(dataDir, { name: 'P' });
      const photoId = await uploadPhoto(p.id, 400, 300);
      const res = await GET(new Request('http://localhost/x'), ctx(p.id, photoId));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      expect([meta.width, meta.height]).toEqual([400, 300]);
    });

    it('returns 400 for a non-UUID project id', async () => {
      const res = await GET(new Request('http://localhost/x'), ctx('..', randomUUID()));
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown project', async () => {
      const res = await GET(new Request('http://localhost/x'), ctx(randomUUID(), randomUUID()));
      expect(res.status).toBe(404);
    });

    it('returns 404 for a photo id not listed on the project', async () => {
      const p = createProject(dataDir, { name: 'P' });
      const res = await GET(new Request('http://localhost/x'), ctx(p.id, '../project.json'));
      expect(res.status).toBe(404);
    });
  });

  describe('PUT/DELETE .../reference', () => {
    it('resolves and stores the reference on the photo', async () => {
      const p = createProject(dataDir, { name: 'P' });
      const photoId = await uploadPhoto(p.id);
      const res = await putRef(p.id, photoId, { kind: 'credit_card', side: 'long', pixelBox: [120, 90, 20, 30] });
      expect(res.status).toBe(200);
      const ref = loadProject(dataDir, p.id).photos[0].referenceObject;
      expect(ref).toEqual({ kind: 'credit_card', side: 'long', knownSizeMm: 85.6, pixelBox: [20, 30, 120, 90] });
    });

    it('stores a custom size', async () => {
      const p = createProject(dataDir, { name: 'P' });
      const photoId = await uploadPhoto(p.id);
      const res = await putRef(p.id, photoId, {
        kind: 'custom',
        side: 'long',
        customSizeMm: 600,
        pixelBox: [0, 0, 100, 10],
      });
      expect(res.status).toBe(200);
      expect(loadProject(dataDir, p.id).photos[0].referenceObject?.knownSizeMm).toBe(600);
    });

    it('rejects a box outside the photo with 400 and leaves the project unchanged', async () => {
      const p = createProject(dataDir, { name: 'P' });
      const photoId = await uploadPhoto(p.id, 400, 300);
      const res = await putRef(p.id, photoId, { kind: 'credit_card', side: 'long', pixelBox: [0, 0, 500, 100] });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/outside/);
      expect(loadProject(dataDir, p.id).photos[0].referenceObject).toBeUndefined();
    });

    it('rejects a malformed body with 400', async () => {
      const p = createProject(dataDir, { name: 'P' });
      const photoId = await uploadPhoto(p.id);
      const res = await putRef(p.id, photoId, { kind: 'tape_measure', side: 'long', pixelBox: [0, 0, 1, 1] });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown photo', async () => {
      const p = createProject(dataDir, { name: 'P' });
      const res = await putRef(p.id, randomUUID(), { kind: 'credit_card', side: 'long', pixelBox: [0, 0, 1, 1] });
      expect(res.status).toBe(404);
    });

    it('DELETE clears the reference', async () => {
      const p = createProject(dataDir, { name: 'P' });
      const photoId = await uploadPhoto(p.id);
      await putRef(p.id, photoId, { kind: 'credit_card', side: 'long', pixelBox: [0, 0, 100, 60] });
      const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), ctx(p.id, photoId));
      expect(res.status).toBe(200);
      expect(loadProject(dataDir, p.id).photos[0].referenceObject).toBeUndefined();
    });
  });
});
