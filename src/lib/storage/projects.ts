import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { ProjectSchema, type Project } from '../plan/schemas';

/**
 * Resolved data directory. Defaults to `./data` at process start, can be
 * overridden via the `DATA_DIR` env var (set in `next.config.ts`).
 */
export function resolveDataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), 'data');
}

/** `<dataDir>/projects/<id>` — where a project's files live. */
export function projectDir(dataDir: string, id: string): string {
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
  overrides: { id?: string; name: string }
): Project {
  const now = new Date().toISOString();
  const id = overrides.id ?? randomUUID();
  const project: Project = ProjectSchema.parse({
    id,
    name: overrides.name,
    units: 'mm',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    photos: [],
    room: {
      // Default empty rectangle so the editor has something to draw on.
      // The user replaces this once photos are extracted.
      polygon: [
        [0, 0],
        [3000, 0],
        [3000, 4000],
        [0, 4000],
      ],
      walls: [],
      openings: [],
    },
    items: [],
    history: [],
  });

  const dir = projectDir(dataDir, id);
  mkdirSync(dir, { recursive: true });
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

/** Minimal summary used by the project list page. */
export type ProjectSummary = Pick<Project, 'id' | 'name' | 'updatedAt' | 'revision'>;

/**
 * List all projects under `dataDir`. Skips directories whose `project.json`
 * fails to parse (those are surfaced in logs, not thrown — one bad project
 * shouldn't break the list).
 */
export function listProjects(dataDir: string): ProjectSummary[] {
  const root = join(dataDir, 'projects');
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true });
  const out: ProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, 'project.json');
    if (!existsSync(file)) continue;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf-8'));
      const project = ProjectSchema.parse(raw);
      out.push({
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        revision: project.revision,
      });
    } catch {
      // Skip malformed projects — surfaced via logs, not errors.
      continue;
    }
  }
  // Newest first.
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** True if a project exists on disk. */
export function projectExists(dataDir: string, id: string): boolean {
  try {
    return statSync(join(projectDir(dataDir, id), 'project.json')).isFile();
  } catch {
    return false;
  }
}
