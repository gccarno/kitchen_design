import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject, loadProject } from '@/lib/storage/projects';
import type { Project } from '@/lib/plan/schemas';
import { POST } from './route';

function post(id: string, body: unknown): Promise<Response> {
  const req = new Request(`http://localhost/api/projects/${id}/revisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

const rename = (value: string) => [{ op: 'replace', path: '/name', value }];

describe('POST /api/projects/[id]/revisions', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-revisions-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('commits the patch as a user revision and persists it', async () => {
    const p = createProject(dataDir, { name: 'Before' });
    const res = await post(p.id, { baseRevision: 0, patch: rename('After'), summary: 'rename' });
    expect(res.status).toBe(200);
    const { project } = (await res.json()) as { project: Project };
    expect(project.revision).toBe(1);
    expect(project.history[0]).toMatchObject({ source: 'user', summary: 'rename' });
    expect(loadProject(dataDir, p.id)).toEqual(project);
  });

  it('returns 409 with the current revision when the base is stale', async () => {
    const p = createProject(dataDir, { name: 'P' });
    await post(p.id, { baseRevision: 0, patch: rename('one'), summary: '1' });
    const res = await post(p.id, { baseRevision: 0, patch: rename('two'), summary: '2' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ currentRevision: 1 });
    expect(loadProject(dataDir, p.id).name).toBe('one');
  });

  it('returns 400 for an edit that would make the plan invalid, and saves nothing', async () => {
    const p = createProject(dataDir, { name: 'P' });
    const res = await post(p.id, { baseRevision: 0, patch: [{ op: 'remove', path: '/room/walls/0' }], summary: 's' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/walls/);
    expect(loadProject(dataDir, p.id).revision).toBe(0);
  });

  it('returns 400 for a non-editable path', async () => {
    const p = createProject(dataDir, { name: 'P' });
    const res = await post(p.id, { baseRevision: 0, patch: [{ op: 'replace', path: '/revision', value: 9 }], summary: 's' });
    expect(res.status).toBe(400);
  });

  it.each([
    ['missing baseRevision', { patch: [], summary: 's' }],
    ['patch not an array', { baseRevision: 0, patch: {}, summary: 's' }],
    ['empty patch', { baseRevision: 0, patch: [], summary: 's' }],
    ['summary too long', { baseRevision: 0, patch: rename('x'), summary: 's'.repeat(501) }],
    ['bad op', { baseRevision: 0, patch: [{ op: 'explode', path: '/name' }], summary: 's' }],
    ['not JSON', 'nope'],
  ])('returns 400 for a malformed body (%s)', async (_label, body) => {
    const p = createProject(dataDir, { name: 'P' });
    expect((await post(p.id, body)).status).toBe(400);
  });

  it('returns 400 for a non-UUID id and 404 for an unknown project', async () => {
    const body = { baseRevision: 0, patch: rename('x'), summary: 's' };
    expect((await post('../x', body)).status).toBe(400);
    expect((await post(randomUUID(), body)).status).toBe(404);
  });

  it('serializes concurrent commits: exactly one of two same-base edits wins', async () => {
    const p = createProject(dataDir, { name: 'P' });
    const [a, b] = await Promise.all([
      post(p.id, { baseRevision: 0, patch: rename('a'), summary: 'a' }),
      post(p.id, { baseRevision: 0, patch: rename('b'), summary: 'b' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(loadProject(dataDir, p.id).revision).toBe(1);
  });
});
