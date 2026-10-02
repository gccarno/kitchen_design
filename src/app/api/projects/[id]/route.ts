import { NextResponse } from 'next/server';
import { deleteProject, isValidProjectId, resolveDataDir } from '@/lib/storage/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/projects/[id] — permanently deletes the project and its photos.
 * (Renaming goes through POST .../revisions, so it can be undone.)
 *   200 { deleted: true } · 400 invalid id · 404 unknown project
 */
export async function DELETE(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 });
  if (!(await deleteProject(resolveDataDir(), id))) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
