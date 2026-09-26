/**
 * Outcome of a check that can fail with human-readable issues. Shared by
 * LLM-response refinement and patch validation so callers handle both the
 * same way: `if (!r.ok) show(r.issues)`.
 */
export type CheckResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };
