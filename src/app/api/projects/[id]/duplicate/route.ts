import { NextResponse } from 'next/server';
import { duplicateAsOption, isValidProjectId, projectExists, resolveDataDir } from '@/lib/storage/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/[id]/duplicate — copies the project as a new design option.
 *   201 { project } · 400 invalid id · 404 unknown project
 */
export async function POST(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 });
  const dataDir = resolveDataDir();
  if (!projectExists(dataDir, id)) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  return NextResponse.json({ project: duplicateAsOption(dataDir, id) }, { status: 201 });
}
