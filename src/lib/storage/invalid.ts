import { ZodError } from 'zod';
import { reportError } from '../monitoring';

const reported = new Set<string>();

/**
 * A stored project that no longer parses was skipped (lists) — say so, so it can be
 * found and repaired. Logs only the id and where the document is wrong, never its
 * contents. Every skip is logged; Sentry hears about each project once per process.
 */
export function reportInvalidProject(projectId: string, err: unknown): void {
  const issues =
    err instanceof ZodError
      ? err.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`)
      : [err instanceof Error ? err.name : typeof err];
  console.error(JSON.stringify({ event: 'project_invalid', projectId, issues }));
  if (reported.has(projectId)) return;
  reported.add(projectId);
  // Not the original error: a ZodError's message can quote the bad values, and a JSON
  // SyntaxError quotes the file. Only its name travels.
  const synthetic = new Error('invalid project');
  synthetic.name = err instanceof Error ? err.name : 'InvalidProject';
  reportError(synthetic, { event: 'project_invalid', projectId, issues });
}
