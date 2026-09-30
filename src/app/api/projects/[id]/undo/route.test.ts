import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, loadProject } from '@/lib/storage/projects';
import type { Project } from '@/lib/plan/schemas';
import { POST as commit } from '../revisions/route';
import { POST } from './route';

function call(handler: typeof POST, id: string, path: string, body: unknown): Promise<Response> {
  const req = new Request(`http://localhost/api/projects/${id}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handler(req, { params: Promise.resolve({ id }) });
}
const undo = (id: string, body: unknown) => call(POST, id, 'undo', body);

describe('POST /api/projects/[id]/undo', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-undo-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('undoes and redoes the last change, saving each as a revision', async () => {
    const p = createProject(dataDir, { name: 'Before' });
    await call(commit, p.id, 'revisions', { baseRevision: 0, patch: [{ op: 'replace', path: '/name', value: 'After' }], summary: 'rename' });

    const res = await undo(p.id, { action: 'undo', baseRevision: 1 });
    expect(res.status).toBe(200);
    const { project } = (await res.json()) as { project: Project };
    expect(project).toMatchObject({ name: 'Before', revision: 2 });
    expect(loadProject(dataDir, p.id)).toEqual(project);

    const again = (await (await undo(p.id, { action: 'redo', baseRevision: 2 })).json()) as { project: Project };
    expect(again.project).toMatchObject({ name: 'After', revision: 3 });
  });

  it('returns 400 when there is nothing to undo', async () => {
    const p = createProject(dataDir, { name: 'P' });
    const res = await undo(p.id, { action: 'undo', baseRevision: 0 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'nothing to undo' });
  });

  it('returns 409 with the current revision when the base is stale', async () => {
    const p = createProject(dataDir, { name: 'P' });
    await call(commit, p.id, 'revisions', { baseRevision: 0, patch: [{ op: 'replace', path: '/name', value: 'X' }], summary: 's' });
    const res = await undo(p.id, { action: 'undo', baseRevision: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ currentRevision: 1 });
  });

  it('rejects a malformed body and an unknown project', async () => {
    const p = createProject(dataDir, { name: 'P' });
    expect((await undo(p.id, { action: 'rewind', baseRevision: 0 })).status).toBe(400);
    expect((await undo('00000000-0000-4000-8000-000000000000', { action: 'undo', baseRevision: 0 })).status).toBe(404);
  });
});
