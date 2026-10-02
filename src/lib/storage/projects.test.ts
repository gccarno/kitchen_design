import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectSchema, type Project } from '../plan/schemas';
import {
  createProject,
  loadProject,
  saveProject,
  listProjects,
  deleteProject,
  projectExists,
  projectDir,
  atomicWriteJson,
  updateProject,
  InvalidProjectIdError,
} from './projects';
import { validatePlan } from '../plan/validate';

const SOME_UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

// Minimal but valid project; tests can mutate freely.
function newProject(overrides: Partial<Project> = {}): Project {
  const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
  return ProjectSchema.parse({
    id: 'test-id',
    name: 'Test Project',
    units: 'mm',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    photos: [],
    room: {
      polygon: [[0, 0], [3000, 0], [3000, 4000], [0, 4000]],
      walls: [],
      openings: [],
    },
    items: [],
    history: [],
    ...overrides,
  });
}

describe('project storage', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-storage-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('atomicWriteJson', () => {
    it('writes a JSON file and creates parent directories', () => {
      const target = join(dataDir, 'nested', 'file.json');
      atomicWriteJson(target, { hello: 'world' });
      expect(existsSync(target)).toBe(true);
      expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ hello: 'world' });
    });

    it('does not leave a temp file behind on success', () => {
      const target = join(dataDir, 'file.json');
      atomicWriteJson(target, { a: 1 });
      expect(existsSync(`${target}.tmp`)).toBe(false);
    });

    it('overwrites an existing file atomically', () => {
      const target = join(dataDir, 'file.json');
      writeFileSync(target, '{"old":true}');
      atomicWriteJson(target, { new: true });
      expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ new: true });
    });
  });

  describe('projectDir', () => {
    it('returns dataDir/projects/<id>', () => {
      expect(projectDir(dataDir, SOME_UUID)).toBe(join(dataDir, 'projects', SOME_UUID));
    });

    it.each(['abc', '../../etc', '..', `${SOME_UUID}/../x`, '', 'C:\Windows'])(
      'rejects non-UUID id %j (path traversal guard)',
      (id) => {
        expect(() => projectDir(dataDir, id)).toThrow(InvalidProjectIdError);
      }
    );
  });

  describe('createProject', () => {
    it('writes project.json and creates a photos/ subdir', () => {
      const p = createProject(dataDir, { name: 'Hello' });
      const dir = projectDir(dataDir, p.id);
      expect(existsSync(join(dir, 'project.json'))).toBe(true);
      expect(existsSync(join(dir, 'photos'))).toBe(true);
    });

    it('starts with a room that passes validatePlan (one wall per edge)', () => {
      const p = createProject(dataDir, { name: 'Valid room' });
      expect(p.room.walls).toHaveLength(p.room.polygon.length);
      expect(validatePlan(p).valid).toBe(true);
    });

    it('rejects a non-UUID id override', () => {
      expect(() => createProject(dataDir, { id: '../escape', name: 'X' })).toThrow(InvalidProjectIdError);
    });

    it('returns a project with a unique id and zero revision', () => {
      const a = createProject(dataDir, { name: 'A' });
      const b = createProject(dataDir, { name: 'B' });
      expect(a.id).not.toEqual(b.id);
      expect(a.revision).toBe(0);
      expect(a.history).toEqual([]);
    });
  });

  describe('loadProject', () => {
    it('round-trips a project through create + load', () => {
      const created = createProject(dataDir, { name: 'Round trip' });
      const loaded = loadProject(dataDir, created.id);
      expect(loaded.id).toBe(created.id);
      expect(loaded.name).toBe('Round trip');
    });

    it('throws when the project does not exist', () => {
      expect(() => loadProject(dataDir, SOME_UUID)).toThrow(/not found/);
    });

    it('throws when the stored JSON fails schema validation', () => {
      const p = createProject(dataDir, { name: 'Bad' });
      writeFileSync(join(projectDir(dataDir, p.id), 'project.json'), '{"oops":true}');
      expect(() => loadProject(dataDir, p.id)).toThrow();
    });
  });

  describe('saveProject', () => {
    it('persists changes so loadProject reflects them', () => {
      const p = createProject(dataDir, { name: 'Original' });
      const updated: Project = { ...p, name: 'Renamed', revision: 1 };
      saveProject(dataDir, updated);
      const loaded = loadProject(dataDir, p.id);
      expect(loaded.name).toBe('Renamed');
      expect(loaded.revision).toBe(1);
    });
  });

  describe('updateProject', () => {
    it('loads, applies the updater, and saves', async () => {
      const p = createProject(dataDir, { name: 'Before' });
      const out = await updateProject(dataDir, p.id, (cur) => ({ ...cur, name: 'After' }));
      expect(out.name).toBe('After');
      expect(loadProject(dataDir, p.id).name).toBe('After');
    });

    it('serializes concurrent updates so none are lost', async () => {
      const p = createProject(dataDir, { name: 'Concurrent' });
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          updateProject(dataDir, p.id, async (cur) => {
            // Yield so updates would interleave without the lock.
            await new Promise((r) => setTimeout(r, 1));
            return {
              ...cur,
              photos: [...cur.photos, { id: `ph${i}`, path: `photos/ph${i}.jpg`, width: 10, height: 10 }],
            };
          })
        )
      );
      expect(loadProject(dataDir, p.id).photos).toHaveLength(20);
    });

    it('does not save and releases the lock when the updater throws', async () => {
      const p = createProject(dataDir, { name: 'Keep' });
      await expect(
        updateProject(dataDir, p.id, () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
      expect(loadProject(dataDir, p.id).name).toBe('Keep');
      const out = await updateProject(dataDir, p.id, (cur) => ({ ...cur, name: 'Next' }));
      expect(out.name).toBe('Next');
    });
  });

  describe('deleteProject', () => {
    it('removes the project and its photos, and leaves other projects alone', async () => {
      const a = createProject(dataDir, { name: 'A' });
      const b = createProject(dataDir, { name: 'B' });
      writeFileSync(join(projectDir(dataDir, a.id), 'photos', 'x.jpg'), 'x');
      expect(await deleteProject(dataDir, a.id)).toBe(true);
      expect(projectExists(dataDir, a.id)).toBe(false);
      expect(existsSync(projectDir(dataDir, a.id))).toBe(false);
      expect(listProjects(dataDir).map((p) => p.id)).toEqual([b.id]);
    });

    it('returns false for a project that does not exist, and rejects bad ids', async () => {
      expect(await deleteProject(dataDir, '00000000-0000-4000-8000-000000000000')).toBe(false);
      await expect(deleteProject(dataDir, '../x')).rejects.toThrow(/invalid project id/);
    });

    it('waits for a write in flight instead of racing it', async () => {
      const p = createProject(dataDir, { name: 'A' });
      let release!: () => void;
      const slow = updateProject(dataDir, p.id, (cur) => new Promise((res) => (release = () => res({ ...cur, name: 'late' }))));
      const del = deleteProject(dataDir, p.id);
      await new Promise((r) => setTimeout(r, 20));
      expect(projectExists(dataDir, p.id)).toBe(true); // still waiting its turn
      release();
      await slow;
      expect(await del).toBe(true);
      expect(projectExists(dataDir, p.id)).toBe(false);
    });
  });

  describe('listProjects', () => {
    it('returns summaries of all projects in dataDir, newest first', () => {
      const a = createProject(dataDir, { name: 'A' });
      const b = createProject(dataDir, { name: 'B' });
      const list = listProjects(dataDir);
      const ids = list.map((x) => x.id);
      expect(ids).toContain(a.id);
      expect(ids).toContain(b.id);
      expect(list[0]).toEqual(
        expect.objectContaining({ name: expect.any(String), id: expect.any(String) })
      );
    });

    it('includes the room and items, for thumbnails', () => {
      const p = createProject(dataDir, { name: 'A' });
      expect(listProjects(dataDir)[0]).toMatchObject({ id: p.id, room: p.room, items: [] });
    });

    it('skips directories without a valid project.json', () => {
      createProject(dataDir, { name: 'Valid' });
      // Inject a junk project dir.
      const junk = join(dataDir, 'projects', 'junk');
      const { mkdirSync } = require('node:fs') as typeof import('node:fs');
      mkdirSync(junk, { recursive: true });
      writeFileSync(join(junk, 'project.json'), 'not json');
      const list = listProjects(dataDir);
      expect(list.every((p) => p.id !== 'junk')).toBe(true);
    });
  });
});
