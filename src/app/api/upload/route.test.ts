import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { POST } from './route';

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
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(10)], { type: 'image/jpeg' }), 'x.jpg');
    const req = new Request('http://localhost/api/upload', { method: 'POST', body: form });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects requests without a file', async () => {
    const form = new FormData();
    form.append('projectId', 'p1');
    const req = new Request('http://localhost/api/upload', { method: 'POST', body: form });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects an invalid referenceKind', async () => {
    const jpeg = await makeJpeg(100, 100);
    const form = new FormData();
    form.append('projectId', 'p1');
    form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'x.jpg');
    form.append('referenceKind', 'banana');
    const req = new Request('http://localhost/api/upload', { method: 'POST', body: form });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects custom reference with missing size', async () => {
    const jpeg = await makeJpeg(100, 100);
    const form = new FormData();
    form.append('projectId', 'p1');
    form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'x.jpg');
    form.append('referenceKind', 'custom');
    const req = new Request('http://localhost/api/upload', { method: 'POST', body: form });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('saves a photo to the project directory and returns metadata', async () => {
    // Pre-create the project dir by writing a project.json there.
    const { projectDir, createProject, loadProject } = await import('@/lib/storage/projects');
    const p = createProject(dataDir, { name: 'Test' });

    const jpeg = await makeJpeg(640, 480);
    const form = new FormData();
    form.append('projectId', p.id);
    form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'kitchen.jpg');
    const req = new Request('http://localhost/api/upload', { method: 'POST', body: form });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.photo.id).toMatch(/[0-9a-f-]{36}/);
    expect(body.photo.path).toMatch(/^photos\/.+\.jpg$/);
    expect(body.photo.width).toBe(640);
    expect(body.photo.height).toBe(480);

    const filePath = join(projectDir(dataDir, p.id), body.photo.path);
    expect(existsSync(filePath)).toBe(true);
    // Confirm the saved bytes are a valid JPEG of the right size.
    const saved = readFileSync(filePath);
    const dims = await sharp(saved).metadata();
    expect(dims.width).toBe(640);
    expect(dims.height).toBe(480);
  });

  it('writes a sidecar reference metadata file when reference is provided', async () => {
    const { createProject, projectDir } = await import('@/lib/storage/projects');
    const p = createProject(dataDir, { name: 'Test' });
    const jpeg = await makeJpeg(100, 100);
    const form = new FormData();
    form.append('projectId', p.id);
    form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'x.jpg');
    form.append('referenceKind', 'credit_card');
    const req = new Request('http://localhost/api/upload', { method: 'POST', body: form });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await readJson(res);
    const sidecar = join(projectDir(dataDir, p.id), 'photos', `${body.photo.id}.ref.json`);
    expect(existsSync(sidecar)).toBe(true);
    const meta = JSON.parse(readFileSync(sidecar, 'utf-8'));
    expect(meta).toEqual({ kind: 'credit_card', knownSizeMm: 85.6 });
  });
});
