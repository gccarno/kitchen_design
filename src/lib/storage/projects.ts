import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { closetFootprint, newCloset } from '../closet/catalog';
import { groupName, nextOptionName, optionGroupId, sortGroup } from '../plan/options';
import { ProjectSchema, projectKind, type Project, type ProjectKind } from '../plan/schemas';

/**
 * Resolved data directory. Defaults to `./data` at process start, can be
 * overridden via the `DATA_DIR` env var (set in `next.config.ts`).
 */
export function resolveDataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), 'data');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown for any project id that is not a UUID — the path-traversal guard. */
export class InvalidProjectIdError extends Error {
  constructor(id: string) {
    super(`invalid project id: ${JSON.stringify(id)}`);
    this.name = 'InvalidProjectIdError';
  }
}

export function isValidProjectId(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * `<dataDir>/projects/<id>` — where a project's files live. Every path into
 * project storage goes through here, so `id` (often from a request) is
 * validated as a UUID before it can reach the filesystem.
 */
export function projectDir(dataDir: string, id: string): string {
  if (!isValidProjectId(id)) throw new InvalidProjectIdError(id);
  return join(dataDir, 'projects', id);
}

/**
 * Write a JSON file atomically: write to `<path>.tmp`, fsync, then rename
 * over the target. The rename is atomic on the same filesystem, so readers
 * never see a half-written file.
 */
export function atomicWriteJson(target: string, value: unknown): void {
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, target);
}

/** Create a fresh project on disk and return it. */
export function createProject(
  dataDir: string,
  overrides: { id?: string; name: string; kind?: ProjectKind }
): Project {
  const now = new Date().toISOString();
  const id = overrides.id ?? randomUUID();
  const dir = projectDir(dataDir, id);
  const kind = overrides.kind ?? 'kitchen';
  const closet = kind === 'closet' ? newCloset() : undefined;
  const project: Project = ProjectSchema.parse({
    id,
    name: overrides.name,
    kind,
    units: 'mm',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    photos: [],
    room: {
      // Kitchens start as a 3m × 4m rectangle so the editor has something to
      // draw on; the user replaces it once photos are extracted or the room
      // is sketched. A closet's room is just its footprint.
      polygon: closet
        ? closetFootprint(closet)
        : [
            [0, 0],
            [3000, 0],
            [3000, 4000],
            [0, 4000],
          ],
      walls: Array.from({ length: 4 }, () => ({ id: randomUUID(), thicknessMm: 100 })),
      openings: [],
    },
    items: [],
    ...(closet ? { closet } : {}),
    history: [],
  });

  mkdirSync(join(dir, 'photos'), { recursive: true });
  atomicWriteJson(join(dir, 'project.json'), project);
  return project;
}

/** Load a project from disk and validate it against the schema. */
export function loadProject(dataDir: string, id: string): Project {
  const file = join(projectDir(dataDir, id), 'project.json');
  if (!existsSync(file)) {
    throw new Error(`Project not found: ${id}`);
  }
  const raw = JSON.parse(readFileSync(file, 'utf-8'));
  return ProjectSchema.parse(raw);
}

/** Persist a project. Caller is responsible for bumping `revision`/`updatedAt`. */
export function saveProject(dataDir: string, project: Project): void {
  // Re-validate to guarantee on-disk integrity.
  const validated = ProjectSchema.parse(project);
  const dir = projectDir(dataDir, validated.id);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'photos'), { recursive: true });
  atomicWriteJson(join(dir, 'project.json'), validated);
}

// Per-project write queue. Kept on globalThis so every Next.js route bundle
// in this process shares one queue per project.
const LOCKS_KEY = Symbol.for('kitchen-design.projectLocks');
function projectLocks(): Map<string, Promise<unknown>> {
  const g = globalThis as typeof globalThis & { [LOCKS_KEY]?: Map<string, Promise<unknown>> };
  return (g[LOCKS_KEY] ??= new Map());
}

/**
 * Load → update → save under a per-project lock, so concurrent writers
 * (e.g. parallel photo uploads) can't overwrite each other's changes.
 * If `update` throws, nothing is saved and the error propagates.
 * In-process only — fine for the single-user local app.
 */
