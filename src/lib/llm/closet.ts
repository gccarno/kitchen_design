/**
 * Chat request → closet edit: the closet counterpart of `refine.ts`. The
 * model sees the closet as text (components named c1…), answers with typed
 * closet commands, and the server compiles them into a JSON Patch for the
 * user to review. Never mutates the project.
 */

import { z } from 'zod';
import { newId } from '../id';
import { CLOSET_COMPONENT_KINDS, CLOSET_COMPONENTS, componentRef, topOf } from '../closet/catalog';
import { ClosetCommandSchema, compileClosetCommands, type ClosetCommand } from '../closet/commands';
import { DOOR_STACK_MM, validateCloset } from '../closet/validate';
import { CommandError } from '../plan/commands';
import { SUMMARY_MAX_LENGTH, type Project } from '../plan/schemas';
import { validatePlan } from '../plan/validate';
import { LLMResponseError } from './openai-compatible';
import type { LLMProvider } from './provider';
import { RefinementError, type RefineResult } from './refine';

export const CLOSET_PROMPT_VERSION = '1.0.0';

export const ClosetRefinementSchema = z.object({
  commands: z.array(ClosetCommandSchema).default([]),
  summary: z.string().default(''),
  reply: z.string().default(''),
});

const r = Math.round;

/** The closet as the LLM sees it: size, door opening, and each component by ref. */
export function describeClosetForLLM(project: Project): string {
  const c = project.closet;
  if (!c) throw new Error('not a closet project');
  const o = c.opening;
  const stack = DOOR_STACK_MM[o.style];
  const lines = [
    `Closet "${project.name}": inside ${r(c.widthMm)} wide × ${r(c.heightMm)} high × ${r(c.depthMm)} deep (mm).`,
    o.style === 'open'
      ? 'No doors: the whole front is open.'
      : `Door opening: ${o.style} doors from x ${r(o.leftMm)} to ${r(o.leftMm + o.widthMm)} (${r(o.widthMm)} wide)` +
        (o.style === 'sliding'
          ? `; only one half is open at a time (halves meet at x ${r(o.leftMm + o.widthMm / 2)}).`
          : `; the open doors take ${stack} mm at each side, so drawers fit between x ${r(o.leftMm + stack)} and ${r(o.leftMm + o.widthMm - stack)}.`),
    '',
    'Components (x = left edge … right edge; heights above the floor):',
  ];
  if (c.components.length === 0) lines.push('(none)');
  c.components.forEach((k, i) => {
    const spec = CLOSET_COMPONENTS[k.kind];
    const where = spec.box ? `from ${r(k.yMm)} to ${r(topOf(k))} high` : `at ${r(k.yMm)} high`;
    const extra = k.count !== undefined ? `, ${k.count} ${k.kind === 'drawers' ? 'drawers' : 'shelves'}` : '';
    lines.push(`- ${componentRef(i)}: ${spec.name} [${k.kind}], x ${r(k.xMm)}–${r(k.xMm + k.widthMm)} (${r(k.widthMm)} wide), ${where}${extra}`);
  });
  const warnings = validateCloset(c).warnings;
  if (warnings.length) lines.push('', 'Current problems:', ...warnings.map((w) => `- ${w}`));
  return lines.join('\n');
}

/** One line per component kind: id, name, default size, what it's for. */
export function describeClosetCatalogForLLM(): string {
  return CLOSET_COMPONENT_KINDS.map((kind) => {
    const s = CLOSET_COMPONENTS[kind];
    const d = s.defaults;
    const size = s.box ? `${d.widthMm} wide × ${d.heightMm} high` : `${d.widthMm} wide at ${d.yMm} high`;
    const widths = `width ${s.minWidthMm}${s.maxWidthMm ? `–${s.maxWidthMm}` : '+'}`;
    return `- ${kind}: ${s.name}, default ${size}, ${d.depthMm} deep; ${widths}${s.count ? `; count ${s.count.min}–${s.count.max}` : ''}. ${s.hint}`;
  }).join('\n');
}

