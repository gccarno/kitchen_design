import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { POST } from './route';
import { createProject, loadProject, projectDir } from '@/lib/storage/projects';

function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .jpeg()
    .toBuffer();
}

interface UploadResult {
  photo: { id: string; path: string; width: number; height: number };
}

async function readJson(res: Response): Promise<UploadResult> {
  return (await res.json()) as UploadResult;
}

function post(fields: Record<string, string | Blob>): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
}

const jpegBlob = async (w = 100, h = 100) => new Blob([new Uint8Array(await makeJpeg(w, h))], { type: 'image/jpeg' });

describe('POST /api/upload', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-upload-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('rejects requests without projectId', async () => {
    const res = await post({ file: await jpegBlob() });
    expect(res.status).toBe(400);
  });

  it('rejects a non-UUID projectId without touching the filesystem', async () => {
    const res = await post({ projectId: '../../escape', file: await jpegBlob() });
    expect(res.status).toBe(400);
    expect(existsSync(join(dataDir, 'escape'))).toBe(false);
    expect(existsSync(join(dataDir, 'projects'))).toBe(false);
  });

  it('returns 404 for a well-formed id with no project', async () => {
    const res = await post({ projectId: randomUUID(), file: await jpegBlob() });
    expect(res.status).toBe(404);
    expect(existsSync(join(dataDir, 'projects'))).toBe(false);
  });

  it('rejects requests without a file', async () => {
    const p = createProject(dataDir, { name: 'Test' });
    const res = await post({ projectId: p.id });
    expect(res.status).toBe(400);
  });

  it('rejects bytes that are not an image', async () => {
    const p = createProject(dataDir, { name: 'Test' });
    const res = await post({ projectId: p.id, file: new Blob(['not an image'], { type: 'image/jpeg' }) });
    expect(res.status).toBe(400);
    expect(loadProject(dataDir, p.id).photos).toEqual([]);
  });

  it('saves the photo, registers it on the project, and returns metadata', async () => {
    const p = createProject(dataDir, { name: 'Test' });
    const res = await post({ projectId: p.id, file: await jpegBlob(640, 480) });
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.photo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.photo.path).toBe(`photos/${body.photo.id}.jpg`);
    expect(body.photo.width).toBe(640);
    expect(body.photo.height).toBe(480);

    const filePath = join(projectDir(dataDir, p.id), body.photo.path);
    const dims = await sharp(readFileSync(filePath)).metadata();
    expect(dims.width).toBe(640);
    expect(dims.height).toBe(480);

    const saved = loadProject(dataDir, p.id);
    expect(saved.photos).toEqual([body.photo]);
    expect(saved.updatedAt >= p.updatedAt).toBe(true);
    // No sidecar files any more — the project document is the only record.
    expect(readdirSync(join(projectDir(dataDir, p.id), 'photos'))).toEqual([`${body.photo.id}.jpg`]);
  });

  it('keeps every photo when uploads run concurrently', async () => {
    const p = createProject(dataDir, { name: 'Test' });
    const results = await Promise.all(
      Array.from({ length: 5 }, async () => post({ projectId: p.id, file: await jpegBlob() }))
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(loadProject(dataDir, p.id).photos).toHaveLength(5);
  });
});