export async function updateProject(
  dataDir: string,
  id: string,
  update: (current: Project) => Project | Promise<Project>
): Promise<Project> {
  return withProjectLock(dataDir, id, async () => {
    const next = await update(loadProject(dataDir, id));
    saveProject(dataDir, next);
    return next;
  });
}

/** Run `task` after every earlier write to the project has finished. */
async function withProjectLock<T>(dataDir: string, id: string, task: () => Promise<T>): Promise<T> {
  const key = projectDir(dataDir, id);
  const locks = projectLocks();
  const run = (locks.get(key) ?? Promise.resolve()).then(task);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/**
 * Delete a project and all its files (photos included), after any write in
 * flight has finished. Permanent: there is no trash. Returns false if the
 * project didn't exist.
 */
export async function deleteProject(dataDir: string, id: string): Promise<boolean> {
  return withProjectLock(dataDir, id, async () => {
    if (!projectExists(dataDir, id)) return false;
    rmSync(projectDir(dataDir, id), { recursive: true, force: true });
    return true;
  });
}

/** What the project list page shows: name, last change, option link, and enough of the plan to draw a thumbnail. */
export type ProjectSummary = Pick<
  Project,
  'id' | 'name' | 'kind' | 'createdAt' | 'updatedAt' | 'revision' | 'room' | 'items' | 'closet' | 'optionOf'
>;

/**
 * Every project under `dataDir` that parses. Malformed ones are skipped
 * (surfaced via logs, not thrown — one bad project shouldn't break a list).
 */
function loadAll(dataDir: string): Project[] {
  const root = join(dataDir, 'projects');
  if (!existsSync(root)) return [];
  const out: Project[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, 'project.json');
    if (!existsSync(file)) continue;
    try {
      out.push(ProjectSchema.parse(JSON.parse(readFileSync(file, 'utf-8'))));
    } catch {
      // Skip malformed projects — surfaced via logs, not errors.
      continue;
    }
  }
  return out;
}

/** List all projects under `dataDir`, newest first. */
export function listProjects(dataDir: string): ProjectSummary[] {
  return loadAll(dataDir)
    .map((project) => ({
      id: project.id,
      name: project.name,
      kind: projectKind(project),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      revision: project.revision,
      room: project.room,
      items: project.items,
      ...(project.closet ? { closet: project.closet } : {}),
      ...(project.optionOf ? { optionOf: project.optionOf } : {}),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The projects in option group `groupId`: the original first (if it still exists), then its options oldest first. */
export function optionGroup(dataDir: string, groupId: string): Project[] {
  if (!isValidProjectId(groupId)) return [];
  return sortGroup(
    loadAll(dataDir).filter((p) => optionGroupId(p) === groupId),
    groupId
  );
}

/** Photo ids we generate; anything else in a hand-edited project.json could name a file elsewhere. */
export const PHOTO_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Copy a project as a new design option: a new id and a fresh history,
 * linked to its group's original by `optionOf`, named "<group> — Option <L>",
 * with its photo files copied. The source is not changed.
 */
export function duplicateAsOption(dataDir: string, sourceId: string): Project {
  const source = loadProject(dataDir, sourceId);
  const groupId = optionGroupId(source);
  const group = optionGroup(dataDir, groupId);
  const now = new Date().toISOString();
  const id = randomUUID();
  const { history: _history, ...rest } = source;
  const copy: Project = ProjectSchema.parse({
    ...rest,
    photos: source.photos.filter((photo) => PHOTO_ID.test(photo.id)),
    id,
    name: nextOptionName(groupName(group), group.map((p) => p.name)),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    optionOf: groupId,
    history: [],
  });

  const fromDir = join(projectDir(dataDir, source.id), 'photos');
  const toDir = join(projectDir(dataDir, id), 'photos');
  mkdirSync(toDir, { recursive: true });
  for (const photo of source.photos) {
    if (!PHOTO_ID.test(photo.id)) continue;
    const file = `${photo.id}.jpg`;
    if (existsSync(join(fromDir, file))) copyFileSync(join(fromDir, file), join(toDir, file));
  }
  atomicWriteJson(join(projectDir(dataDir, id), 'project.json'), copy);
  return copy;
}

/** True if a project exists on disk. */
export function projectExists(dataDir: string, id: string): boolean {
  try {
    return statSync(join(projectDir(dataDir, id), 'project.json')).isFile();
  } catch {
    return false;
  }
}
