import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  extractRoom,
  ExtractionError,
  LLMNotConfiguredError,
  LLMRequestError,
  providerFromEnv,
  type LLMProvider,
} from '@/lib/llm';
import { isValidProjectId, loadProject, projectExists, resolveDataDir } from '@/lib/storage/projects';
import { photoFilePath } from '@/lib/storage/photos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Vision calls with several photos are slow; allow for the provider timeout plus one retry.
export const maxDuration = 150;

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
  const input = ExtractRequestSchema.safeParse(body);
  if (!input.success) {
    const error = input.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return NextResponse.json({ error }, { status: 400 });
  }

  const project = loadProject(dataDir, id);
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
      readPhoto: (photo) => readFile(photoFilePath(dataDir, id, photo)),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ExtractionError) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 502 });
    }
    if (err instanceof LLMRequestError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
