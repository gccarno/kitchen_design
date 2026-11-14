// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newProject } from '../plan/new-project';
import { photoKey } from './ids';
import {
  addPhoto,
  deleteProject,
  duplicateAsOption,
  fsStorage,
  getStorage,
  lookupPhoto,
  MAX_PHOTOS,
  readPhoto,
  removePhoto,
  TooManyPhotosError,
  type BlobStore,
  type Storage,
} from './index';
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

  it('removes a photo: off the project, then its bytes; other photos stay', async () => {
    const p = newProject({ name: 'P' });
    await storage.projects.insert(p);
    const keep = await addPhoto(storage, p.id, Buffer.from('keep'), { width: 1, height: 1 });
    const drop = await addPhoto(storage, p.id, Buffer.from('drop'), { width: 1, height: 1 });
    expect(await removePhoto(storage, p.id, drop.id)).toEqual([keep]);
    expect((await storage.projects.load(p.id))!.photos).toEqual([keep]);
    expect(await storage.blobs.get(photoKey(p.id, drop.id))).toBeNull();
    expect((await storage.blobs.get(photoKey(p.id, keep.id)))?.toString()).toBe('keep');
  });

  it('removePhoto: null for a photo not listed on the project, which keeps its bytes', async () => {
    const p = newProject({ name: 'P' });
    await storage.projects.insert(p);
    const photo = await addPhoto(storage, p.id, Buffer.from('x'), { width: 1, height: 1 });
    expect(await removePhoto(storage, p.id, 'not-listed')).toBeNull();
    expect(await removePhoto(storage, newProject({ name: 'gone' }).id, photo.id)).toBeNull();
    expect((await storage.projects.load(p.id))!.photos).toEqual([photo]);
  });

  it('removePhoto still succeeds (and logs) when the bytes cannot be deleted', async () => {
    const p = newProject({ name: 'P' });
    await storage.projects.insert(p);
    const photo = await addPhoto(storage, p.id, Buffer.from('x'), { width: 1, height: 1 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const blobs: BlobStore = { ...storage.blobs, delete: async () => Promise.reject(new Error('gcs down')) };
    expect(await removePhoto({ ...storage, blobs }, p.id, photo.id)).toEqual([]);
    expect(errors.mock.calls.flat().join(' ')).toContain(p.id);
    errors.mockRestore();
  });

  it(`refuses a photo past MAX_PHOTOS (${MAX_PHOTOS}), and keeps no bytes for it`, async () => {
    const p = newProject({ name: 'P' });
    await storage.projects.insert(p);
    for (let i = 0; i < MAX_PHOTOS; i++) await addPhoto(storage, p.id, Buffer.from(`p${i}`), { width: 1, height: 1 });
    await expect(addPhoto(storage, p.id, Buffer.from('one too many'), { width: 1, height: 1 })).rejects.toBeInstanceOf(TooManyPhotosError);
    expect((await storage.projects.load(p.id))!.photos).toHaveLength(MAX_PHOTOS);
    expect(readdirSync(join(dir, 'projects', p.id, 'photos'))).toHaveLength(MAX_PHOTOS);
  });

  it('a duplicate that fails to save leaves no copied photos behind', async () => {
    const p = newProject({ name: 'P' });
    await storage.projects.insert(p);
    await addPhoto(storage, p.id, Buffer.from('x'), { width: 1, height: 1 });
    const projects = { ...storage.projects, insert: async () => Promise.reject(new Error('db down')), load: storage.projects.load.bind(storage.projects), group: storage.projects.group.bind(storage.projects) };
    await expect(duplicateAsOption({ ...storage, projects }, p.id)).rejects.toThrow('db down');
    expect(readdirSync(join(dir, 'projects')).sort()).toEqual([p.id]);
  });

  it('deleteProject reports (with the id) photos it could not delete, after removing the record', async () => {
    const p = newProject({ name: 'P' });
    await storage.projects.insert(p);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const blobs: BlobStore = { ...storage.blobs, deletePrefix: async () => Promise.reject(new Error('gcs down')) };
    expect(await deleteProject({ ...storage, blobs }, p.id)).toBe(true);
    expect(await storage.projects.load(p.id)).toBeNull();
    expect(errors.mock.calls.flat().join(' ')).toContain(p.id);
    errors.mockRestore();
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
