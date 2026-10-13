import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, loadProject } from '@/lib/storage/projects';
import type { Project } from '@/lib/plan/schemas';
import { POST } from './route';

const post = (id: string) => POST(new Request(`http://localhost/api/projects/${id}/duplicate`, { method: 'POST' }), { params: Promise.resolve({ id }) });

describe('POST /api/projects/[id]/duplicate', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-duplicate-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('copies the project as an option and returns it (201)', async () => {
    const original = createProject(dataDir, { name: 'Our kitchen' });
    const res = await post(original.id);
    expect(res.status).toBe(201);
    const { project } = (await res.json()) as { project: Project };
    expect(project.name).toBe('Our kitchen — Option B');
    expect(project.optionOf).toBe(original.id);
    expect(loadProject(dataDir, project.id)).toEqual(project);
  });

  it('400s an invalid id and 404s an unknown project', async () => {
    expect((await post('../etc')).status).toBe(400);
    const res = await post('00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('project not found');
  });
});
