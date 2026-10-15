import { NextResponse } from 'next/server';
import { LLMNotConfiguredError, providerFromEnv } from '@/lib/llm';
import { getJobStore } from '@/lib/jobs';
import { dispatchJob } from '@/lib/jobs/dispatch';
import { RefineInputSchema } from '@/lib/jobs/handlers';
import { getRequestStorage, isValidProjectId } from '@/lib/storage';
import { withUnauthorized } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// The LLM call runs as a job (worker or in-process); this request only validates and enqueues.
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/[id]/refine — JSON body { message, history? }.
 *
 * Starts a job that turns a chat request into a proposed edit — plan commands
 * for a kitchen, closet commands for a closet — and answers 202 { jobId } at
 * once. Poll GET /api/jobs/[jobId]: when done, its `result` is
 * `{ commands, patch, summary, reply, warnings, baseRevision }` (the job does
 * NOT change the project; the client reviews the patch and commits it via
 * POST .../revisions; `patch` is empty when the model only replied); when
 * failed, its `error` is `{ status: 502|500, error, issues? }`.
 *   400 bad request · 404 unknown project · 503 no LLM configured — all before any job exists
 */
async function handlePost(req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 });
  const { storage, userId } = await getRequestStorage();
  const project = await storage.projects.load(id);
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }
  const input = RefineInputSchema.safeParse(body);
  if (!input.success) {
    const error = input.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    providerFromEnv();
  } catch (err) {
    if (err instanceof LLMNotConfiguredError) {
      return NextResponse.json({ error: `${err.message} You can still edit the plan by hand.` }, { status: 503 });
    }
    throw err;
  }

  const job = await (await getJobStore(userId)).create(id, 'refine', input.data);
  await dispatchJob(job.id);
  return NextResponse.json({ jobId: job.id }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}

export const POST = withUnauthorized(handlePost);
