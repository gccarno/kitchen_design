import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { loadCatalog } from '@/lib/catalog/loader';
import { proposeLayouts } from '@/lib/plan/layout-proposals';
import { optionGroupId } from '@/lib/plan/options';
import { duplicateAsOption, getStorage, isValidProjectId } from '@/lib/storage';
import { withUnauthorized } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/[id]/propose-layouts — makes up to three suggested
 * layouts for the project's room, each saved as a new design option (the
 * project itself is not changed).
 *   201 { groupId, options: [{ id, name, label, passed, counted }] }
 *   200 { options: [], reason } when no layout fits (or the room isn't a rectangle)
 *   400 invalid id · 404 unknown project
 */
async function handlePost(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 });
  const storage = await getStorage();
  const project = await storage.projects.load(id);
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  const { proposals, reason } = proposeLayouts(project, loadCatalog(), randomUUID);
  if (!proposals.length) return NextResponse.json({ options: [], reason });

  const options = [];
  // One after another: each option's name ("Option B", "Option C") depends on the ones before it.
  for (const p of proposals) {
    const copy = await duplicateAsOption(storage, id, p.project.items);
    if (copy) options.push({ id: copy.id, name: copy.name, label: p.label, passed: p.passed, counted: p.counted });
  }
  return NextResponse.json({ groupId: optionGroupId(project), options }, { status: 201 });
}

export const POST = withUnauthorized(handlePost);
