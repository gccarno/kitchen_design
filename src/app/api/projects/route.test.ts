import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProject } from '@/lib/storage/projects';
import { validatePlan } from '@/lib/plan/validate';
import type { Project } from '@/lib/plan/schemas';
import { GET, POST } from './route';

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

  it('creates a furnished sample kitchen when asked', async () => {
    const res = await post({ name: 'Sample kitchen', sample: true });
    expect(res.status).toBe(201);
    const { project } = (await res.json()) as { project: Project };
    expect(project.kind).toBe('kitchen');
    expect(project.items.length).toBeGreaterThan(5);
    expect(loadProject(dataDir, project.id)).toEqual(project);
    expect(validatePlan(project).warnings).toEqual([]);
  });

  it('creates a furnished sample cleaning closet when asked', async () => {
    const res = await post({ name: 'Sample cleaning closet', kind: 'closet', sample: true });
    expect(res.status).toBe(201);
    const { project } = (await res.json()) as { project: Project };
    expect(project.kind).toBe('closet');
    expect(project.closet?.widthMm).toBe(1219);
    expect(project.closet?.components.length).toBeGreaterThan(3);
    expect(loadProject(dataDir, project.id)).toEqual(project);
    expect(validatePlan(project).warnings).toEqual([]);
  });

  it.each([{}, { name: '' }, { name: '   ' }, { name: 42 }, { name: 'x', kind: 'garage' }, 'not json'])('rejects %j with 400', async (body) => {
    expect((await post(body)).status).toBe(400);
  });
});

describe('GET /api/projects', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-projects-list-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('lists light summaries newest first with no-store', async () => {
    const a = (await (await post({ name: 'First', sample: true })).json()) as { project: Project };
    await new Promise((r) => setTimeout(r, 10));
    const b = (await (await post({ name: 'Second', kind: 'closet' })).json()) as { project: Project };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const list = (await res.json()) as Record<string, unknown>[];
    expect(list.map((p) => p.id)).toEqual([b.project.id, a.project.id]);
    expect(Object.keys(list[0]).sort()).toEqual(['createdAt', 'id', 'kind', 'name', 'revision', 'updatedAt']);
    expect(list[1]).toMatchObject({ name: 'First', kind: 'kitchen', revision: 0 });
    for (const p of list) for (const k of ['room', 'items', 'closet', 'history']) expect(p).not.toHaveProperty(k);
  });

  it('returns an empty list when there are no projects', async () => {
    expect(await (await GET()).json()).toEqual([]);
  });
});