export function buildClosetRefinePrompt(input: {
  closetText: string;
  catalogText: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): { system: string; user: string } {
  const system = [
    `You design reach-in closets for a design app. (closet prompt v${CLOSET_PROMPT_VERSION})`,
    '',
    'You receive the closet and a request. Reply with ONE JSON object:',
    '{',
    '  "commands": [ ...zero or more commands, applied in order... ],',
    '  "summary": "<one short line describing the change, e.g. Add double hang on the left>",',
    '  "reply": "<a short message to the user: what you did, or a question / why you could not>"',
    '}',
    '',
    'Coordinates, all in millimetres, looking at the closet from the front:',
    '- xMm = from the closet’s LEFT side wall to the component’s LEFT edge.',
    '- yMm = height above the floor: of the rod / shelf / hooks itself, or of a box’s (tower, drawers, basket) BOTTOM.',
    '',
    'Commands (exact shapes; optional fields default to the component’s standard size):',
    '- {"type":"addComponent","kind":"rod","xMm":0,"widthMm":900,"yMm":1727}   // also "heightMm" (boxes), "depthMm", "count" (drawers / tower shelves)',
    '- {"type":"moveComponent","component":"c1","xMm":600,"yMm":1067}   // either or both',
    '- {"type":"resizeComponent","component":"c2","widthMm":457,"heightMm":700,"count":3}   // any of widthMm, heightMm, depthMm, count',
    '- {"type":"removeComponent","component":"c3"}',
    '- {"type":"setClosetSize","widthMm":2400,"heightMm":2440,"depthMm":610}   // any of them',
    '- {"type":"setOpening","style":"bifold"|"sliding"|"hinged"|"open","leftMm":0,"widthMm":1830}   // any of them',
    '- {"type":"renameProject","name":"..."}',
    '',
    'Rules:',
    '- Refer to existing components ONLY by their refs (c1, c2, ...). Use kinds ONLY from the component list.',
    '- Everything must fit inside the closet. Do only what was asked; keep existing components unless the user asks to start over (then removeComponent them first).',
    '',
    'Closet design (US standard heights):',
    '- Top shelf: one shelf across the whole width at 2134 (84"). Rods hang from it: put a rod about 75 below the shelf above it, never closer than 50.',
    '- Long hang (dresses, coats): one rod at 1727 (68"), nothing below it for 1500.',
    '- Double hang (shirts, trousers): rods at 2057 (81") and 1067 (42"), stacked over the same span; each needs 950 clear below it.',
    '- Towers (457–610 wide, floor to 2134) split the closet into sections. Make rods and shelves end exactly at a tower’s side or a closet side wall: sections + towers must add up to the closet width.',
    '- Drawer units and baskets go INSIDE the door opening, clear of the folded doors (see the door line in the closet text). With sliding doors, keep them within one half.',
    '- Shoes go low: shoe shelves at 152 and about 400, under long hang or in their own section.',
    '- Keep everyday things inside the door opening; the "returns" beside a narrower opening suit the top shelf and long rods.',
    '- If the closet text lists problems, fix the ones your change touches.',
    '',
    '- If the request is a question, unclear, or impossible with these commands, return "commands": [] and explain in "reply".',
    '- Return ONLY the JSON object. No prose, no markdown fences.',
  ].join('\n');

  const turns = (input.history ?? []).map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`);
  const user = [
    'Current closet:',
    input.closetText,
    '',
    'Component kinds:',
    input.catalogText,
    ...(turns.length ? ['', 'Recent conversation:', ...turns] : []),
    '',
    `Request: ${input.message}`,
  ].join('\n');
  return { system, user };
}

const MAX_ATTEMPTS = 2;

export type ClosetRefineResult = Omit<RefineResult, 'commands'> & { commands: ClosetCommand[] };

export async function refineCloset(input: {
  project: Project;
  provider: LLMProvider;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<ClosetRefineResult> {
  const { project, provider, message } = input;
  const prompt = buildClosetRefinePrompt({
    closetText: describeClosetForLLM(project),
    catalogText: describeClosetCatalogForLLM(),
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
      const answer = await provider.completeJSON({ system: prompt.system, user, schema: ClosetRefinementSchema });
      const { project: next, patch } = compileClosetCommands(project, answer.commands, newId);
      const before = new Set(validatePlan(project).warnings);
      const summary = answer.summary.trim() || (answer.commands.length ? `Chat edit: ${message}` : '');
      return {
        commands: answer.commands,
        patch,
        summary: summary.length <= SUMMARY_MAX_LENGTH ? summary : `${summary.slice(0, SUMMARY_MAX_LENGTH - 1)}…`,
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
