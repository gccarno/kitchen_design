import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  extractRoom,
  ExtractionError,
  LLMNotConfiguredError,
  LLMRequestError,
  providerFromEnv,
  type LLMProvider,
} from '@/lib/llm';
import { getStorage, isValidProjectId, readPhoto as readPhotoBytes } from '@/lib/storage';
import { withUnauthorized } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Vision calls with several photos are slow; allow for the provider timeout plus one retry.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const ExtractRequestSchema = z.object({
  measurements: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(200),
        lengthMm: z.number().positive().max(100_000),
      })
    )
    .max(4)
    .default([]),
  hint: z.string().trim().max(500).optional(),
});

/**
 * POST /api/projects/[id]/extract — JSON body { measurements?: [{ description, lengthMm }], hint? }.
 *
 * Asks the vision LLM for a room outline from the project's photos,
 * rescaled to the measurements. Does NOT change the project: the response
 * `{ room, confidence, notes, scale, residual, warnings, baseRevision, patch }`
 * is shown for review and committed via POST .../revisions on confirm.
 *   400 bad request / no photos · 404 unknown project
 *   502 the LLM failed or kept answering badly · 503 no LLM configured
 */
async function handlePost(req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 });
  const storage = await getStorage();
  const project = await storage.projects.load(id);
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }
  const input = ExtractRequestSchema.safeParse(body);
  if (!input.success) {
    const error = input.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return NextResponse.json({ error }, { status: 400 });
  }

  if (project.photos.length === 0) {
    return NextResponse.json({ error: 'upload at least one photo first' }, { status: 400 });
  }

  let provider: LLMProvider;
  try {
    provider = providerFromEnv();
  } catch (err) {
    if (err instanceof LLMNotConfiguredError) {
      return NextResponse.json({ error: `${err.message} You can still sketch the room by hand.` }, { status: 503 });
    }
    throw err;
  }

  try {
    const result = await extractRoom({
      project,
      provider,
      measurements: input.data.measurements,
      hint: input.data.hint,
      readPhoto: async (photo) => {
        const bytes = await readPhotoBytes(storage, id, photo);
        if (!bytes) throw new Error(`photo file missing: ${photo.id}`);
        return bytes;
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ExtractionError) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 502 });
    }
    if (err instanceof LLMRequestError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    // Anything else is a bug; still answer in JSON so the client can show it.
    console.error('extract failed', err);
    return NextResponse.json({ error: 'unexpected server error during extraction' }, { status: 500 });
  }
}

export const POST = withUnauthorized(handlePost);
