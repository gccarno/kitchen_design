import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '@/lib/catalog/loader';
import { ProjectKindSchema } from '@/lib/plan/schemas';
import { buildFromTemplate, getTemplateInfo } from '@/lib/templates';
import { getStorage, newProject } from '@/lib/storage';
import { withUnauthorized } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: ProjectKindSchema.default('kitchen'),
  sample: z.boolean().optional(),
  templateId: z.string().min(1).max(100).optional(),
});

/**
 * POST /api/projects — JSON body { name, kind?, sample?, templateId? }.
 * Creates a kitchen with the default 3 m × 4 m room, or (kind "closet") an
 * empty default closet, and returns it (201). With `templateId` it comes
 * furnished from that starter template (400 if it is unknown or for the
 * other kind); `sample: true` is shorthand for the sample kitchen or the
 * sample cleaning closet.
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
  const { sample, templateId, ...fields } = input.data;
  const template = templateId ?? (sample ? (fields.kind === 'closet' ? 'closet-cleaning' : 'kitchen-sample') : undefined);
  if (template !== undefined) {
    const info = getTemplateInfo(template);
    if (!info) return NextResponse.json({ error: `unknown template "${template}"` }, { status: 400 });
    if (info.kind !== fields.kind) return NextResponse.json({ error: `template "${template}" is for a ${info.kind}` }, { status: 400 });
  }
  const storage = await getStorage();
  let project = newProject(fields);
  if (template !== undefined) project = buildFromTemplate(template, project, loadCatalog(), randomUUID);
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
