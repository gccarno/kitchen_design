import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, projectExists } from '@/lib/storage/projects';
import { DELETE, GET } from './route';

const del = (id: string) => DELETE(new Request(`http://localhost/api/projects/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });

describe('DELETE /api/projects/[id]', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-delete-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('deletes the project from disk', async () => {
    const p = createProject(dataDir, { name: 'Gone' });
    const res = await del(p.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(projectExists(dataDir, p.id)).toBe(false);
  });

  it('404s an unknown project (including a second delete) and 400s a bad id', async () => {
    const p = createProject(dataDir, { name: 'Once' });
    await del(p.id);
    expect((await del(p.id)).status).toBe(404);
    expect((await del('../etc')).status).toBe(400);
  });
});

const get = (id: string) => GET(new Request(`http://localhost/api/projects/${id}`), { params: Promise.resolve({ id }) });

describe('GET /api/projects/[id]', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-get-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('returns the full document without history, no-store', async () => {
    const p = createProject(dataDir, { name: 'Doc' });
    const res = await get(p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { history: _history, ...rest } = p;
    const body = await res.json();
    expect(body).toEqual(rest);
    expect(body).not.toHaveProperty('history');
    expect(body).toHaveProperty('room');
  });

  it('404s an unknown project and 400s a bad id', async () => {
    const res = await get('00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await get('../etc')).status).toBe(400);
  });
});
