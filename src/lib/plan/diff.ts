/**
 * JSON Patch diff/apply for plan revisions.
 *
 * Every LLM-proposed edit to a project is a sequence of RFC 6902 ops.
 * The user sees a diff, confirms, and the patch is applied — never auto.
 *
 * The library does not produce an algorithmic diff (we already have full
 * before/after objects). `planToJsonPatch` walks the structure and emits
 * the minimum set of ops to transform before into after.
 *
 * `applyJsonPatch` is strict: it deep-clones the input, applies the ops
 * via `fast-json-patch`, then re-validates against `ProjectSchema`. A
 * patch that produces an invalid project throws — the caller is expected
 * to surface this as a "could not apply" error, never silently corrupt state.
 */

import {
  applyPatch as fjpApply,
  compare as fjpCompare,
  type Operation as FjpOp,
} from 'fast-json-patch';
import { ProjectSchema, type JsonPatchOp, type Project } from './schemas';

export type { JsonPatchOp } from './schemas';

export interface RefineResult<T> {
  ok: boolean;
  value?: T;
  issues: string[];
}

/**
 * Produce the minimum RFC 6902 patch transforming `before` into `after`.
 * Walks the two trees in lockstep; arrays and objects are compared
 * element-wise. Missing/extra keys become add/remove.
 */
export function planToJsonPatch(before: Project, after: Project): JsonPatchOp[] {
  const raw = fjpCompare(before as unknown as object, after as unknown as object);
  return raw.map(fjpToOur).filter((op): op is JsonPatchOp => op !== null);
}

function fjpToOur(op: FjpOp): JsonPatchOp | null {
  // fast-json-patch types `value` as `any` and `from` as optional. We
  // tighten this to the JSON-Patch subset our Zod schema accepts.
  switch (op.op) {
    case 'add':
    case 'replace':
    case 'test':
      return { op: op.op, path: op.path, value: op.value };
    case 'remove':
      return { op: 'remove', path: op.path };
    case 'move':
      return { op: 'move', path: op.path, from: op.from };
    case 'copy':
      return { op: 'copy', path: op.path, from: op.from };
    default:
      return null;
  }
}

/**
 * Apply a patch to a project. Returns a new project; the input is not
 * mutated. Throws on:
 *   - patch application error (bad path, type mismatch, etc.)
 *   - post-application schema validation failure
 */
export function applyJsonPatch(before: Project, patch: JsonPatchOp[]): Project {
  const cloned = structuredClone(before);
  const raw: FjpOp[] = patch.map(oursToFjp);
  const result = fjpApply(cloned as unknown as object, raw, /*validate*/ true, /*mutate*/ false);
  const next = result.newDocument as unknown as Project;
  return ProjectSchema.parse(next);
}

function oursToFjp(op: JsonPatchOp): FjpOp {
  // Re-shape our stricter shape to fast-json-patch's looser one.
  const base: FjpOp = { op: op.op, path: op.path } as FjpOp;
  if ('value' in op && op.value !== undefined) {
    (base as FjpOp & { value: unknown }).value = op.value;
  }
  if ('from' in op && op.from !== undefined) {
    (base as FjpOp & { from: string }).from = op.from;
  }
  return base;
}

/**
 * Validate a patch against a project WITHOUT mutating the project. The
 * patch is applied to a deep clone, then the result is checked against
 * `ProjectSchema`. Returns a `RefineResult` so callers can show issues
 * to the user before they confirm.
 */
export function validatePatchOnProject(
  before: Project,
  patch: JsonPatchOp[]
): RefineResult<Project> {
  const issues: string[] = [];
  try {
    const result = applyJsonPatch(before, patch);
    return { ok: true, value: result, issues: [] };
  } catch (err) {
    issues.push((err as Error).message);
    return { ok: false, issues };
  }
}

/**
 * Produce a one-line, human-readable summary of a patch for the
 * confirmation UI. Heuristic, not exhaustive — the goal is to give
 * the user a fast "what's about to change" glance, not a full diff.
 */
export function summarizePatch(patch: JsonPatchOp[]): string {
  if (patch.length === 0) return 'no changes';

  // Group by top-level path to pick a single dominant intent.
  const first = patch[0];
  const path = first.path;

  if (path === '/name') return `rename project to "${first.value ?? ''}"`;

  if (path.startsWith('/items/')) {
    if (first.op === 'add') return 'add a placed item';
    if (first.op === 'remove') return 'remove a placed item';
    return 'update a placed item';
  }

  if (path.startsWith('/room/polygon')) {
    return 'resize the room';
  }

  if (path.startsWith('/room/walls')) {
    if (first.op === 'add') return 'add a wall';
    if (first.op === 'remove') return 'remove a wall';
    return 'update a wall';
  }

  if (path.startsWith('/room/openings')) {
    if (first.op === 'add') return 'add a door or window';
    if (first.op === 'remove') return 'remove a door or window';
    return 'update a door or window';
  }

  // Fallback: describe by op count and top path.
  if (patch.length === 1) {
    return `${first.op} ${path}`;
  }
  return `${patch.length} changes (first: ${first.op} ${path})`;
}
