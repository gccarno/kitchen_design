import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  LLMNotConfiguredError,
  LLMRequestError,
  providerFromEnv,
  refinePlan,
  RefinementError,
  type LLMProvider,
} from '@/lib/llm';
import { loadCatalog } from '@/lib/catalog/loader';
import { isValidProjectId, loadProject, projectExists, resolveDataDir } from '@/lib/storage/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Free models can take a minute or more; allow for the provider timeout plus one retry.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const RefineRequestSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
    .max(10)
    .default([]),
});

/**
 * POST /api/projects/[id]/refine — JSON body { message, history? }.
 *
 * Turns a chat request into a proposed edit. Does NOT change the project:
 * returns `{ commands, patch, summary, reply, warnings, baseRevision }`;
 * the client shows the patch for review and commits it via POST .../revisions.
 * `patch` is empty when the model only replied (a question, or it couldn't).
 *   400 bad request · 404 unknown project · 502 LLM failure · 503 no LLM configured
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
  const input = RefineRequestSchema.safeParse(body);
  if (!input.success) {
    const error = input.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return NextResponse.json({ error }, { status: 400 });
  }

  let provider: LLMProvider;
  try {
    provider = providerFromEnv();
  } catch (err) {
    if (err instanceof LLMNotConfiguredError) {
      return NextResponse.json({ error: `${err.message} You can still edit the plan by hand.` }, { status: 503 });
    }
    throw err;
  }

  try {
    const result = await refinePlan({
      project: loadProject(dataDir, id),
      catalog: loadCatalog(),
      provider,
      message: input.data.message,
      history: input.data.history,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RefinementError) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 502 });
    }
    if (err instanceof LLMRequestError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error('refine failed', err);
    return NextResponse.json({ error: 'unexpected server error during refinement' }, { status: 500 });
  }
}
