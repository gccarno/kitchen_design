import { NextResponse } from 'next/server';
import { duplicateAsOption, getStorage, isValidProjectId } from '@/lib/storage';
import { withUnauthorized } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/[id]/duplicate — copies the project as a new design option.
 *   201 { project } · 400 invalid id · 404 unknown project
 */
async function handlePost(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 });
  const copy = await duplicateAsOption(await getStorage(), id);
  if (!copy) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  return NextResponse.json({ project: copy }, { status: 201 });
}

export const POST = withUnauthorized(handlePost);
