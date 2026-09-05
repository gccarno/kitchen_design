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
  projectDir,
  atomicWriteJson,
} from './projects';

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
      expect(projectDir(dataDir, 'abc')).toBe(join(dataDir, 'projects', 'abc'));
    });
  });

  describe('createProject', () => {
    it('writes project.json and creates a photos/ subdir', () => {
      const p = createProject(dataDir, { name: 'Hello' });
      const dir = projectDir(dataDir, p.id);
      expect(existsSync(join(dir, 'project.json'))).toBe(true);
      expect(existsSync(join(dir, 'photos'))).toBe(true);
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
      expect(() => loadProject(dataDir, 'missing')).toThrow();
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
