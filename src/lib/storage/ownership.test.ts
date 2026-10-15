// @vitest-environment node
/**
 * Two users on one Postgres (PGlite): user B must never see, change, copy or
 * fetch photos of user A's projects — every miss looks like "not found".
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetTestDb, sharedTestDb } from '@/lib/db/test-db';
import type { Db } from '@/lib/db/types';
import { createUser } from '@/lib/auth/users';
import {
  addPhoto,
  deleteProject,
  duplicateAsOption,
  getStorageFor,
  lookupPhoto,
  newProject,
  optionGroup,
  ProjectNotFoundError,
  readPhoto,
  type Storage,
} from './index';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));

let db: Db;
let dir: string;
let a: Storage;
let b: Storage;

beforeAll(async () => {
  db = await sharedTestDb();
  state.db = db;
});
beforeEach(async () => {
  await resetTestDb(db);
  dir = mkdtempSync(join(tmpdir(), 'kd-ownership-'));
  vi.stubEnv('DATABASE_URL', 'postgres://test');
  vi.stubEnv('DATA_DIR', dir);
  vi.stubEnv('GCS_BUCKET', '');
  const ua = await createUser(db, 'a@example.com', 'a-good-password');
  const ub = await createUser(db, 'b@example.com', 'b-good-password');
  a = await getStorageFor(ua.id);
  b = await getStorageFor(ub.id);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function aProjectWithPhoto() {
  const p = newProject({ name: "A's kitchen" });
  await a.projects.insert(p);
  const photo = await addPhoto(a, p.id, Buffer.from('jpeg-of-a'), { width: 2, height: 1 });
  return { p, photo };
}

describe('owner-scoped storage', () => {
  it("lists only the caller's own projects", async () => {
    await aProjectWithPhoto();
    expect(await a.projects.list()).toHaveLength(1);
    expect(await b.projects.list()).toEqual([]);
  });

  it("B cannot load, update, remove or group A's project", async () => {
    const { p } = await aProjectWithPhoto();
    expect(await b.projects.load(p.id)).toBeNull();
    await expect(b.projects.update(p.id, (x) => ({ ...x, name: 'pwned' }))).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(await b.projects.remove(p.id)).toBe(false);
    expect(await deleteProject(b, p.id)).toBe(false);
    expect(await b.projects.group(p.id)).toEqual([]);
    expect(await optionGroup(b, p.id)).toEqual([]);
    // Untouched for A, photo bytes included.
    const still = await a.projects.load(p.id);
    expect(still?.name).toBe("A's kitchen");
    expect(await readPhoto(a, p.id, still!.photos[0])).not.toBeNull();
  });

  it("B cannot add a photo to A's project", async () => {
    const { p } = await aProjectWithPhoto();
    await expect(addPhoto(b, p.id, Buffer.from('x'), { width: 1, height: 1 })).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect((await a.projects.load(p.id))!.photos).toHaveLength(1);
  });

  it("B cannot insert over A's project id", async () => {
    const { p } = await aProjectWithPhoto();
    await expect(b.projects.insert({ ...p, name: 'hijack' })).rejects.toThrow();
    expect((await a.projects.load(p.id))!.name).toBe("A's kitchen");
    expect(await b.projects.list()).toEqual([]);
  });

  it("B cannot duplicate A's project as an option", async () => {
    const { p } = await aProjectWithPhoto();
    expect(await duplicateAsOption(b, p.id)).toBeNull();
    expect(await b.projects.list()).toEqual([]);
    expect(await a.projects.list()).toHaveLength(1);
    // A can.
    const copy = await duplicateAsOption(a, p.id);
    expect(copy?.optionOf).toBe(p.id);
    expect(await b.projects.load(copy!.id)).toBeNull();
    expect(await optionGroup(b, p.id)).toEqual([]);
    expect((await optionGroup(a, p.id)).map((x) => x.id)).toEqual([p.id, copy!.id]);
  });

  it("B cannot look up or read A's photos (404, not 403)", async () => {
    const { p, photo } = await aProjectWithPhoto();
    expect(await lookupPhoto(b, p.id, photo.id)).toEqual({ ok: false, status: 404, error: 'project not found' });
    const found = await lookupPhoto(a, p.id, photo.id);
    expect(found.ok).toBe(true);
    expect((await readPhoto(a, p.id, photo))?.toString()).toBe('jpeg-of-a');
  });

  it('A sees its own changes; B updating its own project leaves A alone', async () => {
    const { p } = await aProjectWithPhoto();
    const q = newProject({ name: "B's closet", kind: 'closet' });
    await b.projects.insert(q);
    await b.projects.update(q.id, (x) => ({ ...x, name: "B's renamed closet" }));
    expect((await a.projects.list()).map((s) => s.name)).toEqual(["A's kitchen"]);
    expect((await b.projects.list()).map((s) => s.name)).toEqual(["B's renamed closet"]);
    expect(await a.projects.load(q.id)).toBeNull();
    expect(await a.projects.remove(q.id)).toBe(false);
    expect(await b.projects.load(p.id)).toBeNull();
  });

  it('null-owner rows (import:local) are invisible to signed-in users', async () => {
    const orphans = await getStorageFor(null);
    const o = newProject({ name: 'orphan' });
    await orphans.projects.insert(o);
    expect(await a.projects.load(o.id)).toBeNull();
    expect(await a.projects.list()).toHaveLength(0);
    expect(await orphans.projects.load(o.id)).not.toBeNull();
  });
});
