import { z } from 'zod';
import {
  extractRoom,
  refineCloset,
  refinePlan,
  type ClosetRefineResult,
  type ExtractRoomResult,
  type LLMProvider,
  type RefineResult,
} from '../llm';
import { loadCatalog } from '../catalog/loader';
import { projectKind, type Project } from '../plan/schemas';
import { readPhoto, type Storage } from '../storage';

/** The body of POST .../extract (the route validates it; the handler re-parses defensively). */
export const ExtractInputSchema = z.object({
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
export type ExtractInput = z.infer<typeof ExtractInputSchema>;

/** The body of POST .../refine. */
export const RefineInputSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
    .max(10)
    .default([]),
});
export type RefineInput = z.infer<typeof RefineInputSchema>;

export type HandlerArgs = { storage: Storage; project: Project; input: unknown; provider: LLMProvider };

/** Room outline from the project's photos. Throws ExtractionError / LLMRequestError / other. */
export async function runExtract({ storage, project, input, provider }: HandlerArgs): Promise<ExtractRoomResult> {
  const { measurements, hint } = ExtractInputSchema.parse(input ?? {});
  return extractRoom({
    project,
    provider,
    measurements,
    hint,
    readPhoto: async (photo) => {
      const bytes = await readPhoto(storage, project.id, photo);
      if (!bytes) throw new Error(`photo file missing: ${photo.id}`);
      return bytes;
    },
  });
}

/** A proposed edit from a chat message: plan commands for a kitchen, closet commands for a closet. */
export async function runRefine({
  project,
  input,
  provider,
}: HandlerArgs): Promise<RefineResult | ClosetRefineResult> {
  const { message, history } = RefineInputSchema.parse(input ?? {});
  return projectKind(project) === 'closet'
    ? refineCloset({ project, provider, message, history })
    : refinePlan({ project, catalog: loadCatalog(), provider, message, history });
}
