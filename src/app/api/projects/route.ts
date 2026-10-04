import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ProjectKindSchema } from '@/lib/plan/schemas';
import { createProject, resolveDataDir } from '@/lib/storage/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: ProjectKindSchema.default('kitchen'),
});

/**
 * POST /api/projects — JSON body { name, kind? }. Creates a kitchen with the
 * default 3 m × 4 m room, or (kind "closet") an empty default closet, and
 * returns it (201).
 */
export async function POST(req: Request): Promise<NextResponse> {
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
  const project = createProject(resolveDataDir(), input.data);
  return NextResponse.json({ project }, { status: 201 });
}
