import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidProjectId, projectExists, resolveDataDir, updateProject } from '@/lib/storage/projects';
import { commitRevision, InvalidPatchError, StaleRevisionError } from '@/lib/plan/diff';
import { JsonPatchOpSchema, SUMMARY_MAX_LENGTH } from '@/lib/plan/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const CommitSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  // An empty patch would only add a no-op entry to the undo history.
  patch: z.array(JsonPatchOpSchema).min(1),
  summary: z.string().max(SUMMARY_MAX_LENGTH),
  /** Who proposed the edit. The user has confirmed it either way. */
  source: z.enum(['user', 'llm']).default('user'),
});

/**
 * POST /api/projects/[id]/revisions — JSON body { baseRevision, patch, summary, source? }.
 *
 * The one write path for plan edits: runs `commitRevision` under the
 * project lock, so the stale check and the save are atomic.
 *   200 { project }                     committed
 *   400 { error }                       malformed body or invalid edit
 *   404 { error }                       unknown project
 *   409 { error, currentRevision }      baseRevision is stale — re-propose
 */
export async function POST(req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 });
  const dataDir = resolveDataDir();
  if (!projectExists(dataDir, id)) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }
  const input = CommitSchema.safeParse(body);
  if (!input.success) {
    const error = input.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return NextResponse.json({ error }, { status: 400 });
  }
  const { baseRevision, patch, summary, source } = input.data;

  try {
    const project = await updateProject(dataDir, id, (current) =>
      commitRevision(current, patch, { baseRevision, source, summary })
    );
    return NextResponse.json({ project });
  } catch (err) {
    if (err instanceof StaleRevisionError) {
      return NextResponse.json({ error: err.message, currentRevision: err.currentRevision }, { status: 409 });
    }
    if (err instanceof InvalidPatchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
