import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '@/lib/catalog/loader';
import { ProjectKindSchema } from '@/lib/plan/schemas';
import { buildSampleCleaningCloset } from '@/lib/closet/sample-closet';
import { buildSampleKitchen } from '@/lib/plan/sample-kitchen';
import { getStorage, newProject } from '@/lib/storage';
import { withUnauthorized } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: ProjectKindSchema.default('kitchen'),
  sample: z.boolean().optional(),
});

/**
 * POST /api/projects — JSON body { name, kind?, sample? }. Creates a kitchen
 * with the default 3 m × 4 m room, or (kind "closet") an empty default
 * closet, and returns it (201). With `sample: true` it comes furnished: a
 * sample kitchen, or a sample cleaning closet.
 */
async function handlePost(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }
  const input = CreateProjectSchema.safeParse(body);
  if (!input.success) {
    const kindIssue = input.error.issues.some((i) => i.path[0] === 'kind');
    return NextResponse.json({ error: kindIssue ? 'kind must be "kitchen" or "closet"' : 'name is required' }, { status: 400 });
  }
  const storage = await getStorage();
  const { sample, ...fields } = input.data;
  let project = newProject(fields);
  if (sample) {
    project = project.kind === 'closet' ? buildSampleCleaningCloset(project, randomUUID) : buildSampleKitchen(project, loadCatalog(), randomUUID);
  }
  await storage.projects.insert(project);
  return NextResponse.json({ project }, { status: 201 });
}

/**
 * GET /api/projects — light summaries (no plan geometry), newest first.
 *   200 [{ id, name, kind, revision, createdAt, updatedAt, optionOf? }]
 */
async function handleGet(): Promise<NextResponse> {
  const storage = await getStorage();
  const list = (await storage.projects.list()).map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    revision: p.revision,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    ...(p.optionOf ? { optionOf: p.optionOf } : {}),
  }));
  return NextResponse.json(list, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withUnauthorized(handleGet);
export const POST = withUnauthorized(handlePost);
