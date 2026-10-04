/**
 * Chat request → plan edit. The LLM answers with typed commands; the server
 * compiles them against the current plan into a JSON Patch. Never mutates
 * the project: the patch goes to the diff preview and is committed through
 * the revisions endpoint only if the user applies it.
 */

import { newId } from '../id';
import type { Catalog } from '../catalog/loader';
import { CommandError, compileCommands, type Command } from '../plan/commands';
import { SUMMARY_MAX_LENGTH, type JsonPatchOp, type Project } from '../plan/schemas';
import { validatePlan } from '../plan/validate';
import { LLMResponseError } from './openai-compatible';
import { describeCatalogForLLM, describePlanForLLM } from './plan-context';
import { buildRefinePrompt } from './prompts';
import type { LLMProvider } from './provider';
import { RefinementSchema } from './schemas';

export interface RefineInput {
  project: Project;
  catalog: Catalog;
  provider: LLMProvider;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface RefineResult {
  commands: Command[];
  /** Empty when the model made no change (e.g. answered a question). */
  patch: JsonPatchOp[];
  summary: string;
  /** The model's message for the chat. */
  reply: string;
  /** Plan warnings the change would introduce (existing ones are left out). */
  warnings: string[];
  baseRevision: number;
}

/** The model failed to produce applicable commands, even after one retry. */
export class RefinementError extends Error {
  constructor(readonly issues: string[]) {
    super(`the model's edit could not be applied: ${issues.join('; ')}`);
    this.name = 'RefinementError';
  }
}

const MAX_ATTEMPTS = 2;

export async function refinePlan(input: RefineInput): Promise<RefineResult> {
  const { project, catalog, provider, message } = input;
  const prompt = buildRefinePrompt({
    planText: describePlanForLLM(project, catalog),
    catalogText: describeCatalogForLLM(catalog),
    message,
    history: input.history,
  });

  let issues: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const user =
      issues.length === 0
        ? prompt.user
        : `${prompt.user}\n\nYour previous answer could not be applied:\n${issues.map((i) => `- ${i}`).join('\n')}\nReturn a corrected JSON object.`;
    try {
      const answer = await provider.completeJSON({ system: prompt.system, user, schema: RefinementSchema });
      const { project: next, patch } = compileCommands(project, answer.commands, catalog, newId);
      const before = new Set(validatePlan(project).warnings);
      return {
        commands: answer.commands,
        patch,
        // Clipped: the revisions endpoint refuses longer summaries, so Apply would fail.
        summary: clip(answer.summary.trim() || (answer.commands.length ? `Chat edit: ${message}` : ''), SUMMARY_MAX_LENGTH),
        reply: answer.reply.trim(),
        warnings: validatePlan(next).warnings.filter((w) => !before.has(w)),
        baseRevision: project.revision,
      };
    } catch (err) {
      // Malformed answers and inapplicable commands are worth one retry; anything else propagates.
      if (err instanceof LLMResponseError || err instanceof CommandError) issues = [err.message];
      else throw err;
    }
  }
  throw new RefinementError(issues);
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
