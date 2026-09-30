import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidProjectId, projectExists, resolveDataDir, updateProject } from '@/lib/storage/projects';
import { InvalidPatchError, StaleRevisionError } from '@/lib/plan/diff';
import { NothingToUndoError, undoRedo } from '@/lib/plan/history';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const UndoSchema = z.object({
  action: z.enum(['undo', 'redo']),
  baseRevision: z.number().int().nonnegative(),
});

/**
 * POST /api/projects/[id]/undo — JSON body { action: 'undo' | 'redo', baseRevision }.
 *
 * Undoes the last change (or redoes the last undo) as a new revision,
 * under the project lock like POST .../revisions.
 *   200 { project }                     done
 *   400 { error }                       malformed body, nothing to undo/redo, or it no longer applies
 *   404 { error }                       unknown project
 *   409 { error, currentRevision }      baseRevision is stale — reload
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
  const input = UndoSchema.safeParse(body);
  if (!input.success) {
    const error = input.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return NextResponse.json({ error }, { status: 400 });
  }
  const { action, baseRevision } = input.data;

  try {
    const project = await updateProject(dataDir, id, (current) => undoRedo(current, action, baseRevision));
    return NextResponse.json({ project });
  } catch (err) {
    if (err instanceof StaleRevisionError) {
      return NextResponse.json({ error: err.message, currentRevision: err.currentRevision }, { status: 409 });
    }
    if (err instanceof NothingToUndoError || err instanceof InvalidPatchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
