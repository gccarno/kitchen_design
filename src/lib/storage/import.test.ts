// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetTestDb, sharedTestDb } from '../db/test-db';
import { newProject } from '../plan/new-project';
import { createFakeBucket } from './fake-bucket';
import { GcsBlobStore } from './gcs-blobs';
import { photoKey } from './ids';
import { importProjects } from './import';
import { addPhoto, fsStorage, type Storage } from './index';
import { PgProjectStore } from './pg-projects';

describe('importProjects (disk → Postgres + GCS)', () => {
  let dir: string;
  let source: Storage;
  let target: Storage;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'kd-import-'));
    source = fsStorage(dir);
    const db = await sharedTestDb();
    await resetTestDb(db);
    target = { projects: new PgProjectStore(db), blobs: new GcsBlobStore(createFakeBucket()) };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies projects with their photos, and skips ones already there on a second run', async () => {
    const a = newProject({ name: 'A' });
    const b = { ...newProject({ name: 'A — Option B' }), optionOf: a.id };
    await source.projects.insert(a);
    await source.projects.insert(b);
    const photo = await addPhoto(source, a.id, Buffer.from('jpeg'), { width: 2, height: 2 });

    const first = await importProjects(source, target);
    expect(first.imported.sort()).toEqual([a.id, b.id].sort());
    expect(await target.projects.load(a.id)).toEqual(await source.projects.load(a.id));
    expect((await target.blobs.get(photoKey(a.id, photo.id)))?.toString()).toBe('jpeg');

    const second = await importProjects(source, target);
    expect(second.imported).toEqual([]);
    expect(second.skipped.sort()).toEqual([a.id, b.id].sort());
  });

  it('reports a listed photo whose file is missing, and still imports the project', async () => {
    const a = newProject({ name: 'A' });
    await source.projects.insert({ ...a, photos: [{ id: 'gone', path: 'photos/gone.jpg', width: 1, height: 1 }] });
    const report = await importProjects(source, target);
    expect(report.imported).toEqual([a.id]);
    expect(report.missingPhotos).toEqual([`${a.id}/gone`]);
  });

  it('writes nothing on a dry run', async () => {
    const a = newProject({ name: 'A' });
    await source.projects.insert(a);
    const report = await importProjects(source, target, { dryRun: true });
    expect(report.imported).toEqual([a.id]);
    expect(await target.projects.load(a.id)).toBeNull();
  });
});
