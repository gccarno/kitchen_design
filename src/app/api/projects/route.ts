import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createProject, resolveDataDir } from '@/lib/storage/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CreateProjectSchema = z.object({ name: z.string().trim().min(1).max(200) });

/**
 * POST /api/projects — JSON body { name }. Creates a project with the
 * default 3 m × 4 m room and returns it (201).
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
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const project = createProject(resolveDataDir(), { name: input.data.name });
  return NextResponse.json({ project }, { status: 201 });
}
