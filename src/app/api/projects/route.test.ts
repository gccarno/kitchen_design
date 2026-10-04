import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProject } from '@/lib/storage/projects';
import { validatePlan } from '@/lib/plan/validate';
import type { Project } from '@/lib/plan/schemas';
import { POST } from './route';

function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );
}

describe('POST /api/projects', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-projects-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('creates a project with a valid default room and returns it', async () => {
    const res = await post({ name: 'My kitchen' });
    expect(res.status).toBe(201);
    const { project } = (await res.json()) as { project: Project };
    expect(project.name).toBe('My kitchen');
    expect(project.revision).toBe(0);
    expect(loadProject(dataDir, project.id)).toEqual(project);
    expect(validatePlan(project).valid).toBe(true);
  });

  it('trims the name', async () => {
    const { project } = (await (await post({ name: '  Kitchen  ' })).json()) as { project: Project };
    expect(project.name).toBe('Kitchen');
  });

  it('creates a closet project when asked', async () => {
    const res = await post({ name: 'Hall closet', kind: 'closet' });
    expect(res.status).toBe(201);
    const { project } = (await res.json()) as { project: Project };
    expect(project.kind).toBe('closet');
    expect(project.closet?.components).toEqual([]);
  });

  it.each([{}, { name: '' }, { name: '   ' }, { name: 42 }, { name: 'x', kind: 'garage' }, 'not json'])('rejects %j with 400', async (body) => {
    expect((await post(body)).status).toBe(400);
  });
});
