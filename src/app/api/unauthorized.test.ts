// @vitest-environment node
/**
 * With auth on, every storage-backed API route answers 401 JSON (never a 500,
 * never data) when the request has no valid session — even if it slipped past
 * the middleware — and another user's project is a plain 404.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetTestDb, sharedTestDb } from '@/lib/db/test-db';
import type { Db } from '@/lib/db/types';
import { createSession, createUser } from '@/lib/auth/users';
import { addPhoto, getStorageFor, newProject } from '@/lib/storage';
import * as projects from './projects/route';
import * as project from './projects/[id]/route';
import * as duplicate from './projects/[id]/duplicate/route';
import * as extract from './projects/[id]/extract/route';
import * as refine from './projects/[id]/refine/route';
import * as revisions from './projects/[id]/revisions/route';
import * as undo from './projects/[id]/undo/route';
import * as photo from './projects/[id]/photos/[photoId]/route';
import * as reference from './projects/[id]/photos/[photoId]/reference/route';
import * as upload from './upload/route';
import * as csv from './export/[id]/csv/route';
import * as svg from './export/[id]/svg/route';

const state = vi.hoisted(() => ({ db: undefined as unknown, headers: new Headers() }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('next/headers', () => ({ headers: async () => state.headers }));

let db: Db;
let dir: string;
beforeAll(async () => {
  db = await sharedTestDb();
  state.db = db;
});
beforeEach(async () => {
  await resetTestDb(db);
  state.headers = new Headers();
  dir = mkdtempSync(join(tmpdir(), 'kd-unauth-'));
  vi.stubEnv('DATABASE_URL', 'postgres://test');
  vi.stubEnv('DATA_DIR', dir);
  vi.stubEnv('GCS_BUCKET', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const json = (body: unknown) => new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (id: string, photoId: string = randomUUID()) => ({ params: Promise.resolve({ id, photoId }) });

function calls(id: string, photoId: string): [string, () => Promise<Response>][] {
  const form = new FormData();
  form.set('projectId', id);
  form.set('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'x.jpg');
  return [
    ['POST /api/projects', () => projects.POST(json({ name: 'x' }))],
    ['DELETE /api/projects/[id]', () => project.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), ctx(id))],
    ['POST duplicate', () => duplicate.POST(json({}), ctx(id))],
    ['POST extract', () => extract.POST(json({}), ctx(id))],
    ['POST refine', () => refine.POST(json({}), ctx(id))],
    ['POST revisions', () => revisions.POST(json({ baseRevision: 0, patch: [{ op: 'replace', path: '/name', value: 'y' }], summary: 's' }), ctx(id))],
    ['POST undo', () => undo.POST(json({ action: 'undo', baseRevision: 0 }), ctx(id))],
    ['GET photo', () => photo.GET(new Request('http://localhost/x'), ctx(id, photoId))],
    ['PUT reference', () => reference.PUT(json({}), ctx(id, photoId))],
    ['DELETE reference', () => reference.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), ctx(id, photoId))],
    ['POST upload', () => upload.POST(new Request('http://localhost/x', { method: 'POST', body: form }))],
    ['GET export csv', () => csv.GET(new Request('http://localhost/x'), ctx(id))],
    ['GET export svg', () => svg.GET(new Request('http://localhost/x'), ctx(id))],
  ];
}

async function seedA() {
  const a = await createUser(db, 'a@example.com', 'a-good-password');
  const storage = await getStorageFor(a.id);
  const p = newProject({ name: "A's kitchen" });
  await storage.projects.insert(p);
  const ph = await addPhoto(storage, p.id, Buffer.from('jpeg'), { width: 1, height: 1 });
  return { p, ph };
}

describe('storage-backed API routes with auth on', () => {
  it('answer 401 JSON without a valid session', async () => {
    const { p, ph } = await seedA();
    for (const headers of [{}, { cookie: 'session=bogus' }, { 'x-user-id': randomUUID() }] as Record<string, string>[]) {
      state.headers = new Headers(headers);
      for (const [name, call] of calls(p.id, ph.id)) {
        const res = await call();
        expect(res.status, name).toBe(401);
        expect(await res.json(), name).toEqual({ error: 'Unauthorized' });
      }
    }
  });

  it("answer 404 for another user's project", async () => {
    const { p, ph } = await seedA();
    const b = await createUser(db, 'b@example.com', 'b-good-password');
    state.headers = new Headers({ cookie: `session=${await createSession(db, b.id)}` });
    for (const [name, call] of calls(p.id, ph.id)) {
      if (name === 'POST /api/projects') continue;
      const res = await call();
      expect(res.status, name).toBe(404);
    }
    expect(await (await getStorageFor(b.id)).projects.list()).toEqual([]);
    const still = await (await getStorageFor((await db.query.users.findFirst())!.id)).projects.load(p.id);
    expect(still?.name).toBe("A's kitchen");
  });
});
