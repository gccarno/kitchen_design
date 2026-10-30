import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, listProjects, loadProject, saveProject } from '@/lib/storage/projects';
import { validatePlan } from '@/lib/plan/validate';
import { POST } from './route';

const post = (id: string) =>
  POST(new Request(`http://localhost/api/projects/${id}/propose-layouts`, { method: 'POST' }), { params: Promise.resolve({ id }) });

type Option = { id: string; name: string; label: string; passed: number; counted: number };

describe('POST /api/projects/[id]/propose-layouts', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-propose-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('saves each suggested layout as a new option and leaves the project alone (201)', async () => {
    const original = createProject(dataDir, { name: 'Our kitchen' });
    const res = await post(original.id);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { groupId: string; options: Option[] };
    expect(body.groupId).toBe(original.id);
    expect(body.options.length).toBeGreaterThanOrEqual(1);
    expect(body.options.map((o) => o.name)).toEqual(['Our kitchen — Option B', 'Our kitchen — Option C', 'Our kitchen — Option D'].slice(0, body.options.length));

    for (const o of body.options) {
      const saved = loadProject(dataDir, o.id)!;
      expect(saved.optionOf).toBe(original.id);
      expect(saved.items.length).toBeGreaterThan(0);
      expect(validatePlan(saved).errors).toEqual([]);
    }
    expect(loadProject(dataDir, original.id)).toEqual(original);
    expect(listProjects(dataDir)).toHaveLength(1 + body.options.length);
  });

  it('answers 200 with a reason, and saves nothing, when no layout fits', async () => {
    const tiny = createProject(dataDir, { name: 'Tiny' });
    const poly = [[0, 0], [1800, 0], [1800, 2000], [0, 2000]] as [number, number][];
    saveProject(dataDir, { ...tiny, room: { ...tiny.room, polygon: poly } });
    const res = await post(tiny.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { options: Option[]; reason: string };
    expect(body.options).toEqual([]);
    expect(body.reason).toMatch(/No standard layout fits/);
    expect(listProjects(dataDir)).toHaveLength(1);
  });

  it('400s an invalid id and 404s an unknown project', async () => {
    expect((await post('../etc')).status).toBe(400);
    const res = await post('00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('project not found');
  });
});
