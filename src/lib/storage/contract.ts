/**
 * Behaviour every ProjectStore / BlobStore must have. Each implementation's
 * test file calls these with a setup function, so the disk, Postgres and GCS
 * backends are held to exactly the same rules.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { newProject } from '../plan/new-project';
import type { Project } from '../plan/schemas';
import { ProjectNotFoundError, type BlobStore, type ProjectStore } from './store';

export type Setup<T> = () => Promise<{ store: T; teardown?: () => Promise<void> }>;

const at = (p: Project, updatedAt: string): Project => ({ ...p, updatedAt });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function describeProjectStore(name: string, setup: Setup<ProjectStore>): void {
  describe(`ProjectStore contract: ${name}`, () => {
    let store: ProjectStore;
    let teardown: (() => Promise<void>) | undefined;
    beforeEach(async () => {
      ({ store, teardown } = await setup());
    });
    afterEach(async () => {
      await teardown?.();
    });

    it('loads what was inserted', async () => {
      const p = newProject({ name: 'Kitchen' });
      await store.insert(p);
      expect(await store.load(p.id)).toEqual(p);
    });

    it('loads null for an unknown id or one that is not a UUID', async () => {
      expect(await store.load(randomUUID())).toBeNull();
      expect(await store.load('../../etc/passwd')).toBeNull();
    });

    it('refuses to insert a taken id or a non-UUID id', async () => {
      const p = newProject({ name: 'A' });
      await store.insert(p);
      await expect(store.insert(p)).rejects.toThrow();
      await expect(store.insert({ ...newProject({ name: 'B' }), id: 'not-a-uuid' })).rejects.toThrow();
    });

    it('updates and returns the saved project', async () => {
      const p = newProject({ name: 'Old' });
      await store.insert(p);
      const next = await store.update(p.id, (cur) => ({ ...cur, name: 'New', revision: cur.revision + 1 }));
      expect(next).toMatchObject({ name: 'New', revision: 1 });
      expect(await store.load(p.id)).toEqual(next);
    });

    it('saves nothing when the update throws', async () => {
      const p = newProject({ name: 'Keep' });
      await store.insert(p);
      await expect(
        store.update(p.id, () => {
          throw new Error('nope');
        })
      ).rejects.toThrow('nope');
      expect(await store.load(p.id)).toEqual(p);
    });

    it('rejects an update of an unknown project with ProjectNotFoundError', async () => {
      await expect(store.update(randomUUID(), (p) => p)).rejects.toBeInstanceOf(ProjectNotFoundError);
      await expect(store.update('not-a-uuid', (p) => p)).rejects.toBeInstanceOf(ProjectNotFoundError);
    });

    it('runs concurrent updates one after another, so none is lost', async () => {
      const p = newProject({ name: 'Photos' });
      await store.insert(p);
      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          store.update(p.id, async (cur) => {
            await pause(5);
            return { ...cur, photos: [...cur.photos, { id: `ph${i}`, path: `photos/ph${i}.jpg`, width: 10, height: 10 }] };
          })
        )
      );
      expect((await store.load(p.id))!.photos.map((ph) => ph.id).sort()).toEqual(['ph0', 'ph1', 'ph2', 'ph3', 'ph4']);
    });

    it('removes a project, and reports false for one that is not there', async () => {
      const p = newProject({ name: 'Gone' });
      await store.insert(p);
      expect(await store.remove(p.id)).toBe(true);
      expect(await store.load(p.id)).toBeNull();
      expect(await store.remove(p.id)).toBe(false);
      expect(await store.remove('not-a-uuid')).toBe(false);
    });

    it('lists summaries newest first, without history', async () => {
      await store.insert(at(newProject({ name: 'Older' }), '2026-01-01T00:00:00.000Z'));
      await store.insert(at(newProject({ name: 'Newer', kind: 'closet' }), '2026-02-01T00:00:00.000Z'));
      const list = await store.list();
      expect(list.map((s) => s.name)).toEqual(['Newer', 'Older']);
      expect(list[0]).not.toHaveProperty('history');
      expect(list[0].kind).toBe('closet');
      expect(list[0].closet).toBeTruthy();
    });

    it('finds an option group: the original and its options, nothing else', async () => {
      const original = newProject({ name: 'Kitchen' });
      const option = { ...newProject({ name: 'Kitchen — Option B' }), optionOf: original.id };
      const other = newProject({ name: 'Bathroom' });
      for (const p of [original, option, other]) await store.insert(p);
      const group = await store.group(original.id);
      expect(group.map((p) => p.name).sort()).toEqual(['Kitchen', 'Kitchen — Option B']);
      expect(await store.group(randomUUID())).toEqual([]);
    });
  });
}

export function describeBlobStore(name: string, setup: Setup<BlobStore>): void {
  describe(`BlobStore contract: ${name}`, () => {
    let store: BlobStore;
    let teardown: (() => Promise<void>) | undefined;
    beforeEach(async () => {
      ({ store, teardown } = await setup());
    });
    afterEach(async () => {
      await teardown?.();
    });

    const A = 'projects/p1/photos/a.jpg';

    it('round-trips bytes, and a second put overwrites', async () => {
      await store.put(A, Buffer.from('one'), 'image/jpeg');
      expect((await store.get(A))?.toString()).toBe('one');
      await store.put(A, Buffer.from('two'), 'image/jpeg');
      expect((await store.get(A))?.toString()).toBe('two');
    });

    it('gets null for a missing key', async () => {
      expect(await store.get('projects/p1/photos/missing.jpg')).toBeNull();
    });

    it('deletes a key; deleting a missing key is fine', async () => {
      await store.put(A, Buffer.from('x'), 'image/jpeg');
      await store.delete(A);
      expect(await store.get(A)).toBeNull();
      await expect(store.delete(A)).resolves.toBeUndefined();
    });

    it('deletes everything under a prefix and nothing beside it', async () => {
      await store.put('projects/p1/photos/a.jpg', Buffer.from('a'), 'image/jpeg');
      await store.put('projects/p1/photos/b.jpg', Buffer.from('b'), 'image/jpeg');
      await store.put('projects/p10/photos/c.jpg', Buffer.from('c'), 'image/jpeg');
      await store.deletePrefix('projects/p1/');
      expect(await store.get('projects/p1/photos/a.jpg')).toBeNull();
      expect(await store.get('projects/p1/photos/b.jpg')).toBeNull();
      expect((await store.get('projects/p10/photos/c.jpg'))?.toString()).toBe('c');
      await expect(store.deletePrefix('projects/nothing-here/')).resolves.toBeUndefined();
    });

    it('copies a blob, and reports false when the source is missing', async () => {
      await store.put(A, Buffer.from('copy me'), 'image/jpeg');
      expect(await store.copy(A, 'projects/p2/photos/a.jpg')).toBe(true);
      expect((await store.get('projects/p2/photos/a.jpg'))?.toString()).toBe('copy me');
      expect(await store.copy('projects/p1/photos/none.jpg', 'projects/p2/photos/none.jpg')).toBe(false);
      expect(await store.get('projects/p2/photos/none.jpg')).toBeNull();
    });
  });
}
