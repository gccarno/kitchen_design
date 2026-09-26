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
 * `applyJsonPatch` is strict: it only accepts ops on editable paths
 * (`/name`, `/room/**`, `/items/**`), deep-clones the input, applies the ops
 * via `fast-json-patch`, then re-validates against `ProjectSchema`. A
 * patch that produces an invalid project throws — the caller is expected
 * to surface this as a "could not apply" error, never silently corrupt state.
 *
 * `commitRevision` is the one way an edit becomes a new revision: it checks
 * `baseRevision`, applies, runs `validatePlan`, and appends a history entry
 * carrying the inverse patch for undo.
 */

import {
  applyPatch as fjpApply,
  compare as fjpCompare,
  type Operation as FjpOp,
} from 'fast-json-patch';
import type { CheckResult } from '../result';
import { ProjectSchema, type JsonPatchOp, type PlanRevision, type Project } from './schemas';
import { validatePlan } from './validate';

export type { JsonPatchOp } from './schemas';

/** Maximum history entries kept on a project; the oldest are dropped. */
export const HISTORY_LIMIT = 200;

/** Top-level fields a patch may touch. Everything else is server-managed. */
const EDITABLE_ROOTS = ['/name', '/room', '/items'];

function isEditablePath(path: string): boolean {
  return EDITABLE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

/** Thrown when a proposal was made against an older revision of the project. */
export class StaleRevisionError extends Error {
  constructor(
    readonly baseRevision: number,
    readonly currentRevision: number
  ) {
    super(`plan changed since this edit was proposed (base revision ${baseRevision}, now ${currentRevision})`);
    this.name = 'StaleRevisionError';
  }
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
 * Thrown by `commitRevision` when the edit itself is bad (non-editable path,
 * patch doesn't apply, result fails schema or `validatePlan`) — as opposed
 * to a storage or programming error. Routes map it to 400.
 */
export class InvalidPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPatchError';
  }
}

/**
 * Apply a patch to a project. Returns a new project; the input is not
 * mutated. Throws on:
 *   - an op whose `path` or `from` is outside the editable allowlist
 *   - patch application error (bad path, type mismatch, etc.)
 *   - post-application schema validation failure
 */
export function applyJsonPatch(before: Project, patch: JsonPatchOp[]): Project {
  for (const op of patch) {
    for (const p of [op.path, op.from]) {
      if (p !== undefined && !isEditablePath(p)) {
        throw new Error(`patch op "${op.op}" targets non-editable path "${p}"`);
      }
    }
  }
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
 * `ProjectSchema`. Returns a `CheckResult` so callers can show issues
 * to the user before they confirm.
 */
export function validatePatchOnProject(before: Project, patch: JsonPatchOp[]): CheckResult<Project> {
  try {
    return { ok: true, value: applyJsonPatch(before, patch) };
  } catch (err) {
    return { ok: false, issues: [(err as Error).message] };
  }
}

export interface CommitOptions {
  /** Revision the patch was proposed against. */
  baseRevision: number;
  source: PlanRevision['source'];
  summary: string;
  /** ISO timestamp; defaults to now. */
  at?: string;
}

/**
 * Apply `patch` as a new revision. Throws `StaleRevisionError` if the
 * project has moved past `baseRevision`, and `InvalidPatchError` if the patch
 * can't be applied or the result fails `validatePlan`. Returns the new
 * project; the input is not mutated.
 */
export function commitRevision(before: Project, patch: JsonPatchOp[], opts: CommitOptions): Project {
  if (before.revision !== opts.baseRevision) {
    throw new StaleRevisionError(opts.baseRevision, before.revision);
  }
  let applied: Project;
  try {
    applied = applyJsonPatch(before, patch);
  } catch (err) {
    throw new InvalidPatchError((err as Error).message);
  }
  const check = validatePlan(applied);
  if (!check.valid) {
    throw new InvalidPatchError(`edit would leave the plan invalid: ${check.errors.join('; ')}`);
  }

  // `applied` differs from `before` only on editable paths, so the reverse
  // diff is a valid (allowlisted) undo patch.
  const inverse = planToJsonPatch(applied, before);
  const at = opts.at ?? new Date().toISOString();
  const revision = before.revision + 1;
  const entry: PlanRevision = { revision, patch, inverse, at, source: opts.source, summary: opts.summary };

  return ProjectSchema.parse({
    ...applied,
    revision,
    updatedAt: at,
    history: [...before.history, entry].slice(-HISTORY_LIMIT),
  });
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
