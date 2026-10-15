// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newProject } from '../plan/new-project';
import { photoKey } from './ids';
import { addPhoto, deleteProject, fsStorage, getStorage, lookupPhoto, readPhoto, type BlobStore, type Storage } from './index';
import { FsProjectStore } from './fs-projects';

describe('storage service', () => {
  let dir: string;
  let storage: Storage;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kd-service-'));
    storage = fsStorage(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('adds a photo: bytes in the blob store, metadata on the project', async () => {
    const p = newProject({ name: 'P' });
    await storage.projects.insert(p);
    const photo = await addPhoto(storage, p.id, Buffer.from('jpeg'), { width: 4, height: 3 });
    expect(photo).toMatchObject({ path: `photos/${photo.id}.jpg`, width: 4, height: 3 });
    expect((await storage.projects.load(p.id))!.photos).toEqual([photo]);
    expect((await readPhoto(storage, p.id, photo))?.toString()).toBe('jpeg');
  });

  it('removes the uploaded bytes again when the project is gone', async () => {
    const inner = storage.blobs;
    const puts: string[] = [];
    const blobs: BlobStore = {
      put: (k, b, c) => {
        puts.push(k);
        return inner.put(k, b, c);
      },
      get: (k) => inner.get(k),
      delete: (k) => inner.delete(k),
      deletePrefix: (p) => inner.deletePrefix(p),
      copy: (a, b) => inner.copy(a, b),
    };
    const id = newProject({ name: 'never saved' }).id;
    await expect(addPhoto({ ...storage, blobs }, id, Buffer.from('jpeg'), { width: 1, height: 1 })).rejects.toThrow();
    expect(puts).toHaveLength(1);
    expect(await inner.get(puts[0])).toBeNull();
  });

  it('looks up only photos listed on the project', async () => {
    const p = newProject({ name: 'P' });
    await storage.projects.insert(p);
    const photo = await addPhoto(storage, p.id, Buffer.from('jpeg'), { width: 1, height: 1 });
    expect(await lookupPhoto(storage, p.id, photo.id)).toMatchObject({ ok: true, photo });
    expect(await lookupPhoto(storage, p.id, 'not-listed')).toEqual({ ok: false, status: 404, error: 'photo not found' });
    expect(await lookupPhoto(storage, 'bad', photo.id)).toEqual({ ok: false, status: 400, error: 'invalid project id' });
    expect(await lookupPhoto(storage, newProject({ name: 'x' }).id, photo.id)).toEqual({ ok: false, status: 404, error: 'project not found' });
  });

  it('treats a listed photo with a tampered id as not found', async () => {
    const p = { ...newProject({ name: 'P' }), photos: [{ id: '../evil', path: 'photos/x.jpg', width: 1, height: 1 }] };
    await storage.projects.insert(p);
    expect(await lookupPhoto(storage, p.id, '../evil')).toEqual({ ok: false, status: 404, error: 'photo not found' });
  });

  it('deletes a project with its photos, and nothing else', async () => {
    const a = newProject({ name: 'A' });
    const b = newProject({ name: 'B' });
    await storage.projects.insert(a);
    await storage.projects.insert(b);
    const pa = await addPhoto(storage, a.id, Buffer.from('a'), { width: 1, height: 1 });
    const pb = await addPhoto(storage, b.id, Buffer.from('b'), { width: 1, height: 1 });
    expect(await deleteProject(storage, a.id)).toBe(true);
    expect(await storage.projects.load(a.id)).toBeNull();
    expect(await storage.blobs.get(photoKey(a.id, pa.id))).toBeNull();
    expect((await storage.blobs.get(photoKey(b.id, pb.id)))?.toString()).toBe('b');
    expect(await deleteProject(storage, a.id)).toBe(false);
    expect(await deleteProject(storage, 'not-a-uuid')).toBe(false);
  });

  it('getStorage() uses the disk under DATA_DIR when DATABASE_URL is unset', async () => {
    process.env.DATA_DIR = dir;
    try {
      const s = await getStorage();
      expect(s.projects).toBeInstanceOf(FsProjectStore);
    } finally {
      delete process.env.DATA_DIR;
    }
  });
});
